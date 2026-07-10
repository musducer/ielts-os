# -*- coding: utf-8 -*-
"""
mobile_teacher_step1.py
=======================
BUOC 1 - Layout mobile rieng cho TEACHER:
  - Hook useIsMobile (innerWidth < 640) + state mobileMoreOpen.
  - Nav thanh slim tren mobile (an ios-tabs + lang/eye/exit; giu logo + API + clock).
  - Bottom tab bar (Home/Students/Exams/Finance/More) + sheet "More"
    (Classroom/Live/Drive + doi ngon ngu + dang xuat).
  - Dashboard ban mobile: hero gon + luoi 2 cot + lich compact + lich thang.
KHONG dung desktop, KHONG dung phong thi (ACTIVE_EXAM).

Target: src/App.template.tsx , src/components_split/DASHBOARD.txt
Idempotent.
"""
import sys

T = "src/App.template.tsx"
D = "src/components_split/DASHBOARD.txt"

with open(T, "r", encoding="utf-8") as f:
    tpl = f.read()
with open(D, "r", encoding="utf-8") as f:
    dash = f.read()

# ---------------------------------------------------------------- App.template
def repl(s, old, new, label, required=True):
    if new.split("/*M*/")[0] and new in s:
        print(f"[=] {label}: da co -> bo qua.")
        return s
    if old not in s:
        if required:
            print(f"[X] {label}: KHONG khop anchor. Dung lai.")
            sys.exit(1)
        print(f"[!] {label}: khong thay anchor (bo qua).")
        return s
    print(f"[OK] {label}")
    return s.replace(old, new, 1)

if "const [isMobile, setIsMobile]" not in tpl:
    # R1: hook
    tpl = repl(tpl,
        '  const [activeTab, setActiveTab] = useState<TabType>("DASHBOARD");',
        '  const [activeTab, setActiveTab] = useState<TabType>("DASHBOARD");\n'
        '  const [isMobile, setIsMobile] = useState(typeof window !== "undefined" && window.innerWidth < 640);\n'
        '  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);\n'
        '  useEffect(() => {\n'
        '      const onResize = () => setIsMobile(window.innerWidth < 640);\n'
        '      window.addEventListener("resize", onResize);\n'
        '      return () => window.removeEventListener("resize", onResize);\n'
        '  }, []);',
        "R1 hook useIsMobile")

    # R2: nav padding + gap mobile
    tpl = repl(tpl,
        'padding: "12px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, zIndex: 100, gap: 20 }}>',
        'padding: isMobile ? "9px 14px" : "12px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, zIndex: 100, gap: isMobile ? 10 : 20 }}>',
        "R2 nav padding")

    # R3: hide ios-tabs on mobile
    tpl = repl(tpl,
        "<div style={{ flex: 1, display: 'flex', justifyContent: 'center', overflow: 'hidden' }}>",
        "<div style={{ flex: 1, display: isMobile ? 'none' : 'flex', justifyContent: 'center', overflow: 'hidden' }}>",
        "R3 hide ios-tabs")

    # R4: divider
    tpl = repl(tpl,
        "<div style={{width: 1, height: 20, background: C.border}}></div>",
        "{!isMobile && <div style={{width: 1, height: 20, background: C.border}}></div>}",
        "R4 divider")

    # R5: LanguageToggle teacher
    tpl = repl(tpl,
        '<LanguageToggle role="TEACHER" />',
        '{!isMobile && <LanguageToggle role="TEACHER" />}',
        "R5 LanguageToggle")

    # R6: eye button wrap (2 phan)
    tpl = repl(tpl,
        '          <button onClick={() => setColorblind(!colorblind)}',
        '          {!isMobile && <button onClick={() => setColorblind(!colorblind)}',
        "R6a eye open")
    tpl = repl(tpl,
        '<Ico name="eye" size={18} /></button>',
        '<Ico name="eye" size={18} /></button>}',
        "R6b eye close")

    # R7: exit button wrap (2 phan)
    tpl = repl(tpl,
        '          <button onClick={handleLogout}',
        '          {!isMobile && <button onClick={handleLogout}',
        "R7a exit open")
    tpl = repl(tpl,
        "borderRadius: 8 }}>{t('exit')}</button>",
        "borderRadius: 8 }}>{t('exit')}</button>}",
        "R7b exit close")

    # R8: main padding
    tpl = repl(tpl,
        'maxWidth: 1200, margin: "0 auto", padding: "40px 24px"',
        'maxWidth: 1200, margin: "0 auto", padding: isMobile ? "14px 12px 96px" : "40px 24px"',
        "R8 main padding")

    # R9: hide scrollToTop on mobile
    tpl = repl(tpl,
        '      {!activeExam && (\n          <button onClick={scrollToTop}',
        '      {!activeExam && !isMobile && (\n          <button onClick={scrollToTop}',
        "R9 hide scrollTop")

    # R10: hide lang fixed button on mobile
    tpl = repl(tpl,
        '      {!activeExam && (\n          <button \n              onClick={() => i18n.changeLanguage',
        '      {!activeExam && !isMobile && (\n          <button \n              onClick={() => i18n.changeLanguage',
        "R10 hide lang fixed")

