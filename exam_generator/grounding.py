"""Source-evidence grounding and explanation-quality gates.

Model output is untrusted until every quote maps to one unique, normalized
range in the immutable source snapshot for the job.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from typing import Any, Dict, List

from .schema import CanonicalExam, OPTION_BACKED_TYPES, option_answer_values
from .validation import ValidationIssue


def normalize_source(value: str) -> str:
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", value or "")).strip()


def source_hash(value: str) -> str:
    return hashlib.sha256(normalize_source(value).encode("utf-8")).hexdigest()


def _occurrences(haystack: str, needle: str) -> List[int]:
    positions: List[int] = []
    start = 0
    while True:
        position = haystack.find(needle, start)
        if position < 0:
            return positions
        positions.append(position)
        start = position + max(1, len(needle))


def _visual_sources(exam: CanonicalExam, media_extraction: Any) -> tuple[Dict[int, set[str]], Dict[str, Any]]:
    """Map exact question ownership to extracted immutable visual occurrences."""
    by_question: Dict[int, set[str]] = {}
    assets: Dict[str, Any] = {}
    if media_extraction is None:
        return by_question, assets
    occurrences = {item.occurrence_id: item for item in getattr(media_extraction, "occurrences", [])}
    assets = {item.asset_id: item for item in getattr(media_extraction, "assets", [])}
    question_types = {
        question.question_number: question.block_type
        for section in exam.sections for question in section.questions
    }
    for binding in exam.media_bindings:
        association = str(binding.get("association") or "").lower()
        match = re.match(r"^question:(\d+)(?::|$)", association)
        occurrence_id = str(binding.get("occurrence_id") or "")
        if not match or occurrence_id not in occurrences:
            continue
        number = int(match.group(1))
        if binding.get("required_for_solving") is True or question_types.get(number) in {"MAP_DRAG", "DIAGRAM_LABEL"}:
            by_question.setdefault(number, set()).add(occurrence_id)
    return by_question, assets


def ground_exam(exam: CanonicalExam, raw_source: str, media_extraction: Any = None) -> List[ValidationIssue]:
    normalized_source = normalize_source(raw_source)
    digest = source_hash(raw_source)
    issues: List[ValidationIssue] = []
    visual_by_question, visual_assets = _visual_sources(exam, media_extraction)
    visual_occurrences = {
        item.occurrence_id: item for item in getattr(media_extraction, "occurrences", [])
    } if media_extraction is not None else {}
    if not normalized_source:
        return [ValidationIssue("FAIL", "EMPTY_SOURCE", "Cannot ground an exam against an empty source.")]
    for section in exam.sections:
        for question in section.questions:
            explanation = question.explanation
            if not explanation:
                issues.append(ValidationIssue("FAIL", "MISSING_EVIDENCE", "Question has no explanation/evidence.", question.question_number))
                continue
            evidence = explanation.evidence
            quote = normalize_source(evidence.quote)
            if not quote:
                issues.append(ValidationIssue("FAIL", "MISSING_EVIDENCE", "Evidence quote is required.", question.question_number))
                continue
            required_visuals = visual_by_question.get(question.question_number, set())
            if required_visuals:
                if evidence.source.casefold() != "image":
                    issues.append(ValidationIssue(
                        "FAIL", "INVALID_VISUAL_EVIDENCE",
                        "This answer requires a visual, so its evidence must identify that exact image occurrence.",
                        question.question_number,
                    ))
                    continue
                occurrence_id = evidence.source_id.removeprefix("image:")
                if occurrence_id not in required_visuals:
                    issues.append(ValidationIssue(
                        "FAIL", "INVALID_VISUAL_EVIDENCE",
                        "Visual evidence does not reference an image bound to this question.",
                        question.question_number,
                    ))
                    continue
                occurrence = visual_occurrences.get(occurrence_id)
                asset = visual_assets.get(getattr(occurrence, "asset_id", ""))
                if occurrence is None or asset is None:
                    issues.append(ValidationIssue(
                        "FAIL", "VISUAL_EVIDENCE_UNAVAILABLE",
                        "The cited visual occurrence or immutable asset is unavailable.",
                        question.question_number,
                    ))
                    continue
                if not normalize_source(evidence.locator):
                    issues.append(ValidationIssue(
                        "FAIL", "MISSING_VISUAL_LOCATOR",
                        "Visual evidence needs a precise chart/map/diagram location.",
                        question.question_number,
                    ))
                    continue
                evidence.source = "image"
                evidence.source_id = occurrence_id
                evidence.source_hash = str(getattr(asset, "sha256", ""))
                evidence.start = -1
                evidence.end = -1
                continue
            matches = _occurrences(normalized_source.casefold(), quote.casefold())
            if len(matches) != 1:
                issues.append(ValidationIssue(
                    "FAIL", "AMBIGUOUS_EVIDENCE" if matches else "UNGROUNDED_EVIDENCE",
                    f"Evidence quote resolves to {len(matches)} source ranges; exactly one is required.",
                    question.question_number,
                ))
                continue
            start = matches[0]
            end = start + len(quote)
            if evidence.start >= 0 and (evidence.start != start or evidence.end != end):
                issues.append(ValidationIssue(
                    "FAIL", "EVIDENCE_RANGE_MISMATCH", "Model-supplied evidence range differs from the source snapshot.", question.question_number
                ))
                continue
            evidence.source_id = f"source:{digest[:16]}"
            evidence.start = start
            evidence.end = end
            evidence.source_hash = digest
            if evidence.source not in {"passage", "audio", "source"}:
                issues.append(ValidationIssue("FAIL", "INVALID_EVIDENCE_SOURCE", "Evidence source must be passage, audio, or source.", question.question_number))
    return issues


def explanation_quality_review(exam: CanonicalExam) -> List[ValidationIssue]:
    issues: List[ValidationIssue] = []
    for section in exam.sections:
        for question in section.questions:
            explanation = question.explanation
            if not explanation:
                continue
            if len(normalize_source(explanation.why)) < 32:
                issues.append(ValidationIssue("FAIL", "SHALLOW_EXPLANATION", "Explanation.why is too short.", question.question_number))
            if len(normalize_source(explanation.paraphrase_mapping)) < 12:
                issues.append(ValidationIssue("FAIL", "MISSING_PARAPHRASE_MAPPING", "Explanation needs a paraphrase mapping.", question.question_number))
            if len(normalize_source(explanation.correct_reason)) < 12:
                issues.append(ValidationIssue("FAIL", "MISSING_CORRECT_REASON", "Explanation needs a complete correct-answer reason.", question.question_number))
            if len(normalize_source(explanation.student_takeaway)) < 12:
                issues.append(ValidationIssue("FAIL", "MISSING_TAKEAWAY", "Explanation needs a reusable student takeaway.", question.question_number))
            if question.block_type in OPTION_BACKED_TYPES:
                correct = {value.casefold() for value in option_answer_values(question)}
                distractors = [option for option in question.options if option.content.text.casefold() not in correct]
                missing = [option for option in distractors if not normalize_source(explanation.distractor_reasons.get(option.id, ""))]
                if missing:
                    issues.append(ValidationIssue(
                        "FAIL", "MISSING_DISTRACTOR_REASON",
                        "Explanation must state why every relevant distractor is wrong.", question.question_number,
                    ))
    return issues
