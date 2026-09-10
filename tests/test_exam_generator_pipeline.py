import json
import base64
import tempfile
import threading
import time
import unittest
from pathlib import Path

import docx

from exam_generator.docx_renderer import render_docx
from exam_generator.pipeline import GENERATOR_SYSTEM, ExamGenerationPipeline, PipelineConfig
from exam_generator.providers import ProviderError, StaticProvider, TextProvider
from exam_generator.roundtrip import verify_docx_roundtrip
from exam_generator.schema import CanonicalExam, assign_stable_identifiers, validate_canonical_exam
from exam_generator.grounding import source_hash
from exam_generator.media import InternalMediaStore, extract_docx_media, resolve_media_bindings, verify_embedded_media_roundtrip


def reading_payload():
    return {
        "title": "Rich format contract",
        "exam_type": "Reading",
        "time_limit": 60,
        "sections": [{
            "label": "Passage 1",
            "passage": [
                {"runs": [{"text": "Italic source lead", "italic": True}], "alignment": "left"},
                {"runs": [{"text": "Centered bold heading", "bold": True}], "alignment": "center"},
            ],
            "questions": [
                {
                    "question_number": 1,
                    "block_type": "CHOICE",
                    "text": {"runs": [{"text": "Which statement is correct?", "bold": True}]},
                    "instruction": ["Choose the correct answer."],
                    "options": ["first answer", {"runs": [{"text": "second answer", "italic": True}]}],
                    "correct_answers": ["second answer"],
                    "explanation": {
                        "why": "The passage explicitly identifies the second answer, so the other option contradicts the source wording.",
                        "evidence": {"quote": "Centered bold heading", "source": "passage"},
                        "paraphrase_mapping": "centered heading -> second answer",
                        "correct_reason": "The source wording directly identifies the required second answer.",
                        "distractor_reasons": {"first answer": "The first answer is not named by the evidence."},
                        "student_takeaway": "Match the exact source claim before choosing an option.",
                    },
                },
                {
                    "question_number": 2,
                    "block_type": "BLANK",
                    "text": "Complete the phrase.",
                    "instruction": ["Write ONE WORD ONLY."],
                    "correct_answers": ["heading"],
                    "explanation": {
                        "why": "The supplied phrase contains the required word in the unique sentence that defines the completion.",
                        "evidence": {"quote": "Italic source lead", "source": "passage"},
                        "paraphrase_mapping": "source lead -> required completion",
                        "correct_reason": "The unique source phrase gives the completion word directly.",
                        "student_takeaway": "Use the exact wording around a completion gap to check spelling.",
                    },
                },
            ],
        }],
        "writing_tasks": [],
    }


