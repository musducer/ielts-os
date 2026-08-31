# IELTS OS: DOCX Formatter Playbook

**Purpose:** Operating manual for an AI that converts a raw IELTS Reading, Listening, or Integrated test DOCX into the parser-ready DOCX accepted by api/index.py.

**Authority:** api/index.py is the source of truth. This handbook was verified against it on 2026-08-31 by the commit that updates this changelog.

**Success condition:** The formatted DOCX parses into the intended sections, question types, visual layout, option bank, and answer keys without manual repair in Exam Builder.

**Maintenance rule:** Any change to the backend API, DOCX parser, parser tags, extraction rules, or DOCX preparation workflow must update this playbook in the same change. Frontend-only features and deployment infrastructure belong in `README.md` and `SESSION_HANDOFF.md`, respectively.

---

## 1. Non-Negotiable Rules

1. Never invent, rewrite, merge, split, simplify, or "correct" test content or answer keys. Preserve supplied material unless the teacher explicitly provides a correction.
2. Select a parser block from the actual student interaction, not merely a heading such as "Questions 27-30".
3. Use ordinary DOCX body paragraphs. The parser reads body paragraphs and body tables only. It does not read headers, footers, Word text boxes, shapes, comments, or text embedded in an image.
4. Put every parser control tag in its own plain paragraph. Do not bold, hyperlink, or put a tag inside a table cell.
5. Use exact ASCII parser syntax: square brackets, English block names, colon where shown, and a leading asterisk for normal answer-key lines.
6. Do not add generic closing tags such as [/BLANK], [/CHOICE], [/MATCHING], or [/DRAG]. Generic blocks end when the next recognised block, [PASSAGE], or [QUESTIONS] begins.
7. Inner structures may use only their documented closers: [/CONTEXT], [/FLOW], [/SLOTS], [/BOX], [/ANSWERS], and [/DIAGRAM_LABEL].
8. Each numbered question needs one answer key. A multiple-selection task needs one starred line for each correct option.
9. Preserve original question numbering and source order.
10. Put teacher explanations in [EXPLANATION] lines only. Never mix them into answer-key paragraphs.
11. Parse the final DOCX locally before upload. Compare extracted types, numbers, options, answers, explanations, evidence quotes, and timestamps against the source test.

---

## 2. Document Skeleton

Place metadata at the beginning:

~~~text
[TITLE] VOL 9 TEST 4 ACADEMIC READING
[TIME] 60
[TYPE] Reading
~~~

Listening adds a public audio URL:

~~~text
[TITLE] VOL 8 TEST 7 LISTENING
[TIME] 30
[TYPE] Listening
[AUDIO] https://example.com/audio.mp3
~~~

Rules:

- [TIME] is parsed as an integer after stripping non-digits.
- Use Reading, Listening, or Integrated for [TYPE].
- The [AUDIO] paragraph must contain a URL only.

Use one [PASSAGE] and one [QUESTIONS] for each Reading passage or Listening part:

~~~text
[PASSAGE]
Passage title
Passage/transcript content...

[QUESTIONS]
[BLANK]
...
~~~

A later [PASSAGE] closes the previous section and starts the next one. Omitting [QUESTIONS] leaves the parser with no question block.

### Preserved Word formatting

The parser preserves body-paragraph formatting:

- bold -> strong HTML
- italic -> emphasis HTML
- underline -> underline HTML
- alignment -> matching HTML alignment
- Word bullet/list paragraph -> visible bullet
- Word table -> HTML table

Keep original title, italic lead-in, genuine bullet lists, labels, and bold emphasis. Remove page headers/footers, answer-sheet boilerplate, teacher notes, and duplicated decorative text.

---

## 3. Universal Generic Question Grammar

Generic block types are [BLANK], [SHORT_ANSWER], [CHOICE], [CHOICE_MULTIPLE], [MATCHING], [DRAG], and [DRAG_DROP].

~~~text
[BLOCK_TYPE]
Visible instructions before the first question.
Optional option bank before the first question.

1. Question text
*correct answer
2. Next question text
*correct answer
~~~

Safe question start form:

~~~text
1. Question text
~~~

The parser also accepts 1), 1:, Question 1:, and Câu 1:, but do not mix styles.

### Answer grammar

Normal answer:

~~~text
12. The answer is ______.
*example answer
~~~

Multiple selection:

~~~text
12. Which TWO statements are correct?
*A
*C
~~~

Never write *A and C, *A,C, or *A/C.

### Teacher explanations: [EXPLANATION]

