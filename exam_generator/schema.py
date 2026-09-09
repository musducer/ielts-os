"""Canonical, provider-neutral data model for generated IELTS exams.

This model deliberately stores answers as human-readable values.  The DOCX
renderer translates them to the parser grammar (for example MCQ letters) and
the round-trip gate translates the parser result back before comparing it.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional


SUPPORTED_BLOCK_TYPES = {
    "BLANK",
    "SHORT_ANSWER",
    "CHOICE",
    "CHOICE_MULTIPLE",
    "MATCHING",
    "DRAG",
    "DRAG_DROP",
    "MAP_DRAG",
    "FLOW_DRAG",
    "DIAGRAM_LABEL",
}
SUPPORTED_EXAM_TYPES = {"Reading", "Listening", "Writing", "Integrated"}


class CanonicalSchemaError(ValueError):
    """Raised before a provider response reaches DOCX rendering."""


def _reject_unknown(value: Dict[str, Any], allowed: set[str], scope: str) -> None:
    unknown = sorted(set(value) - allowed)
    if unknown:
        raise CanonicalSchemaError(f"{scope} contains unknown fields: {', '.join(unknown)}.")


@dataclass
class RichRun:
    text: str
    bold: bool = False
    italic: bool = False
    underline: bool = False

    @classmethod
    def from_dict(cls, value: Any) -> "RichRun":
        if isinstance(value, (str, int, float)):
            return cls(text=str(value))
        if not isinstance(value, dict):
            raise CanonicalSchemaError("A rich-text run must be text or an object.")
        _reject_unknown(value, {"text", "bold", "italic", "underline"}, "rich run")
        return cls(
            text=str(value.get("text") or ""),
            bold=bool(value.get("bold", False)),
            italic=bool(value.get("italic", False)),
            underline=bool(value.get("underline", False)),
        )


@dataclass
class RichParagraph:
    """Body paragraph preserving the exact formatting that index.py extracts."""
    runs: List[RichRun]
    alignment: str = "left"
    list_item: bool = False

    @property
    def text(self) -> str:
        return "".join(run.text for run in self.runs)

    @classmethod
    def from_value(cls, value: Any) -> "RichParagraph":
        if isinstance(value, cls):
            return value
        if isinstance(value, (str, int, float)):
            return cls(runs=[RichRun(text=str(value))])
        if not isinstance(value, dict):
            raise CanonicalSchemaError("A rich paragraph must be text or an object.")
        _reject_unknown(value, {"runs", "text", "bold", "italic", "underline", "alignment", "list_item"}, "rich paragraph")
        raw_runs = value.get("runs")
        if raw_runs is None:
            raw_runs = [{
                "text": value.get("text") or "",
                "bold": value.get("bold", False),
                "italic": value.get("italic", False),
                "underline": value.get("underline", False),
            }]
        if not isinstance(raw_runs, list):
            raise CanonicalSchemaError("paragraph.runs must be a list.")
        alignment = str(value.get("alignment") or "left").lower()
        if alignment not in {"left", "center", "right", "justify"}:
            raise CanonicalSchemaError("paragraph.alignment must be left, center, right, or justify.")
        return cls(
            runs=[RichRun.from_dict(run) for run in raw_runs],
            alignment=alignment,
            list_item=bool(value.get("list_item", False)),
        )


def _paragraph_list(value: Any, field_name: str) -> List[RichParagraph]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise CanonicalSchemaError(f"{field_name} must be a list of rich paragraphs.")
    items = [RichParagraph.from_value(item) for item in value]
    return [item for item in items if item.text.strip()]


def _string_list(value: Any, field_name: str) -> List[str]:
    if value is None:
        return []
    if not isinstance(value, list) or any(not isinstance(item, (str, int, float)) for item in value):
        raise CanonicalSchemaError(f"{field_name} must be a list of text values.")
    return [str(item).strip() for item in value if str(item).strip()]


@dataclass
class Evidence:
    quote: str = ""
    locator: str = ""
    source: str = ""
    source_id: str = ""
    start: int = -1
    end: int = -1
    source_hash: str = ""

    @classmethod
    def from_dict(cls, value: Any) -> "Evidence":
        if not isinstance(value, dict):
            raise CanonicalSchemaError("explanation.evidence must be an object.")
        _reject_unknown(value, {"quote", "locator", "source", "source_id", "start", "end", "source_hash"}, "explanation.evidence")
        try:
            start = int(value.get("start", -1))
            end = int(value.get("end", -1))
        except (TypeError, ValueError) as exc:
            raise CanonicalSchemaError("evidence start/end must be integers.") from exc
        return cls(
            quote=str(value.get("quote") or "").strip(),
            locator=str(value.get("locator") or "").strip(),
            source=str(value.get("source") or "").strip(),
            source_id=str(value.get("source_id") or "").strip(),
            start=start,
            end=end,
            source_hash=str(value.get("source_hash") or "").strip(),
        )


@dataclass
class Explanation:
    why: str = ""
    evidence: Evidence = field(default_factory=Evidence)
    paraphrase_mapping: str = ""
    correct_reason: str = ""
    distractor_reasons: Dict[str, str] = field(default_factory=dict)
    student_takeaway: str = ""

    @classmethod
    def from_dict(cls, value: Any) -> "Explanation":
        if not isinstance(value, dict):
            raise CanonicalSchemaError("question.explanation must be an object.")
        _reject_unknown(value, {"why", "evidence", "paraphrase_mapping", "correct_reason", "distractor_reasons", "student_takeaway"}, "question.explanation")
        distractor_reasons = value.get("distractor_reasons") or {}
        if not isinstance(distractor_reasons, dict) or any(not isinstance(key, str) or not isinstance(item, str) for key, item in distractor_reasons.items()):
            raise CanonicalSchemaError("explanation.distractor_reasons must be a string map.")
        return cls(
            why=str(value.get("why") or "").strip(),
            evidence=Evidence.from_dict(value.get("evidence") or {}),
            paraphrase_mapping=str(value.get("paraphrase_mapping") or "").strip(),
            correct_reason=str(value.get("correct_reason") or "").strip(),
            distractor_reasons={key: item.strip() for key, item in distractor_reasons.items() if item.strip()},
            student_takeaway=str(value.get("student_takeaway") or "").strip(),
        )


@dataclass
class Option:
    """ID is generated by backend code; model-provided ids are never trusted."""
    content: RichParagraph
    id: str = ""

    @classmethod
    def from_value(cls, value: Any) -> "Option":
        if isinstance(value, (str, int, float)):
            return cls(content=RichParagraph.from_value(value))
        if not isinstance(value, dict):
            raise CanonicalSchemaError("An option must be text or an object.")
        _reject_unknown(value, {"id", "content", "runs", "text", "bold", "italic", "underline", "alignment", "list_item"}, "option")
        content = value.get("content", value)
        return cls(content=RichParagraph.from_value(content), id=str(value.get("id") or "").strip())


def _option_list(value: Any, field_name: str) -> List[Option]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise CanonicalSchemaError(f"{field_name} must be a list of options.")
    options = [Option.from_value(item) for item in value]
    if any(not option.content.text.strip() for option in options):
        raise CanonicalSchemaError(f"{field_name} cannot contain an empty option.")
    return options


@dataclass
class Question:
    id: str
    question_number: int
    block_type: str
    text: RichParagraph = field(default_factory=lambda: RichParagraph([]))
    instruction: List[RichParagraph] = field(default_factory=list)
    context: List[RichParagraph] = field(default_factory=list)
    options: List[Option] = field(default_factory=list)
    correct_answers: List[str] = field(default_factory=list)
    correct_option_ids: List[str] = field(default_factory=list)
    group_id: str = ""
    left_title: str = ""
    right_title: str = ""
    media_url: str = ""
    media_asset_id: str = ""
    slots: Dict[str, Dict[str, float]] = field(default_factory=dict)
    flow_lines: List[RichParagraph] = field(default_factory=list)
    diagram: Dict[str, Any] = field(default_factory=dict)
    explanation: Optional[Explanation] = None

    @classmethod
    def from_dict(cls, value: Any) -> "Question":
        if not isinstance(value, dict):
            raise CanonicalSchemaError("Each question must be an object.")
        _reject_unknown(value, {
            "id", "question_number", "block_type", "text", "instruction", "context", "options",
            "correct_answers", "correct_option_ids", "group_id", "left_title", "right_title", "media_url",
            "media_asset_id", "slots", "flow_lines", "diagram", "explanation",
        }, "question")
        try:
            number = int(value.get("question_number"))
        except (TypeError, ValueError) as exc:
            raise CanonicalSchemaError("question_number must be a positive integer.") from exc
        block_type = str(value.get("block_type") or "").upper().strip()
        raw_slots = value.get("slots") or {}
        if not isinstance(raw_slots, dict):
            raise CanonicalSchemaError("question.slots must be an object.")
        diagram = value.get("diagram") or {}
        if not isinstance(diagram, dict):
            raise CanonicalSchemaError("question.diagram must be an object.")
        return cls(
            id=str(value.get("id") or "").strip(),
            question_number=number,
            block_type=block_type,
            text=RichParagraph.from_value(value.get("text") or ""),
            instruction=_paragraph_list(value.get("instruction"), "question.instruction"),
            context=_paragraph_list(value.get("context"), "question.context"),
            options=_option_list(value.get("options"), "question.options"),
            correct_answers=_string_list(value.get("correct_answers"), "question.correct_answers"),
            correct_option_ids=_string_list(value.get("correct_option_ids"), "question.correct_option_ids"),
            group_id=str(value.get("group_id") or "").strip(),
            left_title=str(value.get("left_title") or "").strip(),
            right_title=str(value.get("right_title") or "").strip(),
            media_url=str(value.get("media_url") or "").strip(),
            media_asset_id=str(value.get("media_asset_id") or "").strip(),
            slots=raw_slots,
            flow_lines=_paragraph_list(value.get("flow_lines"), "question.flow_lines"),
            diagram=diagram,
            explanation=Explanation.from_dict(value["explanation"]) if value.get("explanation") else None,
        )


@dataclass
class Section:
    passage: List[RichParagraph] = field(default_factory=list)
    questions: List[Question] = field(default_factory=list)
    label: str = ""

    @classmethod
    def from_dict(cls, value: Any) -> "Section":
        if not isinstance(value, dict):
            raise CanonicalSchemaError("Each section must be an object.")
        _reject_unknown(value, {"passage", "questions", "label"}, "section")
        questions = value.get("questions") or []
        if not isinstance(questions, list):
            raise CanonicalSchemaError("section.questions must be a list.")
        return cls(
            passage=_paragraph_list(value.get("passage"), "section.passage"),
            questions=[Question.from_dict(question) for question in questions],
            label=str(value.get("label") or "").strip(),
        )


@dataclass
class WritingTask:
    task_number: int
    prompt: List[RichParagraph]
    title: str = ""
    instructions: str = ""
    minimum_words: int = 0
    recommended_minutes: int = 0
    media_url: str = ""
    media_asset_id: str = ""

    @classmethod
    def from_dict(cls, value: Any) -> "WritingTask":
        if not isinstance(value, dict):
            raise CanonicalSchemaError("Each writing task must be an object.")
        _reject_unknown(value, {"task_number", "prompt", "title", "instructions", "minimum_words", "recommended_minutes", "media_url", "media_asset_id"}, "writing task")
        try:
            task_number = int(value.get("task_number"))
        except (TypeError, ValueError) as exc:
            raise CanonicalSchemaError("writing task_number must be 1 or 2.") from exc
        return cls(
            task_number=task_number,
            prompt=_paragraph_list(value.get("prompt"), "writing_task.prompt"),
            title=str(value.get("title") or "").strip(),
            instructions=str(value.get("instructions") or "").strip(),
            minimum_words=int(value.get("minimum_words") or 0),
            recommended_minutes=int(value.get("recommended_minutes") or 0),
            media_url=str(value.get("media_url") or "").strip(),
            media_asset_id=str(value.get("media_asset_id") or "").strip(),
        )


@dataclass
class CanonicalExam:
    title: str
    exam_type: str
    time_limit: int
    sections: List[Section] = field(default_factory=list)
    writing_tasks: List[WritingTask] = field(default_factory=list)
    audio_url: str = ""
    source_reference: str = ""
    schema_version: str = "2026-09-09"
    media_bindings: List[Dict[str, Any]] = field(default_factory=list)

    @classmethod
    def from_dict(cls, value: Any) -> "CanonicalExam":
        if not isinstance(value, dict):
            raise CanonicalSchemaError("The model response must be a JSON object.")
        _reject_unknown(value, {"title", "exam_type", "time_limit", "sections", "writing_tasks", "audio_url", "source_reference", "schema_version", "media_bindings"}, "exam")
        sections = value.get("sections") or []
        writing_tasks = value.get("writing_tasks") or []
        if not isinstance(sections, list) or not isinstance(writing_tasks, list):
            raise CanonicalSchemaError("sections and writing_tasks must be lists.")
        try:
            time_limit = int(value.get("time_limit") or 0)
        except (TypeError, ValueError) as exc:
            raise CanonicalSchemaError("time_limit must be a positive integer.") from exc
        media_bindings = value.get("media_bindings") or []
        if not isinstance(media_bindings, list) or any(not isinstance(item, dict) for item in media_bindings):
            raise CanonicalSchemaError("media_bindings must be a list of objects.")
        for binding in media_bindings:
            _reject_unknown(binding, {"occurrence_id", "asset_id", "association", "required_for_solving"}, "media binding")
            if not all(str(binding.get(key) or "").strip() for key in ("occurrence_id", "asset_id", "association")):
                raise CanonicalSchemaError("Each media binding needs occurrence_id, asset_id, and association.")
        return cls(
            title=str(value.get("title") or "").strip(),
            exam_type=str(value.get("exam_type") or "").strip().title(),
            time_limit=time_limit,
            sections=[Section.from_dict(section) for section in sections],
            writing_tasks=[WritingTask.from_dict(task) for task in writing_tasks],
            audio_url=str(value.get("audio_url") or "").strip(),
            source_reference=str(value.get("source_reference") or "").strip(),
            schema_version=str(value.get("schema_version") or "2026-09-09"),
            media_bindings=media_bindings,
        )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def validate_canonical_exam(exam: CanonicalExam) -> List[str]:
    """Deterministic validation before any LLM critic or DOCX rendering."""
    issues: List[str] = []
    if not exam.title:
        issues.append("title is required")
    if exam.exam_type not in SUPPORTED_EXAM_TYPES:
        issues.append("exam_type must be Reading, Listening, Writing, or Integrated")
    if exam.time_limit < 1:
        issues.append("time_limit must be positive")
    if exam.exam_type == "Writing":
        numbers = [task.task_number for task in exam.writing_tasks]
        if numbers != [1, 2]:
            issues.append("Writing requires exactly task_number 1 then 2")
        for task in exam.writing_tasks:
            if not task.prompt:
                issues.append(f"Writing task {task.task_number} requires a prompt")
            if task.media_url and not task.media_url.startswith("https://"):
                issues.append(f"Writing task {task.task_number} media_url must be HTTPS")
        if exam.sections:
            issues.append("Writing must not contain generic sections")
        return issues

    if not exam.sections:
        issues.append("Reading, Listening, and Integrated require at least one section")
    seen_numbers = set()
    for section_index, section in enumerate(exam.sections, start=1):
        if not section.questions:
            issues.append(f"section {section_index} has no questions")
        for question in section.questions:
            if question.question_number < 1:
                issues.append("question_number must be positive")
            if question.question_number in seen_numbers:
                issues.append(f"duplicate question_number {question.question_number}")
            seen_numbers.add(question.question_number)
            if question.block_type not in SUPPORTED_BLOCK_TYPES:
                issues.append(f"question {question.question_number} uses unsupported block_type {question.block_type}")
            if not question.correct_answers:
                issues.append(f"question {question.question_number} has no correct answer")
            option_backed = {"CHOICE", "CHOICE_MULTIPLE", "MATCHING", "DRAG", "DRAG_DROP", "MAP_DRAG", "FLOW_DRAG"}
            if question.block_type in option_backed and not question.options:
                issues.append(f"question {question.question_number} requires options")
            if question.block_type in option_backed and not question.correct_option_ids:
                issues.append(f"question {question.question_number} has no resolved stable option ID answer")
            if question.block_type == "CHOICE" and len(question.correct_answers) != 1:
                issues.append(f"question {question.question_number} CHOICE requires one answer")
            if question.block_type == "CHOICE_MULTIPLE" and len(question.correct_answers) < 2:
                issues.append(f"question {question.question_number} CHOICE_MULTIPLE requires at least two answers")
            if question.block_type == "MAP_DRAG":
                if not question.media_url.startswith("https://"):
                    issues.append(f"question {question.question_number} MAP_DRAG requires HTTPS media_url")
                if str(question.question_number) not in question.slots:
                    issues.append(f"question {question.question_number} MAP_DRAG requires its slot coordinates")
            if question.block_type == "DIAGRAM_LABEL":
                if not question.media_url.startswith("https://"):
                    issues.append(f"question {question.question_number} DIAGRAM_LABEL requires HTTPS media_url")
                if not question.diagram.get("boxes"):
                    issues.append(f"question {question.question_number} DIAGRAM_LABEL requires diagram.boxes")
            if not question.explanation or not question.explanation.why:
                issues.append(f"question {question.question_number} requires explanation.why")
            elif not question.explanation.evidence.quote:
                issues.append(f"question {question.question_number} requires explanation.evidence.quote")
    return issues


OPTION_BACKED_TYPES = {"CHOICE", "CHOICE_MULTIPLE", "MATCHING", "DRAG", "DRAG_DROP", "MAP_DRAG", "FLOW_DRAG"}


def option_answer_values(question: Question) -> List[str]:
    """Resolve persisted stable IDs to visible values only at render/compare time."""
    by_id = {option.id: option.content.text for option in question.options}
    if question.correct_option_ids:
        return [by_id[option_id] for option_id in question.correct_option_ids if option_id in by_id]
    return list(question.correct_answers)


def assign_stable_identifiers(exam: CanonicalExam, source_hash: str) -> List[str]:
    """Backend-owned deterministic IDs and answer-reference resolution.

    The model may return answer text/letters, but it never owns an ID.  After
    this function succeeds, option-backed answers reference only stable IDs.
    """
    issues: List[str] = []
    for section_index, section in enumerate(exam.sections):
        for question_index, question in enumerate(section.questions):
            question.id = f"q_{source_hash[:12]}_{section_index + 1}_{question_index + 1}_{question.question_number}"
            for option_index, option in enumerate(question.options):
                digest = __import__("hashlib").sha256(
                    f"{source_hash}|{question.id}|{option_index}|{option.content.text}".encode("utf-8")
                ).hexdigest()[:12]
                option.id = f"opt_{question.question_number}_{option_index + 1}_{digest}"
            if question.explanation and question.explanation.distractor_reasons:
                submitted_reasons = dict(question.explanation.distractor_reasons)
                question.explanation.distractor_reasons = {
                    option.id: submitted_reasons.get(option.id, submitted_reasons.get(option.content.text, ""))
                    for option in question.options
                    if submitted_reasons.get(option.id, submitted_reasons.get(option.content.text, ""))
                }
            if question.block_type not in OPTION_BACKED_TYPES:
                continue
            resolved: List[str] = []
            for answer in question.correct_answers:
                clean = answer.strip()
                candidates: List[Option] = []
                if len(clean) == 1 and clean.isalpha():
                    index = ord(clean.upper()) - 65
                    if 0 <= index < len(question.options):
                        candidates = [question.options[index]]
                else:
                    candidates = [
                        option for option in question.options
                        if option.content.text.casefold() == clean.casefold()
                    ]
                if len(candidates) != 1:
                    issues.append(
                        f"question {question.question_number} answer {clean!r} resolves to {len(candidates)} options"
                    )
                    continue
                if candidates[0].id not in resolved:
                    resolved.append(candidates[0].id)
            question.correct_option_ids = resolved
    return issues
