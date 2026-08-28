# Parser Conventions

For the complete authoring handbook used by AI DOCX formatters, see [DOCX_FORMATTER_PLAYBOOK.md](DOCX_FORMATTER_PLAYBOOK.md). `api/index.py` remains the source of truth.

## Listening map labelling

- Mark a map or plan labelling group as `MAP_LABELLING` when its instructions refer to labelling a map or plan.
- Put the map or plan image in `[CONTEXT]` before `[QUESTIONS]`.
- Put every answer field below the image as its own numbered `[BLANK]` question, in exact ascending question-number order.
- Do not put `[1]`, `[2]`, or other answer placeholders inside the image/context HTML. Inline placeholders are for summaries, notes, and flow charts; map labels must remain an ordered answer list below the map.
- Keep the displayed label text and its answer key on the same numbered question. Never sort labels alphabetically or by text length.
- Preserve the source numbering even when a map has non-consecutive visual labels.

## Diagram labelling

- Use a `[DIAGRAM_LABEL]` block when the diagram needs answer gaps embedded in label boxes around the image.
- The source image must be declared with `IMAGE:` and its real pixel ratio with `IMAGE_ASPECT_RATIO:` (for example `1186 / 400`). Never use a guessed canvas ratio.
- Use `IMAGE_MODE: TEXT_BOXES` for the current free-positioned label design.
- Each `[BOX id x=... y=... w=... h=...]` stores one complete visible label. Write its ordinary text and every gap inside the same box, for example `Network of [34] ______ helps to give a constant [35] ______ supply.`
- A box may contain more than one numbered gap. Coordinates and sizes are percentages of the full rendered image, with `x,y` at the box's top-left corner.
- Only add `targetX` and `targetY` when a connector line is required. Do not invent connector lines where the source image already contains them.
- Put all answer keys in `[ANSWERS]` as `34. *answer`. The parser creates one question for each `[number]` marker and keeps the shared text boxes intact in Builder, Exam, and Review.
