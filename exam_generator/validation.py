"""Deterministic and model-assisted quality gates for canonical exams."""

from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any, Dict, List

from .providers import ProviderError, TextProvider
from .schema import CanonicalExam, OPTION_BACKED_TYPES, option_answer_values, validate_canonical_exam


@dataclass
class ValidationIssue:
    severity: str
    code: str
    message: str
    question_number: int | None = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def deterministic_review(exam: CanonicalExam) -> List[ValidationIssue]:
    issues = [ValidationIssue("FAIL", "SCHEMA", message) for message in validate_canonical_exam(exam)]
    for section in exam.sections:
        for question in section.questions:
            answers = {answer.casefold() for answer in question.correct_answers}
            option_values = {option.content.text.casefold() for option in question.options}
            if len(option_values) != len(question.options):
                issues.append(ValidationIssue("FAIL", "DUPLICATE_OPTIONS", "Option bank has duplicate visible options.", question.question_number))
            if question.block_type in {"DRAG", "DRAG_DROP", "MAP_DRAG", "FLOW_DRAG", "MATCHING"}:
                unmatched = [answer for answer in answers if answer not in option_values and len(answer) != 1]
                if unmatched:
                    issues.append(ValidationIssue(
                        "FAIL", "ANSWER_NOT_IN_OPTIONS",
                        f"Question {question.question_number} answer is not present in its option bank.",
                        question.question_number,
                    ))
            if question.block_type == "CHOICE" and not (2 <= len(question.options) <= 6):
                issues.append(ValidationIssue("FAIL", "MCQ_OPTION_COUNT", "MCQ needs 2-6 distinct options.", question.question_number))
            instruction = " ".join(item.text for item in question.instruction).casefold()
            if "true/false/not given" in instruction:
                values = [option.content.text.casefold() for option in question.options]
                if values != ["true", "false", "not given"]:
                    issues.append(ValidationIssue("FAIL", "TFNG_OPTIONS", "TFNG must use TRUE, FALSE, NOT GIVEN in that order.", question.question_number))
            if "yes/no/not given" in instruction:
                values = [option.content.text.casefold() for option in question.options]
                if values != ["yes", "no", "not given"]:
                    issues.append(ValidationIssue("FAIL", "YNNG_OPTIONS", "YNNG must use YES, NO, NOT GIVEN in that order.", question.question_number))
            if question.block_type == "FLOW_DRAG" and not question.flow_lines:
                issues.append(ValidationIssue("FAIL", "FLOW_STRUCTURE", "Flow-chart question needs flow_lines.", question.question_number))
            if question.block_type == "MATCHING" and "heading" in instruction and not all(
                len(option.content.text.strip()) > 2 for option in question.options
            ):
                issues.append(ValidationIssue("FAIL", "HEADING_OPTIONS", "Matching Headings needs textual heading options.", question.question_number))
    return issues


CRITIC_SYSTEM = """You are a strict IELTS assessment QA critic. Return JSON only:
{"issues":[{"severity":"PASS|WARN|FAIL|MANUAL_REVIEW","code":"SHORT_CODE","message":"specific issue","question_number":1}]}
Check factual grounding against the supplied source, answer validity, IELTS task fit,
and whether the explanation/evidence supports the answer. Do not rewrite the exam."""


def critic_review(provider: TextProvider, exam: CanonicalExam, source_text: str, model: str) -> List[ValidationIssue]:
    try:
        payload = provider.complete_json(
            system=CRITIC_SYSTEM,
            user=f"SOURCE:\n{source_text}\n\nEXAM:\n{exam.to_dict()}",
            model=model,
            max_tokens=3000,
            json_mode=True,
            temperature=0.0,
            phase="critic",
        )
    except ProviderError as exc:
        return [ValidationIssue("WARN", "CRITIC_UNAVAILABLE", str(exc))]
    raw_issues = payload.get("issues", [])
    if not isinstance(raw_issues, list):
        return [ValidationIssue("WARN", "CRITIC_MALFORMED", "Critic did not return an issues list.")]
    issues: List[ValidationIssue] = []
    for raw in raw_issues:
        if not isinstance(raw, dict):
            continue
        severity = str(raw.get("severity") or "WARN").upper()
        if severity not in {"PASS", "WARN", "FAIL", "MANUAL_REVIEW"}:
            severity = "WARN"
        question_number = raw.get("question_number")
        try:
            question_number = int(question_number) if question_number is not None else None
        except (TypeError, ValueError):
            question_number = None
        issues.append(ValidationIssue(
            severity,
            str(raw.get("code") or "CRITIC").upper(),
            str(raw.get("message") or "Critic reported an issue."),
            question_number,
        ))
    return issues


def has_blocking_issue(issues: List[ValidationIssue]) -> bool:
    # Required validation layers fail closed: WARN/UNKNOWN are not publishable.
    return any(issue.severity in {"WARN", "FAIL", "MANUAL_REVIEW", "UNKNOWN"} for issue in issues)
