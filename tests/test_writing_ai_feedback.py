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

        with patch("api.index._groq_chat", return_value=(json.dumps(mock_ai_json), "")):
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
        with patch("api.index._groq_chat", return_value=(json.dumps(mock_critique_json), "")):
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

if __name__ == '__main__':
    unittest.main()

