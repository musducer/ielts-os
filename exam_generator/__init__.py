"""Server-side IELTS exam generation pipeline.

The public entry point is :mod:`exam_generator.__main__`.  The package keeps
generation, validation and DOCX rendering separate, while treating
``api.index.parse_docx_to_quiz`` as the only import-format authority.
"""

from .pipeline import ExamGenerationPipeline, PipelineConfig

__all__ = ["ExamGenerationPipeline", "PipelineConfig"]
