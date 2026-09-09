"""Local source ingestion with immutable visible-text and formatting snapshots."""

from __future__ import annotations

import hashlib
import json
import re
import zipfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, List


MAX_RAW_DOCX_BYTES = 20 * 1024 * 1024
MAX_RAW_DOCX_MEMBERS = 2500
MAX_RAW_DOCX_UNCOMPRESSED_BYTES = 60 * 1024 * 1024


def validate_raw_docx_file(source: str) -> None:
    """Same defensive DOCX boundary as the API upload parser; filename alone is not trusted."""
    path = Path(source)
    if path.suffix.lower() != ".docx":
        raise ValueError("Raw batch accepts .docx files only.")
    if not path.is_file():
        raise ValueError("Raw DOCX file does not exist.")
    if path.stat().st_size > MAX_RAW_DOCX_BYTES:
        raise ValueError("Raw DOCX is larger than 20 MB.")
    if not zipfile.is_zipfile(path):
        raise ValueError("Raw input is not a DOCX archive.")
    with zipfile.ZipFile(path) as archive:
        members = archive.infolist()
        if len(members) > MAX_RAW_DOCX_MEMBERS or sum(member.file_size for member in members) > MAX_RAW_DOCX_UNCOMPRESSED_BYTES:
            raise ValueError("Raw DOCX archive is too large to process safely.")
        if any(member.flag_bits & 0x1 for member in members):
            raise ValueError("Encrypted DOCX files are not supported.")
        names = set(archive.namelist())
        if "[Content_Types].xml" not in names or "word/document.xml" not in names:
            raise ValueError("Raw input is not a Word document.")


@dataclass
class SourceSnapshot:
    filename: str
    visible_text: str
    format_manifest: List[Dict[str, Any]]
    source_hash: str
    unsupported_layouts: List[str]

    def prompt_payload(self) -> str:
        return json.dumps({
            "filename": self.filename,
            "visible_text": self.visible_text,
            "format_manifest": self.format_manifest,
            "unsupported_layouts": self.unsupported_layouts,
        }, ensure_ascii=False)


def _normalized(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def _digest(value: str) -> str:
    return hashlib.sha256(_normalized(value).encode("utf-8")).hexdigest()


def load_source_snapshot(source: str) -> SourceSnapshot:
    path = Path(source)
    if not path.exists():
        visible_text = source.strip()
        return SourceSnapshot("inline-source.txt", visible_text, [], _digest(visible_text), [])
    if path.suffix.lower() != ".docx":
        visible_text = path.read_text(encoding="utf-8")
        return SourceSnapshot(path.name, visible_text, [], _digest(visible_text), [])
    import docx

    document = docx.Document(path)
    manifest: List[Dict[str, Any]] = []
    visible: List[str] = []
    unsupported: List[str] = []
    for index, paragraph in enumerate(document.paragraphs):
        if not paragraph.text.strip():
            continue
        runs = [
            {
                "text": run.text,
                "bold": bool(run.bold),
                "italic": bool(run.italic),
                "underline": bool(run.underline),
            }
            for run in paragraph.runs if run.text
        ]
        alignment = {1: "center", 2: "right", 3: "justify"}.get(int(paragraph.alignment or 0), "left")
        style_name = (paragraph.style.name or "").lower() if paragraph.style else ""
        manifest.append({
            "kind": "paragraph",
            "index": index,
            "runs": runs or [{"text": paragraph.text}],
            "alignment": alignment,
            "list_item": "list" in style_name or "bullet" in style_name,
        })
        visible.append(paragraph.text)
    if document.tables:
        # Tables are visible parser-supported content, but the canonical renderer
        # currently needs explicit teacher/table support rather than flattening it.
        unsupported.append("table-layout")
        for table_index, table in enumerate(document.tables):
            rows = [[cell.text.strip() for cell in row.cells] for row in table.rows]
            manifest.append({"kind": "table", "index": table_index, "rows": rows})
            visible.extend(" | ".join(cell for cell in row if cell) for row in rows)
    visible_text = "\n".join(line for line in visible if line.strip())
    return SourceSnapshot(path.name, visible_text, manifest, _digest(visible_text), unsupported)


def detect_skill(visible_text: str) -> str:
    upper = visible_text.upper()
    type_match = re.search(r"\[TYPE\]\s*(READING|LISTENING|WRITING|INTEGRATED)\b", upper)
    if type_match:
        return type_match.group(1).title()
    if "WRITING TASK 1" in upper or "WRITE AT LEAST 250 WORDS" in upper:
        return "Writing"
    if "LISTEN AND ANSWER" in upper or "TRANSCRIPT" in upper or "AUDIO" in upper:
        return "Listening"
    if "READING PASSAGE" in upper or "READ THE TEXT" in upper:
        return "Reading"
    return "Unknown"


def load_source_text(source: str) -> str:
    return load_source_snapshot(source).visible_text
