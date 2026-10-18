"""Shared public error taxonomy; retry decisions never depend on UI wording."""

TRANSIENT_PROVIDER_CODES = frozenset({
    "PROVIDER_TIMEOUT", "PROVIDER_RATE_LIMIT", "PROVIDER_UNAVAILABLE",
    "PROVIDER_EMPTY_RESPONSE", "PROVIDER_MALFORMED_JSON", "PROVIDER_TRUNCATED_OUTPUT",
})


def provider_error_code(message: str) -> str:
    text = str(message or "").upper()
    if "VISION_PROVIDER_UNAVAILABLE" in text:
        return "VISION_PROVIDER_UNAVAILABLE"
    for code in TRANSIENT_PROVIDER_CODES:
        if code in text:
            return code
    if "RATE_LIMIT" in text or "429" in text:
        return "PROVIDER_RATE_LIMIT"
    if "TIMED OUT" in text or "TIMEOUT" in text:
        return "PROVIDER_TIMEOUT"
    if "MALFORMED JSON" in text or "JSON OBJECT" in text:
        return "PROVIDER_MALFORMED_JSON"
    if "EMPTY" in text or "RỖNG" in text:
        return "PROVIDER_EMPTY_RESPONSE"
    if any(word in text for word in ("CIRCUIT BREAKER", "UNAVAILABLE", "CONNECTION", "503", "502", "504", "500")):
        return "PROVIDER_UNAVAILABLE"
    # Missing credentials, programmer errors and schema failures do not improve
    # by repeating an identical provider request.
    return "PROVIDER_CONFIGURATION"


def diagnostic(code, message, *, stage, question_number=None, block_id="", recovery_attempted=False):
    return {
        "severity": "FAIL", "code": code, "message": str(message), "stage": stage,
        "question_number": question_number, "block_id": block_id,
        "retryable": code in TRANSIENT_PROVIDER_CODES,
        "recovery_attempted": bool(recovery_attempted),
    }
