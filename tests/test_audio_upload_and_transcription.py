import asyncio
import base64
import copy
import hashlib
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from api import index


def _managed_audio_key(storage_path: str, token: str) -> str:
    return base64.urlsafe_b64encode(f"{storage_path}|{token}".encode("utf-8")).decode("ascii").rstrip("=")


class _AudioSnapshot:
    def __init__(self, value):
        self._value = copy.deepcopy(value) if value is not None else None
        self.exists = value is not None

    def to_dict(self):
        return copy.deepcopy(self._value)


class _AudioDocument:
    def __init__(self, collection, document_id):
        self.collection = collection
        self.document_id = document_id
        self.set_calls = []

    def get(self):
        return _AudioSnapshot(self.collection.records.get(self.document_id))

    def set(self, value, merge=False):
        payload = copy.deepcopy(value)
        self.set_calls.append((payload, merge))
        if merge and self.document_id in self.collection.records:
            self.collection.records[self.document_id].update(payload)
        else:
            self.collection.records[self.document_id] = payload


class _AudioCollection:
    def __init__(self):
        self.records = {}
        self.documents = {}

    def document(self, document_id):
        if document_id not in self.documents:
            self.documents[document_id] = _AudioDocument(self, document_id)
        return self.documents[document_id]


class _AudioBlob:
    def __init__(self, name):
        self.name = name
        self.size = 0
        self.content_type = ""
        self.metadata = {}
        self.header = b""
        self.reload_error = None
        self.signed_url_kwargs = None
        self.download_kwargs = None
        self.reload_count = 0
        self.patch_count = 0

    def generate_signed_url(self, **kwargs):
        self.signed_url_kwargs = kwargs
        return f"https://storage.example/signed-put/{self.name}"

    def reload(self):
        if self.reload_error:
            raise self.reload_error
        self.reload_count += 1

    def download_as_bytes(self, **kwargs):
        self.download_kwargs = kwargs
        return self.header

    def patch(self):
        self.patch_count += 1


class _AudioBucket:
    def __init__(self):
        self.blobs = {}
        self.blob_calls = []
        self.cors = []
        self.patch_count = 0

    def patch(self):
        self.patch_count += 1

    def blob(self, name):
        self.blob_calls.append(name)
        if name not in self.blobs:
            self.blobs[name] = _AudioBlob(name)
        return self.blobs[name]


class _ExternalAudioResponse:
    def __init__(self, raw=b"ID3 audio", content_type="audio/mpeg", content_length=None):
        self.raw = raw
        self.headers = {
            "Content-Type": content_type,
            "Content-Length": str(len(raw) if content_length is None else content_length),
        }
        self.read_size = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self, size=-1):
        self.read_size = size
        return self.raw if size < 0 else self.raw[:size]


class AudioUploadMetadataTests(unittest.TestCase):
    def test_safe_audio_metadata_is_canonicalized_at_the_upload_boundary(self):
        metadata = index._validate_audio_upload_metadata("listening.mp3", "audio/mpeg; charset=binary", 1234)

        self.assertEqual(metadata["filename"], "listening.mp3")
        self.assertEqual(metadata["content_type"], "audio/mpeg")
        self.assertEqual(metadata["size"], 1234)

    def test_audio_upload_limit_is_larger_than_one_whisper_request_but_exact_cap_is_allowed(self):
        self.assertGreater(index.MAX_AUDIO_UPLOAD_BYTES, index.MAX_WHISPER_TRANSCRIPTION_BYTES)

        metadata = index._validate_audio_upload_metadata(
            "long-listening.m4a", "audio/mp4", index.MAX_AUDIO_UPLOAD_BYTES
        )

        self.assertEqual(metadata["size"], index.MAX_AUDIO_UPLOAD_BYTES)

    def test_unsafe_filename_mime_and_size_are_rejected_before_storage(self):
        invalid_cases = [
            ("../outside.mp3", "audio/mpeg", 100),
            ("recording.txt", "text/plain", 100),
            ("recording.mp3", "audio/mpeg", 0),
            ("recording.mp3", "audio/mpeg", True),
            ("recording.mp3", "audio/mpeg", index.MAX_AUDIO_UPLOAD_BYTES + 1),
        ]

        for filename, content_type, size in invalid_cases:
            with self.subTest(filename=filename, content_type=content_type, size=size):
                with self.assertRaises(ValueError):
                    index._validate_audio_upload_metadata(filename, content_type, size)


