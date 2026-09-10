"""OOXML media extraction, deduplicated internal assets, and deterministic embedding.

The extractor follows relationship IDs and document order. It never guesses an
image association from a filename. Unknown placement is a hard media-review
condition for the pipeline.
"""

from __future__ import annotations

import hashlib
import json
import mimetypes
import os
import posixpath
import re
import shutil
import zipfile
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional
from uuid import uuid4
from xml.etree import ElementTree as ET


OOXML = {
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "v": "urn:schemas-microsoft-com:vml",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
}
SAFE_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}


@dataclass
class MediaAsset:
    asset_id: str
    sha256: str
    original_filename: str
    mime_type: str
    original_format: str
    byte_size: int
    pixel_width: int | None
    pixel_height: int | None
    storage_path: str
    derivative_asset_id: str = ""


@dataclass
class MediaOccurrence:
    occurrence_id: str
    asset_id: str
    source_file_id: str
    owner_part: str
    relationship_id: str
    document_order: int
    location: str
    width_emu: int | None
    height_emu: int | None
    aspect_ratio: float | None
    crop: Dict[str, float]
    alt_text: str
    title: str
    caption: str
    association: str = ""
    association_confidence: str = "UNKNOWN"


@dataclass
class MediaExtraction:
    assets: List[MediaAsset]
    occurrences: List[MediaOccurrence]
    diagnostics: List[str]

    def to_dict(self) -> Dict[str, Any]:
        return {"assets": [asdict(item) for item in self.assets], "occurrences": [asdict(item) for item in self.occurrences], "diagnostics": self.diagnostics}


def _relationships(archive: zipfile.ZipFile, owner_part: str) -> Dict[str, str]:
    rels_part = posixpath.join(posixpath.dirname(owner_part), "_rels", posixpath.basename(owner_part) + ".rels")
    try:
        root = ET.fromstring(archive.read(rels_part))
    except KeyError:
        return {}
    output = {}
    for relationship in root.findall("rel:Relationship", OOXML):
        target = relationship.get("Target") or ""
        if target and not target.startswith("/") and not target.startswith("http"):
            target = posixpath.normpath(posixpath.join(posixpath.dirname(owner_part), target))
        output[relationship.get("Id") or ""] = target
    return output


def _image_dimensions(raw: bytes) -> tuple[int | None, int | None]:
    try:
        from PIL import Image
        from io import BytesIO
        with Image.open(BytesIO(raw)) as image:
            return image.size
    except Exception:
        return None, None


class InternalMediaStore:
    """Content-addressed backend-owned asset store.

    The API route serves asset IDs; no local path is sent to the client. In a
    multi-instance deployment this root must be a persistent shared volume or
    replaced by the Firebase adapter before enabling jobs with media.
    """

    def __init__(self, root: str | Path):
        self.root = Path(root)
        self.assets_dir = self.root / "assets"
        self.meta_dir = self.root / "metadata"
        self.assets_dir.mkdir(parents=True, exist_ok=True)
        self.meta_dir.mkdir(parents=True, exist_ok=True)

    def put(self, raw: bytes, filename: str) -> MediaAsset:
        digest = hashlib.sha256(raw).hexdigest()
        extension = Path(filename).suffix.lower() or ".bin"
        safe_name = f"{digest}{extension}"
        asset_path = self.assets_dir / safe_name
        if not asset_path.exists():
            asset_path.write_bytes(raw)
        width, height = _image_dimensions(raw)
        asset = MediaAsset(
            asset_id=f"media_{digest[:24]}",
            sha256=digest,
            original_filename=Path(filename).name,
            mime_type=mimetypes.guess_type(filename)[0] or "application/octet-stream",
            original_format=extension.lstrip("."),
            byte_size=len(raw),
            pixel_width=width,
            pixel_height=height,
            storage_path=str(asset_path),
        )
        metadata_path = self.meta_dir / f"{asset.asset_id}.json"
        if not metadata_path.exists():
            metadata_path.write_text(json.dumps(asdict(asset), ensure_ascii=False, indent=2), encoding="utf-8")
        return asset

    def get(self, asset_id: str) -> Optional[MediaAsset]:
        path = self.meta_dir / f"{asset_id}.json"
        if not path.exists():
            return None
        try:
            asset = MediaAsset(**json.loads(path.read_text(encoding="utf-8")))
        except (OSError, TypeError, json.JSONDecodeError):
            return None
        asset_path = Path(asset.storage_path)
        try:
            asset_path.resolve().relative_to(self.assets_dir.resolve())
        except (OSError, ValueError):
            return None
        return asset if asset_path.is_file() else None