# R11: bottom tab bar + More sheet
BAR = r'''              {i18n.language === 'en' ? 'Tiếng Việt' : 'English'}
          </button>
      )}

      {isMobile && !activeExam && (
        <>
          <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 1000, background: 'rgba(255,255,255,0.93)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderTop: `1px solid ${C.border}`, display: 'flex', paddingBottom: 'env(safe-area-inset-bottom)' }}>
            {([{ key: 'DASHBOARD', icon: 'home' }, { key: 'STUDENTS', icon: 'users' }, { key: 'EXAM_BUILDER', icon: 'fileText' }, { key: 'FINANCE', icon: 'wallet' }] as {key: TabType, icon: string}[]).map(it => {
              const on = activeTab === it.key;
              return (
                <button key={it.key} onClick={() => { setActiveTab(it.key); setMobileMoreOpen(false); }} style={{ flex: 1, background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '8px 0', color: on ? C.accent : C.sub }}>
                  <Ico name={it.icon} size={21} />
                  <span style={{ fontSize: 10, fontWeight: on ? 800 : 600 }}>{t('tab_' + it.key)}</span>
                </button>
              );
            })}
            <button onClick={() => setMobileMoreOpen(v => !v)} style={{ flex: 1, background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '8px 0', color: (mobileMoreOpen || ['CLASSROOM','LIVE_ARENA','DRIVE','ACADEMICS','HISTORY'].includes(activeTab)) ? C.accent : C.sub }}>
              <Ico name="list" size={21} />
              <span style={{ fontSize: 10, fontWeight: 600 }}>{i18n.language === 'vi' ? 'Thêm' : 'More'}</span>
            </button>
          </div>

          {mobileMoreOpen && (
            <div onClick={() => setMobileMoreOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1001, display: 'flex', alignItems: 'flex-end' }}>
              <div onClick={e => e.stopPropagation()} style={{ width: '100%', background: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: '10px 14px calc(20px + env(safe-area-inset-bottom))', borderTop: `1px solid ${C.border}` }}>
                <div style={{ width: 38, height: 4, borderRadius: 2, background: C.border, margin: '6px auto 14px' }} />
                {([{ key: 'CLASSROOM', icon: 'clock' }, { key: 'LIVE_ARENA', icon: 'monitor' }, { key: 'DRIVE', icon: 'cloud' }] as {key: TabType, icon: string}[]).map(it => (
                  <button key={it.key} onClick={() => { setActiveTab(it.key); setMobileMoreOpen(false); }} style={{ width: '100%', textAlign: 'left', background: activeTab === it.key ? `${C.accent}12` : 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 12px', borderRadius: 12, color: C.text, fontSize: 15, fontWeight: 700 }}>
                    <Ico name={it.icon} size={20} color={activeTab === it.key ? C.accent : C.sub} /> {t('tab_' + it.key)}
                  </button>
                ))}
                <div style={{ height: 1, background: C.border, margin: '8px 0' }} />
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={() => i18n.changeLanguage(i18n.language === 'en' ? 'vi' : 'en')} style={{ flex: 1, background: C.bg, border: `1px solid ${C.border}`, cursor: 'pointer', padding: '12px', borderRadius: 12, color: C.text, fontSize: 14, fontWeight: 700 }}>{i18n.language === 'en' ? 'Tiếng Việt' : 'English'}</button>
                  <button onClick={handleLogout} style={{ flex: 1, background: `${C.err}12`, border: 'none', cursor: 'pointer', padding: '12px', borderRadius: 12, color: C.err, fontSize: 14, fontWeight: 800 }}>{t('exit')}</button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}'''

