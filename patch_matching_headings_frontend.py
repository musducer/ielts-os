# -*- coding: utf-8 -*-
import io, sys

PATH = "src/components_split/ACTIVE_EXAM.txt"

with io.open(PATH, "r", encoding="utf-8") as f:
    src = f.read()

if "mh-heading-tray" in src:
    print("[SKIP] Da patch truoc do.")
    sys.exit(0)

# -- 1. Xoa heading tray dung marker chinh xac --
START_MARKER = "{/* KHAY"
END_MARKER = "</div>\n                          )}"

start = src.find(START_MARKER)
if start == -1:
    print("[ERROR] Khong tim thay START_MARKER.")
    sys.exit(1)

end = src.find(END_MARKER, start)
if end == -1:
    print("[ERROR] Khong tim thay END_MARKER.")
    sys.exit(1)
end += len(END_MARKER)

# Thay the doan [start:end] bang closing tags
src = src[:start] + "</div>\n                          )}" + src[end:]
print("  Step 1 OK: Xoa heading tray in showContext.")

# -- 2. Them isDragDropHeadingGroup branch --
OLD_T = "                                                  ) : isDragDropGroup && dragOptions.length > 0 ? ("

NEW_T = r"""                                                  ) : isDragDropHeadingGroup ? (
                                                      (() => {
                                                        const usedIds = new Set(group.questions.map((q: any) => examAnswers[q.id] as string).filter(Boolean));
                                                        return (
                                                          <div className="mh-heading-tray" style={{display:'flex', flexDirection:'column', gap:0}}>
                                                            <div style={{marginBottom:18}}>
                                                              <div style={{fontSize:11, fontWeight:800, color:'var(--esub)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:8}}>List of Headings</div>
                                                              {headingOptions.map((opt: any, oIdx: number) => {
                                                                const optText = typeof opt === 'string' ? opt : ((opt as any).text || "");
                                                                const mm = optText.match(/^([ivxlcdmIVXLCDM]+)[.)]\s*(.*)/i);
                                                                const optId = mm ? mm[1].toLowerCase() : optText.split(' ')[0].toLowerCase();
                                                                const optContent = mm ? mm[2] : optText;
                                                                const isUsed = usedIds.has(optId);
                                                                return (
                                                                  <div key={oIdx}
                                                                    draggable={!isUsed}
                                                                    onDragStart={(e: any) => { if (!isUsed) { e.dataTransfer.setData("text/plain", optId); e.dataTransfer.effectAllowed = "copy"; } }}
                                                                    style={{display:'flex', alignItems:'flex-start', gap:10, padding:'8px 12px', marginBottom:6, borderRadius:6, border:'1px solid', cursor: isUsed ? 'default' : 'grab', userSelect:'none', transition:'opacity .15s, background .15s', opacity: isUsed ? 0.4 : 1, background: isUsed ? 'var(--epanel)' : 'var(--ecard)', borderColor: isUsed ? 'transparent' : 'var(--eborder)'}}>
                                                                    {!isUsed && <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{flexShrink:0, marginTop:2, opacity:.5}}><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>}
                                                                    <span style={{flexShrink:0, width:28, fontStyle:'italic', fontWeight:700, fontSize:13, color:'var(--eblue)'}}>{optId}</span>
                                                                    <span style={{flex:1, fontSize:13, lineHeight:1.45, color:'var(--etext)'}} dangerouslySetInnerHTML={{__html: renderSafeHTML(optContent)}} />
                                                                  </div>
                                                                );
                                                              })}
                                                            </div>
                                                            <div style={{borderTop:'1px solid var(--eborder)', paddingTop:14, display:'flex', flexDirection:'column', gap:10}}>
                                                              {group.questions.map((q: any) => {
                                                                const qGlobalIdx = (activeExam.questions || []).findIndex((x:any) => x.id === q.id) + 1;
                                                                const filled = examAnswers[q.id] as string;
                                                                const isFilled = !!filled;
                                                                const matchedOpt = isFilled ? headingOptions.find((opt: any) => {
                                                                  const txt = typeof opt === 'string' ? opt : ((opt as any).text || "");
                                                                  const mx = txt.match(/^([ivxlcdmIVXLCDM]+)[.)]\s*/i);
                                                                  return mx && mx[1].toLowerCase() === filled.toLowerCase();
                                                                }) : null;
                                                                const filledContent = matchedOpt ? (() => { const txt = typeof matchedOpt === 'string' ? matchedOpt : ((matchedOpt as any).text || ""); return txt.replace(/^[ivxlcdmIVXLCDM]+[.)]\s*/i, ''); })() : filled;
                                                                return (
                                                                  <div key={q.id} id={`question-${q.id}`} style={{display:'flex', alignItems:'center', gap:10}}>
                                                                    <div style={{flexShrink:0, width:28, height:28, borderRadius:'50%', background: isFilled ? 'var(--eblue)' : '#fff', border:`1px solid ${isFilled ? 'var(--eblue)' : '#aaa'}`, display:'grid', placeItems:'center', fontSize:13, fontWeight:700, color: isFilled ? '#fff' : 'var(--etext)'}}>{qGlobalIdx}</div>
                                                                    <div
                                                                      onDragOver={(e: any) => e.preventDefault()}
                                                                      onDrop={(e: any) => { e.preventDefault(); const val = e.dataTransfer.getData("text/plain"); if (val) handleAnswerChange(q.id, val, "DRAG_DROP"); }}
                                                                      onClick={() => { if (isFilled) handleAnswerChange(q.id, ""); }}
                                                                      title={isFilled ? "Click to clear" : "Drag a heading here"}
                                                                      style={{flex:1, minHeight:42, border:`1.5px dashed ${isFilled ? 'var(--eblue)' : '#bbb'}`, borderRadius:6, display:'flex', alignItems:'center', padding:'6px 14px', gap:10, background: isFilled ? 'rgba(26,115,232,0.05)' : 'var(--ebg)', cursor: isFilled ? 'pointer' : 'default', transition:'all .15s'}}>
                                                                      {isFilled ? (
                                                                        <>
                                                                          <span style={{fontStyle:'italic', fontWeight:700, fontSize:13, color:'var(--eblue)', flexShrink:0}}>{filled}</span>
                                                                          <span style={{flex:1, fontSize:12, color:'var(--etext)', lineHeight:1.4}} dangerouslySetInnerHTML={{__html: renderSafeHTML(filledContent)}} />
                                                                          <span style={{fontSize:11, color:'var(--esub)', flexShrink:0, opacity:.6}}>&#10005;</span>
                                                                        </>
                                                                      ) : (
                                                                        <span style={{color:'var(--esub)', fontSize:12, fontStyle:'italic'}}>Drag heading here</span>
                                                                      )}
                                                                    </div>
                                                                  </div>
                                                                );
                                                              })}
                                                            </div>
                                                          </div>
                                                        );
                                                      })()
                                                  ) : isDragDropGroup && dragOptions.length > 0 ? ("""

if OLD_T not in src:
    print("[ERROR] Anchor isDragDropGroup ternary khong tim thay.")
    sys.exit(1)

src = src.replace(OLD_T, NEW_T, 1)
print("  Step 2 OK: Them isDragDropHeadingGroup branch.")

with io.open(PATH, "w", encoding="utf-8") as f:
    f.write(src)

print("[OK] Patch ACTIVE_EXAM.txt hoan thanh.")
