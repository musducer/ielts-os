import unittest
from unittest.mock import patch

import docx

from api.index import (
    _AI_KEY_CURSOR,
    _api_key_pool,
    _rotated_api_keys,
    extract_docx_manual_explanations,
    parse_docx_to_quiz,
    parse_manual_explanation_text,
)


class ManualExplanationTests(unittest.TestCase):
    def test_manual_explanation_parser_extracts_quotes_and_timestamps(self):
        parsed = parse_manual_explanation_text(
            'Because the speaker says "annual membership fee" at [02:15 - 02:20].'
        )

        self.assertEqual(parsed["rawText"], 'Because the speaker says "annual membership fee" at [02:15 - 02:20].')
        self.assertEqual(parsed["parsedQuotes"], ["annual membership fee"])
        self.assertEqual(parsed["parsedTimestamps"], [
            {"startTime": 135, "label": "02:15 - 02:20", "endTime": 140},
        ])

    def test_docx_parser_attaches_explanation_without_rendering_tag(self):
        document = docx.Document()
        document.add_paragraph("[TITLE] Manual Explanation Demo")
        document.add_paragraph("[TYPE] Listening")
        document.add_paragraph("[PASSAGE]")
        document.add_paragraph("The transcript contains the annual membership fee.")
        document.add_paragraph("[QUESTIONS]")
        document.add_paragraph("[BLANK]")
        document.add_paragraph("Question 1")
        document.add_paragraph("*annual membership fee")
        document.add_paragraph('[EXPLANATION] 1: The speaker says "annual membership fee" at [02:15].')

        quiz = parse_docx_to_quiz(document)
        question = quiz["questions"][0]

        self.assertNotIn("[EXPLANATION]", question["text"])
        self.assertEqual(question["manualExplanation"]["rawText"], 'The speaker says "annual membership fee" at [02:15].')
        self.assertEqual(question["manualExplanation"]["parsedQuotes"], ["annual membership fee"])
        self.assertEqual(question["manualExplanation"]["parsedTimestamps"], [
            {"startTime": 135, "label": "02:15"},
        ])

    def test_matching_answer_is_stored_as_text_not_letter_or_index(self):
        document = docx.Document()
        document.add_paragraph("[TITLE] Matching Demo")
        document.add_paragraph("[TYPE] Listening")
        document.add_paragraph("[PASSAGE]")
        document.add_paragraph("Transcript.")
        document.add_paragraph("[QUESTIONS]")
        document.add_paragraph("[MATCHING]")
        document.add_paragraph("A. Processing data she had gathered")
        document.add_paragraph("B. Working collaboratively")
        document.add_paragraph("Question 26 Observing lessons")
        document.add_paragraph("*A")

        quiz = parse_docx_to_quiz(document)
        question = quiz["questions"][0]

        self.assertEqual(question["type"], "MATCHING")
        self.assertEqual(question["options"], [
            "Processing data she had gathered",
            "Working collaboratively",
        ])
        self.assertEqual(question["correctAnswer"], "Processing data she had gathered")

    def test_explanation_only_docx_supports_multiline_entries(self):
        document = docx.Document()
        document.add_paragraph('[EXPLANATION] 26: The speaker says "processing data" at [12:04].')
        document.add_paragraph("[EXPLANATION] 27:")
        document.add_paragraph('The clue is "suitable equipment" at [12:10 - 12:13].')

        explanations = extract_docx_manual_explanations(document)

        self.assertEqual(explanations["26"]["parsedQuotes"], ["processing data"])
        self.assertEqual(explanations["27"]["rawText"], 'The clue is "suitable equipment" at [12:10 - 12:13].')
        self.assertEqual(explanations["27"]["parsedTimestamps"], [
            {"startTime": 730, "label": "12:10 - 12:13", "endTime": 733},
        ])

    def test_api_key_pool_supports_numbered_and_comma_separated_keys(self):
        with patch.dict("os.environ", {
            "GROQ_API_KEY": "g1",
            "GROQ_API_KEY_2": "g2",
            "GROQ_API_KEYS": "g3,g4",
        }, clear=False):
            keys = _api_key_pool("GROQ_API_KEY")

        self.assertEqual(keys[:4], ["g1", "g2", "g3", "g4"])

    def test_rotated_api_keys_distributes_starting_key(self):
        _AI_KEY_CURSOR.clear()

        self.assertEqual(_rotated_api_keys("test_provider", ["a", "b", "c"]), ["a", "b", "c"])
        self.assertEqual(_rotated_api_keys("test_provider", ["a", "b", "c"]), ["b", "c", "a"])
        self.assertEqual(_rotated_api_keys("test_provider", ["a", "b", "c"]), ["c", "a", "b"])

    def test_multi_paragraph_explanation_in_questions_block_preserves_breaks_and_does_not_leak(self):
        document = docx.Document()
        document.add_paragraph("[TITLE] Multi-paragraph Explanation Test")
        document.add_paragraph("[TYPE] Reading")
        document.add_paragraph("[PASSAGE]")
        document.add_paragraph("Solar panels harness renewable energy.")
        document.add_paragraph("[QUESTIONS]")
        document.add_paragraph("[BLANK]")
        document.add_paragraph("Question 1")
        document.add_paragraph("*renewable")
        document.add_paragraph('[EXPLANATION] 1: Paragraph 1 explains that the author refers to "renewable energy".')
        document.add_paragraph("Paragraph 2 provides further analysis of why fossil fuels are excluded.")
        document.add_paragraph("Paragraph 3 gives pedagogical advice for IELTS candidates.")
        document.add_paragraph("Question 2")
        document.add_paragraph("*efficiency")

        quiz = parse_docx_to_quiz(document)
        self.assertEqual(len(quiz["questions"]), 2)
        q1 = quiz["questions"][0]
        q2 = quiz["questions"][1]

        self.assertNotIn("Paragraph 2", q1["text"])
        self.assertNotIn("Paragraph 3", q1["text"])
        self.assertIn("Paragraph 1", q1["manualExplanation"]["rawText"])
        self.assertIn("Paragraph 2", q1["manualExplanation"]["rawText"])
        self.assertIn("Paragraph 3", q1["manualExplanation"]["rawText"])
        self.assertIn("\n\nParagraph 2", q1["manualExplanation"]["rawText"])
        self.assertIn("\n\nParagraph 3", q1["manualExplanation"]["rawText"])
        self.assertEqual(q1["manualExplanation"]["parsedQuotes"], ["renewable energy"])

        self.assertEqual(q2["questionNumber"], 2)
        self.assertNotIn("Paragraph 3", q2["text"])

    def test_multi_paragraph_explanation_in_supplement_docx_preserves_breaks(self):
        document = docx.Document()
        document.add_paragraph('[EXPLANATION] 15: First paragraph with quote "cooling tower".')
        document.add_paragraph("Second paragraph explaining the mechanism in detail.")
        document.add_paragraph('[EXPLANATION] 16: Explanation for next question.')

        explanations = extract_docx_manual_explanations(document)
        self.assertIn("15", explanations)
        self.assertIn("First paragraph", explanations["15"]["rawText"])
        self.assertIn("\n\nSecond paragraph", explanations["15"]["rawText"])
        self.assertEqual(explanations["15"]["parsedQuotes"], ["cooling tower"])

    def test_external_diagram_drag_drop_with_image_and_options(self):
        document = docx.Document()
        document.add_paragraph("[TITLE] External Diagram Drag Drop Test")
        document.add_paragraph("[TYPE] Listening")
        document.add_paragraph("[PASSAGE]")
        document.add_paragraph("Listen to the tour guide.")
        document.add_paragraph("[QUESTIONS]")
        document.add_paragraph("[DRAG]")
        document.add_paragraph("IMAGE: https://cdn.example.com/diagrams/education_house.png")
        document.add_paragraph("OPTIONS:")
        document.add_paragraph("A. fresh air is removed")
        document.add_paragraph("B. fresh air is pulled in")
        document.add_paragraph("C. heat loss is reduced")
        document.add_paragraph("F. old air is removed")
        document.add_paragraph("21. Cooling Tower")
        document.add_paragraph("*F. old air is removed")
        document.add_paragraph("22. Weather Station")
        document.add_paragraph("*B")

        quiz = parse_docx_to_quiz(document)
        self.assertEqual(len(quiz["questions"]), 2)
        q21 = quiz["questions"][0]
        q22 = quiz["questions"][1]

        self.assertEqual(q21["groupImageUrl"], "https://cdn.example.com/diagrams/education_house.png")
        self.assertEqual(q22["groupImageUrl"], "https://cdn.example.com/diagrams/education_house.png")
        self.assertIn("[21]", q21["text"])
        self.assertIn("[22]", q22["text"])
        self.assertEqual(q21["correctAnswer"], "F. old air is removed")
        self.assertEqual(q22["correctAnswer"], "B. fresh air is pulled in")

    def test_diagram_label_without_boxes_falls_back_to_external_split(self):
        document = docx.Document()
        document.add_paragraph("[TITLE] Diagram Fallback Test")
        document.add_paragraph("[TYPE] Reading")
        document.add_paragraph("[PASSAGE]")
        document.add_paragraph("Solar energy diagram description.")
        document.add_paragraph("[QUESTIONS]")
        document.add_paragraph("[DIAGRAM_LABEL]")
        document.add_paragraph("IMAGE: https://cdn.example.com/diagrams/solar.png")
        document.add_paragraph("OPTIONS:")
        document.add_paragraph("A. inverter")
        document.add_paragraph("B. battery")
        document.add_paragraph("21. Main panel")
        document.add_paragraph("*A")

        quiz = parse_docx_to_quiz(document)
        self.assertEqual(len(quiz["questions"]), 1)
        q = quiz["questions"][0]
        self.assertEqual(q["groupImageUrl"], "https://cdn.example.com/diagrams/solar.png")
        self.assertEqual(q["type"], "DRAG_DROP")
        self.assertEqual(q["correctAnswer"], "A. inverter")

    def test_single_timestamp_parsing(self):
        document = docx.Document()
        document.add_paragraph("[TITLE] Single Timestamp Test")
        document.add_paragraph("[TYPE] Listening")
        document.add_paragraph("[PASSAGE]")
        document.add_paragraph("Listen to audio.")
        document.add_paragraph("[QUESTIONS]")
        document.add_paragraph("[BLANK]")
        document.add_paragraph("1. Test question")
        document.add_paragraph("*answer")
        document.add_paragraph('[EXPLANATION] 1: Mentioned at [01:24] in the conversation.')

        quiz = parse_docx_to_quiz(document)
        q = quiz["questions"][0]
        timestamps = q["manualExplanation"]["parsedTimestamps"]
        self.assertEqual(len(timestamps), 1)
        self.assertEqual(timestamps[0]["startTime"], 84)
        self.assertIsNone(timestamps[0].get("endTime"))
        self.assertEqual(timestamps[0]["label"], "01:24")

    def test_range_timestamp_parsing_ascii_hyphen(self):
        document = docx.Document()
        document.add_paragraph("[TITLE] Range Timestamp Hyphen Test")
        document.add_paragraph("[TYPE] Listening")
        document.add_paragraph("[PASSAGE]")
        document.add_paragraph("Listen to audio.")
        document.add_paragraph("[QUESTIONS]")
        document.add_paragraph("[BLANK]")
        document.add_paragraph("1. Test question")
        document.add_paragraph("*answer")
        document.add_paragraph('[EXPLANATION] 1: Discussed between [02:14 - 02:18].')

        quiz = parse_docx_to_quiz(document)
        q = quiz["questions"][0]
        timestamps = q["manualExplanation"]["parsedTimestamps"]
        self.assertEqual(len(timestamps), 1)
        self.assertEqual(timestamps[0]["startTime"], 134)
        self.assertEqual(timestamps[0]["endTime"], 138)
        self.assertEqual(timestamps[0]["label"], "02:14 - 02:18")

    def test_range_timestamp_parsing_word_dashes(self):
        # Test en-dash (–)
        res_endash = parse_manual_explanation_text('Discussed between [02:14 \u2013 02:18].')
        ts_endash = res_endash["parsedTimestamps"]
        self.assertEqual(len(ts_endash), 1)
        self.assertEqual(ts_endash[0]["startTime"], 134)
        self.assertEqual(ts_endash[0]["endTime"], 138)
        self.assertEqual(ts_endash[0]["label"], "02:14 - 02:18")

        # Test em-dash (—)
        res_emdash = parse_manual_explanation_text('Discussed between [02:14 \u2014 02:18].')
        ts_emdash = res_emdash["parsedTimestamps"]
        self.assertEqual(len(ts_emdash), 1)
        self.assertEqual(ts_emdash[0]["startTime"], 134)
        self.assertEqual(ts_emdash[0]["endTime"], 138)
        self.assertEqual(ts_emdash[0]["label"], "02:14 - 02:18")

    def test_multiple_timestamps_in_same_explanation(self):
        res = parse_manual_explanation_text('Intro at [01:24], then details follow at [02:14 - 02:18].')
        ts = res["parsedTimestamps"]
        self.assertEqual(len(ts), 2)
        self.assertEqual(ts[0]["startTime"], 84)
        self.assertIsNone(ts[0].get("endTime"))
        self.assertEqual(ts[0]["label"], "01:24")

        self.assertEqual(ts[1]["startTime"], 134)
        self.assertEqual(ts[1]["endTime"], 138)
        self.assertEqual(ts[1]["label"], "02:14 - 02:18")

    def test_firebase_storage_image_url_unescaped(self):
        document = docx.Document()
        document.add_paragraph("[TITLE] Firebase Image Unescape Test")
        document.add_paragraph("[TYPE] Listening")
        document.add_paragraph("[PASSAGE]")
        document.add_paragraph("Listen to audio.")
        document.add_paragraph("[QUESTIONS]")
        document.add_paragraph("[DRAG]")
        document.add_paragraph("IMAGE: https://firebasestorage.googleapis.com/v0/b/app.appspot.com/o/diagram.png?alt=media&token=abc-123")
        document.add_paragraph("OPTIONS:")
        document.add_paragraph("A. turbine")
        document.add_paragraph("21. Generator")
        document.add_paragraph("*A")

        quiz = parse_docx_to_quiz(document)
        self.assertEqual(len(quiz["questions"]), 1)
        q = quiz["questions"][0]
        self.assertNotIn("&amp;", q["groupImageUrl"])
        self.assertEqual(q["groupImageUrl"], "https://firebasestorage.googleapis.com/v0/b/app.appspot.com/o/diagram.png?alt=media&token=abc-123")

    def test_distractor_breakdown_incorrect_never_marked_correct(self):
        # Verify that substring "CORRECT" in "INCORRECT" or distractor reasons does NOT cause misclassification
        raw_distractors = [
            {"option": "A. refer to course notes", "status": "INCORRECT", "reason": "This is incorrect because the speaker never mentioned notes."},
            {"option": "C. practice speaking in pairs", "status": "CORRECT", "reason": "Matches the speaker's advice."},
            {"option": "G. plan for oral interviews", "status": "INCORRECT", "reason": "Making this option incorrect as it contradicts the advice given."},
        ]
        correct = "C"

        import re
        cleaned_d = []
        for d in raw_distractors:
            opt = str(d.get("option") or "").strip()
            raw_status = str(d.get("status") or "").strip()
            raw_reason = str(d.get("reason") or "").strip()
            status_upper = raw_status.upper()
            is_elim = any(k in status_upper for k in ["ELIMINATE", "INCORRECT", "WRONG", "FALSE", "TRAP", "DISTRACTOR"])
            is_corr = ("CORRECT" in status_upper and not is_elim)

            if opt and correct:
                opt_norm = opt.strip().upper()
                corr_norm = str(correct).strip().upper()
                parts = re.split(r"^([A-Z0-9]{1,2})[\s.:)-]+\s*", opt_norm)
                prefix = parts[1].strip() if len(parts) >= 3 and parts[1] else ""
                body = parts[2].strip() if len(parts) >= 3 and parts[1] else opt_norm
                corr_tokens = [t.strip() for t in re.split(r"[,;\s/]+", corr_norm) if t.strip()]

                tfng_map = {
                    "T": "TRUE", "TRUE": "TRUE",
                    "F": "FALSE", "FALSE": "FALSE",
                    "NG": "NOT GIVEN", "NOT GIVEN": "NOT GIVEN",
                    "Y": "YES", "YES": "YES",
                    "N": "NO", "NO": "NO",
                }
                body_canon = tfng_map.get(body)
                corr_canon = tfng_map.get(corr_norm)

                if body and (body == corr_norm or (len(body) > 3 and body in corr_norm) or (len(corr_norm) > 3 and corr_norm in body)):
                    is_corr = True
                elif body_canon and corr_canon:
                    is_corr = (body_canon == corr_canon)
                elif prefix and (prefix == corr_norm or prefix in corr_tokens):
                    is_corr = True
                elif prefix and len(corr_norm) <= 2:
                    is_corr = (prefix == corr_norm or prefix in corr_tokens)

            clean_status = "CORRECT" if is_corr else "ELIMINATE"
            cleaned_d.append({"option": opt, "status": clean_status, "reason": raw_reason})

        self.assertEqual(cleaned_d[0]["status"], "ELIMINATE")
        self.assertEqual(cleaned_d[1]["status"], "CORRECT")
        self.assertEqual(cleaned_d[2]["status"], "ELIMINATE")

    def test_distractor_breakdown_tfng_identifies_correct_option(self):
        # Specific regression test for TFNG options where answer is "NOT GIVEN"
        raw_distractors = [
            {"option": "A. TRUE", "status": "ELIMINATE", "reason": "The passage does not state that olive oil was more costly."},
            {"option": "B. FALSE", "status": "ELIMINATE", "reason": "While olive oil might not have been more costly, no info confirms it was cheaper."},
            {"option": "C. NOT GIVEN", "status": "ELIMINATE", "reason": "The passage provides no information about comparative price."},
        ]
        correct = "NOT GIVEN"

        import re
        cleaned_d = []
        for d in raw_distractors:
            opt = str(d.get("option") or "").strip()
            raw_status = str(d.get("status") or "").strip()
            raw_reason = str(d.get("reason") or "").strip()
            status_upper = raw_status.upper()
            is_elim = any(k in status_upper for k in ["ELIMINATE", "INCORRECT", "WRONG", "FALSE", "TRAP", "DISTRACTOR"])
            is_corr = ("CORRECT" in status_upper and not is_elim)

            if opt and correct:
                opt_norm = opt.strip().upper()
                corr_norm = str(correct).strip().upper()
                parts = re.split(r"^([A-Z0-9]{1,2})[\s.:)-]+\s*", opt_norm)
                prefix = parts[1].strip() if len(parts) >= 3 and parts[1] else ""
                body = parts[2].strip() if len(parts) >= 3 and parts[1] else opt_norm
                corr_tokens = [t.strip() for t in re.split(r"[,;\s/]+", corr_norm) if t.strip()]

                tfng_map = {
                    "T": "TRUE", "TRUE": "TRUE",
                    "F": "FALSE", "FALSE": "FALSE",
                    "NG": "NOT GIVEN", "NOT GIVEN": "NOT GIVEN",
                    "Y": "YES", "YES": "YES",
                    "N": "NO", "NO": "NO",
                }
                body_canon = tfng_map.get(body)
                corr_canon = tfng_map.get(corr_norm)

                if body and (body == corr_norm or (len(body) > 3 and body in corr_norm) or (len(corr_norm) > 3 and corr_norm in body)):
                    is_corr = True
                elif body_canon and corr_canon:
                    is_corr = (body_canon == corr_canon)
                elif prefix and (prefix == corr_norm or prefix in corr_tokens):
                    is_corr = True
                elif prefix and len(corr_norm) <= 2:
                    is_corr = (prefix == corr_norm or prefix in corr_tokens)

            clean_status = "CORRECT" if is_corr else "ELIMINATE"
            cleaned_d.append({"option": opt, "status": clean_status, "reason": raw_reason})

        self.assertEqual(cleaned_d[0]["status"], "ELIMINATE")
        self.assertEqual(cleaned_d[1]["status"], "ELIMINATE")
        self.assertEqual(cleaned_d[2]["status"], "CORRECT")


if __name__ == "__main__":
    unittest.main()
