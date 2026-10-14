import unittest
from unittest.mock import patch
import json
import asyncio
from api.index import ai_feedback

class TestWritingAiFeedback(unittest.TestCase):
    def test_structured_ai_feedback_calibration_and_offsets(self):
        sample_essay = "Nowadays, many people believe that technology has a negative impact on human life. However, I completely disagree."
        mock_ai_json = {
            "criteria": {
                "TA_TR": {"band": 7.0, "why_current": "Clear position", "limiting_feature": "Could extend ideas"},
                "CC": {"band": 6.5, "why_current": "Good progression", "limiting_feature": "Mechanical cohesive devices"},
                "LR": {"band": 6.5, "why_current": "Adequate range", "limiting_feature": "A few awkward collocations"},
                "GRA": {"band": 6.0, "why_current": "Mixed complex structures", "limiting_feature": "Occasional errors"}
            },
            "estimated_task_band": 6.5,
            "bottlenecks": [
                "Phát triển sâu hơn các luận điểm thân bài",
                "Sử dụng từ nối tự nhiên hơn thay vì lạm dụng liên từ công thức",
                "Kiểm soát các cấu trúc câu phức để tránh lỗi ngữ pháp"
            ],
            "strengths": [
                "Mở bài nêu rõ quan điểm cá nhân một cách dứt khoát",
                "Bố cục bài viết mạch lạc và dễ theo dõi"
            ],
            "annotations": [
                {
                    "anchorQuote": "has a negative impact on human life",
                    "criterion": "LR",
                    "category": "upgrade",
                    "replacement": "exerts an adverse effect on human existence",
                    "highBandRewrite": "exerts an profoundly adverse effect on human existence",
                    "comment": "Nâng cấp cụm collocation lên Band 8+"
                },
                {
                    "anchorQuote": "I completely disagree",
                    "criterion": "TA_TR",
                    "category": "praise",
                    "replacement": "",
                    "comment": "Lập trường được thể hiện rõ ràng ngay từ mở bài"
                }
            ],
            "corrected_essay": sample_essay,
            "sample_essay": sample_essay + " Model answer continuation."
        }

        with patch("api.index._writing_eval_chat", return_value=(json.dumps(mock_ai_json), "")):
            payload = {
                "structured": True,
                "task_number": 2,
                "task_title": "Writing Task 2",
                "prompt": "Do you agree or disagree?",
                "essay": sample_essay,
                "lang": "vi"
            }
            res = asyncio.run(ai_feedback(payload))
            self.assertTrue(res.get("success"))
            self.assertTrue(res.get("structured"))
            self.assertEqual(res.get("estimated_task_band"), 6.5)
            self.assertEqual(len(res.get("annotations")), 2)
            
            # Check computed offsets
            ann1 = res["annotations"][0]
            self.assertEqual(ann1["anchorQuote"], "has a negative impact on human life")
            self.assertEqual(ann1["startOffset"], sample_essay.find("has a negative impact on human life"))
            self.assertEqual(ann1["endOffset"], ann1["startOffset"] + len("has a negative impact on human life"))
            self.assertEqual(ann1["criterion"], "LR")
            self.assertEqual(ann1["category"], "upgrade")

    def test_structured_ai_feedback_empty_essay_error(self):
        payload = {
            "structured": True,
            "task_number": 2,
            "essay": "",
            "lang": "vi"
        }
        res = asyncio.run(ai_feedback(payload))
        self.assertFalse(res.get("success"))

    def test_selection_critique_mode(self):
        mock_critique_json = {
            "criterion": "LR",
            "category": "awkward",
            "replacement": "significant decline",
            "highBandRewrite": "marked downturn",
            "comment": "Cụm từ dùng chưa tự nhiên trong văn cảnh học thuật."
        }
        with patch("api.index._writing_eval_chat", return_value=(json.dumps(mock_critique_json), "")):
            payload = {
                "mode": "selection_critique",
                "selected_text": "big drop down",
                "context_text": "The graph shows a big drop down in sales in 2020.",
                "task_number": 1,
                "prompt": "Summarize the information...",
                "lang": "vi"
            }
            res = asyncio.run(ai_feedback(payload))
            self.assertTrue(res.get("success"))
            self.assertEqual(res.get("criterion"), "LR")
            self.assertEqual(res.get("category"), "awkward")
            self.assertEqual(res.get("replacement"), "significant decline")
            self.assertEqual(res.get("highBandRewrite"), "marked downturn")
            self.assertIn("chưa tự nhiên", res.get("comment", ""))

    def test_high_band_anti_deflation_calibration(self):
        band8_essay = (
            "The rapid proliferation of digital communications has undoubtedly altered interpersonal interactions. "
            "While critics contend that electronic correspondence diminishes conversational intimacy, "
            "I firmly believe that modern connectivity broadens communal engagement without eroding meaningful relationships."
        )
        band8_json = {
            "criteria": {
                "TA_TR": {"band": 8.0, "why_current": "Comprehensive position well argued", "limiting_feature": "None"},
                "CC": {"band": 8.0, "why_current": "Skillful cohesion and natural progression", "limiting_feature": "None"},
                "LR": {"band": 8.5, "why_current": "Sophisticated lexical range and precision", "limiting_feature": "Rare minor collocation slip"},
                "GRA": {"band": 8.0, "why_current": "Majority of sentences error-free with flexible complex structures", "limiting_feature": "None"}
            },
            "estimated_task_band": 8.0,
            "bottlenecks": ["Tập trung làm sâu sắc hơn một số ví dụ thực tiễn", "Duy trì tính nhất quán phong cách học thuật", "Kiểm soát dấu câu ở mệnh đề ghép dài"],
            "strengths": ["Vốn từ vựng C1/C2 học thuật phong phú", "Lập trường sắc bén và xuyên suốt bài viết"],
            "annotations": [
                {
                    "anchorQuote": "broadens communal engagement",
                    "criterion": "LR",
                    "category": "praise",
                    "replacement": "",
                    "highBandRewrite": "",
                    "comment": "Sử dụng collocation học thuật tự nhiên, chính xác."
                }
            ],
            "corrected_essay": band8_essay,
            "sample_essay": band8_essay
        }
        with patch("api.index._writing_eval_chat", return_value=(json.dumps(band8_json), "")):
            payload = {
                "structured": True,
                "task_number": 2,
                "essay": band8_essay,
                "prompt": "Some people think that technology reduces social interaction. Do you agree or disagree?"
            }
            res = asyncio.run(ai_feedback(payload))
            self.assertTrue(res.get("success"))
            # 8.0 + 8.0 + 8.5 + 8.0 = 32.5 / 4 = 8.125 -> rounds to 8.0
            self.assertEqual(res.get("estimated_task_band"), 8.0)
            self.assertEqual(res["criteria"]["LR"]["band"], 8.5)

    def test_ielts_round_band_protocol(self):
        from api.index import _ielts_round_band
        # < 0.25 rounds down
        self.assertEqual(_ielts_round_band(6.125), 6.0)
        self.assertEqual(_ielts_round_band(7.0), 7.0)
        self.assertEqual(_ielts_round_band(7.2), 7.0)
        # >= 0.25 and < 0.75 rounds to half band
        self.assertEqual(_ielts_round_band(6.25), 6.5)
        self.assertEqual(_ielts_round_band(6.375), 6.5)
        self.assertEqual(_ielts_round_band(6.5), 6.5)
        self.assertEqual(_ielts_round_band(6.625), 6.5)
        # >= 0.75 rounds up to next whole band
        self.assertEqual(_ielts_round_band(6.75), 7.0)
        self.assertEqual(_ielts_round_band(6.875), 7.0)
        self.assertEqual(_ielts_round_band(7.875), 8.0)

    def test_task1_chart_image_grounding_passed_to_chat(self):
        captured_kwargs = {}
        def mock_eval_chat(sys_prompt, user_prompt, max_tokens=4096, temperature=0.15, json_mode=True, image_part=None):
            captured_kwargs["image_part"] = image_part
            captured_kwargs["user_prompt"] = user_prompt
            return (json.dumps({
                "criteria": {"TA_TR": {"band": 7.5}, "CC": {"band": 7.5}, "LR": {"band": 7.5}, "GRA": {"band": 7.5}},
                "estimated_task_band": 7.5,
                "annotations": []
            }), "")

        fake_image_part = {"mime_type": "image/png", "data": "iVBORw0KGgoAAAANSUhEUg=="}
        with patch("api.index._resolve_image_base64_part", return_value=fake_image_part):
            with patch("api.index._writing_eval_chat", side_effect=mock_eval_chat):
                payload = {
                    "structured": True,
                    "task_number": 1,
                    "essay": "The chart illustrates oil production across three regions from 2000 to 2020.",
                    "media_url": "https://example.com/chart.png"
                }
                res = asyncio.run(ai_feedback(payload))
                self.assertTrue(res.get("success"))
                self.assertEqual(captured_kwargs.get("image_part"), fake_image_part)
                self.assertIn("Task 1 visual chart image is attached", captured_kwargs.get("user_prompt", ""))

    def test_writing_eval_chat_prefers_gemini_then_groq_reasoning(self):
        from api.index import _writing_eval_chat

        call_log = []
        def fake_gemini(key, model, *args, **kwargs):
            call_log.append(("gemini", key, model))
            if "fail" in key:
                return ("", "RATE_LIMIT")
            return ("{\"result\": \"gemini_ok\"}", "")

        def fake_oai(base_url, key, model, *args, **kwargs):
            call_log.append(("oai", key, model))
            return ("{\"result\": \"oai_ok\"}", "")

        with patch("api.index._gemini_chat_once", side_effect=fake_gemini):
            with patch("api.index._oai_chat_once", side_effect=fake_oai):
                with patch("api.index._api_key_pool", side_effect=lambda *names, **kw: ["gemini_key1"] if "GEMINI_API_KEY" in names else ["groq_key1"]):
                    text, err = _writing_eval_chat("sys", "user")
                    self.assertEqual(err, "")
                    self.assertIn("gemini_ok", text)
                    self.assertEqual(call_log[0][0], "gemini")

        # Now test fallback when Gemini fails: should call Groq reasoning models
        call_log.clear()
        with patch("api.index._gemini_chat_once", side_effect=fake_gemini):
            with patch("api.index._oai_chat_once", side_effect=fake_oai):
                with patch("api.index._api_key_pool", side_effect=lambda *names, **kw: ["fail_gemini"] if "GEMINI_API_KEY" in names else ["groq_key1"]):
                    text, err = _writing_eval_chat("sys", "user")
                    self.assertEqual(err, "")
                    self.assertIn("oai_ok", text)
                    # Verify Groq model called is reasoning model (not 8b)
                    groq_calls = [c for c in call_log if c[0] == "oai"]
                    self.assertTrue(len(groq_calls) > 0)
                    self.assertNotIn("llama-3.1-8b-instant", [c[2] for c in groq_calls])

if __name__ == '__main__':
    unittest.main()

