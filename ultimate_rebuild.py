import os
import re

def get_smart_paths():
    current_dir = os.path.abspath(os.path.dirname(__file__))
    if os.path.basename(current_dir) == 'src':
        return (
            os.path.join(current_dir, "App.template.tsx"),
            os.path.join(current_dir, "App.tsx"),
            os.path.join(current_dir, "components_split", "EXAM_BUILDER.tsx")
        )
    else:
        return (
            os.path.join(current_dir, "src", "App.template.tsx"),
            os.path.join(current_dir, "src", "App.tsx"),
            os.path.join(current_dir, "src", "components_split", "EXAM_BUILDER.tsx")
        )

def execute_overhaul():
    template_path, output_path, exam_builder_path = get_smart_paths()

    print("🚀 ĐANG THỰC HIỆN ĐẠI TU TOÀN DIỆN HỆ THỐNG EXAM BUILDER...")

    # =========================================================================
    # 1. QUÉT SẠCH CSS CẢN TRỞ VÀ TIÊM KHIÊN BẢO VỆ ĐỊNH DẠNG VÀO TEMPLATE
    # =========================================================================
    if os.path.exists(template_path):
        with open(template_path, 'r', encoding='utf-8') as f:
            content = f.read()

        # Tiêu diệt các CSS rác chặn định dạng căn lề và bold
        content = re.sub(r'text-align:\s*left\s*!important;?', '', content)
        content = re.sub(r'display:\s*inline\s*!important;?', '', content)
        content = re.sub(r'font-weight:\s*400\s*!important;?', '', content)
        content = re.sub(r'font-weight:\s*normal\s*!important;?', '', content)
        
        # Tiêm khiên bảo vệ định dạng mới
        css_shield = """
          /* ========================================== */
          /* MỞ KHÓA TOÀN BỘ ĐỊNH DẠNG TỪ RICH TEXT EDITOR */
          /* ========================================== */
          b, strong, .exam-content-block b, .exam-content-block strong, .idp-q-text-inline b, .idp-q-text-inline strong { font-weight: 900 !important; }
          i, em, .exam-content-block i, .exam-content-block em { font-style: italic !important; }
          u, .exam-content-block u { text-decoration: underline !important; }
          .ql-align-center, [style*="text-align: center"] { text-align: center !important; display: block !important; }
          .ql-align-right, [style*="text-align: right"] { text-align: right !important; display: block !important; }
          .ql-align-justify, [style*="text-align: justify"] { text-align: justify !important; display: block !important; }
          .idp-text-content, .highlightable-content, .idp-q-text-inline { text-align: inherit; display: block !important; }
          .idp-q-text-inline p, .idp-q-text-inline div { display: block !important; margin-bottom: 0.5em; }
        """
        
        content = re.sub(r'/\* ========================================== \*/\s*/\* MỞ KHÓA TOÀN BỘ ĐỊNH DẠNG TỪ RICH TEXT EDITOR \*/[\s\S]*?}\s*', '', content)
        content = content.replace("</style>", css_shield + "\n</style>")

        with open(template_path, 'w', encoding='utf-8') as f:
            f.write(content)
        print("✅ [1/3] Đã dọn dẹp và mở khóa toàn bộ định dạng CSS (In đậm, Căn giữa, Khối đoạn văn).")

    # =========================================================================
    # 2. XÂY DỰNG LẠI HOÀN TOÀN FILE EXAM_BUILDER.TSX TỪ SỐ 0
    # =========================================================================
    exam_builder_content = """        {activeTab === "EXAM_BUILDER" && (() => {
            
            const currentPath = builderFolder;
            const childFolders = new Set<string>();
            const childQuizzes: any[] = [];

            const quizzesToProcess = builderSearch ? quizzes.filter((q: any) => (q.title||"").toLowerCase().includes(builderSearch.toLowerCase())) : quizzes;

            quizzesToProcess.forEach((q: any) => {
                const qPath = q.folder || "Root";
                if (builderSearch) {
                    childQuizzes.push(q);
                } else {
                    if (qPath === currentPath) {
                        childQuizzes.push(q);
                    } else if (qPath.startsWith(currentPath + "/")) {
                        const remainder = qPath.substring(currentPath.length + 1);
                        const nextFolder = remainder.split("/")[0];
                        childFolders.add(nextFolder);
                    }
                }
            });

            const getBuilderGroups = () => {
                if (!editingQuiz || !editingQuiz.questions) return [];
                const qs = editingQuiz.questions;
                const builderGroups: any[] = [];
                for (let i = 0; i < qs.length; i++) {
                    const q = qs[i];
                    if (q.type === 'CHOICE_MULTIPLE' || q.type === 'BLANK' || q.type === 'DRAG_DROP') {
                        let groupQuizzes = [q];
                        let groupContext = q.groupContext || "";
                        let j = i + 1;
                        while (j < qs.length && qs[j].type === q.type && qs[j].groupContext === groupContext) {
                            groupQuizzes.push(qs[j]);
                            j++;
                        }
                        builderGroups.push({ isGroup: true, groupType: q.type, groupContext: groupContext, instruction: q.instruction, startIndex: i, questions: groupQuizzes });
                        i = j - 1;
                    } else {
                        builderGroups.push({ isGroup: false, startIndex: i, questions: [q] });
                    }
                }
                return builderGroups;
            };

            const builderGroups = getBuilderGroups();

            return (
                <div style={{ display: 'flex', height: 'calc(100vh - 80px)' }}>
                    
                    {/* LEFT PANEL: QUẢN LÝ KHO ĐỀ THI */}
                    {!editingQuiz ? (
                        <div style={{flex: 1, padding: '30px 40px', overflowY: 'auto'}}>
                            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20}}>
                                <h2 style={{margin: 0}}>📂 KHO ĐỀ THI</h2>
                                <button onClick={() => setEditingQuiz({ title: "Đề thi mới", type: "Reading", active: false, folder: builderFolder, questions: [] })} style={{background: C.accent, color: '#fff', padding: '10px 20px', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 900}}>+ THÊM ĐỀ THI MỚI</button>
                            </div>
                            
                            <div style={{background: '#fff', borderRadius: 12, border: `1px solid ${C.border}`, overflow: 'hidden'}}>
                                <div style={{padding: '15px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', gap: 10, background: '#f8f9fa'}}>
                                    <button onClick={() => setBuilderFolder("Root")} style={{background: 'transparent', border: 'none', cursor: 'pointer', fontWeight: builderFolder === "Root" ? 800 : 500, color: builderFolder === "Root" ? C.accent : C.text}}>Root</button>
                                    {builderFolder !== "Root" && builderFolder.split("/").map((part: string, idx: number, arr: string[]) => {
                                        if(!part) return null;
                                        const path = arr.slice(0, idx + 1).join("/");
                                        return (
                                            <React.Fragment key={path}>
                                                <span style={{color: C.sub}}>/</span>
                                                <button onClick={() => setBuilderFolder(path)} style={{background: 'transparent', border: 'none', cursor: 'pointer', fontWeight: builderFolder === path ? 800 : 500, color: builderFolder === path ? C.accent : C.text}}>{part}</button>
                                            </React.Fragment>
                                        );
                                    })}
                                </div>
                                <div style={{padding: 20}}>
                                    {Array.from(childFolders).map(folder => (
                                        <div key={folder} onClick={() => setBuilderFolder(builderFolder === "Root" ? folder : `${builderFolder}/${folder}`)} style={{display: 'flex', alignItems: 'center', gap: 15, padding: 15, borderBottom: `1px solid ${C.border}`, cursor: 'pointer', transition: '0.2s'}}>
                                            <span style={{fontSize: 24}}>📁</span>
                                            <span style={{fontWeight: 700}}>{folder}</span>
                                        </div>
                                    ))}
                                    {childQuizzes.map(q => (
                                        <div key={q.id} style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 15, borderBottom: `1px solid ${C.border}`}}>
                                            <div style={{display: 'flex', alignItems: 'center', gap: 15}}>
                                                <span style={{fontSize: 24}}>📄</span>
                                                <div>
                                                    <div style={{fontWeight: 800, color: C.text, fontSize: 15}}>{q.title}</div>
                                                    <div style={{fontSize: 12, color: C.sub, marginTop: 4}}>{q.type} | {q.timeLimit} phút | {q.active ? <span style={{color: C.succ, fontWeight: 700}}>Active</span> : <span style={{color: C.warn}}>Draft</span>}</div>
                                                </div>
                                            </div>
                                            <div style={{display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end'}}>
                                                <button onClick={() => setKeyEditingQuiz(q)} style={{background: `${C.warn}15`, color: C.warn, padding: '6px 12px', fontSize: 12, border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700}}>🔑 Sửa Key</button>
                                                <button onClick={() => setEditingQuiz(JSON.parse(JSON.stringify(q)))} style={{background: C.accent, color: '#fff', padding: '6px 15px', fontSize: 12, border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700}}>Sửa đề</button>
                                            </div>
                                        </div>
                                    ))}
                                    {childFolders.size === 0 && childQuizzes.length === 0 && <div style={{textAlign: 'center', color: C.sub, padding: 50, fontStyle: 'italic'}}>Thư mục này rỗng.</div>}
                                </div>
                            </div>
                        </div>
                    ) : (
                        
                        /* RIGHT PANEL: BỘ SOẠN THẢO SIÊU TỐI ƯU VÀ CHỐNG MẤT DỮ LIỆU */
                        <div style={{flex: 1, overflowY: 'auto', padding: '30px 40px', scrollBehavior: 'smooth', background: '#F8F9FA'}}>
                            
                            {/* HEADER BẢNG ĐIỀU KHIỂN */}
                            <div className="no-print" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, background: '#fff', padding: 24, borderRadius: 16, boxShadow: '0 4px 15px rgba(0,0,0,0.05)', border: `1px solid ${C.border}`}}>
                                <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, flex: 1, marginRight: 40}}>
                                    <div><label style={{fontSize: 10, fontWeight: 800, color: C.sub}}>TÊN ĐỀ THI</label><input className="idp-input" value={editingQuiz.title} onChange={(e: any)=>setEditingQuiz((prev: any) => ({...prev, title: e.target.value}))} style={{width: '100%', padding: '10px 14px', fontSize: 14}} /></div>
                                    <div><label style={{fontSize: 10, fontWeight: 800, color: C.sub}}>DẠNG BÀI</label><select className="idp-input" value={editingQuiz.type} onChange={(e: any)=>setEditingQuiz((prev: any) => ({...prev, type: e.target.value}))} style={{width: '100%', padding: '10px 14px', fontSize: 14}}><option value="Listening">Listening</option><option value="Reading">Reading</option><option value="Writing">Writing</option><option value="Integrated">Integrated</option></select></div>
                                    <div><label style={{fontSize: 10, fontWeight: 800, color: C.sub}}>THƯ MỤC</label><input className="idp-input" value={editingQuiz.folder || ""} onChange={(e: any)=>setEditingQuiz((prev: any) => ({...prev, folder: e.target.value}))} placeholder="VD: Root/IELTS_2026" style={{width: '100%', padding: '10px 14px', fontSize: 14}} /></div>
                                    <div style={{display: 'flex', gap: 16}}>
                                        <div style={{flex: 1}}><label style={{fontSize: 10, fontWeight: 800, color: C.sub}}>THỜI GIAN (PHÚT)</label><input type="number" className="idp-input" value={editingQuiz.timeLimit || 0} onChange={(e: any)=>setEditingQuiz((prev: any) => ({...prev, timeLimit: Number(e.target.value)}))} style={{width: '100%', padding: '10px 14px', fontSize: 14}} /></div>
                                        <div style={{display: 'flex', alignItems: 'center', gap: 8, marginTop: 15}}><input type="checkbox" checked={editingQuiz.active || false} onChange={(e: any)=>setEditingQuiz((prev: any) => ({...prev, active: e.target.checked}))} style={{width: 20, height: 20}}/><label style={{fontSize: 13, fontWeight: 800}}>Hiển thị cho Học viên</label></div>
                                    </div>
                                </div>
                                <div style={{display: 'flex', flexDirection: 'column', gap: 10}}>
                                    <button onClick={handleSaveQuiz} style={{background: C.accent, color: '#fff', padding: '14px 30px', fontSize: 15, border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 900, boxShadow: `0 4px 15px ${C.accent}40`}}>LƯU ĐỀ THI</button>
                                    <button onClick={() => setEditingQuiz(null)} style={{background: 'transparent', color: C.text, padding: '10px 30px', fontSize: 14, border: `1px solid ${C.border}`, borderRadius: 8, cursor: 'pointer', fontWeight: 700}}>HỦY/QUAY LẠI</button>
                                </div>
                            </div>

                            {/* CẤU TRÚC PASSAGE 1-2-3 */}
                            <div className="no-print" style={{ marginBottom: 24, background: '#fff', padding: 24, borderRadius: 16, border: `1px solid ${C.border}` }}>
                                <div style={{ fontSize: 12, fontWeight: 900, color: C.text, marginBottom: 16, letterSpacing: 0.5 }}>📖 SOẠN THẢO BÀI ĐỌC / TRANSCRIPT (PASSAGE 1 - 2 - 3)</div>
                                <div style={{ display: 'inline-flex', background: '#E2E8F0', padding: 4, borderRadius: 10, gap: 4, marginBottom: 16 }}>
                                    {[0, 1, 2].map((idx) => (
                                        <button key={idx} type="button" onClick={() => setBuilderSectionIndex(idx)} style={{ padding: '8px 20px', fontSize: 13, borderRadius: 8, border: 'none', background: builderSectionIndex === idx ? '#fff' : 'transparent', color: builderSectionIndex === idx ? '#000' : C.sub, boxShadow: builderSectionIndex === idx ? '0 1px 3px rgba(0,0,0,0.1)' : 'none', fontWeight: builderSectionIndex === idx ? 800 : 600, cursor: 'pointer' }}>Passage {idx + 1}</button>
                                    ))}
                                </div>
                                <RichTextEditor value={builderSectionIndex === 0 ? (editingQuiz.passage || "") : (editingQuiz.sections?.[builderSectionIndex]?.passage || "")} onChange={(v: string) => setEditingQuiz((prev: any) => {
                                    if (!prev) return prev;
                                    if (builderSectionIndex === 0) return { ...prev, passage: v };
                                    const nextSecs = [...(prev.sections || [])];
                                    while(nextSecs.length <= builderSectionIndex) nextSecs.push({ passage: "", questions: [] });
                                    nextSecs[builderSectionIndex] = { ...nextSecs[builderSectionIndex], passage: v };
                                    return { ...prev, sections: nextSecs };
                                })} />
                            </div>

                            {/* DANH SÁCH NHÓM CÂU HỎI */}
                            <div style={{display: 'grid', gap: 24}}>
                                {builderGroups.map((grp: any, gIndex: number) => {
                                    const qIndex = grp.startIndex;
                                    const q = grp.questions[0];

                                    // LÕI BẢO MẬT STALE CLOSURE: Đảm bảo gõ chữ siêu nhanh không bị mất dữ liệu
                                    const updateGroup = (groupUpdater: (qItem: any, offsetIndex: number) => any) => {
                                        setEditingQuiz((prev: any) => {
                                            if (!prev) return prev;
                                            const updatedQuestions = [...prev.questions];
                                            grp.questions.forEach((_: any, offset: number) => {
                                                const globalIdx = qIndex + offset;
                                                updatedQuestions[globalIdx] = groupUpdater(prev.questions[globalIdx], offset);
                                            });
                                            return { ...prev, questions: updatedQuestions };
                                        });
                                    };

                                    const handleRemoveGroup = () => {
                                        if (confirm("Chắc chắn xóa nhóm câu hỏi này?")) {
                                            setEditingQuiz((prev: any) => {
                                                if (!prev) return prev;
                                                const updatedQuestions = prev.questions.filter((_: any, i: number) => i < qIndex || i >= qIndex + grp.questions.length);
                                                return { ...prev, questions: updatedQuestions };
                                            });
                                        }
                                    };

                                    const handleMoveGroup = (dir: number) => {
                                        setEditingQuiz((prev: any) => {
                                            if (!prev) return prev;
                                            const newQs = [...prev.questions];
                                            const targetGrp = builderGroups[gIndex + dir];
                                            if (!targetGrp) return prev;
                                            const block1 = newQs.splice(qIndex, grp.questions.length);
                                            const targetIndex = dir < 0 ? targetGrp.startIndex : targetGrp.startIndex + targetGrp.questions.length - grp.questions.length;
                                            newQs.splice(targetIndex, 0, ...block1);
                                            return { ...prev, questions: newQs };
                                        });
                                    };

                                    return (
                                    <div key={`group-${qIndex}`} style={{background: '#fff', padding: 24, borderRadius: 16, border: `1px solid ${C.border}`, boxShadow: '0 2px 8px rgba(0,0,0,0.03)'}}>
                                        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderBottom: `1px solid ${C.border}`, paddingBottom: 12}}>
                                            <div style={{fontSize: 14, fontWeight: 900, color: C.accent}}>{grp.isGroup ? `NHÓM: ${grp.groupType} (Câu ${qIndex + 1} - ${qIndex + grp.questions.length})` : `Câu ${qIndex + 1} (${q.type})`}</div>
                                            <div style={{display: 'flex', gap: 8}}>
                                                <button onClick={() => handleMoveGroup(-1)} disabled={gIndex === 0} style={{padding: '6px 12px', background: '#f8f9fa', border: `1px solid ${C.border}`, borderRadius: 6, cursor: gIndex === 0 ? 'not-allowed' : 'pointer', fontWeight: 600}}>⬆ Lên</button>
                                                <button onClick={() => handleMoveGroup(1)} disabled={gIndex === builderGroups.length - 1} style={{padding: '6px 12px', background: '#f8f9fa', border: `1px solid ${C.border}`, borderRadius: 6, cursor: gIndex === builderGroups.length - 1 ? 'not-allowed' : 'pointer', fontWeight: 600}}>⬇ Xuống</button>
                                                <button onClick={handleRemoveGroup} style={{padding: '6px 12px', background: `${C.err}15`, color: C.err, border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 800}}>🗑 Xóa</button>
                                            </div>
                                        </div>

                                        <div style={{display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 20}}>
                                            <div>
                                                <label style={{ fontSize: 11, fontWeight: 800, color: C.sub, display: 'block', marginBottom: 6 }}>📝 HƯỚNG DẪN LÀM BÀI (INSTRUCTION)</label>
                                                <input value={q.instruction || ""} onChange={(e: any) => updateGroup((qIt: any) => ({ ...qIt, instruction: e.target.value }))} placeholder="VD: Choose the correct letter, A, B, C or D..." style={{ width: '100%', padding: '10px 14px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 8, background: '#f8f9fa' }} />
                                            </div>

                                            {(q.type === "BLANK" || q.type === "DRAG_DROP") && (
                                                <div>
                                                    <label style={{ fontSize: 11, fontWeight: 800, color: C.accent, display: 'block', marginBottom: 6 }}>📝 ĐOẠN VĂN ĐIỀN TỪ (Gõ [1], [2]... để tạo ô trống)</label>
                                                    <RichTextEditor value={q.groupContext || ""} onChange={(v: string) => updateGroup((qIt: any) => ({ ...qIt, groupContext: v }))} />
                                                </div>
                                            )}
                                        </div>

                                        <label style={{ fontSize: 11, fontWeight: 900, color: C.text, display: 'block', marginBottom: 12 }}>⚙️ CẤU HÌNH CHI TIẾT TỪNG CÂU:</label>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
                                            {grp.questions.map((qItem: any, offset: number) => {
                                                const qNum = qIndex + 1 + offset;
                                                const isMissing = qItem.type === "BLANK" && !(q.groupContext || "").includes(`[${qNum}]`);
                                                return (
                                                    <div key={qItem.id} style={{ background: '#f8f9fa', padding: 16, borderRadius: 12, border: `1px solid ${C.border}` }}>
                                                        <div style={{ fontWeight: 900, fontSize: 13, marginBottom: 12, display: 'flex', justifyContent: 'space-between' }}>
                                                            <span>Câu {qNum}</span>
                                                            {isMissing && <span style={{color: C.err, fontSize: 11}}>⚠️ Thiếu [{qNum}]</span>}
                                                        </div>
                                                        <div style={{display: 'flex', flexDirection: 'column', gap: 12}}>
                                                            <div>
                                                                <label style={{fontSize: 10, fontWeight: 800, color: C.sub, marginBottom: 4, display: 'block'}}>NỘI DUNG CÂU HỎI</label>
                                                                <input value={qItem.text || ""} onChange={(e: any) => setEditingQuiz((prev: any) => {
                                                                    if (!prev) return prev;
                                                                    const nq = [...prev.questions];
                                                                    nq[qIndex + offset] = { ...nq[qIndex + offset], text: e.target.value };
                                                                    return { ...prev, questions: nq };
                                                                })} placeholder="Nội dung text..." style={{width: '100%', padding: '8px 12px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 6, background: '#fff'}} />
                                                            </div>
                                                            {qItem.type === "CHOICE" && (
                                                                <div>
                                                                    <label style={{fontSize: 10, fontWeight: 800, color: C.sub, marginBottom: 4, display: 'block'}}>CÁC LỰA CHỌN</label>
                                                                    <div style={{display: 'flex', flexDirection: 'column', gap: 6}}>
                                                                        {(qItem.options || []).map((opt: string, optIdx: number) => (
                                                                            <div key={optIdx} style={{display: 'flex', gap: 6}}>
                                                                                <span style={{fontWeight: 800, width: 20, textAlign: 'center', lineHeight: '28px'}}>{String.fromCharCode(65 + optIdx)}</span>
                                                                                <input value={opt} onChange={(e: any) => setEditingQuiz((prev: any) => {
                                                                                    if (!prev) return prev;
                                                                                    const nq = [...prev.questions];
                                                                                    const opts = [...(nq[qIndex + offset].options || [])];
                                                                                    opts[optIdx] = e.target.value;
                                                                                    nq[qIndex + offset] = { ...nq[qIndex + offset], options: opts };
                                                                                    return { ...prev, questions: nq };
                                                                                })} style={{flex: 1, padding: '4px 8px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 4}} />
                                                                                <button onClick={() => setEditingQuiz((prev: any) => {
                                                                                    if (!prev) return prev;
                                                                                    const nq = [...prev.questions];
                                                                                    const opts = [...(nq[qIndex + offset].options || [])];
                                                                                    opts.splice(optIdx, 1);
                                                                                    nq[qIndex + offset] = { ...nq[qIndex + offset], options: opts };
                                                                                    return { ...prev, questions: nq };
                                                                                })} style={{background: C.err, color: '#fff', border: 'none', borderRadius: 4, padding: '0 8px', cursor: 'pointer'}}>×</button>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                    <button onClick={() => setEditingQuiz((prev: any) => {
                                                                        if (!prev) return prev;
                                                                        const nq = [...prev.questions];
                                                                        const opts = [...(nq[qIndex + offset].options || []), ""];
                                                                        nq[qIndex + offset] = { ...nq[qIndex + offset], options: opts };
                                                                        return { ...prev, questions: nq };
                                                                    })} style={{marginTop: 6, fontSize: 11, background: `${C.succ}20`, color: C.succ, border: 'none', padding: '4px 8px', borderRadius: 4, cursor: 'pointer', fontWeight: 800}}>+ Thêm lựa chọn</button>
                                                                </div>
                                                            )}
                                                            <div>
                                                                <label style={{fontSize: 10, fontWeight: 800, color: C.sub, marginBottom: 4, display: 'block'}}>ĐÁP ÁN ĐÚNG</label>
                                                                <input value={qItem.correctAnswer || ""} onChange={(e: any) => updateGroup((qIt: any, o: number) => o === offset ? { ...qIt, correctAnswer: e.target.value } : qIt)} placeholder="Nhập đáp án đúng..." style={{width: '100%', padding: '8px 12px', fontSize: 13, border: `1px solid ${C.succ}`, borderRadius: 6, background: '#fff', fontWeight: 900, color: C.succ}} />
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                    );
                                })}

                                <div style={{background: '#fff', padding: 24, borderRadius: 16, border: `2px dashed ${C.border}`, textAlign: 'center'}}>
                                    <div style={{fontSize: 14, fontWeight: 900, color: C.text, marginBottom: 15}}>+ THÊM CÂU HỎI MỚI VÀO ĐỀ</div>
                                    <div style={{display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap'}}>
                                        <button onClick={() => handleAddQuestion("CHOICE")} style={{background: '#f8f9fa', border: `1px solid ${C.border}`, padding: '10px 20px', borderRadius: 8, cursor: 'pointer', fontWeight: 700}}>Trắc nghiệm (Choice)</button>
                                        <button onClick={() => handleAddQuestion("BLANK")} style={{background: '#f8f9fa', border: `1px solid ${C.border}`, padding: '10px 20px', borderRadius: 8, cursor: 'pointer', fontWeight: 700}}>Điền từ (Blank)</button>
                                        <button onClick={() => handleAddQuestion("MATCHING")} style={{background: '#f8f9fa', border: `1px solid ${C.border}`, padding: '10px 20px', borderRadius: 8, cursor: 'pointer', fontWeight: 700}}>Nối đáp án (Matching)</button>
                                        <button onClick={() => handleAddQuestion("DRAG_DROP")} style={{background: '#f8f9fa', border: `1px solid ${C.border}`, padding: '10px 20px', borderRadius: 8, cursor: 'pointer', fontWeight: 700}}>Kéo thả (Drag & Drop)</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )
        })()}"""

    if os.path.exists(os.path.dirname(exam_builder_path)):
        with open(exam_builder_path, 'w', encoding='utf-8') as f:
            f.write(exam_builder_content)
        print("✅ [2/3] Đã tái thiết hoàn toàn EXAM_BUILDER: Chữa dứt điểm lỗi mất dữ liệu khi gõ, làm phẳng giao diện.")

    # =========================================================================
    # 3. RÁP NỐI VÀ XUẤT BẢN APP.TSX MỚI NHẤT
    # =========================================================================
    components_dir = os.path.dirname(exam_builder_path)
    if os.path.exists(components_dir):
        with open(template_path, 'r', encoding='utf-8') as f:
            app_content = f.read()

        for filename in sorted(os.listdir(components_dir)):
            if filename.endswith('.tsx') or filename.endswith('.txt'):
                comp_path = os.path.join(components_dir, filename)
                with open(comp_path, 'r', encoding='utf-8') as cf:
                    comp_code = cf.read()

                placeholder_with_nl = f"/*INSERT_{os.path.splitext(filename)[0].upper()}*/\n"
                placeholder_bare    = f"/*INSERT_{os.path.splitext(filename)[0].upper()}*/"

                if placeholder_with_nl in app_content:
                    app_content = app_content.replace(placeholder_with_nl, comp_code)
                elif placeholder_bare in app_content:
                    app_content = app_content.replace(placeholder_bare, comp_code)

        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(app_content)
        print("✅ [3/3] Ráp file hoàn chỉnh. Mọi thay đổi nội dung, định dạng, Passage đã sẵn sàng hoạt động.")

if __name__ == "__main__":
    execute_overhaul()