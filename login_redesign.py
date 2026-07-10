# -*- coding: utf-8 -*-
import io
p = "src/App.template.tsx"
c = io.open(p, "r", encoding="utf-8").read()

start = c.index('      <div className="mesh-bg"')
end = c.index('\n    );\n  }\n\n  if (!loaded)')

new_jsx = r'''      <div style={{ minHeight: "100vh", display: "flex", position: "relative", overflow: "hidden", background: "#fff" }}>
        {globalStyles}
        <style>{`
          @media (max-width: 900px){ .login-hero{ display:none !important; } }
          .login-feat{ display:flex; align-items:center; gap:11px; font-size:14.5px; color:rgba(255,255,255,0.92); font-weight:600; }
          .login-input{ width:100%; padding:14px 16px; font-size:15px; border:1.5px solid #e3e6ea; border-radius:12px; background:#f7f8fa; outline:none; transition:border-color .15s, box-shadow .15s; box-sizing:border-box; color:#1a1a1a; }
          .login-input:focus{ border-color:#4338ca; background:#fff; box-shadow:0 0 0 4px rgba(67,56,202,0.12); }
          .login-submit:hover{ transform:translateY(-1px); box-shadow:0 12px 26px rgba(67,56,202,0.4) !important; }
        `}</style>

        <div className="login-hero" style={{ flex: "1.1 1 0", position: "relative", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "56px 60px", color: "#fff", background: "linear-gradient(140deg, #1e3a8a 0%, #4338ca 52%, #7c3aed 100%)", overflow: "hidden" }}>
            <div style={{ position: "absolute", width: 460, height: 460, borderRadius: "50%", background: "radial-gradient(circle, rgba(255,255,255,0.16), transparent 70%)", top: -150, right: -110 }} />
            <div style={{ position: "absolute", width: 340, height: 340, borderRadius: "50%", background: "radial-gradient(circle, rgba(124,58,237,0.5), transparent 70%)", bottom: -120, left: -70 }} />
            <div style={{ position: "relative", zIndex: 2, display: "flex", alignItems: "center", gap: 13 }}>
                <div style={{ width: 48, height: 48, borderRadius: 14, background: "rgba(255,255,255,0.16)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 25, border: "1px solid rgba(255,255,255,0.28)" }}>I</div>
                <span style={{ fontSize: 21, fontWeight: 800, letterSpacing: -0.3 }}>IELTS OS</span>
            </div>
            <div style={{ position: "relative", zIndex: 2 }}>
                <h1 style={{ fontSize: 46, lineHeight: 1.08, fontWeight: 800, margin: "0 0 20px", letterSpacing: -1.4 }}>Nền tảng luyện thi<br/>IELTS thế hệ mới.</h1>
                <p style={{ fontSize: 16, lineHeight: 1.7, color: "rgba(255,255,255,0.82)", maxWidth: 480, margin: "0 0 34px" }}>Thi thử trên máy chuẩn IDP, chấm điểm tự động, quản lý lớp học và học phí — gói gọn trong một hệ thống duy nhất.</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    {["Giao diện thi computer-based chuẩn IDP", "Chấm điểm tức thì & phân tích chi tiết", "Chống gian lận với Safe Exam Browser"].map((txt, k) => (
                        <div key={k} className="login-feat">
                            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={{ background: "rgba(255,255,255,0.18)", borderRadius: 7, padding: 4, flexShrink: 0 }}><polyline points="20 6 9 17 4 12"/></svg>
                            {txt}
                        </div>
                    ))}
                </div>
            </div>
            <div style={{ position: "relative", zIndex: 2, fontSize: 13, color: "rgba(255,255,255,0.62)" }}>© {new Date().getFullYear()} IELTS OS — Computer-based Testing Platform</div>
        </div>

        <div style={{ flex: "0.9 1 0", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 28px" }}>
            <form onSubmit={handleLogin} style={{ width: 400, maxWidth: "100%" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 30 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 12, background: "linear-gradient(135deg, #4338ca, #7c3aed)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 21 }}>I</div>
                    <span style={{ fontSize: 17, fontWeight: 800, color: C.text }}>IELTS OS</span>
                </div>
                <h2 style={{ fontSize: 30, fontWeight: 800, color: C.text, margin: "0 0 8px", letterSpacing: -0.6 }}>Đăng nhập</h2>
                <p style={{ color: C.sub, fontSize: 14.5, margin: "0 0 30px" }}>Chào mừng quay lại. Vui lòng nhập thông tin đăng nhập của bạn.</p>
                {loginError && <div style={{ background: "rgba(255,59,48,0.1)", color: C.err, padding: "12px 14px", borderRadius: 12, fontSize: 13, marginBottom: 22, fontWeight: 600, textAlign: "center" }}>{loginError}</div>}
                <div style={{ display: "grid", gap: 18 }}>
                    <div>
                        <label style={{ fontSize: 12.5, fontWeight: 700, color: C.text, marginBottom: 8, display: "block" }}>{t('email_label')}</label>
                        <input className="login-input" type="email" value={email} onChange={(e: any) => setEmail(e.target.value)} required placeholder="name@example.com" />
                    </div>
                    <div>
                        <label style={{ fontSize: 12.5, fontWeight: 700, color: C.text, marginBottom: 8, display: "block" }}>{t('pwd_label')}</label>
                        <div style={{ position: "relative" }}>
                            <input className="login-input" type={showPwd ? "text" : "password"} value={password} onChange={(e: any) => setPassword(e.target.value)} required placeholder="********" style={{ paddingRight: 46 }} />
                            <button type="button" onClick={() => setShowPwd(!showPwd)} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: 6, color: C.sub, display: "flex" }} title="Hien / an mat khau">
                                {showPwd
                                    ? <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                                    : <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                }
                            </button>
                        </div>
                    </div>
                    <button type="submit" className="login-submit" style={{ background: "linear-gradient(135deg, #4338ca, #7c3aed)", color: "#fff", padding: "15px", marginTop: 10, fontSize: 16, fontWeight: 700, borderRadius: 13, border: "none", cursor: "pointer", boxShadow: "0 8px 22px rgba(67,56,202,0.32)", transition: "transform .12s, box-shadow .12s" }}>{t('login_btn')}</button>
                </div>
            </form>
        </div>
      </div>'''

c = c[:start] + new_jsx + c[end:]
io.open(p, "w", encoding="utf-8").write(c)
print("[OK] login redesigned")
