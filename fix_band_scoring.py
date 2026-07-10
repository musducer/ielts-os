# -*- coding: utf-8 -*-
"""
fix_band_scoring.py
Sửa lỗi chấm band IELTS: tách riêng bảng quy đổi Reading vs Listening.
Trước đây dùng 1 bảng (thực chất là bảng Listening) cho mọi kỹ năng
=> Reading bị chấm phồng (vd 32/40 ra 7.5 thay vì 7.0).

Target: src/App.template.tsx  (KHÔNG sửa App.tsx - file build tự sinh)
An toàn chạy nhiều lần (idempotent).
"""
import re
import sys

PATH = "src/App.template.tsx"

try:
    with open(PATH, "r", encoding="utf-8") as f:
        content = f.read()
except FileNotFoundError:
    print(f"[X] Khong tim thay {PATH}. Chay script tu thu muc goc project.")
    sys.exit(1)

original = content

# ---------------------------------------------------------------------------
# B1: Thay toan bo than ham getIeltsBand bang phien ban 2 bang (Reading/Listening)
# ---------------------------------------------------------------------------
NEW_FUNC = '''const getIeltsBand = (score: number, total: number = 40, skill: string = "Reading") => {
    if (!total || total === 0) return "N/A";
    const norm = ((score || 0) / total) * 40;
    const isListening = String(skill || "").toLowerCase().includes("listen");
    if (isListening) {
      // Bang quy doi IELTS Listening (raw / 40)
      if (norm >= 39) return 9.0; if (norm >= 37) return 8.5; if (norm >= 35) return 8.0;
      if (norm >= 32) return 7.5; if (norm >= 30) return 7.0; if (norm >= 26) return 6.5;
      if (norm >= 23) return 6.0; if (norm >= 18) return 5.5; if (norm >= 16) return 5.0;
      if (norm >= 13) return 4.5; if (norm >= 10) return 4.0; if (norm >= 6) return 3.5;
      if (norm >= 4) return 3.0; return "N/A";
    }
    // Bang quy doi IELTS Academic Reading (raw / 40)
    if (norm >= 39) return 9.0; if (norm >= 37) return 8.5; if (norm >= 35) return 8.0;
    if (norm >= 33) return 7.5; if (norm >= 30) return 7.0; if (norm >= 27) return 6.5;
    if (norm >= 23) return 6.0; if (norm >= 19) return 5.5; if (norm >= 15) return 5.0;
    if (norm >= 13) return 4.5; if (norm >= 10) return 4.0; if (norm >= 8) return 3.5;
    if (norm >= 6) return 3.0; if (norm >= 4) return 2.5; return "N/A";
  };'''

if 'skill: string = "Reading"' in content:
    print("[=] B1: Ham getIeltsBand da co tham so skill -> bo qua.")
else:
    # Khop tu chu ky ham toi 'return "N/A";' cuoi cung dong bang '};'
    pattern = re.compile(
        r'const getIeltsBand = \(score: number, total: number = 40\) => \{'
        r'.*?return "N/A";\s*\};',
        re.DOTALL,
    )
    new_content, n = pattern.subn(NEW_FUNC, content, count=1)
    if n == 1:
        content = new_content
        print("[OK] B1: Da thay than ham getIeltsBand (2 bang Reading/Listening).")
    else:
        print("[X] B1: KHONG khop duoc ham getIeltsBand goc. Dung lai de tranh hong file.")
        sys.exit(1)

# ---------------------------------------------------------------------------
# B2: Caller handleRecalculateScores -> truyen qz.type
# ---------------------------------------------------------------------------
OLD_2 = "band: getIeltsBand(newScore, qz.questions.length)"
NEW_2 = "band: getIeltsBand(newScore, qz.questions.length, qz.type)"
if NEW_2 in content:
    print("[=] B2: Caller recalculate da truyen qz.type -> bo qua.")
elif OLD_2 in content:
    content = content.replace(OLD_2, NEW_2, 1)
    print("[OK] B2: Da truyen qz.type vao getIeltsBand (recalculate).")
else:
    print("[!] B2: Khong tim thay anchor recalculate (co the da doi). Kiem tra thu cong.")

# ---------------------------------------------------------------------------
# B3: Caller forceSubmitExam -> truyen state.activeExam.type
# ---------------------------------------------------------------------------
OLD_3 = "const band = getIeltsBand(score, totalQ);"
NEW_3 = "const band = getIeltsBand(score, totalQ, state.activeExam.type);"
if NEW_3 in content:
    print("[=] B3: Caller forceSubmitExam da truyen type -> bo qua.")
elif OLD_3 in content:
    content = content.replace(OLD_3, NEW_3, 1)
    print("[OK] B3: Da truyen state.activeExam.type vao getIeltsBand (submit exam).")
else:
    print("[!] B3: Khong tim thay anchor forceSubmitExam. Kiem tra thu cong.")

# ---------------------------------------------------------------------------
if content != original:
    with open(PATH, "w", encoding="utf-8") as f:
        f.write(content)
    print("\n[DONE] Da ghi", PATH, "-> hay chay lai script compile va kiem tra.")
else:
    print("\n[=] Khong co thay doi nao (da patch tu truoc).")
