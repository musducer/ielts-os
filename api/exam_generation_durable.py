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
import uuid
from copy import deepcopy
from typing import Any, Dict, Iterable, Optional

from exam_generator.errors import TRANSIENT_PROVIDER_CODES


ACTIVE_FILE_STATUSES = {"STAGING", "QUEUED", "PROCESSING", "RETRYING"}
RETRYABLE_DIAGNOSTIC_CODES = TRANSIENT_PROVIDER_CODES
PRIVATE_ROW_KEYS = {
    "source_blob",
    "source_size",
    "source_content_type",
    "source_generation",
    "upload_kind",
    "output_blob",
    "parser_blob",
    "issues_blob",
    "media_manifest_blob",
    "lease_owner",
    "lease_expires_at",
    "lease_slot",
    "result_blob",
    "checkpoint_blob",
    "retry_history",
}

ATTEMPT_ARTIFACT_KEYS = (
    "output_blob", "parser_blob", "issues_blob", "media_manifest_blob", "result_blob", "checkpoint_blob",
)

_PRIVATE_LOCATION_PATTERNS = (
    re.compile(r"(?i)\bgs://[^\s,;]+"),
    re.compile(r"(?i)(?<![A-Za-z0-9_])[A-Za-z]:[\\/][^\s,;]+"),
    re.compile(r"(?i)(?<![A-Za-z0-9_])/(?:tmp|var|home|users|private|workspace)(?:/[^\s,;]+)?"),
    re.compile(r"(?i)\bexam-generation/(?:batches|jobs|media)/[^\s,;]+"),
)


def _safe_public_text(value: Any, *, limit: int = 700) -> str:
    text = " ".join(str(value or "").replace("\x00", " ").split())
    for pattern in _PRIVATE_LOCATION_PATTERNS:
        text = pattern.sub("[redacted]", text)
    return text[:max(0, int(limit))]


def _safe_public_identifier(value: Any, *, limit: int = 120, upper: bool = False) -> str:
    text = str(value or "").strip()
    if upper:
        text = text.upper()
    return re.sub(r"[^A-Za-z0-9_.:-]+", "_", text)[:max(0, int(limit))]


def _retryable_row(row: Dict[str, Any]) -> bool:
    diagnostics = [item for item in row.get("diagnostics", []) if isinstance(item, dict)]
    failures = [item for item in diagnostics if str(item.get("severity") or "FAIL").upper() == "FAIL"]
    # A transient issue cannot override a simultaneous deterministic failure.
    return bool(
        str(row.get("status") or "").upper() in {"FAILED", "MANUAL_REVIEW"}
        and row.get("source_blob") and failures
        and all(str(item.get("code") or "").upper() in RETRYABLE_DIAGNOSTIC_CODES for item in failures)
    )


def _attempt_history(row: Dict[str, Any], now: int, action: str, actor: str = "") -> list[Dict[str, Any]]:
    history = [dict(item) for item in list(row.get("retry_history") or [])[-9:] if isinstance(item, dict)]
    history.append({
        "at": now, "action": action, "actor": str(actor or "")[:160],
        "status": str(row.get("status") or ""), "job_id": str(row.get("job_id") or ""),
        "pipeline_version": str(row.get("pipeline_version") or ""),
        # Raw provider material lives in private result blobs. Keeping only the
        # bounded structured diagnosis prevents one noisy attempt from pushing
        # the Firestore batch document over its size limit.
        "diagnostics": _public_diagnostics(row.get("diagnostics")),
        **{key: row[key] for key in ATTEMPT_ARTIFACT_KEYS if key in row},
    })
    return history


def _public_diagnostics(value: Any) -> list[Dict[str, Any]]:
    allowed = {
        "severity", "code", "stage", "block_id", "question_number", "occurrence_id", "kind",
        "location", "message", "details", "retryable", "recoverable", "recovery_attempted",
        "remaining_reason", "candidate_owners", "recovery", "scope",
        "group_id", "block_ids",
    }
    result = []
    for item in (value if isinstance(value, list) else [])[:100]:
        if not isinstance(item, dict):
            continue
        clean = {}
        for key in allowed & item.keys():
            field = item[key]
            if isinstance(field, str):
                if key == "location" and (re.match(r"^[A-Za-z]:[\\/]", field) or field.startswith(("/tmp/", "/var/", "gs://"))):
                    continue
                if key in {"severity", "code", "stage", "scope", "kind"}:
                    clean[key] = _safe_public_identifier(field, upper=True)
                elif key in {"block_id", "occurrence_id", "group_id", "location"}:
                    clean[key] = _safe_public_identifier(field)
                else:
                    clean[key] = _safe_public_text(field, limit=1200)
            elif isinstance(field, bool) or field is None:
                clean[key] = field
            elif isinstance(field, (int, float)):
                clean[key] = field
            elif isinstance(field, list):
                clean[key] = [
                    (_safe_public_identifier(entry, limit=160) if key in {"block_ids", "candidate_owners"} else _safe_public_text(entry, limit=160))
                    for entry in field[:20]
                    if isinstance(entry, (str, int, float)) and not isinstance(entry, bool)
                ]
        code = str(clean.get("code") or "").upper()
        clean["retryable"] = code in RETRYABLE_DIAGNOSTIC_CODES
        result.append(clean)
    return result


