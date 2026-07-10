#!/usr/bin/env python3
"""
Fix Splitter JSX Syntax Error: Remove illegal && guards
The issue: onMouseUp={() => setIsDraggingSplitter && setIsDraggingSplitter(false)}
Should be: onMouseUp={() => setIsDraggingSplitter(false)}
"""

import re

file_path = r"C:\Users\hp\ielts-timer-pro\src\components_split\ACTIVE_EXAM.txt"

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Check if already patched
if "onMouseUp={() => setIsDraggingSplitter(false)}" in content:
    print("✅ Already patched. Skipping.")
    exit(0)

# Fix 1: onMouseUp with illegal && guard
old_1 = 'onMouseUp={() => setIsDraggingSplitter && setIsDraggingSplitter(false)}'
new_1 = 'onMouseUp={() => setIsDraggingSplitter(false)}'
content = content.replace(old_1, new_1)
print(f"✓ Fixed onMouseUp guard")

# Fix 2: onMouseLeave with illegal && guard
old_2 = 'onMouseLeave={() => setIsDraggingSplitter && setIsDraggingSplitter(false)}'
new_2 = 'onMouseLeave={() => setIsDraggingSplitter(false)}'
content = content.replace(old_2, new_2)
print(f"✓ Fixed onMouseLeave guard")

# Fix 3: onMouseDown with illegal && guard
old_3 = 'onMouseDown={() => setIsDraggingSplitter && setIsDraggingSplitter(true)}'
new_3 = 'onMouseDown={() => setIsDraggingSplitter(true)}'
content = content.replace(old_3, new_3)
print(f"✓ Fixed onMouseDown guard")

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("\n✅ All 3 syntax errors fixed!")
print("   - onMouseUp: Removed && guard")
print("   - onMouseLeave: Removed && guard")
print("   - onMouseDown: Removed && guard")
