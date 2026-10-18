"""Lossless shape adaptation at the model response boundary.

Models sometimes emit a single paragraph where the canonical contract expects
a paragraph list. Wrapping that value retains the complete text and formatting;
all semantic validation still belongs to the strict canonical schema. This is
deliberately path-specific, not a general coercion or a document repair pass.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any


def _wrap_paragraph_fields(value: dict[str, Any], fields: tuple[str, ...]) -> None:
    for name in fields:
        if isinstance(value.get(name), (str, dict)):
            value[name] = [value[name]]


def normalize_provider_exam(payload: Any) -> Any:
    """Return a detached payload with unambiguous singleton paragraphs wrapped.

    Existing lists, absent fields, nulls, invalid scalar types, unknown fields,
    and malformed document containers are untouched. In particular, options,
    answers, question lists, geometry, and rich-run contents are never guessed
    or rewritten. The caller must still use ``CanonicalExam.from_dict``.
    """
    normalized = deepcopy(payload)
    if not isinstance(normalized, dict):
        return normalized

    sections = normalized.get("sections")
    if isinstance(sections, list):
        for section in sections:
            if not isinstance(section, dict):
                continue
            _wrap_paragraph_fields(section, ("passage",))
            questions = section.get("questions")
            if isinstance(questions, list):
                for question in questions:
                    if isinstance(question, dict):
                        _wrap_paragraph_fields(question, ("instruction", "context", "flow_lines"))

    tasks = normalized.get("writing_tasks")
    if isinstance(tasks, list):
        for task in tasks:
            if isinstance(task, dict):
                _wrap_paragraph_fields(task, ("prompt",))
    return normalized
