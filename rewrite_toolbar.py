# -*- coding: utf-8 -*-
import io
p = "src/App.template.tsx"
c = io.open(p, "r", encoding="utf-8").read()

anchor_ret = "        }\n    };\n\n    return (\n        <div className=\"no-print\" style={{ border: '2px solid #ccc', borderRadius: 8, overflow: 'hidden', background: '#fff', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>"
assert anchor_ret in c, "ANCHOR return not found"

helpers = """        }
    };

    const tbBtn: React.CSSProperties = { background: '#fff', border: '1px solid #ced4da', padding: '0 8px', borderRadius: 5, color: '#24292f', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 30, height: 30, fontSize: 13, fontWeight: 800 };
    const tbSel: React.CSSProperties = { padding: '0 6px', fontSize: 12, height: 30, background: '#fff', border: '1px solid #ced4da', borderRadius: 5, color: '#24292f', cursor: 'pointer' };
    const Sep = () => <div style={{ width: 1, height: 20, background: '#dee2e6', margin: '0 3px' }} />;
    const SBtn = ({ cmd, val, title, children }: { cmd: string; val?: string; title: string; children: React.ReactNode }) => (
        <button type="button" onMouseDown={(e) => { e.preventDefault(); exec(cmd, val); }} style={tbBtn} title={title}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
        </button>
    );

    return (
        <div className="no-print" style={{ border: '2px solid #ccc', borderRadius: 8, overflow: 'hidden', background: '#fff', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>"""
c = c.replace(anchor_ret, helpers, 1)

tb_open = "<div style={{ display: 'flex', gap: 6, padding: '8px 12px', background: '#f8f9fa', borderBottom: '2px solid #ddd', flexWrap: 'wrap', alignItems: 'center' }}>"
i = c.index(tb_open) + len(tb_open)
j = c.index("<div ref={editorRef}", i)

