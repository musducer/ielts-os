# -*- coding: utf-8 -*-
"""
mobile_student_step2.py
=======================
BUOC 2 - Layout mobile cho STUDENT portal:
  - main padding mobile (chua cho bottom bar).
  - An thanh pill tab cu tren mobile.
  - Bottom tab bar teal (home/exams/vocab/progress/rewards) khi isMobile.
Dung lai isMobile co san. KHONG dung desktop.

Target: src/components_split/STUDENT_PORTAL.txt
Idempotent.
"""
import sys

P = "src/components_split/STUDENT_PORTAL.txt"
with open(P, "r", encoding="utf-8") as f:
    s = f.read()

if "MOBILE BOTTOM TABS" in s:
    print("[=] Student mobile da co -> bo qua.")
    sys.exit(0)

# S1: main padding
s1_old = '<main style={{ maxWidth: 800, margin: "0 auto", padding: "32px 20px" }}>'
s1_new = '<main style={{ maxWidth: 800, margin: "0 auto", padding: isMobile ? "16px 14px 92px" : "32px 20px" }}>'
if s1_old not in s:
    print("[X] S1: anchor main khong khop. Dung.")
    sys.exit(1)
s = s.replace(s1_old, s1_new, 1)
print("[OK] S1 main padding")

# S2: hide pill tab row on mobile
s2_old = "          <div style={{ display: 'flex', gap: 6, marginBottom: 24, padding: 5, background: C.card, border: `1px solid ${C.border}80`, borderRadius: 14, overflowX: 'auto' }}>"
s2_new = "          <div style={{ display: isMobile ? 'none' : 'flex', gap: 6, marginBottom: 24, padding: 5, background: C.card, border: `1px solid ${C.border}80`, borderRadius: 14, overflowX: 'auto' }}>"
if s2_old not in s:
    print("[X] S2: anchor pill row khong khop. Dung.")
    sys.exit(1)
s = s.replace(s2_old, s2_new, 1)
print("[OK] S2 hide pill row")

# S3: bottom tab bar before close
s3_old = """        </main>
      </div>
    );
  }"""
s3_new = r"""        </main>
        {/* MOBILE BOTTOM TABS */}
        {isMobile && (
          <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 1000, background: 'rgba(255,255,255,0.93)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderTop: `1px solid ${C.border}`, display: 'flex', paddingBottom: 'env(safe-area-inset-bottom)' }}>
            {([
              { k: 'home', icon: 'home', label: t('ptab_home') },
              { k: 'exams', icon: 'monitor', label: t('ptab_exams') },
              { k: 'vocab', icon: 'book', label: t('ptab_vocab') },
              { k: 'progress', icon: 'trending', label: t('ptab_progress') },
              { k: 'rewards', icon: 'gift', label: t('ptab_rewards') },
            ] as const).map(tb => {
              const on = portalTab === tb.k;
              return (
                <button key={tb.k} onClick={() => { setPortalTab(tb.k); window.scrollTo({ top: 0 }); }} style={{ flex: 1, background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '8px 0', color: on ? C.accent : C.sub }}>
                  <Ico name={tb.icon} size={21} color={on ? C.accent : C.sub} />
                  <span style={{ fontSize: 10, fontWeight: on ? 800 : 600 }}>{tb.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }"""
if s3_old not in s:
    print("[X] S3: anchor close khong khop. Dung.")
    sys.exit(1)
s = s.replace(s3_old, s3_new, 1)
print("[OK] S3 bottom tab bar")

with open(P, "w", encoding="utf-8") as f:
    f.write(s)
print("\n[DONE] Chay compile + build.")
