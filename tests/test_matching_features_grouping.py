import re
import unittest
from docx import Document
from api.index import process_block


class MatchingFeaturesGroupingTests(unittest.TestCase):
    def test_matching_features_subtypes_not_corrupted_by_keywords(self):
        """Questions containing words like 'notable' must not mutate subType to 'NOTES'."""
        lines = [
            "Questions 34-37",
            "Look at the following statements (Questions 34-37) and the list of studies below.",
            "Match each statement with the correct study, A-C.",
            "34. Flowers were used to assess the participants' general emotional state.",
            "35. Participants were less likely to remember words when flowers were in the room.",
            "36. Receiving flowers had a notable effect on participants' mental capacities.",
            "37. People became happier in each other's company when flowers were present.",
            "LIST OF STUDIES",
            "A. The Rutgers University study",
            "B. The Texas A&M study",
            "C. The Wageningen University study",
        ]
        doc = Document()
        for l in lines:
            doc.add_paragraph(l)

        target_questions = []
        process_block("MATCHING", doc.paragraphs, target_questions)

        self.assertEqual(len(target_questions), 4)
        for idx, q in enumerate(target_questions, start=34):
            self.assertEqual(q["questionNumber"], idx)
            self.assertEqual(q["type"], "MATCHING")
            self.assertEqual(q["subType"], "MATCHING_FEATURES", f"Q{idx} had subType {q['subType']} instead of MATCHING_FEATURES")
            self.assertEqual(len(q["options"]), 3)

    def test_frontend_grouping_simulation_prevents_fragmentation(self):
        """Simulate the contiguous grouping logic from REVIEW_QUIZ.txt to ensure Q34-37 are unified."""
        def clean_option(opt):
            return re.sub(r'^[A-Z][.)]\s+', '', str(opt or '')).strip()

        def get_opt_fp(opts):
            if not isinstance(opts, list) or not opts:
                return ""
            return "|||".join(clean_option(o) for o in opts).strip().lower()

        def norm_str(s):
            return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', str(s or ''))).strip().lower()

        # Mock questions as they might appear with legacy or mixed subTypes
        mock_questions = [
            {
                "id": "q_34",
                "questionNumber": 34,
                "type": "MATCHING",
                "subType": "SENTENCE",  # legacy
                "instruction": "Look at the following statements (Questions 34-37) and the list of studies below.",
                "options": ["A. The Rutgers University study", "B. The Texas A&M study", "C. The Wageningen University study"],
            },
            {
                "id": "q_35",
                "questionNumber": 35,
                "type": "MATCHING",
                "subType": "SENTENCE",
                "instruction": "Look at the following statements (Questions 34-37) and the list of studies below.",
                "options": ["A. The Rutgers University study", "B. The Texas A&M study", "C. The Wageningen University study"],
            },
            {
                "id": "q_36",
                "questionNumber": 36,
                "type": "MATCHING",
                "subType": "NOTES",  # legacy corrupted subType
                "instruction": "Look at the following statements (Questions 34-37) and the list of studies below.",
                "options": ["A. The Rutgers University study", "B. The Texas A&M study", "C. The Wageningen University study"],
            },
            {
                "id": "q_37",
                "questionNumber": 37,
                "type": "MATCHING",
                "subType": "SENTENCE",
                "instruction": "Look at the following statements (Questions 34-37) and the list of studies below.",
                "options": ["A. The Rutgers University study", "B. The Texas A&M study", "C. The Wageningen University study"],
            },
        ]

        contiguous_groups = []
        cur_grp = None

        for q in mock_questions:
            ctx = str(q.get("groupContext") or "")
            ins = str(q.get("instruction") or "")
            q_type = str(q.get("type") or "")
            q_sub = str(q.get("subType") or "")
            prev_q = cur_grp["questions"][-1] if cur_grp else None
            prev_type = str(prev_q.get("type") or "") if prev_q else ""
            prev_sub = str(prev_q.get("subType") or "") if prev_q else ""

            cur_grp_opt_fp = get_opt_fp(cur_grp["options"]) if cur_grp else ""
            q_opt_fp = get_opt_fp(q.get("options"))
            same_shared_options = bool(cur_grp_opt_fp and q_opt_fp and cur_grp_opt_fp == q_opt_fp)

            is_both_matching = prev_type == "MATCHING" and q_type == "MATCHING"
            is_both_drag_matching = (prev_type in ("MATCHING", "DRAG_DROP")) and (q_type in ("MATCHING", "DRAG_DROP")) and same_shared_options
            same_type = bool(
                prev_q and (
                    is_both_matching
                    or is_both_drag_matching
                    or (prev_type == q_type and (prev_sub == q_sub or same_shared_options))
                )
            )

            cur_grp_ins_norm = norm_str(cur_grp["instruction"]) if cur_grp else ""
            q_ins_norm = norm_str(ins)
            same_ins = not cur_grp or not q_ins_norm or not cur_grp_ins_norm or q_ins_norm == cur_grp_ins_norm or same_shared_options

            cur_grp_ctx_norm = norm_str(cur_grp["context"]) if cur_grp else ""
            q_ctx_norm = norm_str(ctx)
            same_ctx = not cur_grp or not q_ctx_norm or not cur_grp_ctx_norm or q_ctx_norm == cur_grp_ctx_norm or same_shared_options

            if not cur_grp or not same_type or not same_ctx or not same_ins:
                cur_grp = {
                    "groupId": f"grp-{q['id']}",
                    "instruction": ins,
                    "context": ctx,
                    "options": q.get("options", []),
                    "questions": [q],
                }
                contiguous_groups.append(cur_grp)
            else:
                cur_grp["questions"].append(q)

        # Must be exactly 1 unified group of 4 questions, never split into 3!
        self.assertEqual(len(contiguous_groups), 1)
        self.assertEqual(len(contiguous_groups[0]["questions"]), 4)
        self.assertEqual([q["questionNumber"] for q in contiguous_groups[0]["questions"]], [34, 35, 36, 37])


if __name__ == "__main__":
    unittest.main()
