"""Deterministic DOCX renderer for the grammar consumed by ``api/index.py``.

It intentionally emits only the documented control tags.  It never asks an
LLM to format Word content, so a parser-contract failure is reproducible.
"""

from __future__ import annotations

import re
from collections import OrderedDict
from pathlib import Path
from typing import Dict, Iterable, List, Sequence

import docx
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Inches

from .schema import CanonicalExam, Option, Question, RichParagraph, Section, WritingTask, option_answer_values


class DocxRenderError(ValueError):
    pass


def _plain(value: object) -> str:
    if isinstance(value, RichParagraph):
        value = value.text
    elif isinstance(value, Option):
        value = value.content.text
    elif isinstance(value, dict):
        value = RichParagraph.from_value(value).text
    text = re.sub(r"<[^>]+>", " ", str(value or ""))
    return re.sub(r"\s+", " ", text).strip()


def _safe_url(value: str, field_name: str) -> str:
    value = str(value or "").strip()
    if value and not value.startswith("https://"):
        raise DocxRenderError(f"{field_name} must be a public HTTPS URL.")
    return value


def _add_paragraph(document: docx.Document, value: object, prefix: str = "") -> None:
    paragraph = RichParagraph.from_value(value)
    style = "List Bullet" if paragraph.list_item else None
    target = document.add_paragraph(style=style)
    target.alignment = {
        "left": WD_ALIGN_PARAGRAPH.LEFT,
        "center": WD_ALIGN_PARAGRAPH.CENTER,
        "right": WD_ALIGN_PARAGRAPH.RIGHT,
        "justify": WD_ALIGN_PARAGRAPH.JUSTIFY,
    }[paragraph.alignment]
    if prefix:
        target.add_run(prefix)
    for source_run in paragraph.runs:
        run = target.add_run(source_run.text)
        run.bold = source_run.bold
        run.italic = source_run.italic
        run.underline = source_run.underline


def _add_lines(document: docx.Document, lines: Iterable[object]) -> None:
    for line in lines:
        cleaned = _plain(line)
        if cleaned:
            _add_paragraph(document, line)


def _option_label(index: int) -> str:
    if index >= 26:
        raise DocxRenderError("The current parser grammar supports at most 26 labelled options per group.")
    return chr(65 + index)


def _answer_key(question: Question, answer: str) -> str:
    answer = _plain(answer)
    if question.block_type in {"CHOICE", "CHOICE_MULTIPLE"}:
        if re.fullmatch(r"[A-Za-z]", answer):
            return answer.upper()
        for index, option in enumerate(question.options):
            if _plain(option).casefold() == answer.casefold():
                return _option_label(index)
        raise DocxRenderError(
            f"Question {question.question_number}: choice answer {answer!r} is not in its options."
        )
    if question.block_type == "MATCHING":
        if re.fullmatch(r"[A-Za-z]", answer):
            return answer.upper()
        return answer
    return answer


def _write_explanation(document: docx.Document, question: Question) -> None:
    if not question.explanation:
        return
    chunks = [_plain(question.explanation.why)]
    evidence = question.explanation.evidence
    if evidence.quote:
        chunks.append(f'"{_plain(evidence.quote)}"')
    if evidence.locator:
        locator = _plain(evidence.locator)
        chunks.append(locator if locator.startswith("[") else f"[{locator}]")
    document.add_paragraph(f"[EXPLANATION] {question.question_number}: {' '.join(part for part in chunks if part)}")


def _embed_media(document: docx.Document, asset_id: str, media_asset_paths: Dict[str, str]) -> None:
    if not asset_id:
        return
    source = media_asset_paths.get(asset_id)
    if not source or not Path(source).is_file():
        raise DocxRenderError(f"Managed media asset {asset_id!r} is unavailable for deterministic DOCX embedding.")
    paragraph = document.add_paragraph()
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    paragraph.add_run().add_picture(source, width=Inches(6.1))


def _question_groups(section: Section) -> Iterable[List[Question]]:
    """Keep source order while allowing an explicit shared group_id."""
    current_key = None
    current: List[Question] = []
    for question in section.questions:
        key = (question.block_type, question.group_id or f"question-{question.question_number}")
        if current and key != current_key:
            yield current
            current = []
        current_key = key
        current.append(question)
    if current:
        yield current