class ManagedAudioSourceTests(unittest.TestCase):
    def setUp(self):
        self.origin = "https://app.example.test"
        self.storage_path = "exam-audio/teacher-user-17/upload-ticket-42/listening.mp3"
        self.token = "opaque-firebase-download-token"
        self.key = _managed_audio_key(self.storage_path, self.token)

    def test_only_a_trusted_hosted_audio_url_is_decoded_to_its_managed_source(self):
        url = f"{self.origin}/api/audio/{self.key}/listening.mp3"
        with patch.object(index, "ALLOWED_ORIGINS", (self.origin,)):
            source = index._managed_audio_source_from_url(url)

        self.assertEqual(source, {
            "storage_path": self.storage_path,
            "token": self.token,
            "filename": "listening.mp3",
        })

    def test_arbitrary_or_malformed_urls_cannot_be_used_as_transcription_sources(self):
        managed_path = f"/api/audio/{self.key}/listening.mp3"
        invalid_urls = [
            f"https://evil.example{managed_path}",
            "https://drive.google.com/file/d/untrusted-audio/view",
            f"http://app.example.test{managed_path}",
            "https://app.example.test/api/audio/not-a-valid-key/listening.mp3",
            f"https://app.example.test/api/audio/{_managed_audio_key('other-bucket/listening.mp3', self.token)}/listening.mp3",
            f"https://app.example.test/api/audio/{self.key}/%2E%2E%2Fother.mp3",
        ]

        with patch.object(index, "ALLOWED_ORIGINS", (self.origin,)), patch.object(
            index.urllib.request, "urlopen"
        ) as urlopen:
            for url in invalid_urls:
                with self.subTest(url=url):
                    self.assertIsNone(index._managed_audio_source_from_url(url))
            urlopen.assert_not_called()


class AudioTranscriptionSourceTests(unittest.TestCase):
    def setUp(self):
        self.origin = "https://app.example.test"
        self.storage_path = "exam-audio/teacher-user-17/upload-ticket-42/listening.mp3"
        self.token = "opaque-firebase-download-token"
        self.key = _managed_audio_key(self.storage_path, self.token)

    def test_internal_audio_transcription_reads_storage_directly_without_self_http(self):
        bucket = _AudioBucket()
        blob = bucket.blob(self.storage_path)
        blob.size = 128
        blob.content_type = "audio/mpeg"
        blob.metadata = {"firebaseStorageDownloadTokens": self.token}
        blob.header = b"ID3" + b"\0" * 125
        audio_url = f"{self.origin}/api/audio/{self.key}/listening.mp3"

        with patch.object(index, "ALLOWED_ORIGINS", (self.origin,)), patch.object(
            index, "_firebase_audio_bucket", return_value=bucket
        ), patch.object(index.urllib.request, "urlopen") as urlopen, patch.object(
            index, "_transcribe_audio_bytes", return_value=("transcript", "", False)
        ) as transcribe:
            text, err, rate_limited = index._transcribe_audio_source(audio_url, "vi")

        self.assertEqual((text, err, rate_limited), ("transcript", "", False))
        urlopen.assert_not_called()
        self.assertEqual(bucket.blob_calls[-1], self.storage_path)
        transcribe.assert_called_once_with(blob.header, "audio/mpeg", "vi")

    def test_external_public_audio_still_uses_http_download_path(self):
        response = _ExternalAudioResponse(raw=b"ID3 external audio", content_type="audio/mpeg")

        with patch.object(index.urllib.request, "urlopen", return_value=response) as urlopen, patch.object(
            index, "_transcribe_audio_bytes", return_value=("external transcript", "", False)
        ) as transcribe:
            text, err, rate_limited = index._transcribe_audio_source("https://cdn.example.test/audio.mp3", "vi")

        self.assertEqual((text, err, rate_limited), ("external transcript", "", False))
        self.assertEqual(urlopen.call_args.kwargs["timeout"], index.EXTERNAL_AUDIO_DOWNLOAD_TIMEOUT_SECONDS)
        self.assertEqual(response.read_size, index.MAX_WHISPER_TRANSCRIPTION_BYTES + 1)
        transcribe.assert_called_once_with(b"ID3 external audio", "audio/mpeg", "vi")

    def test_invalid_internal_audio_token_is_not_fetched_as_external_url(self):
        audio_url = "https://app.example.test/api/audio/not-a-valid-key/listening.mp3"

        with patch.object(index.urllib.request, "urlopen") as urlopen:
            text, err, rate_limited = index._transcribe_audio_source(audio_url, "vi")

        self.assertEqual((text, err, rate_limited), ("", "INTERNAL_AUDIO_RESOLVE_FAILED", False))
        urlopen.assert_not_called()

    def test_missing_internal_audio_blob_returns_specific_code(self):
        bucket = _AudioBucket()
        blob = bucket.blob(self.storage_path)
        blob.reload_error = RuntimeError("404 Not Found")
        audio_url = f"{self.origin}/api/audio/{self.key}/listening.mp3"

        with patch.object(index, "ALLOWED_ORIGINS", (self.origin,)), patch.object(
            index, "_firebase_audio_bucket", return_value=bucket
        ):
            text, err, rate_limited = index._transcribe_audio_source(audio_url, "vi")

        self.assertEqual((text, err, rate_limited), ("", "INTERNAL_AUDIO_NOT_FOUND", False))

    def test_external_audio_timeout_returns_specific_code(self):
        with patch.object(index.urllib.request, "urlopen", side_effect=TimeoutError("timed out")):
            text, err, rate_limited = index._transcribe_audio_source("https://cdn.example.test/audio.mp3", "vi")

        self.assertEqual((text, err, rate_limited), ("", "EXTERNAL_AUDIO_TIMEOUT", False))


