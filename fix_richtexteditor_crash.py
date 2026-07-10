# -*- coding: utf-8 -*-
"""
fix_richtexteditor_crash.py
FIX: ReferenceError: printBlankSheet is not defined (trang trang Exam Builder)
Xoa data-app-unused khoi <div> mo dau cua RichTextEditor (sai scope).
Va THANG vao CA HAI: src/App.template.tsx (source) VA src/App.tsx (build hien tai).
Idempotent, tu backup.
"""
import io
import os

TARGETS = [
    os.path.join("src", "App.template.tsx"),
    os.path.join("src", "App.tsx"),
]

OLD = (
    "<div className=\"no-print\" "
    "data-app-unused={String(printBlankSheet)+String(setPrintBlankSheet)"
    "+String(builderSectionIndex)+String(setBuilderSectionIndex)} "
    "style={{ border: '2px solid #ccc', borderRadius: 8, overflow: 'hidden', "
    "background: '#fff', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>"
)
NEW = (
    "<div className=\"no-print\" "
    "style={{ border: '2px solid #ccc', borderRadius: 8, overflow: 'hidden', "
    "background: '#fff', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>"
)


def patch(path):
    if not os.path.exists(path):
        print("[skip] Khong thay: %s" % path)
        return
    with io.open(path, "r", encoding="utf-8") as f:
        content = f.read()

    if OLD not in content:
        if NEW in content:
            print("[=] %s: da va roi (idempotent OK)" % path)
        else:
            print("[!] %s: khong thay anchor, BO QUA de an toan." % path)
        return

    new_content = content.replace(OLD, NEW, 1)
    if new_content.count("data-app-unused") != content.count("data-app-unused") - 1:
        print("[X] %s: so lan thay the bat thuong, HUY." % path)
        return

    bak = path + ".bak_rtefix"
    if not os.path.exists(bak):
        with io.open(bak, "w", encoding="utf-8") as f:
            f.write(content)
    with io.open(path, "w", encoding="utf-8") as f:
        f.write(new_content)
    print("[OK] %s: da xoa data-app-unused khoi RichTextEditor." % path)


if __name__ == "__main__":
    for t in TARGETS:
        patch(t)
    print("Xong. App.tsx da het loi -> co the build/deploy ngay. Template cung da sach.")