def managed_media_url(base_url: str, asset_id: str) -> str:
    base_url = str(base_url or "").strip().rstrip("/")
    if not base_url.startswith("https://"):
        raise ValueError("EXAM_GENERATION_MEDIA_BASE_URL must be an HTTPS origin before DOCX media can be released.")
    return f"{base_url}/api/exam-media/{asset_id}"


def resolve_media_bindings(exam: Any, extraction: MediaExtraction, public_base_url: str) -> tuple[Dict[str, str], List[str]]:
    """Resolve model-declared occurrence bindings without any filename guessing.

    Every input occurrence must appear exactly once. A source graphic not tied to a
    parser-supported map, diagram, or Writing task is deliberately rejected rather
    than being silently dropped or attached to the wrong question.
    """
    diagnostics = list(extraction.diagnostics)
    assets = {asset.asset_id: asset for asset in extraction.assets}
    occurrences = {item.occurrence_id: item for item in extraction.occurrences}
    bindings = list(getattr(exam, "media_bindings", []) or [])
    bound: set[str] = set()
    asset_paths: Dict[str, str] = {}
    questions = {
        int(question.question_number): question
        for section in getattr(exam, "sections", [])
        for question in section.questions
    }
    writing_tasks = {int(task.task_number): task for task in getattr(exam, "writing_tasks", [])}

    if len(bindings) != len(occurrences):
        diagnostics.append("Every embedded media occurrence must have exactly one canonical media binding.")
    for raw in bindings:
        occurrence_id = str(raw.get("occurrence_id") or "")
        asset_id = str(raw.get("asset_id") or "")
        association = str(raw.get("association") or "")
        occurrence = occurrences.get(occurrence_id)
        asset = assets.get(asset_id)
        if not occurrence or not asset:
            diagnostics.append(f"Unknown media occurrence or asset in binding {occurrence_id!r}.")
            continue
        if occurrence.asset_id != asset_id or occurrence_id in bound:
            diagnostics.append(f"Media binding {occurrence_id!r} is duplicate or points to the wrong content hash.")
            continue
        if Path(asset.storage_path).suffix.lower() not in SAFE_IMAGE_EXTENSIONS:
            diagnostics.append(f"Media {asset.original_filename!r} is not a renderer-safe raster image.")
            continue
        try:
            url = managed_media_url(public_base_url, asset_id)
        except ValueError as exc:
            diagnostics.append(str(exc))
            continue
        question_match = re.fullmatch(r"question:(\d+)", association)
        writing_match = re.fullmatch(r"writing_task:([12])", association)
        if question_match:
            number = int(question_match.group(1))
            question = questions.get(number)
            if not question or question.block_type not in {"MAP_DRAG", "DIAGRAM_LABEL"}:
                diagnostics.append(f"Media occurrence {occurrence_id} is not assigned to a MAP_DRAG or DIAGRAM_LABEL question.")
                continue
            if question.media_asset_id and question.media_asset_id != asset_id:
                diagnostics.append(f"Question {number} has more than one incompatible media asset.")
                continue
            question.media_asset_id = asset_id
            question.media_url = url
        elif writing_match:
            task_number = int(writing_match.group(1))
            task = writing_tasks.get(task_number)
            if not task:
                diagnostics.append(f"Media occurrence {occurrence_id} references missing Writing task {task_number}.")
                continue
            if task.media_asset_id and task.media_asset_id != asset_id:
                diagnostics.append(f"Writing task {task_number} has more than one incompatible media asset.")
                continue
            task.media_asset_id = asset_id
            task.media_url = url
        else:
            diagnostics.append(f"Unsupported media association {association!r}; expected question:N or writing_task:1|2.")
            continue
        bound.add(occurrence_id)
        asset_paths[asset_id] = asset.storage_path
    missing = sorted(set(occurrences) - bound)
    if missing:
        diagnostics.append(f"Unbound media occurrences: {', '.join(missing)}.")
    return asset_paths, diagnostics


def verify_embedded_media_roundtrip(rendered_docx: str | Path, media_asset_paths: Dict[str, str]) -> None:
    """Ensure the rendered DOCX contains exactly the managed image bytes requested."""
    if not media_asset_paths:
        return
    expected = Counter(hashlib.sha256(Path(path).read_bytes()).hexdigest() for path in media_asset_paths.values())
    with zipfile.ZipFile(rendered_docx) as archive:
        actual = Counter(
            hashlib.sha256(archive.read(name)).hexdigest()
            for name in archive.namelist()
            if name.startswith("word/media/") and not name.endswith("/")
        )
    if actual != expected:
        raise ValueError("Rendered DOCX media bytes do not exactly match the verified managed asset set.")


