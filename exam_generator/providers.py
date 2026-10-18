"""Provider adapter layer.  It reuses the backend's configured key router."""

from __future__ import annotations

import json
import os
import random
import threading
import time
from abc import ABC, abstractmethod
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from dataclasses import dataclass
from typing import Any, Dict, Optional
from .errors import TRANSIENT_PROVIDER_CODES, provider_error_code


class ProviderError(RuntimeError):
    """Provider failure with an optional private model-response diagnostic."""

    def __init__(self, message: str, raw_response: str = "", code: str = ""):
        super().__init__(message)
        self.raw_response = str(raw_response or "")
        self.code = code or provider_error_code(message)
        self.retryable = self.code in TRANSIENT_PROVIDER_CODES


def extract_json(text: str) -> Dict[str, Any]:
    candidate = str(text or "").strip()
    if not candidate:
        raise ProviderError("The provider returned an empty response.", code="PROVIDER_EMPTY_RESPONSE")
    if candidate.startswith("```"):
        candidate = candidate.split("\n", 1)[1] if "\n" in candidate else ""
        if candidate.rstrip().endswith("```"):
            candidate = candidate.rstrip()[:-3].rstrip()
    try:
        result = json.loads(candidate)
    except json.JSONDecodeError as initial_error:
        start, end = candidate.find("{"), candidate.rfind("}")
        if start < 0 or end <= start:
            truncated = candidate.lstrip().startswith("{") and not candidate.rstrip().endswith("}")
            raise ProviderError(
                "The model output was truncated before the JSON object closed."
                if truncated else "The model did not return a JSON object.",
                raw_response=candidate,
                code="PROVIDER_TRUNCATED_OUTPUT" if truncated else "PROVIDER_MALFORMED_JSON",
            ) from initial_error
        try:
            result = json.loads(candidate[start : end + 1])
        except json.JSONDecodeError as exc:
            truncated = candidate.startswith("{") and not candidate.endswith("}")
            raise ProviderError("The model returned malformed JSON.", raw_response=candidate,
                                code="PROVIDER_TRUNCATED_OUTPUT" if truncated else "PROVIDER_MALFORMED_JSON") from exc
    if not isinstance(result, dict):
        raise ProviderError("The model JSON response must be an object.", raw_response=candidate)
    return result


class TextProvider(ABC):
    @abstractmethod
    def complete(
        self,
        *,
        system: str,
        user: str,
        model: str,
        max_tokens: int,
        json_mode: bool = True,
        temperature: float = 0.1,
        phase: str = "",
        image_inputs: Optional[list[Dict[str, str]]] = None,
    ) -> str:
        raise NotImplementedError

    def complete_json_with_raw(self, **kwargs: Any) -> tuple[Dict[str, Any], str]:
        """Parse JSON while retaining the exact provider response privately."""
        raw = self.complete(**kwargs)
        return extract_json(raw), raw

    def complete_json(self, **kwargs: Any) -> Dict[str, Any]:
        payload, _raw = self.complete_json_with_raw(**kwargs)
        return payload


@dataclass
class RetryPolicy:
    max_attempts: int = 3
    timeout_seconds: int = 55
    base_delay_seconds: float = 0.35
    circuit_failures: int = 4
    circuit_cooldown_seconds: int = 30


class ResilientProvider(TextProvider):
    """Bounded retries, jitter, timeout and a small fail-closed circuit breaker."""

    def __init__(self, inner: TextProvider, policy: RetryPolicy | None = None):
        self.inner = inner
        self.policy = policy or RetryPolicy()
        configure_outer_timeout = getattr(self.inner, "configure_outer_timeout", None)
        if callable(configure_outer_timeout):
            configure_outer_timeout(self.policy.timeout_seconds)
        self._lock = threading.Lock()
        self._failures = 0
        self._open_until = 0.0

    def _run_with_retry(self, operation: Any) -> Any:
        """Run both provider I/O and JSON decoding inside one bounded retry boundary."""
        with self._lock:
            if self._open_until > time.monotonic():
                raise ProviderError("Provider circuit breaker is open; retry later.")
        last_error: Exception | None = None
        for attempt in range(self.policy.max_attempts):
            try:
                executor = ThreadPoolExecutor(max_workers=1)
                future = executor.submit(operation)
                try:
                    result = future.result(timeout=self.policy.timeout_seconds)
                finally:
                    executor.shutdown(wait=future.done(), cancel_futures=True)
                with self._lock:
                    self._failures = 0
                return result
            except FutureTimeout:
                last_error = ProviderError("Provider request timed out.")
            except Exception as exc:
                last_error = exc if isinstance(exc, ProviderError) else ProviderError(str(exc))
            if isinstance(last_error, ProviderError) and not last_error.retryable:
                break
            if attempt + 1 < self.policy.max_attempts:
                # Bounded exponential backoff with non-deterministic jitter; no unbounded sleep.
                delay = min(4.0, self.policy.base_delay_seconds * (2 ** attempt))
                time.sleep(delay * (0.75 + random.random() * 0.5))
        with self._lock:
            self._failures += 1
            if self._failures >= self.policy.circuit_failures:
                self._open_until = time.monotonic() + self.policy.circuit_cooldown_seconds
        if isinstance(last_error, ProviderError):
            raise last_error
        raise ProviderError(str(last_error or "Provider request failed."))

    def complete(self, **kwargs: Any) -> str:
        return self._run_with_retry(lambda: self.inner.complete(**kwargs))

    def complete_json(self, **kwargs: Any) -> Dict[str, Any]:
        # Parsing belongs inside the retry envelope. A syntactically incomplete
        # model response is transient provider output, while canonical schema
        # validation remains fail-closed in the pipeline after this returns.
        payload, _raw = self.complete_json_with_raw(**kwargs)
        return payload

    def complete_json_with_raw(self, **kwargs: Any) -> tuple[Dict[str, Any], str]:
        return self._run_with_retry(lambda: self.inner.complete_json_with_raw(**kwargs))