def _public_progress(value: Any) -> Dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    clean: Dict[str, Any] = {}
    identifiers = {"stage", "scope", "group_id", "block_id"}
    counters = {
        "question_total", "question_completed", "question_failed", "question_number",
        "repair_attempt", "retryCount", "updatedAt",
    }
    for key in identifiers:
        if key in value:
            clean[key] = _safe_public_identifier(value[key], upper=key in {"stage", "scope"})
    for key in counters:
        number = value.get(key)
        if isinstance(number, (int, float)) and not isinstance(number, bool):
            clean[key] = number
    return clean


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
            successful = {"READY_FOR_REVIEW", "PUBLISHED"}
            if all(str(row.get("status") or "").upper() in successful for row in values):
                return "COMPLETE", completed
            return "COMPLETED_WITH_ERRORS", completed
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

    def source_blob_name(self, batch_id: str, index: int, row_id: str, filename: str) -> str:
        """Return the only Storage object a direct-upload row may populate."""
        if not re.fullmatch(r"[A-Za-z0-9_-]{12,160}", str(batch_id or "")):
            raise ValueError("Invalid direct-upload batch ID.")
        if not re.fullmatch(r"row_[A-Za-z0-9_-]{8,120}", str(row_id or "")):
            raise ValueError("Invalid direct-upload row ID.")
        position = max(0, int(index)) + 1
        name = _safe_segment(filename, f"document-{position}.docx")
        return self._blob_name(
            "batches", str(batch_id), "sources", f"{position:02d}-{row_id}-{name}",
        )

    def create_source_upload_session(
        self,
        batch_id: str,
        row: Dict[str, Any],
        origin: str,
        *,
        timeout: int = 30,
    ) -> Dict[str, Any]:
        """Create an origin-bound, size-bound resumable upload for one exact row.

        The caller never supplies a Storage path.  The persisted row is checked
        against the canonical batch/row/index/filename path before a session is
        minted, and ``if_generation_match=0`` makes the destination immutable.
        """
        row = dict(row or {})
        row_id = str(row.get("row_id") or "")
        expected_blob = self.source_blob_name(
            batch_id,
            int(row.get("index") or 0),
            row_id,
            str(row.get("original_filename") or "document.docx"),
        )
        if str(row.get("source_blob") or "") != expected_blob:
            raise ValueError("The direct-upload source path does not match its reserved row.")
        size = int(row.get("source_size") or 0)
        if size <= 0:
            raise ValueError("The direct-upload source size is invalid.")
        origin = str(origin or "").strip().rstrip("/")
        if not origin.startswith(("https://", "http://localhost", "http://127.0.0.1")):
            raise ValueError("A trusted browser origin is required for direct upload.")

        blob = self.bucket.blob(expected_blob)
        # An idempotent replay after a response was lost must not overwrite an
        # object that already arrived.  Let finalize validate the existing bytes.
        try:
            if blob.exists():
                blob.reload()
                if int(blob.size or 0) != size:
                    raise ValueError("The existing direct-upload object has an unexpected size.")
                return {"state": "UPLOADED", "upload_url": ""}
        except ValueError:
            raise
        except Exception:
            # Not-found / lookup failures are resolved by session creation; a
            # real Storage outage will surface again from that authoritative call.
            pass

        blob.content_type = str(row.get("source_content_type") or "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        blob.metadata = {
            "batch_id": str(batch_id),
            "row_id": row_id,
            "expected_size": str(size),
            "upload_kind": "raw-docx",
        }
        upload_url = blob.create_resumable_upload_session(
            content_type=blob.content_type,
            size=size,
            origin=origin,
            timeout=max(5, min(60, int(timeout))),
            if_generation_match=0,
        )
        if not str(upload_url or "").startswith("https://"):
            raise RuntimeError("Storage did not return a secure upload session.")
        return {"state": "READY", "upload_url": str(upload_url)}

    def inspect_source_upload(self, batch_id: str, row: Dict[str, Any]) -> tuple[bytes, str]:
        """Read one completed direct upload only after exact path/metadata checks."""
        row = dict(row or {})
        row_id = str(row.get("row_id") or "")
        expected_blob = self.source_blob_name(
            batch_id,
            int(row.get("index") or 0),
            row_id,
            str(row.get("original_filename") or "document.docx"),
        )
        if str(row.get("source_blob") or "") != expected_blob:
            raise ValueError("The uploaded source is outside its reserved batch row.")
        expected_size = int(row.get("source_size") or 0)
        if expected_size <= 0:
            raise ValueError("The expected upload size is invalid.")

        blob = self.bucket.blob(expected_blob)
        blob.reload()
        if int(blob.size or 0) != expected_size:
            raise ValueError("The uploaded source size does not match the reserved file.")
        metadata = dict(blob.metadata or {})
        if (
            metadata.get("batch_id") != str(batch_id)
            or metadata.get("row_id") != row_id
            or metadata.get("expected_size") != str(expected_size)
            or metadata.get("upload_kind") != "raw-docx"
        ):
            raise ValueError("The uploaded source metadata does not match the reserved file.")
        generation = str(blob.generation or "")
        if not generation.isdigit():
            raise ValueError("The uploaded source generation is unavailable.")
        raw = blob.download_as_bytes(if_generation_match=int(generation))
        if len(raw) != expected_size:
            raise ValueError("The uploaded source changed while it was being verified.")
        return raw, generation

    def upload_source(self, batch_id: str, index: int, filename: str, raw: bytes) -> str:
        name = _safe_segment(filename, f"document-{index + 1}.docx")
        blob_name = self._blob_name("batches", batch_id, "sources", f"{index + 1:02d}-{name}")
        self.bucket.blob(blob_name).upload_from_string(
            raw,
            content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
        return blob_name

    def download_source(self, blob_name: str, generation: Any = "") -> bytes:
        generation_text = str(generation or "")
        if generation_text:
            if not generation_text.isdigit():
                raise ValueError("Stored source generation is invalid.")
            return self.bucket.blob(str(blob_name)).download_as_bytes(if_generation_match=int(generation_text))
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
        allowed = {"source_blob", "source_generation", "status", "error", "diagnostics", "progress"}
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
    def public_batch(batch: Dict[str, Any], *, current_pipeline_version: str = "") -> Dict[str, Any]:
        """Return only teacher-safe status data; storage keys must never leave the API."""
        public = {
            key: deepcopy(batch.get(key))
            for key in (
                "batch_id", "status", "delivery_mode", "publication_policy", "createdAt",
                "updatedAt", "completedCount", "totalCount", "upload_kind",
            )
            if key in batch
        }
        public["current_pipeline_version"] = str(current_pipeline_version or "")
        now = _now_ms()
        rows = batch.get("results") if isinstance(batch.get("results"), list) else []
        public_rows = []
        counters = {
            "index", "question_count", "solved_count", "explanation_count", "repair_count",
            "media_count", "attempt_count", "updatedAt", "reprocess_count",
        }
        identifiers = {
            "row_id", "job_id", "docx_job_id", "pipeline_version", "status", "validation_state",
            "round_trip_state", "media_round_trip_state", "structure_state",
        }
        text_fields = {"original_filename", "detected_skill", "error", "publish_error"}
        for row in rows:
            if not isinstance(row, dict):
                continue
            clean: Dict[str, Any] = {
                key: row[key] for key in counters
                if isinstance(row.get(key), (int, float)) and not isinstance(row.get(key), bool)
            }
            clean.update({key: row[key] for key in identifiers | text_fields if isinstance(row.get(key), str)})
            for key in ("status", "validation_state", "round_trip_state", "media_round_trip_state", "structure_state"):
                if key in clean:
                    clean[key] = _safe_public_identifier(clean[key], upper=True)
            for key in ("row_id", "job_id", "docx_job_id", "pipeline_version"):
                if key in clean:
                    clean[key] = _safe_public_identifier(clean[key])
            for key in ("original_filename", "detected_skill"):
                if key in clean:
                    clean[key] = _safe_public_text(clean[key], limit=260)
            for key in ("error", "publish_error"):
                if key in clean:
                    clean[key] = _safe_public_text(clean[key])
            clean["progress"] = _public_progress(row.get("progress"))
            clean["diagnostics"] = _public_diagnostics(row.get("diagnostics"))
            coverage = row.get("source_coverage")
            if isinstance(coverage, dict):
                coverage_identifiers = {"state", "status"}
                coverage_counters = {"total", "meaningful", "accounted", "preserved", "normalized", "media_assets", "ignored_decoration", "manual_review_required", "percentage", "coverage_ratio", "total_blocks", "meaningful_blocks", "accounted_blocks", "unresolved_blocks"}
                clean["source_coverage"] = {
                    key: _safe_public_identifier(value, upper=True)
                    for key, value in coverage.items()
                    if key in coverage_identifiers and isinstance(value, str)
                }
                clean["source_coverage"].update({
                    key: value for key, value in coverage.items()
                    if key in coverage_counters and isinstance(value, (bool, int, float))
                })
                by_state = coverage.get("by_state")
                if isinstance(by_state, dict):
                    clean["source_coverage"]["by_state"] = {
                        key: value for key, value in by_state.items()
                        if key in {"PRESERVED", "NORMALIZED", "MEDIA_ASSET", "IGNORED_DECORATION", "MANUAL_REVIEW_REQUIRED"}
                        and isinstance(value, int) and not isinstance(value, bool) and value >= 0
                    }
            status = str(row.get("status") or "").upper()
            clean["can_retry"] = _retryable_row(row)
            clean["can_reprocess"] = bool(
                status in {"FAILED", "MANUAL_REVIEW"} and row.get("source_blob")
                and current_pipeline_version
                and str(row.get("pipeline_version") or "") != current_pipeline_version
            )
            clean["reclaimable"] = status == "PROCESSING" and int(row.get("lease_expires_at") or 0) <= now
            public_rows.append(clean)
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
                    if expired:
                        row["retry_history"] = _attempt_history(row, now, "LEASE_RECLAIM")
                        row["job_id"] = uuid.uuid4().hex
                        row["docx_job_id"] = ""
                        for key in ATTEMPT_ARTIFACT_KEYS:
                            if key != "checkpoint_blob":
                                row.pop(key, None)
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

    def set_checkpoint(self, batch_id: str, row_id: str, worker_id: str, blob: str) -> bool:
        """Publish a private checkpoint pointer only while the writer owns this row."""
        now = _now_ms()

        def save(transaction):
            ref = self._batch_ref(batch_id)
            snapshot = ref.get(transaction=transaction)
            if not snapshot.exists:
                return False
            payload = snapshot.to_dict() or {}
            rows = [dict(row) for row in payload.get("results") if isinstance(row, dict)]
            for index, row in enumerate(rows):
                if str(row.get("row_id") or "") != row_id:
                    continue
                if row.get("status") != "PROCESSING" or row.get("lease_owner") != worker_id:
                    return False
                expected = self._blob_name("batches", batch_id, "jobs", str(row.get("job_id") or "")) + "/"
                if not str(blob).startswith(expected) or not str(blob).endswith(".json"):
                    raise ValueError("Checkpoint must belong to the active processing attempt.")
                slot_id = str(row.get("lease_slot") or "")
                if not slot_id:
                    return False
                slot = self._slot_ref(slot_id).get(transaction=transaction)
                slot_data = slot.to_dict() or {}
                if not slot.exists or slot_data.get("worker_id") != worker_id or slot_data.get("row_id") != row_id or slot_data.get("batch_id") != batch_id:
                    return False
                row["checkpoint_blob"] = str(blob)
                row["updatedAt"] = now
                rows[index] = row
                transaction.update(ref, {"results": rows, "updatedAt": now})
                return True
            return False

        return bool(self._transactional(save))

    def defer_file(self, batch_id: str, row_id: str, worker_id: str, progress: Optional[Dict[str, Any]] = None) -> bool:
        """Release an invocation's lease while retaining its durable completed units."""
        return self.complete_file(batch_id, row_id, worker_id, {
            "status": "QUEUED", "job_id": uuid.uuid4().hex,
            "progress": {**dict(progress or {}), "stage": "RESUME_QUEUED", "updatedAt": _now_ms()},
        })

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
                if str(row.get("status") or "").upper() != "PROCESSING":
                    return False
                slot_id = str(row.get("lease_slot") or "")
                slot_ref = self._slot_ref(slot_id) if slot_id else None
                slot = slot_ref.get(transaction=transaction) if slot_ref is not None else None
                if slot is None or not slot.exists or str((slot.to_dict() or {}).get("worker_id") or "") != worker_id:
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

    def retry_retriable_files(self, batch_id: str) -> int:
        """Requeue only transient provider failures; format/manual-review rows stay protected."""
        now = _now_ms()

        def retry(transaction):
            ref = self._batch_ref(batch_id)
            snapshot = ref.get(transaction=transaction)
            if not snapshot.exists:
                return 0
            payload = snapshot.to_dict() or {}
            rows = [dict(row) for row in payload.get("results") if isinstance(row, dict)]
            retried = 0
            for index, row in enumerate(rows):
                status = str(row.get("status") or "").upper()
                if not _retryable_row(row):
                    continue
                history = _attempt_history(row, now, "TRANSIENT_RETRY")
                row.update({
                    "status": "QUEUED",
                    "job_id": uuid.uuid4().hex,
                    "docx_job_id": "",
                    "question_count": int(row.get("question_count") or 0) if row.get("checkpoint_blob") else 0,
                    "solved_count": int(row.get("solved_count") or 0) if row.get("checkpoint_blob") else 0,
                    "explanation_count": int(row.get("explanation_count") or 0) if row.get("checkpoint_blob") else 0,
                    "validation_state": "PENDING",
                    "repair_count": 0,
                    "round_trip_state": "NOT_RUN",
                    "media_count": 0,
                    "media_round_trip_state": "NOT_RUN",
                    "error": "",
                    "publish_error": "",
                    "diagnostics": [],
                    "progress": {"stage": "RETRY_QUEUED", "retryCount": len(history), "updatedAt": now},
                    "retry_history": history,
                    "updatedAt": now,
                })
                for key in ("output_blob", "parser_blob", "issues_blob", "media_manifest_blob", "result_blob"):
                    row.pop(key, None)
                rows[index] = row
                retried += 1
            if not retried:
                return 0
            batch_status, completed = self._batch_status(rows)
            transaction.update(ref, {
                "results": rows,
                "status": batch_status,
                "completedCount": completed,
                "updatedAt": now,
            })
            return retried

        return int(self._transactional(retry) or 0)

    def reprocess_failed_files(self, batch_id: str, pipeline_version: str, *, actor: str = "", row_ids: Optional[Iterable[str]] = None) -> int:
        """Explicitly rebuild old terminal failures from their original durable source."""
        pipeline_version = str(pipeline_version or "").strip()
        if not pipeline_version or len(pipeline_version) > 120:
            raise ValueError("The current pipeline version is required.")
        selected = {str(value) for value in row_ids} if row_ids is not None else None
        now = _now_ms()

        def reprocess(transaction):
            ref = self._batch_ref(batch_id)
            snapshot = ref.get(transaction=transaction)
            if not snapshot.exists:
                return 0
            payload = snapshot.to_dict() or {}
            rows = [dict(row) for row in payload.get("results") if isinstance(row, dict)]
            count = 0
            for index, row in enumerate(rows):
                if selected is not None and str(row.get("row_id") or "") not in selected:
                    continue
                if str(row.get("status") or "").upper() not in {"FAILED", "MANUAL_REVIEW"} or not row.get("source_blob"):
                    continue
                if str(row.get("pipeline_version") or "") == pipeline_version:
                    continue
                history = _attempt_history(row, now, "REPROCESS_LATEST", actor)
                row.update({
                    "status": "QUEUED", "job_id": uuid.uuid4().hex, "docx_job_id": "",
                    "pipeline_version": pipeline_version, "question_count": 0, "solved_count": 0,
                    "explanation_count": 0, "validation_state": "PENDING", "repair_count": 0,
                    "round_trip_state": "NOT_RUN", "media_count": 0, "media_round_trip_state": "NOT_RUN",
                    "error": "", "publish_error": "", "diagnostics": [], "retry_history": history,
                    "reprocess_count": int(row.get("reprocess_count") or 0) + 1,
                    "progress": {"stage": "REPROCESS_QUEUED", "updatedAt": now}, "updatedAt": now,
                })
                for key in (*ATTEMPT_ARTIFACT_KEYS, "source_coverage", "structure_state", "detected_skill", "lease_owner", "lease_expires_at", "lease_slot"):
                    row.pop(key, None)
                rows[index] = row
                count += 1
            if count:
                status, completed = self._batch_status(rows)
                transaction.update(ref, {"results": rows, "status": status, "completedCount": completed, "updatedAt": now})
            return count

        return int(self._transactional(reprocess) or 0)

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
