import unittest

from api.index import _attempt_is_expired


DAY_MS = 24 * 60 * 60 * 1000


class RetentionPolicyTests(unittest.TestCase):
    def test_regular_attempt_expires_after_thirty_days(self):
        now = 2_000 * DAY_MS
        self.assertTrue(_attempt_is_expired({"submittedAt": now - 30 * DAY_MS}, now))
        self.assertFalse(_attempt_is_expired({"submittedAt": now - 30 * DAY_MS + 1}, now))

    def test_writing_waits_for_published_grading(self):
        now = 2_000 * DAY_MS
        pending = {"submissionId": "writing_attempt", "writingGrading": {"status": "awaiting_grading"}}
        draft = {"submissionId": "writing_attempt", "writingGrading": {"status": "draft"}}
        published = {
            "submissionId": "writing_attempt",
            "writingGrading": {"status": "published", "publishedAt": now - 30 * DAY_MS},
        }
        self.assertFalse(_attempt_is_expired(pending, now))
        self.assertFalse(_attempt_is_expired(draft, now))
        self.assertTrue(_attempt_is_expired(published, now))


if __name__ == "__main__":
    unittest.main()
