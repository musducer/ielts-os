import copy
import re
import unittest
from pathlib import Path
from unittest.mock import patch

from api.exam_generation_durable import DurableExamGenerationStore


class _Database:
    def collection(self, _name):
        return self

    def document(self, _name):
        return self


class _Snapshot:
    def __init__(self, value, reference=None):
        self._value = copy.deepcopy(value)
        self.exists = value is not None
        self.reference = reference
        self.id = reference.id if reference else ""

    def to_dict(self):
        return copy.deepcopy(self._value)


class _Reference:
    def __init__(self, database, path):
        self._database = database
        self._path = tuple(path)
        self.id = self._path[-1]

    def get(self, transaction=None):
        return _Snapshot(self._database.documents.get(self._path), self)


class _Collection:
    def __init__(self, database, path):
        self._database = database
        self._path = tuple(path)

    def document(self, name):
        return _Reference(self._database, (*self._path, str(name)))


class _Transaction:
    def __init__(self, database):
        self._database = database

    def update(self, reference, payload):
        self._database.documents[reference._path].update(copy.deepcopy(payload))

    def set(self, reference, payload):
        self._database.documents[reference._path] = copy.deepcopy(payload)

    def delete(self, reference):
        self._database.documents.pop(reference._path, None)


class _RetryDatabase:
    def __init__(self):
        self.documents = {}

    def collection(self, name):
        return _Collection(self, (str(name),))

    def transaction(self):
        return _Transaction(self)


class _Firestore:
    @staticmethod
    def transactional(callback):
        def invoke(transaction):
            return callback(transaction)
        return invoke


