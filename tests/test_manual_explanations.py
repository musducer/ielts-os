import unittest
from unittest.mock import patch

import docx

from api.index import (
    _AI_KEY_CURSOR,
    _api_key_pool,
    _rotated_api_keys,
    extract_docx_manual_explanations,
    parse_docx_to_quiz,
    parse_manual_explanation_text,
)


class ManualExplanationTests(unittest.TestCase):
    def test_manual_explanation_parser_extracts_quotes_and_timestamps(self):
        parsed = parse_manual_explanation_text(
            'Because the speaker says "annual membership fee" at [02:15 - 02:20].'
        )

        self.assertEqual(parsed["rawText"], 'Because the speaker says "annual membership fee" at [02:15 - 02:20].')
        self.assertEqual(parsed["parsedQuotes"], ["annual membership fee"])
        self.assertEqual(parsed["parsedTimestamps"], [
            {"startTime": 135, "label": "02:15 - 02:20", "endTime": 140},
        ])

    def test_docx_parser_attaches_explanation_without_rendering_tag(self):
        document = docx.Document()
        document.add_paragraph("[TITLE] Manual Explanation Demo")
        document.add_paragraph("[TYPE] Listening")
        document.add_paragraph("[PASSAGE]")
        document.add_paragraph("The transcript contains the annual membership fee.")
        document.add_paragraph("[QUESTIONS]")
        document.add_paragraph("[BLANK]")
        document.add_paragraph("Question 1")
        document.add_paragraph("*annual membership fee")
        document.add_paragraph('[EXPLANATION] 1: The speaker says "annual membership fee" at [02:15].')

        quiz = parse_docx_to_quiz(document)
        question = quiz["questions"][0]

        self.assertNotIn("[EXPLANATION]", question["text"])
        self.assertEqual(question["manualExplanation"]["rawText"], 'The speaker says "annual membership fee" at [02:15].')
        self.assertEqual(question["manualExplanation"]["parsedQuotes"], ["annual membership fee"])
        self.assertEqual(question["manualExplanation"]["parsedTimestamps"], [
            {"startTime": 135, "label": "02:15"},
        ])

    def test_matching_answer_is_stored_as_text_not_letter_or_index(self):
        document = docx.Document()
        document.add_paragraph("[TITLE] Matching Demo")
        document.add_paragraph("[TYPE] Listening")
        document.add_paragraph("[PASSAGE]")
        document.add_paragraph("Transcript.")
        document.add_paragraph("[QUESTIONS]")
        document.add_paragraph("[MATCHING]")
        document.add_paragraph("A. Processing data she had gathered")
        document.add_paragraph("B. Working collaboratively")
        document.add_paragraph("Question 26 Observing lessons")
        document.add_paragraph("*A")

        quiz = parse_docx_to_quiz(document)
        question = quiz["questions"][0]

        self.assertEqual(question["type"], "MATCHING")
        self.assertEqual(question["options"], [
            "Processing data she had gathered",
            "Working collaboratively",
        ])
        self.assertEqual(question["correctAnswer"], "Processing data she had gathered")

    def test_explanation_only_docx_supports_multiline_entries(self):
        document = docx.Document()
        document.add_paragraph('[EXPLANATION] 26: The speaker says "processing data" at [12:04].')
        document.add_paragraph("[EXPLANATION] 27:")
        document.add_paragraph('The clue is "suitable equipment" at [12:10 - 12:13].')

        explanations = extract_docx_manual_explanations(document)

        self.assertEqual(explanations["26"]["parsedQuotes"], ["processing data"])
        self.assertEqual(explanations["27"]["rawText"], 'The clue is "suitable equipment" at [12:10 - 12:13].')
        self.assertEqual(explanations["27"]["parsedTimestamps"], [
            {"startTime": 730, "label": "12:10 - 12:13", "endTime": 733},
        ])

    def test_api_key_pool_supports_numbered_and_comma_separated_keys(self):
        with patch.dict("os.environ", {
            "GROQ_API_KEY": "g1",
            "GROQ_API_KEY_2": "g2",
            "GROQ_API_KEYS": "g3,g4",
        }, clear=False):
            keys = _api_key_pool("GROQ_API_KEY")

        self.assertEqual(keys[:4], ["g1", "g2", "g3", "g4"])

    def test_rotated_api_keys_distributes_starting_key(self):
        _AI_KEY_CURSOR.clear()

        self.assertEqual(_rotated_api_keys("test_provider", ["a", "b", "c"]), ["a", "b", "c"])
        self.assertEqual(_rotated_api_keys("test_provider", ["a", "b", "c"]), ["b", "c", "a"])
        self.assertEqual(_rotated_api_keys("test_provider", ["a", "b", "c"]), ["c", "a", "b"])

    def test_multi_paragraph_explanation_in_questions_block_preserves_breaks_and_does_not_leak(self):
        document = docx.Document()
        document.add_paragraph("[TITLE] Multi-paragraph Explanation Test")
        document.add_paragraph("[TYPE] Reading")
        document.add_paragraph("[PASSAGE]")
        document.add_paragraph("Solar panels harness renewable energy.")
        document.add_paragraph("[QUESTIONS]")
        document.add_paragraph("[BLANK]")
        document.add_paragraph("Question 1")
        document.add_paragraph("*renewable")
        document.add_paragraph('[EXPLANATION] 1: Paragraph 1 explains that the author refers to "renewable energy".')
        document.add_paragraph("Paragraph 2 provides further analysis of why fossil fuels are excluded.")
        document.add_paragraph("Paragraph 3 gives pedagogical advice for IELTS candidates.")
        document.add_paragraph("Question 2")
        document.add_paragraph("*efficiency")

        quiz = parse_docx_to_quiz(document)
        self.assertEqual(len(quiz["questions"]), 2)
        q1 = quiz["questions"][0]
        q2 = quiz["questions"][1]

        self.assertNotIn("Paragraph 2", q1["text"])
        self.assertNotIn("Paragraph 3", q1["text"])
        self.assertIn("Paragraph 1", q1["manualExplanation"]["rawText"])
        self.assertIn("Paragraph 2", q1["manualExplanation"]["rawText"])
        self.assertIn("Paragraph 3", q1["manualExplanation"]["rawText"])
        self.assertIn("\n\nParagraph 2", q1["manualExplanation"]["rawText"])
        self.assertIn("\n\nParagraph 3", q1["manualExplanation"]["rawText"])
        self.assertEqual(q1["manualExplanation"]["parsedQuotes"], ["renewable energy"])

        self.assertEqual(q2["questionNumber"], 2)
        self.assertNotIn("Paragraph 3", q2["text"])

    def test_multi_paragraph_explanation_in_supplement_docx_preserves_breaks(self):
        document = docx.Document()
        document.add_paragraph('[EXPLANATION] 15: First paragraph with quote "cooling tower".')
        document.add_paragraph("Second paragraph explaining the mechanism in detail.")
        document.add_paragraph('[EXPLANATION] 16: Explanation for next question.')

        explanations = extract_docx_manual_explanations(document)
        self.assertIn("15", explanations)
        self.assertIn("First paragraph", explanations["15"]["rawText"])
        self.assertIn("\n\nSecond paragraph", explanations["15"]["rawText"])
        self.assertEqual(explanations["15"]["parsedQuotes"], ["cooling tower"])

    def test_external_diagram_drag_drop_with_image_and_options(self):
        document = docx.Document()
        document.add_paragraph("[TITLE] External Diagram Drag Drop Test")
        document.add_paragraph("[TYPE] Listening")
        document.add_paragraph("[PASSAGE]")
        document.add_paragraph("Listen to the tour guide.")
        document.add_paragraph("[QUESTIONS]")
        document.add_paragraph("[DRAG]")
        document.add_paragraph("IMAGE: https://cdn.example.com/diagrams/education_house.png")
        document.add_paragraph("OPTIONS:")
        document.add_paragraph("A. fresh air is removed")
        document.add_paragraph("B. fresh air is pulled in")
        document.add_paragraph("C. heat loss is reduced")
        document.add_paragraph("F. old air is removed")
        document.add_paragraph("21. Cooling Tower")
        document.add_paragraph("*F. old air is removed")
        document.add_paragraph("22. Weather Station")
        document.add_paragraph("*B")

        quiz = parse_docx_to_quiz(document)
        self.assertEqual(len(quiz["questions"]), 2)
        q21 = quiz["questions"][0]
        q22 = quiz["questions"][1]

        self.assertEqual(q21["groupImageUrl"], "https://cdn.example.com/diagrams/education_house.png")
        self.assertEqual(q22["groupImageUrl"], "https://cdn.example.com/diagrams/education_house.png")
        self.assertIn("[21]", q21["text"])
        self.assertIn("[22]", q22["text"])
        self.assertEqual(q21["correctAnswer"], "F. old air is removed")
        self.assertEqual(q22["correctAnswer"], "B. fresh air is pulled in")

    def test_diagram_label_without_boxes_falls_back_to_external_split(self):
        document = docx.Document()
        document.add_paragraph("[TITLE] Diagram Fallback Test")
        document.add_paragraph("[TYPE] Reading")
        document.add_paragraph("[PASSAGE]")
        document.add_paragraph("Solar energy diagram description.")
        document.add_paragraph("[QUESTIONS]")
        document.add_paragraph("[DIAGRAM_LABEL]")
        document.add_paragraph("IMAGE: https://cdn.example.com/diagrams/solar.png")
        document.add_paragraph("OPTIONS:")
        document.add_paragraph("A. inverter")
        document.add_paragraph("B. battery")
        document.add_paragraph("21. Main panel")
        document.add_paragraph("*A")

        quiz = parse_docx_to_quiz(document)
        self.assertEqual(len(quiz["questions"]), 1)
        q = quiz["questions"][0]
        self.assertEqual(q["groupImageUrl"], "https://cdn.example.com/diagrams/solar.png")
        self.assertEqual(q["type"], "DRAG_DROP")
        self.assertEqual(q["correctAnswer"], "A. inverter")


if __name__ == "__main__":
    unittest.main()
