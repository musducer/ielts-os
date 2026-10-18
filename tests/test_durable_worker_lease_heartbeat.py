import os
import threading
import time
import unittest
from unittest.mock import patch

from api import index


class _Result:
    output_path = ""
    parser_quiz = None
    issues = []
    status = "FAILED"

    def __init__(self):
        self.progress = {"stage": "FAILED"}

    def to_dict(self):
        return {
            "job_id": "job-heartbeat",
            "status": self.status,
            "progress": dict(self.progress),
            "issues": list(self.issues),
        }


class _SleepingPipeline:
    instances = []

    def __init__(self, config):
        self.config = config
        self.__class__.instances.append(self)

    def generate(self, _source, _requirements, *, on_progress=None, **_kwargs):
        if on_progress:
            on_progress({"stage": "GENERATING"})
        time.sleep(0.12)
        return _Result()


class _Store:
    def __init__(self, *, lose_after=None):
        self.lose_after = lose_after
        self.progress_calls = []
        self.uploads = []
        self.completed = []
        self.jobs = []

    def update_progress(self, _batch_id, _row_id, _worker_id, progress, *, lease_ms):
        self.progress_calls.append((time.monotonic(), dict(progress), lease_ms))
        return self.lose_after is None or len(self.progress_calls) <= self.lose_after

    def download_source(self, _blob):
        return b"raw DOCX bytes"

    def upload_json(self, _batch_id, _job_id, label, _payload):
        self.uploads.append(label)
        return f"private/{label}.json"

    def put_job(self, job_id, payload):
        self.jobs.append((job_id, dict(payload)))

    def complete_file(self, _batch_id, _row_id, _worker_id, patch_payload):
        self.completed.append(dict(patch_payload))
        return True


def _claim():
    return {
        "batch_id": "batch-heartbeat",
        "row_id": "row-heartbeat",
        "delivery_mode": "exam",
        "publication_policy": "draft",
        "row": {
            "original_filename": "raw.docx",
            "job_id": "job-heartbeat",
            "source_blob": "private/source.docx",
        },
    }


class DurableWorkerLeaseHeartbeatTests(unittest.TestCase):
    def setUp(self):
        _SleepingPipeline.instances = []

    def _run(self, store):
        with patch.object(index, "_durable_lease_heartbeat_interval", return_value=0.01), patch(
            "exam_generator.pipeline.ExamGenerationPipeline", _SleepingPipeline
        ), patch.dict(os.environ, {"EXAM_GENERATION_QUESTION_WORKERS": "2"}):
            return index._run_durable_exam_generation_file(store, "batch-heartbeat", "worker-heartbeat", _claim())

    def test_heartbeat_renews_lease_while_pipeline_is_blocked_and_joins(self):
        store = _Store()
        before = {thread.ident for thread in threading.enumerate()}

        self.assertTrue(self._run(store))

        self.assertGreaterEqual(len(store.progress_calls), 4)
        self.assertEqual(len(store.completed), 1)
        self.assertEqual(_SleepingPipeline.instances[-1].config.question_workers, 2)
        self.assertFalse(any(
            thread.ident not in before and thread.name.startswith("exam-generation-lease-")
            for thread in threading.enumerate()
        ))

    def test_transient_timer_renewal_failure_recovers_without_failing_file(self):
        class TemporarilyUnavailableStore(_Store):
            def update_progress(self, *args, **kwargs):
                renewed = super().update_progress(*args, **kwargs)
                if len(self.progress_calls) == 3:
                    raise ConnectionError("Temporary Firestore outage")
                return renewed

        store = TemporarilyUnavailableStore()

        self.assertTrue(self._run(store))

        self.assertGreater(len(store.progress_calls), 3)
        self.assertEqual(len(store.completed), 1)
        self.assertEqual(store.uploads, ["result", "issues"])

    def test_lost_lease_prevents_stale_artifacts_job_write_and_terminal_completion(self):
        # Initial source progress and the explicit pre-run fence succeed. The first
        # timer renewal then observes that another worker owns the lease.
        store = _Store(lose_after=2)

        self.assertFalse(self._run(store))

        self.assertGreaterEqual(len(store.progress_calls), 3)
        self.assertEqual(store.uploads, [])
        self.assertEqual(store.jobs, [])
        self.assertEqual(store.completed, [])


if __name__ == "__main__":
    unittest.main()