class DurableExamGenerationStoreTests(unittest.TestCase):
    def test_public_batch_keeps_order_and_hides_blob_and_lease_data(self):
        store = DurableExamGenerationStore(_Database(), object(), object())
        self.assertEqual(
            store._blob_name("batches", "batch-a", "sources", "test.docx"),
            "exam-generation/batches/batch-a/sources/test.docx",
        )
        public = store.public_batch({
            "batch_id": "batch-a",
            "status": "PROCESSING",
            "results": [
                {"index": 1, "original_filename": "second.docx", "status": "PROCESSING", "source_blob": "private/source", "lease_owner": "worker"},
                {"index": 0, "original_filename": "first.docx", "detected_skill": "Reading", "status": "QUEUED", "output_blob": "private/output", "result_blob": "private/result"},
            ],
        })

        self.assertEqual([row["original_filename"] for row in public["results"]], ["first.docx", "second.docx"])
        self.assertNotIn("source_blob", str(public))
        self.assertNotIn("output_blob", str(public))
        self.assertNotIn("result_blob", str(public))
        self.assertNotIn("lease_owner", str(public))
        self.assertEqual(public["results"][0]["detected_skill"], "Reading")

    def test_terminal_batch_with_manual_review_is_not_reported_as_complete_success(self):
        self.assertEqual(
            DurableExamGenerationStore._batch_status([{"status": "MANUAL_REVIEW"}]),
            ("COMPLETED_WITH_ERRORS", 1),
        )
        self.assertEqual(
            DurableExamGenerationStore._batch_status([{"status": "READY_FOR_REVIEW"}]),
            ("COMPLETE", 1),
        )

    def test_retry_requeues_only_transient_generation_failure(self):
        database = _RetryDatabase()
        path = ("ielts_exam_generation_batches", "batch-a")
        database.documents[path] = {
            "batch_id": "batch-a",
            "status": "COMPLETE",
            "results": [
                {
                    "row_id": "retry-me", "index": 0, "status": "MANUAL_REVIEW",
                    "job_id": "a" * 32, "source_blob": "private/source",
                    "diagnostics": [{"severity": "FAIL", "code": "PROVIDER_TIMEOUT"}],
                    "error": "old error", "issues_blob": "private/issues",
                    "checkpoint_blob": "private/checkpoint", "solved_count": 3,
                },
                {
                    "row_id": "keep-review", "index": 1, "status": "MANUAL_REVIEW",
                    "job_id": "b" * 32,
                    "diagnostics": [{"severity": "FAIL", "code": "PARSER_CONTRACT"}],
                },
                {
                    "row_id": "retry-solver", "index": 2, "status": "MANUAL_REVIEW",
                    "job_id": "c" * 32, "source_blob": "private/source2",
                    "diagnostics": [{"severity": "FAIL", "code": "QUESTION_SOLVE"}],
                },
            ],
        }
        store = DurableExamGenerationStore(database, object(), _Firestore)

        self.assertEqual(store.retry_retriable_files("batch-a"), 1)
        rows = database.documents[path]["results"]
        retried, protected, solver_retried = rows
        self.assertEqual(database.documents[path]["status"], "QUEUED")
        self.assertEqual(retried["status"], "QUEUED")
        self.assertEqual(retried["source_blob"], "private/source")
        self.assertFalse(retried["error"])
        self.assertNotIn("issues_blob", retried)
        self.assertRegex(retried["job_id"], re.compile(r"^[a-f0-9]{32}$"))
        self.assertNotEqual(retried["job_id"], "a" * 32)
        self.assertEqual(protected["status"], "MANUAL_REVIEW")
        self.assertEqual(solver_retried["status"], "MANUAL_REVIEW")
        self.assertEqual(retried["checkpoint_blob"], "private/checkpoint")
        self.assertEqual(retried["solved_count"], 3)
        self.assertEqual(retried["retry_history"][0]["issues_blob"], "private/issues")

    def test_retry_does_not_hide_a_deterministic_failure_behind_a_timeout(self):
        database = _RetryDatabase()
        path = ("ielts_exam_generation_batches", "batch-a")
        database.documents[path] = {"results": [{
            "row_id": "mixed", "status": "FAILED", "source_blob": "private/source",
            "diagnostics": [{"code": "PROVIDER_TIMEOUT", "severity": "FAIL"}, {"code": "STRUCTURE_SCHEMA_INVALID", "severity": "FAIL"}],
        }]}
        store = DurableExamGenerationStore(database, object(), _Firestore)
        self.assertEqual(store.retry_retriable_files("batch-a"), 0)

    def test_reprocess_old_failures_keeps_source_and_history_but_invalidates_checkpoint(self):
        database = _RetryDatabase()
        path = ("ielts_exam_generation_batches", "batch-a")
        rows = [{
            "row_id": status, "status": status, "source_blob": "private/source", "pipeline_version": "old",
            "job_id": "a" * 32, "checkpoint_blob": "private/checkpoint", "result_blob": "private/result",
            "diagnostics": [{"code": "WORKER_FAILURE", "severity": "FAIL"}],
        } for status in ["FAILED", "MANUAL_REVIEW", "READY_FOR_REVIEW", "PUBLISHED", "PROCESSING"]]
        database.documents[path] = {"results": rows}
        store = DurableExamGenerationStore(database, object(), _Firestore)
        self.assertEqual(store.reprocess_failed_files("batch-a", "latest", actor="teacher"), 2)
        changed = database.documents[path]["results"]
        self.assertEqual([row["status"] for row in changed], ["QUEUED", "QUEUED", "READY_FOR_REVIEW", "PUBLISHED", "PROCESSING"])
        self.assertEqual(changed[0]["source_blob"], "private/source")
        self.assertNotIn("checkpoint_blob", changed[0])
        self.assertNotEqual(changed[0]["job_id"], "a" * 32)
        self.assertEqual(changed[0]["retry_history"][0]["checkpoint_blob"], "private/checkpoint")
        self.assertEqual(changed[0]["retry_history"][0]["actor"], "teacher")
        self.assertEqual(store.reprocess_failed_files("batch-a", "latest"), 0)

    def test_public_status_preserves_scoped_diagnostics_and_uses_server_lease_time(self):
        batch = {"results": [{
            "index": 0, "status": "FAILED", "source_blob": "private/source", "pipeline_version": "old",
            "checkpoint_blob": "private/checkpoint", "retry_history": [{"result_blob": "private/result"}],
            "error": r"Worker failed at C:\\Users\\teacher\\source.docx",
            "progress": {"stage": "repairing group", "question_completed": 4, "private_trace": r"C:\\private\\trace.txt"},
            "diagnostics": [{"code": "structure media ambiguous", "severity": "fail", "stage": "reconstructing structure", "scope": "question group", "block_id": "block_84", "question_number": 18, "occurrence_id": "media_occ_3", "message": "See gs://secret-bucket/jobs/trace.json", "recovery_attempted": ["normalize", "structure repair"], "raw_response": "private model payload"}],
            "source_coverage": {"total_blocks": 10, "accounted_blocks": 9, "percentage": 90, "source_text": "private"},
        }, {"index": 1, "status": "PROCESSING", "lease_expires_at": 999}]}
        with patch("api.exam_generation_durable._now_ms", return_value=1000):
            public = DurableExamGenerationStore.public_batch(batch, current_pipeline_version="latest")
        first, second = public["results"]
        self.assertTrue(first["can_reprocess"])
        self.assertFalse(first["can_retry"])
        self.assertEqual(first["diagnostics"][0]["block_id"], "block_84")
        self.assertEqual(first["diagnostics"][0]["code"], "STRUCTURE_MEDIA_AMBIGUOUS")
        self.assertEqual(first["diagnostics"][0]["stage"], "RECONSTRUCTING_STRUCTURE")
        self.assertEqual(first["diagnostics"][0]["scope"], "QUESTION_GROUP")
        self.assertEqual(first["diagnostics"][0]["recovery_attempted"], ["normalize", "structure repair"])
        self.assertEqual(first["progress"], {"stage": "REPAIRING_GROUP", "question_completed": 4})
        self.assertEqual(first["source_coverage"]["percentage"], 90)
        self.assertTrue(second["reclaimable"])
        serialized = str(public)
        self.assertNotIn(r"C:\\Users", serialized)
        self.assertNotIn("gs://", serialized)
        self.assertNotIn("private_trace", serialized)
        self.assertNotIn("raw_response", serialized)

    def test_expired_claim_gets_new_artifact_identity_and_retains_checkpoint(self):
        database = _RetryDatabase()
        path = ("ielts_exam_generation_batches", "batch-a")
        database.documents[path] = {"results": [{
            "row_id": "row-a", "status": "PROCESSING", "job_id": "a" * 32,
            "lease_owner": "stale", "lease_expires_at": 900, "lease_slot": "slot-0",
            "checkpoint_blob": "private/checkpoint", "result_blob": "private/result",
        }]}
        database.documents[("ielts_exam_generation_worker_slots", "slot-0")] = {"worker_id": "stale", "lease_expires_at": 900}
        store = DurableExamGenerationStore(database, object(), _Firestore)
        with patch("api.exam_generation_durable._now_ms", return_value=1000):
            claim = store.claim_next_file("fresh", wanted_batch_id="batch-a")
        self.assertNotEqual(claim["row"]["job_id"], "a" * 32)
        self.assertEqual(claim["row"]["checkpoint_blob"], "private/checkpoint")
        self.assertNotIn("result_blob", claim["row"])
        self.assertFalse(store.complete_file("batch-a", "row-a", "stale", {"status": "READY_FOR_REVIEW"}))

    def test_checkpoint_is_ownership_fenced_and_defer_preserves_it(self):
        database = _RetryDatabase()
        path = ("ielts_exam_generation_batches", "batch-a")
        database.documents[path] = {"results": [{
            "row_id": "row-a", "status": "PROCESSING", "job_id": "a" * 32,
            "lease_owner": "fresh", "lease_slot": "slot-0",
        }]}
        database.documents[("ielts_exam_generation_worker_slots", "slot-0")] = {"worker_id": "fresh", "batch_id": "batch-a", "row_id": "row-a"}
        store = DurableExamGenerationStore(database, object(), _Firestore)
        blob = store._blob_name("batches", "batch-a", "jobs", "a" * 32, "checkpoint-1.json")
        self.assertFalse(store.set_checkpoint("batch-a", "row-a", "stale", blob))
        with self.assertRaises(ValueError):
            store.set_checkpoint("batch-a", "row-a", "fresh", "private/foreign.json")
        self.assertTrue(store.set_checkpoint("batch-a", "row-a", "fresh", blob))
        self.assertTrue(store.defer_file("batch-a", "row-a", "fresh", {"question_completed": 3}))
        row = database.documents[path]["results"][0]
        self.assertEqual(row["status"], "QUEUED")
        self.assertEqual(row["checkpoint_blob"], blob)
        self.assertNotEqual(row["job_id"], "a" * 32)
        self.assertNotIn("lease_owner", row)
        self.assertNotIn(("ielts_exam_generation_worker_slots", "slot-0"), database.documents)


class ExamGenerationFrontendContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root = Path(__file__).resolve().parents[1]
        cls.template = (root / "src" / "App.template.tsx").read_text(encoding="utf-8")
        cls.builder = (root / "src" / "components_split" / "EXAM_BUILDER.txt").read_text(encoding="utf-8")

    def test_browser_uses_server_retry_reprocess_and_reclaimability_flags(self):
        self.assertIn("item.can_retry === true", self.template)
        self.assertIn("item.can_reprocess === true", self.template)
        self.assertIn("item.reclaimable === true", self.template)
        self.assertIn("/${action}`", self.template)
        self.assertNotIn("['GENERATION', 'GENERATION_TIMEOUT'", self.template)

    def test_batch_panel_exposes_scoped_diagnosis_and_both_recovery_actions(self):
        self.assertIn("Retry transient", self.builder)
        self.assertIn("Reprocess latest", self.builder)
        self.assertIn("diagnostic.scope", self.builder)
        self.assertIn("diagnostic.block_id", self.builder)
        self.assertIn("item.reclaimable ? 'RESUMABLE'", self.builder)


if __name__ == "__main__":
    unittest.main()
