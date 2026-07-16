import json
import unittest
from unittest.mock import patch

from api.index import _classify_vocab_items, _normalize_vocab_items


def item(word, category="idiom", **extra):
    return {
        "word": word,
        "category": category,
        "source_sentence": extra.pop("source_sentence", f"The text contains {word} in context."),
        "meaning_en": extra.pop("meaning_en", "test meaning"),
        **extra,
    }


class VocabClassificationTests(unittest.TestCase):
    def test_literal_phrases_cannot_survive_as_idioms_without_evidence(self):
        normalized = _normalize_vocab_items([
            item("up to date"),
            item("come close to doing"),
            item("make a note of"),
        ])
        self.assertEqual([entry["category"] for entry in normalized], [
            "collocation", "collocation", "collocation",
        ])

    def test_phrasal_verb_with_object_is_canonicalized(self):
        normalized = _normalize_vocab_items([item("burn off excess energy")])
        self.assertEqual(len(normalized), 1)
        self.assertEqual(normalized[0]["word"], "burn off")
        self.assertEqual(normalized[0]["category"], "phrasal_verb")

    def test_trivial_prepositional_verb_is_dropped(self):
        self.assertEqual(_normalize_vocab_items([item("get to")]), [])

    def test_classifier_drop_sentinel_cannot_be_resurrected(self):
        self.assertEqual(_normalize_vocab_items([item("random adjacent words", "__drop__")]), [])

    def test_genuine_idiom_is_preserved(self):
        normalized = _normalize_vocab_items([item("you're in luck")])
        self.assertEqual(normalized[0]["category"], "idiom")

    @patch("api.index._vocab_chat")
    def test_structured_features_drive_final_categories(self, vocab_chat):
        decisions = [
            {
                "word": "burn off excess energy", "keep": True, "established": True,
                "lexical_type": "phrasal_verb", "canonical_form": "burn off",
                "figurative": False, "confidence": "high",
            },
            {
                "word": "up to date", "keep": True, "established": True,
                "lexical_type": "collocation", "canonical_form": "up to date",
                "figurative": False, "confidence": "high",
            },
            {
                "word": "invented shiny metaphor", "keep": False, "established": False,
                "lexical_type": "not_lexical", "canonical_form": "",
                "figurative": True, "confidence": "high",
            },
        ]
        vocab_chat.return_value = (json.dumps(decisions), "")
        candidates = [
            item("burn off excess energy", source_sentence="Children burn off excess energy outside."),
            item("up to date"),
            item("invented shiny metaphor"),
        ]

        classified = _normalize_vocab_items(_classify_vocab_items(candidates))

        self.assertEqual([(entry["word"], entry["category"]) for entry in classified], [
            ("burn off", "phrasal_verb"),
            ("up to date", "collocation"),
        ])


if __name__ == "__main__":
    unittest.main()
