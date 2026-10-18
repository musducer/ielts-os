import copy
import unittest

from exam_generator.normalization import normalize_provider_exam
from exam_generator.schema import CanonicalExam, CanonicalSchemaError


def reading_payload():
    return {
        "title": "Source exam",
        "exam_type": "Reading",
        "time_limit": 20,
        "sections": [{
            "passage": ["The sample preserves its original content."],
            "questions": [{
                "question_number": 1,
                "block_type": "BLANK",
                "text": "The sample preserves its original ___.",
                "instruction": ["Write ONE WORD ONLY."],
                "context": [],
                "flow_lines": [],
                "correct_answers": ["content"],
            }],
        }],
    }


class ProviderExamNormalizationTests(unittest.TestCase):
    def test_single_text_paragraphs_at_supported_reading_paths(self):
        payload = reading_payload()
        section = payload["sections"][0]
        section["passage"] = "First line.\nSecond line."
        question = section["questions"][0]
        for field in ("instruction", "context", "flow_lines"):
            question[field] = f"Exact {field} text."

        normalized = normalize_provider_exam(payload)
        exam = CanonicalExam.from_dict(normalized)

        self.assertEqual(exam.sections[0].passage[0].text, "First line.\nSecond line.")
        for field in ("instruction", "context", "flow_lines"):
            self.assertEqual(getattr(exam.sections[0].questions[0], field)[0].text, f"Exact {field} text.")

    def test_single_rich_paragraph_retains_runs_and_alignment(self):
        rich = {
            "runs": [
                {"text": "Bold ", "bold": True},
                {"text": "italic ", "italic": True},
                {"text": "underlined", "underline": True},
            ],
            "alignment": "center",
            "list_item": True,
        }
        for field in ("passage", "instruction", "context", "flow_lines"):
            with self.subTest(field=field):
                payload = reading_payload()
                section = payload["sections"][0]
                target = section if field == "passage" else section["questions"][0]
                target[field] = copy.deepcopy(rich)
                normalized = normalize_provider_exam(payload)
                updated_section = normalized["sections"][0]
                updated_target = updated_section if field == "passage" else updated_section["questions"][0]
                self.assertEqual(updated_target[field], [rich])
                exam = CanonicalExam.from_dict(normalized)
                parsed_target = exam.sections[0] if field == "passage" else exam.sections[0].questions[0]
                paragraph = getattr(parsed_target, field)[0]
                self.assertEqual(paragraph.text, "Bold italic underlined")
                self.assertEqual(paragraph.alignment, "center")
                self.assertTrue(paragraph.list_item)
                self.assertTrue(paragraph.runs[0].bold)
                self.assertTrue(paragraph.runs[1].italic)
                self.assertTrue(paragraph.runs[2].underline)

    def test_writing_prompts_wrap_without_changing_instruction_string(self):
        rich = {"text": "Discuss this statement.", "italic": True, "alignment": "left"}
        payload = {
            "title": "Writing", "exam_type": "Writing", "time_limit": 60,
            "writing_tasks": [
                {"task_number": 1, "prompt": "Describe the chart.", "instructions": "At least 150 words."},
                {"task_number": 2, "prompt": rich, "instructions": "At least 250 words."},
            ],
        }
        normalized = normalize_provider_exam(payload)
        exam = CanonicalExam.from_dict(normalized)
        self.assertEqual(normalized["writing_tasks"][1]["prompt"], [rich])
        self.assertEqual(exam.writing_tasks[0].prompt[0].text, "Describe the chart.")
        self.assertEqual(exam.writing_tasks[0].instructions, "At least 150 words.")
        self.assertTrue(exam.writing_tasks[1].prompt[0].runs[0].italic)

    def test_normalization_is_detached_and_idempotent(self):
        payload = reading_payload()
        payload["sections"][0]["questions"][0]["instruction"] = {"text": "Instruction", "bold": True}
        original = copy.deepcopy(payload)
        normalized = normalize_provider_exam(payload)
        self.assertEqual(payload, original)
        self.assertEqual(normalize_provider_exam(normalized), normalized)
        normalized["sections"][0]["passage"].append("New paragraph")
        normalized["sections"][0]["questions"][0]["instruction"][0]["text"] = "Changed"
        self.assertEqual(payload, original)

    def test_invalid_paragraph_shapes_and_unknown_fields_remain_rejected(self):
        for invalid in (17, True, ("tuple",), {"text": "Text", "invented_style": "large"}, {"runs": "not a list"}):
            with self.subTest(value=invalid):
                payload = reading_payload()
                payload["sections"][0]["questions"][0]["instruction"] = invalid
                with self.assertRaises(CanonicalSchemaError):
                    CanonicalExam.from_dict(normalize_provider_exam(payload))

    def test_options_and_answers_are_not_coerced(self):
        for field in ("options", "correct_answers"):
            with self.subTest(field=field):
                payload = reading_payload()
                payload["sections"][0]["questions"][0][field] = "Single value"
                normalized = normalize_provider_exam(payload)
                self.assertEqual(normalized["sections"][0]["questions"][0][field], "Single value")
                with self.assertRaises(CanonicalSchemaError):
                    CanonicalExam.from_dict(normalized)

    def test_invalid_containers_and_unknown_root_fields_remain_rejected(self):
        cases = [[], "not an exam", {**reading_payload(), "sections": {"passage": "Text"}},
                 {**reading_payload(), "unexpected": {"prompt": "Text"}}]
        for payload in cases:
            with self.subTest(value=payload):
                self.assertEqual(normalize_provider_exam(payload), payload)
                with self.assertRaises(CanonicalSchemaError):
                    CanonicalExam.from_dict(normalize_provider_exam(payload))

    def test_absent_null_and_existing_list_values_are_unchanged(self):
        payload = reading_payload()
        question = payload["sections"][0]["questions"][0]
        del question["instruction"]
        question["context"] = None
        self.assertEqual(normalize_provider_exam(payload), payload)
        CanonicalExam.from_dict(normalize_provider_exam(payload))


if __name__ == "__main__":
    unittest.main()
