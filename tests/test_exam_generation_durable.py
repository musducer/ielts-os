import copy
import re
import unittest

from api.exam_generation_durable import DurableExamGenerationStore


class _Database:
    def collection(self, _name):
        return self

    def document(self, _name):
        return self


class _Snapshot:
    def __init__(self, value):
        self._value = copy.deepcopy(value)
        self.exists = value is not None

    def to_dict(self):
        return copy.deepcopy(self._value)


class _Reference:
    def __init__(self, database, path):
        self._database = database
        self._path = tuple(path)

    def get(self, transaction=None):
        return _Snapshot(self._database.documents.get(self._path))


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
                {"index": 0, "original_filename": "first.docx", "status": "QUEUED", "output_blob": "private/output", "result_blob": "private/result"},
            ],
        })

        self.assertEqual([row["original_filename"] for row in public["results"]], ["first.docx", "second.docx"])
        self.assertNotIn("source_blob", str(public))
        self.assertNotIn("output_blob", str(public))
        self.assertNotIn("result_blob", str(public))
        self.assertNotIn("lease_owner", str(public))

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
                    "diagnostics": [{"severity": "FAIL", "code": "GENERATION"}],
                    "error": "old error", "issues_blob": "private/issues",
                },
                {
                    "row_id": "keep-review", "index": 1, "status": "MANUAL_REVIEW",
                    "job_id": "b" * 32,
                    "diagnostics": [{"severity": "FAIL", "code": "PARSER_CONTRACT"}],
                },
            ],
        }
        store = DurableExamGenerationStore(database, object(), _Firestore)

        self.assertEqual(store.retry_retriable_files("batch-a"), 1)
        rows = database.documents[path]["results"]
        retried, protected = rows
        self.assertEqual(database.documents[path]["status"], "QUEUED")
        self.assertEqual(retried["status"], "QUEUED")
        self.assertEqual(retried["source_blob"], "private/source")
        self.assertFalse(retried["error"])
        self.assertNotIn("issues_blob", retried)
        self.assertRegex(retried["job_id"], re.compile(r"^[a-f0-9]{32}$"))
        self.assertNotEqual(retried["job_id"], "a" * 32)
        self.assertEqual(protected["status"], "MANUAL_REVIEW")


if __name__ == "__main__":
    unittest.main()
