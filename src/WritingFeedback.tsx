import React, { useState, useRef, useMemo, useLayoutEffect, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { normalizeWritingTasks, countWritingWords, type WritingTaskDefinition } from './publicRelease';

// ==========================================
// TYPES & INTERFACES (Backward-Compatible)
// ==========================================
export type CriterionKey = 'TA_TR' | 'CC' | 'LR' | 'GRA';
export type CommentCategory = 'error' | 'awkward' | 'upgrade' | 'praise';

export interface WritingComment {
  id: string;
  taskId: string;
  anchorQuote?: string;
  comment: string;
  createdAt: number;
  startOffset?: number;
  endOffset?: number;
  criterion?: CriterionKey;
  category?: CommentCategory;
  replacement?: string;
  highBandRewrite?: string;
  tags?: string[];
}

export type EssayComment = WritingComment; // Backward compatibility alias

export interface WritingCriterionScore {
  taskAchievement?: number;
  coherence?: number;
  lexical?: number;
  grammar?: number;
  overall?: number;
}

export interface WritingGrading {
  status: 'awaiting_grading' | 'draft' | 'published';
  taskScores: Record<string, WritingCriterionScore>;
  correctedAnswers: Record<string, string>;
  comments: WritingComment[];
  finalBand?: number;
  updatedAt?: number;
  publishedAt?: number;
  publishedBy?: string;
  sampleAnswers?: Record<string, string>;
  sampleEssay?: string;
  taskBottlenecks?: Record<string, string[]>;
  taskStrengths?: Record<string, string[]>;
  criteriaNotes?: Record<string, Record<string, string>>;
  generalFeedback?: string;
  task1Band?: number;
  task2Band?: number;
  overallBand?: number;
  bottlenecks?: string[];
  strengths?: string[];
}

export interface WritingFeedbackDeskProps {
  reviewQuiz?: { quiz: any; result: any };
  userRole?: string | null;
  currentUser?: any;
  setReviewQuiz?: (quiz: any) => void;
  quizResults?: any[];
  setQuizResults?: (results: any[]) => void;
  syncData?: (patch: any) => Promise<boolean>;
  findMe?: () => any;
  saveMyVocabNotebook?: (notebook: any[], tombstones?: string[]) => Promise<boolean>;
  globalStyles?: any;
  // Legacy fallback props
  text?: string;
  taskId?: string;
  comments?: WritingComment[];
  editable?: boolean;
  onChange?: (comments: WritingComment[]) => void;
}

// ==========================================
// COLOR PALETTE & DESIGN SYSTEM (Manuscript)
// ==========================================
const C = {
  bg: '#FAF8F5',
  card: '#FFFFFF',
  wash: '#F5F2EB',
  border: '#E7E2D9',
  borderLight: '#F0ECE4',
  text: '#1A1726',
  sub: '#6C6777',
  subLight: '#9590A0',
  accent: '#5B3DF5',
  accentWash: 'rgba(91, 61, 245, 0.08)',
  accentLine: 'rgba(91, 61, 245, 0.25)',
  succ: '#15803D',
  succWash: 'rgba(21, 128, 61, 0.08)',
  succLine: 'rgba(21, 128, 61, 0.3)',
  warn: '#D97706',
  warnWash: 'rgba(217, 119, 6, 0.08)',
  warnLine: 'rgba(217, 119, 6, 0.3)',
  err: '#D9383A',
  errWash: 'rgba(217, 56, 58, 0.08)',
  errLine: 'rgba(217, 56, 58, 0.3)',
};

const CATEGORY_META: Record<CommentCategory, { label: string; enLabel: string; color: string; bg: string; border: string }> = {
  error: { label: 'Lỗi sai khách quan', enLabel: 'Objective Error', color: '#D9383A', bg: '#FEF2F2', border: '#FCA5A5' },
  awkward: { label: 'Chưa tự nhiên', enLabel: 'Less Natural', color: '#D97706', bg: '#FFFBEB', border: '#FCD34D' },
  upgrade: { label: 'Gợi ý nâng Band', enLabel: 'Band 7.5–8.5 Upgrade', color: '#5B3DF5', bg: '#EEF2FF', border: '#C7D2FE' },
  praise: { label: 'Điểm sáng', enLabel: 'Strength / Praise', color: '#15803D', bg: '#F0FDF4', border: '#86EFAC' },
};

const CRITERION_LABELS: Record<CriterionKey, { key: CriterionKey; scoreKey: keyof WritingCriterionScore; short: string; t1Name: string; t2Name: string }> = {
  TA_TR: { key: 'TA_TR', scoreKey: 'taskAchievement', short: 'TA / TR', t1Name: 'Task Achievement (TA)', t2Name: 'Task Response (TR)' },
  CC: { key: 'CC', scoreKey: 'coherence', short: 'CC', t1Name: 'Coherence & Cohesion (CC)', t2Name: 'Coherence & Cohesion (CC)' },
  LR: { key: 'LR', scoreKey: 'lexical', short: 'LR', t1Name: 'Lexical Resource (LR)', t2Name: 'Lexical Resource (LR)' },
  GRA: { key: 'GRA', scoreKey: 'grammar', short: 'GRA', t1Name: 'Grammar Range & Accuracy (GRA)', t2Name: 'Grammar Range & Accuracy (GRA)' },
};

const QUICK_TAGS: Record<CriterionKey, string[]> = {
  GRA: ['Sai S-V', 'Sai mạo từ', 'Sai giới từ', 'Sai thì động từ', 'Câu cụt / Run-on', 'Thiếu mệnh đề quan hệ', 'Trật tự từ'],
  LR: ['Sai chính tả', 'Lặp từ', 'Sai Collocation', 'Dịch word-by-word', 'Chưa trang trọng', 'Sai từ loại (Word form)'],
  CC: ['Thiếu liên kết', 'Liên từ gượng ép', 'Lạc đề đoạn', 'Ngắt đoạn chưa hợp lý', 'Chưa rõ câu chủ đề'],
  TA_TR: ['Chưa rõ lập trường', 'Thiếu dẫn chứng', 'Chưa cover hết đề', 'Chưa có Overview (Task 1)', 'Phát triển ý sơ sài'],
};

export const QUICK_TAG_MAP: Record<string, string> = {
  'Sai S-V': 'Subject-Verb Agreement',
  'Sai mạo từ': 'Article Error',
  'Sai giới từ': 'Preposition Error',
  'Sai thì động từ': 'Verb Tense Error',
  'Câu cụt / Run-on': 'Sentence Fragment / Run-on',
  'Thiếu mệnh đề quan hệ': 'Missing Relative Clause',
  'Trật tự từ': 'Word Order',
  'Sai chính tả': 'Spelling Mistake',
  'Lặp từ': 'Word Repetition',
  'Sai Collocation': 'Unnatural Collocation',
  'Dịch word-by-word': 'Literal Translation',
  'Chưa trang trọng': 'Informal Register',
  'Sai từ loại (Word form)': 'Incorrect Word Form',
  'Thiếu liên kết': 'Weak Cohesion',
  'Liên từ gượng ép': 'Forced Linkers',
  'Lạc đề đoạn': 'Off-topic Paragraph',
  'Ngắt đoạn chưa hợp lý': 'Poor Paragraphing',
  'Chưa rõ câu chủ đề': 'Vague Topic Sentence',
  'Chưa rõ lập trường': 'Unclear Position',
  'Thiếu dẫn chứng': 'Insufficient Support',
  'Chưa cover hết đề': 'Incomplete Task Response',
  'Chưa có Overview (Task 1)': 'Missing Overview',
  'Phát triển ý sơ sài': 'Underdeveloped Ideas',
  'Sai ngữ pháp': 'Grammar error',
  'Dùng từ sai': 'Wrong word choice',
  'Thiếu mạo từ': 'Missing article',
  'Sai thì': 'Wrong tense',
  'Diễn đạt vụng': 'Awkward phrasing',
  'Cần collocations tự nhiên': 'Collocation upgrade',
  'Cấu trúc hay': 'Good structure',
  'Từ vựng tốt': 'Good vocabulary',
};

export function formatTag(tag: string, isVi?: boolean): string {
  if (isVi === true) return tag;
  return QUICK_TAG_MAP[tag] || tag;
}

const BAND_DESCRIPTORS: Record<CriterionKey, Record<number, string>> = {
  TA_TR: {
    5: 'Addresses the task partially; format may be inappropriate in places; key points not fully covered.',
    6: 'Addresses the requirements of the task; presents an overview or relevant position, though ideas may lack focus.',
    7: 'Covers all requirements; presents a clear position throughout; develops ideas with relevant details.',
    8: 'Fully covers all requirements; well-developed response with relevant, extended, and supported ideas.',
    9: 'Fully satisfies all requirements with insightful, sophisticated response.',
  },
  CC: {
    5: 'Presents information with some organisation; cohesive devices may be inaccurate or overused; paragraphing lacking.',
    6: 'Arranges information coherently with overall progression; cohesive devices effective though somewhat mechanical.',
    7: 'Logically organises information; clear progression throughout; uses a range of cohesive devices appropriately.',
    8: 'Sequences information logically; manages paragraphing and transition smoothly with minimal mechanical devices.',
    9: 'Uses cohesion in such a way that it attracts no attention; manages paragraphing skillfully.',
  },
  LR: {
    5: 'Limited range of vocabulary; makes noticeable errors in spelling and word formation that cause difficulty.',
    6: 'Adequate vocabulary for the task; attempts less common words but with some inaccuracy in collocation.',
    7: 'Uses sufficient range of vocabulary with flexibility; uses less common and idiomatic items with awareness of style.',
    8: 'Wide vocabulary fluently and flexibly; skillful use of uncommon items; occasional minor errors only.',
    9: 'Uses wide vocabulary with very natural and sophisticated control of lexical features.',
  },
  GRA: {
    5: 'Uses only a limited range of structures; attempts complex sentences but these tend to be less accurate.',
    6: 'Mix of simple and complex sentence forms; makes some errors in grammar and punctuation but they rarely impede meaning.',
    7: 'Uses a variety of complex structures; produces frequent error-free sentences with good grammatical control.',
    8: 'Wide range of structures; the majority of sentences are error-free; only very occasional non-systematic errors.',
    9: 'Full flexibility and accuracy in structure; wide range used skillfully and completely naturally.',
  },
};

const STOPWORDS = new Set([
  'about','above','after','again','against','almost','along','already','also','although','always','among','an',
  'and','another','any','anybody','anyone','anything','anyway','are','around','as','at','be','because','been',
  'before','being','below','between','both','but','by','can','could','did','do','does','doing','down','during',
  'each','even','every','for','from','further','had','has','have','having','he','her','here','hers','herself',
  'him','himself','his','how','however','if','in','into','is','it','its','itself','just','may','maybe','me','might',
  'more','most','much','must','my','myself','no','nor','not','now','of','off','on','once','one','only','or',
  'other','ought','our','ours','ourselves','out','over','own','same','shall','she','should','so','some','somebody',
  'someone','something','such','than','that','the','their','theirs','them','themselves','then','there','these',
  'they','this','those','through','to','too','under','until','up','very','was','we','were','what','when','where',
  'which','while','who','whom','why','will','with','would','you','your','yours','yourself','yourselves',
]);

// ==========================================
// LOSSLESS ESSAY TEXT SEGMENTATION & ESCAPE HELPERS
// ==========================================
function escapeRegExp(str: string): string {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function getApiBase(): string {
  if (typeof window === 'undefined') return '';
  return ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)
    ? 'http://localhost:8000'
    : '';
}

export function normalizeChartUrl(rawUrl?: string): string {
  const url = String(rawUrl || '').replace(/&amp;/gi, '&').trim();
  if (!url) return '';
  if (url.startsWith('data:') || url.startsWith('blob:')) return url;
  if (url.startsWith('http://') || url.startsWith('https://')) {
    if (typeof window !== 'undefined' && window.location.protocol === 'https:' && url.startsWith('http://')) {
      try {
        const parsed = new URL(url);
        if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) {
          return url.replace(/^http:\/\//i, 'https://');
        }
      } catch {
        return url;
      }
    }
    return url;
  }
  if (url.startsWith('/api/')) {
    const apiBase = getApiBase();
    if (apiBase) return `${apiBase}${url}`;
    if (typeof window !== 'undefined') return `${window.location.origin}${url}`;
    return url;
  }
  if (url.startsWith('/')) {
    if (typeof window !== 'undefined') return `${window.location.origin}${url}`;
    return url;
  }
  return url;
}

export interface AccurateCommentSpan {
  comment: WritingComment;
  start: number;
  end: number;
  quote: string;
  displayIndex: number;
}
export type AccurateTaskComment = AccurateCommentSpan;

export function resolveAccurateCommentSpan(
  essayText: string,
  comment: WritingComment
): { start: number; end: number; quote: string } | null {
  const rawQuote = String(comment.anchorQuote || '').trim();
  if (!rawQuote || !essayText) return null;

  const targetOffset = typeof comment.startOffset === 'number' ? comment.startOffset : 0;

  // 1. Exact match across all occurrences in essayText
  const exactIndices: number[] = [];
  let pos = 0;
  while ((pos = essayText.indexOf(rawQuote, pos)) !== -1) {
    exactIndices.push(pos);
    pos += 1;
  }

  if (exactIndices.length > 0) {
    let best = exactIndices[0];
    let minDiff = Math.abs(best - targetOffset);
    for (let i = 1; i < exactIndices.length; i++) {
      const diff = Math.abs(exactIndices[i] - targetOffset);
      if (diff < minDiff) {
        minDiff = diff;
        best = exactIndices[i];
      }
    }
    return {
      start: best,
      end: best + rawQuote.length,
      quote: rawQuote,
    };
  }

  // 2. Whitespace-tolerant match (handles multiple spaces, line breaks inside quote)
  try {
    const tokens = rawQuote.split(/\s+/).filter(Boolean).map(escapeRegExp);
    if (tokens.length > 0) {
      const pattern = new RegExp(tokens.join('\\s+'), 'g');
      let match: RegExpExecArray | null;
      let bestMatch: { start: number; end: number; quote: string } | null = null;
      let minDiff = Infinity;

      while ((match = pattern.exec(essayText)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        const diff = Math.abs(start - targetOffset);
        if (diff < minDiff) {
          minDiff = diff;
          bestMatch = { start, end, quote: match[0] };
        }
      }

      if (bestMatch) {
        return bestMatch;
      }
    }
  } catch (e) {
    // regex fallback
  }

  // 3. Case-insensitive exact match
  const lowerEssay = essayText.toLowerCase();
  const lowerQuote = rawQuote.toLowerCase();
  const lowerIndices: number[] = [];
  pos = 0;
  while ((pos = lowerEssay.indexOf(lowerQuote, pos)) !== -1) {
    lowerIndices.push(pos);
    pos += 1;
  }

  if (lowerIndices.length > 0) {
    let best = lowerIndices[0];
    let minDiff = Math.abs(best - targetOffset);
    for (let i = 1; i < lowerIndices.length; i++) {
      const diff = Math.abs(lowerIndices[i] - targetOffset);
      if (diff < minDiff) {
        minDiff = diff;
        best = lowerIndices[i];
      }
    }
    const matchedQuote = essayText.slice(best, best + rawQuote.length);
    return {
      start: best,
      end: best + rawQuote.length,
      quote: matchedQuote,
    };
  }

  return null;
}

export function resolveAndSortActiveTaskComments(
  essayText: string,
  comments: WritingComment[]
): AccurateCommentSpan[] {
  const resolved: Array<{ comment: WritingComment; start: number; end: number; quote: string }> = [];

  for (const c of comments) {
    const span = resolveAccurateCommentSpan(essayText, c);
    if (span) {
      resolved.push({
        comment: c,
        start: span.start,
        end: span.end,
        quote: span.quote,
      });
    }
  }

  // Sort by start offset ascending, then longer span first
  resolved.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return (b.end - b.start) - (a.end - a.start);
  });

  return resolved.map((item, idx) => ({
    ...item,
    displayIndex: idx + 1,
  }));
}

export interface TextSegment {
  text: string;
  isHighlight: boolean;
  annotations: AccurateCommentSpan[];
  diffType?: 'none' | 'replace';
}

export interface LosslessParagraph {
  pIndex: number;
  rawText: string;
  pStart: number;
  pEnd: number;
  segments: TextSegment[];
}

export function parseParagraphsWithOffsets(
  text: string
): Array<{ pIndex: number; text: string; start: number; end: number }> {
  if (!text) return [];
  const paras: Array<{ pIndex: number; text: string; start: number; end: number }> = [];

  const regex = /([^\r\n]+)/g;
  let match: RegExpExecArray | null;
  let pIdx = 0;
  while ((match = regex.exec(text)) !== null) {
    const pText = match[1];
    const start = match.index;
    const end = start + pText.length;
    paras.push({
      pIndex: pIdx++,
      text: pText,
      start,
      end,
    });
  }
  if (paras.length === 0 && text.length > 0) {
    paras.push({ pIndex: 0, text, start: 0, end: text.length });
  }
  return paras;
}

export function buildLosslessParagraphSegments(
  essayText: string,
  accurateComments: AccurateCommentSpan[],
  mode: 'annotated' | 'diff' = 'annotated'
): LosslessParagraph[] {
  const paragraphs = parseParagraphsWithOffsets(essayText);

  return paragraphs.map(para => {
    const { pIndex, text: rawText, start: pStart, end: pEnd } = para;

    // Filter annotations that intersect this paragraph [pStart, pEnd]
    const intersecting = accurateComments.filter(a => a.start < pEnd && a.end > pStart);

    const segments: TextSegment[] = [];
    let cursor = pStart;

    for (const ann of intersecting) {
      const segStart = Math.max(ann.start, pStart);
      const segEnd = Math.min(ann.end, pEnd);

      if (segEnd <= cursor) {
        // Enclosed inside already-emitted segment
        if (segments.length > 0) {
          const lastSeg = segments[segments.length - 1];
          if (lastSeg.isHighlight && !lastSeg.annotations.some(a => a.comment.id === ann.comment.id)) {
            lastSeg.annotations.push(ann);
          }
        }
        continue;
      }

      const effectiveStart = Math.max(segStart, cursor);
      if (effectiveStart > cursor) {
        const plainPiece = essayText.slice(cursor, effectiveStart);
        if (plainPiece) {
          segments.push({
            text: plainPiece,
            isHighlight: false,
            annotations: [],
          });
        }
      }

      const highlightPiece = essayText.slice(effectiveStart, segEnd);
      if (highlightPiece) {
        segments.push({
          text: highlightPiece,
          isHighlight: true,
          annotations: [ann],
          diffType: mode === 'diff' && ann.comment.replacement ? 'replace' : 'none',
        });
        cursor = segEnd;
      }
    }

    if (cursor < pEnd) {
      const trailingPiece = essayText.slice(cursor, pEnd);
      if (trailingPiece) {
        segments.push({
          text: trailingPiece,
          isHighlight: false,
          annotations: [],
        });
      }
    }

    // HARD SAFETY INVARIANT: joined text MUST equal rawText 100% character-for-character
    const reconstructed = segments.map(s => s.text).join('');
    if (reconstructed !== rawText) {
      console.warn(`[WritingFeedback] Segment text mismatch in ¶${pIndex + 1}! Falling back to unclipped raw text.`);
      return {
        pIndex,
        rawText,
        pStart,
        pEnd,
        segments: [{ text: rawText, isHighlight: false, annotations: [] }],
      };
    }

    return {
      pIndex,
      rawText,
      pStart,
      pEnd,
      segments,
    };
  });
}

// ==========================================
// MULTI-LINE RECT HELPER FOR HIGHLIGHTED SPANS
// ==========================================
function getTargetClientLineRect(target: HTMLElement, clientX?: number, clientY?: number): DOMRect {
  const rects = Array.from(target.getClientRects());
  if (rects.length <= 1 || clientX === undefined || clientY === undefined) {
    return target.getBoundingClientRect();
  }
  // Find rect containing cursor
  for (const r of rects) {
    if (clientX >= r.left - 4 && clientX <= r.right + 4 && clientY >= r.top - 4 && clientY <= r.bottom + 4) {
      return r;
    }
  }
  // Fallback: rect closest to cursor Y
  let closest = rects[0];
  let minDiff = Math.abs((closest.top + closest.bottom) / 2 - clientY);
  for (let i = 1; i < rects.length; i++) {
    const diff = Math.abs((rects[i].top + rects[i].bottom) / 2 - clientY);
    if (diff < minDiff) {
      minDiff = diff;
      closest = rects[i];
    }
  }
  return closest;
}