def _write_option_bank(document: docx.Document, questions: Sequence[Question]) -> None:
    leader = questions[0]
    for index, option in enumerate(leader.options):
        _add_paragraph(document, option.content, prefix=f"{_option_label(index)}. ")


def _write_generic_group(document: docx.Document, questions: Sequence[Question]) -> None:
    leader = questions[0]
    document.add_paragraph(f"[{leader.block_type}]")
    _add_lines(document, leader.instruction)
    if leader.left_title:
        document.add_paragraph(f"[LEFT_TITLE] {_plain(leader.left_title)}")
    if leader.right_title:
        document.add_paragraph(f"[RIGHT_TITLE] {_plain(leader.right_title)}")
    if leader.context:
        document.add_paragraph("[CONTEXT]")
        _add_lines(document, leader.context)
        document.add_paragraph("[/CONTEXT]")
    if leader.options:
        _write_option_bank(document, questions)
    for question in questions:
        _add_paragraph(document, question.text, prefix=f"{question.question_number}. ")
        for answer in option_answer_values(question):
            document.add_paragraph(f"*{_answer_key(question, answer)}")
        _write_explanation(document, question)


def _write_flow_group(document: docx.Document, questions: Sequence[Question]) -> None:
    leader = questions[0]
    document.add_paragraph("[FLOW_DRAG]")
    _add_lines(document, leader.instruction)
    document.add_paragraph("[FLOW]")
    flow_lines = leader.flow_lines or leader.context
    if not flow_lines:
        raise DocxRenderError(f"Question {leader.question_number}: FLOW_DRAG requires flow_lines.")
    _add_lines(document, flow_lines)
    document.add_paragraph("[/FLOW]")
    document.add_paragraph("OPTIONS:")
    _write_option_bank(document, questions)
    for question in questions:
        document.add_paragraph(f"{question.question_number}.")
        document.add_paragraph(f"*{_answer_key(question, option_answer_values(question)[0])}")
        _write_explanation(document, question)


def _write_map_group(document: docx.Document, questions: Sequence[Question], media_asset_paths: Dict[str, str]) -> None:
    leader = questions[0]
    media_url = _safe_url(leader.media_url, "MAP_DRAG media_url")
    document.add_paragraph("[MAP_DRAG]")
    _add_lines(document, leader.instruction)
    document.add_paragraph(f"IMAGE: {media_url}")
    _embed_media(document, leader.media_asset_id, media_asset_paths)
    document.add_paragraph("[SLOTS]")
    all_slots: Dict[str, Dict[str, float]] = {}
    for question in questions:
        all_slots.update(question.slots)
    for number in sorted(all_slots, key=lambda value: int(value)):
        slot = all_slots[number]
        try:
            x, y = float(slot["x"]), float(slot["y"])
        except (KeyError, TypeError, ValueError) as exc:
            raise DocxRenderError(f"MAP_DRAG slot {number} needs numeric x and y.") from exc
        width, height = float(slot.get("width", 18)), float(slot.get("height", 7))
        document.add_paragraph(f"{number}: x={x}, y={y}, w={width}, h={height}")
    document.add_paragraph("[/SLOTS]")
    document.add_paragraph("OPTIONS:")
    _write_option_bank(document, questions)
    for question in questions:
        document.add_paragraph(f"{question.question_number}.")
        document.add_paragraph(f"*{_answer_key(question, option_answer_values(question)[0])}")
        _write_explanation(document, question)


