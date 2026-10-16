import asyncio
import base64
import os
import unittest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi import HTTPException
from api import index


class TestGcpVertexIntegration(unittest.TestCase):
    def setUp(self):
        index._reset_gcp_daily_counter_for_test()

    def tearDown(self):
        index._reset_gcp_daily_counter_for_test()

    def test_gcp_disabled_by_env(self):
        with patch.dict(os.environ, {"ENABLE_GCP_VERTEX": "0"}):
            token, project = index._get_gcp_access_token_and_project()
            self.assertIsNone(token)
            self.assertIsNone(project)

        with patch.dict(os.environ, {"ENABLE_GCP_VERTEX": "false"}):
            token, project = index._get_gcp_access_token_and_project()
            self.assertIsNone(token)
            self.assertIsNone(project)

    def test_gcp_daily_cap_circuit_breaker(self):
        with patch.dict(os.environ, {"GCP_DAILY_REQUEST_CAP": "2"}):
            self.assertTrue(index._check_and_increment_gcp_quota())
            self.assertTrue(index._check_and_increment_gcp_quota())
            # 3rd request hits the cap and trips circuit breaker
            self.assertFalse(index._check_and_increment_gcp_quota())

    def test_vertex_gemini_fallback_when_disabled(self):
        with patch.dict(os.environ, {"ENABLE_GCP_VERTEX": "0"}):
            text, err = index._vertex_gemini_generate("Hello test")
            self.assertEqual(text, "")
            self.assertEqual(err, "VERTEX_DISABLED")

    def test_vertex_gemini_fallback_when_quota_exceeded(self):
        with patch.dict(os.environ, {"ENABLE_GCP_VERTEX": "1"}), \
             patch.object(index, "_check_and_increment_gcp_quota", return_value=False):
            text, err = index._vertex_gemini_generate("Hello test")
            self.assertEqual(text, "")
            self.assertEqual(err, "VERTEX_UNCONFIGURED")

    def test_hosted_audio_headers(self):
        # Verify that hosted_audio sets the required Edge CDN immutable cache and range headers
        raw_key = "exam-audio/test/aud123/file.mp3|valid-token-1234567890"
        audio_key = base64.urlsafe_b64encode(raw_key.encode("utf-8")).decode("ascii").rstrip("=")

        mock_request = MagicMock()
        mock_request.headers = {}
        mock_request.method = "GET"

        mock_upstream = MagicMock()
        mock_upstream.status = 200
        mock_upstream.headers = {"Accept-Ranges": "bytes", "Content-Type": "audio/mpeg"}
        mock_upstream.read.side_effect = [b"chunk1", b""]

        with patch("urllib.request.urlopen", return_value=mock_upstream):
            response = asyncio.run(index.hosted_audio(mock_request, audio_key, "file.mp3"))
            self.assertEqual(
                response.headers.get("Cache-Control"),
                "public, max-age=31536000, s-maxage=31536000, immutable"
            )
            self.assertEqual(response.headers.get("Accept-Ranges"), "bytes")

    def test_hosted_exam_media_headers(self):
        # Verify that hosted_exam_media sets Edge CDN caching headers
        mock_store = MagicMock()
        mock_store.load_media.return_value = {"blob": "test_blob", "mime_type": "image/png"}
        mock_store.download_blob.return_value = b"image_bytes"

        with patch.object(index, "_firebase_exam_generation_store", return_value=mock_store):
            valid_asset_id = "media_" + "a" * 24
            response = asyncio.run(index.hosted_exam_media(valid_asset_id))
            self.assertEqual(
                response.headers.get("Cache-Control"),
                "public, max-age=31536000, s-maxage=31536000, immutable"
            )
            self.assertEqual(response.headers.get("Accept-Ranges"), "bytes")

    def test_scan_exam_page_validation(self):
        # Empty files list raises 400
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(index.scan_exam_page(files=[]))
        self.assertEqual(ctx.exception.status_code, 400)

        # > 5 files raises 400
        mock_files = [MagicMock() for _ in range(6)]
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(index.scan_exam_page(files=mock_files))
        self.assertEqual(ctx.exception.status_code, 400)

        # Unsupported file extension raises 400
        bad_file = MagicMock()
        bad_file.filename = "exam.exe"
        bad_file.content_type = "application/octet-stream"
        bad_file.read = AsyncMock(return_value=b"dummy")
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(index.scan_exam_page(files=[bad_file]))
        self.assertEqual(ctx.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
