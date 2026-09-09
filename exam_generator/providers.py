"""Provider adapter layer.  It reuses the backend's configured key router."""

from __future__ import annotations

import json
import random
import threading
import time
from abc import ABC, abstractmethod
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from dataclasses import dataclass
from typing import Any, Dict, Optional


class ProviderError(RuntimeError):
    pass


def extract_json(text: str) -> Dict[str, Any]:
    candidate = str(text or "").strip()
    if candidate.startswith("```"):
        candidate = candidate.split("\n", 1)[1] if "\n" in candidate else ""
        if candidate.rstrip().endswith("```"):
            candidate = candidate.rstrip()[:-3].rstrip()
    try:
        result = json.loads(candidate)
    except json.JSONDecodeError:
        start, end = candidate.find("{"), candidate.rfind("}")
        if start < 0 or end <= start:
            raise ProviderError("The model did not return a JSON object.")
        try:
            result = json.loads(candidate[start : end + 1])
        except json.JSONDecodeError as exc:
            raise ProviderError("The model returned malformed JSON.") from exc
    if not isinstance(result, dict):
        raise ProviderError("The model JSON response must be an object.")
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
    ) -> str:
        raise NotImplementedError

    def complete_json(self, **kwargs: Any) -> Dict[str, Any]:
        return extract_json(self.complete(**kwargs))


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
        self._lock = threading.Lock()
        self._failures = 0
        self._open_until = 0.0

    def complete(self, **kwargs: Any) -> str:
        with self._lock:
            if self._open_until > time.monotonic():
                raise ProviderError("Provider circuit breaker is open; retry later.")
        last_error: Exception | None = None
        for attempt in range(self.policy.max_attempts):
            try:
                executor = ThreadPoolExecutor(max_workers=1)
                future = executor.submit(self.inner.complete, **kwargs)
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
            if attempt + 1 < self.policy.max_attempts:
                # Bounded exponential backoff with non-deterministic jitter; no unbounded sleep.
                delay = min(4.0, self.policy.base_delay_seconds * (2 ** attempt))
                time.sleep(delay * (0.75 + random.random() * 0.5))
        with self._lock:
            self._failures += 1
            if self._failures >= self.policy.circuit_failures:
                self._open_until = time.monotonic() + self.policy.circuit_cooldown_seconds
        raise ProviderError(str(last_error or "Provider request failed."))


class ExistingBackendProvider(TextProvider):
    """Thin adapter over the existing Groq/Cerebras/Gemini key pool in index.py."""

    def complete(self, **kwargs: Any) -> str:
        # Import lazily: index.py imports this package only from protected routes.
        from api.index import _groq_chat

        text, error = _groq_chat(
            kwargs["system"],
            kwargs["user"],
            max_tokens=kwargs.get("max_tokens", 4096),
            temperature=kwargs.get("temperature", 0.1),
            json_mode=kwargs.get("json_mode", True),
            model=kwargs.get("model") or None,
            reasoning_effort="medium",
        )
        if error:
            raise ProviderError(error)
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
