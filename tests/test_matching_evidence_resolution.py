import asyncio
import json
import unittest
from unittest.mock import patch
from api import index


class TestMatchingEvidenceResolution(unittest.TestCase):
    def test_parse_paragraph_label(self):
        self.assertEqual(index._parse_paragraph_label("F"), "F")
        self.assertEqual(index._parse_paragraph_label("Paragraph F"), "F")
        self.assertEqual(index._parse_paragraph_label("section f"), "F")
        self.assertEqual(index._parse_paragraph_label("Đoạn F"), "F")
        self.assertEqual(index._parse_paragraph_label("F."), "F")
        self.assertEqual(index._parse_paragraph_label("F: Detail"), "F")
        self.assertEqual(index._parse_paragraph_label("5", ["A", "B", "C", "D", "E", "F"]), "F")
        self.assertEqual(index._parse_paragraph_label(5), "F")
        self.assertEqual(index._parse_paragraph_label("B"), "B")
        self.assertEqual(index._parse_paragraph_label(""), "")

    def test_split_passage_into_labeled_paragraphs_html(self):
        html = """
        <p><strong>A</strong> Early educational experiments explored class sizes in primary schools.</p>
        <p><strong>B</strong> Teacher development programs were evaluated alongside curriculum revisions.</p>
        <p><strong>C</strong> Project STAR involved randomly assigned students to various class sizes across Tennessee.</p>
        <p><strong>D</strong> State funding constraints prevented nationwide scaling in subsequent years.</p>
        <p><strong>E</strong> Methodologists reviewed control group conditions.</p>
        <p><strong>F</strong> A comprehensive comparison of the data from class-reduction projects showed positive long-term academic effects.</p>
        """
        paras = index.split_passage_into_labeled_paragraphs(html)
        self.assertEqual(sorted(paras.keys()), ["A", "B", "C", "D", "E", "F"])
        self.assertIn("Project STAR", paras["C"])
        self.assertIn("comparison of the data", paras["F"])

    def test_matching_information_evidence_bound_to_correct_paragraph(self):
        """Regression test:
        Question: 'a comparison of the data from class-reduction projects'
        studentAnswer = B
        correctAnswer = F
        Even if Paragraph C contains strong lexical overlap:
        'class sizes', 'randomly assigned', 'Project STAR'
        AI evidence must never resolve to C.
        Expected:
        correct target paragraph = F
        evidence location = Đoạn F
        quote belongs to F
        student B may be discussed only as the wrong-choice context.
        """
        passage_html = """
        <p><strong>A</strong> Historical context of elementary education in the late twentieth century.</p>
        <p><strong>B</strong> Professional development workshops for instructors were introduced in suburban districts.</p>
        <p><strong>C</strong> Project STAR involved randomly assigned students to various class sizes across primary schools in Tennessee.</p>
        <p><strong>D</strong> Economic analyses questioned whether teacher salaries justified the administrative expenditure.</p>
        <p><strong>E</strong> Survey responses from parents revealed general satisfaction with public schooling.</p>
        <p><strong>F</strong> A comprehensive comparison of the data from class-reduction projects showed positive long-term academic effects.</p>
        """

        req_payload = {
            "question": "a comparison of the data from class-reduction projects",
            "options": "A | B | C | D | E | F",
            "correct": "F",
            "studentAnswer": "B",
            "readingPassage": passage_html,
            "questionType": "R_MATCHING_INFO",
            "matchingKind": "paragraph_information",
            "lang": "vi"
        }

        # Subtest 1: Verify model prompt receives ONLY Paragraph F as primary target paragraph,
        # and Paragraph B as wrongChoiceContext; Paragraph C is NOT in the prompt!
        recorded_calls = []

        def mock_groq(sys_prompt, user_prompt, **kwargs):
            recorded_calls.append((sys_prompt, user_prompt))
            mock_resp = json.dumps({
                "paraphrasePairs": [
                    {"questionTerm": "class-reduction projects", "passageTerm": "class-reduction projects", "note": ""}
                ],
                "evidence": {
                    "location": "Đoạn F",
                    "quote": "A comprehensive comparison of the data from class-reduction projects showed positive long-term academic effects."
                },
                "detailedExplanation": "Đoạn F đưa ra sự đối chiếu số liệu từ nhiều dự án giảm sĩ số lớp học chứng minh đáp án F hoàn toàn chính xác.",
                "trapAnalysis": {
                    "trapTitle": "Bẫy từ khóa gây nhiễu",
                    "trapReason": "Học viên chọn Đoạn B chỉ nói về bồi dưỡng giáo viên chứ không đối chiếu dữ liệu."
                }
            })
            return (mock_resp, None)

        with patch.object(index, "_groq_chat", side_effect=mock_groq):
            res = asyncio.run(index.ai_explain(req_payload))

        self.assertTrue(res.get("success"))
        # Verify prompt construction
        self.assertTrue(len(recorded_calls) > 0)
        sys_p, user_p = recorded_calls[0]
        # Paragraph F is the primary target in user_prompt
        self.assertIn("ĐOẠN MỤC TIÊU ĐÁP ÁN ĐÚNG (ĐOẠN F)", user_p)
        self.assertIn("A comprehensive comparison of the data", user_p)
        # Paragraph B is provided as wrong choice context
        self.assertIn("ĐOẠN HỌC VIÊN CHỌN SAI (ĐOẠN B", user_p)
        # Paragraph C must NOT be in user_prompt!
        self.assertNotIn("Project STAR", user_p)

        # Verify structured evidence
        ev = res["structured"]["evidence"]
        self.assertEqual(ev.get("paragraph"), "F")
        self.assertEqual(ev.get("location"), "Đoạn F")
        self.assertIn("comparison of the data", ev.get("quote", ""))
        self.assertNotIn("Project STAR", ev.get("quote", ""))

    def test_matching_information_rejects_hallucinated_wrong_paragraph_quote(self):
        """Adversarial test: Even if LLM returns a quote from Paragraph C,
        the backend verification rejects it and forces quote resolution within Paragraph F.
        """
        passage_html = """
        <p><strong>A</strong> Intro paragraph.</p>
        <p><strong>B</strong> Teacher development.</p>
        <p><strong>C</strong> Project STAR involved randomly assigned students to various class sizes across primary schools in Tennessee.</p>
        <p><strong>D</strong> Financial costs.</p>
        <p><strong>E</strong> Parent feedback.</p>
        <p><strong>F</strong> A comprehensive comparison of the data from class-reduction projects showed positive long-term academic effects.</p>
        """

        req_payload = {
            "question": "a comparison of the data from class-reduction projects",
            "options": "A | B | C | D | E | F",
            "correct": "F",
            "studentAnswer": "B",
            "readingPassage": passage_html,
            "questionType": "R_MATCHING_INFO",
            "matchingKind": "paragraph_information",
            "lang": "vi"
        }

        # Model maliciously tries to return quote from Paragraph C
        hallucinated_resp = json.dumps({
            "paraphrasePairs": [],
            "evidence": {
                "location": "Đoạn C",
                "quote": "Project STAR involved randomly assigned students to various class sizes across primary schools in Tennessee."
            },
            "detailedExplanation": "Giải thích chi tiết.",
            "trapAnalysis": {
                "trapTitle": "Bẫy từ khóa",
                "trapReason": "Lý do sai."
            }
        })

        with patch.object(index, "_groq_chat", return_value=(hallucinated_resp, None)):
            res = asyncio.run(index.ai_explain(req_payload))

        self.assertTrue(res.get("success"))
        ev = res["structured"]["evidence"]
        # Location and paragraph must be F, NEVER C!
        self.assertEqual(ev.get("paragraph"), "F")
        self.assertEqual(ev.get("location"), "Đoạn F")
        # Quote must NOT contain Project STAR from Paragraph C!
        self.assertNotIn("Project STAR", ev.get("quote", ""))
        # Quote must come from Paragraph F
        self.assertIn("comparison of the data", ev.get("quote", ""))

    def test_matching_information_lexical_overlap_distractor_regression(self):
        """Second Matching Information test:
        Question: 'the unexpected correlation between sleep stages and memory consolidation'
        studentAnswer = A
        correctAnswer = D
        Paragraph B has literal keywords 'sleep stages' and 'memory consolidation',
        but Paragraph D is the authoritative answer.
        AI evidence must never resolve to B.
        """
        passage_html = """
        <p><strong>A</strong> General theories on biological rest cycles.</p>
        <p><strong>B</strong> Rapid eye movement sleep stages play an essential role in memory consolidation during nocturnal cycles.</p>
        <p><strong>C</strong> Neurological scanning methods have advanced significantly.</p>
        <p><strong>D</strong> Researchers uncovered an unexpected correlation linking distinct cognitive rest intervals to long-term memory formation.</p>
        """

        req_payload = {
            "question": "the unexpected correlation between sleep stages and memory consolidation",
            "options": "A | B | C | D",
            "correct": "D",
            "studentAnswer": "A",
            "readingPassage": passage_html,
            "questionType": "R_MATCHING_INFO",
            "matchingKind": "paragraph_information",
            "lang": "vi"
        }

        mock_resp = json.dumps({
            "paraphrasePairs": [],
            "evidence": {
                "location": "Đoạn D",
                "quote": "Researchers uncovered an unexpected correlation linking distinct cognitive rest intervals to long-term memory formation."
            },
            "detailedExplanation": "Đoạn D chỉ ra mối liên hệ bất ngờ giữa các khoảng nghỉ và trí nhớ dài hạn.",
            "trapAnalysis": {
                "trapTitle": "Bẫy tổng quát",
                "trapReason": "Đoạn A chỉ giới thiệu lý thuyết chung."
            }
        })

        with patch.object(index, "_groq_chat", return_value=(mock_resp, None)):
            res = asyncio.run(index.ai_explain(req_payload))

        self.assertTrue(res.get("success"))
        ev = res["structured"]["evidence"]
        self.assertEqual(ev.get("paragraph"), "D")
        self.assertEqual(ev.get("location"), "Đoạn D")
        self.assertIn("unexpected correlation", ev.get("quote", ""))
        self.assertNotIn("Rapid eye movement", ev.get("quote", ""))


if __name__ == "__main__":
    unittest.main()
