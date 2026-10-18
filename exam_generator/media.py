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
from typing import Any, Dict, Iterable, Iterator, List, Optional
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
SAFE_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tif", ".tiff"}
MEDIA_METADATA_PREFIX = "IELTS_OS_MEDIA:"


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
        public_assets = []
        for item in self.assets:
            value = asdict(item)
            # Local worker paths are capability-bearing implementation details.
            # They must never enter provider prompts, progress or durable JSON.
            value.pop("storage_path", None)
            public_assets.append(value)
        return {
            "assets": public_assets,
            "occurrences": [asdict(item) for item in self.occurrences],
            "diagnostics": self.diagnostics,
        }


def question_media_inputs(exam: Any, extraction: "MediaExtraction", question_number: int) -> List[Dict[str, str]]:
    """Return ordered private inputs for one visual question's solver/critic."""
    association_prefix = f"question:{int(question_number)}"
    binding_by_id = {
        str(item.get("occurrence_id") or ""): str(item.get("association") or "").strip().lower()
        for item in (getattr(exam, "media_bindings", []) or [])
        if isinstance(item, dict)
    }
    assets = {item.asset_id: item for item in extraction.assets}
    output: List[Dict[str, str]] = []
    for occurrence in sorted(extraction.occurrences, key=lambda item: item.document_order):
        association = binding_by_id.get(occurrence.occurrence_id, occurrence.association.lower())
        if association != association_prefix and not association.startswith(association_prefix + ":"):
            continue
        asset = assets.get(occurrence.asset_id)
        if not asset or not Path(asset.storage_path).is_file():
            continue
        output.append({
            "occurrence_id": occurrence.occurrence_id,
            "asset_id": asset.asset_id,
            "path": asset.storage_path,
            "mime_type": asset.mime_type,
        })
    return output


class ResolvedMediaPaths(dict):
    """Asset paths plus the occurrence contract used by renderer verification.

    Assets remain content-addressed and deduplicated, while occurrences remain
    distinct.  A normal ``dict`` interface keeps the old renderer/API contract.
    """

    def __init__(self, *args: Any, extraction: MediaExtraction, bindings: Dict[str, Dict[str, Any]], **kwargs: Any):
        super().__init__(*args, **kwargs)
        self.extraction = extraction
        self.bindings = bindings
        self.rendered_occurrence_ids: List[str] = []


