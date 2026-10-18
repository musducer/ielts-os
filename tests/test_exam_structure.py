import json
import unittest
from copy import deepcopy
from types import SimpleNamespace

from exam_generator.providers import TextProvider
from exam_generator.source import SourceSnapshot
from exam_generator.structure import StructureError, StructurePaused, reconstruct_structure


def _block(number, text="", *, kind="PARAGRAPH", runs=None, parent_id="", children=None,
           asset_id="", occurrence_id=""):
    return {
        "block_id": f"b{number}", "document_order": number - 1, "kind": kind,
        "visible_text": text, "runs": runs or ([{"text": text}] if text else []),
        "alignment": "left", "children": children or [], "parent_id": parent_id,
        "coverage_state": "MEDIA_ASSET" if kind == "IMAGE" else "PRESERVED",
        "region": "body", "asset_id": asset_id, "occurrence_id": occurrence_id,
    }


def _snapshot(blocks):
    return SourceSnapshot(
        filename="source.docx", visible_text="\n".join(block["visible_text"] for block in blocks if block["visible_text"]),
        format_manifest=blocks, blocks=blocks, source_hash="f" * 64,
    )


def _question(number, text, instruction):
    return {
        "question_number": number, "block_type": "BLANK", "text": text,
        "instruction": [instruction], "context": [], "options": [],
        "correct_answers": ["must be removed"],
        "explanation": {
            "why": "must be removed", "evidence": {"quote": "must be removed"},
        },
    }


def _fragment(questions, *, bindings=None, writing_tasks=None):
    return {
        "title": "Provider-local title", "exam_type": "Writing" if writing_tasks else "Reading",
        "time_limit": 60,
        "sections": [] if writing_tasks else [{"label": "local", "passage": [], "questions": questions}],
        "writing_tasks": writing_tasks or [], "media_bindings": bindings or [],
    }


class SequenceProvider(TextProvider):
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def complete(self, **kwargs):
        self.calls.append(kwargs)
        if not self.responses:
            raise AssertionError(f"Unexpected provider call for {kwargs.get('phase')}")
        value = self.responses.pop(0)
        return value if isinstance(value, str) else json.dumps(value)


