import asyncio
import copy
import io
import json
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import docx
from fastapi import HTTPException

from api.exam_generation_durable import DurableExamGenerationStore
from api.index import create_direct_exam_generation_batch, finalize_direct_exam_generation_batch


DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def _valid_docx() -> bytes:
    output = io.BytesIO()
    document = docx.Document()
    document.add_paragraph("Questions 1-1")
    document.save(output)
    return output.getvalue()


class _Blob:
    def __init__(self, name, raw=b"", *, exists=False):
        self.name = name
        self.raw = raw
        self._exists = exists
        self.size = len(raw)
        self.generation = "17"
        self.metadata = {}
        self.content_type = ""
        self.session_kwargs = None
        self.download_generation = None

    def exists(self):
        return self._exists

    def reload(self):
        if not self._exists:
            raise FileNotFoundError(self.name)

    def create_resumable_upload_session(self, **kwargs):
        self.session_kwargs = kwargs
        return "https://storage.example/upload/session-secret"

    def download_as_bytes(self, **kwargs):
        self.download_generation = kwargs.get("if_generation_match")
        return self.raw


class _Bucket:
    def __init__(self):
        self.blobs = {}

    def blob(self, name):
        if name not in self.blobs:
            self.blobs[name] = _Blob(name)
        return self.blobs[name]


class DirectUploadStoreTests(unittest.TestCase):
    def setUp(self):
        self.bucket = _Bucket()
        self.store = DurableExamGenerationStore(SimpleNamespace(collection=lambda _name: None), self.bucket, object())
        self.batch_id = "ai_batch_1234567890"
        self.row = {
            "index": 0,
            "row_id": "row_1_1234567890abcdef",
            "original_filename": "reading.docx",
            "source_size": 1234,
            "source_content_type": DOCX_TYPE,
            "upload_kind": "DIRECT",
        }
        self.row["source_blob"] = self.store.source_blob_name(
            self.batch_id, self.row["index"], self.row["row_id"], self.row["original_filename"]
        )

    def test_session_is_bound_to_exact_path_origin_size_and_no_overwrite(self):
        result = self.store.create_source_upload_session(self.batch_id, self.row, "https://ielts-os-sandy.vercel.app")
        blob = self.bucket.blobs[self.row["source_blob"]]

        self.assertEqual(result["state"], "READY")
        self.assertTrue(result["upload_url"].startswith("https://"))
        self.assertEqual(blob.session_kwargs["size"], 1234)
        self.assertEqual(blob.session_kwargs["origin"], "https://ielts-os-sandy.vercel.app")
        self.assertEqual(blob.session_kwargs["if_generation_match"], 0)
        self.assertEqual(blob.metadata["batch_id"], self.batch_id)
        self.assertEqual(blob.metadata["row_id"], self.row["row_id"])

        tampered = {**self.row, "source_blob": "exam-generation/batches/another/sources/reading.docx"}
        with self.assertRaisesRegex(ValueError, "reserved row"):
            self.store.create_source_upload_session(self.batch_id, tampered, "https://ielts-os-sandy.vercel.app")

    def test_inspection_verifies_metadata_generation_and_exact_bytes(self):
        raw = b"x" * 1234
        blob = _Blob(self.row["source_blob"], raw, exists=True)
        blob.metadata = {
            "batch_id": self.batch_id,
            "row_id": self.row["row_id"],
            "expected_size": "1234",
            "upload_kind": "raw-docx",
        }
        self.bucket.blobs[self.row["source_blob"]] = blob

        inspected, generation = self.store.inspect_source_upload(self.batch_id, self.row)
        self.assertEqual(inspected, raw)
        self.assertEqual(generation, "17")
        self.assertEqual(blob.download_generation, 17)

        blob.metadata["row_id"] = "row_2_attacker"
        with self.assertRaisesRegex(ValueError, "metadata"):
            self.store.inspect_source_upload(self.batch_id, self.row)


class _EndpointStore:
    def __init__(self, valid_raw):
        self.batch = None
        self.valid_raw = valid_raw
        self.sessions = []

    def load_batch(self, batch_id):
        if not self.batch or self.batch.get("batch_id") != batch_id:
            return None
        return copy.deepcopy(self.batch)

    def create_batch(self, batch):
        if self.batch is not None:
            raise RuntimeError("already exists")
        self.batch = copy.deepcopy(batch)

    def source_blob_name(self, batch_id, index, row_id, filename):
        safe_name = filename.replace("/", "-").replace("\\", "-")
        return f"exam-generation/batches/{batch_id}/sources/{index + 1:02d}-{row_id}-{safe_name}"

    def create_source_upload_session(self, batch_id, row, origin):
        self.sessions.append((batch_id, row["row_id"], origin, row["source_blob"]))
        return {"state": "READY", "upload_url": f"https://storage.example/{row['row_id']}"}

    def inspect_source_upload(self, _batch_id, row):
        if int(row["index"]) == 1:
            raise FileNotFoundError("missing object")
        return self.valid_raw, "91"

    def stage_file(self, _batch_id, row_id, patch_value):
        for row in self.batch["results"]:
            if row["row_id"] != row_id:
                continue
            if row["status"] != "STAGING":
                return False
            row.update(copy.deepcopy(patch_value))
            rows = self.batch["results"]
            terminal = sum(row["status"] not in {"STAGING", "QUEUED", "PROCESSING", "RETRYING"} for row in rows)
            if terminal == len(rows):
                self.batch["status"] = "COMPLETED_WITH_ERRORS"
            elif any(row["status"] == "QUEUED" for row in rows):
                self.batch["status"] = "QUEUED"
            self.batch["completedCount"] = terminal
            return True
        return False

    @staticmethod
    def public_batch(batch, **_kwargs):
        return DurableExamGenerationStore.public_batch(batch)


