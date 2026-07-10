# -*- coding: utf-8 -*-
"""
Redesign Teacher Dashboard (DASHBOARD.txt)
- Hero Finance Banner (Net Profit + Teaching-Hours SVG ring)
- Stat strip (Students / Debt / Drive) with icons
- Schedule + Calendar + Announcement: logic giữ nguyên 100%
- XÓA Bug Tracker
- Animation: rise-in stagger + ring fill, respect prefers-reduced-motion
- Dùng theme token C.* + var(--display) (không hardcode màu)
Idempotent: bỏ qua nếu đã có 'dRingFg'.
"""
import re, sys, io

PATH = "src/components_split/DASHBOARD.txt"

with io.open(PATH, "r", encoding="utf-8") as f:
    src = f.read()

if "dRingFg" in src:
    print("[SKIP] Đã patch trước đó (tìm thấy 'dRingFg'). Không làm gì.")
    sys.exit(0)

# ---------- DESKTOP ----------
DESKTOP_NEW = r'''        {activeTab === "DASHBOARD" && !isMobile && (() => {
          const teachHrs = history.reduce((s,h)=>s+((h && h.duration)||0),0)/3600;
          const hrsTarget = 40;
          const hrsPct = Math.max(0, Math.min(1, teachHrs / hrsTarget));
          const R = 46, CIRC = 2 * Math.PI * R, dashOff = CIRC * (1 - hrsPct);
          return (
          <>
            <style>{`
              @keyframes dashRing { from { stroke-dashoffset: ${CIRC}px; } to { stroke-dashoffset: ${dashOff}px; } }
              @keyframes riseIn { from { opacity:0; transform: translateY(16px); } to { opacity:1; transform:none; } }
              .dRise { animation: riseIn .6s cubic-bezier(.22,1,.36,1) both; }
              .dRingFg { animation: dashRing 1.4s cubic-bezier(.22,1,.36,1) .25s both; }
              @media (prefers-reduced-motion: reduce){ .dRise,.dRingFg{ animation: none !important; } }
            `}</style>
          <div style={{ display: "grid", gridTemplateColumns: window.innerWidth > 900 ? "1fr 340px" : "1fr", gap: 28 }}>
            <div style={{ display: "grid", gap: 24 }}>

              {/* HERO FINANCE BANNER */}
              <div className="dRise" style={{ position:'relative', overflow:'hidden', borderRadius:24, padding:'30px 34px', color:'#fff', background:`linear-gradient(135deg, ${C.accent}, ${C.accent}cc)`, boxShadow:`0 22px 44px -20px ${C.accent}`, display:'flex', justifyContent:'space-between', alignItems:'center', gap:24, flexWrap:'wrap' }}>
                <div style={{ position:'absolute', width:360, height:360, right:-90, top:-150, background:'rgba(255,255,255,0.13)', borderRadius:'50%', filter:'blur(6px)', pointerEvents:'none' }} />
                <div style={{ position:'relative' }}>
                  <div style={{ fontSize:12, fontWeight:800, letterSpacing:1.5, textTransform:'uppercase', opacity:0.85 }}>{t('net_profit')}</div>
                  <div style={{ fontFamily:'var(--display)', fontSize:52, fontWeight:600, letterSpacing:-1.5, lineHeight:1.05, marginTop:4 }}>{fmtMoney(stats.net)}</div>
                  <div style={{ display:'flex', gap:12, marginTop:16, flexWrap:'wrap' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:7, fontSize:13, fontWeight:700, background:'rgba(255,255,255,0.18)', padding:'5px 13px', borderRadius:20 }}><span style={{ width:7, height:7, borderRadius:'50%', background:'#fff' }} /> {t('total_revenue')}: {fmtMoney(stats.totalRev)}</div>
                    <div style={{ display:'flex', alignItems:'center', gap:7, fontSize:13, fontWeight:700, background:'rgba(0,0,0,0.18)', padding:'5px 13px', borderRadius:20 }}>{t('pending_payment')}: {fmtMoney(stats.unpaid)}</div>
                  </div>
                </div>
                <div style={{ position:'relative', width:132, height:132, flexShrink:0 }}>
                  <svg width="132" height="132" viewBox="0 0 132 132">
                    <circle cx="66" cy="66" r={R} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="11" />
                    <circle className="dRingFg" cx="66" cy="66" r={R} fill="none" stroke="#fff" strokeWidth="11" strokeLinecap="round" strokeDasharray={CIRC} strokeDashoffset={dashOff} transform="rotate(-90 66 66)" />
                  </svg>
                  <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center' }}>
                    <div style={{ fontFamily:'var(--display)', fontSize:27, fontWeight:600, lineHeight:1 }}>{teachHrs.toFixed(1)}h</div>
                    <div style={{ fontSize:9, fontWeight:800, letterSpacing:0.5, textTransform:'uppercase', opacity:0.85, marginTop:5, textAlign:'center', maxWidth:96 }}>{t('total_teaching_hours')}</div>
                  </div>
                </div>
              </div>

              {/* STAT STRIP */}
              <div className="dRise" style={{ animationDelay:'0.08s', background:C.card, border:`1px solid ${C.border}80`, borderRadius:20, display:'grid', gridTemplateColumns:'repeat(3, 1fr)', boxShadow:'0 6px 20px -12px rgba(0,0,0,0.12)' }}>
                {[{ic:'users', lb:t('student_count'), vl:(Array.isArray(students)?students.length:0), cl:C.accent},{ic:'wallet', lb:t('total_debt'), vl:fmtMoney(stats?.unpaid||0), cl:C.warn},{ic:'folder', lb:t('drive_docs'), vl:(Array.isArray(sharedLinks)?sharedLinks.length:0), cl:C.succ}].map((it, i) => (
                  <div key={i} style={{ display:'flex', alignItems:'center', gap:14, padding:'20px 22px', borderLeft: i ? `1px solid ${C.border}80` : 'none' }}>
                    <div style={{ width:46, height:46, borderRadius:13, display:'grid', placeItems:'center', background:`${it.cl}16`, color:it.cl, flexShrink:0 }}><Ico name={it.ic} size={22} /></div>
                    <div style={{ minWidth:0 }}>
                      <div style={{ fontSize:11, fontWeight:800, color:C.sub, textTransform:'uppercase', letterSpacing:0.5 }}>{it.lb}</div>
                      <div style={{ fontSize:22, fontWeight:800, color:it.cl, lineHeight:1.25, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{it.vl}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="card dRise" style={{ animationDelay:'0.16s' }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                  <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 9 }}><Ico name="calendar" size={20} color={C.accent} /> {t('teaching_schedule')}: {viewDate}</h3>
                  <button onClick={() => setShowSchedForm(!showSchedForm)} style={{ background: C.accent, color: "#fff", padding: "8px 16px", fontSize: 12 }}>{t('add_schedule')}</button>
                </div>

                {showSchedForm && (
                  <div style={{ background: C.bg, padding: 16, borderRadius: 12, marginBottom: 20, display: "grid", gap: 12, border: `1px solid ${C.border}` }}>
                    <div style={{display:'grid', gridTemplateColumns: window.innerWidth > 600 ? '1fr 1fr' : '1fr', gap:10}}>
                        <div><label style={{fontSize:10, fontWeight: 800, color: C.sub}}>{t('start_time')}</label><input type="time" value={schedForm.time} onChange={(e: any)=>setSchedForm({...schedForm, time:e.target.value})} /></div>
                        <div>
                          <label style={{fontSize:10, fontWeight: 800, color: C.sub}}>{t('student_label')}</label>
                          <select value={schedForm.studentId} onChange={(e: any)=>setSchedForm({...schedForm, studentId:e.target.value})}>
                              <option value="">{t('select_student')}</option>
                              {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                        </div>
                    </div>
                    <div style={{display:'grid', gridTemplateColumns: window.innerWidth > 600 ? '2fr 1fr' : '1fr', gap:10}}>
                        <div><label style={{fontSize:10, fontWeight: 800, color: C.sub}}>{t('location_link')}</label><input placeholder={t('zoom_ph')} value={schedForm.location} onChange={(e: any)=>setSchedForm({...schedForm, location:e.target.value})} /></div>
                        <div><label style={{fontSize:10, fontWeight: 800, color: C.sub}}>{t('sched_duration')}</label><input type="number" value={schedForm.duration} onChange={(e: any)=>setSchedForm({...schedForm, duration:Number(e.target.value)})} /></div>
                    </div>
                    <button onClick={handleAddSchedule} style={{ background: C.succ, color: "#fff", padding:'12px', marginTop: 5 }}>{t('save_schedule')}</button>
                  </div>
                )}

                <div style={{ display: "grid", gap: 10 }}>
                  {schedules.filter(s => s && s.date === viewDate).map(s => (
                    <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: 'center', flexWrap: 'wrap', gap: 10, padding: "15px", background: C.bg, borderRadius: 10, border: `1px solid ${s.status === 'DONE' ? C.succ : s.status === 'ABSENT' ? C.err : C.border}` }}>
                      <div>
                        <div style={{fontWeight:800, fontSize: 14}}>{safeString(s.studentName)} <span style={{background: `${C.accent}20`, color: C.accent, padding: '2px 6px', borderRadius: 4, fontSize: 11, marginLeft: 8}}>{safeString(s.time)}</span>
                          {s.status === 'DONE' && <span style={{background: `${C.succ}20`, color: C.succ, padding: '2px 6px', borderRadius: 4, fontSize: 11, marginLeft: 6, fontWeight: 800}}>{t('att_done')}<Ico name="check" size={14} style={{verticalAlign:'-2px',margin:'0 0 0 6px',display:'inline-block'}} /></span>}
                          {s.status === 'ABSENT' && <span style={{background: `${C.err}20`, color: C.err, padding: '2px 6px', borderRadius: 4, fontSize: 11, marginLeft: 6, fontWeight: 800}}>{t('att_was_absent')}<Ico name="x" size={14} style={{verticalAlign:'-2px',margin:'0 0 0 6px',display:'inline-block'}} /></span>}
                        </div>
                        <div style={{fontSize:12, color:C.sub, marginTop: 4}}>{safeString(s.teacher)} • {safeString(s.location)}{s.duration ? ` • ${s.duration}'` : ''}</div>
                      </div>
                      <div style={{display: 'flex', gap: 5, flexWrap: 'wrap'}}>
                          {(!s.status || s.status === 'PENDING') ? (
                            <>
                              <button onClick={() => markAttendance(s, true)} style={{ background: C.succ, color: '#fff', fontSize: 12, padding: '4px 8px', fontWeight: 700 }}><Ico name="check" size={14} style={{verticalAlign:'-2px',margin:'0 6px 0 0',display:'inline-block'}} />{t('att_present')}</button>
                              <button onClick={() => markAttendance(s, false)} style={{ background: `${C.err}15`, color: C.err, fontSize: 12, padding: '4px 8px' }}><Ico name="x" size={14} style={{verticalAlign:'-2px',margin:'0 6px 0 0',display:'inline-block'}} />{t('att_absent')}</button>
                            </>
                          ) : (
                              <button onClick={() => { const nx=schedules.map(x => x.id===s.id ? {...x, status: 'PENDING' as const} : x); setSchedules(nx); syncData({schedules:nx}); }} style={{ background: C.bg, color: C.sub, border: `1px solid ${C.border}`, fontSize: 12, padding: '4px 8px' }}>{t('att_reschedule')}</button>
                          )}
                          <button onClick={() => copyToClipboard(`Chào bạn, nhắc nhẹ hôm nay mình có lịch học IELTS lúc ${s.time} tại ${s.location} nhé!`)} style={{ background: `${C.succ}20`, color: C.succ, fontSize: 12, padding: '4px 8px' }}>{t('remind_schedule')}</button>
                          <button onClick={()=>{ const nx=schedules.filter(x=>x && x.id!==s.id); setSchedules(nx); syncData({schedules:nx}); }} style={{ color: C.err, background: "none", fontSize: 12 }}>{t('common_delete')}</button>
                      </div>
                    </div>
                  ))}
                  {schedules.filter(s => s && s.date === viewDate).length === 0 && <div style={{textAlign:'center', color:C.sub, padding:30, fontSize: 13}}>{t('no_schedule_day')}</div>}
                </div>
              </div>
            </div>

            <div className="card dRise" style={{height:'fit-content', animationDelay:'0.12s'}}>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20}}>
                <button onClick={() => setCalDate(new Date(calDate.getFullYear(), calDate.getMonth()-1))} style={{background:C.bg, color:C.text, padding: '6px 12px'}}>{"<"}</button>
                <div style={{fontWeight:900, fontSize:15, textTransform: 'uppercase'}}>{calHeader}</div>
                <button onClick={() => setCalDate(new Date(calDate.getFullYear(), calDate.getMonth()+1))} style={{background:C.bg, color:C.text, padding: '6px 12px'}}>{">"}</button>
              </div>
              <div className="cal-grid">
                {["S","M","T","W","T","F","S"].map((d, i) => <div key={i} style={{textAlign:'center', fontSize:10, fontWeight:900, color:C.sub, marginBottom: 8}}>{d}</div>)}
                {calendarDays.map((d, idx) => d ? (
                  <div key={idx} onClick={() => setViewDate(d.date)} className={`cal-day ${d.hasSched ? 'has-sched' : ''} ${d.date === viewDate ? 'selected' : ''}`}>{d.day}</div>
                ) : <div key={`empty-${idx}`} className="cal-day empty" />)}
              </div>

              <div style={{marginTop: 30, padding: 16, background: C.bg, borderRadius: 12, border: `1px solid ${C.border}` }}>
                  <label style={{fontSize: 10, fontWeight: 800, color: C.sub, display:'flex', alignItems:'center', gap:6, textTransform:'uppercase', letterSpacing:0.5}}><Ico name="pin" size={13} color={C.accent} /> {t('announce_to_students')}</label>
                  <div style={{display: 'flex', gap: 5, marginTop: 8}}>
                      <input placeholder={t('announce_ph')} value={announcement} onChange={e => setAnnouncement(e.target.value)} onBlur={() => syncData({announcement})} style={{background: C.card}} />
                      <button onClick={() => { setAnnouncement(""); syncData({announcement: ""}); }} style={{background: C.err, color: '#fff', padding: '0 15px'}} title={t('clear_announce')}>X</button>
                  </div>
              </div>
            </div>
          </div>
          </>
          );
        })()}

'''

