// ==========================================
// UNIFIED IELTS / INTEGRATED QUESTION TAXONOMY
// Pure, non-destructive classifier: NEVER mutates q.type / q.subType.
// Rendering & scoring keep reading type/subType; analytics, filters and
// badges read inferQuestionCategory(). Mirror IDs in api/index.py.
// ==========================================
import { isWritingQuiz, normalizeWritingTasks } from "./publicRelease";

export type TaxonomySkill = "Listening" | "Reading" | "Writing" | "Integrated";
export interface TaxonomyCategory { id: string; label: string; skill: TaxonomySkill; group?: "Task 1" | "Task 2"; }
export interface InferredCategory { id: string; label: string; }
export interface QuizCategoryBreakdownItem { categoryId: string; label: string; partLabels: string[]; questionCount: number; }

const cat = (skill: TaxonomySkill, id: string, label: string, group?: "Task 1" | "Task 2"): TaxonomyCategory => ({ id, label, skill, group });

export const CANONICAL_TAXONOMY: Record<TaxonomySkill, TaxonomyCategory[]> = {
  Listening: [
    cat("Listening", "L_FORM_NOTE", "Form / Note Completion"),
    cat("Listening", "L_TABLE", "Table Completion"),
    cat("Listening", "L_SENTENCE_SUMMARY", "Sentence / Summary Completion"),
    cat("Listening", "L_FLOWCHART", "Flow-chart Completion"),
    cat("Listening", "L_SHORT_ANSWER", "Short-answer Questions"),
    cat("Listening", "L_MAP_PLAN", "Map / Plan Labelling"),
    cat("Listening", "L_DIAGRAM", "Diagram Labelling"),
    cat("Listening", "L_MCQ_SINGLE", "Multiple Choice (1 Answer)"),
    cat("Listening", "L_MCQ_MULTI", "Multiple Choice (Multiple Answers)"),
    cat("Listening", "L_MATCHING", "Matching (Classification / Features)"),
  ],
  Reading: [
    cat("Reading", "R_TFNG", "True / False / Not Given"),
    cat("Reading", "R_YNNG", "Yes / No / Not Given"),
    cat("Reading", "R_MATCHING_HEADINGS", "Matching Headings"),
    cat("Reading", "R_MATCHING_INFO", "Matching Information (Paragraph A–G)"),
    cat("Reading", "R_MATCHING_FEATURES", "Matching Features"),
    cat("Reading", "R_SENTENCE_ENDINGS", "Matching Sentence Endings"),
    cat("Reading", "R_SUMMARY_BOX", "Summary Completion (Word Bank)"),
    cat("Reading", "R_NOTE_TABLE_SUMMARY", "Note / Table / Summary / Sentence Completion"),
    cat("Reading", "R_DIAGRAM_FLOWCHART", "Diagram / Flow-chart Completion"),
    cat("Reading", "R_SHORT_ANSWER", "Short-answer Questions"),
    cat("Reading", "R_MCQ_SINGLE", "Multiple Choice (1 Answer)"),
    cat("Reading", "R_MCQ_MULTI", "Multiple Choice (Multiple Answers)"),
  ],
  Writing: [
    cat("Writing", "W_T1_LINE", "Task 1: Line Graph", "Task 1"),
    cat("Writing", "W_T1_BAR", "Task 1: Bar Chart", "Task 1"),
    cat("Writing", "W_T1_PIE", "Task 1: Pie Chart", "Task 1"),
    cat("Writing", "W_T1_TABLE", "Task 1: Table", "Task 1"),
    cat("Writing", "W_T1_MIXED", "Task 1: Mixed Charts", "Task 1"),
    cat("Writing", "W_T1_MAP", "Task 1: Map Comparison", "Task 1"),
    cat("Writing", "W_T1_PROCESS", "Task 1: Process / Diagram", "Task 1"),
    cat("Writing", "W_T2_OPINION", "Task 2: Opinion (Agree / Disagree)", "Task 2"),
    cat("Writing", "W_T2_DISCUSSION", "Task 2: Discussion + Opinion", "Task 2"),
    cat("Writing", "W_T2_ADV_DISADV", "Task 2: Advantages & Disadvantages", "Task 2"),
    cat("Writing", "W_T2_PROBLEM_SOLUTION", "Task 2: Cause / Problem & Solution", "Task 2"),
    cat("Writing", "W_T2_TWO_PART", "Task 2: Two-part Question", "Task 2"),
  ],
  Integrated: [
    cat("Integrated", "I_LISTENING", "Listening Comprehension"),
    cat("Integrated", "I_CLOZE_GRAMMAR", "Cloze / Grammar & Lexical Gap-fill"),
    cat("Integrated", "I_ARRANGEMENT", "Dialogue / Paragraph Arrangement"),
    cat("Integrated", "I_READING_COMP", "Reading Comprehension"),
    cat("Integrated", "I_SENTENCE_TRANSFORM", "Sentence Combination / Transformation"),
  ],
};