def encode_media_metadata(value: Dict[str, Any]) -> str:
    """Encode only public, deterministic media identity into OOXML alt text."""
    public = {
        key: value.get(key)
        for key in ("occurrence_id", "asset_id", "association", "url", "alt_text", "title", "sha256")
        if value.get(key) not in (None, "")
    }
    return MEDIA_METADATA_PREFIX + json.dumps(public, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def decode_media_metadata(value: Any) -> Optional[Dict[str, str]]:
    """Decode renderer-owned picture metadata; ignore arbitrary Word alt text."""
    raw = str(value or "")
    if not raw.startswith(MEDIA_METADATA_PREFIX) or len(raw) > 8_192:
        return None
    try:
        payload = json.loads(raw[len(MEDIA_METADATA_PREFIX):])
    except (TypeError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    occurrence_id = str(payload.get("occurrence_id") or "").strip()
    asset_id = str(payload.get("asset_id") or "").strip()
    association = str(payload.get("association") or "").strip().lower()
    url = str(payload.get("url") or "").strip()
    digest = str(payload.get("sha256") or "").strip().lower()
    if not re.fullmatch(r"occ_[A-Za-z0-9_-]{3,180}", occurrence_id):
        return None
    if not re.fullmatch(r"media_[a-f0-9]{24}", asset_id):
        return None
    if not association or not re.fullmatch(r"[a-z0-9_.:-]{3,180}", association):
        return None
    if url and not url.startswith("https://"):
        return None
    if digest and not re.fullmatch(r"[a-f0-9]{64}", digest):
        return None
    return {
        "occurrence_id": occurrence_id,
        "asset_id": asset_id,
        "association": association,
        "url": url,
        "alt_text": str(payload.get("alt_text") or "")[:1_000],
        "title": str(payload.get("title") or "")[:1_000],
        "sha256": digest,
    }


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


def _paragraph_media_references(paragraph: Any, scope: str) -> Iterator[tuple[Dict[str, Any], str, set[str]]]:
    """Yield mutable rich-media payloads, including media nested in table cells."""
    if isinstance(paragraph, dict):
        media = paragraph.get("media")
        table = paragraph.get("table")
    else:
        media = getattr(paragraph, "media", None)
        table = getattr(paragraph, "table", None)
    coarse = scope.split(":", 2)
    accepted = {scope}
    if scope.startswith("question:"):
        accepted.add(":".join(coarse[:2]))
    elif scope.startswith("writing_task:"):
        accepted.add(":".join(coarse[:2]))
    elif scope.startswith("section:") and scope.endswith(":passage"):
        section_number = scope.split(":")[1]
        accepted.update({f"section:{section_number}:passage", f"passage:{section_number}"})
    if isinstance(media, dict):
        yield media, scope, accepted
    if not isinstance(table, dict):
        return
    for row_index, row in enumerate(table.get("rows") or []):
        if not isinstance(row, dict):
            continue
        for cell_index, cell in enumerate(row.get("cells") or []):
            if not isinstance(cell, dict):
                continue
            for paragraph_index, child in enumerate(cell.get("paragraphs") or []):
                child_scope = f"{scope}:table:{row_index}:{cell_index}:{paragraph_index}"
                yield from _paragraph_media_references(child, child_scope)


def _exam_rich_media_references(exam: Any) -> Iterator[tuple[Dict[str, Any], str, set[str]]]:
    for section_index, section in enumerate(getattr(exam, "sections", []) or [], start=1):
        for paragraph in getattr(section, "passage", []) or []:
            yield from _paragraph_media_references(paragraph, f"section:{section_index}:passage")
        for question in getattr(section, "questions", []) or []:
            number = int(getattr(question, "question_number", 0) or 0)
            yield from _paragraph_media_references(getattr(question, "text", None), f"question:{number}:text")
            for field in ("instruction", "context", "flow_lines"):
                for paragraph in getattr(question, field, []) or []:
                    yield from _paragraph_media_references(paragraph, f"question:{number}:{field}")
            for box_index, box in enumerate((getattr(question, "diagram", {}) or {}).get("boxes") or []):
                if not isinstance(box, dict):
                    continue
                for paragraph in box.get("lines") or []:
                    yield from _paragraph_media_references(paragraph, f"question:{number}:diagram:{box_index}")
    for task in getattr(exam, "writing_tasks", []) or []:
        task_number = int(getattr(task, "task_number", 0) or 0)
        for paragraph in getattr(task, "prompt", []) or []:
            yield from _paragraph_media_references(paragraph, f"writing_task:{task_number}:prompt")


def _rich_media_payload(occurrence: MediaOccurrence, asset: MediaAsset, url: str, association: str) -> Dict[str, Any]:
    return {
        "asset_id": asset.asset_id,
        "occurrence_id": occurrence.occurrence_id,
        "url": url,
        "width_emu": occurrence.width_emu,
        "height_emu": occurrence.height_emu,
        "alt_text": occurrence.alt_text,
        "title": occurrence.title,
        "sha256": asset.sha256,
        "mime_type": asset.mime_type,
        "association": association,
    }


def resolve_media_bindings(exam: Any, extraction: MediaExtraction, public_base_url: str) -> tuple[Dict[str, str], List[str]]:
    """Resolve model-declared occurrence bindings without any filename guessing.

    Every input occurrence must appear exactly once.  Generic passage/question
    graphics are valid only when a rich-media placeholder preserves their exact
    canonical position.  Coarse ownership without a position remains fail-closed.
    """
    diagnostics = list(extraction.diagnostics)
    assets = {asset.asset_id: asset for asset in extraction.assets}
    occurrences = {item.occurrence_id: item for item in extraction.occurrences}
    bindings = list(getattr(exam, "media_bindings", []) or [])
    binding_by_occurrence: Dict[str, Dict[str, Any]] = {}
    bound: set[str] = set()
    asset_paths: Dict[str, str] = {}
    questions = {
        int(question.question_number): question
        for section in getattr(exam, "sections", [])
        for question in section.questions
    }
    writing_tasks = {int(task.task_number): task for task in getattr(exam, "writing_tasks", [])}
    rich_references: Dict[str, List[tuple[Dict[str, Any], str, set[str]]]] = {}
    for media, scope, accepted in _exam_rich_media_references(exam):
        occurrence_id = str(media.get("occurrence_id") or "").strip()
        if occurrence_id:
            rich_references.setdefault(occurrence_id, []).append((media, scope, accepted))

    if len(bindings) != len(occurrences):
        diagnostics.append("Every embedded media occurrence must have exactly one canonical media binding.")
    for raw in bindings:
        occurrence_id = str(raw.get("occurrence_id") or "")
        asset_id = str(raw.get("asset_id") or "")
        association = str(raw.get("association") or "").strip().lower()
        if occurrence_id in binding_by_occurrence:
            diagnostics.append(f"Media occurrence {occurrence_id!r} has duplicate canonical bindings.")
            continue
        binding_by_occurrence[occurrence_id] = dict(raw, association=association)
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
        binding_by_occurrence[occurrence_id]["managed_url"] = url
        references = rich_references.get(occurrence_id, [])
        if len(references) > 1:
            diagnostics.append(f"Media occurrence {occurrence_id} appears in more than one canonical rich-media position.")
            continue
        question_match = re.fullmatch(r"question:(\d+)(?::(?:text|instruction|context|flow_lines|diagram)(?::.*)?)?", association)
        writing_match = re.fullmatch(r"writing_task:([12])(?::prompt(?::.*)?)?", association)
        passage_match = re.fullmatch(r"(?:section:(\d+):passage|passage:(\d+))(?::.*)?", association)

        if references:
            media, scope, accepted = references[0]
            coarse_association = association.split(":table:", 1)[0]
            if association not in accepted and coarse_association not in accepted:
                diagnostics.append(
                    f"Media occurrence {occurrence_id} is positioned at {scope} but binding declares {association!r}."
                )
                continue
            if str(media.get("asset_id") or "").strip() != asset_id:
                diagnostics.append(f"Media occurrence {occurrence_id} rich position points to the wrong content hash.")
                continue
            media.clear()
            media.update(_rich_media_payload(occurrence, asset, url, association))

        if question_match:
            number = int(question_match.group(1))
            question = questions.get(number)
            if not question:
                diagnostics.append(f"Media occurrence {occurrence_id} references missing question {number}.")
                continue
            if not references and question.block_type not in {"MAP_DRAG", "DIAGRAM_LABEL"}:
                diagnostics.append(
                    f"Media occurrence {occurrence_id} has generic question ownership but no exact rich-media position."
                )
                continue
            if question.media_asset_id and question.media_asset_id != asset_id and not references:
                diagnostics.append(f"Question {number} has more than one incompatible media asset.")
                continue
            if question.block_type in {"MAP_DRAG", "DIAGRAM_LABEL"}:
                # Provider-supplied URLs are never trusted, even when the asset ID matches.
                question.media_asset_id = asset_id
                question.media_url = url
        elif writing_match:
            task_number = int(writing_match.group(1))
            task = writing_tasks.get(task_number)
            if not task:
                diagnostics.append(f"Media occurrence {occurrence_id} references missing Writing task {task_number}.")
                continue
            if not references:
                diagnostics.append(
                    f"Media occurrence {occurrence_id} has Writing task ownership but no exact prompt position."
                )
                continue
            if task.media_asset_id and task.media_asset_id != asset_id and not references:
                diagnostics.append(f"Writing task {task_number} has more than one incompatible media asset.")
                continue
            # Always replace provider URLs with the managed immutable asset route.
            task.media_asset_id = asset_id
            task.media_url = url
        elif passage_match:
            section_number = int(passage_match.group(1) or passage_match.group(2))
            if not 1 <= section_number <= len(getattr(exam, "sections", []) or []):
                diagnostics.append(f"Media occurrence {occurrence_id} references missing passage {section_number}.")
                continue
            if not references:
                diagnostics.append(
                    f"Media occurrence {occurrence_id} has passage ownership but no exact rich-media position."
                )
                continue
        else:
            diagnostics.append(
                f"Unsupported media association {association!r}; expected question:N, passage:N, section:N:passage, or writing_task:1|2."
            )
            continue
        occurrence.association = association
        occurrence.association_confidence = "EXACT" if references else "DEDICATED_GRAMMAR"
        bound.add(occurrence_id)
        asset_paths[asset_id] = asset.storage_path

    for occurrence_id, references in rich_references.items():
        if occurrence_id not in occurrences:
            diagnostics.append(f"Canonical rich-media position references unknown occurrence {occurrence_id!r}.")
        elif len(references) != 1:
            diagnostics.append(f"Canonical occurrence {occurrence_id!r} must appear in exactly one rich-media position.")
    missing = sorted(set(occurrences) - bound)
    if missing:
        diagnostics.append(f"Unbound media occurrences: {', '.join(missing)}.")
    return ResolvedMediaPaths(asset_paths, extraction=extraction, bindings=binding_by_occurrence), diagnostics


def verify_embedded_media_roundtrip(rendered_docx: str | Path, media_asset_paths: Dict[str, str]) -> None:
    """Verify every rendered occurrence's bytes, identity, association and order."""
    if not media_asset_paths:
        return
    if not isinstance(media_asset_paths, ResolvedMediaPaths):
        expected = Counter(hashlib.sha256(Path(path).read_bytes()).hexdigest() for path in media_asset_paths.values())
        with zipfile.ZipFile(rendered_docx) as archive:
            actual = Counter(
                hashlib.sha256(archive.read(name)).hexdigest()
                for name in archive.namelist()
                if name.startswith("word/media/") and not name.endswith("/")
            )
        if actual != expected:
            raise ValueError("Rendered DOCX media bytes do not exactly match the verified managed asset set.")
        return

    assets = {asset.asset_id: asset for asset in media_asset_paths.extraction.assets}
    occurrences = {item.occurrence_id: item for item in media_asset_paths.extraction.occurrences}
    expected_ids = list(media_asset_paths.rendered_occurrence_ids)
    declared_ids = list(media_asset_paths.bindings)
    if len(expected_ids) != len(declared_ids) or set(expected_ids) != set(declared_ids):
        raise ValueError("Renderer did not emit every bound media occurrence exactly once.")
    source_order = [item.occurrence_id for item in sorted(
        media_asset_paths.extraction.occurrences, key=lambda item: item.document_order
    ) if item.occurrence_id in media_asset_paths.bindings]
    if expected_ids != source_order:
        raise ValueError("Canonical media occurrence order differs from the immutable source order.")
    actual_records: List[Dict[str, str]] = []
    with zipfile.ZipFile(rendered_docx) as archive:
        from .docx_ir import iter_media_references, source_parts
        for part in source_parts(archive):
            rels = _relationships(archive, part)
            for reference in iter_media_references(archive, part):
                target = rels.get(reference["relationship_id"])
                if not target or target not in archive.namelist():
                    raise ValueError("Rendered DOCX contains an unresolved media relationship.")
                doc_pr = reference["drawing"].find(".//wp:docPr", OOXML)
                metadata = decode_media_metadata(doc_pr.get("descr") if doc_pr is not None else "")
                if not metadata:
                    raise ValueError("Rendered DOCX contains media without deterministic occurrence metadata.")
                metadata["actual_sha256"] = hashlib.sha256(archive.read(target)).hexdigest()
                actual_records.append(metadata)
    if [item["occurrence_id"] for item in actual_records] != expected_ids:
        raise ValueError("Rendered DOCX media occurrence order differs from the canonical output order.")
    for metadata in actual_records:
        occurrence_id = metadata["occurrence_id"]
        occurrence = occurrences.get(occurrence_id)
        binding = media_asset_paths.bindings.get(occurrence_id) or {}
        asset = assets.get(metadata["asset_id"])
        if not occurrence or not asset or occurrence.asset_id != metadata["asset_id"]:
            raise ValueError(f"Rendered DOCX occurrence {occurrence_id!r} has the wrong asset identity.")
        if metadata["actual_sha256"] != asset.sha256 or (metadata.get("sha256") and metadata["sha256"] != asset.sha256):
            raise ValueError(f"Rendered DOCX occurrence {occurrence_id!r} has modified media bytes.")
        if metadata["association"] != str(binding.get("association") or "").strip().lower():
            raise ValueError(f"Rendered DOCX occurrence {occurrence_id!r} has the wrong semantic association.")
        if metadata.get("url") != str(binding.get("managed_url") or ""):
            raise ValueError(f"Rendered DOCX occurrence {occurrence_id!r} does not use its managed media URL.")


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
    from .docx_ir import iter_media_references
    for reference in iter_media_references(archive, owner_part):
                drawing = reference['drawing']
                relationship_id = reference['relationship_id']
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
                    location=reference['location'],
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
        from .docx_ir import source_parts
        parts = source_parts(archive)
        order = 0
        for part in parts:
            part_assets, part_occurrences, part_diagnostics, order = _part_occurrences(
                archive, part, source_file_id, store, order, "body" if part == "word/document.xml" else Path(part).stem
            )
            assets.update({asset.asset_id: asset for asset in part_assets})
            occurrences.extend(part_occurrences)
            diagnostics.extend(part_diagnostics)
    return MediaExtraction(list(assets.values()), occurrences, diagnostics)