# ---------- MOBILE ----------
MOBILE_NEW = r'''        {activeTab === "DASHBOARD" && isMobile && (() => {
          const teachHrs = history.reduce((s,h)=>s+((h && h.duration)||0),0)/3600;
          const hrsTarget = 40;
          const hrsPct = Math.max(0, Math.min(1, teachHrs / hrsTarget));
          const R = 30, CIRC = 2 * Math.PI * R, dashOff = CIRC * (1 - hrsPct);
          return (
          <>
            <style>{`
              @keyframes dashRing { from { stroke-dashoffset: ${CIRC}px; } to { stroke-dashoffset: ${dashOff}px; } }
              @keyframes riseIn { from { opacity:0; transform: translateY(14px); } to { opacity:1; transform:none; } }
              .dRise { animation: riseIn .55s cubic-bezier(.22,1,.36,1) both; }
              .dRingFg { animation: dashRing 1.3s cubic-bezier(.22,1,.36,1) .2s both; }
              @media (prefers-reduced-motion: reduce){ .dRise,.dRingFg{ animation: none !important; } }
            `}</style>
          <div style={{ display: 'grid', gap: 14 }}>
            {/* HERO */}
            <div className="dRise" style={{ position:'relative', overflow:'hidden', borderRadius:18, padding:'18px 18px', color:'#fff', background:`linear-gradient(135deg, ${C.accent}, ${C.accent}cc)`, boxShadow:`0 14px 30px -16px ${C.accent}`, display:'flex', justifyContent:'space-between', alignItems:'center', gap:12 }}>
              <div style={{ position:'relative', minWidth:0 }}>
                <div style={{ fontSize:10, fontWeight:800, letterSpacing:1, textTransform:'uppercase', opacity:0.85 }}>{t('net_profit')}</div>
                <div style={{ fontFamily:'var(--display)', fontSize:30, fontWeight:600, letterSpacing:-0.5, lineHeight:1.15, marginTop:2 }}>{fmtMoney(stats.net)}</div>
                <div style={{ fontSize:11, fontWeight:700, marginTop:6, opacity:0.95 }}>{t('total_revenue')}: {fmtMoney(stats.totalRev)}</div>
              </div>
              <div style={{ position:'relative', width:80, height:80, flexShrink:0 }}>
                <svg width="80" height="80" viewBox="0 0 80 80">
                  <circle cx="40" cy="40" r={R} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="8" />
                  <circle className="dRingFg" cx="40" cy="40" r={R} fill="none" stroke="#fff" strokeWidth="8" strokeLinecap="round" strokeDasharray={CIRC} strokeDashoffset={dashOff} transform="rotate(-90 40 40)" />
                </svg>
                <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center' }}>
                  <div style={{ fontFamily:'var(--display)', fontSize:17, fontWeight:600, lineHeight:1 }}>{teachHrs.toFixed(1)}h</div>
                </div>
              </div>
            </div>

            <div className="dRise" style={{ animationDelay:'0.06s', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '12px 13px', display:'flex', alignItems:'center', gap:11 }}>
                <div style={{ width:36, height:36, borderRadius:10, display:'grid', placeItems:'center', background:`${C.accent}16`, color:C.accent, flexShrink:0 }}><Ico name="users" size={18} /></div>
                <div style={{ minWidth:0 }}><div style={{ fontSize: 10, fontWeight: 800, color: C.sub, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('student_count')}</div><div style={{ fontFamily: 'var(--display)', fontSize: 20, fontWeight: 600, color: C.text }}>{Array.isArray(students) ? students.length : 0}</div></div>
              </div>
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '12px 13px', display:'flex', alignItems:'center', gap:11 }}>
                <div style={{ width:36, height:36, borderRadius:10, display:'grid', placeItems:'center', background:`${C.warn}16`, color:C.warn, flexShrink:0 }}><Ico name="wallet" size={18} /></div>
                <div style={{ minWidth:0 }}><div style={{ fontSize: 10, fontWeight: 800, color: C.sub, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('total_debt')}</div><div style={{ fontFamily: 'var(--display)', fontSize: 17, fontWeight: 600, color: C.warn, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{fmtMoney(stats?.unpaid || 0)}</div></div>
              </div>
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '12px 13px', display:'flex', alignItems:'center', gap:11 }}>
                <div style={{ width:36, height:36, borderRadius:10, display:'grid', placeItems:'center', background:`${C.succ}16`, color:C.succ, flexShrink:0 }}><Ico name="folder" size={18} /></div>
                <div style={{ minWidth:0 }}><div style={{ fontSize: 10, fontWeight: 800, color: C.sub, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('drive_docs')}</div><div style={{ fontFamily: 'var(--display)', fontSize: 20, fontWeight: 600, color: C.succ }}>{Array.isArray(sharedLinks) ? sharedLinks.length : 0}</div></div>
              </div>
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '12px 13px', display:'flex', alignItems:'center', gap:11 }}>
                <div style={{ width:36, height:36, borderRadius:10, display:'grid', placeItems:'center', background:`${C.accent}16`, color:C.accent, flexShrink:0 }}><Ico name="clock" size={18} /></div>
                <div style={{ minWidth:0 }}><div style={{ fontSize: 10, fontWeight: 800, color: C.sub, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('total_teaching_hours')}</div><div style={{ fontFamily: 'var(--display)', fontSize: 20, fontWeight: 600, color: C.accent }}>{teachHrs.toFixed(1)}h</div></div>
              </div>
            </div>

            <div className="dRise" style={{ animationDelay:'0.12s', background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '14px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ margin: 0, fontSize: 15, display: 'flex', alignItems: 'center', gap: 7 }}><Ico name="calendar" size={17} color={C.accent} /> {viewDate}</h3>
                <button onClick={() => setShowSchedForm(!showSchedForm)} style={{ background: C.accent, color: '#fff', padding: '7px 13px', fontSize: 12, borderRadius: 9 }}>{t('add_schedule')}</button>
              </div>

              {showSchedForm && (
                <div style={{ background: C.bg, padding: 13, borderRadius: 12, marginBottom: 14, display: 'grid', gap: 10, border: `1px solid ${C.border}` }}>
                  <div><label style={{fontSize:10, fontWeight: 800, color: C.sub}}>{t('start_time')}</label><input type="time" value={schedForm.time} onChange={(e: any)=>setSchedForm({...schedForm, time:e.target.value})} /></div>
                  <div>
                    <label style={{fontSize:10, fontWeight: 800, color: C.sub}}>{t('student_label')}</label>
                    <select value={schedForm.studentId} onChange={(e: any)=>setSchedForm({...schedForm, studentId:e.target.value})}>
                      <option value="">{t('select_student')}</option>
                      {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                  <div><label style={{fontSize:10, fontWeight: 800, color: C.sub}}>{t('location_link')}</label><input placeholder={t('zoom_ph')} value={schedForm.location} onChange={(e: any)=>setSchedForm({...schedForm, location:e.target.value})} /></div>
                  <div><label style={{fontSize:10, fontWeight: 800, color: C.sub}}>{t('sched_duration')}</label><input type="number" value={schedForm.duration} onChange={(e: any)=>setSchedForm({...schedForm, duration:Number(e.target.value)})} /></div>
                  <button onClick={handleAddSchedule} style={{ background: C.succ, color: '#fff', padding:'11px' }}>{t('save_schedule')}</button>
                </div>
              )}

              <div style={{ display: 'grid', gap: 9 }}>
                {schedules.filter(s => s && s.date === viewDate).map(s => (
                  <div key={s.id} style={{ padding: 12, background: C.bg, borderRadius: 12, border: `1px solid ${s.status === 'DONE' ? C.succ : s.status === 'ABSENT' ? C.err : C.border}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                      <div style={{ fontWeight: 800, fontSize: 14 }}>{safeString(s.studentName)}</div>
                      <span style={{ background: `${C.accent}20`, color: C.accent, padding: '2px 7px', borderRadius: 6, fontSize: 11, fontWeight: 800, flexShrink: 0 }}>{safeString(s.time)}</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: C.sub, marginTop: 3 }}>{safeString(s.teacher)} • {safeString(s.location)}{s.duration ? ` • ${s.duration}'` : ''}</div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                      {(!s.status || s.status === 'PENDING') ? (
                        <>
                          <button onClick={() => markAttendance(s, true)} style={{ flex: 1, minWidth: 0, background: C.succ, color: '#fff', fontSize: 12, padding: '7px 8px', fontWeight: 700, borderRadius: 9 }}><Ico name="check" size={13} style={{verticalAlign:'-2px',marginRight:4,display:'inline-block'}} />{t('att_present')}</button>
                          <button onClick={() => markAttendance(s, false)} style={{ flex: 1, minWidth: 0, background: `${C.err}15`, color: C.err, fontSize: 12, padding: '7px 8px', borderRadius: 9 }}><Ico name="x" size={13} style={{verticalAlign:'-2px',marginRight:4,display:'inline-block'}} />{t('att_absent')}</button>
                        </>
                      ) : (
                        <button onClick={() => { const nx=schedules.map(x => x.id===s.id ? {...x, status: 'PENDING' as const} : x); setSchedules(nx); syncData({schedules:nx}); }} style={{ flex: 1, background: C.card, color: C.sub, border: `1px solid ${C.border}`, fontSize: 12, padding: '7px 8px', borderRadius: 9 }}>{t('att_reschedule')}</button>
                      )}
                      <button onClick={() => copyToClipboard(`Chào bạn, nhắc nhẹ hôm nay mình có lịch học IELTS lúc ${s.time} tại ${s.location} nhé!`)} style={{ background: `${C.succ}20`, color: C.succ, fontSize: 12, padding: '7px 10px', borderRadius: 9 }} title={t('remind_schedule')}><Ico name="bell" size={13} /></button>
                      <button onClick={()=>{ const nx=schedules.filter(x=>x && x.id!==s.id); setSchedules(nx); syncData({schedules:nx}); }} style={{ color: C.err, background: `${C.err}10`, fontSize: 12, padding: '7px 10px', borderRadius: 9 }} title={t('common_delete')}><Ico name="trash" size={13} /></button>
                    </div>
                  </div>
                ))}
                {schedules.filter(s => s && s.date === viewDate).length === 0 && <div style={{textAlign:'center', color:C.sub, padding:24, fontSize: 13}}>{t('no_schedule_day')}</div>}
              </div>
            </div>

            <div className="dRise" style={{ animationDelay:'0.18s', background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '14px 14px' }}>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14}}>
                <button onClick={() => setCalDate(new Date(calDate.getFullYear(), calDate.getMonth()-1))} style={{background:C.bg, color:C.text, padding: '6px 12px', borderRadius: 9}}>{"<"}</button>
                <div style={{fontWeight:900, fontSize:14, textTransform: 'uppercase'}}>{calHeader}</div>
                <button onClick={() => setCalDate(new Date(calDate.getFullYear(), calDate.getMonth()+1))} style={{background:C.bg, color:C.text, padding: '6px 12px', borderRadius: 9}}>{">"}</button>
              </div>
              <div className="cal-grid">
                {["S","M","T","W","T","F","S"].map((d,i) => <div key={i} style={{textAlign:'center', fontSize:10, fontWeight:900, color:C.sub, marginBottom: 6}}>{d}</div>)}
                {calendarDays.map((d, idx) => d ? (
                  <div key={idx} onClick={() => setViewDate(d.date)} className={`cal-day ${d.hasSched ? 'has-sched' : ''} ${d.date === viewDate ? 'selected' : ''}`}>{d.day}</div>
                ) : <div key={`empty-${idx}`} className="cal-day empty" />)}
              </div>

              <div style={{marginTop: 16, padding: 13, background: C.bg, borderRadius: 12, border: `1px solid ${C.border}` }}>
                  <label style={{fontSize: 10, fontWeight: 800, color: C.sub, display:'flex', alignItems:'center', gap:6, textTransform:'uppercase', letterSpacing:0.5}}><Ico name="pin" size={13} color={C.accent} /> {t('announce_to_students')}</label>
                  <div style={{display: 'flex', gap: 5, marginTop: 8}}>
                      <input placeholder={t('announce_ph')} value={announcement} onChange={e => setAnnouncement(e.target.value)} onBlur={() => syncData({announcement})} style={{background: C.card}} />
                      <button onClick={() => { setAnnouncement(""); syncData({announcement: ""}); }} style={{background: C.err, color: '#fff', padding: '0 15px'}} title={t('clear_announce')}>X</button>
                  </div>
              </div>
            </div>
          </div>
          </>
          );
        })()}

'''