class ScopedStructureTests(unittest.TestCase):
    def setUp(self):
        self.blocks = [
            _block(1, "READING PASSAGE 1", runs=[{"text": "READING PASSAGE 1", "bold": True}]),
            _block(2, "Exact passage", runs=[{"text": "Exact passage", "italic": True}]),
            _block(3, "Questions 1–1"),
            _block(4, "First exact question", runs=[{"text": "First exact question", "bold": True}]),
            _block(5, "Questions 2-2"),
            _block(6, "Second exact question", runs=[{"text": "Second exact question", "underline": True}]),
        ]

    def test_reconstructs_each_explicit_group_and_merges_in_source_order(self):
        provider = SequenceProvider([
            _fragment([_question(1, "First exact question", "Questions 1–1")]),
            _fragment([_question(2, "Second exact question", "Questions 2-2")]),
        ])
        exam = reconstruct_structure(provider, _snapshot(self.blocks), {"exam_type": "Reading"},
                                     "test-model", 4000)

        self.assertEqual([call["phase"] for call in provider.calls],
                         ["structure_group", "structure_group"])
        questions = exam.sections[0].questions
        self.assertEqual([question.question_number for question in questions], [1, 2])
        self.assertTrue(questions[0].text.runs[0].bold)
        self.assertTrue(questions[1].text.runs[0].underline)
        self.assertEqual(questions[0].correct_answers, [])
        self.assertIsNone(questions[0].explanation)
        self.assertTrue(questions[0].group_id.startswith("section_1_group_1"))
        self.assertEqual(exam.sections[0].passage[1].text, "Exact passage")
        self.assertTrue(exam.sections[0].passage[1].runs[0].italic)

    def test_checkpoint_resumes_only_unfinished_group(self):
        checkpoints = []
        first_provider = SequenceProvider([
            _fragment([_question(1, "First exact question", "Questions 1–1")]),
        ])
        with self.assertRaises(StructurePaused) as paused:
            reconstruct_structure(
                first_provider, _snapshot(self.blocks), {"exam_type": "Reading"},
                "test-model", 4000, on_checkpoint=lambda state: checkpoints.append(deepcopy(state)),
                should_pause=lambda: len(first_provider.calls) >= 1,
            )
        self.assertEqual(len(paused.exception.partial_exam.sections[0].questions), 1)
        self.assertIn("section_1_group_1", paused.exception.checkpoint["fragments"])

        second_provider = SequenceProvider([
            _fragment([_question(2, "Second exact question", "Questions 2-2")]),
        ])
        exam = reconstruct_structure(
            second_provider, _snapshot(self.blocks), {"exam_type": "Reading"},
            "test-model", 4000, checkpoint=checkpoints[-1],
        )
        self.assertEqual(len(second_provider.calls), 1)
        self.assertIn("Second exact question", second_provider.calls[0]["user"])
        self.assertEqual([question.question_number for question in exam.sections[0].questions], [1, 2])

    def test_structure_repair_is_scoped_and_does_not_regenerate_valid_neighbour(self):
        invalid = _fragment([_question(9, "First exact question", "Questions 1–1")])
        provider = SequenceProvider([
            invalid,
            _fragment([_question(1, "First exact question", "Questions 1–1")]),
            _fragment([_question(2, "Second exact question", "Questions 2-2")]),
        ])
        checkpoints = []
        exam = reconstruct_structure(
            provider, _snapshot(self.blocks), {"exam_type": "Reading"}, "test-model", 4000,
            on_checkpoint=lambda state: checkpoints.append(deepcopy(state)),
        )
        self.assertEqual([call["phase"] for call in provider.calls],
                         ["structure_group", "structure_repair", "structure_group"])
        self.assertEqual([question.question_number for question in exam.sections[0].questions], [1, 2])
        self.assertEqual(checkpoints[-1]["repair_counts"]["section_1_group_1"], 1)

    def test_exhausted_group_keeps_completed_partial_exam(self):
        invalid = _fragment([_question(9, "Second exact question", "Questions 2-2")])
        provider = SequenceProvider([
            _fragment([_question(1, "First exact question", "Questions 1–1")]),
            invalid, invalid, invalid,
        ])
        with self.assertRaises(StructureError) as caught:
            reconstruct_structure(provider, _snapshot(self.blocks), {"exam_type": "Reading"},
                                  "test-model", 4000, max_structure_repairs=2)
        error = caught.exception
        self.assertEqual(error.code, "STRUCTURE_QUESTION_COUNT_MISMATCH")
        self.assertEqual([question.question_number for question in error.partial_exam.sections[0].questions], [1])
        self.assertIn("section_1_group_1", error.checkpoint["fragments"])
        self.assertEqual(error.diagnostics[0]["group_id"], "section_1_group_2")

    def test_outline_is_used_when_no_explicit_range_and_rejects_reordered_scope(self):
        blocks = [
            _block(1, "READING PASSAGE 1"), _block(2, "Exact passage"),
            _block(3, "Complete the statement."), _block(4, "1. First exact question"),
        ]
        outline = {
            "exam_type": "Reading", "title": "Outlined", "metadata_block_ids": [],
            "sections": [{"label": "Passage 1", "passage_block_ids": ["b1", "b2"],
                          "groups": [{"block_ids": ["b3", "b4"], "question_numbers": [1],
                                      "task_number": 0}]}],
        }
        provider = SequenceProvider([
            outline,
            _fragment([_question(1, "First exact question", "Complete the statement.")]),
        ])
        exam = reconstruct_structure(provider, _snapshot(blocks), {"exam_type": "Reading"},
                                     "test-model", 4000)
        self.assertEqual([call["phase"] for call in provider.calls],
                         ["structure_outline", "structure_group"])
        self.assertEqual(exam.sections[0].questions[0].question_number, 1)

        reordered = deepcopy(outline)
        reordered["sections"][0]["passage_block_ids"] = ["b2"]
        reordered["sections"][0]["groups"][0]["block_ids"] = ["b1", "b3", "b4"]
        bad_provider = SequenceProvider([reordered, reordered])
        with self.assertRaisesRegex(StructureError, "reverse source order"):
            reconstruct_structure(bad_provider, _snapshot(blocks), {"exam_type": "Reading"},
                                  "test-model", 4000)

    def test_group_media_requires_exact_identity_position_and_private_visual_input(self):
        blocks = [
            _block(1, "READING PASSAGE 1"), _block(2, "Exact passage"),
            _block(3, "Questions 1-1"), _block(4, "Inspect the supplied figure."),
            _block(5, kind="IMAGE", asset_id="media_" + "a" * 24,
                   occurrence_id="occ_source_0_aaaaaaaaaa"),
            _block(6, "First exact question"),
        ]
        snapshot = _snapshot(blocks)
        visual_calls = []

        def prepare(occurrence_ids):
            visual_calls.append(occurrence_ids)
            return [{"mime_type": "image/png", "data": "cG5n",
                     "occurrence_id": occurrence_ids[0], "asset_id": "media_" + "a" * 24}]

        snapshot.provider_image_inputs = prepare
        question = _question(1, "First exact question", "Questions 1-1")
        question["context"] = [
            "Inspect the supplied figure.",
            {"media": {"asset_id": "media_" + "a" * 24,
                       "occurrence_id": "occ_source_0_aaaaaaaaaa"}, "alignment": "center"},
        ]
        binding = {"occurrence_id": "occ_source_0_aaaaaaaaaa",
                   "asset_id": "media_" + "a" * 24,
                   "association": "question:1:context", "required_for_solving": True}
        provider = SequenceProvider([_fragment([question], bindings=[binding])])
        exam = reconstruct_structure(provider, snapshot, {"exam_type": "Reading"},
                                     "test-model", 4000)

        self.assertEqual(visual_calls, [["occ_source_0_aaaaaaaaaa"]])
        self.assertEqual(provider.calls[0]["image_inputs"][0]["occurrence_id"],
                         "occ_source_0_aaaaaaaaaa")
        self.assertEqual(exam.media_bindings, [binding])
        self.assertEqual(exam.sections[0].questions[0].context[1].media["occurrence_id"],
                         "occ_source_0_aaaaaaaaaa")

    def test_code_copies_passage_media_and_owns_its_binding(self):
        blocks = [
            _block(1, "READING PASSAGE 1"),
            _block(2, kind="IMAGE", asset_id="media_" + "b" * 24,
                   occurrence_id="occ_source_0_bbbbbbbbbb"),
            _block(3, "Questions 1-1"), _block(4, "First exact question"),
        ]
        snapshot = _snapshot(blocks)
        snapshot.provider_image_inputs = lambda occurrence_ids: [
            {"mime_type": "image/png", "data": "cG5n", "occurrence_id": occurrence_ids[0],
             "asset_id": "media_" + "b" * 24}
        ]
        provider = SequenceProvider([
            _fragment([_question(1, "First exact question", "Questions 1-1")]),
        ])
        exam = reconstruct_structure(provider, snapshot, {"exam_type": "Reading"},
                                     "test-model", 4000)
        self.assertEqual(exam.sections[0].passage[1].media["occurrence_id"],
                         "occ_source_0_bbbbbbbbbb")
        self.assertEqual(exam.media_bindings[0]["association"], "section:1:passage")
        self.assertTrue(exam.media_bindings[0]["required_for_solving"])


if __name__ == "__main__":
    unittest.main()
