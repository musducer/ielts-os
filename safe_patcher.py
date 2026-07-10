import re

FILES = ["src/App.tsx", "src/components_split/ACTIVE_EXAM.txt"]

def fix_content(content: str, label: str) -> str:
    original = content

    # ──────────────────────────────────────────────────────────────────
    # FIX 1 (lines ~448): Remove the stray `data-app-unused={...}` inside
    # RichTextEditor's root <div>. printBlankSheet / setPrintBlankSheet /
    # builderSectionIndex / setBuilderSectionIndex are App-level state,
    # out of scope inside RichTextEditor.
    # ──────────────────────────────────────────────────────────────────
    pattern_rte = (
        r' data-app-unused=\{String\(printBlankSheet\)\+String\(setPrintBlankSheet\)'
        r'\+String\(builderSectionIndex\)\+String\(setBuilderSectionIndex\)\}'
        r'(\s*style=\{\{ border: \'2px solid #ccc\')'
    )
    new_content, n = re.subn(pattern_rte, r'\1', content)
    if n:
        print(f"[{label}] Fix 1 (RichTextEditor stray data-app-unused): {n} replacement(s)")
    content = new_content

    # ──────────────────────────────────────────────────────────────────
    # FIX 2 (line ~3582): Remove isContinuousBlock / isFlowChart / isTFNG
    # references from the hidden "TS WARNING cleanup" div's data-legacy
    # string — these vars are declared in nested closures and are not
    # in scope at this point.
    # ──────────────────────────────────────────────────────────────────
    for name in ["isContinuousBlock", "isFlowChart", "isTFNG"]:
        pattern_legacy = r' \+ String\(' + name + r'\)'
        new_content, n = re.subn(pattern_legacy, '', content)
        if n:
            print(f"[{label}] Fix 2 (remove String({name}) from data-legacy): {n} replacement(s)")
        content = new_content

    # ──────────────────────────────────────────────────────────────────
    # FIX 3 (lines ~4037-4044): Remove duplicated condition + duplicated
    # <div onMouseDown=...> that broke the JSX (caused "JSX expressions
    # must have one parent element", "'...' expected", "Identifier
    # expected", "')' expected").
    #
    # Before:
    #   {(!String(...).includes("listen") && !(...)) && (
    #       <div onMouseDown={() => setIsDraggingSplitter && setIsDraggingSplitter(true)}
    #            {(!String(...).includes("listen") && !(...)) && (
    #       <div onMouseDown={() => setIsDraggingSplitter && setIsDraggingSplitter(true)}
    #            style={{ width: 16, ... }}>
    #
    # After:
    #   {(!String(...).includes("listen") && !(...)) && (
    #       <div onMouseDown={() => setIsDraggingSplitter && setIsDraggingSplitter(true)}
    #            style={{ width: 16, ... }}>
    # ──────────────────────────────────────────────────────────────────
    pattern_splitter = (
        r'(<div onMouseDown=\{\(\) => setIsDraggingSplitter && setIsDraggingSplitter\(true\)\}\r?\n)'
        r'\s*\{\(!String\(activeExam!\.type\)\.toLowerCase\(\)\.includes\("listen"\) '
        r'&& !\(activeExam\.type === "Integrated" && currentSectionIndex === 0\)\) && \(\r?\n'
        r'\s*<div onMouseDown=\{\(\) => setIsDraggingSplitter && setIsDraggingSplitter\(true\)\}\r?\n'
        r'(\s*style=\{\{ width: 16,)'
    )
    new_content, n = re.subn(pattern_splitter, r'\1\2', content)
    if n:
        print(f"[{label}] Fix 3 (remove duplicated splitter div/condition): {n} replacement(s)")
    content = new_content

    if content == original:
        print(f"[{label}] WARNING: no changes applied — patterns may not match!")

    return content


for fpath in FILES:
    with open(fpath, "r", encoding="utf-8") as f:
        content = f.read()

    fixed = fix_content(content, fpath)

    with open(fpath, "w", encoding="utf-8") as f:
        f.write(fixed)

    print(f"✅ {fpath} patched.\n")