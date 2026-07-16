import unittest

from api.index import _answer_anchor_seconds, _filter_fake_timestamps


CONTEXT = """(0:10 - 0:20)
The caller says the answer is error and asks for help.

(1:15 - 1:25)
The agent repeats the word error while explaining the follow-up process.
"""


class ListeningTimestampTests(unittest.TestCase):
    def test_ordered_answers_select_the_first_matching_occurrence(self):
        self.assertEqual(
            _answer_anchor_seconds(CONTEXT, "error", ["error", "other"], 0),
            10,
        )

    def test_ordered_answers_select_the_second_matching_occurrence(self):
        self.assertEqual(
            _answer_anchor_seconds(CONTEXT, "error", ["error", "error"], 1),
            75,
        )

    def test_wrong_but_valid_model_marker_is_removed(self):
        explanation = _filter_fake_timestamps(
            "The answer is error. Listen again: [1:15]",
            CONTEXT,
            "error",
            "en",
            ["error", "other"],
            0,
        )
        self.assertIn("[0:10]", explanation)
        self.assertNotIn("[1:15]", explanation)

    def test_unproven_marker_is_removed_instead_of_presented_as_evidence(self):
        explanation = _filter_fake_timestamps(
            "The answer is error. Listen again: [1:15]",
            CONTEXT,
            "not present",
            "en",
        )
        self.assertNotIn("[1:15]", explanation)


if __name__ == "__main__":
    unittest.main()
