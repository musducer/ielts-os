# -*- coding: utf-8 -*-
"""
fix_hooks_violation.py
FIX: react-hooks/rules-of-hooks - useEffect goi co dieu kien trong `if (activeExam)`
     -> React crash "Rendered more hooks" khi activeExam doi trang thai.

CACH SUA:
 1) ACTIVE_EXAM.txt: XOA useEffect vi pham (no trung lap voi effect top-level).
 2) App.template.tsx: them `currentSectionIndex` vao deps cua effect top-level
    (effect nay da sync .inline-blank-input) de khong mat dong bo khi doi section.
Idempotent, tu backup.
"""
import io
import os

ACTIVE = os.path.join("src", "components_split", "ACTIVE_EXAM.txt")
TEMPLATE = os.path.join("src", "App.template.tsx")

# --- 1) Khoi useEffect can xoa trong ACTIVE_EXAM.txt ---
ACTIVE_OLD = (
    "          const isTimeRunningOut = examTimeLeft < 300; \n"
    "\n"
    "          \n"
    "          useEffect(() => {\n"
    "              const inputs = document.querySelectorAll('.inline-blank-input');\n"
    "              inputs.forEach((input: any) => {\n"
    "                  const qid = input.getAttribute('data-qid');\n"
    "                  if (qid && examAnswers[qid] !== undefined && document.activeElement !== input) {\n"
    "                      input.value = String(examAnswers[qid]);\n"
    "                  }\n"
    "              });\n"
    "          }, [examAnswers, currentSectionIndex]);\n"
    "          \n"
    "          const getNavigatorGroups = () => {"
)
ACTIVE_NEW = (
    "          const isTimeRunningOut = examTimeLeft < 300; \n"
    "\n"
    "          const getNavigatorGroups = () => {"
)

# --- 2) Bo sung dependency cho effect top-level trong template ---
TPL_OLD = (
    "      isRestoringRef.current = false;\n"
    "      restoreTimeoutRef.current = null;\n"
    "    }, 5);\n"
    "  }, [activeExam, examAnswers]);"
)
TPL_NEW = (
    "      isRestoringRef.current = false;\n"
    "      restoreTimeoutRef.current = null;\n"
    "    }, 5);\n"
    "  }, [activeExam, examAnswers, currentSectionIndex]);"
)


def patch(path, old, new, label):
    if not os.path.exists(path):
        print("[skip] khong thay %s" % path)
        return
    with io.open(path, "r", encoding="utf-8") as f:
        c = f.read()
    if old not in c:
        if new in c:
            print("[=] %s: da va roi (idempotent OK)" % label)
        else:
            print("[!] %s: KHONG thay anchor -> bo qua de an toan." % label)
        return
    bak = path + ".bak_hooks"
    if not os.path.exists(bak):
        with io.open(bak, "w", encoding="utf-8") as f:
            f.write(c)
    with io.open(path, "w", encoding="utf-8") as f:
        f.write(c.replace(old, new, 1))
    print("[OK] %s: da va." % label)


if __name__ == "__main__":
    patch(ACTIVE, ACTIVE_OLD, ACTIVE_NEW, "ACTIVE_EXAM.txt (xoa useEffect vi pham)")
    patch(TEMPLATE, TPL_OLD, TPL_NEW, "App.template.tsx (them currentSectionIndex vao deps)")