Manual teacher explanations are optional review-only data. They are stripped from the live exam and appear only in Review through Why, Locate Evidence, and Listening timestamp buttons.

Use one explanation line per question:

~~~text
[EXPLANATION] 27: Because the text states "the number of visitors has increased by 20%" [01:24].
~~~

Rules:

- The question number after [EXPLANATION] is strongly recommended and safest.
- Quotes must use straight double quotes: "quoted evidence". The app extracts quoted text for Locate Evidence.
- Listening timestamps must use [mm:ss] or [mm:ss - mm:ss]. The app converts them to seconds for audio seek.
- Put [EXPLANATION] after that question's answer key, or place a numbered [EXPLANATION] line in the passage/question area.
- Do not put [EXPLANATION] in headers, footers, comments, Word text boxes, or tables.
- If several quotes exist, Review uses the most representative extracted quote for Locate Evidence. Put the best quote first.

Explanation-only supplement files are accepted by the backend import channel. They may omit [PASSAGE] and [QUESTIONS] when their only purpose is to patch explanations:

~~~text
[EXPLANATION] 26: The speaker says "processing data she had gathered" at [12:04 - 12:10].
[EXPLANATION] 27:
The teacher note can continue on the next normal paragraph.
It is attached to question 27 until the next [EXPLANATION] tag.
~~~

In Exam Builder, use Import explanations DOCX on the open test, then Save. Explanations are matched by visible question number.

### Supplement DOCX patching

Exam Builder can patch an existing test through the backend without rebuilding the whole exam:

- Open the existing quiz and select the Passage/Section tab to replace.
- Use Replace passage from DOCX.
- If the supplement DOCX contains one [PASSAGE]/[QUESTIONS] section, it replaces the current tab.
- If it contains two sections, it replaces the current tab and the next tab.
- Metadata such as title, audience, lock status, attempts, and scheduling stays from the existing quiz.
- Use Import explanations DOCX for [EXPLANATION]-only corrections; this does not replace questions or passages.

### Shared visual body: [CONTEXT]

Use [CONTEXT] and [/CONTEXT] for a shared notes, summary, sentence, table, or flow body:

~~~text
[CONTEXT]
The first line contains [1] ______.
The second line contains [2] ______.
[/CONTEXT]
1.
*first answer
2.
*second answer
~~~

Use normal paragraphs for intended line breaks. Never split a summary into one paragraph per word or one cell per word.

---

## 4. Task-Type Recipes

### 4.1 Completion: [BLANK]

Use for fill-in, sentence completion, summary completion, notes completion, table completion, and ordinary non-drag flow-chart completion.

~~~text
[BLANK]
Questions 1-5
Complete the notes below.
Write NO MORE THAN TWO WORDS AND/OR A NUMBER for each answer.
[CONTEXT]
BOOKING FORM
Surname: [1] ______
Number of travellers: [2] ______
[/CONTEXT]
1.
*Quigley
2.
*four
~~~

- Retain official words such as summary, notes, flow-chart, or table; the frontend uses this wording to select the appropriate layout.
- A real source table should remain a real Word table. Do not fake columns with spaces.
- A permitted answer alternative can be slash-separated, for example 18 July/July 18/18th July.

### 4.2 Short answer: [SHORT_ANSWER]

Use the same grammar as [BLANK]. The frontend converts this to inline completion.

~~~text
[SHORT_ANSWER]
Questions 1-3
Answer the questions below.
Write NO MORE THAN THREE WORDS from the passage for each answer.
[CONTEXT]
The first answer is [1] ______.
[/CONTEXT]
1.
*need
~~~

### 4.3 Single-choice MCQ, TFNG, and YNNG: [CHOICE]

~~~text
[CHOICE]
Questions 10-13
Choose the correct answer.
10. What is the main reason?
A. first option
B. second option
C. third option
D. fourth option
*C
~~~

- Put one option in each paragraph.
- The answer key can be the option letter or exact option text. Standard MCQ should use letters consistently.
- Keeping the official TRUE/FALSE/NOT GIVEN or YES/NO/NOT GIVEN instruction makes the parser generate those standard options automatically.
- Do not put all options in one prose paragraph.

### 4.4 Multiple selection: [CHOICE_MULTIPLE]

~~~text
[CHOICE_MULTIPLE]
Questions 14 and 15
Choose TWO letters, A-E.
14. Which TWO benefits are mentioned?
A. option one
B. option two
C. option three
D. option four
E. option five
*A
*D
~~~

The number of starred lines must match the number requested by the instruction.