export const TAXONOMY_BY_ID: Record<string, TaxonomyCategory> = Object.values(CANONICAL_TAXONOMY)
  .flat()
  .reduce((acc, item) => { acc[item.id] = item; return acc; }, {} as Record<string, TaxonomyCategory>);

const pick = (id: string): InferredCategory => ({ id, label: TAXONOMY_BY_ID[id]?.label || id });

export const quizTaxonomySkill = (quiz: any): TaxonomySkill => {
  if (isWritingQuiz(quiz)) return "Writing";
  const t = String(quiz?.type || "").toLowerCase();
  if (t.includes("integrat")) return "Integrated";
  if (t.includes("listen")) return "Listening";
  return "Reading";
};

const stripHtml = (value: unknown) => String(value ?? "")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/\s+/g, " ")
  .trim();

const plainOption = (opt: unknown) => stripHtml(opt).replace(/^\s*[A-Za-z][.)]\s+/, "").trim().toUpperCase();

/** Section (Part/Passage) index of a question; never throws, falls back to 0. */
export const resolveQuestionSectionIndex = (q: any, quiz?: any, hint?: number): number => {
  const sections: any[] = Array.isArray(quiz?.sections) ? quiz.sections : [];
  if (typeof q?.passageIndex === "number" && q.passageIndex >= 0 && (!sections.length || q.passageIndex < sections.length)) return q.passageIndex;
  if (sections.length && q) {
    const found = sections.findIndex(sec => Array.isArray(sec?.questions) && sec.questions.some((item: any) => item && String(item.id) === String(q.id)));
    if (found >= 0) return found;
  }
  if (typeof hint === "number" && hint >= 0) return hint;
  return typeof q?.passageIndex === "number" && q.passageIndex >= 0 ? q.passageIndex : 0;
};

export const sectionLabelFor = (skill: TaxonomySkill, index: number) =>
  skill === "Reading" ? `Passage ${index + 1}` : skill === "Writing" ? `Task ${index + 1}` : `Part ${index + 1}`;

