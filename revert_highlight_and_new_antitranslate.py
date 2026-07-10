# -*- coding: utf-8 -*-
"""
revert_highlight_and_new_antitranslate.py
=========================================
1) HOAN NGUYEN cơ che highlight ve NATIVE SELECTION cu (muot, de quet)
   - Bo V8 Painter engine, tra lai processSelection (window.getSelection).
   - Go CSS user-select:none tren vung bai doc (ACTIVE_EXAM.txt).
2) Huong CHONG TRANSLATE moi, KHONG dung toi selection:
   - Them class "notranslate" + giu translate="no" tren khoi phong thi
     (tin hieu chuan bao Google Dich BO QUA noi dung nay).

Target: src/App.template.tsx , src/components_split/ACTIVE_EXAM.txt
An toan chay nhieu lan (idempotent).
"""
import re
import sys

TEMPLATE = "src/App.template.tsx"
ACTIVE   = "src/components_split/ACTIVE_EXAM.txt"

# ===========================================================================
# ENGINE GOC (NATIVE SELECTION) - khoi phuc nguyen ban truoc khi fix translate
# ===========================================================================
ORIG_ENGINE = r'''const processSelection = () => {
          const sel = window.getSelection();
          if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
          const textStr = sel.toString().trim();
          if (textStr.length === 0) return;

          try {
              // 1. CHOT TOA DO VA COPY RANGE NGAY LAP TUC
              const range = sel.getRangeAt(0).cloneRange();
              let rect = range.getBoundingClientRect();

              // KHAC PHUC LOI HIEM: Android Chrome doi khi tra ve toa do 0x0
              if (rect.width === 0 && rect.height === 0) {
                  const rects = range.getClientRects();
                  if (rects.length > 0) rect = rects[0];
              }

              // 2. DO TIM VUNG LAM BAI HOP LE (BAO VE CHONG QUET RA NGOAI LE)
              let container: HTMLElement | null = null;
              let node: Node | null = range.commonAncestorContainer;
              while (node && node !== document.body) {
                  if (node.nodeType === 1 && (node as HTMLElement).classList.contains('highlightable-content')) {
                      container = node as HTMLElement; break;
                  }
                  node = node.parentNode;
              }

              if (!container) {
                  sel.removeAllRanges(); // Quet bay ra ngoai le -> Xoa vung chon
                  return;
              }

              // 3. CHUAN HOA DIEM DAU / DIEM CUOI (CHONG MAT CHU)
              let startNode = range.startContainer; let startOffset = range.startOffset;
              if (startNode.nodeType === 1) {
                  startNode = startNode.childNodes[Math.min(startOffset, Math.max(0, startNode.childNodes.length - 1))] || startNode;
                  startOffset = 0;
                  while (startNode.nodeType === 1 && startNode.firstChild) startNode = startNode.firstChild;
              }

              let endNode = range.endContainer; let endOffset = range.endOffset;
              if (endNode.nodeType === 1) {
                  endNode = endNode.childNodes[Math.max(0, endOffset - 1)] || endNode;
                  while (endNode.nodeType === 1 && endNode.lastChild) endNode = endNode.lastChild;
                  endOffset = endNode.nodeType === 3 ? (endNode.textContent?.length || 0) : 0;
              }

              // SNAP TRON TU: mo rong vung chon ra bien tu -> khong bao gio highlight/chen marker giua tu.
              const isWordChar = (ch: string) => !!ch && /[^\s.,;:!?()\[\]"'‘’“”–—]/.test(ch);
              if (startNode.nodeType === 3) {
                  const ts = startNode.textContent || "";
                  while (startOffset > 0 && isWordChar(ts[startOffset - 1])) startOffset--;
              }
              if (endNode.nodeType === 3) {
                  const te = endNode.textContent || "";
                  while (endOffset < te.length && isWordChar(te[endOffset])) endOffset++;
              }

              clearTempSelection();

              // 4. GOM TOAN BO CHU VAO MANG
              const nodesToWrap: Text[] = [];
              if (startNode === endNode && startNode.nodeType === 3) {
                  nodesToWrap.push(startNode as Text);
              } else {
                  const tw = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT, null);
                  let curr = tw.nextNode();
                  let inRange = false;
                  while (curr) {
                      if (curr === startNode) inRange = true;
                      if (inRange && curr.textContent && curr.textContent.trim().length > 0) nodesToWrap.push(curr as Text);
                      if (curr === endNode) break;
                      curr = tw.nextNode();
                  }

                  if (nodesToWrap.length === 0) {
                      const tw2 = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT, null);
                      let n = tw2.nextNode();
                      while (n) {
                          if (range.intersectsNode(n) && n.textContent && n.textContent.trim().length > 0) nodesToWrap.push(n as Text);
                          n = tw2.nextNode();
                      }
                  }
              }

              // 5. RUT LOI NATIVE SELECTION (BOP CHET MENU EDGE/CHROME/SAMSUNG NGAY LAP TUC)
              sel.removeAllRanges();

              // 6. XU LY DOM DE TAO VUNG XANH FAKE MUOT MA
              if (nodesToWrap.length > 0) {
                  nodesToWrap.forEach(n => {
                      let textNode = n;
                      const isStart = n === startNode;
                      const isEnd = n === endNode;

                      if (isStart && isEnd) {
                          const splitLen = endOffset - startOffset;
                          if (splitLen > 0 && startOffset < textNode.length) {
                              const mid = textNode.splitText(startOffset);
                              if (splitLen < mid.length) mid.splitText(splitLen);
                              textNode = mid;
                          }
                      } else if (isStart) {
                          if (startOffset < textNode.length) textNode = textNode.splitText(startOffset);
                      } else if (isEnd) {
                          if (endOffset > 0 && endOffset < textNode.length) textNode.splitText(endOffset);
                      }

                      const parent = textNode.parentNode as HTMLElement;
                      if (parent && !parent.classList?.contains('student-highlight') && !parent.classList?.contains('student-note-hl') && !parent.classList?.contains('idp-temp-selection')) {
                          const span = document.createElement("span");
                          span.className = 'idp-temp-selection';
                          parent.insertBefore(span, textNode);
                          span.appendChild(textNode);
                      }
                  });

                  // 7. HIEN THI POPUP O VI TRI CHINH GIUA AN TOAN
                  setSelectionMenu({ x: rect.left + rect.width / 2, y: rect.top - 10, container, range: null as any });
              }

          } catch (e) {
              console.error("V7 Engine Error:", e);
              const fallbackSel = window.getSelection();
              if (fallbackSel) fallbackSel.removeAllRanges();
          }
      };

      const handlePointerDown = (_e: Event) => {
          // Da don dep isPointerDown
      };

      const handlePointerUp = (e: Event) => {
          if ((e.target as HTMLElement).closest('.idp-popup-menu') || (e.target as HTMLElement).closest('.idp-note-input-modal')) return;

          // Chay dong bo ngay lap tuc khi tha tay/chuot. Rieng Touch/Android can delay nhe 50ms de OS nha Selection
          if (e.type === 'mouseup') {
              processSelection();
          } else {
              setTimeout(() => processSelection(), 50);
          }
      };

      // BAY SU KIEN DOC QUYEN CHO ANDROID (CHONG KET)
      const handleTouchCancelOrContext = () => {
          setTimeout(() => processSelection(), 50);
      };

      const onSelectionChange = () => {
          clearTimeout(selTimeout);
          selTimeout = window.setTimeout(() => {
              // BAY KET CUOI CUNG: Neu qua 600ms khong co bien dong chu, ep he thong chay
              processSelection();
          }, 600);
      };

      const hideMenuOnClick = (e: MouseEvent | TouchEvent) => {
          const target = e.target as HTMLElement;
          if (!target.closest('.idp-popup-menu') && !target.closest('.idp-note-input-modal') && !target.classList.contains('student-note-hl')) {
              setSelectionMenu(null);
              setNoteInputMenu(null);
              clearTempSelection();
          }
      };

      document.addEventListener('selectionchange', onSelectionChange);

      document.addEventListener('mousedown', handlePointerDown);
      document.addEventListener('touchstart', handlePointerDown, { passive: true });

      document.addEventListener('mouseup', handlePointerUp);
      document.addEventListener('touchend', handlePointerUp);

      // BO 3 BAY SU KIEN CHUYEN TRI ANDROID/SAMSUNG TABLET
      document.addEventListener('touchcancel', handleTouchCancelOrContext);
      document.addEventListener('contextmenu', handleTouchCancelOrContext);
      document.addEventListener('visibilitychange', handleTouchCancelOrContext);

      document.addEventListener('mousedown', hideMenuOnClick);
      document.addEventListener('touchstart', hideMenuOnClick, { passive: true });

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
      document.addEventListener('highlight-removed', handleSyncRequest);

      return () => {
          clearTimeout(selTimeout);
          document.removeEventListener('selectionchange', onSelectionChange);
          document.removeEventListener('mousedown', handlePointerDown);
          document.removeEventListener('touchstart', handlePointerDown);
          document.removeEventListener('mouseup', handlePointerUp);
          document.removeEventListener('touchend', handlePointerUp);
          document.removeEventListener('touchcancel', handleTouchCancelOrContext);
          document.removeEventListener('contextmenu', handleTouchCancelOrContext);
          document.removeEventListener('visibilitychange', handleTouchCancelOrContext);
          document.removeEventListener('mousedown', hideMenuOnClick);
          document.removeEventListener('touchstart', hideMenuOnClick);
          document.removeEventListener('highlight-removed', handleSyncRequest);
          clearTempSelection();
      };'''

