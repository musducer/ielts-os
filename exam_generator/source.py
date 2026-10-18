"""Local source ingestion with immutable visible-text and formatting snapshots."""

from __future__ import annotations

import hashlib
import base64
import io
import json
import re
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List


MAX_RAW_DOCX_BYTES = 20 * 1024 * 1024
MAX_RAW_DOCX_MEMBERS = 2500
MAX_RAW_DOCX_UNCOMPRESSED_BYTES = 60 * 1024 * 1024
INLINE_IR_VERSION = "2026-09-13.inline-text-v1"


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
    blocks: List[Dict[str, Any]] = field(default_factory=list)
    ir_version: str = INLINE_IR_VERSION
    coverage: Dict[str, Any] = field(default_factory=lambda: {"state": "PASS"})
    diagnostics: List[Dict[str, Any]] = field(default_factory=list)
    _media_files: Dict[str, Dict[str, str]] = field(default_factory=dict, repr=False, compare=False)

    def prompt_payload(self) -> str:
        return json.dumps({
            "filename": self.filename,
            "visible_text": self.visible_text,
            "format_manifest": self.format_manifest,
            "source_hash": self.source_hash,
            "ir_version": self.ir_version,
            "coverage": self.coverage,
            "diagnostics": self.diagnostics,
        }, ensure_ascii=False)

    def bind_media(self, extraction: Any | None) -> None:
        """Join the independent byte extractor back to exact ordered IR occurrences."""
        image_blocks = [block for block in self.blocks if str(block.get("kind") or "").upper() == "IMAGE"]
        occurrences = list(getattr(extraction, "occurrences", []) or [])
        assets = {str(asset.asset_id): asset for asset in (getattr(extraction, "assets", []) or [])}
        if len(image_blocks) != len(occurrences):
            raise ValueError(
                f"SOURCE_MEDIA_IR_MISMATCH: ordered IR has {len(image_blocks)} image occurrences "
                f"but the byte extractor found {len(occurrences)}."
            )
        by_occurrence = {str(item.occurrence_id): item for item in occurrences}
        if len(by_occurrence) != len(occurrences):
            raise ValueError("SOURCE_MEDIA_IR_MISMATCH: duplicate extracted media occurrence IDs.")
        for block in image_blocks:
            occurrence_id = str(block.get("occurrence_id") or "")
            occurrence = by_occurrence.get(occurrence_id)
            if occurrence is None:
                raise ValueError(f"SOURCE_MEDIA_IR_MISMATCH: missing extracted occurrence {occurrence_id!r}.")
            expected = (
                str(block.get("source_part") or ""),
                str(block.get("relationship_id") or ""),
                int(block.get("media_order", -1)),
                str(block.get("location") or ""),
                str(block.get("asset_id") or ""),
            )
            actual = (
                str(occurrence.owner_part), str(occurrence.relationship_id),
                int(occurrence.document_order), str(occurrence.location),
                str(occurrence.asset_id),
            )
            if expected != actual:
                raise ValueError(
                    f"SOURCE_MEDIA_IR_MISMATCH: occurrence {occurrence_id!r} differs between "
                    "ordered-position and byte extraction."
                )
            asset = assets.get(str(occurrence.asset_id))
            if asset is None or str(asset.sha256) != str(block.get("sha256") or ""):
                raise ValueError(f"SOURCE_MEDIA_IR_MISMATCH: asset hash differs for {occurrence_id!r}.")
            block.update({
                "asset_id": asset.asset_id,
                "sha256": asset.sha256,
                "mime_type": asset.mime_type,
                "pixel_width": asset.pixel_width,
                "pixel_height": asset.pixel_height,
                "width_emu": occurrence.width_emu,
                "height_emu": occurrence.height_emu,
                "aspect_ratio": occurrence.aspect_ratio,
                "crop": dict(occurrence.crop),
                "alt_text": occurrence.alt_text,
                "title": occurrence.title,
            })
            self._media_files[occurrence_id] = {
                "path": str(asset.storage_path), "mime_type": str(asset.mime_type),
                "occurrence_id": occurrence_id, "asset_id": str(asset.asset_id),
            }

    def provider_image_inputs(self, occurrence_ids: List[str]) -> List[Dict[str, str]]:
        """Prepare bounded private visual bytes without leaking worker paths into prompts."""
        selected = [self._media_files[item] for item in occurrence_ids if item in self._media_files]
        if len(selected) != len(occurrence_ids):
            raise ValueError("A source visual occurrence is not available to the isolated worker.")
        if len(selected) > 4:
            raise ValueError("A structural source group contains more than four required visuals.")
        prepared: List[Dict[str, str]] = []
        total = 0
        for record in selected:
            path = Path(record["path"])
            mime_type = record["mime_type"].lower()
            if not path.is_file() or not mime_type.startswith("image/"):
                raise ValueError("A required source visual is unavailable or not a supported image.")
            raw = path.read_bytes()
            if not raw or len(raw) > MAX_RAW_DOCX_BYTES:
                raise ValueError("A required source visual is empty or exceeds the safe input limit.")
            if len(raw) > 2_500_000:
                try:
                    from PIL import Image
                    with Image.open(io.BytesIO(raw)) as image:
                        image.thumbnail((2200, 2200))
                        converted = image.convert("RGB")
                        target = io.BytesIO()
                        converted.save(target, format="JPEG", quality=90, optimize=True)
                        raw = target.getvalue()
                        mime_type = "image/jpeg"
                except Exception as exc:
                    raise ValueError("A required source visual could not be prepared for AI inspection.") from exc
            total += len(raw)
            if total > 8 * 1024 * 1024:
                raise ValueError("Required source visuals exceed the bounded AI inspection payload.")
            prepared.append({
                "mime_type": mime_type, "data": base64.b64encode(raw).decode("ascii"),
                "occurrence_id": record["occurrence_id"], "asset_id": record["asset_id"],
            })
        return prepared