class AudioTranscriptionChunkTests(unittest.TestCase):
    def test_chunk_plan_is_contiguous_bounded_and_deterministic_for_long_recordings(self):
        duration_seconds = 7_201
        max_chunk_seconds = 1_800

        first_plan = index._plan_audio_transcription_chunks(duration_seconds, max_chunk_seconds=max_chunk_seconds)
        second_plan = index._plan_audio_transcription_chunks(duration_seconds, max_chunk_seconds=max_chunk_seconds)

        self.assertEqual(first_plan, second_plan)
        self.assertEqual(
            [tuple(chunk) for chunk in first_plan],
            [(0, 1_800), (1_800, 1_800), (3_600, 1_800), (5_400, 1_800), (7_200, 1)],
        )

        cursor = 0
        for start, chunk_duration in first_plan:
            self.assertEqual(start, cursor)
            self.assertGreater(chunk_duration, 0)
            self.assertLessEqual(chunk_duration, max_chunk_seconds)
            cursor += chunk_duration
        self.assertEqual(cursor, duration_seconds)

    def test_short_recording_remains_one_chunk_and_invalid_chunk_cap_is_rejected(self):
        self.assertEqual(
            [tuple(chunk) for chunk in index._plan_audio_transcription_chunks(119, max_chunk_seconds=120)],
            [(0, 119)],
        )
        with self.assertRaises(ValueError):
            index._plan_audio_transcription_chunks(119, max_chunk_seconds=0)

    def test_chunk_transcripts_keep_absolute_whisper_timestamps_after_offset(self):
        relative = "(0:00 - 0:05)\nFirst answer.\n\n(1:02 - 1:07)\nSecond answer.\n\n[1:30] remains prose."

        shifted = index._shift_marked_transcript(relative, offset_seconds=125)

        self.assertEqual(
            shifted,
            "(2:05 - 2:10)\nFirst answer.\n\n(3:07 - 3:12)\nSecond answer.\n\n[1:30] remains prose.",
        )

    def test_timestamp_shift_handles_hour_rollover_without_changing_plain_text(self):
        self.assertEqual(
            index._shift_marked_transcript("(0:10 - 0:15)\nAudio text.", offset_seconds=3_595),
            "(1:00:05 - 1:00:10)\nAudio text.",
        )
        self.assertEqual(index._shift_marked_transcript("No transcript markers.", offset_seconds=999), "No transcript markers.")


