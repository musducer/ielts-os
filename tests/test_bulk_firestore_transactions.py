import copy
import unittest
from unittest.mock import patch

from api import index


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

    def collection(self, name):
        return _Collection(self._database, (*self._path, str(name)))

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

    def set(self, reference, payload):
        self._database.documents[reference._path] = copy.deepcopy(payload)

    def update(self, reference, payload):
        self._database.documents[reference._path].update(copy.deepcopy(payload))


class _Database:
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


class BulkFirestoreTransactionTests(unittest.TestCase):
    def test_claim_and_unpublish_use_started_transaction_wrapper(self):
        database = _Database()
        quiz_path = ("ielts_workspace", "trung_linh_data", "quizzes", "exam-1")
        database.documents[quiz_path] = {
            "id": "exam-1", "title": "Listening", "type": "Listening",
            "questions": [{"correctAnswer": "A"}], "active": True, "revision": 4,
        }
        actor = {"email": "teacher@example.test"}

        with patch.object(index, "firebase_firestore", _Firestore):
            replay = index._claim_bulk_operation(database, "unpublish_exam_1", "fingerprint", actor)
            self.assertIsNone(replay)
            result = index._apply_bulk_quiz_action(database, ["exam-1"], actor, "unpublish")

        self.assertTrue(result[0]["success"])
        self.assertFalse(database.documents[quiz_path]["active"])
        self.assertEqual(database.documents[quiz_path]["revision"], 5)
        self.assertEqual(database.documents[quiz_path]["deliveryAudit"][-1]["action"], "unpublish")


if __name__ == "__main__":
    unittest.main()
