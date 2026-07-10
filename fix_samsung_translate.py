# -*- coding: utf-8 -*-
"""
fix_samsung_translate.py
=========================
LO HONG GIAN LAN: Tren Samsung/Android tablet, khi thi sinh quet 1 tu trong
phong thi, Google Dich (cai san) tu bat hop dich o day man hinh.

NGUYEN NHAN GOC: Engine highlight cu cho NATIVE SELECTION cua OS hinh thanh
truoc (long-press) roi moi xoa => luon thua cuoc dua voi OS Samsung.

HUONG FIX (A - triet de): Tat han native selection (user-select:none) +
viet lai highlight thanh "ve bang ngon tay" qua caretRangeFromPoint. OS khong
bao gio tao selection => khong bao gio co thanh cong cu / hop Translate.

Target:
  - src/App.template.tsx              (engine highlight)
  - src/components_split/ACTIVE_EXAM.txt  (CSS user-select + translate="no")

An toan chay nhieu lan (idempotent). KHONG sua App.tsx (file build tu sinh).
"""
import re
import sys

TEMPLATE = "src/App.template.tsx"
ACTIVE   = "src/components_split/ACTIVE_EXAM.txt"

# ===========================================================================
# ENGINE MOI (V8 PAINTER) - thay the toan bo processSelection + listeners cu
# ===========================================================================
NEW_ENGINE = r'''// ============================================================
      // V8 PAINTER ENGINE: highlight bang "ve" ngon tay/chuot.
      // KHONG bao gio tao native selection => Android/Samsung khong the
      // bat thanh cong cu chon chu / hop Google Dich.
      // ============================================================
      const isWordChar = (ch: string) => !!ch && /[^\s.,;:!?()\[\]"'‘’“”–—]/.test(ch);

      const caretRangeAt = (x: number, y: number): Range | null => {
          const doc: any = document;
          if (doc.caretRangeFromPoint) return doc.caretRangeFromPoint(x, y);
          if (doc.caretPositionFromPoint) {
              const pos = doc.caretPositionFromPoint(x, y);
              if (!pos) return null;
              const r = document.createRange();
              r.setStart(pos.offsetNode, pos.offset); r.collapse(true);
              return r;
          }
          return null;
      };

      const findContainer = (node: Node | null): HTMLElement | null => {
          let n: Node | null = node;
          while (n && n !== document.body) {
              if (n.nodeType === 1 && (n as HTMLElement).classList.contains('highlightable-content')) return n as HTMLElement;
              n = n.parentNode;
          }
          return null;
      };

      let paintStart: { x: number; y: number } | null = null;
      let painting = false;
      let lastContainer: HTMLElement | null = null;

      // Ve vung tam tu diem bat dau -> diem hien tai, snap tron tu.
      const paintTo = (curX: number, curY: number) => {
          if (!paintStart) return;
          clearTempSelection();

          const r1 = caretRangeAt(paintStart.x, paintStart.y);
          const r2 = caretRangeAt(curX, curY);
          if (!r1 || !r2) return;

          const range = document.createRange();
          const cmp = r1.compareBoundaryPoints(Range.START_TO_START, r2);
          if (cmp <= 0) { range.setStart(r1.startContainer, r1.startOffset); range.setEnd(r2.startContainer, r2.startOffset); }
          else { range.setStart(r2.startContainer, r2.startOffset); range.setEnd(r1.startContainer, r1.startOffset); }

          const container = findContainer(range.commonAncestorContainer);
          if (!container) return;
          lastContainer = container;

          let startNode: Node = range.startContainer; let startOffset = range.startOffset;
          let endNode: Node = range.endContainer; let endOffset = range.endOffset;
          if (startNode.nodeType === 3) {
              const ts = startNode.textContent || "";
              while (startOffset > 0 && isWordChar(ts[startOffset - 1])) startOffset--;
          }
          if (endNode.nodeType === 3) {
              const te = endNode.textContent || "";
              while (endOffset < te.length && isWordChar(te[endOffset])) endOffset++;
          }
          try { range.setStart(startNode, startOffset); range.setEnd(endNode, endOffset); } catch (_e) {}
          if (range.collapsed) return;

          const sObj = range.startContainer; const sOff = range.startOffset;
          const eObj = range.endContainer; const eOff = range.endOffset;

          const nodesToWrap: Text[] = [];
          const tw = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT, null);
          let curr = tw.nextNode();
          while (curr) {
              if (range.intersectsNode(curr) && curr.textContent && curr.textContent.trim().length > 0) nodesToWrap.push(curr as Text);
              curr = tw.nextNode();
          }

          nodesToWrap.forEach(n => {
              let textNode: Text = n;
              const isStart = n === sObj; const isEnd = n === eObj;
              if (isStart && isEnd) {
                  const splitLen = eOff - sOff;
                  if (splitLen > 0 && sOff < textNode.length) {
                      const mid = textNode.splitText(sOff);
                      if (splitLen < mid.length) mid.splitText(splitLen);
                      textNode = mid;
                  }
              } else if (isStart) {
                  if (sOff < textNode.length) textNode = textNode.splitText(sOff);
              } else if (isEnd) {
                  if (eOff > 0 && eOff < textNode.length) textNode.splitText(eOff);
              }
              const parent = textNode.parentNode as HTMLElement;
              if (parent && !parent.classList?.contains('student-highlight') && !parent.classList?.contains('student-note-hl') && !parent.classList?.contains('idp-temp-selection')) {
                  const span = document.createElement("span");
                  span.className = 'idp-temp-selection';
                  parent.insertBefore(span, textNode);
                  span.appendChild(textNode);
              }
          });
      };

      const inExamText = (t: HTMLElement | null) => !!(t && t.closest && t.closest('.highlightable-content'));
      const inMenu = (t: HTMLElement | null) => !!(t && t.closest && (t.closest('.idp-popup-menu') || t.closest('.idp-note-input-modal')));
      const onExistingMark = (t: HTMLElement | null) => !!(t && t.classList && (t.classList.contains('student-highlight') || t.classList.contains('student-note-hl')));

      const showMenuFromTemps = () => {
          const temps = document.querySelectorAll('.idp-temp-selection');
          if (temps.length === 0 || !lastContainer) { clearTempSelection(); return; }
          const r = (temps[0] as HTMLElement).getBoundingClientRect();
          setSelectionMenu({ x: r.left + r.width / 2, y: r.top - 10, container: lastContainer, range: null as any });
      };

      // ---- CHUOT (desktop): keo de boi ----
      const onMouseDown = (e: MouseEvent) => {
          const t = e.target as HTMLElement;
          if (inMenu(t) || onExistingMark(t) || !inExamText(t)) return;
          painting = true; paintStart = { x: e.clientX, y: e.clientY };
      };
      const onMouseMove = (e: MouseEvent) => {
          if (!painting || e.buttons !== 1) return;
          paintTo(e.clientX, e.clientY);
      };
      const onMouseUp = (_e: MouseEvent) => {
          if (!painting) return;
          painting = false;
          showMenuFromTemps();
      };

      // ---- CAM UNG (Android/Samsung): long-press de vao che do boi, roi re ngon ----
      const onTouchStart = (e: TouchEvent) => {
          const t = e.target as HTMLElement;
          if (inMenu(t) || onExistingMark(t) || !inExamText(t)) return;
          const tch = e.touches[0]; if (!tch) return;
          paintStart = { x: tch.clientX, y: tch.clientY };
          painting = false;
          clearTimeout(selTimeout);
          selTimeout = window.setTimeout(() => {
              painting = true;
              if (paintStart) paintTo(paintStart.x, paintStart.y);
          }, 320);
      };
      const onTouchMove = (e: TouchEvent) => {
          const tch = e.touches[0]; if (!tch || !paintStart) return;
          if (!painting) {
              const dx = Math.abs(tch.clientX - paintStart.x);
              const dy = Math.abs(tch.clientY - paintStart.y);
              if (dx > 10 || dy > 10) { clearTimeout(selTimeout); paintStart = null; } // y dinh CUON -> huy boi
              return;
          }
          e.preventDefault(); // dang boi -> chan cuon
          paintTo(tch.clientX, tch.clientY);
      };
      const onTouchEnd = (_e: TouchEvent) => {
          clearTimeout(selTimeout);
          if (!painting) { paintStart = null; return; }
          painting = false;
          showMenuFromTemps();
      };
      const onTouchCancel = () => {
          clearTimeout(selTimeout);
          painting = false; paintStart = null;
          clearTempSelection();
      };

      const hideMenuOnClick = (e: MouseEvent | TouchEvent) => {
          const target = e.target as HTMLElement;
          if (!target.closest('.idp-popup-menu') && !target.closest('.idp-note-input-modal') && !target.classList.contains('student-note-hl')) {
              setSelectionMenu(null);
              setNoteInputMenu(null);
              if (!painting) clearTempSelection();
          }
      };

      const handleSyncRequest = (e: Event) => {
          const container = e.target as HTMLElement;
          const field = container.getAttribute('data-field');
          const qId = container.getAttribute('data-qid');
          const optIndex = container.getAttribute('data-optindex');
          if (field) {
              const cleanHTML = serializeHighlightHTML(container);
              setActiveExam(prev => syncHighlightState(prev, field, qId || "", cleanHTML, optIndex));
          }
      };

      document.addEventListener('mousedown', onMouseDown);
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      document.addEventListener('touchstart', onTouchStart, { passive: true });
      document.addEventListener('touchmove', onTouchMove, { passive: false });
      document.addEventListener('touchend', onTouchEnd);
      document.addEventListener('touchcancel', onTouchCancel);
      document.addEventListener('mousedown', hideMenuOnClick);
      document.addEventListener('touchstart', hideMenuOnClick, { passive: true });
      document.addEventListener('highlight-removed', handleSyncRequest);

      return () => {
          clearTimeout(selTimeout);
          document.removeEventListener('mousedown', onMouseDown);
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
          document.removeEventListener('touchstart', onTouchStart);
          document.removeEventListener('touchmove', onTouchMove);
          document.removeEventListener('touchend', onTouchEnd);
          document.removeEventListener('touchcancel', onTouchCancel);
          document.removeEventListener('mousedown', hideMenuOnClick);
          document.removeEventListener('touchstart', hideMenuOnClick);
          document.removeEventListener('highlight-removed', handleSyncRequest);
          clearTempSelection();
      };'''