class AudioUploadEndpointTests(unittest.TestCase):
    def setUp(self):
        self.actor = {"uid": "teacher-17", "email": "teacher@example.com"}
        self.upload_id = "audio_" + "a" * 32
        self.collection = _AudioCollection()
        self.bucket = _AudioBucket()
        self.payload = {
            "quizId": "quiz_2026_17",
            "fileName": "listening.mp3",
            "contentType": "audio/mpeg; charset=binary",
            "sizeBytes": 128,
        }

    def _pending_ticket(self, *, owner_uid=None, size=128):
        owner_uid = self.actor["uid"] if owner_uid is None else owner_uid
        storage_path = f"exam-audio/{'c' * 24}/{self.upload_id}/listening.mp3"
        self.collection.records[self.upload_id] = {
            "status": "PENDING",
            "ownerUid": owner_uid,
            "ownerEmail": "owner@example.com",
            "quizId": self.payload["quizId"],
            "storagePath": storage_path,
            "filename": "listening.mp3",
            "contentType": "audio/mpeg",
            "sizeBytes": size,
            "expiresAt": 4_000_000_000_000,
        }
        return storage_path

    def test_init_then_complete_uses_a_signed_put_and_returns_only_managed_audio(self):
        with patch.object(index, "_require_exam_manager", return_value=self.actor), patch.object(
            index, "_firebase_admin_firestore_client", return_value=object()
        ), patch.object(index, "_audio_uploads_collection", return_value=self.collection), patch.object(
            index, "_firebase_audio_bucket", return_value=self.bucket
        ), patch.object(index, "_ensure_audio_upload_cors", return_value=None) as ensure_cors, patch.object(
            index.uuid, "uuid4", side_effect=[SimpleNamespace(hex="a" * 32), SimpleNamespace(hex="b" * 32)]
        ), patch.object(index.time, "time", return_value=1_700_000_000):
            created = asyncio.run(index.create_exam_audio_upload(object(), self.payload))

            self.assertEqual(created["uploadId"], self.upload_id)
            self.assertEqual(created["method"], "PUT")
            self.assertEqual(created["requiredHeaders"], {"Content-Type": "audio/mpeg"})
            self.assertEqual(created["maxBytes"], index.MAX_AUDIO_UPLOAD_BYTES)
            ensure_cors.assert_called_once_with(self.bucket)

            owner_hash = hashlib.sha256(self.actor["uid"].encode("utf-8")).hexdigest()[:24]
            storage_path = f"exam-audio/{owner_hash}/{self.upload_id}/listening.mp3"
            blob = self.bucket.blobs[storage_path]
            self.assertEqual(blob.signed_url_kwargs["version"], "v4")
            self.assertEqual(blob.signed_url_kwargs["method"], "PUT")
            self.assertEqual(blob.signed_url_kwargs["content_type"], "audio/mpeg")
            self.assertEqual(blob.signed_url_kwargs["expiration"].total_seconds(), index.AUDIO_UPLOAD_TTL_SECONDS)
            self.assertEqual(self.collection.records[self.upload_id]["storagePath"], storage_path)
            self.assertEqual(self.collection.records[self.upload_id]["sizeBytes"], self.payload["sizeBytes"])
            self.assertEqual(self.collection.records[self.upload_id]["contentType"], "audio/mpeg")

            blob.size = self.payload["sizeBytes"]
            blob.content_type = "audio/mpeg"
            blob.header = b"ID3\x04" + b"\0" * 252
            completed = asyncio.run(index.complete_exam_audio_upload(self.upload_id, object(), {}))

        self.assertTrue(completed["success"])
        self.assertEqual(completed["sizeBytes"], self.payload["sizeBytes"])
        self.assertEqual(completed["contentType"], "audio/mpeg")
        self.assertTrue(completed["audioUrl"].startswith("/api/audio/"))
        self.assertNotIn(storage_path, completed["audioUrl"])
        source = index._managed_audio_source_from_url(completed["audioUrl"])
        self.assertEqual(source["storage_path"], storage_path)
        self.assertEqual(source["filename"], "listening.mp3")
        self.assertEqual(source["token"], "b" * 32)
        self.assertEqual(blob.download_kwargs, {"start": 0, "end": 255})
        self.assertEqual(blob.reload_count, 1)
        self.assertEqual(blob.patch_count, 1)
        self.assertEqual(blob.metadata["firebaseStorageDownloadTokens"], "b" * 32)
        self.assertEqual(self.collection.records[self.upload_id]["status"], "COMPLETE")
        self.assertEqual(self.collection.records[self.upload_id]["audioUrl"], completed["audioUrl"])

    def test_completion_rejects_wrong_size_or_non_audio_signature(self):
        cases = [
            (127, b"ID3\x04", "byte count"),
            (128, b"not audio", "valid audio"),
        ]
        for uploaded_size, header, detail in cases:
            with self.subTest(uploaded_size=uploaded_size, header=header):
                self.collection = _AudioCollection()
                self.bucket = _AudioBucket()
                storage_path = self._pending_ticket()
                blob = self.bucket.blob(storage_path)
                blob.size = uploaded_size
                blob.content_type = "audio/mpeg"
                blob.header = header
                with patch.object(index, "_require_exam_manager", return_value=self.actor), patch.object(
                    index, "_firebase_admin_firestore_client", return_value=object()
                ), patch.object(index, "_audio_uploads_collection", return_value=self.collection), patch.object(
                    index, "_firebase_audio_bucket", return_value=self.bucket
                ), self.assertRaises(HTTPException) as raised:
                    asyncio.run(index.complete_exam_audio_upload(self.upload_id, object(), {}))

                self.assertEqual(raised.exception.status_code, 422)
                self.assertIn(detail, str(raised.exception.detail))
                self.assertEqual(blob.patch_count, 0)
                self.assertEqual(self.collection.records[self.upload_id]["status"], "PENDING")

    def test_other_teacher_cannot_finalize_an_owned_upload(self):
        storage_path = self._pending_ticket(owner_uid="owner-uid")
        with patch.object(index, "_require_exam_manager", return_value={"uid": "other-uid"}), patch.object(
            index, "_firebase_admin_firestore_client", return_value=object()
        ), patch.object(index, "_audio_uploads_collection", return_value=self.collection), patch.object(
            index, "_firebase_audio_bucket", return_value=self.bucket
        ), self.assertRaises(HTTPException) as raised:
            asyncio.run(index.complete_exam_audio_upload(self.upload_id, object(), {}))

        self.assertEqual(raised.exception.status_code, 404)
        self.assertEqual(self.bucket.blob_calls, [])
        self.assertEqual(self.collection.records[self.upload_id]["storagePath"], storage_path)
        self.assertEqual(self.collection.documents[self.upload_id].set_calls, [])

    def test_ensure_storage_bucket_cors_configures_bucket_cors_safely(self):
        bucket = _AudioBucket()
        with patch.object(index, "_BUCKET_CORS_CONFIGURED", False):
            index._ensure_storage_bucket_cors(bucket)
            self.assertEqual(bucket.patch_count, 1)
            self.assertEqual(len(bucket.cors), 1)
            self.assertEqual(bucket.cors[0]["origin"], ["*"])
            self.assertIn("PUT", bucket.cors[0]["method"])
            self.assertIn("OPTIONS", bucket.cors[0]["method"])

    def test_ensure_storage_bucket_cors_handles_permission_error_without_raising(self):
        bucket = _AudioBucket()
        def fail_patch():
            raise RuntimeError("Missing storage.buckets.update permission")
        bucket.patch = fail_patch
        with patch.object(index, "_BUCKET_CORS_CONFIGURED", False):
            # Should not raise exception
            index._ensure_storage_bucket_cors(bucket)

    def test_generate_audio_upload_url_prefers_resumable_session_with_origin(self):
        blob = _AudioBlob("audio.mp3")
        def create_resumable(**kwargs):
            blob.resumable_kwargs = kwargs
            return "https://storage.example/resumable-session/audio.mp3"
        blob.create_resumable_upload_session = create_resumable
        url = index._generate_audio_upload_url(blob, "audio/mpeg", 1024, "https://example.com")
        self.assertEqual(url, "https://storage.example/resumable-session/audio.mp3")
        self.assertEqual(blob.resumable_kwargs, {
            "content_type": "audio/mpeg",
            "size": 1024,
            "origin": "https://example.com",
        })

    def test_generate_audio_upload_url_falls_back_to_signed_url_if_resumable_session_fails(self):
        blob = _AudioBlob("audio.mp3")
        def failing_session(**kwargs):
            raise RuntimeError("Resumable session failed")
        blob.create_resumable_upload_session = failing_session
        url = index._generate_audio_upload_url(blob, "audio/mpeg", 1024, "https://example.com")
        self.assertTrue(url.startswith("https://storage.example/signed-put/"))
        self.assertEqual(blob.signed_url_kwargs["version"], "v4")
        self.assertEqual(blob.signed_url_kwargs["method"], "PUT")

    def test_create_exam_audio_upload_with_origin_header_and_storage_path(self):
        fake_request = SimpleNamespace(headers={"Origin": "https://ielts-os.vercel.app"})
        bucket = _AudioBucket()
        with patch.object(index, "_require_exam_manager", return_value=self.actor), patch.object(
            index, "_firebase_admin_firestore_client", return_value=object()
        ), patch.object(index, "_audio_uploads_collection", return_value=self.collection), patch.object(
            index, "_firebase_audio_bucket", return_value=bucket
        ), patch.object(index, "_ensure_audio_upload_cors", return_value=None), patch.object(
            index.uuid, "uuid4", side_effect=[SimpleNamespace(hex="f" * 32)]
        ), patch.object(index.time, "time", return_value=1_700_000_000):
            created = asyncio.run(index.create_exam_audio_upload(fake_request, self.payload))
            self.assertEqual(created["uploadId"], "audio_" + "f" * 32)
            self.assertIn("storagePath", created)
            self.assertEqual(created["contentType"], "audio/mpeg")
            self.assertIn("audio_" + "f" * 32, created["storagePath"])


if __name__ == "__main__":
    unittest.main()