### 4.5 Matching information, people, and features: [MATCHING]

~~~text
[MATCHING]
Questions 20-23
Match each statement with the correct researcher, A-C.
NB You may use any letter more than once.
[LEFT_TITLE]
[RIGHT_TITLE] List of Researchers
List of Researchers
A. Professor Alpha
B. Dr Beta
C. Mr Gamma
20. Important sounds must remain consistent.
*B
21. The tones used in crying help babies learn later.
*C
~~~

- Put the complete option bank before the first numbered question.
- Use one paragraph per option.
- Matching answer keys may be letters or exact option text, for example *B or *Dr Beta.
- The parser stores ordinary matching-with-text answers as clean option text. The exam UI shows an IELTS-style radio grid with A/B/C columns and a legend table underneath.
- Use [LEFT_TITLE] for the first table column when the source has a custom heading. Leave it blank if the source first column is blank.
- Use [RIGHT_TITLE] for the legend heading under the grid, for example List of Researchers, List of options, First invented or used by, etc. Do not hardcode a generic title when the source uses another one.
- If the source is matching information with letter-only columns and no legend, options may be plain A, B, C, etc.; then the answer remains the letter and no legend table is shown.
- Do not use this for card-drag tasks; use [DRAG] instead.

### 4.6 Matching headings: [MATCHING] plus [HEADING_SLOT]

Heading matching uses markers in the passage and questions in the question block:

~~~text
[PASSAGE]
Passage title
[HEADING_SLOT]
A. First passage paragraph...
[HEADING_SLOT]
B. Second passage paragraph...

[QUESTIONS]
[MATCHING]
Questions 27-32
Choose the correct heading for each paragraph from the list below.
List of Headings
i. First heading
ii. Second heading
iii. Third heading
27. Paragraph A
*Third heading
28. Paragraph B
*First heading
~~~

Rules:

- Put [HEADING_SLOT] immediately before every passage paragraph that needs a heading.
- Roman heading prefixes must be literal: i., ii., iii.
- New formatted DOCX should use the exact heading text as the answer key, not a Roman-only value. The parser still accepts Roman keys such as *iv and maps them to heading text for legacy files.
- In the live exam UI, heading slots show the question number when empty and the heading text when filled. Roman numerals are not shown inside the passage slot or heading cards.
- Keep the word heading in the visible instruction so the parser chooses the heading renderer.
- Do not convert headings into A/B/C options.

### 4.7 Two-column card drag: [DRAG]

Use when students drag full option cards to independent rows, such as Activities -> Benefits or Person -> Responsibility.

~~~text
[DRAG]
Questions 27-30
How will Kathy benefit from each activity?
Choose FOUR answers from the box and write the correct letter, A-F, next to questions 27-30.
[LEFT_TITLE] Activities
[RIGHT_TITLE] Benefits
[CONTEXT]
[27] going to Mechanical Engineers' Society meetings
[28] visiting different workplaces
[29] getting some work experience abroad
[30] attending an international conference
[/CONTEXT]
A. broadens practical experience of the field
B. chance to publicise own work
C. effective way of keeping up-to-date
D. looks good on a CV
E. provides useful access to resources
F. way to make useful contacts
27.
*way to make useful contacts
28.
*provides useful access to resources
29.
*broadens practical experience of the field
30.
*chance to publicise own work
~~~

Critical rules:

- Use [DRAG], not [MATCHING].
- Keep left-side rows inside [CONTEXT], each beginning with its literal marker [27].
- Use [LEFT_TITLE] and [RIGHT_TITLE] exactly; they remove ambiguity.
- Options are full-text cards. The answer key must be the full option text, never *A, *0, or *1.
- Retain any source instruction about answer reuse.

### 4.8 Summary drag and flow-chart drag

Summary drag uses [DRAG] with a continuous context:

~~~text
[DRAG]
Questions 27-28
Complete the summary using the list of words below.
[CONTEXT]
The committee receives [27] ______ from staff.
The [28] ______ of the programme include practical work.
[/CONTEXT]
A. management
B. outcomes
C. workshops
27.
*management
28.
*outcomes
~~~

Flow-chart drag uses [FLOW_DRAG]:

~~~text
[FLOW_DRAG]
Questions 31-32
Complete the flow-chart below. Choose the correct answer and move it into the gap.
[FLOW]
Raw material is collected [31] ______
The material is processed [32] ______
[/FLOW]
OPTIONS:
A. by hand
B. in a kiln
31.
*by hand
32.
*in a kiln
~~~