class ExistingBackendProvider(TextProvider):
    """Thin adapter over the existing Groq/Cerebras/Gemini key pool in index.py."""

    def __init__(
        self,
        *,
        router_timeout_seconds: Optional[float] = None,
        per_request_timeout_seconds: Optional[float] = None,
    ):
        """Keep raw-DOCX provider routing inside the outer retry deadline.

        The generic ``_groq_chat`` router remains backwards-compatible for its
        existing callers. Only this pipeline adapter supplies a monotonic
        deadline, so a slow provider cannot leave an orphaned router running
        after ``ResilientProvider`` starts its next bounded retry.
        """
        self._uses_default_router_timeout = router_timeout_seconds is None
        self._uses_default_request_timeout = per_request_timeout_seconds is None
        if router_timeout_seconds is None:
            try:
                outer_timeout = int(os.environ.get("EXAM_GENERATION_PROVIDER_TIMEOUT", "90"))
            except (TypeError, ValueError):
                outer_timeout = 90
            outer_timeout = max(60, min(100, outer_timeout))
            # Leave a guard window for the outer watchdog and retry bookkeeping.
            router_timeout_seconds = outer_timeout - 8
        try:
            router_budget = float(router_timeout_seconds)
        except (TypeError, ValueError):
            router_budget = 82.0
        self.router_timeout_seconds = max(15.0, min(92.0, router_budget))

        if per_request_timeout_seconds is None:
            per_request_timeout_seconds = self._default_request_timeout(self.router_timeout_seconds)
        try:
            request_budget = float(per_request_timeout_seconds)
        except (TypeError, ValueError):
            request_budget = 25.0
        self.per_request_timeout_seconds = max(1.0, min(55.0, request_budget))

    @staticmethod
    def _default_request_timeout(router_timeout_seconds: float) -> float:
        # A structural canonical response can legitimately take close to the
        # legacy 55-second upstream window. The router deadline still reserves
        # the remaining budget for another provider family when that call fails.
        return min(55.0, max(8.0, router_timeout_seconds))

    def configure_outer_timeout(self, outer_timeout_seconds: float) -> None:
        """Align a default router budget with the enclosing retry watchdog."""
        if not self._uses_default_router_timeout:
            return
        try:
            outer_timeout = float(outer_timeout_seconds)
        except (TypeError, ValueError):
            return
        self.router_timeout_seconds = max(15.0, min(92.0, outer_timeout - 8.0))
        if self._uses_default_request_timeout:
            self.per_request_timeout_seconds = self._default_request_timeout(self.router_timeout_seconds)

    def _request_timeout_for_call(self, phase: Any) -> float:
        """Leave fallback headroom for small, highly parallel Solver patches."""
        if str(phase or "").lower() in {"question", "question_repair", "critic"}:
            return min(self.per_request_timeout_seconds, max(8.0, self.router_timeout_seconds / 3.0))
        return self.per_request_timeout_seconds

    def complete(self, **kwargs: Any) -> str:
        # Import lazily: index.py imports this package only from protected routes.
        from api.index import _groq_chat

        deadline_monotonic = time.monotonic() + self.router_timeout_seconds
        text, error = _groq_chat(
            kwargs["system"],
            kwargs["user"],
            max_tokens=kwargs.get("max_tokens", 4096),
            temperature=kwargs.get("temperature", 0.1),
            json_mode=kwargs.get("json_mode", True),
            model=kwargs.get("model") or None,
            reasoning_effort="medium",
            deadline_monotonic=deadline_monotonic,
            per_request_timeout_s=self._request_timeout_for_call(kwargs.get("phase")),
            image_inputs=kwargs.get("image_inputs"),
        )
        if error:
            raise ProviderError(error, code=error if error == "VISION_PROVIDER_UNAVAILABLE" else "")
        return text


class StaticProvider(TextProvider):
    """Small deterministic provider for regression tests and local dry runs."""

    def __init__(self, responses: Dict[str, Any] | str):
        self.responses = responses
        self.calls = []

    def complete(self, **kwargs: Any) -> str:
        self.calls.append(kwargs)
        if isinstance(self.responses, str):
            return self.responses
        phase = kwargs.get("phase") or "default"
        value = self.responses.get(phase, self.responses.get("default"))
        if value is None:
            raise ProviderError(f"No static response configured for {phase}.")
        return value if isinstance(value, str) else json.dumps(value)