def _normalized(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def _digest(value: str) -> str:
    return hashlib.sha256(_normalized(value).encode("utf-8")).hexdigest()


def load_source_snapshot(source: str) -> SourceSnapshot:
    path = Path(source)
    if not path.exists():
        visible_text = source.strip()
        return SourceSnapshot("inline-source.txt", visible_text, [], _digest(visible_text))
    if path.suffix.lower() != ".docx":
        visible_text = path.read_text(encoding="utf-8")
        return SourceSnapshot(path.name, visible_text, [], _digest(visible_text))
    from .docx_ir import IR_VERSION, OrderedDocxReader
    validate_raw_docx_file(str(path))
    blocks, visible_text, digest, coverage, diagnostics = OrderedDocxReader(path).read()
    return SourceSnapshot(path.name, visible_text, blocks, digest, blocks=blocks,
                          ir_version=IR_VERSION, coverage=coverage, diagnostics=diagnostics)


def detect_skill(visible_text: str) -> str:
    upper = visible_text.upper()
    type_match = re.search(r"\[TYPE\]\s*(READING|LISTENING|WRITING|INTEGRATED)\b", upper)
    if type_match:
        return type_match.group(1).title()
    if re.search(r"\b(?:WRITING\s+)?TASK\s*[12]\b", upper) or "WRITE AT LEAST 250 WORDS" in upper:
        return "Writing"
    if (re.search(r"\bLISTEN(?:ING)?\b", upper)
            or "TRANSCRIPT" in upper or re.search(r"\bAUDIO\b", upper)):
        return "Listening"
    if ("READING PASSAGE" in upper or re.search(r"\bREAD\s+THE\s+(?:TEXT|PASSAGE)\b", upper)
            or (re.search(r"\bPASSAGE\s*[1-3]\b", upper)
                and re.search(r"\bQUESTIONS?\s*\d+\s*(?:-|\u2013|\u2014|TO)\s*\d+\b", upper))):
        return "Reading"
    return "Unknown"


def load_source_text(source: str) -> str:
    return load_source_snapshot(source).visible_text