# ===========================================================================
def revert_template():
    with open(TEMPLATE, "r", encoding="utf-8") as f:
        content = f.read()

    if "V8 PAINTER ENGINE" not in content and "V8.1 FORGIVING GESTURE" not in content:
        if "const processSelection = () => {" in content and "window.getSelection()" in content:
            print("[=] App.template.tsx: Da la engine native cu -> bo qua.")
            return
        print("[!] App.template.tsx: Khong thay V8 lan native. Kiem tra thu cong.")
        return

    pattern = re.compile(
        r"// =+\s*\n\s*// V8 PAINTER ENGINE:"
        r".*?"
        r"document\.removeEventListener\('highlight-removed', handleSyncRequest\);"
        r"\s*clearTempSelection\(\);\s*\};",
        re.DOTALL,
    )
    new_content, n = pattern.subn(lambda m: ORIG_ENGINE, content, count=1)
    if n != 1:
        print("[X] App.template.tsx: Khong khop khoi V8 de hoan nguyen. Dung lai.")
        sys.exit(1)
    with open(TEMPLATE, "w", encoding="utf-8") as f:
        f.write(new_content)
    print("[OK] App.template.tsx: Da hoan nguyen -> engine NATIVE SELECTION cu.")


def patch_active():
    with open(ACTIVE, "r", encoding="utf-8") as f:
        content = f.read()
    original = content

    # 1) Go bo CSS user-select:none (tra lai native selection)
    css_pattern = re.compile(
        r"\n\n\s*/\* CHONG GOOGLE DICH.*?user-select: text !important;\s*\}",
        re.DOTALL,
    )
    new_content, n = css_pattern.subn("", content)
    if n >= 1:
        content = new_content
        print("[OK] ACTIVE_EXAM.txt: Da go CSS user-select:none (khoi phuc native selection).")
    else:
        print("[=] ACTIVE_EXAM.txt: Khong thay CSS user-select:none -> co the da go.")

    # 2) Huong chong translate moi (KHONG dung selection): them class notranslate
    if "exam-content-block notranslate theme-" in content:
        print("[=] ACTIVE_EXAM.txt: class notranslate da co -> bo qua.")
    else:
        old_cls = "exam-content-block theme-${examTheme}"
        new_cls = "exam-content-block notranslate theme-${examTheme}"
        if old_cls in content:
            content = content.replace(old_cls, new_cls, 1)
            print("[OK] ACTIVE_EXAM.txt: Da them class 'notranslate' (tin hieu bo qua Google Dich).")
        else:
            print("[!] ACTIVE_EXAM.txt: Khong thay className khoi phong thi. Kiem tra thu cong.")

    if content != original:
        with open(ACTIVE, "w", encoding="utf-8") as f:
            f.write(content)


if __name__ == "__main__":
    revert_template()
    patch_active()
    print("\n[DONE] Highlight da tro lai native cu. Hay chay lai compile.")