ANCHOR_BAR_OLD = '''              {i18n.language === 'en' ? 'Tiếng Việt' : 'English'}
          </button>
      )}
    </div>
  );
}'''

if "isMobile && !activeExam" in tpl:
    print("[=] R11 bottom bar: da co -> bo qua.")
elif ANCHOR_BAR_OLD in tpl:
    tpl = tpl.replace(ANCHOR_BAR_OLD, BAR, 1)
    print("[OK] R11 bottom tab bar + More sheet")
else:
    print("[X] R11: khong khop anchor cuoi component. Dung lai.")
    sys.exit(1)

with open(T, "w", encoding="utf-8") as f:
    f.write(tpl)

# ---------------------------------------------------------------- DASHBOARD.txt
if "DASHBOARD (MOBILE)" in dash:
    print("[=] DASHBOARD.txt: ban mobile da co -> bo qua.")
else:
    g_old = '        {activeTab === "DASHBOARD" && (\n          <div style={{ display: "grid", gridTemplateColumns: window.innerWidth > 900 ? "1fr 340px" : "1fr", gap: 32 }}>'
    g_new = '        {activeTab === "DASHBOARD" && !isMobile && (\n          <div style={{ display: "grid", gridTemplateColumns: window.innerWidth > 900 ? "1fr 340px" : "1fr", gap: 32 }}>'
    if g_old not in dash:
        print("[X] DASHBOARD.txt: khong khop block desktop. Dung lai.")
        sys.exit(1)
    dash = dash.replace(g_old, g_new, 1)

    MOBILE = r'''        {/* ================= DASHBOARD (MOBILE) ================= */}
        {activeTab === "DASHBOARD" && isMobile && (
          <div style={{ display: 'grid', gap: 14 }}>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '15px 16px' }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: C.sub, textTransform: 'uppercase', letterSpacing: 1 }}>{t('net_profit')}</div>
              <div style={{ fontFamily: 'var(--display)', fontSize: 31, fontWeight: 600, color: C.text, letterSpacing: -0.5, lineHeight: 1.15 }}>{fmtMoney(stats.net)}</div>
              <div style={{ fontSize: 12, color: C.succ, fontWeight: 700, marginTop: 2 }}>{t('total_revenue')}: {fmtMoney(stats.totalRev)}</div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '12px 13px' }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: C.sub, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('total_teaching_hours')}</div>
                <div style={{ fontFamily: 'var(--display)', fontSize: 22, fontWeight: 600, color: C.accent }}>{(history.reduce((s,h)=>s+((h && h.duration)||0),0)/3600).toFixed(1)}h</div>
              </div>
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '12px 13px' }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: C.sub, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('student_count')}</div>
                <div style={{ fontFamily: 'var(--display)', fontSize: 22, fontWeight: 600, color: C.text }}>{Array.isArray(students) ? students.length : 0}</div>
              </div>
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '12px 13px' }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: C.sub, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('total_debt')}</div>
                <div style={{ fontFamily: 'var(--display)', fontSize: 19, fontWeight: 600, color: C.warn }}>{fmtMoney(stats?.unpaid || 0)}</div>
              </div>
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: '12px 13px' }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: C.sub, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('drive_docs')}</div>
                <div style={{ fontFamily: 'var(--display)', fontSize: 22, fontWeight: 600, color: C.accent }}>{Array.isArray(sharedLinks) ? sharedLinks.length : 0}</div>
              </div>
            </div>

            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '14px 14px' }}>
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

            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '14px 14px' }}>
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
            </div>
          </div>
        )}

'''
    marker = '        {/* ================= CLASSROOM (GIAO DIỆN TÍNH GIỜ OFFLINE CŨ) ================= */}'
    if marker not in dash:
        print("[X] DASHBOARD.txt: khong thay moc CLASSROOM de chen. Dung lai.")
        sys.exit(1)
    dash = dash.replace(marker, MOBILE + marker, 1)
    with open(D, "w", encoding="utf-8") as f:
        f.write(dash)
    print("[OK] DASHBOARD.txt: da them ban mobile + gate desktop !isMobile")

print("\n[DONE] Chay lai compile + build.")