class ExamGeneratorPipelineTests(unittest.TestCase):
    def test_canonical_schema_and_index_roundtrip(self):
        exam = CanonicalExam.from_dict(reading_payload())
        assign_stable_identifiers(exam, source_hash("Italic source lead Centered bold heading"))
        first_option = exam.sections[0].questions[0].options[0]
        exam.sections[0].questions[0].explanation.distractor_reasons = {
            first_option.id: "The first answer is not named by the evidence."
        }
        self.assertEqual(validate_canonical_exam(exam), [])
        with tempfile.TemporaryDirectory() as directory:
            output = render_docx(exam, Path(directory) / "reading.docx")
            result = verify_docx_roundtrip(exam, output)

            self.assertEqual(result.quiz["questions"][0]["correctAnswer"], 1)
            self.assertEqual(result.quiz["questions"][1]["correctAnswer"], "heading")

    def test_renderer_preserves_run_styles_and_alignment(self):
        exam = CanonicalExam.from_dict(reading_payload())
        with tempfile.TemporaryDirectory() as directory:
            output = render_docx(exam, Path(directory) / "style.docx")
            document = docx.Document(output)
            italic = next(paragraph for paragraph in document.paragraphs if paragraph.text == "Italic source lead")
            centered = next(paragraph for paragraph in document.paragraphs if paragraph.text == "Centered bold heading")
            choice = next(paragraph for paragraph in document.paragraphs if paragraph.text == "1. Which statement is correct?")

            self.assertTrue(italic.runs[0].italic)
            self.assertEqual(centered.alignment, 1)
            self.assertTrue(centered.runs[0].bold)
            self.assertTrue(choice.runs[-1].bold)

    def test_pipeline_caches_only_parser_verified_result(self):
        with tempfile.TemporaryDirectory() as directory:
            provider = StaticProvider({"generate": reading_payload(), "critic": {"issues": []}})
            pipeline = ExamGenerationPipeline(provider, PipelineConfig(state_dir=Path(directory), max_repairs=0, question_workers=0))
            source = "Italic source lead. Centered bold heading."
            first = pipeline.generate(source, {"exam_type": "Reading"})
            second = pipeline.generate(source, {"exam_type": "Reading"})

            self.assertEqual(first.status, "READY_FOR_REVIEW")
            self.assertFalse(first.cached)
            self.assertEqual(second.status, "READY_FOR_REVIEW")
            self.assertTrue(second.cached)
            self.assertEqual(len(provider.calls), 2)  # generate + critic; cache performs no model calls.

    def test_provider_timeout_is_failed_not_reported_as_parser_contract(self):
        class TimeoutProvider(TextProvider):
            def complete(self, **_kwargs):
                raise ProviderError("Provider request timed out.")

        with tempfile.TemporaryDirectory() as directory:
            pipeline = ExamGenerationPipeline(TimeoutProvider(), PipelineConfig(
                state_dir=Path(directory), max_repairs=0, question_workers=0,
                provider_attempts=1, provider_timeout_seconds=60,
            ))
            result = pipeline.generate("A short reading source.", {"exam_type": "Reading"})

        self.assertEqual(result.status, "FAILED")
        self.assertEqual(result.validation_state, "FAIL")
        self.assertEqual(result.round_trip_state, "NOT_RUN")
        self.assertIn("timed out", result.error.casefold())
        self.assertEqual(result.issues[0]["code"], "GENERATION_TIMEOUT")

    def test_pipeline_retries_malformed_canonical_json_inside_provider_boundary(self):
        class SequenceProvider(TextProvider):
            def __init__(self):
                self.generate_calls = 0

            def complete(self, **kwargs):
                phase = kwargs.get("phase")
                if phase == "generate":
                    self.generate_calls += 1
                    return '{"title":' if self.generate_calls == 1 else json.dumps(reading_payload())
                if phase == "critic":
                    return '{"issues": []}'
                raise AssertionError(phase)

        with tempfile.TemporaryDirectory() as directory:
            provider = SequenceProvider()
            pipeline = ExamGenerationPipeline(provider, PipelineConfig(
                state_dir=Path(directory), max_repairs=0, question_workers=0,
                provider_attempts=2, provider_timeout_seconds=60,
            ))
            result = pipeline.generate("Italic source lead. Centered bold heading.", {"exam_type": "Reading"})

        self.assertEqual(result.status, "READY_FOR_REVIEW")
        self.assertEqual(result.validation_state, "PASS")
        self.assertEqual(result.round_trip_state, "PASS")
        self.assertEqual(provider.generate_calls, 2)

    def test_terminal_malformed_json_keeps_private_response_diagnostic(self):
        class AlwaysMalformedProvider(TextProvider):
            def __init__(self):
                self.generate_calls = 0

            def complete(self, **kwargs):
                if kwargs.get("phase") == "generate":
                    self.generate_calls += 1
                    return '{"title":'
                raise AssertionError(kwargs.get("phase"))

        with tempfile.TemporaryDirectory() as directory:
            provider = AlwaysMalformedProvider()
            pipeline = ExamGenerationPipeline(provider, PipelineConfig(
                state_dir=Path(directory), max_repairs=0, question_workers=0,
                provider_attempts=2, provider_timeout_seconds=60,
            ))
            result = pipeline.generate("A short reading source.", {"exam_type": "Reading"})

        self.assertEqual(provider.generate_calls, 2)
        self.assertEqual(result.status, "FAILED")
        self.assertEqual(result.round_trip_state, "NOT_RUN")
        self.assertEqual(result.provider_response_debug, '{"title":')
        self.assertFalse(result.output_path)

    def test_pipeline_does_not_retry_strict_canonical_schema_failure(self):
        class InvalidSchemaProvider(TextProvider):
            def __init__(self):
                self.generate_calls = 0

            def complete(self, **kwargs):
                if kwargs.get("phase") == "generate":
                    self.generate_calls += 1
                    payload = reading_payload()
                    payload["unexpected"] = "must fail closed"
                    return json.dumps(payload)
                raise AssertionError(kwargs.get("phase"))

        with tempfile.TemporaryDirectory() as directory:
            provider = InvalidSchemaProvider()
            pipeline = ExamGenerationPipeline(provider, PipelineConfig(
                state_dir=Path(directory), max_repairs=0, question_workers=0,
                provider_attempts=2, provider_timeout_seconds=60,
            ))
            result = pipeline.generate("Italic source lead. Centered bold heading.", {"exam_type": "Reading"})

        self.assertEqual(provider.generate_calls, 1)
        self.assertEqual(result.status, "FAILED")
        self.assertEqual(result.validation_state, "FAIL")
        self.assertEqual(result.round_trip_state, "NOT_RUN")
        self.assertFalse(result.output_path)
        self.assertEqual(result.issues[0]["code"], "GENERATION")

    def test_structure_generation_defers_answers_to_the_grounded_solver_stage(self):
        class StructureThenSolverProvider(TextProvider):
            def __init__(self):
                self.generate_user = ""

            def complete(self, **kwargs):
                phase = kwargs.get("phase")
                if phase == "generate":
                    self.generate_user = str(kwargs.get("user") or "")
                    payload = reading_payload()
                    for question in payload["sections"][0]["questions"]:
                        question["correct_answers"] = []
                        question.pop("explanation", None)
                    return json.dumps(payload)
                if phase == "question":
                    question = json.loads(kwargs["user"].split("<QUESTION>", 1)[1].split("</QUESTION>", 1)[0])
                    source_question = reading_payload()["sections"][0]["questions"][question["question_number"] - 1]
                    return json.dumps({
                        "question_number": question["question_number"],
                        "correct_answers": source_question["correct_answers"],
                        "explanation": source_question["explanation"],
                    })
                if phase == "critic":
                    return '{"issues": []}'
                raise AssertionError(phase)

        with tempfile.TemporaryDirectory() as directory:
            provider = StructureThenSolverProvider()
            pipeline = ExamGenerationPipeline(provider, PipelineConfig(
                state_dir=Path(directory), max_repairs=0, question_workers=1,
                provider_attempts=1, provider_timeout_seconds=60,
            ))
            result = pipeline.generate("Italic source lead. Centered bold heading.", {"exam_type": "Reading"})

        self.assertIn("set correct_answers to []", provider.generate_user)
        self.assertIn("correct_answers to []", GENERATOR_SYSTEM)
        self.assertIn("must omit explanation", GENERATOR_SYSTEM)
        self.assertEqual(result.status, "READY_FOR_REVIEW")
        self.assertEqual(result.solved_count, 2)
        self.assertEqual(result.explanation_count, 2)

    def test_raw_docx_batch_keeps_order_and_uses_bounded_question_workers(self):
        class ConcurrentProvider(TextProvider):
            def __init__(self):
                self.lock = threading.Lock()
                self.active = 0
                self.peak = 0

            def complete(self, **kwargs):
                phase = kwargs.get("phase")
                if phase == "generate":
                    return json.dumps(reading_payload())
                if phase == "critic":
                    return '{"issues": []}'
                if phase == "question":
                    question = json.loads(kwargs["user"].split("<QUESTION>", 1)[1].split("</QUESTION>", 1)[0])
                    number = question["question_number"]
                    with self.lock:
                        self.active += 1
                        self.peak = max(self.peak, self.active)
                    time.sleep(0.03)
                    with self.lock:
                        self.active -= 1
                    payload = reading_payload()["sections"][0]["questions"][number - 1]
                    return json.dumps({
                        "question_number": number,
                        "correct_answers": payload["correct_answers"],
                        "explanation": payload["explanation"],
                    })
                raise AssertionError(phase)

        with tempfile.TemporaryDirectory() as directory:
            paths = []
            for name in ("first.docx", "second.docx"):
                document = docx.Document()
                document.add_paragraph("[TYPE] Reading")
                document.add_paragraph("Italic source lead. Centered bold heading.")
                path = Path(directory) / name
                document.save(path)
                paths.append(str(path))
            provider = ConcurrentProvider()
            pipeline = ExamGenerationPipeline(provider, PipelineConfig(
                state_dir=Path(directory) / "state", max_workers=2, question_workers=2, max_repairs=0,
            ))
            results = pipeline.transform_raw_docx_batch(paths)

            self.assertEqual([result.original_filename for result in results], ["first.docx", "second.docx"])
            self.assertTrue(all(result.status == "READY_FOR_REVIEW" for result in results))
            self.assertTrue(all(result.question_count == 2 for result in results))
            self.assertTrue(all(result.solved_count == 2 for result in results))
            self.assertLessEqual(provider.peak, 4)  # 2 files × at most 2 question workers each
            self.assertGreaterEqual(provider.peak, 2)


    def test_embedded_media_is_bound_reembedded_and_parser_verified(self):
        tiny_png = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9ZQAAAABJRU5ErkJggg=="
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            image = root / "chart.png"
            image.write_bytes(tiny_png)
            raw = root / "raw.docx"
            source = docx.Document()
            source.add_paragraph("[TYPE] Writing")
            source.add_picture(str(image))
            source.save(raw)
            media_store = InternalMediaStore(root / "media")
            extraction = extract_docx_media(raw, "raw-source", media_store)
            self.assertEqual(len(extraction.occurrences), 1)
            occurrence = extraction.occurrences[0]
            self.assertEqual(media_store.get(occurrence.asset_id).asset_id, occurrence.asset_id)
            payload = {
                "title": "Writing chart with managed media",
                "exam_type": "Writing",
                "time_limit": 60,
                "sections": [],
                "writing_tasks": [
                    {"task_number": 1, "prompt": ["Describe the chart."], "minimum_words": 150, "recommended_minutes": 20},
                    {"task_number": 2, "prompt": ["Discuss the topic."], "minimum_words": 250, "recommended_minutes": 40},
                ],
                "media_bindings": [{
                    "occurrence_id": occurrence.occurrence_id,
                    "asset_id": occurrence.asset_id,
                    "association": "writing_task:1",
                    "required_for_solving": True,
                }],
            }
            exam = CanonicalExam.from_dict(payload)
            paths, diagnostics = resolve_media_bindings(exam, extraction, "https://ielts-os.example")
            self.assertEqual(diagnostics, [])
            self.assertTrue(exam.writing_tasks[0].media_url.endswith(occurrence.asset_id))
            output = render_docx(exam, root / "formatted.docx", media_asset_paths=paths)
            verify_embedded_media_roundtrip(output, paths)
            verify_docx_roundtrip(exam, output)


if __name__ == "__main__":
    unittest.main()