def _crop(element: ET.Element) -> Dict[str, float]:
    source_rect = element.find(".//a:srcRect", OOXML)
    if source_rect is None:
        return {}
    return {key: float(source_rect.get(key, "0")) / 1000 for key in ("l", "t", "r", "b") if source_rect.get(key) is not None}


def _part_occurrences(
    archive: zipfile.ZipFile,
    owner_part: str,
    source_file_id: str,
    store: InternalMediaStore,
    document_order_start: int,
    location_prefix: str,
) -> tuple[List[MediaAsset], List[MediaOccurrence], List[str], int]:
    diagnostics: List[str] = []
    assets_by_id: Dict[str, MediaAsset] = {}
    occurrences: List[MediaOccurrence] = []
    try:
        root = ET.fromstring(archive.read(owner_part))
    except KeyError:
        return [], [], [f"Missing OOXML owner part: {owner_part}"], document_order_start
    relationships = _relationships(archive, owner_part)
    order = document_order_start
    for paragraph_index, paragraph in enumerate(root.findall(".//w:p", OOXML)):
        for drawing in list(paragraph.findall(".//w:drawing", OOXML)) + list(paragraph.findall(".//w:pict", OOXML)):
            embeds = [item.get(f"{{{OOXML['r']}}}embed") for item in drawing.findall(".//a:blip", OOXML)]
            embeds.extend(item.get(f"{{{OOXML['r']}}}id") for item in drawing.findall(".//v:imagedata", OOXML))
            embeds = [value for value in embeds if value]
            for relationship_id in embeds:
                target = relationships.get(relationship_id)
                if not target or target not in archive.namelist():
                    diagnostics.append(f"Unresolved image relationship {relationship_id} in {owner_part}.")
                    continue
                raw = archive.read(target)
                asset = store.put(raw, posixpath.basename(target))
                assets_by_id[asset.asset_id] = asset
                extent = drawing.find(".//wp:extent", OOXML)
                width = int(extent.get("cx")) if extent is not None and (extent.get("cx") or "").isdigit() else None
                height = int(extent.get("cy")) if extent is not None and (extent.get("cy") or "").isdigit() else None
                doc_pr = drawing.find(".//wp:docPr", OOXML)
                occurrences.append(MediaOccurrence(
                    occurrence_id=f"occ_{source_file_id[:12]}_{order}_{asset.sha256[:10]}",
                    asset_id=asset.asset_id,
                    source_file_id=source_file_id,
                    owner_part=owner_part,
                    relationship_id=relationship_id,
                    document_order=order,
                    location=f"{location_prefix}:paragraph:{paragraph_index}",
                    width_emu=width,
                    height_emu=height,
                    aspect_ratio=(width / height) if width and height else (asset.pixel_width / asset.pixel_height if asset.pixel_width and asset.pixel_height else None),
                    crop=_crop(drawing),
                    alt_text=(doc_pr.get("descr") if doc_pr is not None else "") or "",
                    title=(doc_pr.get("title") if doc_pr is not None else "") or "",
                    caption="",
                ))
                order += 1
    return list(assets_by_id.values()), occurrences, diagnostics, order


def extract_docx_media(source: str | Path, source_file_id: str, store: InternalMediaStore) -> MediaExtraction:
    """Extract document/header/footer images through OOXML relationship resolution."""
    assets: Dict[str, MediaAsset] = {}
    occurrences: List[MediaOccurrence] = []
    diagnostics: List[str] = []
    with zipfile.ZipFile(source) as archive:
        parts = ["word/document.xml"]
        parts.extend(name for name in archive.namelist() if re.fullmatch(r"word/(?:header|footer)\d+\.xml", name))
        order = 0
        for part in parts:
            part_assets, part_occurrences, part_diagnostics, order = _part_occurrences(
                archive, part, source_file_id, store, order, "body" if part == "word/document.xml" else Path(part).stem
            )
            assets.update({asset.asset_id: asset for asset in part_assets})
            occurrences.extend(part_occurrences)
            diagnostics.extend(part_diagnostics)
    return MediaExtraction(list(assets.values()), occurrences, diagnostics)
