import React, { useState, useRef, useMemo, useLayoutEffect, useEffect } from 'react';
import { createPortal } from 'react-dom';
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
// PRINT DOSSIER ANNOTATED ESSAY RENDERER
// ==========================================
function renderDossierAnnotatedEssay(text: string, comments: WritingComment[]) {
  if (!text || !text.trim()) {
    return <div style={{ color: '#9590A0', fontStyle: 'italic' }}>Thí sinh chưa nộp bài viết cho Task này.</div>;
  }

  // 1-based indexed comments matching table row #
  const indexed = comments.map((c, i) => ({ ...c, indexNum: i + 1 }));

  const commentRanges = indexed.flatMap(c => {
    const q = c.anchorQuote || '';
    if (!q) return [];
    let start = (c.startOffset !== undefined && text.slice(c.startOffset, c.endOffset) === q)
      ? c.startOffset
      : text.indexOf(q);
    if (start < 0) return [];
    return [{ start, end: start + q.length, comment: c, indexNum: c.indexNum }];
  });

  const paragraphs = text.split(/\n+/);
  let currentOffset = 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {paragraphs.map((para, pIdx) => {
        const paraStart = currentOffset;
        const paraEnd = paraStart + para.length;
        currentOffset = paraEnd + 1; // +1 for newline

        const paraComments = commentRanges.filter(r => r.start < paraEnd && r.end > paraStart);
        const cutPoints = Array.from(new Set([
          paraStart,
          paraEnd,
          ...paraComments.flatMap(r => [
            Math.max(paraStart, Math.min(paraEnd, r.start)),
            Math.max(paraStart, Math.min(paraEnd, r.end)),
          ])
        ])).sort((a, b) => a - b);

        return (
          <div key={pIdx} style={{ fontSize: 13, lineHeight: 1.85, color: '#1A1726' }}>
            <span style={{ fontSize: 10, color: '#9590A0', fontFamily: 'Consolas, monospace', marginRight: 8, userSelect: 'none' }}>
              ¶{pIdx + 1}
            </span>
            {cutPoints.slice(0, -1).map((start, sIdx) => {
              const end = cutPoints[sIdx + 1];
              const sliceText = text.slice(start, end);
              const matching = paraComments.filter(r => r.start <= start && r.end >= end);

              if (matching.length > 0) {
                const top = matching[0];
                const cat = top.comment.category || 'error';
                const color = cat === 'error' ? '#C93B3B' : cat === 'awkward' ? '#B45309' : cat === 'upgrade' ? '#4F46E5' : '#15803D';
                const bg = cat === 'error' ? '#FEF2F2' : cat === 'awkward' ? '#FFFBEB' : cat === 'upgrade' ? '#EEF2FF' : '#F0FDF4';

                return (
                  <span
                    key={start}
                    style={{
                      background: bg,
                      borderBottom: `2px solid ${color}`,
                      padding: '1px 3px',
                      borderRadius: 2,
                    }}
                  >
                    {sliceText}
                    <sup style={{ fontSize: 10, fontWeight: 800, color, marginLeft: 2, fontFamily: 'Consolas, monospace' }}>
                      [{top.indexNum}]
                    </sup>
                  </span>
                );
              }
              return <span key={start}>{sliceText}</span>;
            })}
          </div>
        );
      })}
    </div>
  );
}