- One flow node per paragraph is safest.
- Put every option after OPTIONS: and before numbered answer keys.
- Flow-drag answer keys must be full card text, not letters.

### 4.9 Map/plan labelling with a radio grid: [MATCHING]

Use normal matching when the student chooses a letter in a grid/table beside a map. This is not a drag task.

~~~text
[MATCHING]
Questions 15-20
Label the map below. Write the correct letter, A-I, next to questions 15-20.
IMAGE: https://example.com/map.png
[LEFT_TITLE]
A
B
C
15. Staffroom
*A
16. Administration
*B
~~~

Rules:

- This is the same IELTS-style radio grid as matching information/features.
- Use plain letter options (A, B, C...) when the map/plan itself already contains the letter labels and there is no legend table.
- Do not add a [RIGHT_TITLE] or option-description legend unless the source paper has one.
- Do not convert this to [MAP_DRAG] unless the student really drags cards onto image slots.

### 4.10 Map/plan cards dropped onto image slots: [MAP_DRAG]

~~~text
[MAP_DRAG]
Questions 16-20
Label the map. Choose the correct answer and move it into the gap.
IMAGE: https://example.com/map.png
[SLOTS]
16: x=45.4, y=41.8, w=13.0, h=6.0
17: x=12.0, y=57.0, w=13.0, h=6.0
18: x=28.0, y=7.0, w=13.0, h=6.0
19: x=68.0, y=12.0, w=13.0, h=6.0
20: x=70.0, y=57.0, w=13.0, h=6.0
[/SLOTS]
OPTIONS:
A. Cookery room
B. Games room
C. Kitchen
D. Pottery room
E. Sports complex
F. Staff accommodation
16.
*Kitchen
17.
*Sports complex
18.
*Cookery room
19.
*Pottery room
20.
*Staff accommodation
~~~

- IMAGE:, [SLOTS], [/SLOTS], and OPTIONS: are required.
- Coordinates are percentages of the original image. x,y are slot-centre coordinates; w,h are optional.
- Measure against the source image, not a resized screenshot.
- Map-drag answer keys are full card text, never option letters or indices.

### 4.11 Diagram labelling with free text boxes: [DIAGRAM_LABEL]

Use for diagrams where a visible box contains normal explanatory text and one or more answer gaps.

~~~text
[DIAGRAM_LABEL]
Questions 34-37
Label the diagram below.
Choose ONE WORD ONLY from the passage for each answer.
IMAGE: https://example.com/diagram.png
IMAGE_MAX_WIDTH: 860
IMAGE_MODE: TEXT_BOXES
IMAGE_ASPECT_RATIO: 1186 / 400

[BOX mound-top x=8.5 y=1.5 w=27.8 h=23.3]
top of the mound
permits [37] ______
[/BOX]

[BOX network x=68.3 y=1.3 w=31.0 h=51.8]
Network of [34] ______
helps to give the termites
a constant [35] ______
supply and to maintain a
limited temperature range
[/BOX]

[BOX cellar x=1.2 y=73.3 w=33.0 h=23.8]
Cellar to aid control of
[36] ______ levels in mound
[/BOX]

[ANSWERS]
34. *tunnels
35. *air
36. *moisture
37. *evaporation
[/ANSWERS]
[/DIAGRAM_LABEL]
~~~

Critical rules:

- One [BOX] is one complete visual label box. It must contain ordinary label text and every intended [number] ______ gap.
- A box may contain multiple gaps. The network box above emits questions 34 and 35 but remains one visual box.
- Use descriptive box ids such as network, mound-top, or cellar.
- x,y,w,h are percentages of the full image, measured from its top-left corner.
- IMAGE_ASPECT_RATIO must equal the real source pixel ratio. Never estimate it from a Word screenshot.
- IMAGE_MAX_WIDTH is optional and controls exam display size without changing coordinates. Use it when a diagram is visually too large; 860 is the default, allowed practical range is about 520-1180.
- IMAGE_MODE: TEXT_BOXES is mandatory for new free-box diagrams.
- Use separate paragraphs inside a box for required visual line breaks; the parser preserves them.
- Add targetX and targetY only when an extra connector line is needed. Omit them when the original image already contains its own connector.
- A literal marker [34] creates the question. 34 ______ does not.
- Do not use legacy OVERLAY for new text-box diagram work.

---

## 5. Parser Hazards

