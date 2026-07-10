# -*- coding: utf-8 -*-
"""
block_touch_to_search.py
========================
Chan Chrome "Touch to Search" (thanh dich truot len tu day man hinh khi
CHAM NHANH 1 tu, co logo Google Dich).

Co che: Touch to Search kich hoat boi cu CHAM NHANH (tap). Highlight cua app
dung GIU-roi-KEO (long-press + drag) -> gesture KHAC HAN. Ta chi "nuot" cu
cham nhanh tren vung bai doc => Chrome khong bat thanh dich, ma KHONG dung
toi thao tac quet chon.

KHONG dung input dap an / highlight cu (chi chan cham nhanh tren chu thuan tuy).

Target: src/App.template.tsx
An toan chay nhieu lan (idempotent).
"""
import sys

PATH = "src/App.template.tsx"

with open(PATH, "r", encoding="utf-8") as f:
    content = f.read()

if "TOUCH TO SEARCH" in content:
    print("[=] Da co bo chan Touch to Search -> bo qua.")
    sys.exit(0)

ANCHOR = "  const executeHighlightOrNote = (type: 'HIGHLIGHT' | 'NOTE', noteText?: string) => {"

BLOCK = r'''  // =========================================================
  // CHAN CHROME "TOUCH TO SEARCH" (thanh dich truot len tu day khi CHAM 1 tu).
  // Nuot cu CHAM NHANH tren vung bai doc -> Chrome khong kich hoat thanh dich.
  // GIU-roi-KEO (highlight) la gesture khac nen KHONG bi anh huong.
  // =========================================================
  useEffect(() => {
      if (!activeExam) return;
      let tapTime = 0; let tapX = 0; let tapY = 0; let tapValid = false;
      const onTS = (e: TouchEvent) => {
          const t = e.target as HTMLElement;
          const okZone = !!(t && t.closest && t.closest('.highlightable-content'));
          const isInteractive = !!(t && t.closest && t.closest('input, textarea, button, a, .inline-blank-input, .student-highlight, .student-note-hl'));
          tapValid = okZone && !isInteractive;
          if (!tapValid) return;
          const tch = e.touches[0]; if (!tch) { tapValid = false; return; }
          tapTime = Date.now(); tapX = tch.clientX; tapY = tch.clientY;
      };
      const onTE = (e: TouchEvent) => {
          if (!tapValid) return;
          tapValid = false;
          const tch = e.changedTouches[0]; if (!tch) return;
          const dt = Date.now() - tapTime;
          const dist = Math.hypot(tch.clientX - tapX, tch.clientY - tapY);
          // CHAM NHANH (khong phai long-press, khong phai keo chon) -> nuot de chan Touch to Search.
          // Chi nuot khi KHONG co vung chon (de khong dung thao tac highlight).
          if (dt < 280 && dist < 12) {
              const sel = window.getSelection();
              if (!sel || sel.isCollapsed) { e.preventDefault(); }
          }
      };
      document.addEventListener('touchstart', onTS, { passive: true });
      document.addEventListener('touchend', onTE, { passive: false });
      return () => {
          document.removeEventListener('touchstart', onTS);
          document.removeEventListener('touchend', onTE);
      };
  }, [activeExam]);

'''

if ANCHOR not in content:
    print("[X] Khong tim thay anchor executeHighlightOrNote. Dung lai.")
    sys.exit(1)

content = content.replace(ANCHOR, BLOCK + ANCHOR, 1)
with open(PATH, "w", encoding="utf-8") as f:
    f.write(content)
print("[OK] Da them bo chan Touch to Search (nuot cham nhanh tren vung bai doc).")