new_buttons = """
                <SBtn cmd="undo" title="Hoan tac (Ctrl+Z)"><path d="M9 14L4 9l5-5"/><path d="M4 9h11a6 6 0 0 1 0 12h-4"/></SBtn>
                <SBtn cmd="redo" title="Lam lai (Ctrl+Y)"><path d="M15 14l5-5-5-5"/><path d="M20 9H9a6 6 0 0 0 0 12h4"/></SBtn>
                <Sep />
                <select onChange={(e) => { exec('formatBlock', e.target.value); e.currentTarget.selectedIndex = 0; }} style={{ ...tbSel, fontWeight: 700 }} title="Kieu chu / Tieu de">
                    <option value="">Kieu chu</option>
                    <option value="P">Van ban thuong</option>
                    <option value="H1">Tieu de 1</option>
                    <option value="H2">Tieu de 2</option>
                    <option value="H3">Tieu de 3</option>
                    <option value="BLOCKQUOTE">Trich dan</option>
                </select>
                <select onChange={(e) => { exec('fontName', e.target.value); e.currentTarget.selectedIndex = 0; }} style={tbSel} title="Phong chu">
                    <option value="">Phong</option>
                    <option value="Arial">Arial</option>
                    <option value="Georgia">Georgia</option>
                    <option value="'Times New Roman', serif">Times New Roman</option>
                    <option value="'Segoe UI', sans-serif">Segoe UI</option>
                    <option value="'Courier New', monospace">Courier New</option>
                </select>
                <select onChange={(e) => { exec('fontSize', e.target.value); e.currentTarget.selectedIndex = 0; }} style={tbSel} title="Co chu">
                    <option value="">Co</option>
                    <option value="1">10</option>
                    <option value="2">12</option>
                    <option value="3">14</option>
                    <option value="4">16</option>
                    <option value="5">18</option>
                    <option value="6">24</option>
                    <option value="7">32</option>
                </select>
                <Sep />
                <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('bold'); }} style={{ ...tbBtn, fontWeight: 900 }} title="Dam (Ctrl+B)">B</button>
                <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('italic'); }} style={{ ...tbBtn, fontStyle: 'italic', fontFamily: 'Georgia, serif' }} title="Nghieng (Ctrl+I)">I</button>
                <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('underline'); }} style={{ ...tbBtn, textDecoration: 'underline' }} title="Gach chan (Ctrl+U)">U</button>
                <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('strikeThrough'); }} style={{ ...tbBtn, textDecoration: 'line-through' }} title="Gach ngang">S</button>
                <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('superscript'); }} style={{ ...tbBtn, fontSize: 11 }} title="Chi so tren">X^2</button>
                <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('subscript'); }} style={{ ...tbBtn, fontSize: 11 }} title="Chi so duoi">X_2</button>
                <Sep />
                <label style={{ ...tbBtn, padding: '0 5px', position: 'relative' }} title="Mau chu"><span style={{ fontWeight: 900, borderBottom: '3px solid #d73a49', lineHeight: 1, paddingBottom: 1 }}>A</span>
                    <input type="color" defaultValue="#d73a49" onChange={(e) => exec('foreColor', e.target.value)} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }} />
                </label>
                <label style={{ ...tbBtn, padding: '0 5px', position: 'relative' }} title="Mau nen (highlight)"><span style={{ fontWeight: 900, background: '#fff3a0', padding: '0 3px', borderRadius: 2 }}>A</span>
                    <input type="color" defaultValue="#fff3a0" onChange={(e) => exec('hiliteColor', e.target.value)} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }} />
                </label>
                <Sep />
                <SBtn cmd="justifyLeft" title="Can trai"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></SBtn>
                <SBtn cmd="justifyCenter" title="Can giua"><line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="5" y1="18" x2="19" y2="18"/></SBtn>
                <SBtn cmd="justifyRight" title="Can phai"><line x1="3" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="6" y1="18" x2="21" y2="18"/></SBtn>
                <SBtn cmd="justifyFull" title="Can deu"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></SBtn>
                <Sep />
                <SBtn cmd="insertUnorderedList" title="Danh sach cham"><line x1="9" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="9" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1.4" fill="currentColor"/><circle cx="4" cy="12" r="1.4" fill="currentColor"/><circle cx="4" cy="18" r="1.4" fill="currentColor"/></SBtn>
                <SBtn cmd="insertOrderedList" title="Danh sach so"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 4h1v4M3 18h2.5M3.5 14h1.8c.7 0 .7 1 0 1.4L3.5 17"/></SBtn>
                <SBtn cmd="outdent" title="Giam thut le"><polyline points="7 8 3 12 7 16"/><line x1="21" y1="6" x2="11" y2="6"/><line x1="21" y1="12" x2="13" y2="12"/><line x1="21" y1="18" x2="11" y2="18"/></SBtn>
                <SBtn cmd="indent" title="Tang thut le"><polyline points="3 8 7 12 3 16"/><line x1="21" y1="6" x2="11" y2="6"/><line x1="21" y1="12" x2="13" y2="12"/><line x1="21" y1="18" x2="11" y2="18"/></SBtn>
                <Sep />
                <button type="button" onMouseDown={(e) => { e.preventDefault(); insertCustomTable(); }} style={{ ...tbBtn, background: '#e3f2fd', borderColor: '#90caf9', color: '#0d47a1', gap: 5, padding: '0 10px', minWidth: 'auto' }} title="Chen bang">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="1"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>Bang
                </button>
                <select onChange={(e) => { formatTableWidth(e.target.value); e.currentTarget.selectedIndex = 0; }} style={{ ...tbSel, background: '#fff7e6', borderColor: '#ffd591', color: '#d46b08', fontWeight: 700 }} title="Do rong bang">
                    <option value="">Rong bang</option>
                    <option value="auto">Vua noi dung</option>
                    <option value="50%">Hep (50%)</option>
                    <option value="70%">Vua (70%)</option>
                    <option value="100%">Toan (100%)</option>
                </select>
                <Sep />
                <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('removeFormat'); }} style={{ ...tbBtn, color: '#6c757d', minWidth: 'auto', padding: '0 8px' }} title="Xoa dinh dang">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7V4h16v3"/><path d="M5 20h6"/><path d="M13 4L8 20"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="21" y1="15" x2="15" y2="21"/></svg>
                </button>
            </div>
            """
c = c[:i] + new_buttons + c[j:]

io.open(p, "w", encoding="utf-8").write(c)
print("[OK] toolbar rewritten")