1. Do not rely on OCR. Text inside images is never parsed.
2. Keep option-bank entries one per paragraph. A prose paragraph that begins with A. may be misread as an option.
3. Preserve visible words summary, note, flow-chart, flowchart, map, plan, label, and heading; the parser uses them as layout hints.
4. A map/diagram with no accessible IMAGE: URL produces no corresponding questions.
5. A map drag task with no valid slots produces no map questions.
6. A diagram with no valid boxes produces no diagram questions.
7. Generic answer keys require a leading asterisk. Do not put explanations after it.
8. For matching headings, retain both passage [HEADING_SLOT] markers and Roman option prefixes, but use heading text as the new answer key.
9. For every drag task, full option text is safer and required for [DRAG], [FLOW_DRAG], and [MAP_DRAG].

---

## 6. Mandatory Preflight

### Content checklist

- [ ] [TITLE], [TIME], and [TYPE] present.
- [ ] Every part has [PASSAGE] then [QUESTIONS].
- [ ] Every source question appears once, in original order.
- [ ] Every question has an answer key.
- [ ] Multiple selection has one starred line per correct option.
- [ ] Option banks are complete and in original order.
- [ ] Matching grid has correct [LEFT_TITLE]/[RIGHT_TITLE] when the source table/legend has headings.
- [ ] Matching features parse to clean option text; letter-only matching information may remain A/B/C.
- [ ] Drag answer keys use full card text.
- [ ] Optional [EXPLANATION] lines use straight quotes and valid [mm:ss] timestamps.
- [ ] Heading tasks use [HEADING_SLOT], Roman-prefixed option bank, and heading-text answer keys.
- [ ] Map/diagram URL is publicly reachable via HTTPS.
- [ ] Map/diagram coordinates use the original image ratio.
- [ ] Diagram boxes include visible text beside every gap.

### Local parser check

Run from repository root:

~~~powershell
@'
import sys
sys.path.insert(0, 'api')
from docx import Document
from index import parse_docx_to_quiz

quiz = parse_docx_to_quiz(Document(r'C:\path\to\formatted.docx'))
for q in quiz['questions']:
    manual = q.get('manualExplanation') or {}
    print(q['passageIndex'], q['type'], q.get('subType'), q['text'], '=>', q['correctAnswer'], manual.get('parsedQuotes'), manual.get('parsedTimestamps'))
'@ | .\.venv\Scripts\python.exe -
~~~

Verify manually:

- section count and question count;
- each emitted type/subtype;
- option order;
- all answer values;
- heading-text answers for matching headings;
- ordinary matching answer text;
- full-text drag answers;
- optional manualExplanation raw text, parsed quotes, and parsed timestamps;
- diagram TEXT_BOXES, real aspect ratio, shared box count, and one question per marker.

---

## 7. Update Contract

This file is part of the parser contract.

Whenever api/index.py changes a DOCX grammar, supported block type, answer mapping, formatting-preservation rule, map/diagram field, or parser heuristic:

1. Update this handbook in the same commit.
2. Update the verification commit/date at the top.
3. Add a changelog entry.
4. Explicitly tell the teacher in the completion message which handbook rule changed.

Do not silently change parser behaviour while leaving this handbook stale.

## 8. AI Provider Key Pool

Backend AI routes distribute requests across configured keys and fail over when one provider/key is rate-limited:

- Groq text and Whisper: `GROQ_API_KEY`, `GROQ_API_KEY_2`, etc., or comma-separated `GROQ_API_KEYS`.
- Gemini text/audio fallback: `GEMINI_API_KEY`, `GEMINI_API_KEY_2`, etc., `GOOGLE_API_KEY`, or comma-separated `GEMINI_API_KEYS`.
- Affected routes include transcript generation, AI feedback, AI vocabulary, and AI Why/explanation.
- Groq Whisper remains first for audio transcription because it returns machine timestamps; Gemini is fallback transcript-only.

## Changelog

- **2026-08-31**: Updated matching-grid contract: optional [LEFT_TITLE]/[RIGHT_TITLE], feature legends under the radio grid, letter-only info grids without legends, heading-text answer keys for Matching Headings, and optional IMAGE_MAX_WIDTH for diagram display sizing.
- **2026-08-30**: Added optional [EXPLANATION] grammar for teacher review explanations, parsed quoted evidence, and Listening timestamps.
- **2026-08-30**: Added backend supplement DOCX import for replacing passages/sections and explanation-only files; ordinary [MATCHING] now stores clean option text, with Matching Headings retaining Roman compatibility for legacy files.
- **2026-08-28 / c93eee0**: Initial complete handbook. Covers metadata, passages, generic blocks, completions, MCQ, multi-selection, matching headings, two-column drag, flow drag, map drag, and free-box diagram labelling.
