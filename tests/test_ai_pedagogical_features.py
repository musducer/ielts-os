import asyncio
import json
import unittest
from unittest.mock import patch, MagicMock
from api import index


class TestAiPedagogicalFeatures(unittest.TestCase):
    def test_extract_json_object_markdown_code_block(self):
        raw = "Here is the result:\n```json\n{\"categoryBreakdown\": {\"lexicalGap\": 40, \"distractorTrap\": 30, \"scopeMisread\": 30}}\n```\nHope it helps!"
        data = index._extract_json_object(raw)
        self.assertIsNotNone(data)
        self.assertEqual(data.get("categoryBreakdown", {}).get("lexicalGap"), 40)

    def test_extract_json_object_raw_text(self):
        raw = "Some intro text: {\"trapType\": \"Extrapolation Trap\", \"whyStudentWrong\": \"Assumed info\"} other trailing text."
        data = index._extract_json_object(raw)
        self.assertIsNotNone(data)
        self.assertEqual(data.get("trapType"), "Extrapolation Trap")

    def test_analyze_error_dna_endpoint(self):
        req_payload = {
            "studentName": "Nguyen Van A",
            "targetBand": "7.5",
            "typeAccuracy": [
                {"label": "Multiple Choice", "correct": 2, "total": 5, "accuracy": 40},
                {"label": "Matching Headings", "correct": 4, "total": 6, "accuracy": 67}
            ],
            "recentMistakes": [
                {
                    "quizTitle": "Cam 18 Test 1",
                    "skill": "Reading",
                    "questionType": "Multiple Choice",
                    "subType": "MCQ",
                    "questionText": "What did the researchers discover about the sleep cycle?",
                    "studentAnswer": "B",
                    "correctAnswer": "D"
                }
            ]
        }

        mock_ai_response = json.dumps({
            "categoryBreakdown": {"lexicalGap": 50, "distractorTrap": 30, "scopeMisread": 20},
            "recurringTraps": [
                {
                    "titleVi": "Bẫy từ khóa trùng lặp nguyên văn",
                    "titleEn": "Verbatim Match Distractor",
                    "detailVi": "Học sinh chọn đáp án chứa từ y hệt trong bài đọc thay vì từ được paraphrase.",
                    "detailEn": "Student selects options copying exact words from text rather than paraphrase.",
                    "severity": "high"
                }
            ],
            "actionPlanVi": ["Học kỹ bảng paraphrase trong bài sửa"],
            "actionPlanEn": ["Study the paraphrase mapping matrix carefully"]
        })

        with patch.object(index, "_pedagogical_ai_call", return_value=(mock_ai_response, None)):
            res = asyncio.run(index.analyze_error_dna(req_payload))
            self.assertTrue(res.get("success"))
            self.assertEqual(res["categoryBreakdown"]["lexicalGap"], 50)
            self.assertEqual(len(res["recurringTraps"]), 1)
            self.assertEqual(res["recurringTraps"][0]["severity"], "high")

    def test_review_copilot_endpoint(self):
        req_payload = {
            "question": {
                "id": "q1",
                "question": "What is the main purpose of the study?",
                "options": ["A. To assess diet", "B. To track sleep", "C. To measure stress"],
                "correctAnswer": "B",
                "passage": "In the initial phase, researchers focused on tracking participants' sleep patterns over twelve weeks.",
                "transcript": "",
                "skill": "Reading"
            },
            "studentAnswer": "A",
            "chatHistory": [],
            "userMessage": "Tại sao em chọn A lại sai?"
        }

        mock_reply = "Em chọn A (diet) bị sai vì trong bài tác giả ghi rõ: \"tracking participants' sleep patterns\" chứ không hề đề cập đến chế độ ăn uống."

        with patch.object(index, "_pedagogical_ai_call", return_value=(mock_reply, None)):
            res = asyncio.run(index.review_copilot(req_payload))
            self.assertTrue(res.get("success"))
            self.assertIn("tracking participants' sleep patterns", res.get("reply", ""))

    def test_writing_sandbox_coach_brainstorm(self):
        req_payload = {
            "taskPrompt": "Some people think that universities should provide graduates with knowledge and skills needed in the workplace. Others think that the true function of a university should be to give access to knowledge for its own sake. Discuss both views and give your opinion.",
            "taskType": "Task 2",
            "mode": "brainstorm"
        }

        mock_coach_response = json.dumps({
            "perspectives": [
                {
                    "nameVi": "Góc nhìn Thực dụng & Kinh tế",
                    "nameEn": "Utilitarian / Economic Perspective",
                    "argumentVi": "Đào tạo nghề nghiệp giảm tỷ lệ thất nghiệp.",
                    "argumentEn": "Vocational readiness alleviates youth unemployment."
                }
            ],
            "collocations": [
                {
                    "phrase": "vocational readiness",
                    "meaningVi": "sự sẵn sàng cho công việc",
                    "usage": "boosts vocational readiness"
                }
            ]
        })

        with patch.object(index, "_pedagogical_ai_call", return_value=(mock_coach_response, None)):
            res = asyncio.run(index.writing_sandbox_coach(req_payload))
            self.assertTrue(res.get("success"))
            self.assertEqual(len(res["perspectives"]), 1)
            self.assertEqual(res["collocations"][0]["phrase"], "vocational readiness")

    def test_writing_sandbox_coach_critique_outline(self):
        req_payload = {
            "taskPrompt": "Some people think that universities should focus on vocational skills. Discuss both views.",
            "taskType": "Task 2",
            "mode": "critique_outline",
            "outlineText": "- Body 1: Vocational training helps get jobs.\n- Body 2: Pure academic knowledge fosters critical thinking."
        }

        mock_critique_response = json.dumps({
            "coverageRating": "Good",
            "coverageFeedbackVi": "Dàn ý đã bao quát cả 2 quan điểm.",
            "coverageFeedbackEn": "Outline covers both viewpoints well.",
            "progressionFeedbackVi": "Mạch lập luận rõ ràng, phát triển logic từ việc làm đến tư duy phản biện.",
            "progressionFeedbackEn": "Clear progression from employment to critical thinking.",
            "socraticQuestions": ["Làm thế nào để liên kết luận điểm tư duy phản biện với sự phát triển lâu dài của xã hội?"]
        })

        with patch.object(index, "_pedagogical_ai_call", return_value=(mock_critique_response, None)):
            res = asyncio.run(index.writing_sandbox_coach(req_payload))
            self.assertTrue(res.get("success"))
            self.assertEqual(res["coverageRating"], "Good")
            self.assertEqual(len(res["socraticQuestions"]), 1)

    def test_clean_option_text_helper(self):
        self.assertEqual(index._clean_option_text("A. used up resources"), "used up resources")
        self.assertEqual(index._clean_option_text("A. A. used up resources"), "used up resources")
        self.assertEqual(index._clean_option_text("(B) (B) higher tax"), "higher tax")
        self.assertEqual(index._clean_option_text("C: caused inflation"), "caused inflation")

    def test_ai_explain_deconstruction_sanitization(self):
        req_payload = {
            "question": "What caused the crisis?",
            "options": "A. used up resources | B. higher taxes | C. caused inflation",
            "correct": "C. caused inflation",
            "studentAnswer": "",  # Unanswered
            "context": "",
            "isListening": True,
            "lang": "en"  # Regardless of requested lang, system returns natural Vietnamese
        }

        mock_response = json.dumps({
            "paraphrasePairs": [],
            "evidence": {
                "location": "Lời thoại [01:23]",
                "quote": "The rapid expansion of the empire led directly to inflation."
            },
            "detailedExplanation": "Dẫn chứng khẳng định việc mở rộng quá nhanh trực tiếp gây ra lạm phát.",
            "trapAnalysis": {
                "trapTitle": "TRAP: No Audio Provided",
                "trapReason": "Học sinh bỏ trống câu này vì không có audio."
            }
        })

        with patch.object(index, "_groq_chat", return_value=(mock_response, None)):
            res = asyncio.run(index.ai_explain(req_payload))
            self.assertTrue(res.get("success"))
            dec = res.get("deconstruction")
            self.assertIsNotNone(dec)
            # 1. No audio trap sanitized into Vietnamese strategy title
            self.assertNotIn("No Audio", dec["trapType"])
            self.assertIn("từ khóa", dec["trapType"].lower())
            # 2. Blank student answer converted to Vietnamese signpost strategy
            self.assertIn("từ nối chuyển ý", dec["whyStudentWrong"])
            # 3. Evidence quote remains verbatim English
            self.assertEqual(res["structured"]["evidence"]["quote"], "The rapid expansion of the empire led directly to inflation.")
            # 4. Detailed explanation in natural Vietnamese
            self.assertIn("Dẫn chứng khẳng định", res["structured"]["detailedExplanation"])


if __name__ == "__main__":
    unittest.main()