// ==========================================
// SELF-CONTAINED SVG ICONS (<Ico>)
// ==========================================
const Ico: React.FC<{ name: string; size?: number; color?: string; style?: React.CSSProperties }> = ({
  name,
  size = 16,
  color = 'currentColor',
  style,
}) => {
  const s = { width: size, height: size, display: 'inline-block', verticalAlign: 'middle', flexShrink: 0, ...style };
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
    case 'copy':
      return <svg style={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>;
    case 'radar':
      return <svg style={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 10 10"/><path d="m12 12 5-5"/></svg>;
    case 'diff':
      return <svg style={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="3" x2="12" y2="21"/><path d="M16 8h4"/><path d="M4 16h4"/><path d="M6 14v4"/></svg>;
    case 'loader':
      return <svg style={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>;
    default:
      return <svg style={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/></svg>;
  }
};

// ==========================================
// MAIN COMPONENT (MANUSCRIPT EDITORIAL DESK)
// ==========================================
export default function WritingFeedback(props: WritingFeedbackDeskProps) {
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
    return <div style={{ padding: 32, textAlign: 'center', color: C.sub }}>Không tìm thấy dữ liệu bài thi.</div>;
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

  const taskBands = writingTasks.map(t => taskBand(t.id));
  const calculatedFinalBand = taskBands.length === 2 && taskBands.every(scoreIsValid)
    ? roundedBand((Number(taskBands[0]) + Number(taskBands[1]) * 2) / 3)
    : undefined;

  const studentCanSeeGrade = writingGrading.status === 'published';

  // Active task data
  const originalEssay = String(reviewQuiz.result.answers?.[activeTask.id] || '');
  const activeTaskComments = useMemo(() => {
    return writingGrading.comments.filter(c => c.taskId === activeTask.id);
  }, [writingGrading.comments, activeTask.id]);

  // UI States
  const [promptDrawerOpen, setPromptDrawerOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'annotated' | 'diff' | 'clean' | 'model'>('annotated');
  const [repRadarActive, setRepRadarActive] = useState(false);
  const [activeTab, setActiveTab] = useState<'rubric' | 'annotations' | 'corrected'>('rubric');
  const [filterCriterion, setFilterCriterion] = useState<string>('ALL');
  const [filterCategory, setFilterCategory] = useState<string>('ALL');
  const [pulseMarkId, setPulseMarkId] = useState<string | null>(null);
  const [vocabToast, setVocabToast] = useState<string | null>(null);

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

  const saveWritingGrade = async (publish: boolean) => {
    const rubricKeys: Array<keyof WritingCriterionScore> = ['taskAchievement', 'coherence', 'lexical', 'grammar'];
    if (publish && writingTasks.some(task => !rubricKeys.every(k => scoreIsValid(writingGrading.taskScores[task.id]?.[k])))) {
      alert('Vui lòng chấm đủ 4 tiêu chí cho cả Task 1 và Task 2 trước khi Publish cho học sinh.');
      return;
    }
    const finalBand = publish ? calculatedFinalBand : writingGrading.finalBand;
    const now = Date.now();
    const nextGrading: WritingGrading = {
      ...writingGrading,
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
        if (!saved) alert('Bản chấm đã lưu cục bộ trên thiết bị và sẽ tự động đồng bộ khi có mạng.');
        else alert(publish ? '✅ Đã publish bài chấm cho học sinh thành công!' : 'Đã lưu bản nháp.');
      }
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
      const res = await fetch('/api/ai_feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'selection_critique',
          selected_text: selectionBox.text,
          essay_text: originalEssay,
          task_number: taskNumber,
          prompt: activeTask.prompt || activeTask.instructions || '',
        }),
      });
      if (!res.ok) throw new Error('AI critique request failed: ' + res.statusText);
      const data = await res.json();
      if (!data.success && !data.criterion) throw new Error(data.error || 'AI không trả về kết quả hợp lệ');

      const nextCrit: CriterionKey = (data.criterion as CriterionKey) || selectionBox.criterion || 'GRA';
      const nextCat: CommentCategory = (data.category as CommentCategory) || 'error';
      const nextReplacement = (data.replacement ?? selectionBox.replacement ?? '').trim();
      const nextHighBand = (data.highBandRewrite ?? '').trim();
      const nextComment = (data.comment ?? '').trim();
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
          comment: nextComment || 'Nhận xét từ AI.',
          createdAt: Date.now(),
        };
        updateWritingGrading({
          comments: [...writingGrading.comments, newComment],
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
      alert('Không thể nhận xét bằng AI: ' + (err as Error).message);
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
      alert('Vui lòng đăng nhập tài khoản học viên để lưu vào Sổ từ vựng.');
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
      setVocabToast(`✓ Đã lưu "${cleanWord}" vào Sổ từ vựng!`);
      setTimeout(() => setVocabToast(null), 3000);
    } else {
      alert('Không thể lưu từ vào sổ từ vựng.');
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
          media_url: activeTask.mediaUrl || '',
          lang: 'vi',
        }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.success) {
        throw new Error(data.error || 'AI không thể phân tích bài viết.');
      }
      setAiModal({ open: true, loading: false, error: '', data });
    } catch (err: any) {
      setAiModal({ open: true, loading: false, error: err.message || 'Lỗi kết nối AI', data: null });
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

  // PDF Dossier Export
  const exportPdfDossier = async () => {
    if (isExportingPdf) return;
    setIsExportingPdf(true);
    try {
      // 1. Give React a tick + rAF to mount the full dossier DOM tree into the document
      await new Promise(r => setTimeout(r, 150));
      await new Promise(r => requestAnimationFrame(r));

      const element = document.getElementById('writing-pdf-dossier-root');
      if (!element) {
        throw new Error('Không tìm thấy vùng kết xuất tài liệu PDF (writing-pdf-dossier-root).');
      }

      if (element.innerText.trim().length === 0 || element.offsetHeight < 100) {
        console.warn('Dossier element appears empty or unrendered, waiting additional tick...');
        await new Promise(r => setTimeout(r, 200));
      }

      if (element.innerText.trim().length === 0 || element.offsetHeight < 100) {
        throw new Error('Nội dung bản điểm rỗng hoặc chưa hiển thị đầy đủ trên màn hình.');
      }

      // 2. Wait for any Task 1 chart images to load or fail gracefully
      const images = Array.from(element.querySelectorAll('img'));
      await Promise.all(
        images.map(img => {
          if (img.complete && img.naturalHeight !== 0) return Promise.resolve(true);
          return new Promise(resolve => {
            img.onload = () => resolve(true);
            img.onerror = () => {
              img.style.display = 'none';
              resolve(false);
            };
            setTimeout(() => resolve(false), 1500); // 1.5s timeout safety
          });
        })
      );

      // 3. Dynamically import html2pdf.js
      const mod: any = await import('html2pdf.js');
      const html2pdf = mod.default || mod;

      const safeStudent = (reviewQuiz?.result?.studentName || 'Student').trim().replace(/[^a-zA-Z0-9_\u00C0-\u024F\u1EA0-\u1EF9]/g, '_');
      const safeTitle = (activeTask?.title || `Task_${activeTask?.taskNumber || 1}`).trim().replace(/[^a-zA-Z0-9_\u00C0-\u024F\u1EA0-\u1EF9]/g, '_');
      const safeFileName = `IELTS_Writing_Dossier_${safeStudent}_${safeTitle}.pdf`;

      const opt = {
        margin: [10, 10, 10, 10],
        filename: safeFileName,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          allowTaint: true,
          backgroundColor: '#FFFFFF',
          scrollX: 0,
          scrollY: 0,
          windowWidth: 820,
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'], avoid: ['.pdf-no-break', 'tr', 'blockquote'] },
      };

      await html2pdf().set(opt).from(element).save();
    } catch (err) {
      console.error('PDF export error:', err);
      alert('Không thể tạo file PDF tự động: ' + (err as Error).message + '. Bạn có thể sử dụng Ctrl+P để in trang.');
    } finally {
      setIsExportingPdf(false);
    }
  };

  // Filtered comments for Tab 2
  const filteredComments = useMemo(() => {
    return activeTaskComments.filter(c => {
      if (filterCriterion !== 'ALL' && c.criterion !== filterCriterion) return false;
      if (filterCategory !== 'ALL' && c.category !== filterCategory) return false;
      return true;
    });
  }, [activeTaskComments, filterCriterion, filterCategory]);

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
              {promptDrawerOpen ? 'Ẩn đề bài & biểu đồ' : 'Xem đề bài & biểu đồ'}
            </button>
          </div>

          {/* Right: Score Stamp + Action Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {/* Score Stamp */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '4px 12px', background: C.wash, border: `1px solid ${C.border}`, borderRadius: 10 }}>
              <div>
                <div style={{ fontSize: 9, fontWeight: 900, color: C.sub, letterSpacing: 0.6, textTransform: 'uppercase' }}>Overall Band</div>
                <div style={{ fontFamily: 'var(--display)', fontSize: 24, lineHeight: 1, color: C.accent, fontWeight: 800 }}>
                  {calculatedFinalBand ?? writingGrading.finalBand ?? '—'}
                </div>
              </div>
              <div style={{ borderLeft: `1px solid ${C.border}`, paddingLeft: 10, fontSize: 11, color: C.sub, fontFamily: 'var(--mono)' }}>
                T1: <strong>{taskBand(writingTasks[0]?.id || '') ?? '—'}</strong> · T2: <strong>{taskBand(writingTasks[1]?.id || '') ?? '—'}</strong>
              </div>
            </div>

            {/* Export PDF Dossier */}
            <button
              onClick={exportPdfDossier}
              disabled={isExportingPdf}
              className="wf-btn-hairline"
              title="Xuất báo cáo chi tiết chuẩn học thuật"
              style={{ opacity: isExportingPdf ? 0.7 : 1, cursor: isExportingPdf ? 'wait' : 'pointer' }}
            >
              <Ico name={isExportingPdf ? "loader" : "download"} size={14} />
              {isExportingPdf ? 'Đang tạo PDF...' : 'Dossier PDF'}
            </button>

            {/* Teacher Actions */}
            {isTeacher && (
              <>
                <button
                  onClick={runAiCoPilot}
                  className="wf-btn-hairline"
                  style={{ color: C.accent, borderColor: C.accentLine, background: C.accentWash }}
                  title="Chấm nháp tự động 4 tiêu chí và chỉ lỗi chi tiết bằng AI"
                >
                  <Ico name="sparkles" size={14} color={C.accent} /> AI Co-Pilot
                </button>
                <button onClick={() => saveWritingGrade(false)} className="wf-btn-hairline">
                  <Ico name="save" size={14} /> Lưu nháp
                </button>
                <button
                  onClick={() => saveWritingGrade(true)}
                  disabled={calculatedFinalBand === undefined}
                  className="wf-btn-accent"
                >
                  <Ico name="check" size={14} /> Publish cho học sinh
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
              }}>
                {studentCanSeeGrade ? '✓ Đã công bố kết quả' : 'Đang chờ giáo viên chấm'}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* ========================================== */}
      {/* 2. COLLAPSIBLE PROMPT & VISUAL DRAWER      */}
      {/* ========================================== */}
      {promptDrawerOpen && (
        <section style={{ background: C.card, borderBottom: `1px solid ${C.border}`, padding: '18px 24px' }}>
          <div style={{ maxWidth: 1440, margin: '0 auto', display: 'grid', gridTemplateColumns: activeTask.mediaUrl ? '1fr 340px' : '1fr', gap: 24, alignItems: 'start' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 900, color: C.accent, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>
                Task {activeTask.taskNumber} Instructions & Prompt
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
            {activeTask.mediaUrl && (
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 8, background: '#fff', textAlign: 'center' }}>
                <img
                  src={activeTask.mediaUrl}
                  alt={`Task ${activeTask.taskNumber} chart`}
                  style={{ maxWidth: '100%', maxHeight: 260, objectFit: 'contain', display: 'block', margin: '0 auto' }}
                />
                <span style={{ fontSize: 11, color: C.sub, marginTop: 4, display: 'block' }}>Task visual graphic</span>
              </div>
            )}
          </div>
        </section>
      )}

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
            <div style={{ padding: '8px 14px', borderBottom: `1px solid ${C.border}`, background: C.wash, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, overflowX: 'auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, whiteSpace: 'nowrap' }}>
                <span style={{ fontSize: 10.5, fontWeight: 900, color: C.sub, textTransform: 'uppercase', letterSpacing: 0.5, marginRight: 2 }}>
                  Chế độ:
                </span>
                <button
                  type="button"
                  onClick={() => setViewMode('annotated')}
                  className={`wf-tab-btn ${viewMode === 'annotated' ? 'active' : ''}`}
                  style={{ padding: '4px 8px', fontSize: 11.5 }}
                >
                  <Ico name="fileText" size={12} /> Chú thích
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('diff')}
                  className={`wf-tab-btn ${viewMode === 'diff' ? 'active' : ''}`}
                  style={{ padding: '4px 8px', fontSize: 11.5 }}
                >
                  <Ico name="diff" size={12} /> Sửa trực tiếp (Diff)
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('clean')}
                  className={`wf-tab-btn ${viewMode === 'clean' ? 'active' : ''}`}
                  style={{ padding: '4px 8px', fontSize: 11.5 }}
                >
                  <Ico name="check" size={12} /> Bản hoàn chỉnh
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('model')}
                  className={`wf-tab-btn ${viewMode === 'model' ? 'active' : ''}`}
                  style={{ padding: '4px 8px', fontSize: 11.5 }}
                >
                  <Ico name="book" size={12} /> Bài mẫu Band 8+
                </button>
              </div>

              {isTeacher && viewMode === 'annotated' && (
                <span style={{ fontSize: 11, color: C.sub, fontStyle: 'italic', flexShrink: 0, whiteSpace: 'nowrap' }}>
                  Bôi chọn để thêm nhận xét
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
                      Thí sinh chưa nộp bài viết cho Task này.
                    </div>
                  ) : (
                    <AnnotatedEssayRenderer
                      text={originalEssay}
                      comments={activeTaskComments}
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
                    comments={activeTaskComments}
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
                          Soạn hoặc chỉnh sửa bài viết đã sửa hoàn chỉnh cho học sinh:
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
                        placeholder="Nhập hoặc dán bài viết đã sửa hoàn chỉnh (hoặc dùng AI Co-Pilot để tạo tự động)..."
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
                          Giáo viên chưa đăng bản sửa hoàn chỉnh cho bài này.
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
                          Bài mẫu tham khảo Band 8.0+ cho Task này:
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
                        placeholder="Nhập hoặc dán bài mẫu Band 8+..."
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
                          Chưa có bài mẫu tham khảo cho đề bài này.
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
                  {essayStats.words >= targetWords ? '✓' : '⚠'} {essayStats.words} / {targetWords} words
                  {essayStats.words < targetWords && ` (-${targetWords - essayStats.words}w)`}
                </span>

                <span>{essayStats.paragraphs} ¶</span>
                <span>{essayStats.sentences} sentences</span>
                <span>{essayStats.avgWordsPerSentence} w/s</span>
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
                  title="Tìm và gạch chân các từ ngữ dài xuất hiện lặp lại 3+ lần trong bài"
                >
                  <Ico name="radar" size={13} color={repRadarActive ? C.warn : C.sub} />
                  Radar lặp từ {repRadarActive ? 'ON' : 'OFF'}
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
                <span>4 Tiêu chí & Trọng tâm</span>
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
                <span>Chú thích ({activeTaskComments.length})</span>
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
                <span>Bài sửa & Bài mẫu</span>
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
                        Top 3 Trọng tâm cần cải thiện (Bottlenecks)
                      </span>
                      {isTeacher && (
                        <button
                          onClick={() => {
                            const val = prompt('Thêm trọng tâm cải thiện:');
                            if (val && val.trim()) {
                              updateTaskBottlenecks(activeTask.id, [...currentBottlenecks, val.trim()].slice(0, 3));
                            }
                          }}
                          style={{ fontSize: 11, background: 'transparent', border: 'none', color: C.accent, fontWeight: 700, cursor: 'pointer' }}
                        >
                          + Thêm
                        </button>
                      )}
                    </div>

                    {currentBottlenecks.length === 0 ? (
                      <p style={{ fontSize: 12.5, color: C.sub, margin: 0, fontStyle: 'italic' }}>
                        {isTeacher ? 'Chưa có mục trọng tâm. Dùng AI Co-Pilot để trích xuất tự động hoặc bấm + Thêm.' : 'Chưa có ghi chú trọng tâm.'}
                      </p>
                    ) : (
                      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6, color: C.text }}>
                        {currentBottlenecks.map((item, idx) => (
                          <li key={idx} style={{ marginBottom: 4 }}>
                            <span>{item}</span>
                            {isTeacher && (
                              <button
                                onClick={() => updateTaskBottlenecks(activeTask.id, currentBottlenecks.filter((_, i) => i !== idx))}
                                style={{ background: 'transparent', border: 'none', color: C.subLight, marginLeft: 6, cursor: 'pointer', padding: 0 }}
                                title="Xóa"
                              >
                                ×
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
                              placeholder={`Ghi chú cho ${critMeta.short}...`}
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
                                <strong>Nhận xét:</strong> {currentNote}
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
                      Không có chú thích nào phù hợp bộ lọc.
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gap: 10 }}>
                      {filteredComments.map((comment, index) => {
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
                                <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 800, color: C.sub }}>
                                  #{index + 1}
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
                                  {catMeta.label}
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
                                  title="Xóa nhận xét"
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
                                    {t}
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
                                  <Ico name="plus" size={11} color={C.accent} /> Lưu vào Sổ từ vựng
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
                      Nhận xét chung toàn bài (General Feedback)
                    </label>
                    {isTeacher ? (
                      <textarea
                        value={writingGrading.generalFeedback || ''}
                        onChange={e => updateWritingGrading({ generalFeedback: e.target.value })}
                        placeholder="Nhận xét tổng quan điểm mạnh, điểm cần lưu ý và lời khuyên chung cho học sinh..."
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
                        {writingGrading.generalFeedback || 'Chưa có nhận xét chung.'}
                      </div>
                    )}
                  </div>

                  {/* Clean Corrected Preview */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color: C.sub, textTransform: 'uppercase' }}>
                        Bản sửa hoàn chỉnh (Task {activeTask.taskNumber})
                      </span>
                      <button
                        onClick={() => setViewMode('clean')}
                        style={{ fontSize: 11, background: 'transparent', border: 'none', color: C.accent, fontWeight: 700, cursor: 'pointer' }}
                      >
                        Mở toàn màn hình →
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
                      {writingGrading.correctedAnswers[activeTask.id] || '(Chưa có bản sửa)'}
                    </div>
                  </div>

                  {/* Sample Model Preview */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color: C.sub, textTransform: 'uppercase' }}>
                        Bài mẫu Band 8+ (Task {activeTask.taskNumber})
                      </span>
                      <button
                        onClick={() => setViewMode('model')}
                        style={{ fontSize: 11, background: 'transparent', border: 'none', color: C.accent, fontWeight: 700, cursor: 'pointer' }}
                      >
                        Mở toàn màn hình →
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
                      {writingGrading.sampleAnswers?.[activeTask.id] || '(Chưa có bài mẫu)'}
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
                    {meta.label}
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
                    title="Xóa nhận xét"
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
                      {t}
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
                  <Ico name="plus" size={12} color={C.accent} /> Lưu cụm từ vào Sổ từ vựng
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
                    Lỗi sai
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectionBox({ ...selectionBox, stage: 2, category: 'awkward', criterion: 'LR' })}
                    style={{ padding: '4px 8px', borderRadius: 6, border: 'none', background: '#FFFBEB', color: C.warn, fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}
                  >
                    Chưa tự nhiên
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectionBox({ ...selectionBox, stage: 2, category: 'upgrade', criterion: 'LR' })}
                    style={{ padding: '4px 8px', borderRadius: 6, border: 'none', background: '#EEF2FF', color: C.accent, fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}
                  >
                    Nâng cấp
                  </button>
                  <div style={{ width: 1, height: 16, background: C.border, margin: '0 2px' }} />
                  <button
                    type="button"
                    disabled={aiCritiqueLoading}
                    onClick={() => runSelectionAiCritique(false)}
                    style={{ padding: '4px 8px', borderRadius: 6, border: `1px solid ${C.accentLine}`, background: C.accentWash, color: C.accent, fontSize: 11.5, fontWeight: 700, cursor: aiCritiqueLoading ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                    title="AI phân tích lỗi, gợi ý sửa và viết giải thích"
                  >
                    <Ico name="sparkles" size={12} color={C.accent} />
                    {aiCritiqueLoading ? 'Đang hỏi AI...' : 'AI Sửa'}
                  </button>
                  <button
                    type="button"
                    disabled={aiCritiqueLoading}
                    onClick={() => runSelectionAiCritique(true)}
                    style={{ padding: '4px 8px', borderRadius: 6, border: `1px solid ${C.succLine}`, background: C.succWash, color: C.succ, fontSize: 11.5, fontWeight: 700, cursor: aiCritiqueLoading ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                    title="AI tự sửa và lưu nhận xét ngay"
                  >
                    <Ico name="check" size={12} color={C.succ} />
                    Lưu ngay
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
                      <span style={{ fontSize: 12, fontWeight: 800, color: C.text }}>Thêm nhận xét đoạn đã chọn</span>
                      {aiCritiqueLoading && (
                        <span style={{ fontSize: 10.5, color: C.accent, fontWeight: 700 }}>
                          Đang phân tích...
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
                      {aiCritiqueLoading ? 'AI đang phân tích...' : 'AI Phân tích lại'}
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
                      title="AI phân tích và tự động lưu vào bài chấm ngay"
                    >
                      <Ico name="check" size={12} color={C.succ} />
                      AI Lưu ngay
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
                          {cat === 'error' ? 'Lỗi sai' : cat === 'awkward' ? 'Chưa chuẩn' : cat === 'upgrade' ? 'Nâng band' : 'Khen'}
                        </button>
                      );
                    })}
                  </div>

                  {/* Replacement input */}
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: C.sub, marginBottom: 3 }}>
                      Sửa thành (Suggested Replacement):
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
                      <label style={{ fontSize: 11, fontWeight: 700, color: C.sub }}>Gợi ý Band 8+ (tùy chọn):</label>
                      <button
                        onClick={() => setSelectionBox({ ...selectionBox, showRewrite: !selectionBox.showRewrite })}
                        style={{ fontSize: 11, background: 'transparent', border: 'none', color: C.accent, fontWeight: 700, cursor: 'pointer' }}
                      >
                        {selectionBox.showRewrite ? 'Ẩn' : '+ Thêm'}
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
                      Gắn nhanh thẻ lỗi:
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
                            {tag}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Explanation input */}
                  <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: C.sub, marginBottom: 3 }}>
                      Giải thích / Lời khuyên:
                    </label>
                    <textarea
                      value={selectionBox.comment}
                      onChange={e => setSelectionBox({ ...selectionBox, comment: e.target.value })}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                          handleSaveSelectionComment();
                        }
                      }}
                      placeholder="Giải thích ngắn vì sao cần sửa hoặc cách dùng đúng..."
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
                      Hủy
                    </button>
                    <button
                      onClick={handleSaveSelectionComment}
                      disabled={!selectionBox.comment.trim()}
                      className="wf-btn-accent"
                      style={{ padding: '6px 12px', fontSize: 12 }}
                    >
                      Lưu nhận xét
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
                <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Đang phân tích bài thi theo 4 tiêu chí chuẩn IELTS...</div>
                <div style={{ fontSize: 12, color: C.sub, marginTop: 4 }}>Trích xuất điểm số, lỗi ngữ pháp/từ vựng và viết bài mẫu Band 8.5</div>
              </div>
            ) : aiModal.error ? (
              <div style={{ padding: '20px 0' }}>
                <div style={{ color: C.err, fontSize: 14, marginBottom: 16 }}>{aiModal.error}</div>
                <button onClick={runAiCoPilot} className="wf-btn-hairline">
                  <Ico name="refresh" size={14} /> Thử lại
                </button>
              </div>
            ) : aiModal.data ? (
              <div style={{ display: 'grid', gap: 16 }}>
                {/* Score Preview */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: C.wash, padding: '12px 16px', borderRadius: 10, border: `1px solid ${C.border}` }}>
                  <div>
                    <span style={{ fontSize: 11, fontWeight: 800, color: C.sub, textTransform: 'uppercase' }}>Ước tính Band Task {activeTask.taskNumber}</span>
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
                    <strong style={{ fontSize: 12, color: C.warn }}>3 Trọng tâm cần khắc phục:</strong>
                    <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12.5, lineHeight: 1.5, color: C.text }}>
                      {aiModal.data.bottlenecks.map((b: string, i: number) => <li key={i}>{b}</li>)}
                    </ul>
                  </div>
                )}

                {/* Annotations Count */}
                <div style={{ fontSize: 13, color: C.sub }}>
                  ✓ Phát hiện <strong>{aiModal.data.annotations?.length || 0} chú thích lỗi/nâng cấp</strong> bám sát văn bản bài viết.
                  <br />
                  ✓ Đã tạo sẵn <strong>Bản sửa hoàn chỉnh</strong> và <strong>Bài mẫu Band 8.5</strong>.
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10, borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
                  <button onClick={() => setAiModal({ ...aiModal, open: false })} className="wf-btn-hairline">
                    Đóng
                  </button>
                  <button onClick={applyAiDraft} className="wf-btn-accent">
                    <Ico name="check" size={14} /> Áp dụng vào bài chấm
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
        }}>
          {vocabToast}
        </div>
      )}

      {/* ========================================== */}
      {/* 8. PRINT-GRADE PDF ASSESSMENT DOSSIER       */}
      {/* ========================================== */}
      {isExportingPdf && (
        <div
          id="writing-pdf-export-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 99999,
            background: 'rgba(250, 248, 245, 0.96)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'flex-start',
            overflowY: 'auto',
            padding: '40px 16px',
          }}
        >
          {/* Top Status Banner */}
          <div style={{ marginBottom: 20, textAlign: 'center' }}>
            <div style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 18, fontWeight: 700, color: '#1A1726', marginBottom: 4 }}>
              Đang kết xuất IELTS Writing Assessment Dossier...
            </div>
            <div style={{ fontSize: 12, color: '#666175', fontFamily: "'Segoe UI', Inter, Arial, sans-serif" }}>
              Hệ thống đang chuẩn bị bản in độ nét cao (Scale 2x). Quá trình này mất khoảng 1-2 giây.
            </div>
          </div>

          {/* Actual Dossier Print Tree */}
          <div
            id="writing-pdf-dossier-root"
            style={{
              width: 750,
              maxWidth: 750,
              background: '#FFFFFF',
              color: '#1A1726',
              boxShadow: '0 10px 40px rgba(0,0,0,0.08)',
              borderRadius: 4,
              padding: '36px 32px',
              boxSizing: 'border-box',
              fontFamily: "'Segoe UI', Inter, Arial, sans-serif",
            }}
          >
            {/* Header Banner */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #5B3DF5', paddingBottom: 16, marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 900, color: '#5B3DF5', letterSpacing: 1.2, textTransform: 'uppercase', fontFamily: 'Consolas, monospace' }}>
                  IELTS OS — ACADEMIC WRITING ASSESSMENT DOSSIER
                </div>
                <h1 style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 24, margin: '4px 0 6px', color: '#1A1726', lineHeight: 1.2 }}>
                  Writing Assessment Dossier
                </h1>
                <div style={{ fontSize: 12, color: '#666175' }}>
                  Học sinh: <strong style={{ color: '#1A1726' }}>{reviewQuiz?.result?.studentName || 'Student'}</strong> · Bài thi: <strong style={{ color: '#1A1726' }}>{reviewQuiz?.quiz?.title || 'IELTS Mock Test'}</strong>
                </div>
                <div style={{ fontSize: 11.5, color: '#666175', marginTop: 3 }}>
                  Phần thi: <strong style={{ color: '#1A1726' }}>{activeTask.title || `Task ${taskNumber}`}</strong> · Số từ bài viết: <strong style={{ color: '#1A1726', fontFamily: 'Consolas, monospace' }}>{countWritingWords(originalEssay)} words</strong> · Ngày chấm: <strong>{new Date().toLocaleDateString('vi-VN')}</strong>
                </div>
              </div>

              {/* Band Score Box */}
              <div style={{ textAlign: 'right', minWidth: 160 }}>
                <div style={{ fontSize: 9.5, fontWeight: 900, color: '#666175', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Điểm Overall Task {taskNumber}
                </div>
                <div style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 32, fontWeight: 900, color: '#5B3DF5', lineHeight: 1, margin: '2px 0 6px' }}>
                  Band {taskBand(activeTask.id) ?? calculatedFinalBand ?? writingGrading.finalBand ?? '—'}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, background: '#F6F3EC', border: '1px solid #E4DFD3', borderRadius: 4, padding: '4px 6px', textAlign: 'center' }}>
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 800, color: '#666175' }}>{taskNumber === 1 ? 'TA' : 'TR'}</div>
                    <div style={{ fontSize: 11, fontWeight: 900, color: '#5B3DF5', fontFamily: 'Consolas, monospace' }}>{writingGrading.taskScores[activeTask.id]?.taskAchievement ?? '—'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 800, color: '#666175' }}>CC</div>
                    <div style={{ fontSize: 11, fontWeight: 900, color: '#5B3DF5', fontFamily: 'Consolas, monospace' }}>{writingGrading.taskScores[activeTask.id]?.coherence ?? '—'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 800, color: '#666175' }}>LR</div>
                    <div style={{ fontSize: 11, fontWeight: 900, color: '#5B3DF5', fontFamily: 'Consolas, monospace' }}>{writingGrading.taskScores[activeTask.id]?.lexical ?? '—'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 800, color: '#666175' }}>GRA</div>
                    <div style={{ fontSize: 11, fontWeight: 900, color: '#5B3DF5', fontFamily: 'Consolas, monospace' }}>{writingGrading.taskScores[activeTask.id]?.grammar ?? '—'}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* SECTION 1: TASK PROMPT & VISUAL */}
            <div className="pdf-no-break" style={{ marginBottom: 20, pageBreakInside: 'avoid', breakInside: 'avoid' }}>
              <h3 style={{ fontSize: 13, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8, color: '#1A1726' }}>
                1. Đề bài & Hướng dẫn (Task Prompt)
              </h3>
              <div style={{ padding: '12px 16px', background: '#F6F3EC', border: '1px solid #E4DFD3', borderRadius: 6, fontSize: 12.5, lineHeight: 1.6, color: '#1A1726' }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{activeTask.title}</div>
                {activeTask.instructions && <div style={{ marginBottom: 6, color: '#4B5563' }}>{activeTask.instructions}</div>}
                {activeTask.prompt && (
                  <div
                    dangerouslySetInnerHTML={{ __html: activeTask.prompt }}
                    style={{ marginTop: 4, color: '#1A1726' }}
                  />
                )}
                {activeTask.mediaUrl && (
                  <div style={{ marginTop: 10, textAlign: 'center' }}>
                    <img
                      src={activeTask.mediaUrl}
                      alt={`Visual Task ${taskNumber}`}
                      crossOrigin="anonymous"
                      style={{ maxWidth: '100%', maxHeight: 220, objectFit: 'contain', border: '1px solid #E4DFD3', borderRadius: 4, background: '#FFFFFF' }}
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = 'none';
                      }}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* SECTION 2: 4 CRITERIA MATRIX & PEDAGOGICAL NOTES */}
            <div className="pdf-no-break" style={{ marginBottom: 20, pageBreakInside: 'avoid', breakInside: 'avoid' }}>
              <h3 style={{ fontSize: 13, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8, color: '#1A1726' }}>
                2. Đánh giá chi tiết 4 tiêu chí chấm điểm
              </h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5, border: '1px solid #E4DFD3' }}>
                <thead>
                  <tr style={{ background: '#F6F3EC', borderBottom: '1px solid #E4DFD3', textAlign: 'left' }}>
                    <th style={{ padding: '7px 10px', width: '26%' }}>Tiêu chí</th>
                    <th style={{ padding: '7px 10px', width: '14%' }}>Điểm Band</th>
                    <th style={{ padding: '7px 10px' }}>Nhận xét sư phạm</th>
                  </tr>
                </thead>
                <tbody>
                  {(['TA_TR', 'CC', 'LR', 'GRA'] as const).map(crit => {
                    const meta = CRITERION_LABELS[crit];
                    const s = writingGrading.taskScores[activeTask.id]?.[meta.scoreKey];
                    const note = writingGrading.criteriaNotes?.[activeTask.id]?.[crit];
                    return (
                      <tr key={crit} style={{ borderBottom: '1px solid #E4DFD3' }}>
                        <td style={{ padding: '7px 10px', fontWeight: 700 }}>
                          {taskNumber === 1 ? meta.t1Name : meta.t2Name}
                        </td>
                        <td style={{ padding: '7px 10px', fontFamily: 'Consolas, monospace', fontWeight: 800, color: '#5B3DF5' }}>
                          Band {s ?? '—'}
                        </td>
                        <td style={{ padding: '7px 10px', color: '#4B5563', lineHeight: 1.5 }}>
                          {note || BAND_DESCRIPTORS[crit][Math.round(Number(s || 6))] || 'Đáp ứng yêu cầu.'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Priority Action Plan (Bottlenecks) & General Feedback */}
            {(currentBottlenecks.length > 0 || writingGrading.generalFeedback) && (
              <div className="pdf-no-break" style={{ marginBottom: 20, display: 'grid', gap: 10, pageBreakInside: 'avoid', breakInside: 'avoid' }}>
                {currentBottlenecks.length > 0 && (
                  <div style={{ padding: '10px 14px', background: '#FFFBEB', border: '1px solid #FCD34D', borderLeft: '4px solid #B45309', borderRadius: 4 }}>
                    <div style={{ fontSize: 11, fontWeight: 900, color: '#B45309', textTransform: 'uppercase', marginBottom: 4 }}>
                      Trọng tâm khắc phục (Priority Action Plan):
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.6, color: '#1A1726' }}>
                      {currentBottlenecks.map((b, i) => <li key={i}>{b}</li>)}
                    </ul>
                  </div>
                )}
                {writingGrading.generalFeedback && (
                  <div style={{ padding: '10px 14px', background: '#EEF2FF', border: '1px solid #C7D2FE', borderLeft: '4px solid #5B3DF5', borderRadius: 4 }}>
                    <div style={{ fontSize: 11, fontWeight: 900, color: '#5B3DF5', textTransform: 'uppercase', marginBottom: 4 }}>
                      Nhận xét chung của giáo viên:
                    </div>
                    <div style={{ fontSize: 12, lineHeight: 1.6, color: '#1A1726', whiteSpace: 'pre-wrap' }}>
                      {writingGrading.generalFeedback}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* SECTION 3: ANNOTATED STUDENT ESSAY WITH NUMBERED MARKERS */}
            <div style={{ marginBottom: 22 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                <h3 style={{ fontSize: 13, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.8, margin: 0, color: '#1A1726' }}>
                  3. Bài làm của học sinh (Student Essay · {countWritingWords(originalEssay)} words)
                </h3>
                <span style={{ fontSize: 11, color: '#666175', fontStyle: 'italic' }}>
                  Ghi chú: Số [n] gạch chân tương ứng với mục sửa lỗi trong bảng bên dưới.
                </span>
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.85, padding: '16px 20px', background: '#FAF8F5', border: '1px solid #E4DFD3', borderRadius: 6, color: '#1A1726' }}>
                {renderDossierAnnotatedEssay(originalEssay, activeTaskComments)}
              </div>
            </div>

            {/* SECTION 4: DETAILED CORRECTIONS & COACHING TABLE */}
            {activeTaskComments.length > 0 && (
              <div style={{ marginBottom: 22 }}>
                <h3 style={{ fontSize: 13, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8, color: '#1A1726' }}>
                  4. Bảng sửa lỗi & Gợi ý nâng cấp chi tiết ({activeTaskComments.length} điểm chú thích)
                </h3>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5, border: '1px solid #E4DFD3' }}>
                  <thead>
                    <tr style={{ background: '#F6F3EC', borderBottom: '1px solid #E4DFD3', textAlign: 'left' }}>
                      <th style={{ padding: '6px 8px', width: '5%' }}>#</th>
                      <th style={{ padding: '6px 8px', width: '26%' }}>Đoạn gốc</th>
                      <th style={{ padding: '6px 8px', width: '28%' }}>Gợi ý sửa & Nâng Band</th>
                      <th style={{ padding: '6px 8px', width: '13%' }}>Tiêu chí</th>
                      <th style={{ padding: '6px 8px' }}>Giải thích & Lời khuyên</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeTaskComments.map((c, i) => {
                      const cat = c.category || 'error';
                      const critLabel = c.criterion === 'TA_TR' ? (taskNumber === 1 ? 'TA' : 'TR') : (c.criterion || 'GRA');
                      const catLabel = cat === 'error' ? 'Lỗi sai' : cat === 'awkward' ? 'Chưa tự nhiên' : cat === 'upgrade' ? 'Nâng Band' : 'Điểm sáng';
                      const catColor = cat === 'error' ? '#C93B3B' : cat === 'awkward' ? '#B45309' : cat === 'upgrade' ? '#4F46E5' : '#15803D';
                      return (
                        <tr key={c.id} className="pdf-no-break" style={{ borderBottom: '1px solid #E4DFD3', pageBreakInside: 'avoid', breakInside: 'avoid' }}>
                          <td style={{ padding: '7px 8px', fontFamily: 'Consolas, monospace', fontWeight: 800, color: '#5B3DF5' }}>
                            [{i + 1}]
                          </td>
                          <td style={{ padding: '7px 8px', color: '#C93B3B', textDecoration: c.replacement ? 'line-through' : 'none' }}>
                            {c.anchorQuote || '—'}
                          </td>
                          <td style={{ padding: '7px 8px' }}>
                            {c.replacement && (
                              <div style={{ color: '#15803D', fontWeight: 700 }}>
                                {c.replacement}
                              </div>
                            )}
                            {c.highBandRewrite && (
                              <div style={{ fontSize: 11, color: '#4F46E5', marginTop: 3 }}>
                                <strong>Band 8+:</strong> {c.highBandRewrite}
                              </div>
                            )}
                            {!c.replacement && !c.highBandRewrite && <span style={{ color: '#9590A0' }}>—</span>}
                          </td>
                          <td style={{ padding: '7px 8px' }}>
                            <div style={{ fontFamily: 'Consolas, monospace', fontWeight: 700, fontSize: 11, color: '#1A1726' }}>
                              {critLabel}
                            </div>
                            <span style={{ fontSize: 10, fontWeight: 700, color: catColor }}>
                              {catLabel}
                            </span>
                            {c.tags && c.tags.length > 0 && (
                              <div style={{ fontSize: 9.5, color: '#666175', marginTop: 2 }}>
                                {c.tags.join(', ')}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '7px 8px', color: '#374151', lineHeight: 1.5 }}>
                            {c.comment}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* SECTION 5: CLEAN CORRECTED ESSAY */}
            {writingGrading.correctedAnswers[activeTask.id] && (
              <div className="pdf-no-break" style={{ marginBottom: 20, pageBreakInside: 'avoid', breakInside: 'avoid' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                  <h3 style={{ fontSize: 13, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.8, margin: 0, color: '#15803D' }}>
                    5. Bài viết đã sửa hoàn chỉnh (Clean Corrected Version)
                  </h3>
                  <span style={{ fontSize: 11, color: '#666175', fontFamily: 'Consolas, monospace' }}>
                    {countWritingWords(writingGrading.correctedAnswers[activeTask.id])} words
                  </span>
                </div>
                <div style={{ fontSize: 12.5, lineHeight: 1.8, whiteSpace: 'pre-wrap', color: '#1A1726', padding: '14px 18px', background: '#F0FDF4', border: '1px solid #86EFAC', borderLeft: '4px solid #15803D', borderRadius: 6 }}>
                  {writingGrading.correctedAnswers[activeTask.id]}
                </div>
              </div>
            )}

            {/* SECTION 6: BAND 8.0+ MODEL ESSAY */}
            {(writingGrading.sampleAnswers?.[activeTask.id] || writingGrading.sampleEssay) && (
              <div className="pdf-no-break" style={{ marginBottom: 20, pageBreakInside: 'avoid', breakInside: 'avoid' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                  <h3 style={{ fontSize: 13, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.8, margin: 0, color: '#5B3DF5' }}>
                    6. Bài mẫu tham khảo Band 8.0+ (Model Essay)
                  </h3>
                  <span style={{ fontSize: 11, color: '#666175', fontFamily: 'Consolas, monospace' }}>
                    {countWritingWords(writingGrading.sampleAnswers?.[activeTask.id] || writingGrading.sampleEssay || '')} words
                  </span>
                </div>
                <div style={{ fontSize: 12.5, lineHeight: 1.8, whiteSpace: 'pre-wrap', color: '#1A1726', padding: '14px 18px', background: '#FAF8F5', border: '1px solid #E4DFD3', borderLeft: '4px solid #5B3DF5', borderRadius: 6 }}>
                  {writingGrading.sampleAnswers?.[activeTask.id] || writingGrading.sampleEssay}
                </div>
              </div>
            )}

            {/* Footer Signature */}
            <div style={{ borderTop: '1px solid #E4DFD3', paddingTop: 12, marginTop: 24, display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#9590A0' }}>
              <span>IELTS OS Educational Engine</span>
              <span>Date: {new Date().toLocaleDateString('vi-VN')} · Academic Assessment Dossier</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ==========================================
// SUB-COMPONENT: ANNOTATED ESSAY RENDERER
// ==========================================
interface AnnotatedEssayRendererProps {
  text: string;
  comments: WritingComment[];
  hoveredCommentId: string | null;
  pulseMarkId: string | null;
  repRadarActive: boolean;
  repeatedWordsMap: Map<string, number>;
  onHoverEnter: (comment: WritingComment, e: React.MouseEvent) => void;
  onHoverLeave: () => void;
}

const AnnotatedEssayRenderer: React.FC<AnnotatedEssayRendererProps> = ({
  text,
  comments,
  hoveredCommentId,
  pulseMarkId,
  repRadarActive,
  repeatedWordsMap,
  onHoverEnter,
  onHoverLeave,
}) => {
  // Split paragraphs to show paragraph numbers in left gutter
  const paragraphs = useMemo(() => text.split(/\n+/), [text]);

  // Compute comment ranges relative to full text
  const commentRanges = useMemo(() => {
    return comments.flatMap(c => {
      const q = c.anchorQuote || '';
      if (!q) return [];
      let start = (c.startOffset !== undefined && text.slice(c.startOffset, c.endOffset) === q)
        ? c.startOffset
        : text.indexOf(q);
      if (start < 0) return [];
      return [{ start, end: start + q.length, comment: c }];
    });
  }, [text, comments]);

  // Render paragraph by paragraph with cumulative offset
  let currentOffset = 0;

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {paragraphs.map((para, pIdx) => {
        const paraStart = currentOffset;
        const paraEnd = paraStart + para.length;
        currentOffset = paraEnd + 1; // +1 for the newline

        // Slice points for this paragraph
        const paraComments = commentRanges.filter(r => r.start < paraEnd && r.end > paraStart);
        const cutPoints = Array.from(new Set([
          paraStart,
          paraEnd,
          ...paraComments.flatMap(r => [
            Math.max(paraStart, Math.min(paraEnd, r.start)),
            Math.max(paraStart, Math.min(paraEnd, r.end)),
          ])
        ])).sort((a, b) => a - b);

        return (
          <div key={pIdx} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <span className="wf-gutter-num">¶{pIdx + 1}</span>
            <div style={{ flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {cutPoints.slice(0, -1).map((start, sIdx) => {
                const end = cutPoints[sIdx + 1];
                const sliceText = text.slice(start, end);
                const matching = paraComments.filter(r => r.start <= start && r.end >= end);

                if (matching.length > 0) {
                  const topComment = matching[0].comment;
                  const catMeta = CATEGORY_META[topComment.category || 'error'];
                  const isHovered = matching.some(m => m.comment.id === hoveredCommentId);
                  const isPulse = matching.some(m => m.comment.id === pulseMarkId);

                  return (
                    <mark
                      key={start}
                      className={`wf-mark ${isHovered ? 'is-hovered' : ''} ${isPulse ? 'pulse-highlight' : ''}`}
                      onMouseEnter={(e) => onHoverEnter(topComment, e)}
                      onMouseLeave={onHoverLeave}
                      style={{
                        background: catMeta.bg,
                        color: 'inherit',
                        borderBottom: `2px solid ${catMeta.color}`,
                        borderTop: 'none',
                        borderLeft: 'none',
                        borderRight: 'none',
                      }}
                    >
                      {sliceText}
                    </mark>
                  );
                }

                // If repetition radar is active, highlight repeated content words
                if (repRadarActive && repeatedWordsMap.size > 0) {
                  const words = sliceText.split(/(\s+|[.,!?;:"'()]+)/);
                  return (
                    <span key={start}>
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
                              title={`Từ "${cleanW}" lặp lại ${repCount} lần trong bài`}
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

                return <span key={start}>{sliceText}</span>;
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ==========================================
// SUB-COMPONENT: DIFF (TRACK CHANGES) RENDERER
// ==========================================
interface DiffEssayRendererProps {
  text: string;
  comments: WritingComment[];
  hoveredCommentId: string | null;
  onHoverEnter: (comment: WritingComment, e: React.MouseEvent) => void;
  onHoverLeave: () => void;
}

const DiffEssayRenderer: React.FC<DiffEssayRendererProps> = ({
  text,
  comments,
  hoveredCommentId,
  onHoverEnter,
  onHoverLeave,
}) => {
  // Sort comments with valid quotes by startOffset
  const validComments = useMemo(() => {
    return comments
      .filter(c => c.anchorQuote && c.replacement)
      .map(c => {
        let start = (c.startOffset !== undefined && text.slice(c.startOffset, c.endOffset) === c.anchorQuote)
          ? c.startOffset
          : text.indexOf(c.anchorQuote!);
        return { start, end: start + (c.anchorQuote?.length || 0), comment: c };
      })
      .filter(c => c.start >= 0)
      .sort((a, b) => a.start - b.start);
  }, [text, comments]);

  if (validComments.length === 0) {
    return (
      <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.85 }}>
        {text}
        <div style={{ marginTop: 24, padding: 12, background: C.wash, borderRadius: 8, fontSize: 13, color: C.sub, fontStyle: 'italic' }}>
          Chưa có đề xuất thay thế (replacement) nào cho bài viết này. Dùng AI Co-Pilot hoặc thêm nhận xét có ô "Sửa thành" để xem chế độ Diff.
        </div>
      </div>
    );
  }

  // Build sequential diff stream
  const elements: React.ReactNode[] = [];
  let lastIndex = 0;

  validComments.forEach((item, idx) => {
    if (item.start > lastIndex) {
      elements.push(<span key={`text_${lastIndex}`}>{text.slice(lastIndex, item.start)}</span>);
    }

    if (item.start >= lastIndex) {
      const c = item.comment;
      elements.push(
        <span
          key={`diff_${c.id}_${idx}`}
          onMouseEnter={(e) => onHoverEnter(c, e)}
          onMouseLeave={onHoverLeave}
          style={{
            cursor: 'pointer',
            padding: '2px 4px',
            borderRadius: 4,
            background: c.id === hoveredCommentId ? 'rgba(91, 61, 245, 0.12)' : 'transparent',
          }}
        >
          <del style={{ textDecoration: 'line-through', opacity: 0.6, color: '#DC2626', marginRight: 4 }}>
            {c.anchorQuote}
          </del>
          <ins style={{
            textDecoration: 'none',
            fontWeight: 800,
            color: '#15803D',
            background: '#DCFCE7',
            padding: '1px 6px',
            borderRadius: 4,
            fontSize: 13.5,
          }}>
            {c.replacement}
          </ins>
        </span>
      );
      lastIndex = item.end;
    }
  });

  if (lastIndex < text.length) {
    elements.push(<span key={`text_end`}>{text.slice(lastIndex)}</span>);
  }

  return (
    <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.85, fontSize: 15 }}>
      {elements}
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
        }) : 'No response submitted.'}
      </div>

      {editable && (
        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10, marginTop: 10 }}>
          {selection && (
            <div style={{ marginBottom: 8, fontStyle: 'italic', color: C.sub }}>
              Đoạn đã chọn: “{text.slice(selection.start, selection.end)}”
            </div>
          )}
          <textarea
            ref={editor}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="Nhận xét cho đoạn văn này..."
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
            Thêm nhận xét
          </button>
        </div>
      )}
    </div>
  );
}
