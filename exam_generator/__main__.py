"""CLI: ``python -m exam_generator generate --source source.docx``."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .pipeline import ExamGenerationPipeline, PipelineConfig


def _requirements(value: str) -> dict:
    if not value:
        return {}
    path = Path(value)
    raw = path.read_text(encoding="utf-8") if path.exists() else value
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise argparse.ArgumentTypeError("requirements must be a JSON object or a JSON file.")
    return parsed


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate parser-verified IELTS DOCX exams.")
    parser.add_argument("command", choices=["generate", "batch"])
    parser.add_argument("--source", action="append", required=True, help="Source text or .txt/.docx path. Repeat for batch.")
    parser.add_argument("--requirements", default="", help="JSON object or path to JSON file.")
    parser.add_argument("--state-dir", default="", help="Job/cache directory (defaults to EXAM_GENERATION_STATE_DIR).")
    parser.add_argument("--no-cache", action="store_true")
    args = parser.parse_args()
    try:
        requirements = _requirements(args.requirements)
    except (OSError, json.JSONDecodeError, argparse.ArgumentTypeError) as exc:
        parser.error(str(exc))
    config = PipelineConfig(state_dir=Path(args.state_dir) if args.state_dir else PipelineConfig().state_dir)
    pipeline = ExamGenerationPipeline(config=config)
    if args.command == "generate" and len(args.source) != 1:
        parser.error("generate accepts exactly one --source; use batch for several sources.")
    results = (
        [pipeline.generate(args.source[0], requirements, use_cache=not args.no_cache)]
        if args.command == "generate"
        else pipeline.generate_batch(args.source, requirements)
    )
    print(json.dumps([result.to_dict() for result in results], ensure_ascii=False, indent=2))
    return 0 if all(result.status == "READY_FOR_REVIEW" for result in results) else 2


if __name__ == "__main__":
    raise SystemExit(main())
