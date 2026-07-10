# -*- coding: utf-8 -*-
"""
mobile_student_step3.py
=======================
BUOC 3 - Nen header HV + nang pet len khoi bottom bar tren mobile.
  - Header card: padding/gap/font nho lai khi isMobile.
  - Pet companion: bottom: 104 khi isMobile (khong de bottom tab bar).
Dung lai isMobile co san. KHONG dung desktop.
Target: src/components_split/STUDENT_PORTAL.txt
Idempotent.
"""
import sys

P = "src/components_split/STUDENT_PORTAL.txt"
with open(P, "r", encoding="utf-8") as f:
    s = f.read()

if "STUDENT MOBILE HEADER COMPACT" in s:
    print("[=] Step3 da co -> bo qua.")
    sys.exit(0)

# S1: header card padding + gap responsive
s1_old = "          <div style={{ background: C.card, border: `1px solid ${C.border}80`, borderRadius: 20, padding: '22px 26px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 20, position: 'relative', overflow: 'hidden' }}>"
s1_new = "          {/* STUDENT MOBILE HEADER COMPACT */}\n          <div style={{ background: C.card, border: `1px solid ${C.border}80`, borderRadius: isMobile ? 16 : 20, padding: isMobile ? '14px 16px' : '22px 26px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: isMobile ? 10 : 16, flexWrap: 'wrap', marginBottom: isMobile ? 14 : 20, position: 'relative', overflow: 'hidden' }}>"
if s1_old not in s:
    print("[X] S1: anchor header card khong khop. Dung.")
    sys.exit(1)
s = s.replace(s1_old, s1_new, 1)
print("[OK] S1 header card responsive")

# S2: left group gap
s2_old = "            <div style={{display: 'flex', gap: 18, alignItems: 'center', zIndex: 1}}>"
s2_new = "            <div style={{display: 'flex', gap: isMobile ? 12 : 18, alignItems: 'center', zIndex: 1}}>"
if s2_old not in s:
    print("[X] S2: anchor left group khong khop. Dung.")
    sys.exit(1)
s = s.replace(s2_old, s2_new, 1)
print("[OK] S2 left group gap")

# S3: greeting h2 font size
s3_old = "                <h2 style={{fontFamily: 'var(--display)', marginTop: 0, fontSize: 24, fontWeight: 500, letterSpacing: -0.4, marginBottom: 6}}>"
s3_new = "                <h2 style={{fontFamily: 'var(--display)', marginTop: 0, fontSize: isMobile ? 19 : 24, fontWeight: 500, letterSpacing: -0.4, marginBottom: isMobile ? 4 : 6}}>"
if s3_old not in s:
    print("[X] S3: anchor h2 khong khop. Dung.")
    sys.exit(1)
s = s.replace(s3_old, s3_new, 1)
print("[OK] S3 greeting font")

# S4: stats group padding (coins + level) — replace both occurrences of the pill padding
s4_old = "                <div style={{textAlign: 'center', background: C.bg, padding: '10px 18px', borderRadius: 14}}>"
s4_new = "                <div style={{textAlign: 'center', background: C.bg, padding: isMobile ? '8px 12px' : '10px 18px', borderRadius: 14}}>"
cnt = s.count(s4_old)
if cnt < 2:
    print(f"[X] S4: stat pill anchor count={cnt} (<2). Dung.")
    sys.exit(1)
s = s.replace(s4_old, s4_new)
print(f"[OK] S4 stat pills ({cnt})")

# S5: pet bottom raise on mobile
s5_old = "                style={{ position: 'fixed', right: 20, bottom: 20, zIndex: 500, cursor: 'pointer', animation: 'petBob 3.2s ease-in-out infinite', filter: 'drop-shadow(0 9px 11px rgba(0,0,0,0.22))', ['--pex' as any]: '0px', ['--pey' as any]: '0px' }}>"
s5_new = "                style={{ position: 'fixed', right: isMobile ? 12 : 20, bottom: isMobile ? 104 : 20, zIndex: 500, cursor: 'pointer', animation: 'petBob 3.2s ease-in-out infinite', filter: 'drop-shadow(0 9px 11px rgba(0,0,0,0.22))', ['--pex' as any]: '0px', ['--pey' as any]: '0px' }}>"
if s5_old not in s:
    print("[X] S5: anchor pet style khong khop. Dung.")
    sys.exit(1)
s = s.replace(s5_old, s5_new, 1)
print("[OK] S5 pet raised above bottom bar")

with open(P, "w", encoding="utf-8") as f:
    f.write(s)
print("\n[DONE] Chay compile + tsc + build.")
