import unittest

from api.exam_generation_durable import DurableExamGenerationStore


class _Database:
    def collection(self, _name):
        return self

    def document(self, _name):
        return self


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


if __name__ == "__main__":
    unittest.main()
