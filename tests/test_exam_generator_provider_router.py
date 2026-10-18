import json
import time
import unittest
from unittest.mock import patch

from api import index
from exam_generator.providers import ExistingBackendProvider, ResilientProvider, RetryPolicy


class _Response:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


class ProviderRouterTests(unittest.TestCase):
    def _key_pool(self, *names):
        first = names[0]
        if first == "GROQ_API_KEY":
            return ["groq-key"]
        if first == "CEREBRAS_API_KEY":
            return ["cerebras-key"]
        if first == "GEMINI_API_KEY":
            return ["gemini-key"]
        return []

    def test_oai_helper_preserves_default_and_accepts_per_call_timeout(self):
        seen_timeouts = []

        def fake_urlopen(_request, timeout):
            seen_timeouts.append(timeout)
            return _Response({"choices": [{"message": {"content": "ok"}}]})

        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            text, error = index._oai_chat_once(
                "https://example.test/v1", "key", "model", "system", "user", 10, 0.1, True, None,
            )
            bounded_text, bounded_error = index._oai_chat_once(
                "https://example.test/v1", "key", "model", "system", "user", 10, 0.1, True, None,
                timeout_s=7.25,
            )

        self.assertEqual((text, error), ("ok", ""))
        self.assertEqual((bounded_text, bounded_error), ("ok", ""))
        self.assertEqual(seen_timeouts, [55.0, 7.25])

    def test_deadline_aware_router_rotates_provider_families(self):
        calls = []

        def fake_oai(base_url, _key, model, *_args, timeout_s):
            calls.append(("groq" if "groq" in base_url else "cerebras", model, timeout_s))
            return "", "temporary provider failure"

        def fake_gemini(_key, model, *_args, timeout_s):
            calls.append(("gemini", model, timeout_s))
            return "routed-success", ""

        with patch.object(index, "_api_key_pool", side_effect=self._key_pool), patch.object(
            index, "_rotated_api_keys", side_effect=lambda _namespace, keys: list(keys)
        ), patch.object(index, "_oai_chat_once", side_effect=fake_oai), patch.object(
            index, "_gemini_chat_once", side_effect=fake_gemini
        ):
            text, error = index._groq_chat(
                "system", "user", deadline_monotonic=time.monotonic() + 10, per_request_timeout_s=3,
            )

        self.assertEqual((text, error), ("routed-success", ""))
        self.assertEqual([item[0] for item in calls], ["groq", "cerebras", "gemini"])
        self.assertTrue(all(0 < item[2] <= 3 for item in calls))

    def test_legacy_router_keeps_provider_first_order_without_deadline(self):
        calls = []

        def fake_oai(base_url, _key, model, *_args, timeout_s):
            calls.append(("groq" if "groq" in base_url else "cerebras", model, timeout_s))
            if "cerebras" in base_url:
                return "legacy-success", ""
            return "", "temporary provider failure"

        with patch.object(index, "_api_key_pool", side_effect=self._key_pool), patch.object(
            index, "_rotated_api_keys", side_effect=lambda _namespace, keys: list(keys)
        ), patch.object(index, "_oai_chat_once", side_effect=fake_oai), patch.object(index, "_gemini_chat_once") as gemini:
            text, error = index._groq_chat("system", "user")

        self.assertEqual((text, error), ("legacy-success", ""))
        self.assertEqual([item[0] for item in calls], ["groq", "groq", "cerebras"])
        self.assertEqual([item[2] for item in calls], [55.0, 55.0, 55.0])
        gemini.assert_not_called()

    def test_expired_router_deadline_makes_no_network_call(self):
        with patch.object(index, "_api_key_pool", side_effect=self._key_pool), patch.object(
            index, "_rotated_api_keys", side_effect=lambda _namespace, keys: list(keys)
        ), patch.object(index, "_oai_chat_once") as oai, patch.object(index, "_gemini_chat_once") as gemini:
            text, error = index._groq_chat(
                "system", "user", deadline_monotonic=time.monotonic() - 0.001, per_request_timeout_s=3,
            )

        self.assertEqual((text, error), ("", "PROVIDER_TIMEOUT"))
        oai.assert_not_called()
        gemini.assert_not_called()

    def test_existing_backend_adapter_supplies_deadline_only_to_router(self):
        provider = ExistingBackendProvider(router_timeout_seconds=30, per_request_timeout_seconds=7)
        with patch("api.index._groq_chat", return_value=("ok", "")) as chat, patch(
            "exam_generator.providers.time.monotonic", return_value=100.0
        ):
            result = provider.complete(system="system", user="user", max_tokens=10, json_mode=True, temperature=0.1)

        self.assertEqual(result, "ok")
        self.assertEqual(chat.call_args.kwargs["deadline_monotonic"], 130.0)
        self.assertEqual(chat.call_args.kwargs["per_request_timeout_s"], 7.0)

    def test_solver_phase_reserves_fallback_headroom(self):
        provider = ExistingBackendProvider(router_timeout_seconds=60, per_request_timeout_seconds=55)
        with patch("api.index._groq_chat", return_value=("ok", "")) as chat, patch(
            "exam_generator.providers.time.monotonic", return_value=100.0
        ):
            provider.complete(system="system", user="user", max_tokens=10, json_mode=True, temperature=0.1, phase="question")

        self.assertEqual(chat.call_args.kwargs["per_request_timeout_s"], 20.0)

    def test_default_adapter_budget_tracks_the_enclosing_retry_timeout(self):
        provider = ExistingBackendProvider()
        ResilientProvider(provider, RetryPolicy(max_attempts=1, timeout_seconds=60))

        self.assertEqual(provider.router_timeout_seconds, 52.0)
        self.assertEqual(provider.per_request_timeout_seconds, 52.0)

    def test_gemini_serializes_validated_inline_visual_parts(self):
        captured = {}

        def fake_urlopen(request, timeout):
            captured["body"] = json.loads(request.data.decode("utf-8"))
            captured["timeout"] = timeout
            return _Response({"candidates": [{"content": {"parts": [{"text": "{\"ok\":true}"}]}}]})

        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            text, error = index._gemini_chat_once(
                "key", "gemini-2.5-flash", "system", "user", 100, 0, True,
                timeout_s=4, image_inputs=[{"mime_type": "image/png", "data": "YWJj"}],
            )

        self.assertEqual((text, error), ('{"ok":true}', ""))
        parts = captured["body"]["contents"][0]["parts"]
        self.assertEqual(parts[0], {"text": "user"})
        self.assertEqual(parts[1]["inlineData"], {"mimeType": "image/png", "data": "YWJj"})
        self.assertEqual(captured["timeout"], 4.0)

    def test_visual_router_never_calls_text_only_families(self):
        seen = []

        def fake_gemini(_key, model, *_args, timeout_s, image_inputs=None):
            seen.append((model, timeout_s, image_inputs))
            return "visual-success", ""

        with patch.object(index, "_api_key_pool", side_effect=self._key_pool), patch.object(
            index, "_rotated_api_keys", side_effect=lambda _namespace, keys: list(keys)
        ), patch.object(index, "_oai_chat_once") as oai, patch.object(
            index, "_gemini_chat_once", side_effect=fake_gemini
        ):
            text, error = index._groq_chat(
                "system", "user", deadline_monotonic=time.monotonic() + 10,
                per_request_timeout_s=3,
                image_inputs=[{"mime_type": "image/png", "data": "YWJj"}],
            )

        self.assertEqual((text, error), ("visual-success", ""))
        oai.assert_not_called()
        self.assertEqual(seen[0][2][0]["data"], "YWJj")

    def test_visual_router_fails_explicitly_without_gemini(self):
        with patch.object(index, "_api_key_pool", side_effect=lambda *names: [] if names[0] == "GEMINI_API_KEY" else ["key"]):
            text, error = index._groq_chat(
                "system", "user", image_inputs=[{"mime_type": "image/png", "data": "YWJj"}],
            )

        self.assertEqual((text, error), ("", "VISION_PROVIDER_UNAVAILABLE"))


if __name__ == "__main__":
    unittest.main()