# ---- Replace DESKTOP block: from '{activeTab === "DASHBOARD" && !isMobile && (' up to (not incl.) MOBILE comment ----
desk_pat = re.compile(
    r'        \{activeTab === "DASHBOARD" && !isMobile && \(\n.*?\n(?=        \{/\* ={5,} DASHBOARD \(MOBILE\) ={5,} \*/\})',
    re.DOTALL)
src, n1 = desk_pat.subn(DESKTOP_NEW, src)

# ---- Replace MOBILE block: from '{activeTab === "DASHBOARD" && isMobile && (' up to (not incl.) CLASSROOM comment ----
mob_pat = re.compile(
    r'        \{activeTab === "DASHBOARD" && isMobile && \(\n.*?\n(?=        \{/\* ={5,} CLASSROOM)',
    re.DOTALL)
src, n2 = mob_pat.subn(MOBILE_NEW, src)

if n1 != 1 or n2 != 1:
    print(f"[ERROR] Anchor không khớp (desktop={n1}, mobile={n2}). KHÔNG ghi file.")
    sys.exit(1)

with io.open(PATH, "w", encoding="utf-8") as f:
    f.write(src)

print(f"[OK] Đã patch DASHBOARD.txt (desktop={n1}, mobile={n2}). Bug Tracker đã xóa.")
print("    Chạy build (compile_app.py) rồi test.")
