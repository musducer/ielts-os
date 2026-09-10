"""Durable Firebase-backed queue state and private artifacts for raw DOCX jobs.

The pipeline itself still renders in a short-lived working directory.  This module
owns every value that must survive a Vercel instance restart: source files, job and
batch state, generated DOCX files, parser payloads, and managed media.
"""

from __future__ import annotations

import json
import os
import re
import time
from copy import deepcopy
from typing import Any, Dict, Iterable, Optional


ACTIVE_FILE_STATUSES = {"STAGING", "QUEUED", "PROCESSING"}
PRIVATE_ROW_KEYS = {
    "source_blob",
    "output_blob",
    "parser_blob",
    "issues_blob",
    "media_manifest_blob",
    "lease_owner",
    "lease_expires_at",
    "lease_slot",
    "result_blob",
}


def _now_ms() -> int:
    return int(time.time() * 1000)


def _safe_segment(value: str, fallback: str) -> str:
    clean = re.sub(r"[^A-Za-z0-9._-]+", "-", str(value or "")).strip("-._")
    return clean[:120] or fallback


class DurableExamGenerationStore:
    """Firestore coordinates work; Cloud Storage holds bytes and large JSON payloads."""

    def __init__(self, database: Any, bucket: Any, firestore_module: Any, prefix: str = "exam-generation"):
        self.database = database
        self.bucket = bucket
        self.firestore = firestore_module
        self.prefix = str(prefix or "exam-generation").strip("/")
        self.batches = database.collection("ielts_exam_generation_batches")
        self.jobs = database.collection("ielts_exam_generation_jobs")
        self.media = database.collection("ielts_exam_generation_media")
        self.worker_slots = database.collection("ielts_exam_generation_worker_slots")

    def _blob_name(self, *parts: str) -> str:
        return "/".join([self.prefix, *[str(part).strip("/") for part in parts if str(part)]])

    def _transactional(self, callback):
        transaction = self.database.transaction()

        @self.firestore.transactional
        def wrapped(active_transaction):
            return callback(active_transaction)

        return wrapped(transaction)

    @staticmethod
    def _terminal_status(status: str) -> bool:
        return str(status or "").upper() not in ACTIVE_FILE_STATUSES

    @staticmethod
    def _batch_status(rows: Iterable[Dict[str, Any]]) -> tuple[str, int]:
        values = list(rows)
        completed = sum(1 for row in values if DurableExamGenerationStore._terminal_status(str(row.get("status") or "")))
        if values and completed >= len(values):
            return "COMPLETE", completed
        if any(str(row.get("status") or "").upper() == "PROCESSING" for row in values):
            return "PROCESSING", completed
        return "QUEUED", completed

    def _batch_ref(self, batch_id: str):
        return self.batches.document(str(batch_id))

    def _job_ref(self, job_id: str):
        return self.jobs.document(str(job_id))

    def _media_ref(self, asset_id: str):
        return self.media.document(str(asset_id))

    def _slot_ref(self, slot_id: str):
        return self.worker_slots.document(str(slot_id))

    def upload_source(self, batch_id: str, index: int, filename: str, raw: bytes) -> str:
        name = _safe_segment(filename, f"document-{index + 1}.docx")
        blob_name = self._blob_name("batches", batch_id, "sources", f"{index + 1:02d}-{name}")
        self.bucket.blob(blob_name).upload_from_string(
            raw,
            content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
        return blob_name

    def download_source(self, blob_name: str) -> bytes:
        return self.bucket.blob(str(blob_name)).download_as_bytes()

    def delete_blobs(self, blob_names: Iterable[str]) -> None:
        for blob_name in blob_names:
            try:
                self.bucket.blob(str(blob_name)).delete()
            except Exception:
                pass

    def create_batch(self, batch: Dict[str, Any]) -> None:
        batch_id = str(batch.get("batch_id") or "")
        if not batch_id:
            raise ValueError("Batch ID is required.")
        self._batch_ref(batch_id).create(deepcopy(batch))

    def load_batch(self, batch_id: str) -> Optional[Dict[str, Any]]:
        snapshot = self._batch_ref(batch_id).get()
        return dict(snapshot.to_dict() or {}) if snapshot.exists else None

    def stage_file(self, batch_id: str, row_id: str, patch: Dict[str, Any]) -> bool:
        """Move one upload row from STAGING to a durable terminal/queued state."""
        now = _now_ms()
        allowed = {"source_blob", "status", "error", "diagnostics", "progress"}
        clean = {key: deepcopy(value) for key, value in dict(patch or {}).items() if key in allowed}
        if str(clean.get("status") or "").upper() not in {"QUEUED", "FAILED"}:
            raise ValueError("A staged source must become QUEUED or FAILED.")

        def stage(transaction):
            ref = self._batch_ref(batch_id)
            snapshot = ref.get(transaction=transaction)
            if not snapshot.exists:
                return False
            payload = snapshot.to_dict() or {}
            rows = [dict(row) for row in payload.get("results") if isinstance(row, dict)]
            for index, row in enumerate(rows):
                if str(row.get("row_id") or "") != row_id:
                    continue
                if str(row.get("status") or "").upper() != "STAGING":
                    return False
                row.update(clean)
                row["updatedAt"] = now
                row["progress"] = {**dict(row.get("progress") or {}), **dict(clean.get("progress") or {}), "updatedAt": now}
                rows[index] = row
                batch_status, completed = self._batch_status(rows)
                transaction.update(ref, {
                    "results": rows,
                    "status": batch_status,
                    "completedCount": completed,
                    "updatedAt": now,
                })
                return True
            return False

        return bool(self._transactional(stage))

    @staticmethod
    def public_batch(batch: Dict[str, Any]) -> Dict[str, Any]:
        """Return only teacher-safe status data; storage keys must never leave the API."""
        public = {
            key: deepcopy(batch.get(key))
            for key in (
                "batch_id", "status", "delivery_mode", "publication_policy", "createdAt",
                "updatedAt", "completedCount", "totalCount",
            )
            if key in batch
        }
        rows = batch.get("results") if isinstance(batch.get("results"), list) else []
        public_rows = []
        allowed = {
            "index", "row_id", "original_filename", "status", "question_count", "solved_count",
            "explanation_count", "validation_state", "repair_count", "round_trip_state",
            "media_count", "media_round_trip_state", "progress", "attempt_count", "updatedAt",
            "job_id", "docx_job_id", "error", "publish_error", "diagnostics",
        }
        for row in rows:
            if not isinstance(row, dict):
                continue
            public_rows.append({key: deepcopy(row[key]) for key in allowed if key in row and key not in PRIVATE_ROW_KEYS})
        public["results"] = sorted(public_rows, key=lambda item: int(item.get("index") or 0))
        return public

    def claim_next_file(
        self,
        worker_id: str,
        *,
        wanted_batch_id: str = "",
        max_active_workers: int = 2,
        lease_ms: int = 90_000,
    ) -> Optional[Dict[str, Any]]:
        """Claim one queued row with a lease; duplicate cron/browser triggers stay safe."""
        now = _now_ms()
        worker_id = str(worker_id or "worker")[:120]

        def claim(transaction):
            slot_refs = [self._slot_ref(f"slot-{index}") for index in range(max(1, int(max_active_workers)))]
            slot_snapshots = [slot_ref.get(transaction=transaction) for slot_ref in slot_refs]
            available_slot = next(
                (
                    slot_ref for slot_ref, snapshot in zip(slot_refs, slot_snapshots)
                    if not snapshot.exists or int((snapshot.to_dict() or {}).get("lease_expires_at") or 0) <= now
                ),
                None,
            )
            if available_slot is None:
                return None
            if wanted_batch_id:
                requested = self._batch_ref(wanted_batch_id).get(transaction=transaction)
                candidates = [requested] if requested.exists else []
            else:
                query = self.batches.order_by("createdAt").limit(100)
                snapshots = list(query.stream(transaction=transaction))
                candidates = [snapshot for snapshot in snapshots if snapshot.exists]

            for snapshot in candidates:
                payload = snapshot.to_dict() or {}
                rows = [dict(row) for row in payload.get("results") if isinstance(row, dict)]
                for index, row in enumerate(rows):
                    status = str(row.get("status") or "").upper()
                    expired = status == "PROCESSING" and int(row.get("lease_expires_at") or 0) <= now
                    if status != "QUEUED" and not expired:
                        continue
                    row["status"] = "PROCESSING"
                    row["lease_owner"] = worker_id
                    row["lease_expires_at"] = now + max(30_000, int(lease_ms))
                    row["lease_slot"] = available_slot.id
                    row["attempt_count"] = int(row.get("attempt_count") or 0) + 1
                    row["updatedAt"] = now
                    progress = dict(row.get("progress") or {})
                    progress.update({"stage": "PROCESSING", "updatedAt": now})
                    row["progress"] = progress
                    rows[index] = row
                    batch_status, completed = self._batch_status(rows)
                    transaction.update(snapshot.reference, {
                        "results": rows,
                        "status": batch_status,
                        "completedCount": completed,
                        "updatedAt": now,
                    })
                    transaction.set(available_slot, {
                        "worker_id": worker_id,
                        "batch_id": snapshot.id,
                        "row_id": str(row.get("row_id") or ""),
                        "lease_expires_at": row["lease_expires_at"],
                        "updatedAt": now,
                    })
                    return {
                        "batch_id": snapshot.id,
                        "row_id": str(row.get("row_id") or ""),
                        "row": row,
                        "delivery_mode": str(payload.get("delivery_mode") or "exam"),
                        "publication_policy": str(payload.get("publication_policy") or "draft"),
                        "actor": str(payload.get("actor") or ""),
                        "media_base_url": str(payload.get("media_base_url") or ""),
                    }
            return None

        return self._transactional(claim)

    def update_progress(self, batch_id: str, row_id: str, worker_id: str, progress: Dict[str, Any], *, lease_ms: int = 90_000) -> bool:
        now = _now_ms()

        def update(transaction):
            ref = self._batch_ref(batch_id)
            snapshot = ref.get(transaction=transaction)
            if not snapshot.exists:
                return False
            payload = snapshot.to_dict() or {}
            rows = [dict(row) for row in payload.get("results") if isinstance(row, dict)]
            for index, row in enumerate(rows):
                if str(row.get("row_id") or "") != row_id or str(row.get("lease_owner") or "") != worker_id:
                    continue
                if str(row.get("status") or "").upper() != "PROCESSING":
                    return False
                slot_id = str(row.get("lease_slot") or "")
                slot_ref = self._slot_ref(slot_id) if slot_id else None
                if slot_ref is not None:
                    slot = slot_ref.get(transaction=transaction)
                    if not slot.exists or str((slot.to_dict() or {}).get("worker_id") or "") != worker_id:
                        return False
                row["progress"] = {**dict(row.get("progress") or {}), **dict(progress or {}), "updatedAt": now}
                row["lease_expires_at"] = now + max(30_000, int(lease_ms))
                row["updatedAt"] = now
                rows[index] = row
                transaction.update(ref, {"results": rows, "updatedAt": now})
                if slot_ref is not None:
                    transaction.update(slot_ref, {"lease_expires_at": row["lease_expires_at"], "updatedAt": now})
                return True
            return False

        return bool(self._transactional(update))

    def complete_file(self, batch_id: str, row_id: str, worker_id: str, patch: Dict[str, Any]) -> bool:
        now = _now_ms()

        def complete(transaction):
            ref = self._batch_ref(batch_id)
            snapshot = ref.get(transaction=transaction)
            if not snapshot.exists:
                return False
            payload = snapshot.to_dict() or {}
            rows = [dict(row) for row in payload.get("results") if isinstance(row, dict)]
            for index, row in enumerate(rows):
                if str(row.get("row_id") or "") != row_id or str(row.get("lease_owner") or "") != worker_id:
                    continue
                slot_id = str(row.get("lease_slot") or "")
                slot_ref = self._slot_ref(slot_id) if slot_id else None
                slot = slot_ref.get(transaction=transaction) if slot_ref is not None else None
                if slot is not None and slot.exists and str((slot.to_dict() or {}).get("worker_id") or "") != worker_id:
                    return False
                row.update(dict(patch or {}))
                row.pop("lease_owner", None)
                row.pop("lease_expires_at", None)
                row.pop("lease_slot", None)
                row["updatedAt"] = now
                rows[index] = row
                batch_status, completed = self._batch_status(rows)
                transaction.update(ref, {
                    "results": rows,
                    "status": batch_status,
                    "completedCount": completed,
                    "updatedAt": now,
                })
                if slot_ref is not None:
                    if slot is None or not slot.exists or str((slot.to_dict() or {}).get("worker_id") or "") == worker_id:
                        transaction.delete(slot_ref)
                return True
            return False

        return bool(self._transactional(complete))

    def put_job(self, job_id: str, payload: Dict[str, Any]) -> None:
        clean = dict(payload)
        clean["job_id"] = job_id
        clean["updatedAt"] = _now_ms()
        self._job_ref(job_id).set(clean, merge=True)

    def load_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        snapshot = self._job_ref(job_id).get()
        return dict(snapshot.to_dict() or {}) if snapshot.exists else None

    def upload_output(self, batch_id: str, job_id: str, filename: str, raw: bytes) -> str:
        name = _safe_segment(filename, f"{job_id}-IELTS-OS.docx")
        blob_name = self._blob_name("batches", batch_id, "outputs", f"{job_id}-{name}")
        self.bucket.blob(blob_name).upload_from_string(
            raw,
            content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
        return blob_name

    def upload_json(self, batch_id: str, job_id: str, label: str, payload: Dict[str, Any]) -> str:
        name = _safe_segment(label, "payload")
        blob_name = self._blob_name("batches", batch_id, "jobs", job_id, f"{name}.json")
        self.bucket.blob(blob_name).upload_from_string(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
            content_type="application/json; charset=utf-8",
        )
        return blob_name

    def load_json(self, blob_name: str) -> Dict[str, Any]:
        raw = self.bucket.blob(str(blob_name)).download_as_bytes()
        parsed = json.loads(raw.decode("utf-8"))
        if not isinstance(parsed, dict):
            raise ValueError("Stored pipeline payload is invalid.")
        return parsed

    def persist_media(self, batch_id: str, media_root: str) -> None:
        metadata_dir = os.path.join(media_root, "metadata")
        if not os.path.isdir(metadata_dir):
            return
        for name in os.listdir(metadata_dir):
            if not re.fullmatch(r"media_[a-f0-9]{24}\.json", name):
                continue
            try:
                with open(os.path.join(metadata_dir, name), "r", encoding="utf-8") as handle:
                    payload = json.load(handle)
                asset_id = str(payload.get("asset_id") or "")
                local_path = str(payload.get("storage_path") or "")
                if not re.fullmatch(r"media_[a-f0-9]{24}", asset_id) or not os.path.isfile(local_path):
                    continue
                extension = os.path.splitext(local_path)[1].lower() or ".bin"
                blob_name = self._blob_name("batches", batch_id, "media", asset_id, f"asset{extension}")
                blob = self.bucket.blob(blob_name)
                blob.cache_control = "public, max-age=31536000, immutable"
                blob.upload_from_filename(local_path, content_type=str(payload.get("mime_type") or "application/octet-stream"))
                blob.patch()
                self._media_ref(asset_id).set({
                    "asset_id": asset_id,
                    "blob": blob_name,
                    "mime_type": str(payload.get("mime_type") or "application/octet-stream"),
                    "byte_size": int(payload.get("byte_size") or 0),
                    "sha256": str(payload.get("sha256") or ""),
                    "batch_id": batch_id,
                    "updatedAt": _now_ms(),
                }, merge=True)
            except Exception:
                # A failed media upload is handled by the caller as a failed job.
                raise

    def load_media(self, asset_id: str) -> Optional[Dict[str, Any]]:
        snapshot = self._media_ref(asset_id).get()
        return dict(snapshot.to_dict() or {}) if snapshot.exists else None

    def download_blob(self, blob_name: str) -> bytes:
        return self.bucket.blob(str(blob_name)).download_as_bytes()