# ===========================================================================
def patch_template():
    with open(TEMPLATE, "r", encoding="utf-8") as f:
        content = f.read()

    if "V8 PAINTER ENGINE" in content:
        print("[=] App.template.tsx: Engine V8 da co -> bo qua.")
        return

    pattern = re.compile(
        r"const processSelection = \(\) => \{"
        r".*?"
        r"document\.removeEventListener\('highlight-removed', handleSyncRequest\);"
        r"\s*clearTempSelection\(\);\s*\};",
        re.DOTALL,
    )
    new_content, n = pattern.subn(lambda m: NEW_ENGINE, content, count=1)
    if n != 1:
        print("[X] App.template.tsx: KHONG khop duoc engine cu (processSelection...). Dung de tranh hong file.")
        sys.exit(1)
    with open(TEMPLATE, "w", encoding="utf-8") as f:
        f.write(new_content)
    print("[OK] App.template.tsx: Da thay engine -> V8 Painter (caretRangeFromPoint).")


def patch_active():
    with open(ACTIVE, "r", encoding="utf-8") as f:
        content = f.read()
    original = content

    # 1) CSS: cam native selection tren vung bai doc (chua input dap an)
    if "CHONG GOOGLE DICH" in content:
        print("[=] ACTIVE_EXAM.txt: CSS chong native selection da co -> bo qua.")
    else:
        anchor = ".exam-content-block.text-xlarge { --efont: 24px; }"
        css = (
            ".exam-content-block.text-xlarge { --efont: 24px; }\n"
            "\n"
            "                      /* CHONG GOOGLE DICH / THANH CONG CU CHON CHU CUA OS (Samsung/Android):\n"
            "                         cam native selection tren vung bai doc; highlight dung V8 Painter tu ve.\n"
            "                         CHUA input dap an de hoc vien van go chu binh thuong. */\n"
            "                      .exam-content-block .highlightable-content, .exam-content-block .highlightable-content *, .exam-content-block .idp-q-text-inline, .exam-content-block .idp-q-text-inline * {\n"
            "                          -webkit-user-select: none !important; -moz-user-select: none !important; -ms-user-select: none !important; user-select: none !important; -webkit-touch-callout: none !important;\n"
            "                      }\n"
            "                      .exam-content-block .highlightable-content input, .exam-content-block .highlightable-content textarea, .exam-content-block .inline-blank-input {\n"
            "                          -webkit-user-select: text !important; -moz-user-select: text !important; -ms-user-select: text !important; user-select: text !important;\n"
            "                      }"
        )
        if anchor in content:
            content = content.replace(anchor, css, 1)
            print("[OK] ACTIVE_EXAM.txt: Da them CSS user-select:none cho vung bai doc.")
        else:
            print("[!] ACTIVE_EXAM.txt: Khong tim thay anchor CSS (.text-xlarge). Kiem tra thu cong.")

    # 2) translate="no" tren khoi phong thi (chan ca page-translate)
    if 'translate="no"' in content:
        print("[=] ACTIVE_EXAM.txt: translate=\"no\" da co -> bo qua.")
    else:
        old_attr = "text-${examTextSize}`} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'var(--ebg)'"
        new_attr = "text-${examTextSize}`} translate=\"no\" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'var(--ebg)'"
        if old_attr in content:
            content = content.replace(old_attr, new_attr, 1)
            print("[OK] ACTIVE_EXAM.txt: Da them translate=\"no\" tren khoi phong thi.")
        else:
            print("[!] ACTIVE_EXAM.txt: Khong tim thay anchor div phong thi. Kiem tra thu cong.")

    if content != original:
        with open(ACTIVE, "w", encoding="utf-8") as f:
            f.write(content)


if __name__ == "__main__":
    patch_template()
    patch_active()
    print("\n[DONE] Hay chay lai script compile, roi TEST tren Samsung tablet:")
    print("  - Long-press 1 tu -> KHONG hien hop Google Dich; popup Highlight/Note cua app hien ra.")
    print("  - Re ngon tay tren chu de boi ca cum -> highlight muot, khong co thanh cong cu OS.")
    print("  - Kiem tra chuot desktop: keo de boi van hoat dong.")
