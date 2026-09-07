import { useRef, useState } from 'react';

export interface EssayComment {
  id: string; taskId: string; anchorQuote?: string; comment: string; createdAt: number;
  startOffset?: number; endOffset?: number;
}

export default function WritingFeedback({ text, taskId, comments, editable, onChange }: {
  text: string; taskId: string; comments: EssayComment[]; editable: boolean;
  onChange: (comments: EssayComment[]) => void;
}) {
  const essay = useRef<HTMLDivElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const panel = useRef<HTMLDivElement>(null);
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
  const reveal = (id: string) => {
    setActive(id);
    const marks = essay.current?.querySelectorAll<HTMLElement>('[data-comment-ids]');
    Array.from(marks || []).find(mark => mark.dataset.commentIds?.split(' ').includes(id))?.scrollIntoView({ block: 'nearest' });
  };
  return <div className="writing-feedback">
    <style>{`
      .writing-feedback { text-align:left; }
      .writing-feedback .essay-text { white-space:pre-wrap; overflow-wrap:anywhere; line-height:1.8; padding:16px 0; min-height:110px; text-align:left; }
      .writing-feedback mark { background:#fff0ad; color:inherit; border-bottom:2px solid #c69a20; cursor:pointer; }
      .writing-feedback mark.selected { background:#ffdf70; outline:1px solid #ac7810; }
      .writing-feedback button { border-radius:3px; text-align:left; box-shadow:none; padding:7px 10px; }
      .writing-feedback textarea { text-align:left; width:100%; box-sizing:border-box; min-height:85px; resize:vertical; }
      .writing-feedback blockquote { margin:8px 0; padding-left:10px; border-left:3px solid #c69a20; white-space:pre-wrap; }
      .writing-feedback .feedback-item { border-top:1px solid #ddd; padding:12px 0; }
      .writing-feedback .feedback-item.active { background:rgba(230,180,50,.1); }
    `}</style>
    {editable && <p style={{ margin:0, fontSize:13 }}>Bôi chọn đoạn trong bài, rồi bấm “Nhận xét đoạn này”.</p>}
    <div ref={essay} className="essay-text" onMouseUp={captureSelection} onKeyUp={captureSelection} onTouchEnd={captureSelection}>
      {text ? points.slice(0, -1).map((start, index) => {
        const end = points[index + 1];
        const matches = ranges.filter(r => r.start <= start && r.end >= end);
        return matches.length ? <mark key={start} tabIndex={0} role="button" aria-label="Xem nhận xét" className={matches.some(r => r.comment.id === active) ? 'selected' : ''}
          data-comment-ids={matches.map(r => r.comment.id).join(' ')}
          onClick={() => { if (!window.getSelection()?.isCollapsed) return; setActive(matches[0].comment.id); panel.current?.scrollIntoView({ block:'nearest' }); }}
          onKeyDown={event => { if (event.key === 'Enter') { setActive(matches[0].comment.id); panel.current?.scrollIntoView({ block:'nearest' }); } }}>{text.slice(start, end)}</mark>
          : <span key={start}>{text.slice(start, end)}</span>;
      }) : 'No response submitted.'}
    </div>
    {editable && <div style={{ borderTop:'1px solid #ddd', paddingTop:10 }}>
      {selection && <><blockquote>{text.slice(selection.start, selection.end)}</blockquote><button type="button" onClick={() => editor.current?.focus()}>Nhận xét đoạn này</button> <button type="button" onClick={() => setSelection(null)}>Bỏ chọn</button></>}
      <label style={{ display:'block', marginTop:10 }}>{selection ? 'Nhận xét cho đoạn đã chọn' : 'Nhận xét chung'}
        <textarea ref={editor} value={draft} onChange={event => setDraft(event.target.value)} placeholder="Giải thích điểm cần sửa hoặc điểm làm tốt…" />
      </label>
      <button type="button" disabled={!draft.trim()} onClick={() => {
        const comment: EssayComment = { id: crypto.randomUUID(), taskId, comment:draft.trim(), createdAt:Date.now(),
          ...(selection ? { anchorQuote:text.slice(selection.start, selection.end), startOffset:selection.start, endOffset:selection.end } : {}) };
        onChange([...comments, comment]); setActive(comment.id); setDraft(''); setSelection(null); window.getSelection()?.removeAllRanges();
      }}>Thêm nhận xét</button>
    </div>}
    <div ref={panel}>{comments.map((comment, index) => <div key={comment.id} className={`feedback-item ${active === comment.id ? 'active' : ''}`}>
      <button type="button" onClick={() => reveal(comment.id)} style={{ background:'transparent', color:'inherit', fontWeight:700 }}>{index + 1}. {comment.anchorQuote ? 'Xem đoạn được nhận xét' : 'Nhận xét chung'}</button>
      {comment.anchorQuote && <blockquote>{comment.anchorQuote}</blockquote>}
      <div style={{ whiteSpace:'pre-wrap' }}>{comment.comment}</div>
      {editable && <button type="button" onClick={() => onChange(comments.filter(item => item.id !== comment.id))} style={{ marginTop:6 }}>Xóa nhận xét</button>}
    </div>)}</div>
  </div>;
}
