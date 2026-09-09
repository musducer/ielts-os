"""Backend-enforced job state machine and optimistic revision guard."""

from __future__ import annotations

from typing import Any, Dict, Set


class JobTransitionError(ValueError):
    pass


LEGAL_TRANSITIONS: Dict[str, Set[str]] = {
    "QUEUED": {"GENERATING", "FAILED", "CANCELLED"},
    "GENERATING": {"VALIDATING", "MANUAL_REVIEW", "FAILED"},
    "VALIDATING": {"REPAIRING", "READY_FOR_REVIEW", "MANUAL_REVIEW", "FAILED"},
    "REPAIRING": {"VALIDATING", "MANUAL_REVIEW", "FAILED"},
    "READY_FOR_REVIEW": {"APPROVED", "MANUAL_REVIEW", "CANCELLED"},
    "APPROVED": {"PUBLISHED", "MANUAL_REVIEW"},
    "PUBLISHED": set(),
    "MANUAL_REVIEW": {"REPAIRING", "CANCELLED"},
    "FAILED": set(),
    "CANCELLED": set(),
}


def assert_transition(current: str, target: str) -> None:
    if current == target:
        return
    if target not in LEGAL_TRANSITIONS.get(current, set()):
        raise JobTransitionError(f"Illegal job transition: {current} -> {target}.")


def transition_record(record: Dict[str, Any], target: str, expected_revision: int | None = None) -> Dict[str, Any]:
    current = str(record.get("status") or "QUEUED")
    revision = int(record.get("revision") or 0)
    if expected_revision is not None and revision != expected_revision:
        raise JobTransitionError("Job revision changed; reload before applying this action.")
    assert_transition(current, target)
    updated = dict(record)
    updated["status"] = target
    updated["revision"] = revision + 1
    return updated
