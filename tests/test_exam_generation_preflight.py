import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from exam_generator.cache import StateStore
from exam_generator.jobs import JobTransitionError
from exam_generator.pipeline import ExamGenerationPipeline, PipelineConfig
from exam_generator.providers import StaticProvider
from exam_generator.source import SourceSnapshot


class ExamGenerationPreflightTests(unittest.TestCase):
    def _run_preflight(self, *, source_diagnostics=None, media_error=None, media_diagnostics=None):
        with tempfile.TemporaryDirectory() as directory:
            provider = StaticProvider({})
            pipeline = ExamGenerationPipeline(provider, PipelineConfig(state_dir=Path(directory)))
            source = SourceSnapshot(
                filename="reading.docx", visible_text="READING PASSAGE 1\nSource text.",
                format_manifest=[], source_hash="source-hash",
                coverage={"state": "FAIL" if source_diagnostics else "PASS"},
                diagnostics=source_diagnostics or [],
            )
            extraction = SimpleNamespace(
                occurrences=[],
                to_dict=lambda: {"assets": [], "occurrences": [], "diagnostics": media_diagnostics or []},
            )
            with patch("exam_generator.pipeline.load_source_snapshot", return_value=source), patch(
                "exam_generator.pipeline.extract_docx_media", side_effect=media_error, return_value=extraction
            ):
                result = pipeline.generate("reading.docx", job_id="preflight-case", use_cache=False)
            state = pipeline.job_state("preflight-case")
            self.assertEqual(provider.calls, [])
            self.assertEqual(result.status, "MANUAL_REVIEW")
            self.assertEqual(state["status"], "MANUAL_REVIEW")
            self.assertEqual(state["revision"], 2)
            self.assertEqual(result.output_path, "")
            self.assertEqual(result.round_trip_state, "NOT_RUN")
            return result

    def test_lossy_source_block_returns_precise_diagnostic_before_generation(self):
        diagnostic = {
            "severity": "FAIL", "code": "SOURCE_DRAWING_CONTENT_UNSUPPORTED",
            "stage": "INGESTING", "block_id": "block_chart", "kind": "DRAWING",
            "location": "/w:document/w:body/w:p[2]", "recoverable": False,
            "classification": "LOSSY", "message": "Chart content has no lossless representation.",
            "retryable": False,
        }
        result = self._run_preflight(source_diagnostics=[diagnostic])
        self.assertEqual(result.issues[0]["code"], "SOURCE_DRAWING_CONTENT_UNSUPPORTED")
        self.assertEqual(result.issues[0]["block_id"], "block_chart")

    def test_media_inspection_exception_returns_review_instead_of_worker_failure(self):
        result = self._run_preflight(media_error=ValueError("Unresolved image relationship"))
        self.assertEqual(result.issues[0]["code"], "MEDIA_INSPECTION")
        self.assertEqual(result.issues[0]["message"], "Unresolved image relationship")
        self.assertEqual(result.media_round_trip_state, "FAIL")

    def test_media_relationship_diagnostics_return_review_before_generation(self):
        result = self._run_preflight(media_diagnostics=["Image relationship points to a missing asset"])
        self.assertEqual(result.issues[0]["code"], "MEDIA_INSPECTION")
        self.assertIn("missing asset", result.issues[0]["message"])
        self.assertEqual(result.media_round_trip_state, "FAIL")

    def test_preflight_review_does_not_allow_bypassing_validation_or_revision_guard(self):
        with tempfile.TemporaryDirectory() as directory:
            store = StateStore(directory)
            store.transition_job("review-job", "QUEUED")
            with self.assertRaises(JobTransitionError):
                store.transition_job("review-job", "READY_FOR_REVIEW")
            with self.assertRaises(JobTransitionError):
                store.transition_job("review-job", "MANUAL_REVIEW", expected_revision=0)
            result = store.transition_job("review-job", "MANUAL_REVIEW", expected_revision=1)
            self.assertEqual(result["revision"], 2)
            with self.assertRaises(JobTransitionError):
                store.transition_job("review-job", "PUBLISHED")


if __name__ == "__main__":
    unittest.main()