def _write_diagram_group(document: docx.Document, questions: Sequence[Question], media_asset_paths: Dict[str, str]) -> None:
    leader = questions[0]
    diagram = leader.diagram
    media_url = _safe_url(leader.media_url, "DIAGRAM_LABEL media_url")
    boxes = diagram.get("boxes") or []
    if not isinstance(boxes, list):
        raise DocxRenderError("DIAGRAM_LABEL diagram.boxes must be a list.")
    document.add_paragraph("[DIAGRAM_LABEL]")
    _add_lines(document, leader.instruction)
    document.add_paragraph(f"IMAGE: {media_url}")
    _embed_media(document, leader.media_asset_id, media_asset_paths)
    if diagram.get("image_max_width"):
        document.add_paragraph(f"IMAGE_MAX_WIDTH: {int(diagram['image_max_width'])}")
    document.add_paragraph(f"IMAGE_MODE: {_plain(diagram.get('image_mode') or 'TEXT_BOXES')}")
    if diagram.get("image_aspect_ratio"):
        document.add_paragraph(f"IMAGE_ASPECT_RATIO: {_plain(diagram['image_aspect_ratio'])}")
    for box in boxes:
        if not isinstance(box, dict):
            raise DocxRenderError("DIAGRAM_LABEL boxes must be objects.")
        try:
            name = re.sub(r"[^A-Za-z0-9_-]+", "-", str(box["id"]).strip())
            x, y, width, height = (float(box[key]) for key in ("x", "y", "w", "h"))
        except (KeyError, TypeError, ValueError) as exc:
            raise DocxRenderError("Each diagram box needs id, x, y, w, h.") from exc
        document.add_paragraph(f"[BOX {name} x={x} y={y} w={width} h={height}]")
        _add_lines(document, box.get("lines") or [])
        document.add_paragraph("[/BOX]")
    document.add_paragraph("[ANSWERS]")
    for question in questions:
        document.add_paragraph(f"{question.question_number}. *{_answer_key(question, option_answer_values(question)[0])}")
        _write_explanation(document, question)
    document.add_paragraph("[/ANSWERS]")
    document.add_paragraph("[/DIAGRAM_LABEL]")


def _render_standard_exam(document: docx.Document, exam: CanonicalExam, media_asset_paths: Dict[str, str]) -> None:
    document.add_paragraph(f"[TITLE] {_plain(exam.title)}")
    document.add_paragraph(f"[TIME] {exam.time_limit}")
    document.add_paragraph(f"[TYPE] {exam.exam_type}")
    if exam.exam_type == "Listening" and exam.audio_url:
        document.add_paragraph(f"[AUDIO] {_safe_url(exam.audio_url, 'audio_url')}")
    for section in exam.sections:
        document.add_paragraph("[PASSAGE]")
        _add_lines(document, section.passage)
        document.add_paragraph("[QUESTIONS]")
        for group in _question_groups(section):
            block_type = group[0].block_type
            if block_type == "FLOW_DRAG":
                _write_flow_group(document, group)
            elif block_type == "MAP_DRAG":
                _write_map_group(document, group, media_asset_paths)
            elif block_type == "DIAGRAM_LABEL":
                _write_diagram_group(document, group, media_asset_paths)
            else:
                _write_generic_group(document, group)


def _render_writing_exam(document: docx.Document, exam: CanonicalExam, media_asset_paths: Dict[str, str]) -> None:
    document.add_paragraph(f"[TITLE] {_plain(exam.title)}")
    document.add_paragraph(f"[TIME] {exam.time_limit}")
    document.add_paragraph("[TYPE] Writing")
    for task in sorted(exam.writing_tasks, key=lambda item: item.task_number):
        document.add_paragraph(f"[WRITING_TASK {task.task_number}]")
        if task.title:
            document.add_paragraph(f"[TASK_TITLE] {_plain(task.title)}")
        if task.instructions:
            document.add_paragraph(f"[INSTRUCTIONS] {_plain(task.instructions)}")
        if task.recommended_minutes:
            document.add_paragraph(f"[MINUTES] {task.recommended_minutes}")
        if task.minimum_words:
            document.add_paragraph(f"[MIN_WORDS] {task.minimum_words}")
        document.add_paragraph("[PROMPT]")
        _add_lines(document, task.prompt)
        if task.media_url:
            document.add_paragraph(f"[MEDIA] {_safe_url(task.media_url, 'writing task media_url')}")
        _embed_media(document, task.media_asset_id, media_asset_paths)


def render_docx(exam: CanonicalExam, output_path: str | Path, media_asset_paths: Dict[str, str] | None = None) -> Path:
    """Render an exam with only the current parser's documented grammar."""
    document = docx.Document()
    media_asset_paths = media_asset_paths or {}
    if exam.exam_type == "Writing":
        _render_writing_exam(document, exam, media_asset_paths)
    else:
        _render_standard_exam(document, exam, media_asset_paths)
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    document.save(output)
    return output
