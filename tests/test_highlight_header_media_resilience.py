import re
import unittest

def clean_header_check_text(raw: str) -> str:
    s = re.sub(r'</?(?:span|strong|b|em|i|u|mark|sup|sub|a|font)[^>]*>', '', raw or '', flags=re.I)
    s = re.sub(r'<[^>]+>', ' ', s)
    s = re.sub(r'&nbsp;', ' ', s, flags=re.I)
    s = re.sub(r'\s+', ' ', s).strip()
    return s

def has_header_in_instruction(text: str) -> bool:
    cleaned = clean_header_check_text(text)
    return bool(re.search(r'(?:Questions?|QUESTIONS?)\s*\d+(?:\s*(?:-|–|to)\s*\d+)?', cleaned, re.I))

def extract_visual_media_blocks(html: str):
    if not html:
        return []
    items = []
    # 1. img tags
    for m in re.finditer(r'<img\b[^>]*>', html, re.I):
        tag = m.group(0)
        src_match = re.search(r'src=["\']([^"\']+)["\']', tag, re.I)
        url = src_match.group(1) if src_match else tag
        items.append({'tag': tag, 'url': url})
    # 2. IMAGE / Url markers
    for m in re.finditer(r'(?:IMAGE|Url)\s*:\s*(https?://[^\s<>"\'\)]+)', html, re.I):
        tag = m.group(0)
        url = m.group(1)
        items.append({'tag': f'<div>{tag}</div>', 'url': url})
    # 3. raw image urls if not in tag
    for m in re.finditer(r'https?://[^\s<>"\'\)]+\.(?:png|jpg|jpeg|gif|webp|svg)(?:\?[^\s<>"\'\)]*)?', html, re.I):
        url = m.group(0)
        if not any(url in it['url'] for it in items):
            items.append({'tag': f'<img src="{url}" />', 'url': url})
    return items

def preserve_visual_media(clean_html: str, old_html: str) -> str:
    if not old_html:
        return clean_html
    old_media = extract_visual_media_blocks(old_html)
    missing = [it['tag'] for it in old_media if it['url'] not in clean_html]
    if missing:
        return '\n'.join(missing) + '\n' + clean_html
    return clean_html

class TestHighlightHeaderMediaResilience(unittest.TestCase):
    def test_header_detection_with_highlights(self):
        # Plain header
        self.assertTrue(has_header_in_instruction("Questions 11–15"))
        self.assertTrue(has_header_in_instruction("Questions 11-15"))
        self.assertTrue(has_header_in_instruction("Question 1"))

        # Highlighted parts of the header (user bugs from screenshot)
        self.assertTrue(has_header_in_instruction('Questio<span class="student-highlight">ns 11</span>–15'))
        self.assertTrue(has_header_in_instruction('<span class="student-highlight">Questions</span> 11–15'))
        self.assertTrue(has_header_in_instruction('Questions <span class="student-highlight">11</span>–15'))
        self.assertTrue(has_header_in_instruction('Questions 11–<span class="student-highlight">15</span>'))
        self.assertTrue(has_header_in_instruction('<span class="student-highlight">Questions 11–15</span>'))
        self.assertTrue(has_header_in_instruction('Questions 26–<span class="student-highlight">30</span>'))
        self.assertTrue(has_header_in_instruction('<p><strong>Questions 26-30</strong></p>'))

        # Negative checks
        self.assertFalse(has_header_in_instruction("Choose the correct answer."))
        self.assertFalse(has_header_in_instruction('<span class="student-highlight">Choose the correct</span>'))

    def test_visual_media_preservation_when_stripped(self):
        # Image tag in old instruction, stripped from rendered container
        old_ins = '<p><img src="https://example.com/diagram.png" alt="map" /></p><p>Questions 26-30</p>'
        clean_html = '<p>Questions 26-<span class="student-highlight">30</span></p>'
        preserved = preserve_visual_media(clean_html, old_ins)
        self.assertIn('https://example.com/diagram.png', preserved)
        self.assertIn('<span class="student-highlight">30</span>', preserved)

        # Repeated highlights do not duplicate the preserved media
        clean_html2 = '<p><span class="student-highlight">Questions</span> 26-<span class="student-highlight">30</span></p>'
        preserved2 = preserve_visual_media(clean_html2, preserved)
        self.assertEqual(preserved2.count('https://example.com/diagram.png'), 1)

    def test_marker_and_url_preservation(self):
        old_ins = 'IMAGE: https://example.com/diagram2.png\nQuestions 1-5'
        clean_html = 'Questions <span class="student-highlight">1-5</span>'
        preserved = preserve_visual_media(clean_html, old_ins)
        self.assertIn('https://example.com/diagram2.png', preserved)
        self.assertIn('IMAGE:', preserved)

    def test_group_comparison_with_highlight_tags(self):
        ins_raw = "Questions 26-30\nChoose the correct answer"
        ins_highlighted = 'Questions 26-30\n<span class="student-highlight">Choose</span> the correct answer'
        clean_norm = lambda s: re.sub(r'<span\s+class="student-(?:highlight|note-hl)"[^>]*>', '', s, flags=re.I).replace('</span>', '').strip()
        self.assertEqual(clean_norm(ins_raw), clean_norm(ins_highlighted))

if __name__ == '__main__':
    unittest.main()