class DirectUploadEndpointTests(unittest.TestCase):
    def setUp(self):
        self.store = _EndpointStore(_valid_docx())
        self.request = SimpleNamespace(
            headers={"origin": "https://ielts-os-sandy.vercel.app"},
            url=SimpleNamespace(scheme="https", netloc="ielts-os-sandy.vercel.app"),
        )
        self.actor = {"uid": "teacher-1", "email": "teacher@example.com"}
        self.payload = {
            "files": [
                {"name": "first.docx", "size": len(self.store.valid_raw), "content_type": DOCX_TYPE},
                {"name": "second.docx", "size": len(self.store.valid_raw), "content_type": ""},
            ],
            "delivery_mode": "exam",
            "publication_policy": "draft",
            "idempotency_key": "ai_batch_1234567890",
        }

    def _patches(self):
        return (
            patch("api.index._require_exam_manager", return_value=self.actor),
            patch("api.index._firebase_exam_generation_store", return_value=self.store),
            patch("api.index._trusted_exam_generation_media_base_url", return_value="https://ielts-os-sandy.vercel.app"),
        )

    def test_create_and_finalize_isolate_files_and_preserve_order(self):
        first, second, third = self._patches()
        with first, second, third:
            response = asyncio.run(create_direct_exam_generation_batch(self.request, self.payload))
        created = json.loads(response.body)
        self.assertEqual([item["index"] for item in created["uploads"]], [0, 1])
        self.assertEqual([item["state"] for item in created["uploads"]], ["READY", "READY"])
        self.assertEqual(len(self.store.sessions), 2)
        self.assertNotIn("source_blob", json.dumps(created["batch"]))
        self.assertNotIn("session-secret", json.dumps(created["batch"]))
        self.assertEqual(created["batch"]["upload_kind"], "DIRECT")

        row_ids = [item["row_id"] for item in created["batch"]["results"]]
        first, second, _third = self._patches()
        with first, second:
            response = asyncio.run(finalize_direct_exam_generation_batch(
                self.payload["idempotency_key"], self.request, {"row_ids": row_ids}
            ))
        finalized = json.loads(response.body)
        self.assertEqual([item["index"] for item in finalized["finalized"]], [0, 1])
        self.assertEqual([item["state"] for item in finalized["finalized"]], ["QUEUED", "FAILED"])
        self.assertEqual([item["status"] for item in finalized["batch"]["results"]], ["QUEUED", "FAILED"])
        self.assertEqual(self.store.batch["results"][0]["source_generation"], "91")
        self.assertEqual(self.store.batch["results"][1]["source_blob"], "")

    def test_idempotency_cannot_cross_actor_or_change_manifest(self):
        first, second, third = self._patches()
        with first, second, third:
            asyncio.run(create_direct_exam_generation_batch(self.request, self.payload))
        changed = copy.deepcopy(self.payload)
        changed["files"][0]["size"] += 1
        first, second, third = self._patches()
        with first, second, third, self.assertRaises(HTTPException) as raised:
            asyncio.run(create_direct_exam_generation_batch(self.request, changed))
        self.assertEqual(raised.exception.status_code, 409)

        other_actor = {"uid": "teacher-2", "email": "other@example.com"}
        with patch("api.index._require_exam_manager", return_value=other_actor), patch(
            "api.index._firebase_exam_generation_store", return_value=self.store
        ), patch("api.index._trusted_exam_generation_media_base_url", return_value="https://ielts-os-sandy.vercel.app"), self.assertRaises(HTTPException) as raised:
            asyncio.run(create_direct_exam_generation_batch(self.request, self.payload))
        self.assertEqual(raised.exception.status_code, 409)

    def test_finalize_rejects_partial_or_reordered_row_manifest(self):
        first, second, third = self._patches()
        with first, second, third:
            created = json.loads(asyncio.run(create_direct_exam_generation_batch(self.request, self.payload)).body)
        row_ids = [item["row_id"] for item in created["batch"]["results"]]
        first, second, _third = self._patches()
        with first, second, self.assertRaises(HTTPException) as raised:
            asyncio.run(finalize_direct_exam_generation_batch(
                self.payload["idempotency_key"], self.request, {"row_ids": list(reversed(row_ids))}
            ))
        self.assertEqual(raised.exception.status_code, 409)


class DirectUploadFrontendContractTests(unittest.TestCase):
    def test_raw_ai_upload_uses_direct_storage_handshake_and_bounded_workers(self):
        root = Path(__file__).resolve().parents[1]
        template = (root / "src" / "App.template.tsx").read_text(encoding="utf-8")
        self.assertIn("/api/exam-generation/batches/direct", template)
        self.assertIn("/finalize-upload", template)
        self.assertIn("new XMLHttpRequest()", template)
        self.assertIn("Math.min(4, Math.max(1, readyUploads.length))", template)
        self.assertNotIn("files.forEach(file => formData.append('files', file))", template)


if __name__ == "__main__":
    unittest.main()
