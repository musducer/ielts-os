# -*- coding: utf-8 -*-
"""
fix_paint_gesture.py
====================
V8 Painter quet kho qua / "cha quet duoc" tren tablet.
Nguyen nhan: cu chi huy paint khi ngon di chuyen >10px truoc 280ms,
ma ngon tay that luon rung khi long-press => luon bi hieu nham la CUON.

FIX (V8.1 - cu chi de tho):
  - Rung tay nho (<14px) khi giu  -> KHONG huy, van cho long-press.
  - Vuot NHANH (van toc cao)       -> y dinh CUON -> huy boi.
  - Keo CHAM co chu dich           -> vao che do boi NGAY (khong cho du 280ms).
  - Long-press giu yen 280ms       -> vao che do boi + boi tu duoi ngon.

Target: src/App.template.tsx
An toan chay nhieu lan (idempotent).
"""
import sys

PATH = "src/App.template.tsx"

with open(PATH, "r", encoding="utf-8") as f:
    content = f.read()

if "V8.1 FORGIVING GESTURE" in content:
    print("[=] Cu chi V8.1 da co -> bo qua.")
    sys.exit(0)

if "V8 PAINTER ENGINE" not in content:
    print("[X] Khong thay V8 PAINTER ENGINE. Chay fix_samsung_translate.py truoc.")
    sys.exit(1)

# --- B1: them bien paintStartTime vao khoi khai bao ---
OLD_DECL = """      let paintStart: { x: number; y: number } | null = null;
      let painting = false;
      let lastContainer: HTMLElement | null = null;"""
NEW_DECL = """      let paintStart: { x: number; y: number } | null = null;
      let paintStartTime = 0;
      let painting = false;
      let lastContainer: HTMLElement | null = null;"""
if OLD_DECL not in content:
    print("[X] B1: Khong khop khoi khai bao paintStart. Dung lai.")
    sys.exit(1)
content = content.replace(OLD_DECL, NEW_DECL, 1)

# --- B2: thay onTouchStart + onTouchMove bang phien ban de tho ---
OLD_TOUCH = """      // ---- CAM UNG (Android/Samsung): long-press de vao che do boi, roi re ngon ----
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
      };"""

NEW_TOUCH = """      // ---- CAM UNG (Android/Samsung): V8.1 FORGIVING GESTURE ----
      // De tho: rung tay nho khong huy; phan biet CUON vs BOI bang VAN TOC.
      const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const onTouchStart = (e: TouchEvent) => {
          const t = e.target as HTMLElement;
          if (inMenu(t) || onExistingMark(t) || !inExamText(t)) return;
          const tch = e.touches[0]; if (!tch) return;
          paintStart = { x: tch.clientX, y: tch.clientY };
          paintStartTime = nowMs();
          painting = false;
          clearTimeout(selTimeout);
          // Giu yen ~280ms -> vao che do boi (giong long-press chon chu cua OS)
          selTimeout = window.setTimeout(() => {
              if (!paintStart) return;
              painting = true;
              paintTo(paintStart.x, paintStart.y);
          }, 280);
      };
      const onTouchMove = (e: TouchEvent) => {
          const tch = e.touches[0]; if (!tch || !paintStart) return;
          if (painting) { e.preventDefault(); paintTo(tch.clientX, tch.clientY); return; }
          const dx = tch.clientX - paintStart.x;
          const dy = tch.clientY - paintStart.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const dt = Math.max(1, nowMs() - paintStartTime);
          const speed = dist / dt; // px/ms
          if (dist < 14) return;             // rung tay nho -> van cho long-press, KHONG huy
          if (speed > 0.65) {                // vuot nhanh -> y dinh CUON -> huy boi
              clearTimeout(selTimeout); paintStart = null; return;
          }
          // Keo cham co chu dich -> vao che do boi NGAY (khong cho du 280ms)
          clearTimeout(selTimeout);
          painting = true;
          e.preventDefault();
          paintTo(tch.clientX, tch.clientY);
      };"""

if OLD_TOUCH not in content:
    print("[X] B2: Khong khop khoi onTouchStart/onTouchMove cu. Dung lai.")
    sys.exit(1)
content = content.replace(OLD_TOUCH, NEW_TOUCH, 1)

with open(PATH, "w", encoding="utf-8") as f:
    f.write(content)
print("[OK] Da nang cap cu chi -> V8.1 (de quet hon). Chay lai compile.")