// ==========================================
// UNIVERSAL SMART FLOATING CARD PORTAL
// ==========================================
const VIEWPORT_PAD = 14;
const GAP = 10;

interface FloatingCardPortalProps {
  isOpen: boolean;
  anchorRect: DOMRect | null;
  fallbackWidth?: number;
  fallbackHeight?: number;
  preferPlacement?: 'top' | 'bottom';
  className?: string;
  style?: React.CSSProperties;
  showArrow?: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  children: (placement: 'top' | 'bottom', arrowLeft: number) => React.ReactNode;
}

const FloatingCardPortal: React.FC<FloatingCardPortalProps> = ({
  isOpen,
  anchorRect,
  fallbackWidth = 340,
  fallbackHeight = 220,
  preferPlacement,
  className = '',
  style = {},
  showArrow = true,
  onMouseEnter,
  onMouseLeave,
  children,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{
    top: number;
    left: number;
    arrowLeft: number;
    placement: 'top' | 'bottom';
    ready: boolean;
  }>({
    top: 0,
    left: 0,
    arrowLeft: fallbackWidth / 2,
    placement: preferPlacement || 'bottom',
    ready: false,
  });

  useLayoutEffect(() => {
    if (!isOpen || !anchorRect || typeof window === 'undefined') {
      setCoords(prev => (prev.ready ? { ...prev, ready: false } : prev));
      return;
    }

    const cardEl = cardRef.current;
    const cardRect = cardEl ? cardEl.getBoundingClientRect() : null;
    const width = (cardRect && cardRect.width > 0) ? cardRect.width : fallbackWidth;
    const height = (cardRect && cardRect.height > 0) ? cardRect.height : fallbackHeight;

    const vh = window.innerHeight;
    const vw = window.innerWidth;

    const spaceBelow = vh - anchorRect.bottom - VIEWPORT_PAD;
    const spaceAbove = anchorRect.top - VIEWPORT_PAD;

    let placement: 'top' | 'bottom';
    if (preferPlacement === 'top') {
      placement = (spaceAbove >= height + GAP || spaceAbove >= spaceBelow) ? 'top' : 'bottom';
    } else if (preferPlacement === 'bottom') {
      placement = (spaceBelow >= height + GAP || spaceBelow >= spaceAbove) ? 'bottom' : 'top';
    } else {
      // Smart Vertical Flip Rule:
      // Flip above if not enough space below AND spaceAbove > spaceBelow,
      // OR target is in lower 38% of viewport (anchorRect.bottom > vh * 0.62) and fits above
      const shouldFlip =
        (spaceBelow < height + GAP && spaceAbove > spaceBelow) ||
        (anchorRect.bottom > vh * 0.62 && spaceAbove >= height + GAP);
      placement = shouldFlip ? 'top' : 'bottom';
    }

    let top: number;
    if (placement === 'top') {
      top = Math.max(VIEWPORT_PAD, anchorRect.top - height - GAP);
    } else {
      top = Math.min(vh - height - VIEWPORT_PAD, anchorRect.bottom + GAP);
    }
    // Hard clamp within viewport
    top = Math.max(VIEWPORT_PAD, Math.min(top, vh - height - VIEWPORT_PAD));

    // Smart Horizontal Alignment & Caret Offset
    const idealLeft = anchorRect.left + (anchorRect.width / 2) - (width / 2);
    const left = Math.max(VIEWPORT_PAD, Math.min(idealLeft, vw - width - VIEWPORT_PAD));
    const arrowLeft = Math.max(18, Math.min(anchorRect.left + (anchorRect.width / 2) - left, width - 18));

    setCoords({ top, left, arrowLeft, placement, ready: true });
  }, [isOpen, anchorRect, preferPlacement, fallbackWidth, fallbackHeight]);

  if (!isOpen || !anchorRect || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={cardRef}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      data-placement={coords.placement}
      className={`wf-floating-card ${className}`}
      style={{
        position: 'fixed',
        top: coords.top,
        left: coords.left,
        zIndex: 1400,
        boxSizing: 'border-box',
        opacity: coords.ready ? 1 : 0,
        pointerEvents: coords.ready ? 'auto' : 'none',
        ...style,
      }}
    >
      {/* 10x10px Directional Caret Pointer Arrow (45deg rotated square) */}
      {showArrow && (
        <div
          style={{
            position: 'absolute',
            left: coords.arrowLeft - 5,
            ...(coords.placement === 'bottom'
              ? { top: -5, borderTop: `1px solid ${C.border}`, borderLeft: `1px solid ${C.border}` }
              : { bottom: -5, borderBottom: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}` }
            ),
            width: 10,
            height: 10,
            background: '#FFFFFF',
            transform: 'rotate(45deg)',
            zIndex: 10,
            pointerEvents: 'none',
          }}
        />
      )}
      {children(coords.placement, coords.arrowLeft)}
    </div>,
    document.body
  );
};

// ==========================================
// VECTOR PRINT DOSSIER HTML BUILDERS
// ==========================================
export function buildDossierAnnotatedEssayHtml(
  text: string,
  accurateComments: AccurateTaskComment[],
  isVi: boolean = true
): string {
  if (!text || !text.trim()) {
    return `<div style="color: #9590A0; font-style: italic;">${isVi ? "Thí sinh chưa nộp bài viết cho Task này." : "Candidate did not submit an essay for this Task."}</div>`;
  }

  const paragraphs = buildLosslessParagraphSegments(text, accurateComments, 'annotated');

  return paragraphs
    .map(para => {
      const segHtml = para.segments
        .map(seg => {
          if (seg.isHighlight && seg.annotations.length > 0) {
            const top = seg.annotations[0];
            const cat = top.comment.category || 'error';
            const color =
              cat === 'error'
                ? '#C93B3B'
                : cat === 'awkward'
                ? '#B45309'
                : cat === 'upgrade'
                ? '#4F46E5'
                : '#15803D';
            const bg =
              cat === 'error'
                ? '#FEF2F2'
                : cat === 'awkward'
                ? '#FFFBEB'
                : cat === 'upgrade'
                ? '#EEF2FF'
                : '#F0FDF4';

            return `<mark style="display: inline; background: ${bg}; border-bottom: 2px solid ${color}; padding: 1px 3px; border-radius: 2px; color: inherit;">${escapeHtml(
              seg.text
            )}<sup style="display: inline; font-size: 10px; font-weight: 800; color: ${color}; margin-left: 2px; font-family: Consolas, monospace;">[${top.displayIndex}]</sup></mark>`;
          }
          return escapeHtml(seg.text);
        })
        .join('');

      return `<div style="font-size: 13px; line-height: 1.85; color: #1A1726; margin-bottom: 12px;"><span style="font-size: 10px; color: #9590A0; font-family: Consolas, monospace; margin-right: 8px; user-select: none;">¶${para.pIndex + 1}</span>${segHtml}</div>`;
    })
    .join('');
}

export function buildVectorPdfDossierHtml(params: {
  studentName: string;
  quizTitle: string;
  taskTitle: string;
  taskNumber: number;
  wordCount: number;
  overallBand: string | number;
  taskScores: {
    ta: string | number;
    cc: string | number;
    lr: string | number;
    gra: string | number;
  };
  criteriaNotes?: Record<string, string>;
  taskInstructions?: string;
  taskPrompt?: string;
  mediaUrl?: string;
  bottlenecks?: string[];
  generalFeedback?: string;
  annotatedEssayHtml: string;
  comments: AccurateTaskComment[];
  correctedEssay?: string;
  sampleEssay?: string;
  isVi?: boolean;
}): string {
  const isVi = params.isVi ?? true;
  const tx = (vi: string, en: string) => (isVi ? vi : en);

  const critList = [
    { key: 'TA_TR' as const, label: params.taskNumber === 1 ? 'Task Achievement (TA)' : 'Task Response (TR)', score: params.taskScores.ta },
    { key: 'CC' as const, label: 'Coherence & Cohesion (CC)', score: params.taskScores.cc },
    { key: 'LR' as const, label: 'Lexical Resource (LR)', score: params.taskScores.lr },
    { key: 'GRA' as const, label: 'Grammar Range & Accuracy (GRA)', score: params.taskScores.gra },
  ];

  const criteriaRows = critList.map(c => {
    const rawScore = c.score;
    const rounded = typeof rawScore === 'number' ? Math.round(rawScore) : Number(rawScore) || 6;
    const desc = params.criteriaNotes?.[c.key] || BAND_DESCRIPTORS[c.key]?.[rounded] || tx('Đáp ứng yêu cầu.', 'Meets criteria requirements.');
    return `
      <tr style="border-bottom: 1px solid #E4DFD3;">
        <td style="padding: 8px 10px; font-weight: 700; width: 28%;">${escapeHtml(c.label)}</td>
        <td style="padding: 8px 10px; font-family: Consolas, monospace; font-weight: 800; color: #5B3DF5; width: 14%;">Band ${rawScore ?? '—'}</td>
        <td style="padding: 8px 10px; color: #4B5563; line-height: 1.5;">${escapeHtml(desc)}</td>
      </tr>
    `;
  }).join('');

  const bottlenecksHtml = (params.bottlenecks && params.bottlenecks.length > 0)
    ? `
      <div class="pdf-no-break" style="padding: 10px 14px; background: #FFFBEB; border: 1px solid #FCD34D; border-left: 4px solid #B45309; border-radius: 4px; margin-bottom: 12px; page-break-inside: avoid; break-inside: avoid;">
        <div style="font-size: 11px; font-weight: 900; color: #B45309; text-transform: uppercase; margin-bottom: 4px;">
          ${escapeHtml(tx('Trọng tâm khắc phục (Priority Action Plan):', 'Priority Action Plan:'))}
        </div>
        <ul style="margin: 0; padding-left: 18px; font-size: 12px; line-height: 1.6; color: #1A1726;">
          ${params.bottlenecks.map(b => `<li>${escapeHtml(b)}</li>`).join('')}
        </ul>
      </div>
    `
    : '';

  const generalFeedbackHtml = (params.generalFeedback && params.generalFeedback.trim())
    ? `
      <div class="pdf-no-break" style="padding: 10px 14px; background: #EEF2FF; border: 1px solid #C7D2FE; border-left: 4px solid #5B3DF5; border-radius: 4px; margin-bottom: 16px; page-break-inside: avoid; break-inside: avoid;">
        <div style="font-size: 11px; font-weight: 900; color: #5B3DF5; text-transform: uppercase; margin-bottom: 4px;">
          ${escapeHtml(tx('Nhận xét chung của giáo viên:', 'Teacher General Feedback:'))}
        </div>
        <div style="font-size: 12px; line-height: 1.6; color: #1A1726; white-space: pre-wrap;">
          ${escapeHtml(params.generalFeedback)}
        </div>
      </div>
    `
    : '';

  const tableRows = params.comments.map(item => {
    const c = item.comment;
    const cat = c.category || 'error';
    const critLabel = c.criterion === 'TA_TR' ? (params.taskNumber === 1 ? 'TA' : 'TR') : (c.criterion || 'GRA');
    const catLabel = cat === 'error' ? tx('Lỗi sai', 'Correction') : cat === 'awkward' ? tx('Chưa tự nhiên', 'Awkward') : cat === 'upgrade' ? tx('Nâng Band', 'Band Upgrade') : tx('Điểm sáng', 'Merit');
    const catColor = cat === 'error' ? '#C93B3B' : cat === 'awkward' ? '#B45309' : cat === 'upgrade' ? '#4F46E5' : '#15803D';

    return `
      <tr class="pdf-no-break" style="border-bottom: 1px solid #E4DFD3; page-break-inside: avoid; break-inside: avoid;">
        <td style="padding: 7px 8px; font-family: Consolas, monospace; font-weight: 800; color: #5B3DF5; width: 5%;">
          [${item.displayIndex}]
        </td>
        <td style="padding: 7px 8px; color: #C93B3B; text-decoration: ${c.replacement ? 'line-through' : 'none'}; width: 26%;">
          ${escapeHtml(item.quote || c.anchorQuote || '—')}
        </td>
        <td style="padding: 7px 8px; width: 28%;">
          ${c.replacement ? `<div style="color: #15803D; font-weight: 700;">${escapeHtml(c.replacement)}</div>` : ''}
          ${c.highBandRewrite ? `<div style="font-size: 11px; color: #4F46E5; margin-top: 3px;"><strong>Band 8+:</strong> ${escapeHtml(c.highBandRewrite)}</div>` : ''}
          ${!c.replacement && !c.highBandRewrite ? '<span style="color: #9590A0;">—</span>' : ''}
        </td>
        <td style="padding: 7px 8px; width: 14%;">
          <div style="font-family: Consolas, monospace; font-weight: 700; font-size: 11px; color: #1A1726;">${escapeHtml(critLabel)}</div>
          <span style="font-size: 10px; font-weight: 700; color: ${catColor};">${escapeHtml(catLabel)}</span>
          ${c.tags && c.tags.length > 0 ? `<div style="font-size: 9.5px; color: #666175; margin-top: 2px;">${escapeHtml(c.tags.map(t => formatTag(t, isVi)).join(', '))}</div>` : ''}
        </td>
        <td style="padding: 7px 8px; color: #374151; line-height: 1.5;">
          ${escapeHtml(c.comment || '')}
        </td>
      </tr>
    `;
  }).join('');

  return `<!DOCTYPE html>
<html lang="${isVi ? 'vi' : 'en'}">
<head>
  <meta charset="utf-8" />
  <base href="${typeof window !== 'undefined' ? window.location.origin : ''}/" />
  <title>IELTS Writing Assessment Dossier - ${escapeHtml(params.studentName)}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 14mm 15mm 14mm 15mm;
    }
    @media print {
      body {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      .pdf-no-break {
        page-break-inside: avoid !important;
        break-inside: avoid !important;
      }
    }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #1A1726;
      background: #FFFFFF;
      margin: 0;
      padding: 0;
      line-height: 1.5;
      font-size: 12px;
    }
    h1, h2, h3 {
      font-family: Georgia, "Times New Roman", serif;
      color: #1A1726;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      text-align: left;
      vertical-align: top;
    }
  </style>
</head>
<body>
  <div style="width: 100%; max-width: 800px; margin: 0 auto; padding: 10px 0;">
    <!-- Header Banner -->
    <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #5B3DF5; padding-bottom: 16px; margin-bottom: 20px;">
      <div>
        <div style="font-size: 10px; font-weight: 900; color: #5B3DF5; letter-spacing: 1.2px; text-transform: uppercase; font-family: Consolas, monospace;">
          IELTS OS — ACADEMIC WRITING ASSESSMENT DOSSIER
        </div>
        <h1 style="font-size: 24px; margin: 4px 0 6px; line-height: 1.2;">
          Writing Assessment Dossier
        </h1>
        <div style="font-size: 12px; color: #666175;">
          ${escapeHtml(tx('Học sinh:', 'Student:'))} <strong style="color: #1A1726;">${escapeHtml(params.studentName)}</strong> · ${escapeHtml(tx('Bài thi:', 'Exam:'))} <strong style="color: #1A1726;">${escapeHtml(params.quizTitle)}</strong>
        </div>
        <div style="font-size: 11.5px; color: #666175; margin-top: 3px;">
          ${escapeHtml(tx('Phần thi:', 'Task:'))} <strong style="color: #1A1726;">${escapeHtml(params.taskTitle)}</strong> · ${escapeHtml(tx('Số từ bài viết:', 'Word count:'))} <strong style="color: #1A1726; font-family: Consolas, monospace;">${params.wordCount} words</strong> · ${escapeHtml(tx('Ngày chấm:', 'Date:'))} <strong>${new Date().toLocaleDateString(isVi ? 'vi-VN' : 'en-US')}</strong>
        </div>
      </div>

      <!-- Band Score Box -->
      <div style="text-align: right; min-width: 180px;">
        <div style="font-size: 9.5px; font-weight: 900; color: #666175; text-transform: uppercase; letter-spacing: 0.5px;">
          ${escapeHtml(tx('Điểm Overall Task', 'Overall Score Task'))} ${params.taskNumber}
        </div>
        <div style="font-family: Georgia, serif; font-size: 32px; font-weight: 900; color: #5B3DF5; line-height: 1; margin: 2px 0 6px;">
          Band ${params.overallBand}
        </div>
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; background: #F6F3EC; border: 1px solid #E4DFD3; border-radius: 4px; padding: 4px 6px; text-align: center;">
          <div>
            <div style="font-size: 9px; font-weight: 800; color: #666175;">${params.taskNumber === 1 ? 'TA' : 'TR'}</div>
            <div style="font-size: 11px; font-weight: 900; color: #5B3DF5; font-family: Consolas, monospace;">${params.taskScores.ta ?? '—'}</div>
          </div>
          <div>
            <div style="font-size: 9px; font-weight: 800; color: #666175;">CC</div>
            <div style="font-size: 11px; font-weight: 900; color: #5B3DF5; font-family: Consolas, monospace;">${params.taskScores.cc ?? '—'}</div>
          </div>
          <div>
            <div style="font-size: 9px; font-weight: 800; color: #666175;">LR</div>
            <div style="font-size: 11px; font-weight: 900; color: #5B3DF5; font-family: Consolas, monospace;">${params.taskScores.lr ?? '—'}</div>
          </div>
          <div>
            <div style="font-size: 9px; font-weight: 800; color: #666175;">GRA</div>
            <div style="font-size: 11px; font-weight: 900; color: #5B3DF5; font-family: Consolas, monospace;">${params.taskScores.gra ?? '—'}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- SECTION 1: TASK PROMPT & VISUAL -->
    <div class="pdf-no-break" style="margin-bottom: 20px; page-break-inside: avoid; break-inside: avoid;">
      <h3 style="font-size: 13px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 8px;">
        ${escapeHtml(tx('1. Đề bài & Hướng dẫn (Task Prompt)', '1. Task Prompt & Instructions'))}
      </h3>
      <div style="padding: 12px 16px; background: #F6F3EC; border: 1px solid #E4DFD3; border-radius: 6px; font-size: 12px; line-height: 1.6;">
        <div style="font-weight: 700; margin-bottom: 4px;">${escapeHtml(params.taskTitle)}</div>
        ${params.taskInstructions ? `<div style="margin-bottom: 6px; color: #4B5563;">${escapeHtml(params.taskInstructions)}</div>` : ''}
        ${params.taskPrompt ? `<div style="margin-top: 4px;">${params.taskPrompt}</div>` : ''}
        ${params.mediaUrl ? `
          <div class="dossier-chart-box" style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #DCD6C8; text-align: center; break-inside: avoid; page-break-inside: avoid;">
            <img id="pdf-dossier-chart-img" src="${params.mediaUrl.startsWith('data:') ? params.mediaUrl : escapeHtml(params.mediaUrl)}" alt="Task Visual Graphic" referrerpolicy="no-referrer" style="display: block; margin: 0 auto; max-width: 100%; max-height: 300px; width: auto; height: auto; object-fit: contain; background: #FFFFFF; padding: 10px; border: 1px solid #E4DFD3; border-radius: 6px;" />
          </div>
        ` : ''}
      </div>
    </div>

    <!-- SECTION 2: 4 CRITERIA MATRIX & PEDAGOGICAL NOTES -->
    <div class="pdf-no-break" style="margin-bottom: 20px; page-break-inside: avoid; break-inside: avoid;">
      <h3 style="font-size: 13px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 8px;">
        ${escapeHtml(tx('2. Đánh giá chi tiết 4 tiêu chí chấm điểm', '2. Four Criteria Assessment & Pedagogical Notes'))}
      </h3>
      <table style="border: 1px solid #E4DFD3; font-size: 11.5px;">
        <thead>
          <tr style="background: #F6F3EC; border-bottom: 1px solid #E4DFD3;">
            <th style="padding: 7px 10px; width: 28%;">${escapeHtml(tx('Tiêu chí', 'Criterion'))}</th>
            <th style="padding: 7px 10px; width: 14%;">${escapeHtml(tx('Điểm Band', 'Band Score'))}</th>
            <th style="padding: 7px 10px;">${escapeHtml(tx('Nhận xét sư phạm', 'Pedagogical Notes'))}</th>
          </tr>
        </thead>
        <tbody>
          ${criteriaRows}
        </tbody>
      </table>
    </div>

    ${bottlenecksHtml}
    ${generalFeedbackHtml}

    <!-- SECTION 3: ANNOTATED STUDENT ESSAY -->
    <div style="margin-bottom: 22px;">
      <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px;">
        <h3 style="font-size: 13px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.8px; margin: 0;">
          ${escapeHtml(tx(`3. Bài làm của học sinh (Student Essay · ${params.wordCount} words)`, `3. Student Essay (${params.wordCount} words)`))}
        </h3>
        <span style="font-size: 11px; color: #666175; font-style: italic;">
          ${escapeHtml(tx('Ghi chú: Số [n] tương ứng với bảng sửa lỗi chi tiết bên dưới.', 'Note: Marker [n] corresponds to the detailed correction table below.'))}
        </span>
      </div>
      <div style="padding: 16px 20px; background: #FAF8F5; border: 1px solid #E4DFD3; border-radius: 6px;">
        ${params.annotatedEssayHtml}
      </div>
    </div>

    <!-- SECTION 4: DETAILED CORRECTIONS TABLE -->
    ${params.comments.length > 0 ? `
      <div style="margin-bottom: 22px;">
        <h3 style="font-size: 13px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 8px;">
          ${escapeHtml(tx(`4. Bảng sửa lỗi & Gợi ý nâng cấp chi tiết (${params.comments.length} điểm chú thích)`, `4. Detailed Corrections & Band Upgrades (${params.comments.length} annotations)`))}
        </h3>
        <table style="border: 1px solid #E4DFD3; font-size: 11.5px;">
          <thead>
            <tr style="background: #F6F3EC; border-bottom: 1px solid #E4DFD3;">
              <th style="padding: 6px 8px; width: 5%;">#</th>
              <th style="padding: 6px 8px; width: 26%;">${escapeHtml(tx('Đoạn gốc', 'Original'))}</th>
              <th style="padding: 6px 8px; width: 28%;">${escapeHtml(tx('Gợi ý sửa & Nâng Band', 'Correction / Upgrade'))}</th>
              <th style="padding: 6px 8px; width: 14%;">${escapeHtml(tx('Tiêu chí', 'Criterion'))}</th>
              <th style="padding: 6px 8px;">${escapeHtml(tx('Giải thích & Lời khuyên', 'Explanation & Feedback'))}</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
      </div>
    ` : ''}

    <!-- SECTION 5: CLEAN CORRECTED ESSAY -->
    ${params.correctedEssay ? `
      <div class="pdf-no-break" style="margin-bottom: 20px; page-break-inside: avoid; break-inside: avoid;">
        <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px;">
          <h3 style="font-size: 13px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.8px; margin: 0; color: #15803D;">
            ${escapeHtml(tx('5. Bài viết đã sửa hoàn chỉnh (Clean Corrected Version)', '5. Clean Corrected Version'))}
          </h3>
          <span style="font-size: 11px; color: #666175; font-family: Consolas, monospace;">
            ${countWritingWords(params.correctedEssay)} words
          </span>
        </div>
        <div style="font-size: 12.5px; line-height: 1.8; white-space: pre-wrap; color: #1A1726; padding: 14px 18px; background: #F0FDF4; border: 1px solid #86EFAC; border-left: 4px solid #15803D; border-radius: 6px;">
          ${escapeHtml(params.correctedEssay)}
        </div>
      </div>
    ` : ''}

    <!-- SECTION 6: BAND 8.0+ MODEL ESSAY -->
    ${params.sampleEssay ? `
      <div class="pdf-no-break" style="margin-bottom: 20px; page-break-inside: avoid; break-inside: avoid;">
        <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px;">
          <h3 style="font-size: 13px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.8px; margin: 0; color: #5B3DF5;">
            ${escapeHtml(tx('6. Bài mẫu tham khảo Band 8.0+ (Model Essay)', '6. Model Essay (Band 8.0+)'))}
          </h3>
          <span style="font-size: 11px; color: #666175; font-family: Consolas, monospace;">
            ${countWritingWords(params.sampleEssay)} words
          </span>
        </div>
        <div style="font-size: 12.5px; line-height: 1.8; white-space: pre-wrap; color: #1A1726; padding: 14px 18px; background: #FAF8F5; border: 1px solid #E4DFD3; border-left: 4px solid #5B3DF5; border-radius: 6px;">
          ${escapeHtml(params.sampleEssay)}
        </div>
      </div>
    ` : ''}

    <!-- Footer Signature -->
    <div style="border-top: 1px solid #E4DFD3; padding-top: 12px; margin-top: 24px; display: flex; justify-content: space-between; font-size: 11px; color: #9590A0;">
      <span>IELTS OS Educational Engine</span>
      <span>Date: ${new Date().toLocaleDateString(isVi ? 'vi-VN' : 'en-US')} · Academic Assessment Dossier</span>
    </div>
  </div>
</body>
</html>`;
}

// ==========================================
// SELF-CONTAINED SVG ICONS (<Ico>)
// ==========================================
const Ico: React.FC<{ name: string; size?: number; color?: string; className?: string; style?: React.CSSProperties }> = ({
  name,
  size = 16,
  color = 'currentColor',
  className,
  style,
}) => {
  const s = { width: size, height: size, display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 };
  const renderSvg = () => {
    switch (name) {
      case 'arrowLeft':
        return <svg style={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>;
      case 'sparkles':
        return <svg style={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></svg>;
      case 'check':
        return <svg style={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>;
      case 'save':
        return <svg style={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>;
      case 'download':
        return <svg style={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;
      case 'edit':
        return <svg style={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>;
      case 'trash':
        return <svg style={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>;
      case 'plus':
        return <svg style={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>;
      case 'chevronDown':
        return <svg style={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>;
      case 'chevronUp':
        return <svg style={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>;
      case 'eye':
        return <svg style={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>;
      case 'fileText':
        return <svg style={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>;
      case 'book':
        return <svg style={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>;
      case 'layers':
        return <svg style={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>;
      case 'alert':
        return <svg style={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>;
      case 'close':
        return <svg style={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
      case 'zoomIn':
        return <svg style={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>;
      case 'copy':
        return <svg style={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>;
      case 'radar':
        return <svg style={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 10 10"/><path d="m12 12 5-5"/></svg>;
      case 'diff':
        return <svg style={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="3" x2="12" y2="21"/><path d="M16 8h4"/><path d="M4 16h4"/><path d="M6 14v4"/></svg>;
      case 'loader':
        return <svg style={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>;
      case 'checkBadge':
        return <svg style={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>;
      default:
        return <svg style={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/></svg>;
    }
  };

  return (
    <span className={className} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', verticalAlign: 'middle', flexShrink: 0, ...style }}>
      {renderSvg()}
    </span>
  );
};

// ==========================================
// ==========================================
// IMAGE TO DATA URL (CANVAS / PROXY EMBEDDING)
// ==========================================
export async function imageToDataUrl(url: string, existingImgEl?: HTMLImageElement | null): Promise<string> {
  const normalized = normalizeChartUrl(url);
  if (!normalized) return '';
  if (normalized.startsWith('data:image/')) return normalized;

  // Attempt A: Server-Side Base64 Image Proxy (bypasses browser CORS completely)
  try {
    const apiBase = getApiBase();
    const proxyUrl = `${apiBase}/api/image_base64?url=${encodeURIComponent(normalized)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const resp = await fetch(proxyUrl, { signal: controller.signal });
    clearTimeout(timer);
    if (resp.ok) {
      const data = await resp.json();
      if (data?.dataUrl && typeof data.dataUrl === 'string' && data.dataUrl.startsWith('data:image/')) {
        return data.dataUrl;
      }
    }
  } catch (e) {
    console.warn('[WritingFeedback] Backend image proxy failed, checking fallback:', e);
  }

  // Attempt B: Direct Canvas Draw from Loaded DOM <img> (if same-origin or CORS-ready)
  if (existingImgEl && existingImgEl.complete && existingImgEl.naturalWidth > 0 && existingImgEl.naturalHeight > 0) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = existingImgEl.naturalWidth;
      canvas.height = existingImgEl.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(existingImgEl, 0, 0);
        const dataUrl = canvas.toDataURL('image/png');
        if (dataUrl && dataUrl.startsWith('data:image/png;base64,')) {
          return dataUrl;
        }
      }
    } catch {
      // Tainted canvas ignored
    }
  }

  // Fallback to normalized direct URL
  return normalized;
}

/**
 * Harvest the chart image source from all possible props, live DOM, and HTML strings,
 * then convert it into an inline base64 data URL for print-to-PDF embedding.
 */
export async function resolveChartImageForPdf(
  activeTask: WritingTaskDefinition,
  activeTaskIndex: number,
  quiz: any
): Promise<string> {
  const candidates: string[] = [];

  // Check explicit props/fields on active task
  const taskAny = activeTask as any;
  if (taskAny.mediaUrl) candidates.push(taskAny.mediaUrl);
  if (taskAny.imageUrl) candidates.push(taskAny.imageUrl);
  if (taskAny.chartUrl) candidates.push(taskAny.chartUrl);
  if (taskAny.diagramImageUrl) candidates.push(taskAny.diagramImageUrl);
  if (taskAny.mapImageUrl) candidates.push(taskAny.mapImageUrl);

  // Live DOM chart image (guaranteed match with screen)
  const existingDomImg = typeof document !== 'undefined'
    ? document.querySelector<HTMLImageElement>('img[data-wf-chart-img="true"]')
    : null;
  if (existingDomImg?.currentSrc) candidates.push(existingDomImg.currentSrc);
  if (existingDomImg?.src) candidates.push(existingDomImg.src);

  // Quiz / section / question props
  if (quiz) {
    if (quiz.mediaUrl) candidates.push(quiz.mediaUrl);
    if (quiz.imageUrl) candidates.push(quiz.imageUrl);

    const sec = quiz.sections?.[activeTaskIndex];
    if (sec?.mediaUrl) candidates.push(sec.mediaUrl);
    if (sec?.imageUrl) candidates.push(sec.imageUrl);
    if (sec?.images?.[0]) candidates.push(sec.images[0]);
    if (sec?.image) candidates.push(sec.image);

    const q = quiz.questions?.[activeTaskIndex] || quiz.questions?.[0];
    if (q?.imageUrl) candidates.push(q.imageUrl);
    if (q?.mediaUrl) candidates.push(q.mediaUrl);
    if (q?.image) candidates.push(q.image);

    // Extract any <img ... src="..."> embedded inside HTML strings
    const htmlStrings = [activeTask.prompt, activeTask.instructions, sec?.passage, quiz.passage, q?.groupContext];
    for (const html of htmlStrings) {
      if (typeof html === 'string') {
        const matches = Array.from(html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi));
        for (const m of matches) {
          if (m[1]) candidates.push(m[1]);
        }
      }
    }
  }

  // Find first non-empty valid candidate
  const rawUrl = candidates
    .map(c => String(c || '').trim())
    .find(c => Boolean(c) && !c.startsWith('javascript:')) || '';

  if (!rawUrl) return '';

  return await imageToDataUrl(rawUrl, existingDomImg);
}

// ==========================================
// MAIN COMPONENT (MANUSCRIPT EDITORIAL DESK)
// ==========================================
export default function WritingFeedback(props: WritingFeedbackDeskProps) {
  const { i18n } = useTranslation();
  const isVi = String(i18n?.language || '').toLowerCase().startsWith('vi');
  const tx = (vi: string, en: string) => (isVi ? vi : en);
  const formatTag = (tag: string, overrideVi?: boolean) => ((overrideVi ?? isVi) ? tag : (QUICK_TAG_MAP[tag] || tag));

  // ----------------------------------------
  // BACKWARD COMPATIBILITY: Legacy single-essay mode
  // ----------------------------------------
  if (props.text !== undefined && !props.reviewQuiz) {
    return <LegacySingleEssayFeedback
      text={props.text}
      taskId={props.taskId || 'task_1'}
      comments={props.comments || []}
      editable={Boolean(props.editable)}
      onChange={props.onChange || (() => {})}
    />;
  }

  // ----------------------------------------
  // WORKSPACE MODE: Complete Editorial Desk
  // ----------------------------------------
  const {
    reviewQuiz,
    userRole = 'STUDENT',
    currentUser,
    setReviewQuiz,
    quizResults = [],
    setQuizResults,
    syncData,
    findMe,
    saveMyVocabNotebook,
    globalStyles,
  } = props;

  if (!reviewQuiz || !reviewQuiz.quiz || !reviewQuiz.result) {
    return <div style={{ padding: 32, textAlign: 'center', color: C.sub }}>{tx('Không tìm thấy dữ liệu bài thi.', 'Exam data not found.')}</div>;
  }

  const isTeacher = userRole === 'TEACHER';
  const writingTasks = useMemo(() => normalizeWritingTasks(reviewQuiz.quiz), [reviewQuiz.quiz]);
  const [activeTaskId, setActiveTaskId] = useState<string>(() => writingTasks[0]?.id || 'writing_task_1');

  // If activeTaskId is not in writingTasks, reset to first task
  const activeTask = useMemo(() => {
    return writingTasks.find(t => t.id === activeTaskId) || writingTasks[0] || {
      id: 'task_1',
      taskNumber: 1,
      title: 'Task 1',
      prompt: '',
      instructions: '',
      mediaUrl: undefined,
      minimumWords: 150,
      recommendedMinutes: 20,
      order: 1,
    };
  }, [writingTasks, activeTaskId]);

  const taskNumber = activeTask.taskNumber || 1;
  const targetWords = taskNumber === 1 ? 150 : 250;

  // Persisted grading state
  const persistedGrading: WritingGrading = reviewQuiz.result.writingGrading || {
    status: 'awaiting_grading',
    taskScores: {},
    correctedAnswers: {},
    comments: [],
  };

  const writingGrading: WritingGrading = useMemo(() => ({
    ...persistedGrading,
    status: persistedGrading.status || 'awaiting_grading',
    taskScores: persistedGrading.taskScores || {},
    correctedAnswers: persistedGrading.correctedAnswers || {},
    comments: Array.isArray(persistedGrading.comments) ? persistedGrading.comments : [],
    taskBottlenecks: persistedGrading.taskBottlenecks || {},
    taskStrengths: persistedGrading.taskStrengths || {},
    criteriaNotes: persistedGrading.criteriaNotes || {},
    sampleAnswers: persistedGrading.sampleAnswers || {},
  }), [persistedGrading]);

  // Rubric calculation
  const scoreIsValid = (val: unknown) => Number.isFinite(Number(val)) && Number(val) >= 0 && Number(val) <= 9;
  const roundedBand = (val: number) => Math.floor((Math.max(0, val) + 0.0001) * 2) / 2;

  const taskBand = (tId: string) => {
    const scores = writingGrading.taskScores[tId] || {};
    const values = (['taskAchievement', 'coherence', 'lexical', 'grammar'] as const).map(k => Number(scores[k]));
    return values.every(scoreIsValid) ? roundedBand(values.reduce((sum, v) => sum + v, 0) / values.length) : undefined;
  };

  const t1Band = taskBand(writingTasks[0]?.id || '');
  const t2Band = taskBand(writingTasks[1]?.id || '');

  const { calculatedFinalBand, overallBandLabel } = useMemo(() => {
    const hasT1 = t1Band !== undefined && t1Band > 0;
    const hasT2 = t2Band !== undefined && t2Band > 0;

    // Both tasks graded > 0: official IELTS weighted band (1/3 Task 1 + 2/3 Task 2)
    if (hasT1 && hasT2) {
      const weighted = Math.round(((t1Band + t2Band * 2) / 3) * 2) / 2;
      return { calculatedFinalBand: weighted, overallBandLabel: 'Overall Band' };
    }
    // Only Task 1 graded > 0 (single task test or Task 2 ungraded/0)
    if (hasT1 && !hasT2) {
      const label = writingTasks.length === 1 ? 'Task 1 Band' : 'T1 Band (Partial)';
      return { calculatedFinalBand: t1Band, overallBandLabel: label };
    }
    // Only Task 2 graded > 0 (single task test or Task 1 ungraded/0)
    if (hasT2 && !hasT1) {
      const label = writingTasks.length === 1 ? 'Task 2 Band' : 'T2 Band (Partial)';
      return { calculatedFinalBand: t2Band, overallBandLabel: label };
    }
    // Both explicitly 0
    if (t1Band === 0 && t2Band === 0) {
      return { calculatedFinalBand: 0, overallBandLabel: 'Overall Band' };
    }
    if (t1Band === 0 && t2Band === undefined) {
      return { calculatedFinalBand: 0, overallBandLabel: 'Task 1 Band' };
    }
    if (t2Band === 0 && t1Band === undefined) {
      return { calculatedFinalBand: 0, overallBandLabel: 'Task 2 Band' };
    }
    return { calculatedFinalBand: undefined, overallBandLabel: 'Overall Band' };
  }, [t1Band, t2Band, writingTasks.length]);

  const activeTaskChartUrl = useMemo(() => {
    const taskAny = activeTask as any;
    const fromTask = taskAny.mediaUrl || taskAny.imageUrl || taskAny.chartUrl || taskAny.diagramImageUrl || taskAny.mapImageUrl;
    if (fromTask) return normalizeChartUrl(String(fromTask).trim());

    const taskIdx = writingTasks.findIndex(t => t.id === activeTask.id);
    const resolvedIdx = taskIdx >= 0 ? taskIdx : (activeTask.taskNumber ? activeTask.taskNumber - 1 : 0);
    const quizAny = reviewQuiz?.quiz as any;
    if (quizAny) {
      const sec = quizAny.sections?.[resolvedIdx];
      const fromSec = sec?.mediaUrl || sec?.imageUrl || sec?.images?.[0] || sec?.image;
      if (fromSec) return normalizeChartUrl(String(fromSec).trim());

      const q = quizAny.questions?.[resolvedIdx] || (resolvedIdx === 0 ? quizAny.questions?.[0] : undefined);
      const fromQ = q?.imageUrl || q?.mediaUrl || q?.image;
      if (fromQ) return normalizeChartUrl(String(fromQ).trim());

      if (resolvedIdx === 0 && (quizAny.mediaUrl || quizAny.imageUrl)) {
        return normalizeChartUrl(String(quizAny.mediaUrl || quizAny.imageUrl).trim());
      }

      const htmlSources = [activeTask.prompt, activeTask.instructions, sec?.passage, quizAny.passage, q?.groupContext];
      for (const src of htmlSources) {
        if (typeof src === 'string') {
          const match = src.match(/<img[^>]+src=["']([^"']+)["']/i);
          if (match && match[1]) return normalizeChartUrl(match[1].trim());
        }
      }
    }
    return '';
  }, [activeTask, writingTasks, reviewQuiz]);

  const studentCanSeeGrade = writingGrading.status === 'published';

  // Active task data
  const originalEssay = String(reviewQuiz.result.answers?.[activeTask.id] || '');
  const activeTaskComments = useMemo(() => {
    return writingGrading.comments.filter(c => c.taskId === activeTask.id);
  }, [writingGrading.comments, activeTask.id]);

  const accurateActiveComments = useMemo(() => {
    return resolveAndSortActiveTaskComments(originalEssay, activeTaskComments);
  }, [originalEssay, activeTaskComments]);

  // UI States
  const [promptDrawerOpen, setPromptDrawerOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'annotated' | 'diff' | 'clean' | 'model'>('annotated');
  const [repRadarActive, setRepRadarActive] = useState(false);
  const [activeTab, setActiveTab] = useState<'rubric' | 'annotations' | 'corrected'>('rubric');
  const [filterCriterion, setFilterCriterion] = useState<string>('ALL');
  const [filterCategory, setFilterCategory] = useState<string>('ALL');
  const [pulseMarkId, setPulseMarkId] = useState<string | null>(null);
  const [vocabToast, setVocabToast] = useState<string | null>(null);
  const [isChartZoomOpen, setIsChartZoomOpen] = useState(false);

  useEffect(() => {
    if (!isChartZoomOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsChartZoomOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isChartZoomOpen]);

  // Action status & message for feedback UX
  const [actionStatus, setActionStatus] = useState<'idle' | 'saving_draft' | 'publishing' | 'saved_ok' | 'published_ok' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState<string>('');

  // Hover Popover State (with smart auto-flip & 60ms open intent / 150ms grace period bridge)
  const [hoveredComment, setHoveredComment] = useState<WritingComment | null>(null);
  const [hoverAnchorRect, setHoverAnchorRect] = useState<DOMRect | null>(null);
  const openTimerRef = useRef<any>(null);
  const closeTimerRef = useRef<any>(null);

  // Selection Popover State (Teacher 2-stage)
  const [selectionBox, setSelectionBox] = useState<{
    rect: DOMRect;
    text: string;
    start: number;
    end: number;
    stage: 1 | 2;
    category: CommentCategory;
    criterion: CriterionKey;
    replacement: string;
    highBandRewrite: string;
    showRewrite: boolean;
    tags: string[];
    comment: string;
  } | null>(null);

  // AI Co-Pilot Modal State
  const [aiModal, setAiModal] = useState<{
    open: boolean;
    loading: boolean;
    error: string;
    data: any | null;
  }>({ open: false, loading: false, error: '', data: null });

  // PDF Export & AI Selection Critique States
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [aiCritiqueLoading, setAiCritiqueLoading] = useState(false);

  // Update handlers
  const updateWritingGrading = (patch: Partial<WritingGrading>) => {
    if (!setReviewQuiz) return;
    const now = Date.now();
    setReviewQuiz((prev: any) => {
      if (!prev) return prev;
      return {
        ...prev,
        result: {
          ...prev.result,
          writingGrading: { ...writingGrading, ...patch, updatedAt: now },
        },
      };
    });
  };

  const updateTaskScore = (tId: string, criterionKey: keyof WritingCriterionScore, rawValue: string | number) => {
    const value = rawValue === '' ? undefined : Math.max(0, Math.min(9, Number(rawValue)));
    updateWritingGrading({
      taskScores: {
        ...writingGrading.taskScores,
        [tId]: { ...(writingGrading.taskScores[tId] || {}), [criterionKey]: value },
      },
    });
  };

  const updateCriteriaNote = (tId: string, critKey: string, note: string) => {
    updateWritingGrading({
      criteriaNotes: {
        ...writingGrading.criteriaNotes,
        [tId]: { ...(writingGrading.criteriaNotes?.[tId] || {}), [critKey]: note },
      },
    });
  };

  const updateTaskBottlenecks = (tId: string, list: string[]) => {
    updateWritingGrading({
      taskBottlenecks: {
        ...writingGrading.taskBottlenecks,
        [tId]: list,
      },
    });
  };

  const saveWritingGrade = async (publish: boolean, overrideGrading?: WritingGrading) => {
    const baseGrading = overrideGrading || writingGrading;
    const rubricKeys: Array<keyof WritingCriterionScore> = ['taskAchievement', 'coherence', 'lexical', 'grammar'];
    if (publish && writingTasks.some(task => !rubricKeys.every(k => scoreIsValid(baseGrading.taskScores[task.id]?.[k])))) {
      setActionStatus('error');
      setStatusMessage(tx('Vui lòng chấm đủ 4 tiêu chí cho cả Task 1 và Task 2 trước khi Publish cho học sinh.', 'Please score all 4 criteria for both Task 1 and Task 2 before publishing to student.'));
      setTimeout(() => setActionStatus('idle'), 4000);
      return;
    }

    setActionStatus(publish ? 'publishing' : 'saving_draft');
    setStatusMessage(publish ? tx('Đang lưu và publish bài chấm cho học sinh...', 'Saving and publishing assessment...') : tx('Đang lưu bản nháp bài chấm...', 'Saving assessment draft...'));

    try {
      const finalBand = publish ? calculatedFinalBand : baseGrading.finalBand;
      const now = Date.now();
      const nextGrading: WritingGrading = {
        ...baseGrading,
        status: publish ? 'published' : 'draft',
        finalBand,
        updatedAt: now,
        ...(publish ? { publishedAt: now, publishedBy: currentUser?.email || '' } : {}),
      };
      const nextResult = {
        ...reviewQuiz.result,
        band: publish && finalBand !== undefined ? finalBand : reviewQuiz.result.band,
        writingScores: publish ? Object.fromEntries(writingTasks.map((task, idx) => [`task${idx + 1}`, taskBand(task.id) ?? ''])) : reviewQuiz.result.writingScores,
        writingGrading: nextGrading,
      };
      if (setReviewQuiz) setReviewQuiz((prev: any) => prev ? { ...prev, result: nextResult } : prev);
      if (setQuizResults && quizResults) {
        const nextResults = quizResults.some(r => r.id === nextResult.id)
          ? quizResults.map(r => r.id === nextResult.id ? nextResult : r)
          : [...quizResults, nextResult];
        setQuizResults(nextResults);
        if (syncData) {
          const saved = await syncData({ quizResults: nextResults });
          if (!saved) {
            setActionStatus('saved_ok');
            setStatusMessage(tx('Bản chấm đã lưu cục bộ trên thiết bị và sẽ tự động đồng bộ khi có mạng.', 'Assessment saved locally and will auto-sync when online.'));
          } else {
            setActionStatus(publish ? 'published_ok' : 'saved_ok');
            setStatusMessage(publish ? tx('Đã xuất bản bài chấm cho học sinh thành công!', 'Assessment published to student successfully!') : tx('Đã lưu bản nháp thành công!', 'Draft saved successfully!'));
          }
        } else {
          setActionStatus('saved_ok');
          setStatusMessage(tx('Đã lưu bản chấm trên thiết bị!', 'Assessment saved on device!'));
        }
      } else {
        setActionStatus('saved_ok');
        setStatusMessage(tx('Đã cập nhật bài chấm!', 'Assessment updated!'));
      }
      setTimeout(() => {
        setActionStatus('idle');
        setStatusMessage('');
      }, 3500);
    } catch (err: any) {
      console.error('[WritingFeedback] Save error:', err);
      setActionStatus('error');
      setStatusMessage(tx('Có lỗi khi lưu bài chấm: ', 'Error saving assessment: ') + (err?.message || tx('Vui lòng thử lại.', 'Please try again.')));
      setTimeout(() => setActionStatus('idle'), 4000);
    }
  };

  // Text Selection Capture for Teacher
  const essayContainerRef = useRef<HTMLDivElement>(null);

  const handleEssayMouseUp = () => {
    if (!isTeacher || viewMode !== 'annotated') return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!essayContainerRef.current || !essayContainerRef.current.contains(range.commonAncestorContainer)) return;

    const selectedText = range.toString().trim();
    if (!selectedText) return;

    // Calculate start & end offset relative to original essay
    const prefixRange = range.cloneRange();
    prefixRange.selectNodeContents(essayContainerRef.current);
    prefixRange.setEnd(range.startContainer, range.startOffset);
    const start = prefixRange.toString().length;
    const end = start + range.toString().length;

    const rect = range.getBoundingClientRect();
    setSelectionBox({
      rect,
      text: selectedText,
      start,
      end,
      stage: 1,
      category: 'error',
      criterion: 'GRA',
      replacement: selectedText,
      highBandRewrite: '',
      showRewrite: false,
      tags: [],
      comment: '',
    });
  };

  const handleSaveSelectionComment = () => {
    if (!selectionBox || !selectionBox.comment.trim()) return;
    const newComment: WritingComment = {
      id: `comment_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      taskId: activeTask.id,
      anchorQuote: selectionBox.text,
      startOffset: selectionBox.start,
      endOffset: selectionBox.end,
      criterion: selectionBox.criterion,
      category: selectionBox.category,
      replacement: selectionBox.replacement.trim() || undefined,
      highBandRewrite: selectionBox.highBandRewrite.trim() || undefined,
      tags: selectionBox.tags.length ? selectionBox.tags : undefined,
      comment: selectionBox.comment.trim(),
      createdAt: Date.now(),
    };
    updateWritingGrading({
      comments: [...writingGrading.comments, newComment],
    });
    setSelectionBox(null);
    window.getSelection()?.removeAllRanges();
  };

  // Inline AI Selection Critique Handler
  const runSelectionAiCritique = async (autoSave: boolean = false) => {
    if (!selectionBox || aiCritiqueLoading) return;
    setAiCritiqueLoading(true);
    try {
      const payload = {
        mode: 'selection_critique',
        selected_text: selectionBox.text,
        selectedText: selectionBox.text,
        essay_text: originalEssay,
        essayText: originalEssay,
        task_number: taskNumber,
        taskNumber: taskNumber,
        prompt: activeTask.prompt || activeTask.instructions || '',
        taskPrompt: activeTask.prompt || activeTask.instructions || '',
        media_url: activeTaskChartUrl || activeTask.mediaUrl || '',
        lang: isVi ? 'vi' : 'en',
      };
      let res = await fetch('/api/ai_critique', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.status === 404) {
        res = await fetch('/api/ai_feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.success === false) {
        const detail = data?.error || data?.detail || data?.message || (res.status ? `HTTP ${res.status}` : res.statusText) || 'Unknown error';
        throw new Error(`AI critique request failed (${detail})`);
      }
      if (!data) throw new Error(tx('AI không trả về kết quả hợp lệ', 'AI did not return a valid result'));

      const nextCrit: CriterionKey = (data.criterion as CriterionKey) || selectionBox.criterion || 'GRA';
      let nextCat: CommentCategory = (data.category as CommentCategory) || 'error';
      const rawCatStr = String(data.category || data.type || '').toLowerCase();
      if (rawCatStr.includes('error') || rawCatStr.includes('correct') || rawCatStr.includes('lỗi')) nextCat = 'error';
      else if (rawCatStr.includes('awkward') || rawCatStr.includes('natural')) nextCat = 'awkward';
      else if (rawCatStr.includes('upgrade') || rawCatStr.includes('band')) nextCat = 'upgrade';
      else if (rawCatStr.includes('praise') || rawCatStr.includes('strength')) nextCat = 'praise';

      const nextReplacement = String(data.replacement ?? data.suggestedText ?? data.revisedText ?? selectionBox.replacement ?? '').trim();
      const nextHighBand = String(data.highBandRewrite ?? data.advancedRewrite ?? '').trim();
      const nextComment = String(data.comment ?? data.critique ?? data.explanation ?? data.note ?? '').trim();
      const nextTags: string[] = Array.isArray(data.tags) ? data.tags : [];

      if (autoSave) {
        const newComment: WritingComment = {
          id: 'cmt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          taskId: activeTask.id,
          anchorQuote: selectionBox.text,
          startOffset: selectionBox.start,
          endOffset: selectionBox.end,
          criterion: nextCrit,
          category: nextCat,
          replacement: nextReplacement || undefined,
          highBandRewrite: nextHighBand || undefined,
          tags: nextTags.length ? nextTags : undefined,
          comment: nextComment || tx('Nhận xét từ AI.', 'AI critique comment.'),
          createdAt: Date.now(),
        };
        const nextComments = [...writingGrading.comments, newComment];
        updateWritingGrading({
          comments: nextComments,
        });
        void saveWritingGrade(false, {
          ...writingGrading,
          comments: nextComments,
          updatedAt: Date.now(),
        });
        setSelectionBox(null);
        window.getSelection()?.removeAllRanges();
      } else {
        setSelectionBox(prev => prev ? ({
          ...prev,
          stage: 2,
          criterion: nextCrit,
          category: nextCat,
          replacement: nextReplacement,
          highBandRewrite: nextHighBand,
          showRewrite: Boolean(nextHighBand),
          tags: nextTags,
          comment: nextComment,
        }) : null);
      }
    } catch (err) {
      console.error('AI Selection Critique error:', err);
      alert(tx('Không thể nhận xét bằng AI: ', 'Unable to generate AI critique: ') + (err as Error).message);
    } finally {
      setAiCritiqueLoading(false);
    }
  };

  // Hover Popover Bridge (60ms intent delay, 150ms close grace period, multi-line rect selection)
  const triggerHoverEnter = (comment: WritingComment, e: React.MouseEvent) => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    const target = e.currentTarget as HTMLElement;
    const lineRect = getTargetClientLineRect(target, e.clientX, e.clientY);

    // If another comment card is already active, switch immediately to keep it snappy
    if (hoveredComment) {
      if (openTimerRef.current) clearTimeout(openTimerRef.current);
      setHoverAnchorRect(lineRect);
      setHoveredComment(comment);
    } else {
      if (openTimerRef.current) clearTimeout(openTimerRef.current);
      openTimerRef.current = setTimeout(() => {
        setHoverAnchorRect(lineRect);
        setHoveredComment(comment);
      }, 60);
    }
  };

  const triggerHoverLeave = () => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      setHoveredComment(null);
      setHoverAnchorRect(null);
    }, 150);
  };

  const cancelHoverLeave = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  // Dismiss hover popover on document scroll or window resize to eliminate layout jitter
  useEffect(() => {
    const handleScrollOrResize = () => {
      if (openTimerRef.current) clearTimeout(openTimerRef.current);
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      setHoveredComment(null);
      setHoverAnchorRect(null);
    };
    window.addEventListener('scroll', handleScrollOrResize, { capture: true, passive: true });
    window.addEventListener('resize', handleScrollOrResize, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScrollOrResize, { capture: true });
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, []);

  // Dismiss popovers when user presses Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectionBox) setSelectionBox(null);
        if (hoveredComment) {
          setHoveredComment(null);
          setHoverAnchorRect(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectionBox, hoveredComment]);

  // Student Vocab Notebook Save
  const handleSaveToVocab = async (word: string, meaning: string, context: string) => {
    if (!findMe || !saveMyVocabNotebook) {
      alert(tx('Vui lòng đăng nhập tài khoản học viên để lưu vào Sổ từ vựng.', 'Please log in with a student account to save to Vocabulary Notebook.'));
      return;
    }
    const me = findMe();
    if (!me) return;
    const now = Date.now();
    const cleanWord = word.trim();
    if (!cleanWord) return;

    // Determine category based on word count
    const wordCount = cleanWord.split(/\s+/).length;
    const category = wordCount > 2 ? 'idiom' : wordCount === 2 ? 'collocation' : 'word';

    const card = {
      id: `vocab_${now}_${Math.random().toString(36).slice(2, 8)}`,
      word: cleanWord,
      meaning: meaning || 'Saved from Writing Feedback',
      evidence: context || '',
      category,
      box: 1,
      due: now,
      createdAt: now,
    };

    const nextNotebook = [card, ...(me.vocabNotebook || [])];
    const ok = await saveMyVocabNotebook(nextNotebook, me.vocabTombstones || []);
    if (ok) {
      setVocabToast(tx(`Đã lưu "${cleanWord}" vào Sổ từ vựng!`, `Saved "${cleanWord}" to Vocabulary Notebook!`));
      setTimeout(() => setVocabToast(null), 3000);
    } else {
      alert(tx('Không thể lưu từ vào sổ từ vựng.', 'Unable to save word to Vocabulary Notebook.'));
    }
  };

  // AI Co-Pilot Execution
  const runAiCoPilot = async () => {
    setAiModal({ open: true, loading: true, error: '', data: null });
    try {
      const resp = await fetch('/api/ai_feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          structured: true,
          task_number: taskNumber,
          task_title: activeTask.title,
          prompt: activeTask.prompt || activeTask.instructions || '',
          essay: originalEssay,
          media_url: activeTaskChartUrl || activeTask.mediaUrl || '',
          lang: isVi ? 'vi' : 'en',
        }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.success) {
        throw new Error(data.error || tx('AI không thể phân tích bài viết.', 'AI could not analyze the essay.'));
      }
      setAiModal({ open: true, loading: false, error: '', data });
    } catch (err: any) {
      setAiModal({ open: true, loading: false, error: err.message || tx('Lỗi kết nối AI', 'AI connection error'), data: null });
    }
  };

  const applyAiDraft = () => {
    if (!aiModal.data) return;
    const { criteria, estimated_task_band, bottlenecks, strengths, annotations, corrected_essay, sample_essay } = aiModal.data;

    // 1. Task Scores
    const nextScores: WritingCriterionScore = {
      taskAchievement: criteria?.TA_TR?.band ?? estimated_task_band,
      coherence: criteria?.CC?.band ?? estimated_task_band,
      lexical: criteria?.LR?.band ?? estimated_task_band,
      grammar: criteria?.GRA?.band ?? estimated_task_band,
    };

    // 2. Comments
    const mappedAnnotations: WritingComment[] = (annotations || []).map((ann: any, idx: number) => ({
      id: `ai_ann_${Date.now()}_${idx}`,
      taskId: activeTask.id,
      anchorQuote: ann.anchorQuote,
      startOffset: ann.startOffset,
      endOffset: ann.endOffset,
      criterion: ann.criterion,
      category: ann.category,
      replacement: ann.replacement,
      highBandRewrite: ann.highBandRewrite,
      comment: ann.comment,
      createdAt: Date.now(),
    }));

    // Filter out existing comments for this task that overlap with AI annotations
    const otherTaskComments = writingGrading.comments.filter(c => c.taskId !== activeTask.id);
    const mergedComments = [...otherTaskComments, ...mappedAnnotations];

    // 3. Bottlenecks & Strengths
    const nextBottlenecks = {
      ...(writingGrading.taskBottlenecks || {}),
      [activeTask.id]: bottlenecks || [],
    };
    const nextStrengths = {
      ...(writingGrading.taskStrengths || {}),
      [activeTask.id]: strengths || [],
    };

    // 4. Corrected & Sample Answers
    const nextCorrected = {
      ...(writingGrading.correctedAnswers || {}),
      [activeTask.id]: corrected_essay || '',
    };
    const nextSample = {
      ...(writingGrading.sampleAnswers || {}),
      [activeTask.id]: sample_essay || '',
    };

    // 5. Criteria Notes
    const nextNotes = {
      ...(writingGrading.criteriaNotes || {}),
      [activeTask.id]: {
        TA_TR: criteria?.TA_TR?.why_current || '',
        CC: criteria?.CC?.why_current || '',
        LR: criteria?.LR?.why_current || '',
        GRA: criteria?.GRA?.why_current || '',
      },
    };

    updateWritingGrading({
      taskScores: {
        ...writingGrading.taskScores,
        [activeTask.id]: nextScores,
      },
      comments: mergedComments,
      taskBottlenecks: nextBottlenecks,
      taskStrengths: nextStrengths,
      correctedAnswers: nextCorrected,
      sampleAnswers: nextSample,
      criteriaNotes: nextNotes,
    });

    setAiModal({ open: false, loading: false, error: '', data: null });
  };

  // Text Stats & Repetition Radar
  const essayStats = useMemo(() => {
    const words = countWritingWords(originalEssay);
    const paragraphs = originalEssay.split(/\n+/).filter(p => p.trim().length > 0).length || 1;
    const sentences = originalEssay.split(/[.!?]+/).filter(s => s.trim().length > 0).length || 1;
    const avgWordsPerSentence = Math.round((words / sentences) * 10) / 10;
    return { words, paragraphs, sentences, avgWordsPerSentence };
  }, [originalEssay]);

  // Repeated words analysis
  const repeatedWordsMap = useMemo(() => {
    if (!repRadarActive) return new Map<string, number>();
    const tokens = originalEssay.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length >= 5 && !STOPWORDS.has(w));
    const counts = new Map<string, number>();
    tokens.forEach(w => counts.set(w, (counts.get(w) || 0) + 1));
    const repMap = new Map<string, number>();
    counts.forEach((v, k) => {
      if (v >= 3) repMap.set(k, v);
    });
    return repMap;
  }, [originalEssay, repRadarActive]);

  // Vector PDF Dossier Export via hidden iframe
  const exportPdfDossier = async () => {
    if (isExportingPdf) return;
    setIsExportingPdf(true);
    try {
      const studentName = (reviewQuiz?.result?.studentName || 'Student').trim();
      const quizTitle = (reviewQuiz?.quiz?.title || 'IELTS Mock Test').trim();
      const taskTitle = (activeTask?.title || `Task ${taskNumber}`).trim();
      const wordCount = countWritingWords(originalEssay);
      const activeBand = taskBand(activeTask.id);
      const overallBand = activeBand !== undefined && activeBand > 0
        ? activeBand
        : (calculatedFinalBand ?? writingGrading.finalBand ?? '—');

      const taskScores = {
        ta: writingGrading.taskScores[activeTask.id]?.taskAchievement ?? '—',
        cc: writingGrading.taskScores[activeTask.id]?.coherence ?? '—',
        lr: writingGrading.taskScores[activeTask.id]?.lexical ?? '—',
        gra: writingGrading.taskScores[activeTask.id]?.grammar ?? '—',
      };

      const annotatedEssayHtml = buildDossierAnnotatedEssayHtml(originalEssay, accurateActiveComments, isVi);

      // Bulletproof Chart Image Extraction & Base64 Embedding
      const activeTaskIndex = writingTasks.findIndex(t => t.id === activeTask.id) >= 0
        ? writingTasks.findIndex(t => t.id === activeTask.id)
        : (taskNumber - 1);
      const resolvedChartDataUrlOrUrl = await resolveChartImageForPdf(activeTask, activeTaskIndex, reviewQuiz.quiz);

      const html = buildVectorPdfDossierHtml({
        studentName,
        quizTitle,
        taskTitle,
        taskNumber,
        wordCount,
        overallBand,
        taskScores,
        criteriaNotes: writingGrading.criteriaNotes?.[activeTask.id],
        taskInstructions: activeTask.instructions,
        taskPrompt: activeTask.prompt,
        mediaUrl: resolvedChartDataUrlOrUrl || undefined,
        bottlenecks: currentBottlenecks,
        generalFeedback: writingGrading.generalFeedback,
        annotatedEssayHtml,
        comments: accurateActiveComments,
        correctedEssay: writingGrading.correctedAnswers?.[activeTask.id],
        sampleEssay: writingGrading.sampleAnswers?.[activeTask.id] || writingGrading.sampleEssay,
        isVi,
      });

      // Create hidden iframe
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = 'none';
      iframe.style.opacity = '0';
      iframe.style.pointerEvents = 'none';
      iframe.style.zIndex = '-9999';
      document.body.appendChild(iframe);

      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!doc) {
        throw new Error(tx('Không thể khởi tạo môi trường in (iframe document).', 'Cannot initialize print environment (iframe document).'));
      }

      doc.open();
      doc.write(html);
      doc.close();

      // Strictly wait for all images inside iframe to load before printing
      const imgs = Array.from(doc.querySelectorAll('img'));
      await Promise.all(
        imgs.map(
          (img) =>
            new Promise<void>((resolve) => {
              if (img.complete && img.naturalWidth > 0) {
                resolve();
                return;
              }
              const timer = window.setTimeout(resolve, 5000);
              img.addEventListener('load', () => { window.clearTimeout(timer); resolve(); }, { once: true });
              img.addEventListener('error', () => { window.clearTimeout(timer); resolve(); }, { once: true });
            })
        )
      );

      await new Promise((r) => window.setTimeout(r, 300));

      const iframeWindow = iframe.contentWindow;
      if (iframeWindow) {
        iframeWindow.focus();
        iframeWindow.print();
      }

      // Clean up iframe after 60s
      setTimeout(() => {
        if (iframe.parentNode) {
          iframe.parentNode.removeChild(iframe);
        }
      }, 60000);
    } catch (err: any) {
      console.error('Vector PDF export error:', err);
      alert(tx('Không thể tạo file PDF tự động: ', 'Cannot generate PDF automatically: ') + (err?.message || tx('Lỗi không xác định', 'Unknown error')));
    } finally {
      setIsExportingPdf(false);
    }
  };

  // Filtered comments for Tab 2
  const filteredComments = useMemo(() => {
    return accurateActiveComments.filter(item => {
      const c = item.comment;
      if (filterCriterion !== 'ALL' && c.criterion !== filterCriterion) return false;
      if (filterCategory !== 'ALL' && c.category !== filterCategory) return false;
      return true;
    });
  }, [accurateActiveComments, filterCriterion, filterCategory]);

  // Current task bottlenecks
  const currentBottlenecks = writingGrading.taskBottlenecks?.[activeTask.id] || [];

  return (
    <div className="writing-feedback-workspace" style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: 'var(--sans)' }}>
      {globalStyles}
      <style>{`
        .writing-feedback-workspace :is(h1,h2,h3,h4,p,div,span,button,input,textarea,label) { text-align: left; }
        .wf-tab-btn { padding: 7px 14px; border: 1px solid ${C.border}; background: ${C.card}; font-size: 13px; font-weight: 700; border-radius: 8px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: all 0.15s; }
        .wf-tab-btn:hover { background: ${C.wash}; }
        .wf-tab-btn.active { background: ${C.accent}; color: #fff; border-color: ${C.accent}; }
        .wf-mark { border-radius: 3px; cursor: pointer; transition: all 0.15s; padding: 1px 3px; margin: 0 -1px; }
        .wf-mark:hover, .wf-mark.is-hovered { outline: 2px solid ${C.accent}; outline-offset: 1px; }
        .wf-mark.pulse-highlight { animation: wfPulse 1.2s ease-in-out infinite; }
        @keyframes wfPulse { 0%, 100% { background: #FEF08A; } 50% { background: #FDE047; outline: 3px solid #EAB308; } }
        .wf-btn-hairline { border: 1px solid ${C.border}; background: ${C.card}; color: ${C.text}; border-radius: 8px; padding: 8px 14px; font-size: 13px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: all 0.15s; }
        .wf-btn-hairline:hover { background: ${C.wash}; border-color: #D2CBC0; }
        .wf-btn-accent { border: 1px solid ${C.accent}; background: ${C.accent}; color: #FFFFFF; border-radius: 8px; padding: 8px 16px; font-size: 13px; font-weight: 800; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: all 0.15s; }
        .wf-btn-accent:hover { opacity: 0.92; }
        .wf-btn-accent:disabled { opacity: 0.5; cursor: not-allowed; }
        .wf-card-panel { background: ${C.card}; border: 1px solid ${C.border}; border-radius: 12px; }
        .wf-gutter-num { display: inline-block; width: 28px; color: ${C.subLight}; font-family: var(--mono); font-size: 11px; user-select: none; }
        .wf-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
        .wf-scrollbar::-webkit-scrollbar-thumb { background: #D5D0C6; border-radius: 4px; }

        @keyframes wfSpin { 100% { transform: rotate(360deg); } }
        .wf-spin { animation: wfSpin 0.9s linear infinite; }
        @keyframes wfSyncProgress {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(0%); }
          100% { transform: translateX(100%); }
        }
        .wf-sync-progress-line {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 3px;
          background: linear-gradient(90deg, #5B3DF5, #10B981, #5B3DF5);
          animation: wfSyncProgress 1.4s ease-in-out infinite;
          z-index: 1000;
        }

        @keyframes wfFloatInBottom {
          from {
            opacity: 0;
            transform: translateY(-6px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes wfFloatInTop {
          from {
            opacity: 0;
            transform: translateY(6px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        .wf-floating-card {
          font-family: var(--sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
          color: ${C.text};
          transition: opacity 0.15s cubic-bezier(0.16, 1, 0.3, 1), transform 0.15s cubic-bezier(0.16, 1, 0.3, 1);
          box-shadow: 0 16px 38px -6px rgba(26, 23, 38, 0.18), 0 4px 14px -2px rgba(26, 23, 38, 0.08);
          border-radius: 10px;
        }
        .wf-floating-card[data-placement="bottom"] {
          animation: wfFloatInBottom 0.18s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .wf-floating-card[data-placement="top"] {
          animation: wfFloatInTop 0.18s cubic-bezier(0.16, 1, 0.3, 1);
        }
      `}</style>

      {/* ========================================== */}
      {/* 1. TOP HEADER & TASK SWITCHER BAR          */}
      {/* ========================================== */}
      <header style={{ background: C.card, borderBottom: `1px solid ${C.border}`, padding: '14px 24px', position: 'sticky', top: 0, zIndex: 100 }}>
        {(actionStatus === 'saving_draft' || actionStatus === 'publishing') && (
          <div className="wf-sync-progress-line" />
        )}
        <div style={{ maxWidth: 1440, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          {/* Left: Task Switcher + Prompt Toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button
              onClick={() => setReviewQuiz && setReviewQuiz(null)}
              className="wf-btn-hairline"
              style={{ padding: '6px 12px', fontSize: 12 }}
            >
              <Ico name="arrowLeft" size={13} /> Back
            </button>

            <div style={{ display: 'flex', background: C.wash, padding: 3, borderRadius: 10, border: `1px solid ${C.border}` }}>
              {writingTasks.map(t => {
                const isActive = t.id === activeTaskId;
                const b = taskBand(t.id);
                return (
                  <button
                    key={t.id}
                    onClick={() => { setActiveTaskId(t.id); setSelectionBox(null); }}
                    style={{
                      padding: '6px 14px',
                      borderRadius: 8,
                      border: 'none',
                      background: isActive ? C.card : 'transparent',
                      color: isActive ? C.text : C.sub,
                      fontWeight: isActive ? 800 : 600,
                      fontSize: 13,
                      cursor: 'pointer',
                      boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <span>Task {t.taskNumber} ({t.taskNumber === 1 ? '1/3' : '2/3'})</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: b !== undefined ? C.succ : C.subLight, fontWeight: 700 }}>
                      {b !== undefined ? `Band ${b}` : '—'}
                    </span>
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => setPromptDrawerOpen(!promptDrawerOpen)}
              className="wf-btn-hairline"
              style={{ fontSize: 12, padding: '6px 12px' }}
            >
              <Ico name={promptDrawerOpen ? 'chevronUp' : 'chevronDown'} size={14} />
              {promptDrawerOpen ? tx('Ẩn đề bài & biểu đồ', 'Hide prompt & visual') : tx('Xem đề bài & biểu đồ', 'View prompt & visual')}
            </button>
          </div>

          {/* Right: Score Stamp + Action Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {/* Score Stamp */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '4px 12px', background: C.wash, border: `1px solid ${C.border}`, borderRadius: 10 }}>
              <div>
                <div style={{ fontSize: 9, fontWeight: 900, color: C.sub, letterSpacing: 0.6, textTransform: 'uppercase' }}>
                  {overallBandLabel}
                </div>
                <div style={{ fontFamily: 'var(--display)', fontSize: 24, lineHeight: 1, color: C.accent, fontWeight: 800 }}>
                  {calculatedFinalBand !== undefined ? calculatedFinalBand : (writingGrading.finalBand !== undefined ? writingGrading.finalBand : '—')}
                </div>
              </div>
              <div style={{ borderLeft: `1px solid ${C.border}`, paddingLeft: 10, fontSize: 11, color: C.sub, fontFamily: 'var(--mono)' }}>
                {writingTasks.length > 1 ? (
                  <>
                    T1: <strong>{t1Band !== undefined ? t1Band : '—'}</strong> · T2: <strong>{t2Band !== undefined ? t2Band : '—'}</strong>
                  </>
                ) : (
                  <>
                    Task {taskNumber}: <strong>{taskBand(activeTask.id) !== undefined ? taskBand(activeTask.id) : '—'}</strong>
                  </>
                )}
              </div>
            </div>

            {/* Export PDF Dossier */}
            <button
              onClick={exportPdfDossier}
              disabled={isExportingPdf}
              className="wf-btn-hairline"
              title={tx('Xuất báo cáo chi tiết chuẩn học thuật', 'Export academic evaluation dossier PDF')}
              style={{ opacity: isExportingPdf ? 0.7 : 1, cursor: isExportingPdf ? 'wait' : 'pointer' }}
            >
              <Ico name={isExportingPdf ? "loader" : "download"} size={14} className={isExportingPdf ? "wf-spin" : undefined} />
              {isExportingPdf ? tx('Đang tạo PDF...', 'Generating PDF...') : 'Dossier PDF'}
            </button>

            {/* Teacher Actions */}
            {isTeacher && (
              <>
                <button
                  onClick={runAiCoPilot}
                  className="wf-btn-hairline"
                  style={{ color: C.accent, borderColor: C.accentLine, background: C.accentWash }}
                  title={tx('Chấm nháp tự động 4 tiêu chí và chỉ lỗi chi tiết bằng AI', 'Auto-grade 4 criteria and extract line-by-line annotations via AI')}
                  disabled={actionStatus === 'saving_draft' || actionStatus === 'publishing'}
                >
                  <Ico name="sparkles" size={14} color={C.accent} /> AI Co-Pilot
                </button>
                <button
                  onClick={() => saveWritingGrade(false)}
                  className="wf-btn-hairline"
                  disabled={actionStatus === 'saving_draft' || actionStatus === 'publishing'}
                  style={{
                    opacity: (actionStatus === 'saving_draft' || actionStatus === 'publishing') ? 0.6 : 1,
                    cursor: (actionStatus === 'saving_draft' || actionStatus === 'publishing') ? 'not-allowed' : 'pointer',
                  }}
                >
                  {actionStatus === 'saving_draft' ? (
                    <>
                      <Ico name="loader" size={14} className="wf-spin" /> {tx('Đang lưu nháp...', 'Saving draft...')}
                    </>
                  ) : (
                    <>
                      <Ico name="save" size={14} /> {tx('Lưu nháp', 'Save draft')}
                    </>
                  )}
                </button>
                <button
                  onClick={() => saveWritingGrade(true)}
                  disabled={calculatedFinalBand === undefined || actionStatus === 'saving_draft' || actionStatus === 'publishing'}
                  className="wf-btn-accent"
                  style={{
                    opacity: (calculatedFinalBand === undefined || actionStatus === 'saving_draft' || actionStatus === 'publishing') ? 0.6 : 1,
                    cursor: (calculatedFinalBand === undefined || actionStatus === 'saving_draft' || actionStatus === 'publishing') ? 'not-allowed' : 'pointer',
                  }}
                >
                  {actionStatus === 'publishing' ? (
                    <>
                      <Ico name="loader" size={14} className="wf-spin" /> {tx('Đang publish...', 'Publishing...')}
                    </>
                  ) : (
                    <>
                      <Ico name="check" size={14} /> {tx('Publish cho học sinh', 'Publish to student')}
                    </>
                  )}
                </button>
              </>
            )}

            {!isTeacher && (
              <span style={{
                padding: '6px 10px',
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 800,
                background: studentCanSeeGrade ? C.succWash : C.warnWash,
                color: studentCanSeeGrade ? C.succ : C.warn,
                border: `1px solid ${studentCanSeeGrade ? C.succLine : C.warnLine}`,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
              }}>
                {studentCanSeeGrade ? (
                  <>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    {tx('Đã công bố kết quả', 'Results published')}
                  </>
                ) : (
                  tx('Đang chờ giáo viên chấm', 'Awaiting teacher grading')
                )}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Top Action Status Banner */}
      {actionStatus !== 'idle' && (
        <div style={{
          background: actionStatus === 'error' ? '#FEF2F2' : (actionStatus === 'saved_ok' || actionStatus === 'published_ok') ? '#F0FDF4' : '#EEF2FF',
          borderBottom: `1px solid ${actionStatus === 'error' ? '#FCA5A5' : (actionStatus === 'saved_ok' || actionStatus === 'published_ok') ? '#86EFAC' : '#C7D2FE'}`,
          color: actionStatus === 'error' ? '#991B1B' : (actionStatus === 'saved_ok' || actionStatus === 'published_ok') ? '#166534' : '#3730A3',
          padding: '8px 24px',
          fontSize: 12.5,
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          position: 'sticky',
          top: 57,
          zIndex: 99,
          boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, maxWidth: 1440, margin: '0 auto', width: '100%' }}>
            {(actionStatus === 'saving_draft' || actionStatus === 'publishing') && (
              <Ico name="loader" size={15} className="wf-spin" />
            )}
            {(actionStatus === 'saved_ok' || actionStatus === 'published_ok') && (
              <Ico name="checkBadge" size={16} color="#166534" />
            )}
            {actionStatus === 'error' && (
              <Ico name="alert" size={16} color="#991B1B" />
            )}
            <span>{statusMessage}</span>
            <button
              type="button"
              onClick={() => setActionStatus('idle')}
              aria-label={tx("Đóng thông báo", "Dismiss alert")}
              style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '2px 4px' }}
            >
              <Ico name="close" size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* 2. COLLAPSIBLE PROMPT & VISUAL DRAWER      */}
      {/* ========================================== */}
      <section
        style={{
          background: C.card,
          borderBottom: promptDrawerOpen ? `1px solid ${C.border}` : 'none',
          padding: promptDrawerOpen ? '18px 24px' : 0,
          height: promptDrawerOpen ? 'auto' : 0,
          overflow: 'hidden',
          opacity: promptDrawerOpen ? 1 : 0,
          pointerEvents: promptDrawerOpen ? 'auto' : 'none',
          transition: 'opacity 0.2s ease, padding 0.2s ease',
        }}
      >
        <div style={{ maxWidth: 1440, margin: '0 auto', display: 'grid', gridTemplateColumns: activeTaskChartUrl ? '1fr 340px' : '1fr', gap: 24, alignItems: 'start' }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 900, color: C.accent, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                Task {activeTask.taskNumber} Instructions & Prompt
              </div>
              <button
                type="button"
                onClick={() => setPromptDrawerOpen(false)}
                style={{ background: 'transparent', border: 'none', color: C.sub, cursor: 'pointer', fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                <Ico name="chevronUp" size={13} /> {tx('Thu gọn đề bài', 'Collapse prompt')}
              </button>
            </div>
            <h2 style={{ fontFamily: 'var(--display)', fontSize: 20, margin: '0 0 10px' }}>{activeTask.title}</h2>
            {activeTask.instructions && <p style={{ fontSize: 13, color: C.sub, lineHeight: 1.6, margin: '0 0 10px' }}>{activeTask.instructions}</p>}
            {activeTask.prompt && (
              <div
                dangerouslySetInnerHTML={{ __html: activeTask.prompt }}
                style={{ fontSize: 14, lineHeight: 1.65, color: C.text, padding: '12px 16px', background: C.wash, border: `1px solid ${C.border}`, borderRadius: 8 }}
              />
            )}
          </div>
          {activeTaskChartUrl && (
            <div
              style={{
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                padding: 8,
                background: '#fff',
                textAlign: 'center',
                position: 'relative',
                cursor: 'zoom-in',
                userSelect: 'none',
              }}
              role="button"
              tabIndex={0}
              title={tx('Bấm để phóng to hình ảnh đề bài', 'Click to zoom task graphic')}
              onClick={() => setIsChartZoomOpen(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setIsChartZoomOpen(true);
                }
              }}
            >
              <img
                data-wf-chart-img="true"
                referrerPolicy="no-referrer"
                src={normalizeChartUrl(activeTaskChartUrl)}
                alt={`Task ${activeTask.taskNumber} chart`}
                style={{ maxWidth: '100%', maxHeight: 280, objectFit: 'contain', display: 'block', margin: '0 auto' }}
              />
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 6, padding: '4px 10px', borderRadius: 6, background: C.wash, border: `1px solid ${C.border}`, fontSize: 11, fontWeight: 600, color: C.sub }}>
                <Ico name="zoomIn" size={13} />
                <span>{tx('Bấm để phóng to', 'Click to zoom')}</span>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ========================================== */}
      {/* 3. TWO-COLUMN SPLIT WORKSPACE              */}
      {/* ========================================== */}
      <main style={{ maxWidth: 1440, margin: '0 auto', padding: '24px 24px 60px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.25fr) minmax(380px, 0.95fr)', gap: 24, alignItems: 'start' }}>

          {/* ---------------------------------------- */}
          {/* LEFT COLUMN: THE MANUSCRIPT SHEET        */}
          {/* ---------------------------------------- */}
          <div className="wf-card-panel" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {/* View Mode Bar */}
            <div style={{ padding: '8px 14px', borderBottom: `1px solid ${C.border}`, background: C.wash, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, overflowX: 'auto', flexWrap: 'nowrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, whiteSpace: 'nowrap', flexWrap: 'nowrap' }}>
                <span style={{ fontSize: 10.5, fontWeight: 900, color: C.sub, textTransform: 'uppercase', letterSpacing: 0.5, marginRight: 2 }}>
                  {tx('Chế độ:', 'View:')}
                </span>
                <button
                  type="button"
                  onClick={() => setViewMode('annotated')}
                  className={`wf-tab-btn ${viewMode === 'annotated' ? 'active' : ''}`}
                  style={{ padding: '4px 8px', fontSize: 11.5, whiteSpace: 'nowrap' }}
                >
                  <Ico name="fileText" size={12} /> {tx('Bản gốc', 'Original')} ({activeTaskComments.length})
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('diff')}
                  className={`wf-tab-btn ${viewMode === 'diff' ? 'active' : ''}`}
                  style={{ padding: '4px 8px', fontSize: 11.5, whiteSpace: 'nowrap' }}
                >
                  <Ico name="diff" size={12} /> {tx('Sửa trực tiếp (Diff)', 'Track changes (Diff)')}
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('clean')}
                  className={`wf-tab-btn ${viewMode === 'clean' ? 'active' : ''}`}
                  style={{ padding: '4px 8px', fontSize: 11.5, whiteSpace: 'nowrap' }}
                >
                  <Ico name="check" size={12} /> {tx('Bản sửa hoàn chỉnh', 'Clean corrected')}
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('model')}
                  className={`wf-tab-btn ${viewMode === 'model' ? 'active' : ''}`}
                  style={{ padding: '4px 8px', fontSize: 11.5, whiteSpace: 'nowrap' }}
                >
                  <Ico name="book" size={12} /> {tx('Bài mẫu Band 8+', 'Band 8+ model')}
                </button>
              </div>

              {isTeacher && viewMode === 'annotated' && (
                <span style={{ fontSize: 11, color: C.sub, fontStyle: 'italic', flexShrink: 0, whiteSpace: 'nowrap' }}>
                  {tx('Bôi chọn để thêm nhận xét', 'Select text to add an annotation')}
                </span>
              )}
            </div>

            {/* Essay Sheet Content */}
            <div
              ref={essayContainerRef}
              onMouseUp={handleEssayMouseUp}
              className="wf-scrollbar"
              style={{
                padding: '24px 28px',
                minHeight: 480,
                maxHeight: 'calc(100vh - 280px)',
                overflowY: 'auto',
                lineHeight: 1.85,
                fontSize: 15,
                color: C.text,
                background: '#FFFFFF',
                position: 'relative',
              }}
            >
              {/* MODE 1: ANNOTATED ORIGINAL */}
              {viewMode === 'annotated' && (
                <div>
                  {!originalEssay.trim() ? (
                    <div style={{ color: C.subLight, fontStyle: 'italic', padding: '40px 0', textAlign: 'center' }}>
                      {tx('Thí sinh chưa nộp bài viết cho Task này.', 'No essay submitted for this task.')}
                    </div>
                  ) : (
                    <AnnotatedEssayRenderer
                      text={originalEssay}
                      accurateComments={accurateActiveComments}
                      hoveredCommentId={hoveredComment?.id || null}
                      pulseMarkId={pulseMarkId}
                      repRadarActive={repRadarActive}
                      repeatedWordsMap={repeatedWordsMap}
                      onHoverEnter={triggerHoverEnter}
                      onHoverLeave={triggerHoverLeave}
                    />
                  )}
                </div>
              )}

              {/* MODE 2: INLINE TRACK CHANGES (DIFF) */}
              {viewMode === 'diff' && (
                <div>
                  <DiffEssayRenderer
                    text={originalEssay}
                    accurateComments={accurateActiveComments}
                    hoveredCommentId={hoveredComment?.id || null}
                    onHoverEnter={triggerHoverEnter}
                    onHoverLeave={triggerHoverLeave}
                  />
                </div>
              )}

              {/* MODE 3: CLEAN CORRECTED ESSAY */}
              {viewMode === 'clean' && (
                <div>
                  {isTeacher ? (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: C.sub }}>
                          {tx('Soạn hoặc chỉnh sửa bài viết đã sửa hoàn chỉnh cho học sinh:', 'Compose or edit clean corrected essay for student:')}
                        </span>
                        <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: C.subLight }}>
                          {countWritingWords(writingGrading.correctedAnswers[activeTask.id] || '')} words
                        </span>
                      </div>
                      <textarea
                        value={writingGrading.correctedAnswers[activeTask.id] || ''}
                        onChange={e => updateWritingGrading({
                          correctedAnswers: { ...writingGrading.correctedAnswers, [activeTask.id]: e.target.value }
                        })}
                        placeholder={tx("Nhập hoặc dán bài viết đã sửa hoàn chỉnh (hoặc dùng AI Co-Pilot để tạo tự động)...", "Enter or paste clean corrected essay (or generate via AI Co-Pilot)...")}
                        rows={16}
                        style={{
                          width: '100%',
                          boxSizing: 'border-box',
                          padding: '16px',
                          borderRadius: 8,
                          border: `1px solid ${C.border}`,
                          fontSize: 14.5,
                          lineHeight: 1.8,
                          fontFamily: 'var(--sans)',
                          color: C.text,
                          background: C.wash,
                          resize: 'vertical',
                        }}
                      />
                    </div>
                  ) : (
                    <div>
                      {writingGrading.correctedAnswers[activeTask.id] ? (
                        <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.85, fontSize: 15 }}>
                          {writingGrading.correctedAnswers[activeTask.id]}
                        </div>
                      ) : (
                        <div style={{ color: C.subLight, fontStyle: 'italic', padding: '40px 0', textAlign: 'center' }}>
                          {tx('Giáo viên chưa đăng bản sửa hoàn chỉnh cho bài này.', 'Teacher has not published a corrected essay for this task yet.')}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* MODE 4: BAND 8+ MODEL ANSWER */}
              {viewMode === 'model' && (
                <div>
                  {isTeacher ? (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: C.sub }}>
                          {tx('Bài mẫu tham khảo Band 8.0+ cho Task này:', 'Band 8.0+ model answer for this task:')}
                        </span>
                        <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: C.subLight }}>
                          {countWritingWords(writingGrading.sampleAnswers?.[activeTask.id] || '')} words
                        </span>
                      </div>
                      <textarea
                        value={writingGrading.sampleAnswers?.[activeTask.id] || ''}
                        onChange={e => updateWritingGrading({
                          sampleAnswers: { ...writingGrading.sampleAnswers, [activeTask.id]: e.target.value }
                        })}
                        placeholder={tx("Nhập hoặc dán bài mẫu Band 8+...", "Enter or paste Band 8+ model essay...")}
                        rows={16}
                        style={{
                          width: '100%',
                          boxSizing: 'border-box',
                          padding: '16px',
                          borderRadius: 8,
                          border: `1px solid ${C.border}`,
                          fontSize: 14.5,
                          lineHeight: 1.8,
                          fontFamily: 'var(--sans)',
                          color: C.text,
                          background: C.wash,
                          resize: 'vertical',
                        }}
                      />
                    </div>
                  ) : (
                    <div>
                      {writingGrading.sampleAnswers?.[activeTask.id] ? (
                        <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.85, fontSize: 15 }}>
                          {writingGrading.sampleAnswers[activeTask.id]}
                        </div>
                      ) : (
                        <div style={{ color: C.subLight, fontStyle: 'italic', padding: '40px 0', textAlign: 'center' }}>
                          {tx('Chưa có bài mẫu tham khảo cho đề bài này.', 'No model answer provided for this task yet.')}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Bottom: 28px Hairline X-Ray Bar */}
            <footer style={{
              height: 34,
              borderTop: `1px solid ${C.border}`,
              background: C.wash,
              padding: '0 18px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: 12,
              fontFamily: 'var(--mono)',
              color: C.sub,
            }}>
              {/* Word Count Pill */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '2px 8px',
                  borderRadius: 999,
                  fontWeight: 700,
                  fontSize: 11,
                  background: essayStats.words >= targetWords ? C.succWash : C.warnWash,
                  color: essayStats.words >= targetWords ? C.succ : C.warn,
                  border: `1px solid ${essayStats.words >= targetWords ? C.succLine : C.warnLine}`,
                }}>
                  {essayStats.words >= targetWords ? (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  ) : (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                      <circle cx="12" cy="12" r="10"/>
                      <line x1="12" y1="8" x2="12" y2="12"/>
                      <line x1="12" y1="16" x2="12.01" y2="16"/>
                    </svg>
                  )}
                  <span>{essayStats.words} / {targetWords} {tx('từ', 'words')}</span>
                  {essayStats.words < targetWords && ` (-${targetWords - essayStats.words}w)`}
                </span>

                <span>{essayStats.paragraphs} {tx('đoạn', '¶')}</span>
                <span>{essayStats.sentences} {tx('câu', 'sentences')}</span>
                <span>{essayStats.avgWordsPerSentence} {tx('từ/câu', 'w/s')}</span>
              </div>

              {/* Repetition Radar Toggle */}
              <div>
                <button
                  onClick={() => setRepRadarActive(!repRadarActive)}
                  style={{
                    background: repRadarActive ? C.warnWash : 'transparent',
                    border: `1px solid ${repRadarActive ? C.warnLine : 'transparent'}`,
                    color: repRadarActive ? C.warn : C.sub,
                    fontSize: 11,
                    fontWeight: 700,
                    borderRadius: 6,
                    padding: '3px 8px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                  }}
                  title={tx('Tìm và gạch chân các từ ngữ dài xuất hiện lặp lại 3+ lần trong bài', 'Find and underline content words repeated 3+ times in the essay')}
                >
                  <Ico name="radar" size={13} color={repRadarActive ? C.warn : C.sub} />
                  {tx('Radar lặp từ', 'Repetition radar')} {repRadarActive ? 'ON' : 'OFF'}
                </button>
              </div>
            </footer>
          </div>

          {/* ---------------------------------------- */}
          {/* RIGHT COLUMN: EDITORIAL INSPECTOR        */}
          {/* ---------------------------------------- */}
          <div className="wf-card-panel" style={{ overflow: 'hidden' }}>
            {/* Tabs Header */}
            <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}`, background: C.wash }}>
              <button
                onClick={() => setActiveTab('rubric')}
                style={{
                  flex: 1,
                  padding: '12px 14px',
                  border: 'none',
                  background: activeTab === 'rubric' ? C.card : 'transparent',
                  color: activeTab === 'rubric' ? C.text : C.sub,
                  fontWeight: activeTab === 'rubric' ? 800 : 600,
                  fontSize: 13,
                  cursor: 'pointer',
                  borderBottom: activeTab === 'rubric' ? `2px solid ${C.accent}` : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                <span>{tx('4 Tiêu chí & Trọng tâm', '4 Criteria & Focus')}</span>
              </button>
              <button
                onClick={() => setActiveTab('annotations')}
                style={{
                  flex: 1,
                  padding: '12px 14px',
                  border: 'none',
                  background: activeTab === 'annotations' ? C.card : 'transparent',
                  color: activeTab === 'annotations' ? C.text : C.sub,
                  fontWeight: activeTab === 'annotations' ? 800 : 600,
                  fontSize: 13,
                  cursor: 'pointer',
                  borderBottom: activeTab === 'annotations' ? `2px solid ${C.accent}` : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                <span>{tx('Chú thích', 'Annotations')} ({activeTaskComments.length})</span>
              </button>
              <button
                onClick={() => setActiveTab('corrected')}
                style={{
                  flex: 1,
                  padding: '12px 14px',
                  border: 'none',
                  background: activeTab === 'corrected' ? C.card : 'transparent',
                  color: activeTab === 'corrected' ? C.text : C.sub,
                  fontWeight: activeTab === 'corrected' ? 800 : 600,
                  fontSize: 13,
                  cursor: 'pointer',
                  borderBottom: activeTab === 'corrected' ? `2px solid ${C.accent}` : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                <span>{tx('Bài sửa & Bài mẫu', 'Rewrites & Models')}</span>
              </button>
            </div>

            {/* Tab Body */}
            <div style={{ padding: '20px 22px', maxHeight: 'calc(100vh - 280px)', overflowY: 'auto' }} className="wf-scrollbar">
              {/* TAB 1: RUBRIC & BOTTLENECKS */}
              {activeTab === 'rubric' && (
                <div>
                  {/* Top 3 Bottlenecks Box */}
                  <div style={{
                    background: C.wash,
                    border: `1px solid ${C.border}`,
                    borderLeft: `4px solid ${C.warn}`,
                    borderRadius: 10,
                    padding: '14px 16px',
                    marginBottom: 20,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 900, color: C.warn, letterSpacing: 0.7, textTransform: 'uppercase' }}>
                        {tx('Top 3 Trọng tâm cần cải thiện (Bottlenecks)', 'Top 3 Priority Focus Areas (Bottlenecks)')}
                      </span>
                      {isTeacher && (
                        <button
                          onClick={() => {
                            const val = prompt(tx('Thêm trọng tâm cải thiện:', 'Add priority improvement focus:'));
                            if (val && val.trim()) {
                              updateTaskBottlenecks(activeTask.id, [...currentBottlenecks, val.trim()].slice(0, 3));
                            }
                          }}
                          style={{ fontSize: 11, background: 'transparent', border: 'none', color: C.accent, fontWeight: 700, cursor: 'pointer' }}
                        >
                          + {tx('Thêm', 'Add')}
                        </button>
                      )}
                    </div>

                    {currentBottlenecks.length === 0 ? (
                      <p style={{ fontSize: 12.5, color: C.sub, margin: 0, fontStyle: 'italic' }}>
                        {isTeacher ? tx('Chưa có mục trọng tâm. Dùng AI Co-Pilot để trích xuất tự động hoặc bấm + Thêm.', 'No focus areas yet. Use AI Co-Pilot to extract automatically or click + Add.') : tx('Chưa có ghi chú trọng tâm.', 'No priority notes.')}
                      </p>
                    ) : (
                      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6, color: C.text }}>
                        {currentBottlenecks.map((item, idx) => (
                          <li key={idx} style={{ marginBottom: 4 }}>
                            <span>{item}</span>
                            {isTeacher && (
                              <button
                                onClick={() => updateTaskBottlenecks(activeTask.id, currentBottlenecks.filter((_, i) => i !== idx))}
                                style={{ background: 'transparent', border: 'none', color: C.subLight, marginLeft: 6, cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', verticalAlign: 'middle' }}
                                title={tx("Xóa", "Delete")}
                                aria-label={tx("Xóa mục trọng tâm", "Delete priority focus item")}
                              >
                                <Ico name="close" size={11} />
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/* 4 Criteria Scores */}
                  <div style={{ display: 'grid', gap: 18 }}>
                    {(['TA_TR', 'CC', 'LR', 'GRA'] as const).map(critKey => {
                      const critMeta = CRITERION_LABELS[critKey];
                      const scoreKey = critMeta.scoreKey;
                      const critName = taskNumber === 1 ? critMeta.t1Name : critMeta.t2Name;
                      const currentVal = writingGrading.taskScores[activeTask.id]?.[scoreKey];
                      const currentNote = writingGrading.criteriaNotes?.[activeTask.id]?.[critKey] || '';
                      const roundedVal = Math.round(Number(currentVal || 6));
                      const descriptor = BAND_DESCRIPTORS[critKey][roundedVal] || '';

                      return (
                        <div key={critKey} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px', background: '#FFFFFF' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                            <span style={{ fontSize: 13, fontWeight: 800, color: C.text }}>{critName}</span>
                            <span style={{ fontFamily: 'var(--display)', fontSize: 20, color: currentVal !== undefined ? C.accent : C.subLight, fontWeight: 800 }}>
                              {currentVal !== undefined ? currentVal : '—'}
                            </span>
                          </div>

                          {/* Band Selector Strip */}
                          {isTeacher ? (
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
                              {[4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9].map(bandNum => {
                                const isSelected = Number(currentVal) === bandNum;
                                return (
                                  <button
                                    key={bandNum}
                                    onClick={() => updateTaskScore(activeTask.id, scoreKey, bandNum)}
                                    style={{
                                      padding: '4px 8px',
                                      borderRadius: 6,
                                      border: `1px solid ${isSelected ? C.accent : C.border}`,
                                      background: isSelected ? C.accent : C.wash,
                                      color: isSelected ? '#FFFFFF' : C.text,
                                      fontSize: 12,
                                      fontFamily: 'var(--mono)',
                                      fontWeight: isSelected ? 800 : 600,
                                      cursor: 'pointer',
                                    }}
                                  >
                                    {bandNum}
                                  </button>
                                );
                              })}
                            </div>
                          ) : null}

                          {/* Descriptor snippet */}
                          {descriptor && (
                            <div style={{ fontSize: 12, color: C.sub, lineHeight: 1.5, background: C.wash, padding: '8px 10px', borderRadius: 6, marginBottom: 8, fontStyle: 'italic' }}>
                              Band {roundedVal}: “{descriptor}”
                            </div>
                          )}

                          {/* Teacher Note Input */}
                          {isTeacher ? (
                            <input
                              type="text"
                              value={currentNote}
                              onChange={e => updateCriteriaNote(activeTask.id, critKey, e.target.value)}
                              placeholder={tx(`Ghi chú cho ${critMeta.short}...`, `Notes for ${critMeta.short}...`)}
                              style={{
                                width: '100%',
                                boxSizing: 'border-box',
                                padding: '6px 10px',
                                borderRadius: 6,
                                border: `1px solid ${C.border}`,
                                fontSize: 12,
                                color: C.text,
                                background: '#FFF',
                              }}
                            />
                          ) : (
                            currentNote && (
                              <div style={{ fontSize: 12.5, color: C.text, lineHeight: 1.5, marginTop: 4 }}>
                                <strong>{tx('Nhận xét:', 'Feedback:')}</strong> {currentNote}
                              </div>
                            )
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* TAB 2: ANNOTATIONS LIST */}
              {activeTab === 'annotations' && (
                <div>
                  {/* Filters Bar */}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
                    {['ALL', 'TA_TR', 'CC', 'LR', 'GRA'].map(cKey => (
                      <button
                        key={cKey}
                        onClick={() => setFilterCriterion(cKey)}
                        style={{
                          padding: '4px 9px',
                          borderRadius: 6,
                          fontSize: 11,
                          fontFamily: 'var(--mono)',
                          fontWeight: 700,
                          border: `1px solid ${filterCriterion === cKey ? C.accent : C.border}`,
                          background: filterCriterion === cKey ? C.accent : C.card,
                          color: filterCriterion === cKey ? '#fff' : C.sub,
                          cursor: 'pointer',
                        }}
                      >
                        {cKey === 'TA_TR' ? (taskNumber === 1 ? 'TA' : 'TR') : cKey}
                      </button>
                    ))}
                  </div>

                  {filteredComments.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '40px 0', color: C.subLight, fontStyle: 'italic', fontSize: 13 }}>
                      {tx('Không có chú thích nào phù hợp bộ lọc.', 'No annotations match the filter.')}
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gap: 10 }}>
                      {filteredComments.map((item) => {
                        const comment = item.comment;
                        const catMeta = CATEGORY_META[comment.category || 'error'];
                        return (
                          <div
                            key={comment.id}
                            onClick={() => {
                              setPulseMarkId(comment.id);
                              setTimeout(() => setPulseMarkId(null), 1500);
                            }}
                            style={{
                              padding: '12px 14px',
                              background: '#FFFFFF',
                              border: `1px solid ${C.border}`,
                              borderLeft: `4px solid ${catMeta.color}`,
                              borderRadius: 8,
                              cursor: 'pointer',
                              transition: 'all 0.15s',
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 800, color: C.accent }}>
                                  [{item.displayIndex}]
                                </span>
                                <span style={{
                                  padding: '2px 6px',
                                  borderRadius: 4,
                                  fontSize: 10,
                                  fontFamily: 'var(--mono)',
                                  fontWeight: 800,
                                  background: C.wash,
                                  color: C.accent,
                                }}>
                                  {comment.criterion || 'GRA'}
                                </span>
                                <span style={{ fontSize: 11, fontWeight: 700, color: catMeta.color }}>
                                  {isVi ? catMeta.label : catMeta.enLabel}
                                </span>
                              </div>

                              {isTeacher && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    updateWritingGrading({
                                      comments: writingGrading.comments.filter(c => c.id !== comment.id),
                                    });
                                  }}
                                  style={{ background: 'transparent', border: 'none', color: C.subLight, cursor: 'pointer', padding: 2 }}
                                  title={tx("Xóa nhận xét", "Delete annotation")}
                                >
                                  <Ico name="trash" size={13} />
                                </button>
                              )}
                            </div>

                            {/* Anchor & Replacement */}
                            {comment.anchorQuote && (
                              <div style={{ fontSize: 13, marginBottom: 4 }}>
                                <span style={{ textDecoration: 'line-through', color: C.err, opacity: 0.85, marginRight: 6 }}>
                                  {comment.anchorQuote}
                                </span>
                                {comment.replacement && (
                                  <span style={{ fontWeight: 800, color: C.succ }}>
                                    → {comment.replacement}
                                  </span>
                                )}
                              </div>
                            )}

                            {/* Teacher Explanation */}
                            <div style={{ fontSize: 13, color: C.text, lineHeight: 1.5 }}>
                              {comment.comment}
                            </div>

                            {/* Tags */}
                            {comment.tags && comment.tags.length > 0 && (
                              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                                {comment.tags.map((t, ti) => (
                                  <span key={ti} style={{ fontSize: 10, padding: '1px 5px', borderRadius: 4, background: C.wash, color: C.sub, border: `1px solid ${C.borderLight}` }}>
                                    {formatTag(t, isVi)}
                                  </span>
                                ))}
                              </div>
                            )}

                            {/* Student Save Vocab Button */}
                            {!isTeacher && comment.replacement && (
                              <div style={{ marginTop: 8 }}>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleSaveToVocab(comment.replacement!, comment.comment, comment.anchorQuote || '');
                                  }}
                                  style={{
                                    background: C.wash,
                                    border: `1px solid ${C.border}`,
                                    color: C.accent,
                                    fontSize: 11,
                                    fontWeight: 700,
                                    padding: '3px 8px',
                                    borderRadius: 6,
                                    cursor: 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 4,
                                  }}
                                >
                                  <Ico name="plus" size={11} color={C.accent} /> {tx('Lưu vào Sổ từ vựng', 'Save to Vocab')}
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: CORRECTED & MODEL ESSAY */}
              {activeTab === 'corrected' && (
                <div style={{ display: 'grid', gap: 20 }}>
                  {/* General Feedback Box */}
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 800, color: C.sub, textTransform: 'uppercase', marginBottom: 6 }}>
                      {tx('Nhận xét chung toàn bài (General Feedback)', 'Teacher General Feedback')}
                    </label>
                    {isTeacher ? (
                      <textarea
                        value={writingGrading.generalFeedback || ''}
                        onChange={e => updateWritingGrading({ generalFeedback: e.target.value })}
                        placeholder={tx("Nhận xét tổng quan điểm mạnh, điểm cần lưu ý và lời khuyên chung cho học sinh...", "Overall strengths, key weaknesses, and actionable recommendations for the student...")}
                        rows={4}
                        style={{
                          width: '100%',
                          boxSizing: 'border-box',
                          padding: '10px 12px',
                          borderRadius: 8,
                          border: `1px solid ${C.border}`,
                          fontSize: 13.5,
                          lineHeight: 1.6,
                          fontFamily: 'var(--sans)',
                          color: C.text,
                        }}
                      />
                    ) : (
                      <div style={{
                        padding: '12px 14px',
                        background: C.wash,
                        borderRadius: 8,
                        border: `1px solid ${C.border}`,
                        fontSize: 13.5,
                        lineHeight: 1.6,
                        color: C.text,
                      }}>
                        {writingGrading.generalFeedback || tx('Chưa có nhận xét chung.', 'No general feedback yet.')}
                      </div>
                    )}
                  </div>

                  {/* Clean Corrected Preview */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color: C.sub, textTransform: 'uppercase' }}>
                        {tx('Bản sửa hoàn chỉnh', 'Clean corrected')} (Task {activeTask.taskNumber})
                      </span>
                      <button
                        onClick={() => setViewMode('clean')}
                        style={{ fontSize: 11, background: 'transparent', border: 'none', color: C.accent, fontWeight: 700, cursor: 'pointer' }}
                      >
                        {tx('Mở toàn màn hình →', 'Full view →')}
                      </button>
                    </div>
                    <div style={{
                      padding: '12px 14px',
                      background: '#FFFFFF',
                      borderRadius: 8,
                      border: `1px solid ${C.border}`,
                      fontSize: 13,
                      lineHeight: 1.7,
                      maxHeight: 180,
                      overflowY: 'auto',
                      whiteSpace: 'pre-wrap',
                      color: C.text,
                    }}>
                      {writingGrading.correctedAnswers[activeTask.id] || tx('(Chưa có bản sửa)', '(No corrected version)')}
                    </div>
                  </div>

                  {/* Sample Model Preview */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color: C.sub, textTransform: 'uppercase' }}>
                        {tx('Bài mẫu Band 8+', 'Band 8+ model')} (Task {activeTask.taskNumber})
                      </span>
                      <button
                        onClick={() => setViewMode('model')}
                        style={{ fontSize: 11, background: 'transparent', border: 'none', color: C.accent, fontWeight: 700, cursor: 'pointer' }}
                      >
                        {tx('Mở toàn màn hình →', 'Full view →')}
                      </button>
                    </div>
                    <div style={{
                      padding: '12px 14px',
                      background: '#FFFFFF',
                      borderRadius: 8,
                      border: `1px solid ${C.border}`,
                      fontSize: 13,
                      lineHeight: 1.7,
                      maxHeight: 180,
                      overflowY: 'auto',
                      whiteSpace: 'pre-wrap',
                      color: C.text,
                    }}>
                      {writingGrading.sampleAnswers?.[activeTask.id] || tx('(Chưa có bài mẫu)', '(No model answer)')}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* ========================================== */}
      {/* 4. HOVER FLOATING ANNOTATION POPOVER CARD  */}
      {/* ========================================== */}
      <FloatingCardPortal
        isOpen={Boolean(hoveredComment && hoverAnchorRect)}
        anchorRect={hoverAnchorRect}
        fallbackWidth={360}
        fallbackHeight={220}
        onMouseEnter={cancelHoverLeave}
        onMouseLeave={triggerHoverLeave}
      >
        {(_placement, _arrowLeft) => {
          if (!hoveredComment) return null;
          const cat = hoveredComment.category || 'error';
          const meta = CATEGORY_META[cat];
          const critLabel = hoveredComment.criterion === 'TA_TR' ? (taskNumber === 1 ? 'TA' : 'TR') : (hoveredComment.criterion || 'GRA');

          return (
            <div
              style={{
                width: 360,
                maxWidth: 'calc(100vw - 28px)',
                maxHeight: 'calc(100vh - 32px)',
                overflowY: 'auto',
                background: '#FFFFFF',
                border: `1px solid ${C.border}`,
                borderLeft: `4px solid ${meta.color}`,
                borderRadius: 10,
                padding: '12px 14px',
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{
                    padding: '2px 6px',
                    borderRadius: 4,
                    fontSize: 10,
                    fontFamily: 'var(--mono)',
                    fontWeight: 800,
                    background: C.wash,
                    color: C.accent,
                  }}>
                    {critLabel}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: meta.color }}>
                    {isVi ? meta.label : meta.enLabel}
                  </span>
                </div>

                {isTeacher && (
                  <button
                    onClick={() => {
                      updateWritingGrading({
                        comments: writingGrading.comments.filter(c => c.id !== hoveredComment.id),
                      });
                      setHoveredComment(null);
                      setHoverAnchorRect(null);
                    }}
                    style={{ background: 'transparent', border: 'none', color: C.subLight, cursor: 'pointer', padding: 2 }}
                    title={tx("Xóa nhận xét", "Delete annotation")}
                  >
                    <Ico name="trash" size={13} />
                  </button>
                )}
              </div>

              {/* Diff Row */}
              {hoveredComment.anchorQuote && (
                <div style={{ marginBottom: 6, paddingBottom: 6, borderBottom: `1px solid ${C.borderLight}` }}>
                  <span style={{ textDecoration: 'line-through', color: C.err, opacity: 0.8, marginRight: 6 }}>
                    {hoveredComment.anchorQuote}
                  </span>
                  {hoveredComment.replacement && (
                    <span style={{ fontWeight: 800, color: C.succ }}>
                      → {hoveredComment.replacement}
                    </span>
                  )}
                </div>
              )}

              {/* High-Band Rewrite Callout */}
              {hoveredComment.highBandRewrite && (
                <div style={{
                  background: '#EEF2FF',
                  borderLeft: `2px solid ${C.accent}`,
                  padding: '6px 8px',
                  borderRadius: 4,
                  fontSize: 12,
                  marginBottom: 6,
                  color: '#3730A3',
                }}>
                  <strong>Band 8.0+ Rewrite:</strong> {hoveredComment.highBandRewrite}
                </div>
              )}

              {/* Explanation */}
              <div style={{ color: C.text, marginBottom: 8 }}>
                {hoveredComment.comment}
              </div>

              {/* Tags */}
              {hoveredComment.tags && hoveredComment.tags.length > 0 && (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                  {hoveredComment.tags.map((t, ti) => (
                    <span key={ti} style={{ fontSize: 10, padding: '1px 5px', borderRadius: 4, background: C.wash, color: C.sub }}>
                      {formatTag(t, isVi)}
                    </span>
                  ))}
                </div>
              )}

              {/* Student Save to Vocab Button */}
              {!isTeacher && hoveredComment.replacement && (
                <button
                  onClick={() => handleSaveToVocab(hoveredComment.replacement!, hoveredComment.comment, hoveredComment.anchorQuote || '')}
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    borderRadius: 6,
                    border: `1px solid ${C.accentLine}`,
                    background: C.accentWash,
                    color: C.accent,
                    fontWeight: 700,
                    fontSize: 12,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 5,
                  }}
                >
                  <Ico name="plus" size={12} color={C.accent} /> {tx('Lưu cụm từ vào Sổ từ vựng', 'Save phrase to Vocabulary Notebook')}
                </button>
              )}
            </div>
          );
        }}
      </FloatingCardPortal>

      {/* ========================================== */}
      {/* 5. TEACHER 2-STAGE SELECTION POPOVER       */}
      {/* ========================================== */}
      <FloatingCardPortal
        isOpen={Boolean(selectionBox && isTeacher)}
        anchorRect={selectionBox?.rect || null}
        fallbackWidth={selectionBox?.stage === 1 ? 380 : 380}
        fallbackHeight={selectionBox?.stage === 1 ? 46 : 460}
        preferPlacement={selectionBox?.stage === 1 ? 'top' : undefined}
      >
        {(_placement, _arrowLeft) => {
          if (!selectionBox || !isTeacher) return null;
          const isStage1 = selectionBox.stage === 1;

          return (
            <div
              style={{
                width: isStage1 ? 'auto' : 380,
                maxWidth: 'calc(100vw - 28px)',
                maxHeight: 'calc(100vh - 32px)',
                overflowY: 'auto',
                background: '#FFFFFF',
                border: `1px solid ${C.border}`,
                borderRadius: 10,
                padding: isStage1 ? '5px 8px' : '14px 16px',
                boxSizing: 'border-box',
              }}
            >
              {/* STAGE 1: COMPACT FLOATING PILL */}
              {isStage1 ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                  <button
                    type="button"
                    onClick={() => setSelectionBox({ ...selectionBox, stage: 2, category: 'error', criterion: 'GRA' })}
                    style={{ padding: '4px 8px', borderRadius: 6, border: 'none', background: '#FEF2F2', color: C.err, fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}
                  >
                    {tx('Lỗi sai', 'Correction')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectionBox({ ...selectionBox, stage: 2, category: 'awkward', criterion: 'LR' })}
                    style={{ padding: '4px 8px', borderRadius: 6, border: 'none', background: '#FFFBEB', color: C.warn, fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}
                  >
                    {tx('Chưa tự nhiên', 'Less Natural')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectionBox({ ...selectionBox, stage: 2, category: 'upgrade', criterion: 'LR' })}
                    style={{ padding: '4px 8px', borderRadius: 6, border: 'none', background: '#EEF2FF', color: C.accent, fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}
                  >
                    {tx('Nâng cấp', 'Upgrade')}
                  </button>
                  <div style={{ width: 1, height: 16, background: C.border, margin: '0 2px' }} />
                  <button
                    type="button"
                    disabled={aiCritiqueLoading}
                    onClick={() => runSelectionAiCritique(false)}
                    style={{ padding: '4px 8px', borderRadius: 6, border: `1px solid ${C.accentLine}`, background: C.accentWash, color: C.accent, fontSize: 11.5, fontWeight: 700, cursor: aiCritiqueLoading ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                    title={tx("AI phân tích lỗi, gợi ý sửa và viết giải thích", "AI analyzes error, suggests replacement, and explains")}
                  >
                    <Ico name="sparkles" size={12} color={C.accent} />
                    {aiCritiqueLoading ? tx('Đang hỏi AI...', 'Querying AI...') : tx('AI Sửa', 'AI Critique')}
                  </button>
                  <button
                    type="button"
                    disabled={aiCritiqueLoading}
                    onClick={() => runSelectionAiCritique(true)}
                    style={{ padding: '4px 8px', borderRadius: 6, border: `1px solid ${C.succLine}`, background: C.succWash, color: C.succ, fontSize: 11.5, fontWeight: 700, cursor: aiCritiqueLoading ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                    title={tx("AI tự sửa và lưu nhận xét ngay", "AI critique & auto-save annotation")}
                  >
                    <Ico name="check" size={12} color={C.succ} />
                    {tx('Lưu ngay', 'Auto-save')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectionBox(null)}
                    style={{ padding: '4px 6px', background: 'transparent', border: 'none', color: C.subLight, cursor: 'pointer' }}
                  >
                    <Ico name="close" size={13} />
                  </button>
                </div>
              ) : (
                /* STAGE 2: COMPACT POPOVER COMPOSER */
                <div style={{ display: 'grid', gap: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color: C.text }}>{tx('Thêm nhận xét đoạn đã chọn', 'Add annotation for selection')}</span>
                      {aiCritiqueLoading && (
                        <span style={{ fontSize: 10.5, color: C.accent, fontWeight: 700 }}>
                          {tx('Đang phân tích...', 'Analyzing...')}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectionBox(null)}
                      style={{ background: 'transparent', border: 'none', color: C.subLight, cursor: 'pointer', padding: 0 }}
                    >
                      <Ico name="close" size={14} />
                    </button>
                  </div>

                  {/* AI Auto-Critique Action Strip */}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      disabled={aiCritiqueLoading}
                      onClick={() => runSelectionAiCritique(false)}
                      style={{
                        flex: 1,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 5,
                        padding: '5px 8px',
                        borderRadius: 6,
                        border: `1px solid ${C.accentLine}`,
                        background: C.accentWash,
                        color: C.accent,
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: aiCritiqueLoading ? 'wait' : 'pointer',
                      }}
                    >
                      <Ico name="sparkles" size={12} color={C.accent} />
                      {aiCritiqueLoading ? tx('AI đang phân tích...', 'Analyzing...') : tx('AI Phân tích lại', 'AI Re-analyze')}
                    </button>
                    <button
                      type="button"
                      disabled={aiCritiqueLoading}
                      onClick={() => runSelectionAiCritique(true)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '5px 8px',
                        borderRadius: 6,
                        border: `1px solid ${C.succLine}`,
                        background: C.succWash,
                        color: C.succ,
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: aiCritiqueLoading ? 'wait' : 'pointer',
                      }}
                      title={tx("AI phân tích và tự động lưu vào bài chấm ngay", "AI critique & save immediately")}
                    >
                      <Ico name="check" size={12} color={C.succ} />
                      {tx('AI Lưu ngay', 'AI Quick Save')}
                    </button>
                  </div>

                  {/* Criterion Selector */}
                  <div style={{ display: 'flex', gap: 4 }}>
                    {(['GRA', 'LR', 'CC', 'TA_TR'] as const).map(crit => {
                      const label = crit === 'TA_TR' ? (taskNumber === 1 ? 'TA' : 'TR') : crit;
                      return (
                        <button
                          key={crit}
                          type="button"
                          onClick={() => setSelectionBox({ ...selectionBox, criterion: crit })}
                          style={{
                            flex: 1,
                            padding: '4px 0',
                            borderRadius: 6,
                            fontSize: 11,
                            fontFamily: 'var(--mono)',
                            fontWeight: 800,
                            border: `1px solid ${selectionBox.criterion === crit ? C.accent : C.border}`,
                            background: selectionBox.criterion === crit ? C.accent : C.wash,
                            color: selectionBox.criterion === crit ? '#fff' : C.sub,
                            cursor: 'pointer',
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Category Selector */}
                  <div style={{ display: 'flex', gap: 4 }}>
                    {(['error', 'awkward', 'upgrade', 'praise'] as const).map(cat => {
                      const meta = CATEGORY_META[cat];
                      const isSel = selectionBox.category === cat;
                      return (
                        <button
                          key={cat}
                          onClick={() => setSelectionBox({ ...selectionBox, category: cat })}
                          style={{
                            flex: 1,
                            padding: '4px 0',
                            borderRadius: 6,
                            fontSize: 10.5,
                            fontWeight: 700,
                            border: `1px solid ${isSel ? meta.color : C.border}`,
                            background: isSel ? meta.bg : C.wash,
                            color: isSel ? meta.color : C.sub,
                            cursor: 'pointer',
                          }}
                        >
                          {cat === 'error' ? tx('Lỗi sai', 'Correction') : cat === 'awkward' ? tx('Chưa tự nhiên', 'Less Natural') : cat === 'upgrade' ? tx('Nâng band', 'Upgrade') : tx('Điểm sáng', 'Praise')}
                        </button>
                      );
                    })}
                  </div>

                  {/* Replacement input */}
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: C.sub, marginBottom: 3 }}>
                      {tx('Sửa thành (Suggested Replacement):', 'Suggested Replacement:')}
                    </label>
                    <input
                      type="text"
                      value={selectionBox.replacement}
                      onChange={e => setSelectionBox({ ...selectionBox, replacement: e.target.value })}
                      style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 13 }}
                    />
                  </div>

                  {/* Band 8 Rewrite Toggle */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <label style={{ fontSize: 11, fontWeight: 700, color: C.sub }}>{tx('Gợi ý Band 8+ (tùy chọn):', 'Band 8+ phrasing (optional):')}</label>
                      <button
                        onClick={() => setSelectionBox({ ...selectionBox, showRewrite: !selectionBox.showRewrite })}
                        style={{ fontSize: 11, background: 'transparent', border: 'none', color: C.accent, fontWeight: 700, cursor: 'pointer' }}
                      >
                        {selectionBox.showRewrite ? tx('Ẩn', 'Hide') : `+ ${tx('Thêm', 'Add')}`}
                      </button>
                    </div>
                    {selectionBox.showRewrite && (
                      <input
                        type="text"
                        value={selectionBox.highBandRewrite}
                        onChange={e => setSelectionBox({ ...selectionBox, highBandRewrite: e.target.value })}
                        placeholder="Band 8.0+ alternative phrasing..."
                        style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 13, marginTop: 4 }}
                      />
                    )}
                  </div>

                  {/* Quick Tag Chips */}
                  <div>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: C.subLight, display: 'block', marginBottom: 4 }}>
                      {tx('Gắn nhanh thẻ lỗi:', 'Quick Tags:')}
                    </span>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {QUICK_TAGS[selectionBox.criterion]?.map((tag, ti) => {
                        const hasTag = selectionBox.tags.includes(tag);
                        return (
                          <button
                            key={ti}
                            onClick={() => {
                              const nextTags = hasTag
                                ? selectionBox.tags.filter(t => t !== tag)
                                : [...selectionBox.tags, tag];
                              setSelectionBox({ ...selectionBox, tags: nextTags });
                            }}
                            style={{
                              fontSize: 10,
                              padding: '2px 6px',
                              borderRadius: 4,
                              border: `1px solid ${hasTag ? C.accent : C.border}`,
                              background: hasTag ? C.accentWash : C.wash,
                              color: hasTag ? C.accent : C.sub,
                              cursor: 'pointer',
                            }}
                          >
                            {formatTag(tag, isVi)}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Explanation input */}
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: C.sub, marginBottom: 3 }}>
                      {tx('Giải thích / Lời khuyên:', 'Explanation / Advice:')}
                    </label>
                    <textarea
                      value={selectionBox.comment}
                      onChange={e => setSelectionBox({ ...selectionBox, comment: e.target.value })}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                          handleSaveSelectionComment();
                        }
                      }}
                      placeholder={tx("Giải thích ngắn vì sao cần sửa hoặc cách dùng đúng...", "Brief explanation of why to correct or proper usage...")}
                      rows={3}
                      style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 13 }}
                    />
                  </div>

                  {/* Action Buttons */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 4 }}>
                    <button
                      onClick={() => setSelectionBox(null)}
                      className="wf-btn-hairline"
                      style={{ padding: '6px 10px', fontSize: 12 }}
                    >
                      {tx('Hủy', 'Cancel')}
                    </button>
                    <button
                      onClick={handleSaveSelectionComment}
                      disabled={!selectionBox.comment.trim()}
                      className="wf-btn-accent"
                      style={{ padding: '6px 12px', fontSize: 12 }}
                    >
                      {tx('Lưu nhận xét', 'Save annotation')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        }}
      </FloatingCardPortal>

      {/* ========================================== */}
      {/* 6. AI CO-PILOT MODAL & DRAFT PREVIEW       */}
      {/* ========================================== */}
      {aiModal.open && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.45)',
          backdropFilter: 'blur(3px)',
          zIndex: 2000,
          display: 'grid',
          placeItems: 'center',
          padding: 20,
        }}>
          <div style={{
            background: '#FFFFFF',
            border: `1px solid ${C.border}`,
            borderRadius: 14,
            maxWidth: 680,
            width: '100%',
            maxHeight: '90vh',
            overflowY: 'auto',
            padding: '24px 28px',
            boxShadow: '0 20px 48px rgba(0,0,0,0.2)',
          }} className="wf-scrollbar">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Ico name="sparkles" size={20} color={C.accent} />
                <h3 style={{ margin: 0, fontFamily: 'var(--display)', fontSize: 20 }}>
                  IELTS AI Co-Pilot · Task {activeTask.taskNumber}
                </h3>
              </div>
              {!aiModal.loading && (
                <button onClick={() => setAiModal({ ...aiModal, open: false })} style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}>
                  <Ico name="close" size={16} />
                </button>
              )}
            </div>

            {aiModal.loading ? (
              <div style={{ padding: '40px 0', textAlign: 'center' }}>
                <div style={{
                  width: '60%',
                  height: 3,
                  background: C.wash,
                  borderRadius: 999,
                  margin: '0 auto 16px',
                  overflow: 'hidden',
                  position: 'relative',
                }}>
                  <div style={{
                    position: 'absolute',
                    inset: 0,
                    width: '40%',
                    background: C.accent,
                    borderRadius: 999,
                    animation: 'wfSlide 1.2s infinite ease-in-out',
                  }} />
                </div>
                <style>{`@keyframes wfSlide { 0% { transform: translateX(-100%); } 100% { transform: translateX(300%); } }`}</style>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{tx('Đang phân tích bài thi theo 4 tiêu chí chuẩn IELTS...', 'Analyzing essay across 4 IELTS criteria...')}</div>
                <div style={{ fontSize: 12, color: C.sub, marginTop: 4 }}>{tx('Trích xuất điểm số, lỗi ngữ pháp/từ vựng và viết bài mẫu Band 8.5', 'Extracting scores, grammatical/lexical annotations, and drafting Band 8.5 model')}</div>
              </div>
            ) : aiModal.error ? (
              <div style={{ padding: '20px 0' }}>
                <div style={{ color: C.err, fontSize: 14, marginBottom: 16 }}>{aiModal.error}</div>
                <button onClick={runAiCoPilot} className="wf-btn-hairline">
                  <Ico name="refresh" size={14} /> {tx('Thử lại', 'Retry')}
                </button>
              </div>
            ) : aiModal.data ? (
              <div style={{ display: 'grid', gap: 16 }}>
                {/* Score Preview */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: C.wash, padding: '12px 16px', borderRadius: 10, border: `1px solid ${C.border}` }}>
                  <div>
                    <span style={{ fontSize: 11, fontWeight: 800, color: C.sub, textTransform: 'uppercase' }}>{tx(`Ước tính Band Task ${activeTask.taskNumber}`, `Estimated Band Task ${activeTask.taskNumber}`)}</span>
                    <div style={{ fontFamily: 'var(--display)', fontSize: 32, fontWeight: 800, color: C.accent, lineHeight: 1, marginTop: 4 }}>
                      Band {aiModal.data.estimated_task_band}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 12, fontSize: 12, fontFamily: 'var(--mono)' }}>
                    <span>TA: <strong>{aiModal.data.criteria?.TA_TR?.band ?? '—'}</strong></span>
                    <span>CC: <strong>{aiModal.data.criteria?.CC?.band ?? '—'}</strong></span>
                    <span>LR: <strong>{aiModal.data.criteria?.LR?.band ?? '—'}</strong></span>
                    <span>GRA: <strong>{aiModal.data.criteria?.GRA?.band ?? '—'}</strong></span>
                  </div>
                </div>

                {/* Bottlenecks Preview */}
                {aiModal.data.bottlenecks && aiModal.data.bottlenecks.length > 0 && (
                  <div style={{ background: C.warnWash, borderLeft: `3px solid ${C.warn}`, padding: '10px 14px', borderRadius: 6 }}>
                    <strong style={{ fontSize: 12, color: C.warn }}>{tx('3 Trọng tâm cần khắc phục:', 'Top 3 Areas for Improvement:')}</strong>
                    <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12.5, lineHeight: 1.5, color: C.text }}>
                      {aiModal.data.bottlenecks.map((b: string, i: number) => <li key={i}>{b}</li>)}
                    </ul>
                  </div>
                )}

                {/* Annotations Count */}
                <div style={{ fontSize: 13, color: C.sub, display: 'grid', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#15803D" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    <span>{tx('Phát hiện', 'Detected')} <strong>{aiModal.data.annotations?.length || 0} {tx('chú thích lỗi/nâng cấp', 'annotations')}</strong> {tx('bám sát văn bản bài viết.', 'anchored to essay text.')}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#15803D" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    <span>{tx('Đã tạo sẵn', 'Generated')} <strong>{tx('Bản sửa hoàn chỉnh', 'Clean corrected essay')}</strong> {tx('và', 'and')} <strong>{tx('Bài mẫu Band 8.5', 'Band 8.5 Model Answer')}</strong>.</span>
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10, borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
                  <button onClick={() => setAiModal({ ...aiModal, open: false })} className="wf-btn-hairline">
                    {tx('Đóng', 'Close')}
                  </button>
                  <button onClick={applyAiDraft} className="wf-btn-accent">
                    <Ico name="check" size={14} /> {tx('Áp dụng vào bài chấm', 'Apply to Grading Desk')}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* 7. TOAST NOTIFICATION                      */}
      {/* ========================================== */}
      {vocabToast && (
        <div style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          background: '#1A1726',
          color: '#FFFFFF',
          padding: '10px 16px',
          borderRadius: 8,
          fontSize: 13,
          fontWeight: 700,
          boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
          zIndex: 3000,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#22C55E" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          <span>{vocabToast}</span>
        </div>
      )}

      {/* ========================================== */}
      {/* 8. PRINT-GRADE VECTOR PDF DOSSIER MODAL    */}
      {/* ========================================== */}
      {isExportingPdf && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 99999,
            background: 'rgba(250, 248, 245, 0.94)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 14,
          }}
        >
          <div style={{
            background: '#FFFFFF',
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            padding: '24px 32px',
            boxShadow: '0 16px 40px rgba(0,0,0,0.12)',
            textAlign: 'center',
            maxWidth: 420,
          }}>
            <Ico name="loader" size={28} className="wf-spin" color={C.accent} style={{ marginBottom: 12 }} />
            <div style={{ fontFamily: 'Georgia, serif', fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 6 }}>
              {tx('Đang chuẩn bị Vector PDF Dossier...', 'Preparing Vector PDF Dossier...')}
            </div>
            <div style={{ fontSize: 12.5, color: C.sub, lineHeight: 1.5 }}>
              {tx('Hệ thống đang chuẩn bị tài liệu vector độ nét cao và gọi hộp thoại in của trình duyệt. Bạn có thể chọn', 'Generating high-fidelity print document and launching system print dialog. You can select')} <strong>{tx('Save as PDF (Lưu dưới dạng PDF)', 'Save as PDF')}</strong>.
            </div>
          </div>
        </div>
      )}

      {/* Task 1 Chart Lightbox Modal */}
      {isChartZoomOpen && activeTaskChartUrl && typeof document !== 'undefined' && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label={tx('Phóng to hình ảnh đề bài', 'Task chart zoom')}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 99999,
            background: 'rgba(15, 23, 42, 0.78)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            animation: 'fadeIn 0.15s ease-out',
          }}
          onClick={() => setIsChartZoomOpen(false)}
        >
          <div
            style={{
              position: 'relative',
              maxWidth: 'min(92vw, 1100px)',
              maxHeight: '90vh',
              background: '#ffffff',
              borderRadius: 12,
              padding: 16,
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.15)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, paddingBottom: 8, borderBottom: '1px solid #e2e8f0' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#334155', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Ico name="zoomIn" size={15} color="#475569" />
                {tx(`Hình ảnh trực quan Task ${activeTask.taskNumber}`, `Task ${activeTask.taskNumber} Visual Graphic`)}
              </span>
              <button
                type="button"
                onClick={() => setIsChartZoomOpen(false)}
                title={tx('Đóng (Esc)', 'Close (Esc)')}
                aria-label={tx('Đóng', 'Close')}
                style={{
                  background: '#f1f5f9',
                  border: 'none',
                  borderRadius: 6,
                  padding: '5px 8px',
                  cursor: 'pointer',
                  color: '#475569',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 12,
                  fontWeight: 600,
                  transition: 'background 0.15s',
                }}
              >
                <Ico name="close" size={14} />
                <span>{tx('Đóng', 'Close')}</span>
              </button>
            </div>
            <div style={{ flex: 1, overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
              <img
                src={normalizeChartUrl(activeTaskChartUrl)}
                alt={`Task ${activeTask.taskNumber} chart enlarged`}
                style={{
                  maxWidth: '100%',
                  maxHeight: 'calc(90vh - 80px)',
                  objectFit: 'contain',
                  display: 'block',
                  borderRadius: 6,
                }}
              />
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
interface AnnotatedEssayRendererProps {
  text: string;
  accurateComments: AccurateTaskComment[];
  hoveredCommentId: string | null;
  pulseMarkId: string | null;
  repRadarActive: boolean;
  repeatedWordsMap: Map<string, number>;
  onHoverEnter: (comment: WritingComment, e: React.MouseEvent) => void;
  onHoverLeave: () => void;
}

const AnnotatedEssayRenderer: React.FC<AnnotatedEssayRendererProps> = ({
  text,
  accurateComments,
  hoveredCommentId,
  pulseMarkId,
  repRadarActive,
  repeatedWordsMap,
  onHoverEnter,
  onHoverLeave,
}) => {
  const { i18n } = useTranslation();
  const isVi = String(i18n?.language || '').toLowerCase().startsWith('vi');
  const losslessParas = useMemo(() => {
    return buildLosslessParagraphSegments(text, accurateComments, 'annotated');
  }, [text, accurateComments]);

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {losslessParas.map(para => (
        <div key={para.pIndex} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <span className="wf-gutter-num">¶{para.pIndex + 1}</span>
          <div style={{ flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.85 }}>
            {para.segments.map((seg, sIdx) => {
              if (seg.isHighlight && seg.annotations.length > 0) {
                const top = seg.annotations[0];
                const topComment = top.comment;
                const catMeta = CATEGORY_META[topComment.category || 'error'];
                const isHovered = seg.annotations.some(m => m.comment.id === hoveredCommentId);
                const isPulse = seg.annotations.some(m => m.comment.id === pulseMarkId);

                return (
                  <mark
                    key={sIdx}
                    className={`wf-mark ${isHovered ? 'is-hovered' : ''} ${isPulse ? 'pulse-highlight' : ''}`}
                    onMouseEnter={(e) => onHoverEnter(topComment, e)}
                    onMouseLeave={onHoverLeave}
                    style={{
                      display: 'inline',
                      background: catMeta.bg,
                      color: 'inherit',
                      borderBottom: `2px solid ${catMeta.color}`,
                      borderTop: 'none',
                      borderLeft: 'none',
                      borderRight: 'none',
                    }}
                  >
                    {seg.text}
                    <sup
                      style={{
                        display: 'inline',
                        fontSize: 10,
                        fontWeight: 800,
                        color: catMeta.color,
                        marginLeft: 2,
                        fontFamily: 'Consolas, monospace',
                        userSelect: 'none',
                      }}
                    >
                      [{top.displayIndex}]
                    </sup>
                  </mark>
                );
              }

              // If repetition radar is active, highlight repeated content words
              if (repRadarActive && repeatedWordsMap.size > 0) {
                const words = seg.text.split(/(\s+|[.,!?;:"'()]+)/);
                return (
                  <span key={sIdx}>
                    {words.map((w, wi) => {
                      const cleanW = w.toLowerCase();
                      const repCount = repeatedWordsMap.get(cleanW);
                      if (repCount && repCount >= 3) {
                        return (
                          <span
                            key={wi}
                            style={{
                              borderBottom: '1.5px dotted #D97706',
                              background: 'rgba(217, 119, 6, 0.08)',
                              borderRadius: 2,
                              padding: '0 1px',
                            }}
                            title={isVi ? `Từ "${cleanW}" lặp lại ${repCount} lần trong bài` : `Word "${cleanW}" repeated ${repCount} times in essay`}
                          >
                            {w}
                            <sup style={{ fontSize: 9, color: '#D97706', fontWeight: 800, marginLeft: 1 }}>
                              {repCount}x
                            </sup>
                          </span>
                        );
                      }
                      return <span key={wi}>{w}</span>;
                    })}
                  </span>
                );
              }

              return <span key={sIdx}>{seg.text}</span>;
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

// ==========================================
// SUB-COMPONENT: DIFF (TRACK CHANGES) RENDERER
// ==========================================
interface DiffEssayRendererProps {
  text: string;
  accurateComments: AccurateTaskComment[];
  hoveredCommentId: string | null;
  onHoverEnter: (comment: WritingComment, e: React.MouseEvent) => void;
  onHoverLeave: () => void;
}

const DiffEssayRenderer: React.FC<DiffEssayRendererProps> = ({
  text,
  accurateComments,
  hoveredCommentId,
  onHoverEnter,
  onHoverLeave,
}) => {
  const { i18n } = useTranslation();
  const isVi = String(i18n?.language || '').toLowerCase().startsWith('vi');
  const tx = (vi: string, en: string) => (isVi ? vi : en);
  const diffParas = useMemo(() => {
    return buildLosslessParagraphSegments(text, accurateComments, 'diff');
  }, [text, accurateComments]);

  const hasReplacements = useMemo(() => {
    return accurateComments.some(c => Boolean(c.comment.replacement));
  }, [accurateComments]);

  if (!hasReplacements) {
    return (
      <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.85 }}>
        {text}
        <div style={{ marginTop: 24, padding: 12, background: C.wash, borderRadius: 8, fontSize: 13, color: C.sub, fontStyle: 'italic' }}>
          {tx('Chưa có đề xuất thay thế (replacement) nào cho bài viết này. Dùng AI Co-Pilot hoặc thêm nhận xét có ô "Sửa thành" để xem chế độ Diff.', 'No replacement suggestions for this essay yet. Use AI Co-Pilot or add an annotation with a "Suggested Replacement" to see Diff mode.')}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {diffParas.map(para => (
        <div key={para.pIndex} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <span className="wf-gutter-num">¶{para.pIndex + 1}</span>
          <div style={{ flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.85, fontSize: 15 }}>
            {para.segments.map((seg, sIdx) => {
              if (seg.isHighlight && seg.annotations.length > 0) {
                const top = seg.annotations[0];
                const topComment = top.comment;
                const isHovered = seg.annotations.some(m => m.comment.id === hoveredCommentId);
                const replacement = topComment.replacement;

                if (replacement) {
                  return (
                    <span
                      key={sIdx}
                      onMouseEnter={(e) => onHoverEnter(topComment, e)}
                      onMouseLeave={onHoverLeave}
                      style={{
                        display: 'inline',
                        cursor: 'pointer',
                        padding: '1px 3px',
                        borderRadius: 4,
                        background: isHovered ? 'rgba(91, 61, 245, 0.12)' : 'transparent',
                        transition: 'background 0.15s ease',
                      }}
                    >
                      <del style={{ textDecoration: 'line-through', opacity: 0.65, color: '#DC2626', marginRight: 4 }}>
                        {seg.text}
                      </del>
                      <ins style={{
                        textDecoration: 'none',
                        fontWeight: 700,
                        color: '#15803D',
                        background: '#DCFCE7',
                        padding: '1px 5px',
                        borderRadius: 4,
                        fontSize: 14,
                      }}>
                        {replacement}
                      </ins>
                    </span>
                  );
                }
              }
              return <span key={sIdx}>{seg.text}</span>;
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

// ==========================================
// BACKWARD COMPATIBILITY: LEGACY SINGLE ESSAY
// ==========================================
function LegacySingleEssayFeedback({
  text,
  taskId,
  comments,
  editable,
  onChange,
}: {
  text: string;
  taskId: string;
  comments: WritingComment[];
  editable: boolean;
  onChange: (comments: WritingComment[]) => void;
}) {
  const { i18n } = useTranslation();
  const isVi = String(i18n?.language || '').toLowerCase().startsWith('vi');
  const tx = (vi: string, en: string) => (isVi ? vi : en);
  const essay = useRef<HTMLDivElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [draft, setDraft] = useState('');
  const [active, setActive] = useState('');

  const ranges = comments.flatMap(comment => {
    const quote = comment.anchorQuote || '';
    if (!quote) return [];
    const start = comment.startOffset !== undefined && text.slice(comment.startOffset, comment.endOffset) === quote
      ? comment.startOffset : text.indexOf(quote);
    return start < 0 ? [] : [{ start, end: start + quote.length, comment }];
  });

  const points = [...new Set([0, text.length, ...ranges.flatMap(r => [r.start, r.end])])].sort((a, b) => a - b);

  const captureSelection = () => {
    if (!editable || !essay.current) return;
    const selected = window.getSelection();
    if (!selected?.rangeCount || selected.isCollapsed) return;
    const range = selected.getRangeAt(0);
    if (!essay.current.contains(range.startContainer) || !essay.current.contains(range.endContainer)) return;
    const prefix = range.cloneRange();
    prefix.selectNodeContents(essay.current);
    prefix.setEnd(range.startContainer, range.startOffset);
    const start = prefix.toString().length;
    const end = start + range.toString().length;
    if (!text.slice(start, end).trim()) return;
    setSelection({ start, end });
  };

  return (
    <div className="writing-feedback-legacy" style={{ textAlign: 'left' }}>
      <div
        ref={essay}
        onMouseUp={captureSelection}
        style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8, padding: '12px 0' }}
      >
        {text ? points.slice(0, -1).map((start, index) => {
          const end = points[index + 1];
          const matches = ranges.filter(r => r.start <= start && r.end >= end);
          return matches.length ? (
            <mark
              key={start}
              style={{ background: '#FFF0AD', borderBottom: '2px solid #C69A20', cursor: 'pointer' }}
              onClick={() => setActive(matches[0].comment.id)}
            >
              {text.slice(start, end)}
            </mark>
          ) : (
            <span key={start}>{text.slice(start, end)}</span>
          );
        }) : tx('Thí sinh chưa nộp bài viết.', 'No response submitted.')}
      </div>

      {editable && (
        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10, marginTop: 10 }}>
          {selection && (
            <div style={{ marginBottom: 8, fontStyle: 'italic', color: C.sub }}>
              {tx('Đoạn đã chọn:', 'Selected text:')} “{text.slice(selection.start, selection.end)}”
            </div>
          )}
          <textarea
            ref={editor}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder={tx("Nhận xét cho đoạn văn này...", "Feedback for this selection...")}
            rows={3}
            style={{ width: '100%', boxSizing: 'border-box', padding: 8, borderRadius: 6, border: `1px solid ${C.border}` }}
          />
          <button
            type="button"
            disabled={!draft.trim()}
            onClick={() => {
              const comment: WritingComment = {
                id: `comment_${Date.now()}`,
                taskId,
                comment: draft.trim(),
                createdAt: Date.now(),
                ...(selection ? {
                  anchorQuote: text.slice(selection.start, selection.end),
                  startOffset: selection.start,
                  endOffset: selection.end,
                } : {}),
              };
              onChange([...comments, comment]);
              setDraft('');
              setSelection(null);
            }}
            style={{ marginTop: 6, padding: '6px 12px', background: C.accent, color: '#fff', border: 'none', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}
          >
            {tx('Thêm nhận xét', 'Add feedback')}
          </button>
        </div>
      )}
    </div>
  );
}
