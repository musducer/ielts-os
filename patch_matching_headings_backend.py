# -*- coding: utf-8 -*-
"""
Patch index.py:
1. is_option() nhận dạng roman numeral (i. text, ii. text, iii. text ...)
2. Thêm branch DRAG_DROP_HEADING vào answer mapper (correctAnswer = roman numeral string)
Idempotent: skip nếu đã có 'roman numeral heading'.
"""
import io, sys

PATH = "api/index.py"

with io.open(PATH, "r", encoding="utf-8") as f:
    src = f.read()

if "roman numeral heading" in src:
    print("[SKIP] Đã patch trước đó.")
    sys.exit(0)

# 1. Thêm roman numeral detection vào is_option()
OLD_IS_OPT = """    # Dạng 3: A Text (List of people, features...)
    m = re.match(r'^([A-K])\\s+(.+)$', text)"""

NEW_IS_OPT = """    # Dạng roman numeral heading: i. text, ii. text, iii. text
    if re.match(r'^[ivxlcdmIVXLCDM]+[\\.]\\)\\s+\\S', text): return True
    if re.match(r'^[ivxlcdmIVXLCDM]+\\.\\s+\\S', text): return True  # roman numeral heading
    # Dạng 3: A Text (List of people, features...)
    m = re.match(r'^([A-K])\\s+(.+)$', text)"""

assert OLD_IS_OPT in src, "Anchor is_option() không tìm thấy!"
src = src.replace(OLD_IS_OPT, NEW_IS_OPT, 1)

# 2. Thêm branch DRAG_DROP_HEADING vào answer mapper (trước elif output_type == "DRAG_DROP":)
OLD_MAPPER = """        elif output_type == "DRAG_DROP":
            # Đáp án có thể là chữ cái (A-K) -> ánh xạ sang TỪ tương ứng (vì chấm điểm DRAG_DROP so khớp text);
            # nếu đã là chữ thuần thì giữ nguyên.
            if q["correctAnswers"]:
                raw = str(q["correctAnswers"][0]).strip()
                if re.fullmatch(r'[A-Za-z]', raw) and q["options"]:
                    idx = ord(raw.upper()) - 65
                    final_correct_answer = q["options"][idx] if 0 <= idx < len(q["options"]) else raw
                else:
                    final_correct_answer = raw
            else:
                final_correct_answer = ""
        else:"""

NEW_MAPPER = """        elif output_type == "DRAG_DROP_HEADING":
            # correctAnswer = roman numeral label (e.g. "iv") matched against option prefix
            if q["correctAnswers"]:
                raw = str(q["correctAnswers"][0]).strip().lower()
                final_correct_answer = raw  # default: giữ nguyên
                for opt in (q["options"] or []):
                    m = re.match(r'^([ivxlcdmIVXLCDM]+)[\\.)\\s]', str(opt).strip(), re.IGNORECASE)
                    if m and m.group(1).lower() == raw:
                        final_correct_answer = m.group(1).lower()
                        break
            else:
                final_correct_answer = ""
        elif output_type == "DRAG_DROP":
            # Đáp án có thể là chữ cái (A-K) -> ánh xạ sang TỪ tương ứng (vì chấm điểm DRAG_DROP so khớp text);
            # nếu đã là chữ thuần thì giữ nguyên.
            if q["correctAnswers"]:
                raw = str(q["correctAnswers"][0]).strip()
                if re.fullmatch(r'[A-Za-z]', raw) and q["options"]:
                    idx = ord(raw.upper()) - 65
                    final_correct_answer = q["options"][idx] if 0 <= idx < len(q["options"]) else raw
                else:
                    final_correct_answer = raw
            else:
                final_correct_answer = ""
        else:"""

assert OLD_MAPPER in src, "Anchor DRAG_DROP mapper không tìm thấy!"
src = src.replace(OLD_MAPPER, NEW_MAPPER, 1)

with io.open(PATH, "w", encoding="utf-8") as f:
    f.write(src)

print("[OK] Đã patch api/index.py (roman numeral + DRAG_DROP_HEADING mapper).")
