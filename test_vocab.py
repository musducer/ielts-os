# -*- coding: utf-8 -*-
"""
Test nhanh /api/ai_vocab — KHÔNG cần build frontend.
Cách dùng:
  1) Chạy backend:  uvicorn api.index:app --port 8000   (đảm bảo GROQ_API_KEY đã set)
  2) Chạy test:     python test_vocab.py
Tùy chọn: API_BASE=https://your-app.vercel.app python test_vocab.py
"""
import os, json, io, sys
import urllib.request

API_BASE = os.environ.get("API_BASE", "http://localhost:8000")

# Đoạn cranberry mẫu (chứa đúng các case từng gây lỗi: carved deep, formative hothouse-like, tense...)
SOURCE = (
 "Cranberries are among the few fruits native to North America that have been grown commercially for centuries. "
 "They are generally cultivated in low-lying areas called bogs. During the last ice age, retreating glaciers carved "
 "deep hollows known as kettle ponds, which later filled with water and organic matter. Growers have made significant "
 "progress in mechanising the harvest. The berries are usually harvested in autumn, when the bogs are flooded so the "
 "buoyant fruit floats to the surface. Cranberry production poses a threat to some wetland habitats, and farmers must "
 "act in accordance with strict environmental rules. Not only do the plants tolerate acidic soil, but they also thrive "
 "in it. The crop is said to have considerable health benefits owing to its high antioxidant content."
)

payload = {"lang": "vi", "count": 15, "target": "7.0", "source": SOURCE, "wrongContext": "",
           "kinds": ["word", "phrasal_verb", "idiom", "collocation", "grammar"]}

req = urllib.request.Request(f"{API_BASE}/api/ai_vocab",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST")

out = io.open("test_vocab_result.txt", "w", encoding="utf-8")
try:
    with urllib.request.urlopen(req, timeout=120) as r:
        data = json.loads(r.read().decode("utf-8"))
except Exception as e:
    out.write(f"REQUEST FAILED: {e}\n"); out.close()
    print("REQUEST FAILED — xem test_vocab_result.txt"); sys.exit(1)

if not data.get("success"):
    out.write("ERROR: " + str(data.get("error")) + "\n" + str(data.get("raw", "")))
    out.close(); print("API error — xem test_vocab_result.txt"); sys.exit(1)

items = data.get("items", [])
out.write(f"dropped (chống bịa): {data.get('dropped')}\n")
out.write(f"tong items giu lai: {len(items)}\n\n")
by = {}
for it in items:
    by.setdefault(it.get("category", "?"), []).append(it)
for cat in ["word", "phrasal_verb", "idiom", "collocation", "grammar"]:
    lst = by.get(cat, [])
    out.write(f"=== {cat} ({len(lst)}) ===\n")
    for it in lst:
        out.write(f"  - {it.get('word')}  [{it.get('cefr','')}]  : {it.get('meaning_vi') or it.get('meaning_en') or ''}\n")
    out.write("\n")
# cảnh báo nếu còn lọt rác
GARBAGE = ["carved deep", "formative hothouse", "retreating glaciers", "kettle ponds",
           "low-lying areas", "have been grown", "are generally cultivated", "have made"]
leaked = [it.get("word") for it in items if str(it.get("word", "")).lower() in GARBAGE]
out.write("LEAKED GARBAGE: " + (", ".join(leaked) if leaked else "(none - PASS)") + "\n")
out.close()
print("DONE — xem test_vocab_result.txt")