// ---------- Writing ----------
const inferWritingCategory = (q: any): InferredCategory => {
  const raw = stripHtml(`${q?.title || ""} ${q?.instructions || q?.instruction || ""} ${q?.prompt || q?.text || ""}`).toLowerCase();
  const subType = String(q?.subType || "").toUpperCase();
  const taskNumber = Number(q?.taskNumber) || (subType === "WRITING_TASK_1" ? 1 : subType === "WRITING_TASK_2" ? 2 : 0)
    || (/task\s*1\b/i.test(raw) ? 1 : /task\s*2\b/i.test(raw) ? 2 : 0)
    || Number(q?.questionNumber) || 2;
  if (taskNumber === 1) {
    if (/\bmaps?\b|\b(floor|site|town|campus|building|proposed|ground) plans?\b|\bplans? (below|shows?|of the)\b/.test(raw)) return pick("W_T1_MAP");
    if (/\bprocess\b|\bdiagrams?\b|how [\w\s,'-]{1,60}(is|are) (made|produced|manufactured|generated|recycled)|\bstages?\b|life ?cycle/.test(raw)) return pick("W_T1_PROCESS");
    const kinds = [
      /\bline (graph|chart)s?\b/.test(raw) ? "line" : "",
      /\bbar (chart|graph)s?\b/.test(raw) ? "bar" : "",
      /\bpie charts?\b/.test(raw) ? "pie" : "",
      /\btables?\b/.test(raw) ? "table" : "",
    ].filter(Boolean);
    if (kinds.length >= 2) return pick("W_T1_MIXED");
    if (kinds[0] === "line" || /\bline\b/.test(raw)) return pick("W_T1_LINE");
    if (kinds[0] === "pie" || /\bpie\b/.test(raw)) return pick("W_T1_PIE");
    if (kinds[0] === "table") return pick("W_T1_TABLE");
    return pick("W_T1_BAR");
  }
  // Drop IELTS boilerplate ("Give reasons for your answer...") so it cannot fake a cause/effect prompt.
  const t2 = raw.replace(/give reasons for your answer[^.]*\.?/g, " ").replace(/include any relevant examples[^.]*\.?/g, " ");
  if (/discuss both/.test(t2)) return pick("W_T2_DISCUSSION");
  if ((/advantages?/.test(t2) && /disadvantages?/.test(t2)) || /outweigh/.test(t2)) return pick("W_T2_ADV_DISADV");
  if (/\b(causes?|problems?|reasons?)\b/.test(t2) && /\b(solutions?|measures?|effects?|solve|tackle)\b/.test(t2)) return pick("W_T2_PROBLEM_SOLUTION");
  if (/agree or disagree|to what extent|positive or (a )?negative development/.test(t2)) return pick("W_T2_OPINION");
  return pick("W_T2_TWO_PART");
};

// ---------- Integrated (THPT) ----------
const ARRANGEMENT_OPTION_RE = /^\s*(?:[a-e]\s*[-–—,]\s*){2,}[a-e]\s*$/i;
const inferIntegratedCategory = (q: any, quiz: any, sectionIdx: number): InferredCategory => {
  if (sectionIdx === 0) return pick("I_LISTENING");
  const instruction = stripHtml(`${q?.instruction || ""} ${q?.subType || ""}`).toLowerCase();
  const text = stripHtml(q?.text).toLowerCase();
  const options: string[] = Array.isArray(q?.options) ? q.options.map((o: any) => stripHtml(o).replace(/^\s*[A-D][.)]\s+/, "")) : [];
  if (/\blisten/.test(instruction)) return pick("I_LISTENING");
  if (/arrange|re-?order|correct order|sequence|sắp xếp/.test(instruction) || (options.length >= 2 && options.filter(o => ARRANGEMENT_OPTION_RE.test(o)).length >= Math.ceil(options.length / 2))) return pick("I_ARRANGEMENT");
  if (/sentences?[^.]{0,60}(closest|nearest) in meaning|best combines|combines? each pair|rewrit|transform|câu gần nghĩa|kết hợp/.test(`${instruction} ${text}`)) return pick("I_SENTENCE_TRANSFORM");
  if (/fill in|numbered blanks?|each of the (numbered )?blanks|gap|best fits|complete the (passage|text)|điền/.test(instruction)) return pick("I_CLOZE_GRAMMAR");
  const passage = stripHtml(quiz?.sections?.[sectionIdx]?.passage || "");
  const comprehension = /according to (the )?(passage|paragraph|text)|refers? to|main idea|best title|which of the following is (not )?(true|mentioned)|inferred|implied|paragraph \d|the author|closest in meaning|opposite in meaning/.test(`${instruction} ${text}`);
  if (comprehension || (passage.length > 1200 && text.length > 25 && !/_{3,}|\(\s*\d+\s*\)|\[\s*\d+\s*\]/.test(text))) return pick("I_READING_COMP");
  return pick("I_CLOZE_GRAMMAR");
};

// ---------- Listening ----------
const inferListeningCategory = (q: any): InferredCategory => {
  const type = String(q?.type || "").toUpperCase();
  const subType = String(q?.subType || "").toUpperCase();
  const instructionRaw = String(q?.instruction || "");
  const groupRaw = String(q?.groupContext || "");
  const keywordHay = stripHtml(`${q?.subType || ""} ${instructionRaw} ${groupRaw.slice(0, 600)}`).toLowerCase();
  if (type === "MAP_DRAG" || subType === "MAP_LABELLING" || subType === "MAP_DRAG") return pick("L_MAP_PLAN");
  if (type === "DIAGRAM_LABEL") return pick("L_DIAGRAM");
  if ((type === "MATCHING" || type === "BLANK") && (/\b(maps?|plans?)\b/.test(keywordHay) || /<img\b/i.test(`${instructionRaw} ${groupRaw}`))) return pick("L_MAP_PLAN");
  if (/\bdiagram\b/.test(keywordHay)) return pick("L_DIAGRAM");
  if (subType === "FLOWCHART" || subType === "FLOWCHART_DRAG" || /flow-?\s?chart/.test(keywordHay)) return pick("L_FLOWCHART");
  if (type === "CHOICE_MULTIPLE") return pick("L_MCQ_MULTI");
  if (type === "CHOICE") return pick("L_MCQ_SINGLE");
  if (type === "MATCHING" || type === "DRAG_DROP_HEADING" || (type === "DRAG_DROP" && (subType === "COLUMN_DRAG" || subType === "SENTENCE_ENDING_DRAG"))) return pick("L_MATCHING");
  if (type === "SHORT_ANSWER" || /short-?answer|answer the questions? below/i.test(instructionRaw)) return pick("L_SHORT_ANSWER");
  if (subType === "TABLE" || /<table\b/i.test(groupRaw) || /\btable\b/i.test(stripHtml(instructionRaw))) return pick("L_TABLE");
  if (subType === "NOTES" || subType === "FORM" || /\b(form|note|notes|record card|booking)\b/i.test(stripHtml(instructionRaw)) || /[•●▪]/.test(groupRaw)) return pick("L_FORM_NOTE");
  return pick("L_SENTENCE_SUMMARY");
};

// ---------- Reading ----------
const inferReadingCategory = (q: any): InferredCategory => {
  const type = String(q?.type || "").toUpperCase();
  const subType = String(q?.subType || "").toUpperCase();
  const instruction = stripHtml(q?.instruction || "");
  const keywordHay = `${subType} ${instruction}`.toLowerCase();
  const fullHay = `${keywordHay} ${stripHtml(q?.text).toLowerCase()}`;
  const opts = new Set((Array.isArray(q?.options) ? q.options : []).map(plainOption));
  const hasNotGiven = opts.has("NOT GIVEN");
  if (hasNotGiven && opts.has("YES") && opts.has("NO")) return pick("R_YNNG");
  if (hasNotGiven && opts.has("TRUE") && opts.has("FALSE")) return pick("R_TFNG");
  if (subType === "YES/NO/NOT GIVEN" || /yes\s*\/\s*no/.test(fullHay) || /\byes\b[\s\S]*\bno\b[\s\S]*\bnot\s+given\b/i.test(instruction)) return pick("R_YNNG");
  if (subType === "TRUE/FALSE/NOT GIVEN" || /true\s*\/\s*false/.test(fullHay) || /\btrue\b[\s\S]*\bfalse\b[\s\S]*\bnot\s+given\b/i.test(instruction)) return pick("R_TFNG");
  if (type === "DRAG_DROP_HEADING" || /heading/.test(subType.toLowerCase()) || ((type === "MATCHING") && /list of headings/.test(keywordHay))) return pick("R_MATCHING_HEADINGS");
  if (subType === "SENTENCE_ENDING_DRAG" || (/sentence/.test(keywordHay) && /ending/.test(keywordHay))) return pick("R_SENTENCE_ENDINGS");
  if (type === "DIAGRAM_LABEL" || type === "MAP_DRAG" || subType === "FLOWCHART" || subType === "FLOWCHART_DRAG" || /\b(diagram|flow-?\s?chart)\b/.test(keywordHay)) return pick("R_DIAGRAM_FLOWCHART");
  if (type === "DRAG_DROP" && subType === "SUMMARY_DRAG") return pick("R_SUMMARY_BOX");
  if ((type === "MATCHING" || type === "DRAG_DROP") && /summary/.test(keywordHay) && /(list of (words|phrases)|from the box|box below|[a-z]\s*[–-]\s*[a-z]\b)/i.test(instruction)) return pick("R_SUMMARY_BOX");
  if (type === "CHOICE_MULTIPLE") return pick("R_MCQ_MULTI");
  if (type === "CHOICE") return pick("R_MCQ_SINGLE");
  if (type === "MATCHING" || (type === "DRAG_DROP" && subType === "COLUMN_DRAG")) {
    const optionList = Array.isArray(q?.options) ? q.options.map((o: any) => stripHtml(o)) : [];
    const letterOnly = optionList.length > 0 && optionList.every((o: string) => /^(paragraph|section)?\s*[A-I]$/i.test(o));
    if (/which paragraph|which section|information/i.test(instruction) || letterOnly) return pick("R_MATCHING_INFO");
    return pick("R_MATCHING_FEATURES");
  }
  if (type === "SHORT_ANSWER" || /answer the questions? below/i.test(instruction)) return pick("R_SHORT_ANSWER");
  return pick("R_NOTE_TABLE_SUMMARY");
};

/**
 * Canonical category of a question / Writing task.
 * Priority: valid teacher override (q.categoryId of the same skill) -> runtime inference.
 */
export const inferQuestionCategory = (q: any, quiz?: any, sectionIdx?: number): InferredCategory => {
  const skill: TaxonomySkill = quiz ? quizTaxonomySkill(quiz) : (String(q?.type || "").toUpperCase() === "WRITING" || q?.taskNumber ? "Writing" : "Reading");
  const override = q?.categoryId ? TAXONOMY_BY_ID[String(q.categoryId)] : undefined;
  if (override && (!quiz || override.skill === skill)) return { id: override.id, label: override.label };
  try {
    if (skill === "Writing") return inferWritingCategory(q);
    if (skill === "Integrated") return inferIntegratedCategory(q, quiz, resolveQuestionSectionIndex(q, quiz, sectionIdx));
    if (skill === "Listening") return inferListeningCategory(q);
    return inferReadingCategory(q);
  } catch {
    const fallback = CANONICAL_TAXONOMY[skill][0];
    return { id: fallback.id, label: fallback.label };
  }
};

const breakdownCache = new WeakMap<object, QuizCategoryBreakdownItem[]>();

/** Per-quiz category list with Part/Passage/Task locations, in taxonomy order. Memoised per quiz object. */
export const getQuizCategoryBreakdown = (quiz: any): QuizCategoryBreakdownItem[] => {
  if (!quiz || typeof quiz !== "object") return [];
  const cached = breakdownCache.get(quiz);
  if (cached) return cached;
  const skill = quizTaxonomySkill(quiz);
  const map = new Map<string, { label: string; parts: Map<number, string>; count: number }>();
  const add = (id: string, label: string, idx: number) => {
    if (!map.has(id)) map.set(id, { label, parts: new Map(), count: 0 });
    const entry = map.get(id)!;
    entry.count += 1;
    entry.parts.set(idx, sectionLabelFor(skill, idx));
  };
  if (skill === "Writing") {
    normalizeWritingTasks(quiz).forEach(task => {
      if (!String(task.prompt || "").trim() && !task.categoryId) return;
      const c = inferQuestionCategory(task, quiz);
      add(c.id, c.label, task.taskNumber - 1);
    });
  } else {
    const questions: any[] = Array.isArray(quiz.questions) && quiz.questions.length
      ? quiz.questions
      : (Array.isArray(quiz.sections) ? quiz.sections.flatMap((s: any) => s?.questions || []) : []);
    questions.forEach(q => {
      if (!q || String(q.type || "").toUpperCase() === "WRITING") return;
      const idx = resolveQuestionSectionIndex(q, quiz);
      const c = inferQuestionCategory(q, quiz, idx);
      add(c.id, c.label, idx);
    });
  }
  const order = CANONICAL_TAXONOMY[skill].map(c => c.id);
  const result = Array.from(map.entries())
    .map(([categoryId, v]) => ({
      categoryId,
      label: v.label,
      questionCount: v.count,
      partLabels: Array.from(v.parts.entries()).sort((a, b) => a[0] - b[0]).map(([, label]) => label),
    }))
    .sort((a, b) => order.indexOf(a.categoryId) - order.indexOf(b.categoryId));
  breakdownCache.set(quiz, result);
  return result;
};

/** Coarse Error DNA bucket (8 legacy keys) derived from the canonical id. */
export const toErrorDnaBucket = (categoryId: string): string => {
  if (/_MCQ_/.test(categoryId)) return "multiple_choice";
  if (categoryId === "R_TFNG" || categoryId === "R_YNNG") return "tfng_ynng";
  if (categoryId === "R_MATCHING_HEADINGS") return "matching_headings";
  if (["R_MATCHING_INFO", "R_MATCHING_FEATURES", "R_SENTENCE_ENDINGS", "L_MATCHING"].includes(categoryId)) return "matching_info_features";
  if (["L_FORM_NOTE", "L_TABLE", "L_SENTENCE_SUMMARY", "R_SUMMARY_BOX", "R_NOTE_TABLE_SUMMARY", "I_CLOZE_GRAMMAR"].includes(categoryId)) return "completion_notes_summary";
  if (["L_FLOWCHART", "L_MAP_PLAN", "L_DIAGRAM", "R_DIAGRAM_FLOWCHART"].includes(categoryId)) return "diagram_flowchart_map";
  if (categoryId === "L_SHORT_ANSWER" || categoryId === "R_SHORT_ANSWER") return "short_answer";
  return "other";
};
