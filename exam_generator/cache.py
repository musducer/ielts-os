"""Hash-addressed cache and resumable job state.  No generated content is shared by default."""

from __future__ import annotations

import hashlib
import json
import os
import threading
from pathlib import Path
from typing import Any, Dict, Optional

from .jobs import transition_record


class StateStore:
    def __init__(self, root: str | Path):
        self.root = Path(root)
        self.cache_dir = self.root / "cache"
        self.jobs_dir = self.root / "jobs"
        self.batches_dir = self.root / "batches"
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.jobs_dir.mkdir(parents=True, exist_ok=True)
        self.batches_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    @staticmethod
    def digest(payload: Dict[str, Any]) -> str:
        canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    def cache_get(self, key: str) -> Optional[Dict[str, Any]]:
        path = self.cache_dir / f"{key}.json"
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None

    def cache_put(self, key: str, payload: Dict[str, Any]) -> None:
        self._write_json(self.cache_dir / f"{key}.json", payload)

    def job_path(self, job_id: str) -> Path:
        path = self.jobs_dir / job_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    def save_job(self, job_id: str, payload: Dict[str, Any]) -> None:
        self._write_json(self.job_path(job_id) / "state.json", payload)

    def load_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        path = self.jobs_dir / job_id / "state.json"
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None

    def save_batch(self, batch_id: str, payload: Dict[str, Any]) -> None:
        self._write_json(self.batches_dir / f"{batch_id}.json", payload)

    def load_batch(self, batch_id: str) -> Optional[Dict[str, Any]]:
        path = self.batches_dir / f"{batch_id}.json"
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None

    def transition_job(
        self,
        job_id: str,
        target: str,
        patch: Optional[Dict[str, Any]] = None,
        expected_revision: Optional[int] = None,
    ) -> Dict[str, Any]:
        with self._lock:
            current = self.load_job(job_id) or {"job_id": job_id, "status": "QUEUED", "revision": 0}
            updated = transition_record(current, target, expected_revision)
            if patch:
                updated.update(patch)
            self._write_json_unlocked(self.job_path(job_id) / "state.json", updated)
            return updated

    def _write_json(self, path: Path, payload: Dict[str, Any]) -> None:
        temporary = path.with_suffix(path.suffix + ".tmp")
        content = json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True)
        with self._lock:
            self._write_json_unlocked(path, payload)

    @staticmethod
    def _write_json_unlocked(path: Path, payload: Dict[str, Any]) -> None:
        temporary = path.with_suffix(path.suffix + ".tmp")
        content = json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True)
        temporary.write_text(content, encoding="utf-8")
        os.replace(temporary, path)
