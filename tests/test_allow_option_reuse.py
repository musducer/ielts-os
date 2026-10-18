import unittest
import docx
from api.index import process_block


class TestAllowOptionReuse(unittest.TestCase):
    def test_reuse_tag_enables_allow_option_reuse(self):
        doc = docx.Document()
        lines = [
            doc.add_paragraph("[DRAG]"),
            doc.add_paragraph("[REUSE_OPTIONS]"),
            doc.add_paragraph("Which category describes each DVD?"),
            doc.add_paragraph("OPTIONS:"),
            doc.add_paragraph("A. Current"),
            doc.add_paragraph("B. Out of date"),
            doc.add_paragraph("C. Planned"),
            doc.add_paragraph("21. DVD One"),
            doc.add_paragraph("*A"),
            doc.add_paragraph("22. DVD Two"),
            doc.add_paragraph("*A"),
        ]

        target_questions = []
        process_block("DRAG", lines, target_questions)
        self.assertEqual(len(target_questions), 2)
        for q in target_questions:
            self.assertTrue(q.get("allowOptionReuse"), f"Expected allowOptionReuse to be True on {q}")

    def test_instruction_phrase_enables_allow_option_reuse(self):
        doc = docx.Document()
        lines = [
            doc.add_paragraph("[DRAG]"),
            doc.add_paragraph("You may use any letter more than once."),
            doc.add_paragraph("OPTIONS:"),
            doc.add_paragraph("A. Current"),
            doc.add_paragraph("B. Out of date"),
            doc.add_paragraph("21. DVD One"),
            doc.add_paragraph("*A"),
        ]

        target_questions = []
        process_block("DRAG", lines, target_questions)
        self.assertEqual(len(target_questions), 1)
        self.assertTrue(target_questions[0].get("allowOptionReuse"))

    def test_duplicate_answers_enable_allow_option_reuse(self):
        doc = docx.Document()
        lines = [
            doc.add_paragraph("[MATCHING]"),
            doc.add_paragraph("Match the DVD to its category."),
            doc.add_paragraph("OPTIONS:"),
            doc.add_paragraph("A. Current"),
            doc.add_paragraph("B. Out of date"),
            doc.add_paragraph("C. Planned"),
            doc.add_paragraph("21. DVD One"),
            doc.add_paragraph("*Current"),
            doc.add_paragraph("22. DVD Two"),
            doc.add_paragraph("*Current"),
        ]

        target_questions = []
        process_block("MATCHING", lines, target_questions)
        self.assertEqual(len(target_questions), 2)
        for q in target_questions:
            self.assertTrue(q.get("allowOptionReuse"))


if __name__ == '__main__':
    unittest.main()
