import unittest
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

class TestFlowchartHighlightSync(unittest.TestCase):
    def setUp(self):
        self.app_template = (ROOT / 'src/App.template.tsx').read_text(encoding='utf-8')
        self.active_exam = (ROOT / 'src/components_split/ACTIVE_EXAM.txt').read_text(encoding='utf-8')

    def test_app_template_has_flowtext_sync(self):
        """Verify syncHighlightState in App.template.tsx has flowText matching and gap preservation."""
        self.assertIn('const flowTextMatch = /^flowText:([^:]+):(before|after)$/.exec(field);', self.app_template)
        self.assertIn('const gapToken = `[${qNum}]`;', self.app_template)
        # Ensure gapToken is preserved when flowPart is before or after
        self.assertIn('${gapToken}${origAfter ?', self.app_template)
        self.assertIn('${gapToken}${suffix ?', self.app_template)

    def test_active_exam_uses_flowtext_datafields(self):
        """Verify renderFlowChart assigns flowText:before and flowText:after data fields."""
        self.assertIn('dataField={`flowText:${q.id}:before`}', self.active_exam)
        self.assertIn('dataField={`flowText:${q.id}:after`}', self.active_exam)
        self.assertIn('const hasFlowGap = true;', self.active_exam)

    def test_flowtext_reconstruction_logic(self):
        """Simulate syncHighlightState reconstruction logic on question text."""
        def simulate_sync(origHtml, cleanHTML, flowPart, qNum="1"):
            markerMatch = re.search(r'\[(\d+)\](?:\s*(?:_{2,}|\.{3,}|…+))?', origHtml) or re.search(r'_{2,}|\.{4,}|…+', origHtml)
            gapToken = f"[{qNum}]"
            if markerMatch:
                origBefore = origHtml[:markerMatch.start()].strip()
                origAfter = origHtml[markerMatch.end():].strip()
                if flowPart == 'before':
                    prefix = cleanHTML.strip()
                    return f"{prefix + ' ' if prefix else ''}{gapToken}{' ' + origAfter if origAfter else ''}".strip()
                elif flowPart == 'after':
                    suffix = cleanHTML.strip()
                    return f"{origBefore + ' ' if origBefore else ''}{gapToken}{' ' + suffix if suffix else ''}".strip()
            else:
                if flowPart == 'before':
                    prefix = cleanHTML.strip()
                    return f"{prefix + ' ' if prefix else ''}{gapToken}".strip()
                elif flowPart == 'after':
                    suffix = cleanHTML.strip()
                    return f"{gapToken}{' ' + suffix if suffix else ''}".strip()

        orig = "Darlington’s initial research focused on how the air in the environment which [1] was cleaned by plants."
        hl_before = "Darlington’s initial research <span class=\"student-highlight\">focused on how the</span> air in the environment which"
        
        # Test highlighting before the gap
        result_before = simulate_sync(orig, hl_before, "before", "1")
        self.assertIn("[1]", result_before)
        self.assertIn("<span class=\"student-highlight\">focused on how the</span>", result_before)
        self.assertIn("was cleaned by plants.", result_before)

        # Test subsequent highlighting after the gap
        hl_after = "was <span class=\"student-highlight\">cleaned by plants</span>."
        result_both = simulate_sync(result_before, hl_after, "after", "1")
        self.assertIn("[1]", result_both)
        self.assertIn("<span class=\"student-highlight\">focused on how the</span>", result_both)
        self.assertIn("<span class=\"student-highlight\">cleaned by plants</span>.", result_both)

        # Test recovery if gap was somehow stripped
        stripped = "Darlington’s initial research focused on how the air in the environment which"
        result_recovered = simulate_sync(stripped, hl_before, "before", "1")
        self.assertIn("[1]", result_recovered)
        self.assertTrue(result_recovered.endswith("[1]"))

if __name__ == '__main__':
    unittest.main()
