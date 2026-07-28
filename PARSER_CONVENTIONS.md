# Parser Conventions

## Listening map labelling

- Mark a map or plan labelling group as `MAP_LABELLING` when its instructions refer to labelling a map or plan.
- Put the map or plan image in `[CONTEXT]` before `[QUESTIONS]`.
- Put every answer field below the image as its own numbered `[BLANK]` question, in exact ascending question-number order.
- Do not put `[1]`, `[2]`, or other answer placeholders inside the image/context HTML. Inline placeholders are for summaries, notes, and flow charts; map labels must remain an ordered answer list below the map.
- Keep the displayed label text and its answer key on the same numbered question. Never sort labels alphabetically or by text length.
- Preserve the source numbering even when a map has non-consecutive visual labels.
