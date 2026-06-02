import React, { useState, useEffect, useRef, useMemo } from "react";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, onSnapshot, setDoc } from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, type User } from "firebase/auth";

const firebaseConfig = { apiKey: "AIzaSyA48L2oDMyYlsQUVfp7YUh3u1p7vA2NJN0", authDomain: "ielts-os.firebaseapp.com", projectId: "ielts-os", storageBucket: "ielts-os.firebasestorage.app", messagingSenderId: "205768597474", appId: "1:205768597474:web:7427d4cbae2d3a8d49a3b", measurementId: "G-NW0X6QDL6W" };
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const DB_DOC_REF = doc(db, "ielts_workspace", "trung_linh_data");
const LIVE_DOC_REF = doc(db, "ielts_workspace", "live_arena");

// ==========================================
// TRUE TIME ENGINE V2 (BẤT TỬ & CHỐNG HACK)
// ==========================================
let serverBaseTime = Date.now();
let performanceBase = performance.now();
let isTimeSynced = false;

const syncTimeNetwork = async () => {
    try {
        // Tuyệt chiêu: Lấy giờ từ chính server Host web thông qua HTTP Header (Bỏ qua API, không thể bị chặn)
        const res = await fetch(window.location.origin, { method: 'HEAD', cache: 'no-store' });
        const dateHeader = res.headers.get('Date');
        if (dateHeader) {
            serverBaseTime = new Date(dateHeader).getTime();
            performanceBase = performance.now();
            isTimeSynced = true;
            return;
        }
        
        // Backup API nếu cách 1 lỗi
        const fallback = await fetch("https://timeapi.io/api/Time/current/zone?timeZone=Asia/Ho_Chi_Minh");
        const data = await fallback.json();
        serverBaseTime = new Date(data.dateTime + "+07:00").getTime();
        performanceBase = performance.now();
        isTimeSynced = true;
    } catch (e) {
        console.error("CẢNH BÁO: Mạng bị cô lập, rơi về giờ Windows.");
    }
};

const getTrueTime = () => {
    if (!isTimeSynced) return Date.now();
    return serverBaseTime + (performance.now() - performanceBase);
};

// HÀM KHÓA MÚI GIỜ: Ép mọi thao tác tính toán lịch thi về đúng GMT+7 (Việt Nam)
const parseVNTime = (dateStr: string) => {
    if (!dateStr) return 0;
    const cleanStr = dateStr.length === 16 ? `${dateStr}:00` : dateStr; 
    const vnDateStr = cleanStr.includes('Z') || cleanStr.includes('+') ? cleanStr : `${cleanStr}+07:00`;
    return new Date(vnDateStr).getTime();
};

import i18n from "i18next";
import { initReactI18next, useTranslation } from "react-i18next";

// ==========================================
// I18N DICTIONARY CONFIGURATION (LANGUAGE HUB)
// ==========================================
const resources = {
  en: {
    translation: {
      login_title: "IELTS OS",
      login_subtitle: "Professional Learning Management System",
      login_btn: "LOGIN TO SYSTEM",
      email_label: "EMAIL",
      pwd_label: "PASSWORD",
      wrong_credentials: "Wrong email or password!",
      logout: "Logout",
      exit: "Exit",
      sync_ok: "Sync: OK",
      sync_ing: "Syncing...",
      last_login: "Last login:",
      student_title: "STUDENT PORTAL",
      teacher_title: "TEACHER PORTAL",
      welcome_morning: "Good morning",
      welcome_afternoon: "Good afternoon",
      welcome_evening: "Good evening",
      welcome_back: "Welcome back to IELTS OS online learning space.",
      total_hours: "TOTAL HOURS STUDIED",
      avg_band: "AVERAGE BAND SCORE",
      total_quizzes: "TOTAL SUBMITTED TESTS",
      vocab_notebook: "MY VOCABULARY NOTEBOOK",
      no_vocab: "You haven't saved any words yet. Highlight text in tests to save!",
      performance_chart: "Performance Chart (Last 5 Tests)",
      upcoming_class: "UPCOMING SCHEDULE",
      instructor: "Instructor",
      location: "Location",
      current_progress: "CURRENT LEVEL PROGRESS",
      current_cefr: "CURRENT CEFR",
      target_band: "TARGET BAND",
      test_room_title: "AVAILABLE TESTS (TEST ROOM)",
      filter_quizzes: "Filter quizzes...",
      no_quizzes: "There are currently no active tests assigned to you.",
      previous_attempts: "Attempts",
      time_limit: "mins",
      questions_count: "questions",
      status_locked: "Locked",
      status_available: "Available",
      status_closed: "Closed (Expired)",
      status_no_attempts: "No attempts left",
      enter_exam: "START TEST",
      not_available: "Unavailable",
      test_results_title: "TEST HISTORY & RESULTS",
      view_review: "Review",
      drive_hub_title: "Resource Hub (Drive)",
      open_download: "Open / Download",
      no_shared_links: "No documents have been shared yet.",
      class_history_title: "Session Logs & Feedback",
      no_history: "No learning sessions recorded yet.",
      tuition_paid: "Paid",
      tuition_debt: "Unpaid Debt",
      no_additional_notes: "No additional notes.",
      fullscreen_warning: "FULLSCREEN REQUIRED",
      fullscreen_desc: "The system requires fullscreen mode to ensure the best experience and fairness. Please click the button below to return to your test.",
      fullscreen_btn: "CLICK HERE TO RETURN",
      cheat_warning_title: "YOU HAVE LEFT THE EXAM SCREEN!",
      cheat_warning_desc: "The system has recorded a violation. Please type RETURN into the box below to unlock your test.",
      cheat_input_placeholder: "Type here...",
      cheat_unlock_btn: "UNLOCK",
      time_up_title: "TIME IS UP!",
      time_up_desc: "The system will automatically submit your test in:",
      playing_audio: "Playing",
      ended_audio: "Audio Finished",
      play_audio_btn: "Play Audio",
      volume_title: "Volume",
      focus_mode_btn: "Focus",
      submit_test_btn: "SUBMIT",
      exit_focus_mode: "Exit Focus Mode",
      reading_passage_title: "READING PASSAGE",
      font_btn: "Aa Font",
      lines_btn: "Lines",
      paper_btn: "Paper",
      align_btn: "Align",
      spacing_btn: "Spacing",
      scratchpad_placeholder: "Type notes here (Auto-saved). Press Ctrl+Enter to insert timestamp...",
      scratchpad_close: "Close Notes",
      scratchpad_open: "Open Scratchpad",
      flag_title: "Flag this question",
      clear_choice: "Clear answer",
      word_count: "Word count",
      words_label: "words",
      hide_note: "Hide note",
      show_note: "Note this question",
      note_placeholder: "Private note for this question (only visible to you)...",
      question_board: "QUESTION NAVIGATOR",
      answered_label: "Answered",
      unanswered_label: "Unanswered"
    }
  },
  vi: {
    translation: {
      login_title: "IELTS OS",
      login_subtitle: "Hệ thống Quản lý Học tập Chuyên nghiệp",
      login_btn: "ĐĂNG NHẬP HỆ THỐNG",
      email_label: "EMAIL",
      pwd_label: "MẬT KHẨU",
      wrong_credentials: "Sai email hoặc mật khẩu!",
      logout: "Đăng xuất",
      exit: "Thoát",
      sync_ok: "Sync: OK",
      sync_ing: "Syncing...",
      last_login: "Đăng nhập gần nhất:",
      student_title: "STUDENT PORTAL",
      teacher_title: "TEACHER PORTAL",
      welcome_morning: "buổi sáng",
      welcome_afternoon: "buổi chiều",
      welcome_evening: "buổi tối",
      welcome_back: "Chào mừng quay lại không gian học tập trực tuyến IELTS OS.",
      total_hours: "TỔNG GIỜ ĐÃ HỌC",
      avg_band: "BAND ĐIỂM TRUNG BÌNH",
      total_quizzes: "TỔNG BÀI THI ĐÃ NỘP",
      vocab_notebook: "SỔ TAY TỪ VỰNG CỦA TÔI",
      no_vocab: "Bạn chưa lưu từ nào. Quét đen chữ trong bài thi để lưu!",
      performance_chart: "Biểu đồ năng lực (5 Test Gần Nhất)",
      upcoming_class: "📅 LỊCH HỌC SẮP TỚI CỦA BẠN",
      instructor: "Giáo viên",
      location: "Địa điểm",
      current_progress: "TIẾN ĐỘ LEVEL HIỆN TẠI",
      current_cefr: "CEFR HIỆN TẠI",
      target_band: "MỤC TIÊU",
      test_room_title: "📝 BÀI KIỂM TRA ĐANG MỞ (TEST ROOM)",
      filter_quizzes: "🔍 Lọc bài thi...",
      no_quizzes: "Hiện không có bài test nào được mở cho bạn.",
      previous_attempts: "Đã làm",
      time_limit: "phút",
      questions_count: "câu",
      status_locked: "Đã khóa",
      status_available: "Đang mở",
      status_closed: "Đã khóa (Hết hạn)",
      status_no_attempts: "Hết lượt",
      enter_exam: "VÀO THI",
      not_available: "Chưa thể thi",
      test_results_title: "KẾT QUẢ CÁC BÀI ĐÃ THI:",
      view_review: "Xem lại",
      drive_hub_title: "📂 Kho Tài Liệu (Drive)",
      open_download: "Mở / Tải xuống",
      no_shared_links: "Chưa có tài liệu nào được chia sẻ.",
      class_history_title: "Lịch sử buổi học & Nhận xét",
      no_history: "Chưa có buổi học nào được ghi nhận.",
      tuition_paid: "Đã thanh toán",
      tuition_debt: "Nợ học phí",
      no_additional_notes: "Không có ghi chú thêm.",
      fullscreen_warning: "⚠️ YÊU CẦU TOÀN MÀN HÌNH",
      fullscreen_desc: "Hệ thống bắt buộc phải hiển thị ở chế độ toàn màn hình để đảm bảo trải nghiệm và tính công bằng. Vui lòng bấm nút bên dưới để quay lại bài thi.",
      fullscreen_btn: "BẤM VÀO ĐÂY ĐỂ QUAY LẠI",
      cheat_warning_title: "BẠN ĐÃ RỜI KHỎI MÀN HÌNH THI!",
      cheat_warning_desc: "Hệ thống đã ghi lại vi phạm. Vui lòng gõ QUAY LẠI vào ô bên dưới để mở khóa bài thi.",
      cheat_input_placeholder: "Nhập vào đây...",
      cheat_unlock_btn: "MỞ KHÓA",
      time_up_title: "HẾT GIỜ LÀM BÀI!",
      time_up_desc: "Hệ thống sẽ tự động thu bài sau:",
      playing_audio: "Đang phát",
      ended_audio: "Đã nghe xong",
      play_audio_btn: "Phát Audio",
      volume_title: "Chỉnh âm lượng",
      focus_mode_btn: "Focus",
      submit_test_btn: "NỘP BÀI",
      exit_focus_mode: "⤢ Thoát Focus Mode",
      reading_passage_title: "READING PASSAGE",
      font_btn: "Aa Font",
      lines_btn: "☰ Số dòng",
      paper_btn: "🌙 Giấy",
      align_btn: "⫸ Căn lề",
      spacing_btn: "↕ Dòng",
      scratchpad_placeholder: "Nhập nháp ở đây (Lưu tự động). Bấm Ctrl+Enter để chèn mốc thời gian...",
      scratchpad_close: "Đóng nháp",
      scratchpad_open: "Mở Giấy Nháp",
      flag_title: "Đánh dấu câu này",
      clear_choice: "✗ Bỏ chọn đáp án",
      word_count: "Word count",
      words_label: "từ",
      hide_note: "Ẩn ghi chú",
      show_note: "Ghi chú câu này",
      note_placeholder: "Ghi chú riêng cho câu này (chỉ mình bạn thấy)...",
      question_board: "SA BÀN CÂU HỎI",
      answered_label: "Đã làm",
      unanswered_label: "Chưa làm"
    }
  }
};

i18n.use(initReactI18next).init({
  resources,
  lng: "en", // Ép cứng toàn hệ thống sang Tiếng Anh theo yêu cầu của sếp
  fallbackLng: "en",
  interpolation: { escapeValue: false }
});

// ==========================================
// TYPES & INTERFACES
// ==========================================
type TabType = "DASHBOARD" | "CLASSROOM" | "STUDENTS" | "DRIVE" | "EXAM_BUILDER" | "LIVE_ARENA" | "ACADEMICS" | "FINANCE" | "HISTORY";

const TEACHERS = ["Trương Thanh Trung", "Vi Thị Khánh Linh"];
const SKILLS = ["Reading", "Listening", "Speaking", "Writing", "Grammar & Vocab", "Mock Test"];
const QUICK_NOTES = ["Well done", "Improve pronunciation", "Homework incomplete", "Great reflexes", "Expand vocabulary", "Grammar needs work", "Significant progress"];

interface Student { id: string; name: string; phone: string; rate: number; target: string; cefr: string; exp: number; level: number; email?: string; savedVocabs?: string[]; isPinned?: boolean; privateMessage?: string; dob?: string; coins?: number; myRewards?: string[]; inventory?: { consumables: Record<string, number>; permanents: string[]; equippedTitle?: string; equippedTheme?: string; reviewedQuizzes?: string[]; }; lastLoginDate?: string; currentStreak?: number; currentSessionId?: string; activeExamId?: string; debtMessage?: string; pendingNotifications?: {id: string, title: string, body: string}[]; }
interface Rubric { vocab: string; grammar: string; fluency: string; task: string; }
interface Session { id: string | number; studentId: string; studentName: string; teacher: string; skills: string[]; date: string; duration: number; rate: number; earnings: number; notes: string; rubric: Rubric; isPaid: boolean; }
interface Schedule { id: string; date: string; time: string; teacher: string; studentId: string; studentName: string; subject: string; location: string; }
interface SharedLink { id: string; title: string; url: string; date: string; audience: "TEACHERS" | "ALL_STUDENTS" | "SPECIFIC_STUDENT"; targetStudentId: string; targetStudentName: string; }
interface Transaction { id: string; title: string; amount: number; date: string; type: "INCOME" | "EXPENSE"; }
interface SystemLog { id: string; errorType: string; message: string; context?: string; timestamp: string; email?: string; }

type QuestionType = "CHOICE" | "BLANK" | "CHOICE_MULTIPLE" | "MATCHING" | "DRAG_DROP";
interface QuizQuestion { id: string; type: QuestionType; subType?: string; instruction?: string; groupContext?: string; text: string; options?: string[]; correctAnswer: string | number; }
interface Quiz { id: string; title: string; type: "Reading" | "Listening" | string; timeLimit: number; maxAttempts: number; questions: QuizQuestion[]; active: boolean; passage?: string; images?: string[]; audioUrl?: string; audience?: "ALL" | "SPECIFIC"; targetStudentIds?: string[]; scheduledStart?: string; scheduledEnd?: string; isLocked?: boolean; passcode?: string; internalNote?: string; tag?: string; isSEBRequired?: boolean; }
interface QuizResult { id: string; quizId: string; quizTitle: string; studentId: string; studentName: string; date: string; score: number; total: number; band: number | string; cheatCount: number; startTime?: string; endTime?: string; durationSeconds?: number; deviceInfo?: string; ipAddress?: string; teacherFeedback?: string; answers: Record<string, string | number>; scratchpad?: string; flaggedQuestions?: string[]; isRead?: boolean; }
interface LiveSession { id: string; studentId: string; studentName: string; quizId: string; quizTitle: string; answeredCount: number; totalQ: number; lastUpdate: number; isCheating: boolean; progressPct: number; }

// ==========================================
// UTILS
// ==========================================
const formatContent = (html: string) => {
    if (!html) return "";
    let res = html.replace(/\[Image\s*\d+\]/gi, '');
    
    // BẢN VÁ 1: Thêm (src=["'])? để kiểm tra xem link đã nằm trong thẻ <img> chưa. Nếu có rồi thì BỎ QUA không bọc thêm nữa!
    res = res.replace(/(src=["'])?(?:Url:\s*|<p>Url:\s*)?(https?:\/\/[^\s<"']+(?:\.jpg|\.jpeg|\.png|\.gif|\.webp))(?:<\/p>)?/gi, (match, p1, p2) => {
        if (p1) return match; // Đã là hình ảnh, bỏ qua
        return `<img src="${p2}" style="max-width: 100%; border-radius: 8px; display: block; margin: 15px 0;" alt="Visual Content" />`;
    });
    
    res = res.replace(/\[IMAGE\]\s*(https?:\/\/[^\s<"']+)/gi, (match, p1) => {
        return `<img src="${p1}" style="max-width: 100%; border-radius: 8px; display: block; margin: 15px 0;" alt="Visual Content" />`;
    });
    
    // ==========================================
    // AUTO-CONTRAST ENGINE 
    // ==========================================
    res = res.replace(/<font[^>]+color="[^"]*"[^>]*>(.*?)<\/font>/gi, '<span>$1</span>');
    res = res.replace(/(<[^>]+) style="([^"]*)"/gi, (_match, p1, p2) => {
        let newStyle = p2.replace(/(?:^|;)\s*color\s*:[^;]+;?/gi, ';');
        newStyle = newStyle.replace(/(?:^|;)\s*background(?:-color)?\s*:[^;]+;?/gi, ';');
        newStyle = newStyle.replace(/^;+|;+$/g, '').trim(); 
        if (newStyle === "") return p1;
        return `${p1} style="${newStyle}"`;
    });

    const mediaDict = (window as any).__ielts_offline_media;
    if (mediaDict) {
        Object.entries(mediaDict).forEach(([orig, blob]) => {
            if (orig && blob && typeof orig === "string" && typeof blob === "string") {
                res = res.split(orig).join(blob);
            }
        });
    }

    const uid = (window as any).__ielts_user_id || "Candidate";
    const phantomTrap = `<span class="no-print" style="position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; color: transparent; font-size: 1px; user-select: all;">[Đề thi bị đánh cắp từ IELTS OS. Định danh học viên: ${uid}]</span>`;
    
    // BẢN VÁ 2: Chỉ tiêm bẫy tàng hình nếu đoạn text chưa có bẫy (Chống nhân bản DOM)
    if (!res.includes('[Đề thi bị đánh cắp')) {
        res = res.replace(/<\/p>/gi, `${phantomTrap}</p>`);
    }
    
    return res;
};
const obfuscateHTML = (html?: string) => html || "";
const createTestUIQuiz = (q: Quiz): Quiz => {
    return {
        ...q,
        title: "🔐 ENCRYPTED UI TEST MODE",
        passage: obfuscateHTML(q.passage || ""),
        audioUrl: "https://actions.google.com/sounds/v1/alarms/beep_short.ogg", 
        questions: q.questions.map(qst => ({
            ...qst,
            text: obfuscateHTML(qst.text),
            instruction: obfuscateHTML(qst.instruction || ""),
            groupContext: obfuscateHTML(qst.groupContext || ""),
            // Khôi phục lại Options để Test giao diện đánh trắc nghiệm đầy đủ
            options: qst.options?.map(opt => obfuscateHTML(opt)),
            correctAnswer: qst.type === "CHOICE" ? 0 : "███"
        }))
    };
};
// ==========================================
// COMPONENT: BỘ ĐỆM BẢO VỆ DOM (DOM SHIELD)
// Khóa chặt HTML tĩnh thành Component độc lập. Ngăn chặn tuyệt đối React re-render phá DOM.
// ==========================================
const StaticHtmlBlock = React.memo(({ html, className, dataField, dataQid, style }: any) => {
    return <div className={className} data-field={dataField} data-qid={dataQid} style={style} dangerouslySetInnerHTML={{__html: html}} />;
}, (prevProps, nextProps) => prevProps.html === nextProps.html);

// ==========================================
// COMPONENT: RICH TEXT EDITOR (GOOGLE DOCS VERSION)
// ==========================================
const RichTextEditor = ({ value, onChange, placeholder }: { value: string, onChange: (v: string) => void, placeholder?: string }) => {
    const editorRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // MAGIC FIX: Chỉ đồng bộ dữ liệu từ cha xuống con nếu ô Editor đang KHÔNG ĐƯỢC FOCUS
        if (editorRef.current && value !== editorRef.current.innerHTML && document.activeElement !== editorRef.current) {
            editorRef.current.innerHTML = value;
        }
    }, [value]);

    const triggerChange = () => {
        if (editorRef.current && editorRef.current.innerHTML !== value) {
            onChange(editorRef.current.innerHTML);
        }
    };

    const exec = (cmd: string, val: string | undefined = undefined) => {
        document.execCommand(cmd, false, val);
        triggerChange();
    };

    const formatTableWidth = (widthStyle: string) => {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return;
        let node: Node | null = selection.getRangeAt(0).startContainer;
        while (node && node !== editorRef.current) {
            if (node.nodeType === 1 && (node as HTMLElement).tagName === "TABLE") {
                const tbl = node as HTMLTableElement;
                tbl.style.width = widthStyle;
                if (widthStyle !== "100%") {
                    tbl.style.marginLeft = "auto";
                    tbl.style.marginRight = "auto";
                }
                triggerChange();
                break;
            }
            node = node.parentNode;
        }
    };

    const insertCustomTable = () => {
        const rStr = prompt("Enter number of rows:", "3");
        const cStr = prompt("Enter number of columns:", "3");
        const r = parseInt(rStr || "0");
        const c = parseInt(cStr || "0");
        if (r > 0 && c > 0) {
            let tblHtml = `<table style="width: 100%; border-collapse: collapse; margin: 15px auto;" border="1">`;
            for (let i = 0; i < r; i++) {
                tblHtml += "<tr>";
                for (let j = 0; j < c; j++) {
                    tblHtml += `<td style="padding: 8px; border: 1px solid #ccc; min-width: 50px;">&nbsp;</td>`;
                }
                tblHtml += "</tr>";
            }
            tblHtml += "</table><p>&nbsp;</p>";
            exec("insertHTML", tblHtml);
        }
    };

    return (
        <div className="no-print" style={{ border: '2px solid #ccc', borderRadius: 8, overflow: 'hidden', background: '#fff', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
            <div style={{ display: 'flex', gap: 6, padding: '8px 12px', background: '#f8f9fa', borderBottom: '2px solid #ddd', flexWrap: 'wrap', alignItems: 'center' }}>
                <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('bold'); }} style={{ fontWeight: 'bold', background: '#fff', border: '1px solid #ced4da', padding: '4px 10px', borderRadius: 4, color: '#000' }} title="Bold">B</button>
                <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('italic'); }} style={{ fontStyle: 'italic', background: '#fff', border: '1px solid #ced4da', padding: '4px 10px', borderRadius: 4, color: '#000' }} title="Italic">I</button>
                <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('underline'); }} style={{ textDecoration: 'underline', background: '#fff', border: '1px solid #ced4da', padding: '4px 10px', borderRadius: 4, color: '#000' }} title="Underline">U</button>
                <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('strikeThrough'); }} style={{ textDecoration: 'line-through', background: '#fff', border: '1px solid #ced4da', padding: '4px 10px', borderRadius: 4, color: '#000' }} title="Strikethrough">S</button>
                
                <div style={{ width: 1, height: 20, background: '#dee2e6', margin: '0 4px' }} />

                <select onChange={(e) => exec('foreColor', e.target.value)} style={{ width: 'auto', padding: '4px', fontSize: 12, height: 28, background: '#fff', borderColor: '#ced4da' }} title="Text color">
                    <option value="#000000">🖤 Black</option>
                    <option value="#0366d6">💙 Blue</option>
                    <option value="#28a745">💚 Green</option>
                    <option value="#d73a49">❤️ Red</option>
                    <option value="#f6a821">💛 Yellow</option>
                </select>

                <select onChange={(e) => exec('hiliteColor', e.target.value)} style={{ width: 'auto', padding: '4px', fontSize: 12, height: 28, background: '#fff', borderColor: '#ced4da' }} title="Background color">
                    <option value="transparent">⚪ No background</option>
                    <option value="#fffa9e">💛 Yellow</option>
                    <option value="#c3e6cb">💚 Green</option>
                    <option value="#f5c6cb">❤️ Red</option>
                    <option value="#b8daff">💙 Blue</option>
                </select>

                <select onChange={(e) => exec('fontSize', e.target.value)} style={{ width: 'auto', padding: '4px', fontSize: 12, height: 28, background: '#fff', borderColor: '#ced4da' }} title="Font size">
                    <option value="3">Size 14px</option>
                    <option value="1">Size 10px</option>
                    <option value="2">Size 12px</option>
                    <option value="4">Size 16px</option>
                    <option value="5">Size 18px</option>
                    <option value="6">Size 24px</option>
                    <option value="7">Size 32px</option>
                </select>

                <div style={{ width: 1, height: 20, background: '#dee2e6', margin: '0 4px' }} />

                <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('justifyLeft'); }} style={{ background: '#fff', border: '1px solid #ced4da', padding: '4px 8px', borderRadius: 4, color: '#000' }} title="Align left">⬅️</button>
                <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('justifyCenter'); }} style={{ background: '#fff', border: '1px solid #ced4da', padding: '4px 8px', borderRadius: 4, color: '#000' }} title="Align center">居中</button>
                <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('justifyRight'); }} style={{ background: '#fff', border: '1px solid #ced4da', padding: '4px 8px', borderRadius: 4, color: '#000' }} title="Align right">➡️</button>
                <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('justifyFull'); }} style={{ background: '#fff', border: '1px solid #ced4da', padding: '4px 8px', borderRadius: 4, color: '#000' }} title="Justify">⫸</button>

                <div style={{ width: 1, height: 20, background: '#dee2e6', margin: '0 4px' }} />

                <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('insertUnorderedList'); }} style={{ background: '#fff', border: '1px solid #ced4da', padding: '4px 8px', borderRadius: 4, color: '#000' }} title="Unordered list">• List</button>
                <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('insertOrderedList'); }} style={{ background: '#fff', border: '1px solid #ced4da', padding: '4px 8px', borderRadius: 4, color: '#000' }} title="Ordered list">1. List</button>

                <div style={{ width: 1, height: 20, background: '#dee2e6', margin: '0 4px' }} />

                <button type="button" onMouseDown={(e) => { e.preventDefault(); insertCustomTable(); }} style={{ background: '#e3f2fd', border: '1px solid #90caf9', padding: '4px 10px', borderRadius: 4, color: '#0d47a1', fontWeight: 'bold' }} title="Insert Table">📊 Insert Table</button>
                
                <select onChange={(e) => formatTableWidth(e.target.value)} style={{ width: 'auto', padding: '4px', fontSize: 12, height: 28, background: '#fff7e6', borderColor: '#ffd591', color: '#d46b08', fontWeight: 'bold' }} title="Change Table Width">
                    <option value="">⚙️ Table Width...</option>
                    <option value="auto">Auto-fit content</option>
                    <option value="50%">Compact (50%)</option>
                    <option value="70%">Standard (70%)</option>
                    <option value="100%">Full width (100%)</option>
                </select>
                
                <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('removeFormat'); }} style={{ background: '#fff', border: '1px solid #ced4da', padding: '4px 8px', borderRadius: 4, color: '#6c757d', fontSize: 11 }} title="Clear formatting">✗ Clear formatting</button>
            </div>
            <div ref={editorRef} contentEditable suppressContentEditableWarning onBlur={triggerChange} onInput={triggerChange} style={{ minHeight: 180, padding: 16, outline: 'none', whiteSpace: 'pre-wrap', color: '#000', background: '#fff', lineHeight: 1.6 }} data-placeholder={placeholder || "Paste or type content here..."} />
        </div>
    );
};

export default function IeltsSupremeOS() {
  const { t, i18n } = useTranslation();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userRole, setUserRole] = useState<"TEACHER" | "STUDENT" | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [activeTab, setActiveTab] = useState<TabType>("DASHBOARD");
  const [theme, setTheme] = useState<"light" | "dark">(localStorage.getItem('ielts_theme') === 'dark' ? 'dark' : 'light');
  const [colorblind, setColorblind] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [studentIp, setStudentIp] = useState<string>("Loading...");
  const [isOffline, setIsOffline] = useState(false);
  const [announcement, setAnnouncement] = useState<string>("");
  const [lastLoginTime, setLastLoginTime] = useState<string>("");
  const [timeOffset, setTimeOffset] = useState<number>(0);
  const [isTimeSynced, setIsTimeSynced] = useState(true);
  const [liveTime, setLiveTime] = useState(""); 
  const getRealTime = () => getTrueTime() + timeOffset;

  const [students, setStudents] = useState<Student[]>([]);
  const [history, setHistory] = useState<Session[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [sharedLinks, setSharedLinks] = useState<SharedLink[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [quizResults, setQuizResults] = useState<QuizResult[]>([]);
  const [bannedIps, setBannedIps] = useState<string[]>([]);
  const [liveSessions, setLiveSessions] = useState<LiveSession[]>([]);
  const [systemLogs, setSystemLogs] = useState<SystemLog[]>([]); 
  const [serverStatus, setServerStatus] = useState<"OK" | "DOWN">("OK"); 
 // ========================================================
  // BẮT ĐẦU FIX: BẢO VỆ TUYỆT ĐỐI KHỎI LỖI UNDEFINED LENGTH
  // ========================================================
 const getNavigatorGroups = () => {
      // KIỂM TRA ĐÚNG CHUẨN ARRAY TRƯỚC KHI ĐỌC LENGTH
      const qs = activeExam?.questions;
      if (!Array.isArray(qs) || qs.length === 0) return [];

      const totalQs = qs.length;
      const type = String(activeExam?.type || "").toLowerCase();
      const groups: { title: string, questions: any[], startIndex: number }[] = [];

      if (type.includes("read") && totalQs === 40) {
          groups.push({ title: "Passage 1", questions: qs.slice(0, 13), startIndex: 0 });
          groups.push({ title: "Passage 2", questions: qs.slice(13, 26), startIndex: 13 });
          groups.push({ title: "Passage 3", questions: qs.slice(26, 40), startIndex: 26 });
          return groups;
      }

      let chunkSize = 10;
      let prefix = "Part";

      if (type.includes("listen")) {
          prefix = "Section";
          chunkSize = 10;
      } else if (totalQs > 40 && totalQs <= 50) {
          prefix = "Part";
          chunkSize = 10;
      } else if (totalQs <= 20) {
          prefix = "Group";
          chunkSize = 5;
      } else {
          prefix = "Group";
          chunkSize = 10;
      }

      for (let i = 0; i < totalQs; i += chunkSize) {
          const end = Math.min(i + chunkSize, totalQs);
          groups.push({
              title: `${prefix} ${Math.floor(i / chunkSize) + 1}`,
              questions: qs.slice(i, end),
              startIndex: i
          });
      }
      
      return groups;
  };
  const navGroups = getNavigatorGroups();
  // ========================================================
  // KẾT THÚC FIX
  // ========================================================
  const syncHighlightState = (prev: any, field: string, qId: string, cleanHTML: string, optIndex: string | null) => {
      if (!prev) return null;
      if (field === 'passage') return { ...prev, passage: cleanHTML };
      if (qId) {
          const nQ = prev.questions.map((q: any) => {
              if (q.id === qId) {
                  if (field === 'options' && optIndex !== null) {
                      const newOpts = [...(q.options || [])];
                      newOpts[parseInt(optIndex)] = cleanHTML;
                      return { ...q, options: newOpts };
                  }
                  return { ...q, [field]: cleanHTML };
              }
              return q;
          });
          return { ...prev, questions: nQ };
      }
      return prev;
  };
  const [selStudent, setSelStudent] = useState("");
  const [selSkills, setSelSkills] = useState<string[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const intervalRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const accTimeRef = useRef<number>(0);
  const [showManualTime, setShowManualTime] = useState(false);
  const [manualMin, setManualMin] = useState("");
  const [manualSec, setManualSec] = useState("");

  const [newSt, setNewSt] = useState<Partial<Student>>({ name: "", rate: 300000, target: "6.5", cefr: "B2", email: "", privateMessage: "", dob: "" });
  const [editStId, setEditStId] = useState<string | null>(null);
  const [searchSt, setSearchSt] = useState(""); 
  const [filterUnpaid, setFilterUnpaid] = useState(false); 
  const [sortStudentBy, setSortStudentBy] = useState<"NAME"|"EXP"|"DEBT">("NAME");
  const [newTrans, setNewTrans] = useState({ title: "", amount: 0 });
  const [calcScore, setCalcScore] = useState<number | "">("");
  
  const [selectedSessions, setSelectedSessions] = useState<string[]>([]);
  const [selectedResults, setSelectedResults] = useState<string[]>([]);
  const [selectedQuizzes, setSelectedQuizzes] = useState<string[]>([]); 

  const [newLink, setNewLink] = useState({ title: "", url: "" });
  const [linkAudience, setLinkAudience] = useState<"TEACHERS" | "ALL_STUDENTS" | "SPECIFIC_STUDENT">("ALL_STUDENTS");
  const [linkTargetId, setLinkTargetId] = useState("");
  const [calDate, setCalDate] = useState(new Date());
  const [viewDate, setViewDate] = useState(new Date().toISOString().split('T')[0]);
  const [showSchedForm, setShowSchedForm] = useState(false);
  const [schedForm, setSchedForm] = useState({ time: "08:00", location: "Online", studentId: "" });

  const [editingQuiz, setEditingQuiz] = useState<Quiz | null>(null);
  const [keyEditingQuiz, setKeyEditingQuiz] = useState<Quiz | null>(null);
  const [activeExam, setActiveExam] = useState<Quiz | null>(null);
  const [pendingExamState, setPendingExamState] = useState<{quiz: Quiz, isPreview: boolean, isStudentTestUI: boolean} | null>(null);
  const trueEndTimeRef = useRef<number>(0);
  const [examAnswers, setExamAnswers] = useState<Record<string, any>>({});
  const [qNotes, setQNotes] = useState<Record<string, string>>({}); 
  const [flaggedQuestions, setFlaggedQuestions] = useState<string[]>([]);
  const [crossedOptions, setCrossedOptions] = useState<Record<string, number>>({}); 
  
  const [examTimeLeft, setExamTimeLeft] = useState(0);
  const [examCheatCount, setExamCheatCount] = useState(0);
  const [splitRatio, setSplitRatio] = useState<number>(50);
  const [isDraggingSplitter, setIsDraggingSplitter] = useState(false);
  const [examStartTime, setExamStartTime] = useState<number>(0);
  const [scratchpadText, setScratchpadText] = useState("");
  const [showScratchpad, setShowScratchpad] = useState(false);
  const [reviewQuiz, setReviewQuiz] = useState<{quiz: Quiz, result: QuizResult} | null>(null);
  const [showCelebration, setShowCelebration] = useState(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [_pendingAudioResume, setPendingAudioResume] = useState<{time: number, status: string} | null>(null);
  const [gracePeriod, setGracePeriod] = useState<number | null>(null);

  const [_isFocusMode, setIsFocusMode] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(true);

  const [isWindowFocused, setIsWindowFocused] = useState(true);
  useEffect(() => {
      const onFocus = () => setIsWindowFocused(true);
      const onBlur = () => setIsWindowFocused(false);
      window.addEventListener('focus', onFocus);
      window.addEventListener('blur', onBlur);
      return () => { window.removeEventListener('focus', onFocus); window.removeEventListener('blur', onBlur); };
  }, []);
  const [, setAudioTested] = useState(false);
  const [audioStatus, setAudioStatus] = useState<"IDLE" | "PLAYING" | "ENDED">("IDLE");
  const [audioVolume, setAudioVolume] = useState<number>(1);
  const [hideTimer, setHideTimer] = useState(false);
  const [timeAlert, setTimeAlert] = useState("");
  const [isSepia, _setIsSepia] = useState(localStorage.getItem('ielts_pref_sepia') === 'true');
  const [fontSize, setFontSize] = useState<number>(Number(localStorage.getItem('ielts_pref_fontsize')) || 16);
  const [lineHeight, setLineHeight] = useState<number>(Number(localStorage.getItem('ielts_pref_lineheight')) || 1.8);
  const [textAlign, setTextAlign] = useState<"justify" | "left">((localStorage.getItem('ielts_pref_align') as any) || "justify");
  const [showLineNumbers, setShowLineNumbers] = useState(localStorage.getItem('ielts_pref_lines') === 'true');
  const [fontFam, setFontFam] = useState<"sans-serif" | "serif">((localStorage.getItem('ielts_pref_fontfam') as any) || "serif");
  const [saveStatus, setSaveStatus] = useState<string>("Saved");
  const [isPreview, setIsPreview] = useState(false);
  const [resultSearch, setResultSearch] = useState("");
  const [printBlankSheet, setPrintBlankSheet] = useState(false);
  const [hardLocked, setHardLocked] = useState(false);
  const [screenshotFlash, setScreenshotFlash] = useState(false);
  const screenshotFlashRef = useRef<number | null>(null);
  const [sebGuideQuiz, setSebGuideQuiz] = useState<Quiz | null>(null);
     // ==================== FOCUS RESTORATION (FIX BLANK INPUT FOCUS LOSS) ====================
  const lastFocusedInputIdRef = useRef<string | null>(null);
  const isRestoringRef = useRef(false);
  const restoreTimeoutRef = useRef<number | null>(null);

  // Lưu lại id của inline-blank-input đang được focus
  useEffect(() => {
    if (!activeExam) return;
    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (target.classList && target.classList.contains('inline-blank-input')) {
        const qId = target.getAttribute('data-qid');
        if (qId) lastFocusedInputIdRef.current = qId;
      }
    };
    document.addEventListener('focusin', handleFocusIn);
    return () => document.removeEventListener('focusin', handleFocusIn);
  }, [activeExam]);
  // =========================================================
  // BẢN VÁ: DOM-SAFE HIGHLIGHT REMOVAL (BẢO VỆ HÌNH ẢNH)
  // =========================================================
  useEffect(() => {
      const handleSafeHighlightRemoval = (e: MouseEvent) => {
          const target = e.target as HTMLElement;
          
          // Nhận diện thẻ highlight (Sửa 'MARK' thành class của bạn nếu bạn đang dùng span.idp-highlight)
          const isHighlightNode = target && (target.tagName === 'MARK' || target.classList?.contains('idp-highlight'));
          
          if (isHighlightNode) {
              // 1. CHẶN ĐỨNG sự kiện truyền xuống để tắt cái hàm xóa bị lỗi cũ của bạn
              e.preventDefault();
              e.stopPropagation();
              
              const parent = target.parentNode;
              if (!parent) return;

              // 2. THUẬT TOÁN RÚT RUỘT: Kéo toàn bộ text, hình ảnh ra ngoài nguyên vẹn
              while (target.firstChild) {
                  parent.insertBefore(target.firstChild, target);
              }
              
              // 3. Tiêu hủy cái vỏ highlight
              parent.removeChild(target);
              
              // 4. Dọn dẹp DOM, ghép các node text bị chẻ nhỏ lại để bảo vệ Focus chuột
              parent.normalize();
          }
      };

      // Dùng tham số true (Capture Phase) để bắt sự kiện trước khi code cũ của bạn kịp chạy
      document.addEventListener('click', handleSafeHighlightRemoval, true);
      document.addEventListener('contextmenu', handleSafeHighlightRemoval, true);

      return () => {
          document.removeEventListener('click', handleSafeHighlightRemoval, true);
          document.removeEventListener('contextmenu', handleSafeHighlightRemoval, true);
      };
  }, []);
  // Đồng bộ giá trị và khôi phục focus sau mỗi lần examAnswers thay đổi
  useEffect(() => {
    if (!activeExam) return;
    if (isRestoringRef.current) return;
    isRestoringRef.current = true;

    if (restoreTimeoutRef.current) clearTimeout(restoreTimeoutRef.current);

    restoreTimeoutRef.current = window.setTimeout(() => {
      const inputs = document.querySelectorAll('.inline-blank-input') as NodeListOf<HTMLInputElement>;
      let targetInput: HTMLInputElement | null = null;

      inputs.forEach(input => {
        const qId = input.getAttribute('data-qid');
        if (!qId) return;

        const stateVal = examAnswers[qId] !== undefined ? String(examAnswers[qId]) : "";
        if (!input.hasAttribute('data-dirty') && input.value !== stateVal) {
          input.value = stateVal;
        }

        if (lastFocusedInputIdRef.current === qId && document.activeElement !== input) {
          targetInput = input;
        }
      });
      const dropzones = document.querySelectorAll('.idp-dropzone') as NodeListOf<HTMLElement>;
      dropzones.forEach(dz => {
        const qId = dz.getAttribute('data-qid');
        if (!qId) return;
        const stateVal = examAnswers[qId] !== undefined ? String(examAnswers[qId]) : "";
        const displayVal = stateVal || dz.getAttribute('data-placeholder') || "";
        if (dz.textContent !== displayVal) {
            dz.textContent = displayVal;
            if (stateVal) dz.classList.add('filled');
            else dz.classList.remove('filled');
        }
      });
      if (targetInput && document.activeElement !== targetInput) {
        setTimeout(() => {
          if (targetInput && document.activeElement !== targetInput) {
            targetInput.focus();
            const len = targetInput.value.length;
            targetInput.setSelectionRange(len, len);
            lastFocusedInputIdRef.current = null;
          }
        }, 10);
      }

      isRestoringRef.current = false;
      restoreTimeoutRef.current = null;
    }, 5);
  }, [activeExam, examAnswers]);
  const [offlineMedia, setOfflineMedia] = useState<Record<string, string>>({});
  const [isOfflineReady, setIsOfflineReady] = useState(false);

  useEffect(() => { (window as any).__ielts_offline_media = offlineMedia; }, [offlineMedia]);

  useEffect(() => {
      if (!activeExam || isPreview || userRole !== "STUDENT") {
          setOfflineMedia({});
          setIsOfflineReady(false);
          return;
      }
      let isMounted = true;
      const urlsToCache = new Set<string>();

      if (activeExam.audioUrl) urlsToCache.add(activeExam.audioUrl);
      if (activeExam.images) activeExam.images.forEach(img => urlsToCache.add(img));

      const extractImgUrls = (html: string) => {
          if (!html) return;
          const matches = Array.from(html.matchAll(/<img[^>]+src="([^">]+)"/gi));
          for (const m of matches) {
              if (m[1] && m[1].startsWith('http')) urlsToCache.add(m[1]);
          }
      };

      const oldDict = (window as any).__ielts_offline_media;
      (window as any).__ielts_offline_media = null;

      extractImgUrls(formatContent(activeExam.passage || ""));
      activeExam.questions.forEach(q => {
          extractImgUrls(formatContent(q.text || ""));
          extractImgUrls(formatContent(q.instruction || ""));
          extractImgUrls(formatContent(q.groupContext || ""));
          q.options?.forEach(opt => extractImgUrls(formatContent(opt || "")));
      });

      (window as any).__ielts_offline_media = oldDict;

      const urls = Array.from(urlsToCache);
      if (urls.length === 0) { setIsOfflineReady(true); return; }

      const cacheAssets = async () => {
          let loadedCount = 0;
          for (const url of urls) {
              if (url.startsWith('blob:')) continue;
              try {
                  const res = await fetch(url);
                  const blob = await res.blob();
                  if (isMounted) setOfflineMedia(prev => ({ ...prev, [url]: URL.createObjectURL(blob) }));
              } catch (e) { console.warn("Background auto-download error:", url); }
              loadedCount++;
          }
          if (isMounted && loadedCount === urls.length) setIsOfflineReady(true);
      };
      cacheAssets();
      return () => { isMounted = false; };
  }, [activeExam?.id]);

  const [showInventory, setShowInventory] = useState(false);
  const [invTab, setInvTab] = useState<"CONSUMABLE"|"PERMANENT">("CONSUMABLE");
  const [useCodeObj, setUseCodeObj] = useState<{name: string, code: string}|null>(null);

  const [unlockKey, setUnlockKey] = useState("");
  const [showDebtWarning, setShowDebtWarning] = useState(false);
  const [debtConfirmCountdown, setDebtConfirmCountdown] = useState(5);
  const [hasClaimedDaily, setHasClaimedDaily] = useState(false);
  
  const [pushTitle, setPushTitle] = useState("");
  const [pushBody, setPushBody] = useState("");
  const [pushTarget, setPushTarget] = useState<"ALL" | string>("ALL");

  const handleSendPush = () => {
      if (!pushTitle || !pushBody) { alert("Vui lòng nhập đủ tiêu đề và nội dung!"); return; }
      const nx = students.map(s => {
          if (pushTarget === "ALL" || pushTarget === s.id) {
              const currentPending = s.pendingNotifications || [];
              return { ...s, pendingNotifications: [...currentPending, { id: getTrueTime().toString() + Math.random(), title: pushTitle, body: pushBody }] };
          }
          return s;
      });
      setStudents(nx as Student[]);
      syncData({ students: nx });
      setPushTitle(""); setPushBody("");
      alert("Đã gửi Push Notification thành công!");
  };

  useEffect(() => {
      if (userRole === "STUDENT" && currentUser && loaded) {
          const meLocal = students.find(s => (s.email || "").toLowerCase() === (currentUser.email || "").toLowerCase());
          if (meLocal && meLocal.pendingNotifications && meLocal.pendingNotifications.length > 0) {
              const showNotifs = () => {
                  meLocal.pendingNotifications!.forEach(n => {
                      new Notification(n.title, { body: n.body, icon: 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png' });
                  });
                  const nx = students.map(s => s.id === meLocal.id ? { ...s, pendingNotifications: [] } : s);
                  setStudents(nx as Student[]);
                  syncData({ students: nx });
              };

              if (Notification.permission === "granted") {
                  showNotifs();
              } else if (Notification.permission !== "denied") {
                  Notification.requestPermission().then(permission => {
                      if (permission === "granted") showNotifs();
                  });
              }
          }
      }
  }, [students, currentUser, loaded, userRole]);

  useEffect(() => {
      if (!loaded || !currentUser) return;
      const meLocal = students.find(s => (s.email || "").toLowerCase() === (currentUser.email || "").toLowerCase());
      if (!meLocal) return;

      if (meLocal.debtMessage && !showDebtWarning) {
          setShowDebtWarning(true);
          setDebtConfirmCountdown(5);
      } else if (!meLocal.debtMessage && showDebtWarning) {
          setShowDebtWarning(false);
      }

      let localSessionId = localStorage.getItem("ielts_os_device_session");
      const recentlyCreated = localStorage.getItem("ielts_os_session_created_at");
      let shouldForceSyncSession = false;

      if (!localSessionId) {
          localSessionId = "DEV_SESSION_" + Date.now().toString() + "_" + Math.random().toString(36).substring(2, 7);
          localStorage.setItem("ielts_os_device_session", localSessionId);
          localStorage.setItem("ielts_os_session_created_at", Date.now().toString());
          shouldForceSyncSession = true;
      } else {
          const isNewSession = recentlyCreated && (Date.now() - parseInt(recentlyCreated) < 5000);
          if (!isNewSession && meLocal.currentSessionId && meLocal.currentSessionId !== localSessionId) {
              alert("⚠️ SECURITY WARNING: Your account was logged in from another device!\n\nThe system will automatically log out this session to protect your data and exam progress.");
              handleLogout();
              return;
          }
      }

      const today = new Date().toLocaleDateString("vi-VN");
      let shouldUpdate = shouldForceSyncSession;
      let newStreak = meLocal.currentStreak || 0;
      let newCoins = meLocal.coins || 0;
      let newActiveExamId = meLocal.activeExamId;

      if (meLocal.activeExamId && meLocal.currentSessionId === localSessionId && !activeExam) {
          newActiveExamId = undefined;
          shouldUpdate = true;
      }

      if (meLocal.lastLoginDate !== today && !hasClaimedDaily) {
          setHasClaimedDaily(true);
          shouldUpdate = true;
          newStreak = 1;
          if (meLocal.lastLoginDate && meLocal.lastLoginDate.includes("/")) {
              const partsL = meLocal.lastLoginDate.split("/");
              const partsT = today.split("/");
              if (partsL.length === 3 && partsT.length === 3) {
                  const dL = new Date(Number(partsL[2]), Number(partsL[1])-1, Number(partsL[0]));
                  const dT = new Date(Number(partsT[2]), Number(partsT[1])-1, Number(partsT[0]));
                  const diff = Math.round((dT.getTime() - dL.getTime()) / (1000 * 3600 * 24));
                  if (diff === 1) newStreak = (meLocal.currentStreak || 0) + 1;
              }
          }
          let bonusCoins = 20;
          let msg = `🎁 DAILY ATTENDANCE: +20 Coins\n🔥 Current streak: ${newStreak} days.`;
          if (newStreak > 0 && newStreak % 7 === 0) {
              bonusCoins += 300;
              msg += `\n🎉 7-DAY STREAK BONUS: +300 Coins!`;
          }
          newCoins += bonusCoins;
          alert(msg);
      }

      if (shouldUpdate) {
          const nx = students.map(s => s.id === meLocal.id ? { ...s, coins: newCoins, lastLoginDate: today, currentStreak: newStreak, currentSessionId: localSessionId || undefined, activeExamId: newActiveExamId } : s);
          setStudents(nx); syncData({ students: nx });
      }
  }, [students, currentUser, loaded, activeExam, hasClaimedDaily, showDebtWarning]);

  useEffect(() => {
      if (showDebtWarning && debtConfirmCountdown > 0) {
          const timer = setTimeout(() => setDebtConfirmCountdown(debtConfirmCountdown - 1), 1000);
          return () => clearTimeout(timer);
      }
  }, [showDebtWarning, debtConfirmCountdown]);

  const handleAcknowledgeDebt = () => {
      setShowDebtWarning(false);
      const currentEmail = (currentUser?.email || "").toLowerCase();
      const nx = students.map(s => (s.email || "").toLowerCase() === currentEmail ? { ...s, debtMessage: undefined } : s);
      setStudents(nx);
      syncData({ students: nx });
  };

  const [stQuizSearch, setStQuizSearch] = useState("");
  const [sortQuiz, setSortQuiz] = useState<"NEW"|"OLD"|"AZ">("NEW");
  const [, _setScrollPct] = useState(0);
  const [showQuestionNotes, setShowQuestionNotes] = useState<Record<string, boolean>>({});
  const [showQuestionMap, setShowQuestionMap] = useState(false);
  const [enableTimerBeep, setEnableTimerBeep] = useState(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const examTimerRef = useRef<number | null>(null);
  const latestExamState = useRef({ activeExam, examAnswers, flaggedQuestions, examCheatCount, qNotes, scratchpadText, isPreview }); 

  const [resFilterStudent, setResFilterStudent] = useState<string>("");
  const [resFilterQuiz, setResFilterQuiz] = useState<string>("");
  const [resFilterBand, setResFilterBand] = useState<string>("");

  const playBeep = (freq = 800, duration = 300) => {
    if (!enableTimerBeep) return;
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    oscillator.frequency.value = freq;
    gainNode.gain.value = 0.5;
    oscillator.start();
    gainNode.gain.exponentialRampToValueAtTime(0.00001, audioCtx.currentTime + duration / 1000);
    oscillator.stop(audioCtx.currentTime + duration / 1000);
  };

  useEffect(() => { localStorage.setItem('ielts_theme', theme); }, [theme]);
useEffect(() => {
      localStorage.setItem('ielts_pref_sepia', isSepia.toString());
      localStorage.setItem('ielts_pref_fontsize', fontSize.toString());
      localStorage.setItem('ielts_pref_lineheight', lineHeight.toString());
      localStorage.setItem('ielts_pref_align', textAlign);
      localStorage.setItem('ielts_pref_lines', showLineNumbers.toString());
      localStorage.setItem('ielts_pref_fontfam', fontFam);
  }, [isSepia, fontSize, lineHeight, textAlign, showLineNumbers, fontFam]);

  useEffect(() => {
      const clockInt = setInterval(() => setLiveTime(new Date(getRealTime()).toLocaleTimeString('vi-VN')), 1000);
      return () => clearInterval(clockInt);
  }, [activeExam, examTimeLeft]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.ctrlKey && e.key.toLowerCase() === 'd') { e.preventDefault(); setTheme(p => p === 'light' ? 'dark' : 'light'); }
        if (activeExam && e.target === document.body) {
            if (e.key === "ArrowRight" || e.key === "ArrowDown") window.scrollBy({ top: 300, behavior: 'smooth' });
            else if (e.key === "ArrowLeft" || e.key === "ArrowUp") window.scrollBy({ top: -300, behavior: 'smooth' });
        }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeExam]);

  useEffect(() => {
    fetch("https://api.ipify.org?format=json").then((res: any) => res.json()).then((data: any) => setStudentIp(data.ip)).catch(() => setStudentIp("Unknown IP"));
    fetch("http://worldtimeapi.org/api/timezone/Asia/Ho_Chi_Minh").then(res => res.json()).then(data => {
          if (data && data.datetime) { setTimeOffset(new Date(data.datetime).getTime() - getTrueTime()); setIsTimeSynced(true); }
      }).catch(() => { setTimeOffset(0); setIsTimeSynced(true); });
    const savedLogin = localStorage.getItem('ielts_last_login');
    if (savedLogin) setLastLoginTime(savedLogin);
    
    const handleOffline = () => setIsOffline(true);
    const handleOnline = () => {
        setIsOffline(false);
        const offlineResultStr = localStorage.getItem(`ielts_offline_result_${currentUser?.email}`);
        if (offlineResultStr) {
            const r = JSON.parse(offlineResultStr);
            setQuizResults(prev => [r, ...prev]);
            syncData({ quizResults: [r, ...quizResults] });
            localStorage.removeItem(`ielts_offline_result_${currentUser?.email}`);
            alert("Offline test results synchronized to server successfully!");
        }
    };
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => { window.removeEventListener("offline", handleOffline); window.removeEventListener("online", handleOnline); };
  }, [quizResults, currentUser]);

  const myTeacherName = useMemo(() => {
    if (!currentUser) return "Teacher";
    const e = currentUser.email?.toLowerCase() || "";
    if (e === "trung@ielts.os") return "Truong Thanh Trung";
    if (e === "linh@ielts.os") return "Vi Thi Khanh Linh";
    return e.split("@")[0] || "Teacher";
  }, [currentUser]);

  const greetingText = useMemo(() => {
      const hour = new Date().getHours();
      if (hour < 12) return "Good morning";
      if (hour < 18) return "Good afternoon";
      return "Good evening";
  }, []);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      if (user) {
          (window as any).__ielts_user_id = user.email;
          setUserRole(user.email?.includes("@ielts.os") || user.email === "trung@ielts.os" ? "TEACHER" : "STUDENT");
          localStorage.setItem('ielts_last_login', new Date(getRealTime()).toLocaleString('vi-VN'));
      } else { setUserRole(null); }
      setAuthChecking(false);
    });
    return () => unsubAuth();
  }, []);

  useEffect(() => {
    syncTimeNetwork();
    const timeSyncInterval = setInterval(syncTimeNetwork, 3 * 60 * 1000); 

    const unsub = onSnapshot(DB_DOC_REF, (snap) => {
      if (snap.exists()) {
        const d = snap.data();
        setStudents(d.students || []); setHistory(d.history || []);
        setTransactions(d.transactions || []); setSchedules(d.schedules || []);
        setSharedLinks(d.sharedLinks || []); setQuizzes(d.quizzes || []);
        setQuizResults(d.quizResults || []); setBannedIps(d.bannedIps || []);
        setAnnouncement(d.announcement || "");
        setSystemLogs(d.systemLogs || []);
      }
      setLoaded(true);
    });

    const unsubLive = onSnapshot(LIVE_DOC_REF, (snap) => {
        if (snap.exists()) {
            const d = snap.data();
            setLiveSessions(d.sessions || []);
        }
    });

    return () => { unsub(); unsubLive(); clearInterval(timeSyncInterval); };
  }, [currentUser]);

  useEffect(() => {
      latestExamState.current = { activeExam, examAnswers, flaggedQuestions, examCheatCount, qNotes, scratchpadText, isPreview };
  }, [activeExam, examAnswers, flaggedQuestions, examCheatCount, qNotes, scratchpadText, isPreview]);

  useEffect(() => {
      if (!isDraggingSplitter) return;
      const handleMouseMove = (e: MouseEvent) => {
          const newRatio = (e.clientX / window.innerWidth) * 100;
          if (newRatio > 20 && newRatio < 80) setSplitRatio(newRatio);
      };
      const handleMouseUp = () => setIsDraggingSplitter(false);
      
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      
      return () => {
          document.removeEventListener('mousemove', handleMouseMove);
          document.removeEventListener('mouseup', handleMouseUp);
      };
  }, [isDraggingSplitter]);

  useEffect(() => {
      if (userRole === "STUDENT" && !activeExam && loaded) {
          const savedStateStr = localStorage.getItem(`ielts_os_exam_state_${currentUser?.email}`);
          if (savedStateStr) {
              const saved = JSON.parse(savedStateStr);
              if (bannedIps.includes(studentIp)) {
                  alert("ACCESS DENIED. Your IP has been banned from taking exams.");
                  localStorage.removeItem(`ielts_os_exam_state_${currentUser?.email}`);
                  return;
              }
              const now = getRealTime();
              const elapsedSecs = Math.floor((now - saved.startTime) / 1000);
              const timeLeft = (saved.quiz.timeLimit * 60) - elapsedSecs;
              if (timeLeft > 0) {
                  if (saved.quiz.isSEBRequired && !navigator.userAgent.includes("SEB")) {
                      setSebGuideQuiz(saved.quiz);
                      return;
                  }
                  setActiveExam(saved.quiz); 
                  setExamAnswers(saved.answers || {});
                  setFlaggedQuestions(saved.flags || []); 
                  setExamCheatCount(saved.cheatCount || 0);
                  setExamStartTime(saved.startTime); 
                  setExamTimeLeft(timeLeft); 
                  trueEndTimeRef.current = saved.startTime + (saved.quiz.timeLimit * 60 * 1000);
                  setQNotes(saved.qNotes || {}); 
                  setScratchpadText(saved.scratchpad || "");
                  setIsFocusMode(false);
                  setCrossedOptions(saved.crossed || {});
                  
                  if (saved.quiz.type === "Listening" && saved.quiz.audioUrl) {
                      setAudioTested(true);
                      if (saved.audioStatus === "ENDED") {
                          setAudioStatus("ENDED");
                      } else if (saved.audioStatus === "PLAYING" || saved.audioTime > 0) {
                          setPendingAudioResume({ time: saved.audioTime || 0, status: saved.audioStatus || "IDLE" });
                      } else {
                          setAudioStatus("IDLE");
                      }
                  }
              } else {
                  alert("Exam in progress expired and auto-submitted.");
                  localStorage.removeItem(`ielts_os_exam_state_${currentUser?.email}`);
              }
          }
      }
  }, [userRole, loaded, activeExam, bannedIps, currentUser, studentIp]);
  
  useEffect(() => {
    if (activeExam && userRole === "STUDENT" && !isPreview && gracePeriod === null && !hardLocked) {
      const triggerCheatPenalty = (reason: string) => {
          setExamCheatCount(prev => {
            const newCount = prev + 1;
            if (newCount >= 3) {
              alert(`⚠️ ERROR: ${reason}. OVER 3 VIOLATIONS! EXAM AUTO-SUBMITTED.`);
              forceSubmitExam();
              return newCount;
            } else {
              setHardLocked(true);
              return newCount;
            }
          });
      };

      const handleVisibilityChange = () => { if (document.hidden) triggerCheatPenalty("Leaving exam window / Switching tabs"); };
      const handleBeforeUnload = (e: any) => { e.preventDefault(); e.returnValue = ""; };
      const disableCtrlF = (e: KeyboardEvent) => { if (e.ctrlKey && e.key.toLowerCase() === 'f') { e.preventDefault(); alert("⚠️ WARNING: Search function is disabled!"); } };
      const handleFullscreenChange = () => { 
          if (!document.fullscreenElement) { 
              setIsFocusMode(false); 
              triggerCheatPenalty("Exiting fullscreen (Esc)");
          } 
      };
      
      document.addEventListener("visibilitychange", handleVisibilityChange);
      window.addEventListener("beforeunload", handleBeforeUnload);
      window.addEventListener('keydown', disableCtrlF);
      document.addEventListener('fullscreenchange', handleFullscreenChange);
      
      return () => { 
          document.removeEventListener("visibilitychange", handleVisibilityChange); 
          window.removeEventListener("beforeunload", handleBeforeUnload); 
          window.removeEventListener('keydown', disableCtrlF);
          document.removeEventListener('fullscreenchange', handleFullscreenChange);
      };
    }
  }, [activeExam, userRole, isPreview, gracePeriod, hardLocked]);
// ==================== ANTI-SCREENSHOT ENGINE ====================
  // Phát hiện phím chụp màn hình (keyboard). Hiển thị flash trắng để phá ảnh.
  // Áp dụng cho cả kỳ thi thật lẫn Test Giao Diện (isPreview).
  // LƯU Ý: Không thể chặn được 100% từ thiết bị ngoài (điện thoại chụp màn hình).
  // Watermark định danh bên dưới là lớp bảo vệ bổ sung cho trường hợp đó.
  useEffect(() => {
    if (!activeExam || userRole !== "STUDENT") return;

    const triggerFlash = () => {
        setScreenshotFlash(true);
        if (screenshotFlashRef.current) clearTimeout(screenshotFlashRef.current);
        screenshotFlashRef.current = window.setTimeout(() => setScreenshotFlash(false), 500);
    };

    const handleScreenshotKey = (e: KeyboardEvent) => {
        const key = e.key;
        const isMac = navigator.platform.toUpperCase().includes('MAC');

        const isScreenshot =
            key === 'PrintScreen' ||                                   // Win: PrtSc / Alt+PrtSc
            key === 'F13' ||                                            // Một số bàn phím map PrtSc → F13
            (isMac && e.metaKey && e.shiftKey && key === '3') ||        // macOS: Cmd+Shift+3
            (isMac && e.metaKey && e.shiftKey && key === '4') ||        // macOS: Cmd+Shift+4
            (isMac && e.metaKey && e.shiftKey && key === '5') ||        // macOS: Cmd+Shift+5 (screen recorder)
            (isMac && e.metaKey && e.shiftKey && key === '6') ||        // macOS: Cmd+Shift+6
            (isMac && e.metaKey && e.ctrlKey && e.shiftKey && key === '4'); // macOS: clipboard screenshot

        if (!isScreenshot) return;

        e.preventDefault();
        e.stopImmediatePropagation();

        // Ghi đè clipboard bằng nội dung vô nghĩa
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText('[SCREENSHOT BLOCKED — IELTS OS ANTI-CHEAT]').catch(() => {});
        }

        triggerFlash();

        // Tính vi phạm chỉ khi thi thật (không phải preview/test UI)
        if (!isPreview && gracePeriod === null && !hardLocked) {
            setExamCheatCount(prev => {
                const newCount = prev + 1;
                if (newCount >= 3) {
                    setTimeout(() => {
                        alert('⚠️ Screenshot attempt detected! OVER 3 VIOLATIONS. EXAM AUTO-SUBMITTED.');
                        forceSubmitExam();
                    }, 550); // Sau khi flash kết thúc
                } else {
                    setHardLocked(true);
                }
                return newCount;
            });
        }
    };

    // Dùng capture phase (true) để bắt phím trước tất cả handler khác
    window.addEventListener('keydown', handleScreenshotKey, true);
    return () => {
        window.removeEventListener('keydown', handleScreenshotKey, true);
        if (screenshotFlashRef.current) clearTimeout(screenshotFlashRef.current);
    };
  }, [activeExam, userRole, isPreview, gracePeriod, hardLocked]);
 useEffect(() => {
    // Chỉ khởi tạo interval 1 LẦN DUY NHẤT khi bắt đầu thi
    if (activeExam && gracePeriod === null && !hardLocked) {
      examTimerRef.current = window.setInterval(() => {
        const state = latestExamState.current;
        
        // Cưỡng chế nộp nếu quá hạn
        if (state.activeExam?.scheduledEnd && !state.isPreview) {
            const endMs = parseVNTime(state.activeExam.scheduledEnd);
            if (getRealTime() >= endMs) { setGracePeriod(5); return; }
        }
        
        // Tính thời gian thực tế còn lại dựa vào mốc startTime ban đầu
        const exactTimeLeft = Math.floor((trueEndTimeRef.current - getRealTime()) / 1000);
        
        // Cập nhật trạng thái Live Arena mỗi 5 giây
        if (exactTimeLeft > 0 && exactTimeLeft % 5 === 0 && !state.isPreview && currentUser) {
            setLiveSessions(prev => {
                const ansCount = Object.keys(state.examAnswers).filter(k => state.examAnswers[k] !== undefined && state.examAnswers[k] !== "").length;
                const pct = Math.round((ansCount / state.activeExam!.questions.length) * 100);
                const me = students.find(s => s.email?.toLowerCase() === currentUser.email?.toLowerCase());
                const newSession: LiveSession = {
                    id: currentUser.email || "unknown", studentId: me?.id || "unknown", studentName: me?.name || currentUser.email?.split('@')[0] || "Student",
                    quizId: state.activeExam!.id, quizTitle: state.activeExam!.title, answeredCount: ansCount, totalQ: state.activeExam!.questions.length,
                    lastUpdate: getRealTime(), isCheating: state.examCheatCount > 0, progressPct: pct
                };
                const nx = prev.filter(x => x.id !== newSession.id);
                nx.push(newSession);
                syncLiveArena(nx);
                return nx;
            });
        }

        // Xử lý hết giờ
        if (exactTimeLeft <= 0) {
            setGracePeriod(5);
            setExamTimeLeft(0);
            if (enableTimerBeep) playBeep(1200, 800);
            if (examTimerRef.current) window.clearInterval(examTimerRef.current);
        } else {
            setExamTimeLeft(exactTimeLeft);
            if (exactTimeLeft === 600) { setTimeAlert("10 minutes left!"); setTimeout(()=>setTimeAlert(""), 5000); if (enableTimerBeep) playBeep(880, 200); }
            if (exactTimeLeft === 300) { setTimeAlert("5 minutes left!"); setTimeout(()=>setTimeAlert(""), 5000); if (enableTimerBeep) playBeep(880, 300); }
            if (exactTimeLeft <= 60 && exactTimeLeft % 10 === 0) { if (enableTimerBeep) playBeep(1000, 500); }
        }
        
        let aTime = 0; let aStatus = "IDLE";
        if (audioRef.current) {
            aTime = audioRef.current.currentTime;
            aStatus = audioRef.current.ended ? "ENDED" : (!audioRef.current.paused ? "PLAYING" : "IDLE");
        }

        if (!state.isPreview) {
            localStorage.setItem(`ielts_os_exam_state_${currentUser?.email}`, JSON.stringify({ 
                quiz: state.activeExam, startTime: examStartTime, answers: state.examAnswers, flags: state.flaggedQuestions, cheatCount: state.examCheatCount, qNotes: state.qNotes, scratchpad: state.scratchpadText, crossed: crossedOptions, audioTime: aTime, audioStatus: aStatus
            }));
        }
      }, 1000);
    }
    return () => { if (examTimerRef.current) window.clearInterval(examTimerRef.current); };
  }, [activeExam?.id, gracePeriod, hardLocked]); // MAGIC FIX: Bỏ examTimeLeft khỏi mảng phụ thuộc

  useEffect(() => {
      if (gracePeriod !== null && gracePeriod > 0) {
          const t = setTimeout(() => setGracePeriod(p => p! - 1), 1000);
          return () => clearTimeout(t);
      } else if (gracePeriod === 0) {
          forceSubmitExam();
          setGracePeriod(null);
      }
  }, [gracePeriod]);

  useEffect(() => {
      if (activeExam) {
          const checkFullscreen = () => setIsFullScreen(!!document.fullscreenElement);
          document.addEventListener('fullscreenchange', checkFullscreen);
          return () => document.removeEventListener('fullscreenchange', checkFullscreen);
      }
  }, [activeExam]);

  useEffect(() => {
    if (running) {
      intervalRef.current = window.setInterval(() => { setElapsed(accTimeRef.current + Math.floor((getTrueTime() - startTimeRef.current) / 1000)); }, 1000);
    } else if (intervalRef.current) window.clearInterval(intervalRef.current);
    return () => { if (intervalRef.current) window.clearInterval(intervalRef.current); };
  }, [running]);

  useEffect(() => {
    if (editingQuiz) {
        const timeout = setTimeout(() => { localStorage.setItem('ielts_exam_draft', JSON.stringify(editingQuiz)); }, 2000);
        const handleSaveShortcut = (e: KeyboardEvent) => {
            if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); alert("Saved draft Ctrl+S!"); }
        };
        window.addEventListener('keydown', handleSaveShortcut);
        return () => { clearTimeout(timeout); window.removeEventListener('keydown', handleSaveShortcut); };
    }
  }, [editingQuiz]);

  useEffect(() => { if (audioRef.current) audioRef.current.volume = audioVolume; }, [audioVolume]);

  useEffect(() => {
      if (!activeExam) {
          if (audioRef.current) {
              audioRef.current.pause();
              audioRef.current.currentTime = 0;
          }
          setAudioStatus("IDLE");
          setAudioTested(false);
          setPendingAudioResume(null);
          setFlaggedQuestions([]);
          setCrossedOptions({});
          setQNotes({});
          setScratchpadText("");
          setIsFocusMode(false);
          setExamCheatCount(0);
          setHardLocked(false);
          setGracePeriod(null);
          setExamAnswers({});
          setSaveStatus("Saved");
      }
  }, [activeExam]);

  useEffect(() => {
    if (userRole !== "TEACHER") return;
    const checkHealth = async () => {
      try {
        const res = await fetch("http://localhost:8000/api/health");
        if (res.ok) setServerStatus("OK");
        else setServerStatus("DOWN");
      } catch (e) {
        setServerStatus("DOWN");
      }
    };
    checkHealth();
    const timer = setInterval(checkHealth, 10000);
    return () => clearInterval(timer);
  }, [userRole]);

  const logErrorToSystem = (errorType: string, message: string, contextObj?: any) => {
    const newLog: SystemLog = {
      id: Date.now().toString() + Math.random().toString(36).substring(2, 7),
      errorType, message, context: contextObj ? JSON.stringify(contextObj) : "",
      timestamp: new Date().toLocaleString("vi-VN"), email: currentUser?.email || "Unknown"
    };
    setSystemLogs(prev => {
      const nx = [newLog, ...prev].slice(0, 50);
      return nx;
    });
    const updatePayload: any = { systemLogs: [newLog, ...systemLogs].slice(0, 50) };
    syncData(updatePayload);
  };

  const syncData = async (newData: any) => {
    try {
      const { runTransaction } = await import("firebase/firestore");
      
      await runTransaction(db, async (transaction) => {
        const sfDoc = await transaction.get(DB_DOC_REF);
        if (!sfDoc.exists()) {
          transaction.set(DB_DOC_REF, JSON.parse(JSON.stringify(newData)));
          return;
        }
        
        const serverData = sfDoc.data() || {};
        const finalUpdate: any = {};

        Object.keys(newData).forEach((key) => {
          const localVal = newData[key];
          const serverVal = serverData[key];

          if (!Array.isArray(localVal)) {
            finalUpdate[key] = localVal;
            return;
          }

          const serverArr = Array.isArray(serverVal) ? serverVal : [];

          if (userRole === "TEACHER") {
            if (key === "students") {
              finalUpdate[key] = localVal.map((localItem: any) => {
                const serverItem = serverArr.find((s: any) => s.id === localItem.id);
                if (serverItem) {
                  return {
                    ...serverItem,
                    ...localItem,
                    coins: localItem.coins !== undefined ? localItem.coins : (serverItem.coins || 0),
                    inventory: localItem.inventory || serverItem.inventory || { consumables: {}, permanents: [] },
                    currentSessionId: serverItem.currentSessionId || localItem.currentSessionId || null,
                    lastLoginDate: serverItem.lastLoginDate || localItem.lastLoginDate || "",
                    currentStreak: serverItem.currentStreak !== undefined ? serverItem.currentStreak : (localItem.currentStreak || 0),
                    activeExamId: serverItem.activeExamId || localItem.activeExamId || null,
                    debtMessage: localItem.debtMessage !== undefined ? localItem.debtMessage : serverItem.debtMessage
                  };
                }
                return localItem;
              });
            } else {
              finalUpdate[key] = localVal;
            }
          } else {
            if (key === "students") {
              const currentEmail = (currentUser?.email || "").toLowerCase();
              const myLocalInfo = localVal.find((s: any) => (s.email || "").toLowerCase() === currentEmail);
              
              if (myLocalInfo) {
                finalUpdate[key] = serverArr.map((serverItem: any) => {
                  if ((serverItem.email || "").toLowerCase() === currentEmail) {
                    return { 
                      ...serverItem, 
                      ...myLocalInfo,
                      name: serverItem.name,
                      phone: serverItem.phone,
                      rate: serverItem.rate,
                      target: serverItem.target,
                      cefr: serverItem.cefr,
                      debtMessage: serverItem.debtMessage
                    };
                  }
                  return serverItem;
                });
              } else {
                finalUpdate[key] = serverArr;
              }
            } else if (key === "quizResults" || key === "liveSessions" || key === "systemLogs") {
              const mergedArr = [...serverArr];
              localVal.forEach((localItem: any) => {
                const idx = mergedArr.findIndex((s: any) => s.id === localItem.id);
                if (idx === -1) {
                  mergedArr.push(localItem);
                } else {
                  mergedArr[idx] = { ...mergedArr[idx], ...localItem };
                }
              });
              finalUpdate[key] = mergedArr;
            } else {
              finalUpdate[key] = serverArr;
            }
          }
        });

        const cleanUpdate = JSON.parse(JSON.stringify(finalUpdate));
        transaction.update(DB_DOC_REF, cleanUpdate);
      });
    } catch (error: any) {
      console.error("Critical Sync Blocked:", error);
      if (typeof logErrorToSystem === "function") {
        logErrorToSystem("CRITICAL_SYNC_FAIL", error.message || String(error), { user: currentUser?.email });
      }
    }
  };
  const syncLiveArena = async (sessions: LiveSession[]) => { try { await setDoc(LIVE_DOC_REF, { sessions }, { merge: true }); } catch (error) {} };
  const handleLogin = async (e: any) => {
    e.preventDefault(); setLoginError("");
    try { await signInWithEmailAndPassword(auth, email, password); } 
    catch (error) { setLoginError("Wrong email or password!"); }
  };
  const handleLogout = () => {
    localStorage.removeItem("ielts_os_device_session");
    localStorage.removeItem("ielts_os_session_created_at");
    signOut(auth);
  };

  const toggleTimer = (start: boolean) => {
    if (start) {
      if (!selStudent) { alert("Please select a student before starting the timer!"); return; }
      startTimeRef.current = getTrueTime(); accTimeRef.current = elapsed; setRunning(true);
    } else setRunning(false);
  };
  const resetTimer = () => { setRunning(false); setElapsed(0); accTimeRef.current = 0; };

  const fmtMoney = (n: number) => (n || 0).toLocaleString('vi-VN') + "đ";
  const fmtTime = (s: number) => { const v = s || 0; return `${String(Math.floor(v/3600)).padStart(2,"0")}:${String(Math.floor((v%3600)/60)).padStart(2,"0")}:${String(v%60).padStart(2,"0")}`; };
  const calcEarn = (s: number, r: number) => Math.round((Math.ceil((s||0)/60)/60)*(r||0));
  const getGamificationBadge = (lvl: number) => { if (lvl >= 10) return "👑 Master"; if (lvl >= 5) return "🌟 Elite"; return "🥉 Novice"; };
  const getIeltsBand = (score: number, total: number = 40) => {
    if (!total || total === 0) return "N/A";
    const norm = ((score || 0) / total) * 40; 
    if (norm >= 39) return 9.0; if (norm >= 37) return 8.5; if (norm >= 35) return 8.0;
    if (norm >= 32) return 7.5; if (norm >= 30) return 7.0; if (norm >= 26) return 6.5;
    if (norm >= 23) return 6.0; if (norm >= 18) return 5.5; if (norm >= 15) return 5.0;
    if (norm >= 13) return 4.5; if (norm >= 10) return 4.0; return "N/A";
  };
  const copyToClipboard = (text: string) => { if (!text) return; navigator.clipboard.writeText(text); alert("Copied!"); };
  const scrollToTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });

  const handleAutoHighlight = () => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.toString().trim().length === 0) return;

      let node = selection.anchorNode;
      let container = null;
      while (node && node !== document.body) {
          if (node.nodeType === 1 && (node as HTMLElement).classList.contains('highlightable-content')) {
              container = node as HTMLElement;
              break;
          }
          node = node.parentNode;
      }

      if (!container) return;

      const range = selection.getRangeAt(0);
      const span = document.createElement("span");
      span.style.backgroundColor = "#FFE066"; span.style.color = "#000"; span.className = "student-highlight"; span.style.cursor = "pointer";
      span.title = "Double click to clear";
      try {
          range.surroundContents(span);
          const field = container.getAttribute('data-field');
          const qId = container.getAttribute('data-qid');
          const optIndex = container.getAttribute('data-optindex');
          
          if (activeExam) {
              setActiveExam(prev => {
                  if (!prev) return null;
                  if (field === 'passage') return { ...prev, passage: container.innerHTML };
                  if (qId) {
                      const nQ = prev.questions.map(q => q.id === qId ? { ...q, [field as string]: container.innerHTML } : q);
                      return { ...prev, questions: nQ };
                  }
                  return prev;
              });
          }
      } catch (error) { /* Ignore */ }
      selection.removeAllRanges();
  };

  const handleRemoveHighlight = (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('student-highlight')) {
          const container = target.closest('.highlightable-content');
          
          // ==========================================
          // BẮT ĐẦU FIX: THUẬT TOÁN RÚT RUỘT BẢO TỒN HTML
          // ==========================================
          const parent = target.parentNode;
          if (parent) {
              // Chuyển toàn bộ nội dung (text, img, br) ra ngoài trước khi xóa vỏ highlight
              while (target.firstChild) {
                  parent.insertBefore(target.firstChild, target);
              }
              parent.removeChild(target); // Xóa vỏ
              parent.normalize(); // Liền mạch lại DOM
          }
          // ==========================================

          if (container) {
              const field = container.getAttribute('data-field');
              const qId = container.getAttribute('data-qid');
              const optIndex = container.getAttribute('data-optindex');
              
              if (field) {
                  let cleanHTML = container.innerHTML;
                  cleanHTML = cleanHTML.replace(/<input[^>]*class="[^"]*inline-blank-input[^"]*"[^>]*>/gi, '___');
                  cleanHTML = cleanHTML.replace(/<span[^>]*class="[^"]*idp-dropzone[^"]*"[^>]*>.*?<\/span>/gi, '___');
                  setActiveExam(prev => syncHighlightState(prev, field, qId || "", cleanHTML, optIndex));
              }
          }
      }
  };

  const getAvatar = (name: string) => {
      const parts = name.split(' ');
      const initials = parts.length > 1 ? parts[0][0] + parts[parts.length-1][0] : name.slice(0,2);
      const colors = ['#E53935', '#D81B60', '#8E24AA', '#5E35B1', '#3949AB', '#1E88E5', '#039BE5', '#00ACC1', '#00897B', '#00897B', '#43A047', '#7CB342'];
      const charCode = name.charCodeAt(0) || 0;
      const bg = colors[charCode % colors.length];
      return <div style={{width: 40, height: 40, borderRadius: '50%', background: bg, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 16, flexShrink: 0}}>{initials.toUpperCase()}</div>;
  };

  const getFileIcon = (url: string) => {
      if (!url) return '🔗';
      if (url.includes('.pdf')) return '📄';
      if (url.includes('.doc')) return '📝';
      if (url.includes('.mp3') || url.includes('.m4a')) return '🎵';
      return '🔗';
  };

  const getAge = (dob: string | undefined) => {
      if (!dob) return "";
      const birthYear = new Date(dob).getFullYear();
      const currentYear = new Date().getFullYear();
      return ` (${currentYear - birthYear} tuổi)`;
  };

  const saveManualSession = () => {
    const st = students.find(s => s.id === selStudent);
    const totalSecs = (Number(manualMin) || 0) * 60 + (Number(manualSec) || 0);
    if (!st || totalSecs <= 0) { 
      alert("Please select a student and enter a valid duration!"); 
      return; 
    }
    
    // Nhập ghi chú phản hồi buổi học từ người dùng
    const teacherNote = prompt(`Enter lesson feedback / notes for student ${st.name}:`, "Good effort during today's session.");
    if (teacherNote === null) return; // Hủy nếu giáo viên bấm Cancel

    const session: Session = { 
      id: getTrueTime().toString(), 
      studentId: st.id, 
      studentName: st.name, 
      teacher: myTeacherName, 
      skills: selSkills, 
      date: new Date().toLocaleString("vi-VN"), 
      duration: totalSecs, 
      rate: st.rate, 
      earnings: calcEarn(totalSecs, st.rate), 
      notes: teacherNote.trim() || "Manual time addition", 
      rubric: { vocab: "", grammar: "", fluency: "", task: "" }, 
      isPaid: false 
    };

    const newExp = (st.exp || 0) + Math.round(totalSecs / 60);
    const oldLevel = st.level || 1;
    const newLevel = Math.floor(newExp / 500) + 1;
    const earnedCoinsByTime = totalSecs >= 7200 ? 60 : (totalSecs >= 3600 ? 25 : (totalSecs >= 1800 ? 10 : 0));

    if (newLevel > oldLevel) { 
      setShowCelebration(true); 
      setTimeout(() => setShowCelebration(false), 5000); 
      alert(`🎉 Excellent! Student ${st.name} leveled up to Level ${newLevel}!`); 
    }

    const nxStudents = students.map(s => s.id === st.id ? { 
      ...s, 
      exp: newExp, 
      level: newLevel, 
      coins: (s.coins || 0) + earnedCoinsByTime,
      debtMessage: s.debtMessage || "" // Đảm bảo không mang giá trị undefined vỡ database
    } : s);

    const nxHistory = [session, ...history];
    
    setStudents(nxStudents); 
    setHistory(nxHistory); 
    
    // Đẩy trực tiếp lên Firestore thông qua transaction an toàn
    syncData({ students: nxStudents, history: nxHistory });

    setShowManualTime(false); 
    setManualMin(""); 
    setManualSec(""); 
    alert("Manual lesson logged and feedback saved successfully!");
  };

  const handleSaveSession = () => {
    setRunning(false);
    const st = students.find(s => s.id === selStudent);
    if (elapsed === 0 || !st) return;

    // Nhập ghi chú phản hồi buổi học bấm giờ thực tế
    const teacherNote = prompt(`Enter lesson feedback / notes for student ${st.name}:`, "Completed live training session.");
    if (teacherNote === null) return;

    const session: Session = { 
      id: getTrueTime().toString(), 
      studentId: st.id, 
      studentName: st.name, 
      teacher: myTeacherName, 
      skills: selSkills, 
      date: new Date().toLocaleString("vi-VN"), 
      duration: elapsed, 
      rate: st.rate, 
      earnings: calcEarn(elapsed, st.rate), 
      notes: teacherNote.trim() || "Live timed session", 
      rubric: { vocab: "", grammar: "", fluency: "", task: "" }, 
      isPaid: false 
    };

    const newExp = (st.exp || 0) + Math.round(elapsed / 60);
    const newLevel = Math.floor(newExp / 500) + 1;
    const earnedCoinsByTime = elapsed >= 7200 ? 60 : (elapsed >= 3600 ? 25 : (elapsed >= 1800 ? 10 : 0));

    if (newLevel > (st.level || 1)) { 
      setShowCelebration(true); 
      setTimeout(() => setShowCelebration(false), 5000); 
    }

    const nxStudents = students.map(s => s.id === st.id ? { 
      ...s, 
      exp: newExp, 
      level: newLevel, 
      coins: (s.coins || 0) + earnedCoinsByTime,
      debtMessage: s.debtMessage || ""
    } : s);

    const nxHistory = [session, ...history];
    
    setStudents(nxStudents); 
    setHistory(nxHistory); 
    
    syncData({ students: nxStudents, history: nxHistory });
    resetTimer(); 
    setSelSkills([]);
    alert("Live lesson session and feedback synchronized successfully!");
  };

  const handleStudentAction = () => {
    if (!newSt.name) return;
    const nameCap = newSt.name.trim().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    let nx: Student[];
    if (editStId) { nx = students.map(s => s.id === editStId ? { ...s, ...newSt, name: nameCap } as Student : s); setEditStId(null); } 
    else { nx = [{ id: getTrueTime().toString(), name: nameCap, phone: "", rate: newSt.rate || 300000, target: newSt.target || "6.5", cefr: newSt.cefr || "B2", exp: 0, level: 1, email: newSt.email, dob: newSt.dob, isPinned: false, privateMessage: "" }, ...students]; }
    setStudents(nx); syncData({ students: nx }); setNewSt({ name: "", rate: 300000, target: "6.5", cefr: "B2", email: "", dob: "", privateMessage: "" });
  };

  const handleAddSchedule = () => {
    if (!schedForm.studentId) { alert("Please select a student!"); return; }
    const st = students.find(x => x.id === schedForm.studentId);
    if (!st) return;
    const nx = [{ id: getTrueTime().toString(), date: viewDate, time: schedForm.time, location: schedForm.location, teacher: myTeacherName, studentId: schedForm.studentId, studentName: st.name, subject: "IELTS Core" }, ...schedules];
    setSchedules(nx); syncData({ schedules: nx }); setShowSchedForm(false);
  };

  const handleAddLink = () => {
    if (!newLink.title || !newLink.url) { alert("Missing link!"); return; }
    let targetName = "";
    if (linkAudience === "SPECIFIC_STUDENT") {
        if (!linkTargetId) { alert("Select a target student for this link!"); return; }
        targetName = students.find(s => s.id === linkTargetId)?.name || "";
    }
    const nx: SharedLink = { id: getTrueTime().toString(), title: newLink.title, url: newLink.url, date: new Date().toLocaleDateString("vi-VN"), audience: linkAudience, targetStudentId: linkAudience === "SPECIFIC_STUDENT" ? linkTargetId : "", targetStudentName: targetName };
    const nxLinks = [nx, ...sharedLinks]; setSharedLinks(nxLinks); syncData({ sharedLinks: nxLinks }); setNewLink({ title: "", url: "" });
  };

  const handleAddTransaction = (type: "INCOME" | "EXPENSE") => {
    if (!newTrans.title || !newTrans.amount) return;
    const nx = [{ id: getTrueTime().toString(), ...newTrans, type, date: new Date().toLocaleDateString("vi-VN") }, ...transactions];
    setTransactions(nx as Transaction[]); syncData({ transactions: nx }); setNewTrans({ title: "", amount: 0 });
  };

  const exportCSV = () => {
    const headers = "Date,Student,Teacher,Skills,Duration (mins),Earnings,Status\n";
    const csvData = history.map(h => `"${h.date}","${h.studentName}","${h.teacher}","${(h.skills || []).join(" - ")}","${Math.round((h.duration || 0) / 60)}","${h.earnings || 0}","${h.isPaid ? "Paid" : "Unpaid"}"`).join("\n");
    const blob = new Blob(["\uFEFF" + headers + csvData], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `IELTS_REPORT.csv`; link.click();
  };
  
  const exportStudentsCSV = () => {
    const headers = "Full Name,Email,Level,Target,Rate,Debt\n";
    const csvData = students.map(s => {
        const sDebt = history.filter(h => h.studentId === s.id && !h.isPaid).reduce((sum, h) => sum + (h.earnings || 0), 0);
        return `"${s.name}","${s.email||''}","${s.cefr}","${s.target}","${s.rate}","${sDebt}"`
    }).join("\n");
    const blob = new Blob(["\uFEFF" + headers + csvData], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `STUDENTS_LIST.csv`; link.click();
  };

  const exportQuizResultsCSV = () => {
    const headers = "Date,Student,Test,Score,Band,Cheats,Duration(s),IP Address,Device,Teacher Feedback\n";
    const csvData = quizResults.map(r => `"${r.date}","${r.studentName}","${r.quizTitle}","${r.score}/${r.total}","${r.band}","${r.cheatCount}","${r.durationSeconds||0}","${r.ipAddress||""}","${r.deviceInfo||""}","${r.teacherFeedback||""}"`).join("\n");
    const blob = new Blob(["\uFEFF" + headers + csvData], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `IELTS_CBT_RESULTS.csv`; link.click();
  };

  const exportDetailedQuizResult = (r: QuizResult) => {
      const qz = quizzes.find(x => x.id === r.quizId);
      if (!qz) { alert("Source data not found!"); return; }
      let headers = "No.,Question,CORRECT ANSWER,STUDENT ANSWER,Result\n";
      let csvData = qz.questions.map((q, i) => {
          const options = q.options || []; 
          let correctDisplay: string | number = q.correctAnswer;
          let studentDisplay: string | number = (r.answers && r.answers[q.id] !== undefined) ? r.answers[q.id] : "";
          let isCorrect = "Incorrect";
          if (q.type === "CHOICE") {
              correctDisplay = options[q.correctAnswer as number] || q.correctAnswer;
              studentDisplay = (r.answers && r.answers[q.id] !== undefined) ? (options[r.answers[q.id] as number] || "") : "";
              if (r.answers && r.answers[q.id] === q.correctAnswer) isCorrect = "Correct";
          } else {
              const sAns = String(studentDisplay).trim().toLowerCase();
              const correctStrs = String(q.correctAnswer).split("/").map(s => s.trim().toLowerCase());
              if (correctStrs.includes(sAns)) isCorrect = "Correct";
          }
          const safeText = (txt: string|number) => `"${String(txt).replace(/"/g, '""')}"`;
          return `${i+1},${safeText(q.text)},${safeText(correctDisplay)},${safeText(studentDisplay)},${isCorrect}`;
      }).join("\n");
      const summary = `\n\nStudent:,${r.studentName}\nTest:,${r.quizTitle}\nScore:,${r.score}/${r.total}\nBand:,${r.band}\nDuration:,${r.durationSeconds || 0}s\nIP:,${r.ipAddress || ""}\nCheats:,${r.cheatCount} times\n`;
      const blob = new Blob(["\uFEFF" + headers + csvData + summary], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `DETAILED_${r.studentName}_${r.quizTitle}.csv`; link.click();
  };

  const handleExportExamKey = (quiz: Quiz) => {
      let content = `ANSWER KEY: ${quiz.title}\nType: ${quiz.type}\n\n`;
      quiz.questions.forEach((q, i) => {
          let ans = q.correctAnswer;
          if (q.type === "CHOICE" && q.options) ans = q.options[q.correctAnswer as number] || ans;
          content += `Question ${i+1}: ${ans}\n`;
      });
      const blob = new Blob(["\uFEFF" + content], { type: 'text/plain;charset=utf-8;' });
      const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `KEY_${quiz.title}.txt`; link.click();
  }

  const handleFileUpload = async (e: any) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    try {
      alert("Sending file to FastAPI backend for processing...");
      const response = await fetch("http://localhost:8000/api/upload_docx", { method: "POST", body: formData });
      const data = await response.json();
      if (data.success && data.quiz) {
        const newQuiz: Quiz = { ...data.quiz, audience: "ALL", targetStudentIds: [], maxAttempts: 1, isLocked: false }; 
        const updatedQuizzes = [newQuiz, ...quizzes];
        setQuizzes(updatedQuizzes); syncData({ quizzes: updatedQuizzes });
        alert(`SUCCESS! Test extracted: ${newQuiz.title}`);
      } else {
          logErrorToSystem("UPLOAD_DOCX_FAIL", data.error || "Backend unknown error", { fileName: file.name });
          alert("Backend error: " + (data.error || "Unknown error."));
      }
    } catch (error: any) { 
        logErrorToSystem("CONNECTION_ERROR", error.message || String(error), { action: "upload_docx" });
        alert("Connection error to FastAPI backend!"); 
    }
  };

  const saveQuiz = (quizToSave?: Quiz) => {
    const qz = quizToSave || editingQuiz;
    if (!qz || !qz.title) { alert("Please enter the exam title!"); return; }
    let nx; if (quizzes.find(q => q.id === qz.id)) nx = quizzes.map(q => q.id === qz.id ? qz : q); else nx = [qz, ...quizzes];
    setQuizzes(nx); syncData({ quizzes: nx }); 
    localStorage.removeItem('ielts_exam_draft');
    if (!quizToSave) setEditingQuiz(null); 
  };
  
  const duplicateQuiz = (q: Quiz) => {
      const newQuiz = { ...q, id: getTrueTime().toString(), title: q.title + " (Copy)", active: false, isLocked: true };
      const nx = [newQuiz, ...quizzes];
      setQuizzes(nx); syncData({ quizzes: nx });
      alert("Exam duplicated successfully!");
  };

  const handleBulkLock = (locked: boolean) => {
      if(!confirm(`Confirm Lock / Unlock ${selectedQuizzes.length} exams?`)) return;
      const nx = quizzes.map(q => selectedQuizzes.includes(q.id) ? { ...q, isLocked: locked } : q);
      setQuizzes(nx); syncData({quizzes: nx}); setSelectedQuizzes([]);
  }

  const handleAnswerChange = (questionId: string, answer: any, type?: string) => {
    // FIX: Sử dụng Functional Update để đảm bảo State mới nhất không bị ghi đè khi gõ nhanh
    setExamAnswers(prev => ({...prev, [questionId]: answer}));
    setSaveStatus("Saving...");
    setTimeout(() => setSaveStatus("Saved"), 500);
  };
  
  const handleAutoScrollNext = (qIndex: number, totalQ: number) => {
      if (qIndex + 1 < totalQ) {
          const nextQ = activeExam?.questions[qIndex + 1];
          if (nextQ) {
              const el = document.getElementById(`question-${nextQ.id}`);
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
      }
  };

  const _toggleStrike = (e: React.MouseEvent, qId: string, optIndex: number) => {
    e.preventDefault(); 
    const key = `${qId}_${optIndex}`;
    setCrossedOptions(p => {
        const current = p[key] || 0;
        const next = current === 0 ? 1 : current === 1 ? 2 : 0;
        return {...p, [key]: next};
    });
  };

  const startExam = (quiz: Quiz, isTeacherPreview = false, isStudentTestUI = false) => {
      if (bannedIps.includes(studentIp) && !isTeacherPreview && !isStudentTestUI) { alert("❌ ACCESS DENIED. Your IP has been banned from taking exams."); return; }
      
      if (!isTeacherPreview && !isStudentTestUI) {
          const now = getRealTime();
          if (quiz.scheduledStart && now < parseVNTime(quiz.scheduledStart)) { alert("⏳ Bài thi này chưa tới giờ mở!"); return; }
          if (quiz.scheduledEnd && now > parseVNTime(quiz.scheduledEnd)) { alert("🔒 Bài thi này đã quá hạn và bị đóng!"); return; }
          
          if (quiz.isSEBRequired) {
              const isSEB = navigator.userAgent.includes("SEB");
              if (!isSEB) {
                  // Hiển thị màn hình hướng dẫn thay vì dùng alert()
                  setSebGuideQuiz(quiz);
                  return;
              }
          }
          
          if (quiz.passcode) {
              const pass = prompt("Nhập mã bảo vệ phòng thi (Nếu không có, cứ để trống và bấm OK):");
              if (pass !== quiz.passcode) { alert("Mã bảo vệ không đúng!"); return; }
          }

          if (currentUser) {
              const myHistory = quizResults.filter(r => r.quizId === quiz.id && r.studentId === students.find(s => s.email?.toLowerCase() === currentUser.email?.toLowerCase())?.id);
              if (myHistory.length >= (quiz.maxAttempts || 1)) {
                  alert(`Bạn đã hết số lần làm bài! (Tối đa ${quiz.maxAttempts || 1} lần)`);
                  return;
              }
          }
      }

      // Khôi phục lại màn hình chờ (Instructions)
      setPendingExamState({ quiz, isPreview: isTeacherPreview, isStudentTestUI });
  };

  const confirmStartExam = (quiz: Quiz, isTeacherPreview = false, isStudentTestUI = false) => {
      // isStudentTestUI: dùng đề mã hóa + đánh dấu isPreview để KHÔNG lưu kết quả thật
      const quizToLoad = isStudentTestUI ? createTestUIQuiz(quiz) : quiz;
      const isPreviewMode = isTeacherPreview || isStudentTestUI;

      setExamAnswers({});
      setExamTimeLeft(quizToLoad.timeLimit * 60);
      setExamStartTime(getRealTime());
      trueEndTimeRef.current = getRealTime() + quizToLoad.timeLimit * 60000;
      setGracePeriod(null);
      setHardLocked(false);
      setIsPreview(isPreviewMode);
      setExamCheatCount(0);
      setFlaggedQuestions([]);
      setScratchpadText("");
      setQNotes({});
      
      setActiveExam(quizToLoad);
      
      if (quizToLoad.audioUrl && audioRef.current) {
          audioRef.current.src = quizToLoad.audioUrl;
          audioRef.current.load();
      }
      
      if (document.documentElement.requestFullscreen && !isPreviewMode) {
          document.documentElement.requestFullscreen().catch(e => console.log(e));
      }
  };


  const _toggleFlag = (qId: string) => setFlaggedQuestions(p => p.includes(qId) ? p.filter(x => x !== qId) : [...p, qId]);

  const handleRecalculateScores = (quizId: string) => {
      if(!confirm("Recalculate ALL past attempts based on the current Answer Key? Are you sure?")) return;
      const qz = quizzes.find(q => q.id === quizId);
      if (!qz) return;
      const nxResults = quizResults.map(r => {
          if (r.quizId !== quizId) return r;
          let newScore = 0;
          qz.questions.forEach((q) => {
              const studentAns = r.answers[q.id];
              if (q.type === "CHOICE") { if (studentAns === q.correctAnswer) newScore++; } 
              else {
                  if (studentAns !== undefined && studentAns !== null) {
                      const sAns = String(studentAns).trim().toLowerCase();
                      const cA = String(q.correctAnswer).split("/").map(s => s.trim().toLowerCase());
                      if (cA.includes(sAns)) newScore++;
                  }
              }
          });
          return {...r, score: newScore, band: getIeltsBand(newScore, qz.questions.length)};
      });
      setQuizResults(nxResults); syncData({quizResults: nxResults});
      alert("Successfully recalculated all past attempts!");
  };

  const handleVoiceFeedback = (resultId: string) => {
      if (!('webkitSpeechRecognition' in window)) { alert("Browser does not support voice recognition. Please use Chrome."); return; }
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      const recognition = new SpeechRecognition();
      recognition.lang = 'vi-VN'; recognition.start();
      recognition.onresult = (event: any) => {
          const transcript = event.results[0][0].transcript;
          const nx = quizResults.map(x => x.id === resultId ? {...x, teacherFeedback: (x.teacherFeedback ? x.teacherFeedback + " " : "") + transcript} : x);
          setQuizResults(nx); syncData({ quizResults: nx });
      };
      recognition.onerror = () => alert("Recording error!");
  };

  const forceSubmitExam = () => {
      const state = latestExamState.current;
      if (!state.activeExam) return;

      let score = 0;
      const totalQ = state.activeExam.questions.length;
      state.activeExam.questions.forEach((q) => {
          const studentAns = state.examAnswers[q.id];
          if (q.type === "CHOICE") { if (studentAns === q.correctAnswer) score++; } 
          else if (q.type === "BLANK") {
              if (studentAns !== undefined && studentAns !== null) {
                  const sAns = String(studentAns).trim().toLowerCase();
                  const correctStrs = String(q.correctAnswer).split("/").map(s => s.trim().toLowerCase());
                  if (correctStrs.includes(sAns)) score++;
              }
          }
      });

      const band = getIeltsBand(score, totalQ);

     if (state.isPreview) {
            alert(`PREVIEW COMPLETE! Score: ${score}/${totalQ}. Band: ${band}.`);
            setActiveExam(null); 
            setIsPreview(false); 
            if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
            return;
        }

      const me = students.find(s => s.email?.toLowerCase() === currentUser?.email?.toLowerCase());
      if (!me) return;

      const endTime = getRealTime();
      const durationSecs = Math.floor((endTime - examStartTime) / 1000);

      const result: QuizResult = {
          id: getTrueTime().toString(), quizId: state.activeExam.id, quizTitle: state.activeExam.title, studentId: me.id, studentName: me.name,
          date: new Date().toLocaleString("vi-VN"), score, total: totalQ, band, cheatCount: state.examCheatCount,
          startTime: new Date(examStartTime).toLocaleString("vi-VN"), endTime: new Date(endTime).toLocaleString("vi-VN"),
          durationSeconds: durationSecs, deviceInfo: navigator.userAgent, ipAddress: studentIp, answers: state.examAnswers,
          scratchpad: state.scratchpadText, flaggedQuestions: state.flaggedQuestions, isRead: false
      };

      let earnedCoins = 50; 
      if (state.activeExam.scheduledEnd) {
          const endMs = parseVNTime(state.activeExam.scheduledEnd);
          const diffHour = (endMs - endTime) / (1000 * 3600);
          if (diffHour >= 24) earnedCoins += 150; 
          else if (diffHour >= 12) earnedCoins += 100; 
      }
      const nxStudents = students.map(s => s.id === me.id ? { ...s, coins: (s.coins || 0) + earnedCoins } : s);
      setStudents(nxStudents);

      if (isOffline) {
          localStorage.setItem(`ielts_offline_result_${currentUser?.email}`, JSON.stringify(result));
          alert("NETWORK ERROR! The exam has been saved locally. Please do not clear your browser cache; it will auto-sync when the connection is restored.");
      } else {
          const nx = [result, ...quizResults];
          setQuizResults(nx); syncData({ quizResults: nx, students: nxStudents });
      }

      if (!state.isPreview) {
          setLiveSessions(prev => {
              const nx = prev.filter(x => x.id !== (currentUser?.email || "unknown"));
              syncLiveArena(nx);
              return nx;
          });
      }

      localStorage.removeItem(`ielts_os_exam_state_${currentUser?.email}`);
      setAudioTested(false);
      if (Number(band) >= 7.0) { setShowCelebration(true); setTimeout(() => setShowCelebration(false), 8000); }
        alert(`EXAM SUBMITTED! Score: ${score}/${totalQ}. Band: ${band}.`);
        setActiveExam(null); setGracePeriod(null); setHardLocked(false);
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    }
  const submitExam = (isTimeUp = false) => {
    if (!activeExam) return;
    if (!isTimeUp) {
        const timeRatio = examTimeLeft / (activeExam.timeLimit * 60);
        
        if (timeRatio > 0.5) { if (!confirm(`⏳ WARNING: You still have more than half the time left! Please review your answers carefully.\nDo you still want to submit early?`)) return; }

        const unanswered = activeExam.questions.filter(q => examAnswers[q.id] === undefined || examAnswers[q.id] === "");
        const flagged = activeExam.questions.filter(q => flaggedQuestions.includes(q.id));

        let msg = "Confirm submission?";
        if (unanswered.length > 0) msg = `⚠️ YOU HAVE ${unanswered.length} UNANSWERED QUESTIONS: ${unanswered.map(q => activeExam.questions.indexOf(q)+1).join(", ")}!\n\n` + msg;
        else if (flagged.length > 0) msg = `📌 You still have ${flagged.length} flagged questions.\n\n` + msg;
        if (!confirm(msg)) return;
    }
    if (examTimerRef.current) window.clearInterval(examTimerRef.current);
    forceSubmitExam();
  };

  const handleBulkDeleteHistory = () => {
      if(!confirm(`Delete ${selectedSessions.length} selected sessions?`)) return;
      const nx = history.filter(h => !selectedSessions.includes(h.id.toString()));
      setHistory(nx); syncData({history: nx}); setSelectedSessions([]);
  };

  const handleBulkDeleteResults = () => {
      if(!confirm(`Delete ${selectedResults.length} selected results?`)) return;
      const nx = quizResults.filter(r => !selectedResults.includes(r.id));
      setQuizResults(nx); syncData({quizResults: nx}); setSelectedResults([]);
  };
  
  const handleBulkDeleteQuizzes = () => {
      if(!confirm(`Delete ${selectedQuizzes.length} selected exams?`)) return;
      const nx = quizzes.filter(q => !selectedQuizzes.includes(q.id));
      setQuizzes(nx); syncData({quizzes: nx}); setSelectedQuizzes([]);
  };

  // ==========================================
  // STYLES & CALCS
  // ==========================================
  const calHeader = calDate.toLocaleString("vi-VN", { month: "long", year: "numeric" });
  const calendarDays = useMemo(() => {
    const year = calDate.getFullYear(); const month = calDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay(); const daysInMonth = new Date(year, month + 1, 0).getDate();
    const days = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) {
      const dStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
      days.push({ day: i, date: dStr, hasSched: schedules.some(s => s.date === dStr) });
    }
    return days;
  }, [calDate, schedules]);

  const stats = useMemo(() => {
    const rev = history.reduce((s, h) => s + (h.earnings || 0), 0);
    const extraInc = transactions.filter(t => t.type === "INCOME").reduce((s, t) => s + (t.amount || 0), 0);
    const exp = transactions.filter(t => t.type === "EXPENSE").reduce((s, t) => s + (t.amount || 0), 0);
    return { rev, extraInc, totalRev: rev + extraInc, exp, net: (rev + extraInc) - exp, unpaid: history.filter(h => !h.isPaid).reduce((s, h) => s + (h.earnings || 0), 0) };
  }, [history, transactions]);

  const filteredHistory = useMemo(() => history.filter(h => !selStudent || h.studentId === selStudent), [history, selStudent]);
  const currentViewEarnings = filteredHistory.reduce((s, h) => s + (h.earnings || 0), 0);
  const currentViewHours = filteredHistory.reduce((s, h) => s + (h.duration || 0), 0) / 3600;

  const totalRev = stats.totalRev || 0; const totalExp = stats.exp || 0; const totalCashflow = totalRev + totalExp;
  const revPct = totalCashflow === 0 ? 50 : (totalRev / totalCashflow) * 100;

  const teacherSkillStats = useMemo(() => {
    const s: Record<string, number> = {};
    filteredHistory.forEach(h => {
        const skillsArr = Array.isArray(h.skills) ? h.skills : [];
        const t = (h.duration || 0) / (skillsArr.length || 1);
        skillsArr.forEach(sk => { s[sk] = (s[sk] || 0) + t; });
    });
    return s;
  }, [filteredHistory]);

  const filteredQuizResults = useMemo(() => {
     return quizResults.filter(r => {
         if (resFilterStudent && r.studentId !== resFilterStudent) return false;
         if (resFilterQuiz && r.quizId !== resFilterQuiz) return false;
         if (resFilterBand === ">=7.0" && Number(r.band) < 7.0) return false;
         if (resFilterBand === "<6.0" && Number(r.band) >= 6.0) return false;
         if (resultSearch && !r.studentName.toLowerCase().includes(resultSearch.toLowerCase())) return false;
         return true;
     });
  }, [quizResults, resFilterStudent, resFilterQuiz, resFilterBand, resultSearch]);

  const bandStats = useMemo(() => {
      const s: Record<string, number> = {};
      filteredQuizResults.forEach(r => { if (r.band !== "N/A") s[r.band] = (s[r.band] || 0) + 1; });
      return s;
  }, [filteredQuizResults]);

  const avgFilteredQuizScore = useMemo(() => {
      if (!resFilterQuiz) return null;
      const results = quizResults.filter(r => r.quizId === resFilterQuiz);
      if (results.length === 0) return "N/A";
      const validScores = results.map(r => Number(r.band)).filter(b => !isNaN(b));
      if (validScores.length === 0) return "N/A";
      return (validScores.reduce((a,b)=>a+b, 0) / validScores.length).toFixed(1);
  }, [quizResults, resFilterQuiz]);

      const meGlobal = useMemo(() => students.find(s => (s.email || "").toLowerCase() === (currentUser?.email || "").toLowerCase()), [students, currentUser]);
      const equippedThemeGlobal = meGlobal?.inventory?.equippedTheme || "";
      const isDarkTheme = theme === "dark" || (activeExam && (equippedThemeGlobal.includes("Cyberpunk") || equippedThemeGlobal.includes("Dark VIP")));

      const C = {
        bg: isDarkTheme ? (colorblind ? "#000000" : "#0D1117") : (colorblind ? "#FFFFFF" : "#FFFFFF"),
        card: isDarkTheme ? (colorblind ? "#1A1A1A" : "#161B22") : (colorblind ? "#F5F5F5" : "#FFFFFF"),
        border: isDarkTheme ? (colorblind ? "#FFFFFF" : "#30363D") : (colorblind ? "#CCCCCC" : "#E1E4E8"),
        text: isDarkTheme ? "#FFFFFF" : "#000000",
        sub: isDarkTheme ? (colorblind ? "#CCCCCC" : "#8B949E") : (colorblind ? "#333333" : "#586069"),
        accent: colorblind ? "#0055FF" : "#0366D6",
        succ: colorblind ? "#008A00" : "#28A745",
        warn: colorblind ? "#E59700" : "#F6A821",
        err: colorblind ? "#E50000" : "#D73A49"
      };

  const globalStyles = useMemo(() => (
    <style>{`
      * { box-sizing: border-box; }
      html, body, #root { width: 100% !important; max-width: 100% !important; margin: 0 !important; padding: 0 !important; overflow-x: hidden; }
      body { background: ${C.bg}; color: ${C.text}; font-family: ${fontFam}, system-ui, sans-serif; }
      button { cursor: pointer; border: none; border-radius: 6px; transition: 0.15s; font-weight: 600; font-family: inherit; }
      input, select, textarea { background: ${C.card}; color: ${C.text}; border: 1px solid ${C.border}; border-radius: 6px; padding: 10px 14px; outline: none; width: 100%; font-family: inherit; }
      input:focus, select:focus, textarea:focus { border-color: ${C.accent}; box-shadow: 0 0 0 3px ${C.accent}20; }
      .card { background: ${C.card}; border: 1px solid ${C.border}; border-radius: 12px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); }
      .tab-btn { padding: 10px 16px; background: transparent; color: ${C.sub}; font-size: 13px; font-weight: 700; border-radius: 6px; }
      .tab-btn.active { color: ${C.accent}; background: ${C.accent}15; }
      .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; margin-top: 10px; }
      .cal-day { aspect-ratio: 1; display: grid; place-items: center; font-size: 12px; border-radius: 6px; cursor: pointer; border: 1px solid transparent; color: ${C.text}; font-weight: 500; }
      .cal-day:hover { background: ${C.border}; }
      .cal-day.empty { cursor: default; border: none; background: transparent; }
      .cal-day.empty:hover { background: transparent; }
      .cal-day.has-sched { background: ${C.accent}15; color: ${C.accent}; font-weight: 800; border-color: ${C.accent}40; }
      .cal-day.selected { background: ${C.accent} !important; color: #fff !important; font-weight: 800; }
      .timer-num { font-family: 'SFMono-Regular', Consolas, monospace; letter-spacing: -2px; }
      @keyframes pulseFast { 0%, 100% { opacity: 1; color: ${C.err}; transform: scale(1.05); } 50% { opacity: 0.8; color: #ff0000; transform: scale(1); } }
      .pulse-fast { animation: pulseFast 0.8s infinite; }
      .booting-screen { height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; background: ${C.bg}; color: ${C.text}; font-family: 'system-ui'; font-size: 16px; letter-spacing: 1px; }
      .booting-spinner { width: 40px; height: 40px; border: 4px solid ${C.border}; border-top-color: ${C.accent}; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 20px; }
      @keyframes spin { to { transform: rotate(360deg); } }
      @keyframes fall { 0% { transform: translateY(-100vh) rotate(0deg); opacity: 1;} 100% { transform: translateY(100vh) rotate(360deg); opacity: 0;} }
      .group-context { padding: 15px; background: ${C.warn}10; border: 1px solid ${C.warn}50; border-radius: 8px; margin-bottom: 20px; font-style: italic; color: ${C.text}; white-space: pre-wrap; overflow-x: auto; }
      .highlightable-content table { width: auto !important; max-width: 100% !important; border-collapse: collapse !important; margin: 15px auto !important; }
      .highlightable-content table td, .highlightable-content table th { padding: 8px !important; border: 1px solid #ccc !important; }
      .marquee-container { overflow: hidden; white-space: nowrap; width: 100%; flex: 1; margin-left: 10px; }
      .marquee-content { display: inline-block; animation: marquee 15s linear infinite; }
      @keyframes marquee { 0% { transform: translateX(100%); } 100% { transform: translateX(-100%); } }
      .audio-bars { display: flex; gap: 2px; height: 15px; align-items: flex-end; }
      .audio-bar { width: 3px; background: #fff; animation: bounce 0.5s infinite alternate; }
      .audio-bar:nth-child(2) { animation-delay: 0.1s; }
      .audio-bar:nth-child(3) { animation-delay: 0.2s; }
      label { touch-action: manipulation; }
      .student-highlight { background-color: #FFE066; color: #000; cursor: pointer; }

      @media (max-width: 768px) {
        .exam-two-column { flex-direction: column !important; overflow-y: auto !important; display: block !important; }
        .exam-passage-col, .exam-question-col { width: 100% !important; margin: 0 !important; padding: 15px !important; height: auto !important; overflow: visible !important; border-right: none !important; }
        .exam-passage-col { border-bottom: 3px solid ${C.accent} !important; }
        .exam-map-col { width: 100% !important; height: auto !important; border-left: none !important; border-top: 2px solid ${C.border} !important; display: flex; flex-direction: column; }
        .exam-map-grid { grid-template-columns: repeat(8, 1fr) !important; max-height: 250px; overflow-y: auto; }
        .exam-header-buttons { flex-wrap: wrap; gap: 5px; justify-content: center; margin-top: 10px; }
        .exam-action-btn { padding: 6px 8px !important; font-size: 12px !important; }
        .timer-num { font-size: 22px !important; }
        .card { padding: 15px !important; margin-bottom: 15px !important; }
        .tab-btn { padding: 6px 10px; font-size: 11px; }
        .exam-header-top { flex-direction: column; align-items: flex-start !important; gap: 5px; }
      }

      @media print {
        .no-print { display: none !important; }
        * { color: #000 !important; background: transparent !important; box-shadow: none !important; text-shadow: none !important; }
        body { background: white !important; padding: 0 !important; }
        .print-area { display: block !important; width: 100% !important; }
        .unified-report { border: 1px solid #000; padding: 20px; font-family: sans-serif; }
        .report-header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 20px; }
        .report-title { font-size: 24px; font-weight: bold; margin: 0; }
        .report-subtitle { font-size: 12px; text-transform: uppercase; margin-top: 5px; }
        .student-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 20px; font-size: 12px; }
        .meta-label { font-weight: bold; text-transform: uppercase; font-size: 10px; }
        .session-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 11px; }
        .session-table th, .session-table td { border: 1px solid #000; padding: 5px; text-align: left; }
        .session-table th { font-weight: bold; text-transform: uppercase; }
        .eval-box { border: 1px dashed #000; padding: 10px; margin-bottom: 30px; height: 100px; }
        .signature-area { display: grid; grid-template-columns: 1fr 1fr; text-align: center; margin-top: 30px; }
        .sig-line { border-bottom: 1px solid #000; width: 150px; margin: 30px auto 5px auto; }
        .blank-answer-sheet { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; font-family: monospace; }
       .ans-box { border: 1px solid #000; padding: 10px; font-size: 16px; position: relative; height: 50px; }
            .ans-num { position: absolute; top: 2px; left: 5px; font-size: 10px; }
          }
          .highlightable-content, .highlightable-content * { color: inherit !important; background-color: transparent !important; }
          .student-highlight, .student-highlight * { color: #000 !important; background-color: #FFE066 !important; }
          .toolbar-btn { background: ${C.bg}; color: ${C.text}; border: 1px solid ${C.border}; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 13px; }
        /* CSS CHO CÁC DẠNG BÀI MỚI VÀ NAVIGATOR CHUẨN IDP */
      .idp-dropzone { display: inline-block; min-width: 100px; min-height: 28px; border: 1px dashed #666; background: #fafafa; vertical-align: middle; margin: 0 4px; padding: 2px 8px; font-weight: bold; color: #0969da; cursor: pointer; text-align: center; }
      .idp-dropzone.filled { border-style: solid; background: #e6f0ff; }
      .idp-draggable { display: inline-block; border: 1px solid #333; padding: 6px 12px; margin: 4px; background: #fff; cursor: grab; border-radius: 2px; font-weight: bold; }
      .idp-matching-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
      .idp-matching-table th, .idp-matching-table td { border: 1px solid #ccc; padding: 10px; text-align: center; }
      .idp-matching-table td:first-child { text-align: left; background: #fff; }
      .idp-footer-nav { position: absolute; bottom: 0; left: 0; right: 0; height: 50px; background: #fff; border-top: 2px solid #eee; display: flex; justify-content: space-between; align-items: center; z-index: 100; }
      .idp-nav-squares { display: flex; gap: 5px; padding: 0 15px; overflow-x: auto; flex: 1; align-items: center; height: 100%; }
      .idp-nav-sq { width: 26px; height: 26px; border: 1px solid #ccc; background: #fff; cursor: pointer; font-size: 12px; font-weight: bold; color: #333; display: flex; justify-content: center; align-items: center; border-radius: 2px; flex-shrink: 0; }
      .idp-nav-sq.ans { border-color: #333; border-bottom: 4px solid #333; }
      .idp-nav-sq:hover { border-color: #0969da; }
      .idp-submit-btn { width: 50px; height: 100%; background: #222; border: none; cursor: pointer; display: flex; justify-content: center; align-items: center; transition: 0.2s; }
      .idp-submit-btn:hover { background: #000; }
      .idp-check-icon { width: 16px; height: 26px; border: solid #fff; border-width: 0 4px 4px 0; transform: rotate(45deg); display: inline-block; margin-bottom: 6px; }
      .highlight-flash { animation: flashYellow 1.5s; }
      @keyframes flashYellow { 0%, 100% { background-color: transparent; } 50% { background-color: #fff3cd; } }
          `}</style>
  ), [theme, colorblind, C.card, C.text, C.border, C.sub, C.accent, C.bg, C.err, C.warn, fontFam]);

  // ==========================================
  // MEMOIZED EXAM STRUCTURE
  // ROOT FIX: tách groupedQuestions + processedContexts ra khỏi render scope.
  // Dependency: activeExam?.questions — chỉ thay đổi khi đề mới / highlight thay đổi,
  // KHÔNG thay đổi khi timer tick (setExamTimeLeft không động đến activeExam).
  // → dangerouslySetInnerHTML nhận cùng chuỗi → React bỏ qua DOM update → input không bị remount → focus giữ nguyên.
  // ==========================================
  const _examRenderSafeHTML = (raw: string | undefined): string => {
      if (!raw) return "";
      return raw.includes('student-highlight') ? raw : formatContent(raw);
  };

  const examGroupedQuestions = useMemo(() => {
      if (!activeExam) return [] as { context: string; instruction: string; questions: QuizQuestion[] }[];
      const result: { context: string; instruction: string; questions: QuizQuestion[] }[] = [];
      let cur: { context: string; instruction: string; questions: QuizQuestion[] } = { context: "", instruction: "", questions: [] };
      (activeExam.questions || []).forEach((q: QuizQuestion) => {
          const ctx = q.groupContext || "";
          const ins = q.instruction || "";
          const same = cur.questions.length > 0 && ins === cur.instruction && (ctx === "" || ctx === cur.context);
          if (same) {
              cur.questions.push(q);
          } else {
              if (cur.questions.length > 0) result.push(cur);
              cur = { context: ctx || cur.context, instruction: ins, questions: [q] };
          }
      });
      if (cur.questions.length > 0) result.push(cur);
      return result;
 
  }, [activeExam?.questions]);

  const examProcessedContexts = useMemo(() => {
      if (!activeExam || examGroupedQuestions.length === 0) return {} as Record<string, { html: string; injected: string[] }>;
      const result: Record<string, { html: string; injected: string[] }> = {};
      const allQ = activeExam.questions || [];
      examGroupedQuestions.forEach((group) => {
          if (group.context && !result[group.context]) {
              let res = _examRenderSafeHTML(group.context);
              const injected: string[] = [];
              group.questions.forEach((gq: QuizQuestion) => {
                  if (gq.type === 'BLANK' || gq.type === 'DRAG_DROP') {
                      const qIndexGlobal = allQ.findIndex((x: any) => x.id === gq.id) + 1;
                      const inputHtml = gq.type === 'DRAG_DROP'
                          ? `<span class="idp-dropzone" data-qid="${gq.id}">${qIndexGlobal}</span>`
                          : `<input type="text" class="idp-inline-input inline-blank-input" data-qid="${gq.id}" placeholder="${qIndexGlobal}" autocomplete="off" />`;
                      
                      const oldRes = res;
                      const exactRegex = new RegExp(`(?:\\(|\\[)?\\b${qIndexGlobal}\\b(?:\\)|\\])?\\.?\\s*(?:_{2,}|\\.{4,})`, 'i');
                      if (exactRegex.test(res)) {
                          res = res.replace(exactRegex, inputHtml);
                      } else {
                          res = res.replace(/_{2,}|\\.{4,}/, inputHtml);
                      }
                      if (res !== oldRes) injected.push(gq.id);
                  }
              });
              result[group.context] = { html: res, injected };
          }
      });
      return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examGroupedQuestions]);

  // ==========================================
  // VIEW RENDER
  // ==========================================
  if (authChecking) return <div className="booting-screen"><div className="booting-spinner"></div><div style={{animation: 'pulse 2s infinite', fontWeight: 600}}>AUTHENTICATING...</div></div>;

  if (!currentUser) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif" }}>
        {globalStyles}
        <form onSubmit={handleLogin} className="card" style={{ width: 380, maxWidth: "90%", padding: "40px 30px", boxShadow: "0 10px 30px rgba(0,0,0,0.05)" }}>
          <div style={{ textAlign: "center", marginBottom: 40 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                <div style={{ background: C.accent, color: "white", width: 48, height: 48, borderRadius: 12, display: "grid", placeItems: "center", fontWeight: 900, fontSize: 24 }}>I</div>
                <h1 style={{ margin: 0, fontSize: 32, fontWeight: 900, color: C.text, letterSpacing: -1 }}>IELTS <span style={{ color: C.accent }}>OS</span></h1>
            </div>
            <div style={{ color: C.sub, fontSize: 11, letterSpacing: 1.5, marginTop: 10, fontWeight: 700, textTransform: 'uppercase' }}>{t('login_subtitle')}</div>
          </div>
          {loginError && <div style={{ background: `${C.err}15`, border: `1px solid ${C.err}30`, color: C.err, padding: 12, borderRadius: 8, fontSize: 13, marginBottom: 20, textAlign: 'center', fontWeight: 600 }}>{loginError}</div>}
          <div style={{ display: "grid", gap: 18 }}>
            <div><label style={{ fontSize: 11, fontWeight: 800, color: C.sub, marginBottom: 6, display: 'block' }}>{t('email_label')}</label><input type="email" value={email} onChange={(e: any) => setEmail(e.target.value)} required /></div>
            <div>
                <label style={{ fontSize: 11, fontWeight: 800, color: C.sub, marginBottom: 6, display: 'block' }}>{t('pwd_label')}</label>
                <div style={{display: 'flex', position: 'relative'}}>
                    <input type={showPwd ? "text" : "password"} value={password} onChange={(e: any) => setPassword(e.target.value)} required style={{paddingRight: 40}} />
                    <button type="button" onClick={() => setShowPwd(!showPwd)} style={{position: 'absolute', right: 5, top: '50%', transform: 'translateY(-50%)', background: 'none', fontSize: 16}} title="Toggle Password">👁️</button>
                </div>
            </div>
            <button type="submit" style={{ background: C.accent, color: "#fff", padding: "14px", marginTop: 10, fontSize: 14, fontWeight: 800 }}>{t('login_btn')}</button>
          </div>
        </form>
      </div>
    );
  }

  if (!loaded) return <div className="booting-screen"><div className="booting-spinner"></div><div style={{animation: 'pulse 2s infinite', fontWeight: 600}}>SYNCING CLOUD DATA...</div></div>;

  if (reviewQuiz) {
      let currentContext = "";
      return (
          <div style={{ height: "100vh", background: C.bg, color: C.text, display: "flex", flexDirection: "column", overflow: "hidden" }} onMouseUp={handleAutoHighlight} onTouchEnd={handleAutoHighlight} onDoubleClick={handleRemoveHighlight}>
              {globalStyles}
              <div style={{ flex: 'none', background: C.card, padding: "15px 24px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", zIndex: 100 }}>
                  <div style={{fontWeight: 900, fontSize: 18}}>REVIEW: {reviewQuiz.quiz.title}</div>
                  <button onClick={() => setReviewQuiz(null)} style={{background: C.bg, color: C.text, border: `1px solid ${C.border}`, padding: '8px 20px'}}>Back</button>
              </div>
              <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                  {reviewQuiz.quiz.type !== "Listening" && (
                      <div style={{ width: '50%', height: '100%', overflowY: 'auto', padding: "30px 40px", borderRight: `1px solid ${C.border}`, lineHeight: 1.8, fontSize: 16, background: '#fff', color: '#333' }}>
                          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `2px solid ${C.accent}`, marginBottom: 15, paddingBottom: 10}}>
                              <h2 style={{marginTop: 0, color: C.accent, margin: 0}}>READING PASSAGE</h2>
                          </div>
                          {reviewQuiz.quiz.images?.map((imgUrl, idx) => <img key={idx} src={imgUrl} alt="Passage" style={{maxWidth: '100%', borderRadius: 8, display: 'block', marginBottom: 15}} />)}
                          <div id="ielts-passage-content" style={{whiteSpace: 'pre-wrap', textAlign: 'justify'}} dangerouslySetInnerHTML={{__html: formatContent(reviewQuiz.quiz.passage || "")}} />
                      </div>
                  )}
                  <div style={{ flex: 1, width: reviewQuiz.quiz.type === "Listening" ? '100%' : '50%', maxWidth: reviewQuiz.quiz.type === "Listening" ? 900 : 'none', margin: '0 auto', height: '100%', overflowY: 'auto', padding: "30px 40px", background: C.bg }}>
                      
                      <div style={{background: C.card, padding: 20, borderRadius: 12, marginBottom: 20, border: `1px solid ${C.border}`}}>
                          <div style={{fontSize: 24, fontWeight: 900, color: C.accent}}>Score: {reviewQuiz.result.score}/{reviewQuiz.result.total} (Band {reviewQuiz.result.band})</div>
                          
                          {reviewQuiz.quiz.type === "Listening" && reviewQuiz.quiz.audioUrl && (
                              <div style={{marginTop: 15, padding: 15, background: `${C.accent}10`, borderRadius: 8, display: 'flex', alignItems: 'center', gap: 15}}>
                                  <audio ref={audioRef} controls controlsList="nodownload" onContextMenu={(e) => e.preventDefault()} src={reviewQuiz.quiz.audioUrl} style={{flex: 1}} />
                                  <div style={{display: 'flex', gap: 5}}>
                                      <button onClick={() => { if(audioRef.current) audioRef.current.playbackRate = 1; setPlaybackRate(1); }} style={{background: playbackRate===1?C.accent:C.bg, color: playbackRate===1?'#fff':C.text, padding: '4px 8px', fontSize: 11}}>1.0x</button>
                                      <button onClick={() => { if(audioRef.current) audioRef.current.playbackRate = 1.25; setPlaybackRate(1.25); }} style={{background: playbackRate===1.25?C.accent:C.bg, color: playbackRate===1.25?'#fff':C.text, padding: '4px 8px', fontSize: 11}}>1.25x</button>
                                      <button onClick={() => { if(audioRef.current) audioRef.current.playbackRate = 1.5; setPlaybackRate(1.5); }} style={{background: playbackRate===1.5?C.accent:C.bg, color: playbackRate===1.5?'#fff':C.text, padding: '4px 8px', fontSize: 11}}>1.5x</button>
                                  </div>
                              </div>
                          )}
                          
                          {reviewQuiz.result.teacherFeedback && <div style={{marginTop: 10, background: `${C.warn}15`, padding: 10, borderRadius: 8}}><b>Teacher's feedback:</b> {reviewQuiz.result.teacherFeedback}</div>}
                          
                          {reviewQuiz.result.flaggedQuestions && reviewQuiz.result.flaggedQuestions.length > 0 && (
                              <div style={{marginTop: 10, color: C.err, fontSize: 13}}><b>📌 Flagged questions during exam:</b> {reviewQuiz.result.flaggedQuestions.map(id => reviewQuiz.quiz.questions.findIndex(q=>q.id===id)+1).join(', ')}</div>
                          )}
                          
                          {reviewQuiz.result.scratchpad && (
                              <div style={{marginTop: 10, background: '#FFF9C4', padding: 10, borderRadius: 8, color: '#000', fontSize: 13, whiteSpace: 'pre-wrap'}}>
                                  <b>📝 Your notes:</b><br/>{reviewQuiz.result.scratchpad}
                              </div>
                          )}

                          <div style={{marginTop: 15, borderTop: `1px dashed ${C.border}`, paddingTop: 15}}>
                              <div style={{fontSize: 13, fontWeight: 800, marginBottom: 10}}>📊 WEAKNESS ANALYSIS BY TYPE:</div>
                              <div style={{display: 'flex', gap: 15, flexWrap: 'wrap'}}>
                                  {(() => {
                                      const groups: Record<string, QuizQuestion[]> = {};
                                      reviewQuiz.quiz.questions.forEach(q => {
                                          const label = q.subType || (q.type === 'CHOICE' ? 'Multiple Choice' : 'Sentence Completion');
                                          if (!groups[label]) groups[label] = [];
                                          groups[label].push(q);
                                      });
                                      return Object.entries(groups).map(([label, typeQs]) => {
                                          let correctInType = 0;
                                          typeQs.forEach(q => {
                                              const sAns = reviewQuiz.result.answers[q.id];
                                              if (q.type === "CHOICE" && sAns === q.correctAnswer) correctInType++;
                                              if (q.type === "BLANK" && sAns !== undefined && sAns !== null) {
                                                  if (String(q.correctAnswer).split("/").map(s => s.trim().toLowerCase()).includes(String(sAns).trim().toLowerCase())) correctInType++;
                                              }
                                          });
                                          const rate = Math.round((correctInType / typeQs.length) * 100);
                                          return (
                                              <div key={label} style={{flex: '1 1 calc(50% - 10px)', minWidth: 160, background: C.bg, padding: 10, borderRadius: 8, border: `1px solid ${C.border}`}}>
                                                  <div style={{fontSize: 11, color: C.sub, fontWeight: 700, textTransform: 'uppercase'}}>{label}</div>
                                                  <div style={{fontSize: 16, fontWeight: 900, color: rate >= 70 ? C.succ : C.err}}>{correctInType}/{typeQs.length} ({rate}%)</div>
                                              </div>
                                          );
                                      });
                                  })()}
                              </div>
                          </div>
                      </div>
                      {reviewQuiz.quiz.questions.map((q, i) => {
                          const studentAns = (reviewQuiz.result.answers && reviewQuiz.result.answers[q.id] !== undefined) ? reviewQuiz.result.answers[q.id] : undefined;
                          let isCorrect = false;
                          let correctDisplay: string | number = String(q.correctAnswer);
                          
                          if (q.type === "CHOICE") {
                              isCorrect = studentAns === q.correctAnswer;
                              correctDisplay = q.options ? q.options[q.correctAnswer as number] : String(q.correctAnswer);
                          } else {
                              const sA = String(studentAns || "").trim().toLowerCase();
                              const cA = String(q.correctAnswer).split("/").map(s => s.trim().toLowerCase());
                              isCorrect = cA.includes(sA);
                          }

                          const showContext = q.groupContext && q.groupContext !== currentContext;
                          if (showContext) currentContext = q.groupContext as string;

                          return (
                          <React.Fragment key={q.id}>
                              {showContext && <div className="group-context" dangerouslySetInnerHTML={{__html: formatContent(q.groupContext || "")}} />}
                              <div className="card" style={{marginBottom: 20, borderLeft: `5px solid ${isCorrect ? C.succ : C.err}`}}>
                                  <div style={{fontWeight: 800, marginBottom: 10}}>Question {i+1}: <span style={{fontWeight: 500}} dangerouslySetInnerHTML={{__html: formatContent(q.text)}} /></div>
                                  <div style={{display:'flex', gap: 10, fontSize: 14}}>
                                      <div style={{background: isCorrect ? `${C.succ}20` : `${C.err}20`, color: isCorrect ? C.succ : C.err, padding: '8px 12px', borderRadius: 6, flex: 1}}>
                                          <b>Your answer:</b> {q.type === "CHOICE" ? (studentAns !== undefined && q.options && q.options.length > 0 ? q.options[studentAns as number] : "No answer") : (studentAns || "No answer")}
                                      </div>
                                      {!isCorrect && (
                                          <div style={{background: `${C.accent}20`, color: C.accent, padding: '8px 12px', borderRadius: 6, flex: 1}}>
                                              <b>Correct answer:</b> {correctDisplay}
                                          </div>
                                      )}
                                  </div>
                              </div>
                          </React.Fragment>
                      )})}
                  </div>
              </div>
          </div>
      );
  }

// ==========================================
      // VIEW: EXAM INSTRUCTIONS (PRE-START)
      // ==========================================
      // ==========================================
      // VIEW: SEB INSTALLATION GUIDE (CHI TIẾT)
      // ==========================================
      if (sebGuideQuiz) {
          return (
              <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: C.bg, zIndex: 99999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
                  <div style={{ background: '#fff', maxWidth: 650, width: '100%', borderRadius: 12, boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)', overflow: 'hidden', border: `1px solid #d1d5db` }}>
                      <div style={{ background: '#dc3545', padding: '25px 30px', color: '#fff', textAlign: 'center' }}>
                          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 1 }}>⚠️ YÊU CẦU TRÌNH DUYỆT BẢO MẬT (SEB)</h2>
                      </div>
                      <div style={{ padding: '30px', fontSize: 15, lineHeight: 1.6, color: '#333' }}>
                          <p style={{ marginTop: 0, fontWeight: 700, fontSize: 16 }}>Bài thi <span style={{ color: '#0969da' }}>"{sebGuideQuiz.title}"</span> được thiết lập ở chế độ bảo mật nghiêm ngặt. Bạn KHÔNG THỂ làm bài trên trình duyệt thông thường (Chrome/Safari/Edge).</p>

                          <div style={{ background: '#fff3cd', border: '1px solid #ffe69c', padding: 20, borderRadius: 8, marginTop: 20 }}>
                              <div style={{ fontWeight: 900, color: '#856404', marginBottom: 15, fontSize: 16 }}>🛠️ HƯỚNG DẪN CÁC BƯỚC ĐỂ VÀO THI:</div>
                              <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 12, color: '#664d03' }}>
                                  <li><b>Tải phần mềm gốc:</b> Truy cập trang web chính thức <a href="https://safeexambrowser.org/download_en.html" target="_blank" rel="noreferrer" style={{ color: '#0969da', fontWeight: 'bold', textDecoration: 'underline' }}>safeexambrowser.org</a> để tải và cài đặt phiên bản SEB phù hợp cho máy tính của bạn (Windows hoặc macOS).</li>
                                  <li><b>Tải file phòng thi:</b> Bấm "Đã hiểu và quay lại" để đóng thông báo này. Chuyển sang Tab <b>📂 Kho Tài Liệu (Drive)</b> trên hệ thống IELTS OS. Tìm và tải file cấu hình đuôi <b>.seb</b> (VD: <i>IELTS_OS.seb</i>) mà giáo viên đã cung cấp.</li>
                                  <li><b>Đóng ứng dụng:</b> Tắt tất cả các phần mềm nhắn tin, trình duyệt khác, hoặc phần mềm quay màn hình đang chạy trên máy tính.</li>
                                  <li><b>Kích hoạt:</b> Nhấn đúp chuột vào file <b>.seb</b> vừa tải về. SEB sẽ tự động khởi động, khóa máy tính và đưa bạn thẳng vào không gian thi an toàn. Bắt đầu đăng nhập và thi như bình thường.</li>
                              </ol>
                          </div>
                      </div>
                      <div style={{ padding: '20px 30px', background: '#f8f9fa', borderTop: `1px solid #d1d5db`, display: 'flex', justifyContent: 'center' }}>
                          <button onClick={() => setSebGuideQuiz(null)} style={{ background: '#343a40', color: '#fff', padding: '12px 40px', fontWeight: 800, fontSize: 15, borderRadius: 4, border: 'none', cursor: 'pointer', transition: '0.2s' }}>ĐÃ HIỂU VÀ QUAY LẠI</button>
                      </div>
                  </div>
              </div>
          );
      }
      if (pendingExamState) {
          const q = pendingExamState.quiz;
          return (
              <div style={{ height: "100vh", background: C.bg, color: C.text, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
                  <div style={{ background: C.card, maxWidth: 800, width: '100%', borderRadius: 16, boxShadow: '0 20px 50px rgba(0,0,0,0.15)', overflow: 'hidden', border: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}>
                      <div style={{ background: C.accent, padding: '30px 40px', color: '#fff', textAlign: 'center' }}>
                          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>{q.title}</h1>
                          <p style={{ margin: '10px 0 0 0', opacity: 0.9, fontSize: 15 }}>Exam Instructions & Rules</p>
                      </div>
                      <div className="instructions-content" style={{ padding: '40px', overflowY: 'auto', flex: 1, fontSize: 16, lineHeight: 1.6 }}>
                          {(q as any).frontInstructions ? (
                              <div dangerouslySetInnerHTML={{ __html: formatContent((q as any).frontInstructions) }} />
                          ) : (
                              <div style={{textAlign: 'center', color: C.sub}}>
                                  <div style={{fontSize: 50, marginBottom: 20}}>📝</div>
                                  <h3 style={{color: C.text, fontSize: 22, marginBottom: 10}}>Welcome to the Exam</h3>
                                  <p style={{fontSize: 15}}>Please read all questions carefully. Make sure you have a stable internet connection. The timer will begin immediately after you click the Start button.</p>
                                  <div style={{background: `${C.warn}15`, padding: '20px', borderRadius: 8, display: 'inline-block', marginTop: 20, textAlign: 'left', border: `1px solid ${C.warn}`}}>
                                      <div style={{color: C.text, fontWeight: 800, fontSize: 16}}>📌 Key Information:</div>
                                      <ul style={{margin: '10px 0 0 0', paddingLeft: 20, color: C.text, fontSize: 15, display: 'flex', flexDirection: 'column', gap: 8}}>
                                          <li><strong>Time Limit:</strong> {q.timeLimit} minutes</li>
                                          <li><strong>Questions:</strong> {(q.questions || []).length} questions</li>
                                          <li><strong>Do not refresh</strong> or close the page during the exam.</li>
                                      </ul>
                                  </div>
                              </div>
                          )}
                      </div>
                      <div style={{ padding: '20px 40px', background: C.bg, borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'center', gap: 15 }}>
                          <button onClick={() => setPendingExamState(null)} style={{ background: 'transparent', color: C.sub, padding: '12px 25px', fontWeight: 700, fontSize: 15, border: `2px solid ${C.border}`, borderRadius: 30, cursor: 'pointer' }}>Go Back</button>
                          <button onClick={() => {
                              const { quiz, isPreview, isStudentTestUI } = pendingExamState;
                              setPendingExamState(null);
                              confirmStartExam(quiz, isPreview, isStudentTestUI);
                          }} style={{ background: C.succ, color: '#fff', padding: '12px 35px', fontWeight: 900, fontSize: 16, boxShadow: '0 4px 15px rgba(0,0,0,0.1)', borderRadius: 30, display: 'flex', alignItems: 'center', gap: 10, border: 'none', cursor: 'pointer' }}>
                              I Understand, Start Exam 
                          </button>
                      </div>
                  </div>
              </div>
          );
      }

     // ==========================================
      // VIEW: EXAM TAKING INTERFACE (IDP STYLE)
      // ==========================================
      if (activeExam) {
          const answeredCount = Object.keys(examAnswers).filter(k => examAnswers[k] !== undefined && examAnswers[k] !== "").length;
          const totalQ = (activeExam.questions || []).length;
          const isTimeRunningOut = examTimeLeft < 300; 
          const answeredPct = Math.round((answeredCount / totalQ) * 100) || 0;

          const idpC = {
              bg: "#ffffff",
              panelBg: "#f4f5f7",
              border: "#d1d5db",
              text: "#24292f",
              sub: "#57606a",
              accent: "#d32f2f", 
              blueAccent: "#0969da",
              succ: "#2da44e",
              warn: "#bf8700"
          };

          const renderSafeHTML = (raw: string | undefined) => {
              if (!raw) return "";
              return raw.includes('student-highlight') ? raw : formatContent(raw);
          };

          const syncHighlightState = (prev: any, field: string, qId: string, cleanHTML: string, optIndex?: string | null) => {
              if (!prev) return null;
              if (field === 'passage') return { ...prev, passage: cleanHTML };
              
              const targetQ = (prev.questions || []).find((qx: any) => qx.id === qId);
              const oldCtx = targetQ?.groupContext;
              const oldIns = targetQ?.instruction;
              
              const nQ = (prev.questions || []).map((qx: any) => {
                  if (qx.id === qId) {
                      if (field === 'options' && optIndex !== null && optIndex !== undefined) {
                          const newOpts = [...(qx.options || [])];
                          newOpts[Number(optIndex)] = cleanHTML;
                          return { ...qx, options: newOpts };
                      }
                      return { ...qx, [field]: cleanHTML };
                  }
                  if (field === 'groupContext' && oldCtx && qx.groupContext === oldCtx) return { ...qx, groupContext: cleanHTML };
                  if (field === 'instruction' && oldIns && qx.instruction === oldIns) return { ...qx, instruction: cleanHTML };
                  return qx;
              });
              return { ...prev, questions: nQ };
          };

          const handleLocalHighlight = (e: React.MouseEvent) => {
              const selection = window.getSelection();
              if (!selection || selection.rangeCount === 0 || selection.toString().trim().length === 0) return;
              let node = selection.anchorNode;
              let container: HTMLElement | null = null;
              while (node && node !== document.body) {
                  if (node.nodeType === 1 && (node as HTMLElement).classList.contains('highlightable-content')) {
                      container = node as HTMLElement;
                      break;
                  }
                  node = node.parentNode;
              }
              if (!container) return;
              try {
                  const range = selection.getRangeAt(0);
                  const span = document.createElement("span");
                  span.className = "student-highlight"; 
                  span.title = "Right click to clear";
                  range.surroundContents(span);
                  
                  const field = container.getAttribute('data-field');
                  const qId = container.getAttribute('data-qid');
                  const optIndex = container.getAttribute('data-optindex');
                  
                  if (field) {
                      let cleanHTML = container.innerHTML;
                      // Chống rác HTML: Dọn dẹp cả ô Input (Điền từ) và ô Dropzone (Kéo thả) trả về nguyên trạng
                                   cleanHTML = cleanHTML.replace(/<input[^>]*class="[^"]*inline-blank-input[^"]*"[^>]*>/gi, '___');
                                   cleanHTML = cleanHTML.replace(/<span[^>]*class="[^"]*idp-dropzone[^"]*"[^>]*>.*?<\/span>/gi, '___');
                                   setActiveExam(prev => syncHighlightState(prev, field, qId || "", cleanHTML, optIndex));
                 
                  }
              } catch (error) { /* Ignore */ }
              selection.removeAllRanges();
          };

          // 1. GỘP NHÓM & XỬ LÝ HTML TĨNH — Pre-computed bằng useMemo ở top-level component.
          //    Ổn định qua mỗi lần re-render do timer tick, chỉ tính lại khi questions/highlight thực sự thay đổi.
          //    Đây là giải pháp gốc rễ cho lỗi mất focus inline-blank-input.
          const groupedQuestions = examGroupedQuestions;
          const processedContexts = examProcessedContexts;

       

          return (
              <div style={{ height: "100vh", background: idpC.bg, color: idpC.text, display: "flex", flexDirection: "column", position: 'relative', filter: !isWindowFocused && !isPreview ? 'blur(10px) grayscale(50%)' : 'none', transition: 'filter 0.3s', fontFamily: "Arial, Helvetica, sans-serif" }} 
                   onCopy={e => { e.preventDefault(); alert("⚠️ WARNING: Copy function disabled!"); }} 
                   onCut={e => { e.preventDefault(); alert("⚠️ WARNING: Cut function disabled!"); }} 
                   onPaste={e => { e.preventDefault(); alert("⚠️ WARNING: Paste function disabled!"); }} 
                   
                   onContextMenu={(e: any) => {
                       if (e.target && e.target.classList && e.target.classList.contains('student-highlight')) {
                           e.preventDefault();
                           const target = e.target as HTMLElement;
                           const container = target.closest('.highlightable-content');
                           const parent = target.parentNode;
                           if (parent) {
                               while (target.firstChild) {
                                   parent.insertBefore(target.firstChild, target);
                               }
                               parent.removeChild(target);
                               parent.normalize();
                           }
                           
                           if (container) {
                               const field = container.getAttribute('data-field');
                               const qId = container.getAttribute('data-qid');
                               const optIndex = container.getAttribute('data-optindex');
                               
                               if (field) {
                                   let cleanHTML = container.innerHTML;
                                   cleanHTML = cleanHTML.replace(/<input[^>]*class="[^"]*inline-blank-input[^"]*"[^>]*>/gi, '___');
                                   cleanHTML = cleanHTML.replace(/<span[^>]*class="[^"]*idp-dropzone[^"]*"[^>]*>.*?<\/span>/gi, '___');
                                   setActiveExam(prev => syncHighlightState(prev, field, qId || "", cleanHTML, optIndex));
                               }
                           }
                       } else {
                           e.preventDefault(); 
                       }
                   }}
                   onMouseUp={handleLocalHighlight}>
                  
                  {globalStyles}
                  
                  <div style={{display: 'none'}} data-legacy={String(splitRatio) + String(setSplitRatio) + String(isDraggingSplitter) + String(setIsDraggingSplitter) + String(isSepia) + String(_setIsSepia) + String(lineHeight) + String(setLineHeight) + String(textAlign) + String(setTextAlign) + String(showLineNumbers) + String(setShowLineNumbers) + String(fontFam) + String(setFontFam) + String(setAudioTested) + String(_setScrollPct) + String(showQuestionNotes) + String(setShowQuestionNotes) + String(_toggleStrike) + String(_toggleFlag) + String(_isFocusMode) + String(setIsFocusMode) + String(isFullScreen) + String(setIsFullScreen) + String(isWindowFocused) + String(enableTimerBeep) + String(setEnableTimerBeep)}></div>

                  <style>{`
                      .exam-passage-col img, .exam-question-col img { max-width: 100% !important; height: auto !important; object-fit: contain; border-radius: 4px; margin: 10px 0; }
                      .exam-two-column { width: 100% !important; max-width: 100% !important; margin: 0 !important; }
                      ::-webkit-scrollbar { width: 10px; height: 10px; }
                      ::-webkit-scrollbar-track { background: #f1f1f1; border-left: 1px solid #ddd; }
                      ::-webkit-scrollbar-thumb { background: #c1c1c1; border-radius: 10px; }
                      ::-webkit-scrollbar-thumb:hover { background: #a8a8a8; }
                      .idp-radio-label { display: flex; alignItems: center; gap: 10px; padding: 12px 15px; border-radius: 0; cursor: pointer; transition: 0.1s; margin-bottom: 5px; background: transparent; border: none; }
                      .idp-radio-label:hover { background: #f0f0f0; }
                      .idp-radio-label.selected { background: #e6f0ff; border-left: 4px solid ${idpC.blueAccent}; font-weight: bold; }
                      input[type="radio"] { width: 18px; height: 18px; cursor: pointer; accent-color: ${idpC.blueAccent}; margin: 0; }
                      .idp-input { border: 1px solid #999; padding: 8px 12px; font-size: 14px; border-radius: 2px; width: 100%; box-shadow: inset 0 1px 2px rgba(0,0,0,0.05); outline: none; }
                      .idp-input:focus { border-color: ${idpC.blueAccent}; box-shadow: 0 0 0 2px rgba(9, 105, 218, 0.2); }
                      
                      .idp-inline-input { border: 1px solid #b3b3b3; border-radius: 2px; padding: 2px 8px; width: 140px; font-size: inherit; font-weight: 600; color: #111; outline: none; text-align: center; background: #fff; box-shadow: inset 0 1px 2px rgba(0,0,0,0.05); margin: 0 4px; font-family: inherit; transition: 0.2s; vertical-align: middle; display: inline-block; }
                      .idp-inline-input:focus { border-color: ${idpC.blueAccent}; box-shadow: 0 0 0 2px rgba(9, 105, 218, 0.2); }
                      
                      .idp-instruction { font-style: italic; color: #555; margin-bottom: 15px; font-size: 14px; }
                      .idp-context-box { border: 1px solid #ccc; padding: 15px; background: #fff; margin-bottom: 20px; font-size: 14px; line-height: 2.2; border-radius: 4px; overflow-x: auto; }
                      .idp-q-card { padding: 0 0 25px 0; margin-bottom: 25px; border-bottom: 1px solid #eaeaea; }
                      .idp-q-card:last-child { border-bottom: none; }
                      
                      .student-highlight { background-color: #FFE066 !important; color: #000 !important; cursor: pointer; }
                  `}</style>

                  {showScratchpad && (
                      <div style={{ position: 'fixed', bottom: 60, right: 30, width: 350, background: '#fff', border: `1px solid ${idpC.border}`, borderRadius: 8, boxShadow: '0 10px 40px rgba(0,0,0,0.2)', zIndex: 99999, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                          <div style={{ background: idpC.panelBg, padding: '10px 15px', borderBottom: `1px solid ${idpC.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 'bold' }}>
                              📝 My Notes
                              <button onClick={() => setShowScratchpad(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 16, color: idpC.sub }}>✖</button>
                          </div>
                          <textarea 
                              value={scratchpadText} 
                              onChange={(e: any) => setScratchpadText(e.target.value)}
                              placeholder="Type your rough notes here..."
                              style={{width: '100%', height: 200, border: 'none', padding: 15, resize: 'none', outline: 'none', fontSize: 14, fontFamily: 'monospace'}}
                          />
                      </div>
                  )}

                  {!isFullScreen && (
                      <div style={{position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: '#000', zIndex: 9999999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#fff'}}>
                          <h1 style={{fontSize: 40, fontWeight: 900, textAlign: 'center', color: C.err}}>⚠️ FULLSCREEN REQUIRED</h1>
                          <p style={{fontSize: 18, maxWidth: 600, textAlign: 'center', marginTop: 10, lineHeight: 1.5}}>The system requires fullscreen mode to ensure the best experience and fairness. Please click the button below to return to your test.</p>
                          <button onClick={() => { if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(()=>{}); }} style={{background: C.accent, color: '#fff', padding: '15px 30px', fontSize: 18, marginTop: 30, borderRadius: 8, fontWeight: 800}}>CLICK HERE TO RETURN</button>
                      </div>
                  )}

                  {hardLocked && !isPreview && (
                      <div style={{position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(215, 58, 73, 0.95)', zIndex: 999999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#fff'}}>
                          <h1 style={{fontSize: 40, fontWeight: 900, margin: 0, textAlign: 'center'}}>YOU HAVE LEFT THE EXAM SCREEN!</h1>
                          <p style={{fontSize: 18, maxWidth: 600, textAlign: 'center'}}>The system has recorded violations ({examCheatCount}/3). Please type <b>RETURN</b> into the box below to unlock your exam.</p>
                          <input value={unlockKey} onChange={e => setUnlockKey(e.target.value)} placeholder="Type here..." style={{width: 300, background: '#fff', color: '#000', fontSize: 18, textAlign: 'center', marginTop: 20}} />
                          {unlockKey === "RETURN" && <button onClick={() => { setHardLocked(false); setUnlockKey(""); }} style={{background: '#000', color: '#fff', padding: '15px 30px', fontSize: 18, marginTop: 20}}>UNLOCK</button>}
                      </div>
                  )}

                  {gracePeriod !== null && (
                      <div style={{position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(215, 58, 73, 0.9)', zIndex: 999999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#fff'}}>
                          <h1 style={{fontSize: 50, fontWeight: 900, margin: 0}}>TIME IS UP!</h1>
                          <p style={{fontSize: 24}}>The system will auto-submit in:</p>
                          <div style={{fontSize: 100, fontWeight: 900}}>{gracePeriod}s</div>
                      </div>
                  )}

                  {timeAlert && (
                      <div style={{position: 'fixed', top: 80, left: '50%', transform: 'translateX(-50%)', background: idpC.accent, color: '#fff', padding: '10px 20px', borderRadius: 30, fontWeight: 900, zIndex: 10000, animation: 'pulse 1s infinite'}}>
                          ⏳ {timeAlert}
                      </div>
                  )}
                  
                  {isOffline && <div style={{background: C.err, color: '#fff', textAlign: 'center', padding: 8, fontWeight: 900, fontSize: 14, animation: 'pulse 1s infinite'}}>🔴 CONNECTION LOST! Local auto-save active.</div>}
                  {screenshotFlash && (
                      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: '#fff', zIndex: 2147483647, pointerEvents: 'none' }} />
                  )}

                  {!isPreview && (
                      <div style={{
                          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none', zIndex: 9500, overflow: 'hidden',
                          userSelect: 'none', WebkitUserSelect: 'none', display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '50px', padding: '20px', opacity: 0.02
                      }}>
                          {Array.from({ length: 40 }).map((_, i) => (
                              <div key={i} style={{ transform: 'rotate(-30deg)', fontSize: 15, fontWeight: 900, color: '#000', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                                  CONFIDENTIAL | ID: {currentUser?.email}
                              </div>
                          ))}
                      </div>
                  )}
                  
                  {/* HEADER */}
                  <div style={{ display: 'flex', flex: 'none', background: idpC.bg, padding: "8px 20px", borderBottom: `1px solid ${idpC.border}`, position: "sticky", top: 0, zIndex: 100, justifyContent: "space-between", alignItems: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 15 }}>
                          <div style={{ color: idpC.accent, fontWeight: 900, fontSize: 24, letterSpacing: -1, fontFamily: "Arial Black, Impact, sans-serif" }}>IELTS<span style={{fontSize:14, verticalAlign: 'super'}}>™</span></div>
                          <div style={{ borderLeft: `1px solid ${idpC.border}`, height: 24, margin: '0 5px' }}></div>
                          <div>
                              <div style={{ fontWeight: 700, fontSize: 13, color: idpC.text }}>{activeExam.title}</div>
                              <div style={{ fontSize: 11, color: idpC.sub }}>Candidate: {currentUser?.email}</div>
                          </div>
                      </div>
                      
                      <div style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
                          <div style={{fontSize: 12, color: '#666', marginRight: 10, display: 'flex', alignItems: 'center', gap: 5}}>
                              {saveStatus === "Saved" ? <span style={{color: idpC.succ}}>✓ Saved</span> : <span style={{color: idpC.warn}}>↻ Saving...</span>} 
                              {isOfflineReady && <span title="Offline cache ready">⚡</span>}
                          </div>

                          {activeExam.type === "Listening" && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#f5f5f5', padding: '4px 10px', borderRadius: 20, border: '1px solid #ddd' }}>
                                    <audio ref={audioRef} src={offlineMedia[activeExam.audioUrl || ""] || activeExam.audioUrl || ""} onEnded={() => setAudioStatus("ENDED")} style={{display: 'none'}} />
                                    <button disabled={audioStatus === "ENDED"} onClick={() => {
                                            if (audioRef.current) {
                                                if (audioStatus === "PLAYING") { audioRef.current.pause(); setAudioStatus("IDLE"); } 
                                                else { audioRef.current.volume = audioVolume; audioRef.current.play().catch(e => console.error(e)); setAudioStatus("PLAYING"); }
                                            }
                                        }}
                                        style={{ background: 'transparent', color: idpC.text, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}
                                    >
                                        {audioStatus === "IDLE" ? `▶ Play` : audioStatus === "PLAYING" ? `⏸ Pause` : `⏹ Ended`}
                                    </button>
                                    <div style={{width: 1, height: 15, background: '#ccc'}}></div>
                                    <span style={{fontSize: 12, color: '#666'}}>Vol:</span>
                                    <input type="range" min="0" max="1" step="0.05" value={audioVolume} onChange={(e: any) => { const v = Number(e.target.value); setAudioVolume(v); if (audioRef.current) audioRef.current.volume = v; }} style={{width: 60, height: 4, accentColor: idpC.blueAccent}} />
                                </div>
                          )}

                          <button onClick={() => setShowScratchpad(!showScratchpad)} style={{background: showScratchpad ? idpC.blueAccent : 'transparent', color: showScratchpad ? '#fff' : idpC.blueAccent, border: `1px solid ${idpC.blueAccent}`, padding: '6px 12px', fontSize: 13, fontWeight: 700, borderRadius: 4, cursor: 'pointer', transition: '0.2s'}}>📝 Notes</button>

                          <div style={{ display: 'flex', gap: 0, background: '#fff', border: `1px solid ${idpC.border}`, borderRadius: 4, overflow: 'hidden' }}>
                              <button onClick={() => setFontSize(p => Math.max(12, p - 2))} style={{ background: '#f9f9f9', padding: '6px 12px', fontSize: 14, color: idpC.text, borderRight: `1px solid ${idpC.border}`, borderRadius: 0 }}>A-</button>
                              <button onClick={() => setFontSize(16)} style={{ background: '#fff', padding: '6px 12px', fontSize: 14, color: idpC.text, borderRight: `1px solid ${idpC.border}`, borderRadius: 0 }}>Standard</button>
                              <button onClick={() => setFontSize(p => Math.min(24, p + 2))} style={{ background: '#f9f9f9', padding: '6px 12px', fontSize: 14, color: idpC.text, borderRadius: 0 }}>A+</button>
                          </div>
                          
                          <div onClick={() => setHideTimer(!hideTimer)} style={{ filter: hideTimer ? 'blur(5px)' : 'none', cursor: 'pointer', fontSize: 20, fontWeight: 700, minWidth: 80, textAlign: 'center', background: isTimeRunningOut ? '#ffebee' : '#f4f5f7', color: isTimeRunningOut ? idpC.accent : idpC.text, padding: '4px 10px', border: `1px solid ${isTimeRunningOut ? '#ffcdd2' : idpC.border}`, borderRadius: 4 }} className={`timer-num ${isTimeRunningOut ? 'pulse-fast' : ''}`} title="Click to hide/show timer">
                              ⏱ {fmtTime(examTimeLeft)}
                          </div>

                          {isPreview && <button onClick={() => { setActiveExam(null); setIsPreview(false); if (document.fullscreenElement) document.exitFullscreen().catch(()=>{}); }} style={{background: '#333', color: '#fff', padding: '8px 16px', fontSize: 13, borderRadius: 4}}>{userRole === "STUDENT" ? "EXIT TEST UI" : "EXIT PREVIEW"}</button>}
                      </div>
                  </div>

                  <div style={{height: 3, background: '#eaeaea', width: '100%', zIndex: 100}}>
                      <div style={{height: '100%', background: idpC.blueAccent, width: `${answeredPct}%`, transition: '0.3s'}} />
                  </div>

                  {/* THÂN BÀI THI KÉO DÀI ĐẾN SÁT ĐÁY ĐỂ CHỪA CHỖ CHO FOOTER */}
                 <div className="exam-two-column" style={{ display: 'flex', flex: 1, overflow: 'hidden', paddingBottom: 50 }}>
                      
                      {activeExam.type !== "Listening" ? (
                          <>
                              {/* CỘT BÀI ĐỌC */}
                              <div style={{ width: `${splitRatio}%`, height: '100%', overflowY: 'auto', padding: "30px 45px", lineHeight: 1.8, fontSize: fontSize, background: '#fff', color: '#111' }}>
                                  <div style={{display: 'flex', gap: 15}}>
                                      <div style={{flex: 1}}>
                                          {activeExam.images?.map((imgUrl, idx) => <img key={idx} src={offlineMedia[imgUrl] || imgUrl} alt={`Passage visual`} style={{maxWidth: '100%', display: 'block', marginBottom: 20}} />)}
                                          <div id="ielts-passage-content" className="highlightable-content" data-field="passage" style={{textAlign: 'left', fontWeight: 400}} dangerouslySetInnerHTML={{__html: renderSafeHTML(activeExam.passage)}} />
                                      </div>
                                  </div>
                              </div>
                              
                              {/* NÚT KÉO CỘT */}
                              <div onMouseDown={() => setIsDraggingSplitter(true)} style={{ width: '14px', background: '#f4f5f7', borderLeft: `1px solid ${idpC.border}`, borderRight: `1px solid ${idpC.border}`, cursor: 'col-resize', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, position: 'relative' }} className="no-print" title="Kéo để đổi độ rộng cột">
                                  <div style={{ position: 'absolute', width: 16, height: 36, background: '#fff', border: `1px solid #c1c1c1`, borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.15)', zIndex: 11 }}>
                                      <div style={{display: 'flex', gap: 2}}><div style={{width: 2, height: 12, background: '#999', borderRadius: 2}}></div><div style={{width: 2, height: 12, background: '#999', borderRadius: 2}}></div></div>
                                  </div>
                              </div>
                          </>
                     ) : (
                          <div className="exam-passage-col" style={{ flex: 1, height: '100%', overflowY: 'auto', padding: "30px 45px", borderRight: `1px solid ${idpC.border}` }}>
                              <h2 style={{marginTop: 0, borderBottom: `2px solid #333`, paddingBottom: 10, fontSize: 20}}>LISTENING SECTION</h2>
                              <div style={{display: 'flex', flexDirection: 'column', gap: 24, paddingBottom: 50}}>
                                  {groupedQuestions.map((group, gIdx) => {
                                      const injectedList = group.context ? processedContexts[group.context]?.injected || [] : [];
                                      const safeHtml = group.context ? processedContexts[group.context]?.html || renderSafeHTML(group.context) : "";
                                      
                                      return (
                                          <div key={`listen-grp-${gIdx}`}>
                                              {group.instruction && <div className="idp-instruction highlightable-content" data-field="instruction" data-qid={group.questions[0]?.id} dangerouslySetInnerHTML={{__html: renderSafeHTML(group.instruction)}} />}
                                              
                                              {group.context && (
                                                  <div 
                                                      onInput={(e: any) => { if (e.target && e.target.classList.contains('inline-blank-input')) { e.target.setAttribute('data-dirty', 'true'); handleAnswerChange(e.target.dataset.qid, e.target.value, "BLANK"); } }}
                                                      onBlur={(e: any) => { if (e.target && e.target.classList.contains('inline-blank-input')) { e.target.removeAttribute('data-dirty'); handleAnswerChange(e.target.dataset.qid, e.target.value, "BLANK"); } }}
                                                      onKeyDown={(e: any) => { if (e.key === 'Enter' && e.target && e.target.classList.contains('inline-blank-input')) { const qId = e.target.dataset.qid; if (qId) handleAutoScrollNext((activeExam!.questions || []).findIndex((x:any) => x.id === qId), (activeExam!.questions || []).length); } }}
                                                  >
                                                      <StaticHtmlBlock className="idp-context-box highlightable-content" dataField="groupContext" dataQid={group.questions[0]?.id} style={{lineHeight: 2.2}} html={safeHtml} />
                                                  </div>
                                              )}
                                              
                                              {group.questions.map((q) => {
                                                  if (q.type === "BLANK" && injectedList.includes(q.id)) return null;

                                                  return (
                                                      <div key={`content-${q.id}`} style={{ padding: '15px 0', borderBottom: `1px solid #eee` }}>
                                                          <div style={{fontWeight: 700, display: 'flex', gap: 10, alignItems: 'flex-start'}}>
                                                              <div style={{ width: 28, height: 28, border: `1px solid #aaa`, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>{(activeExam.questions || []).findIndex((x:any) => x.id === q.id) + 1}</div>
                                                              <div style={{flex: 1, paddingTop: 4}}><span className="highlightable-content" data-field="text" data-qid={q.id} dangerouslySetInnerHTML={{__html: renderSafeHTML(q.text)}} /></div>
                                                          </div>
                                                          {q.type === "CHOICE" && q.options && (
                                                              <div style={{marginLeft: 38, marginTop: 15}}>
                                                                  {q.options.map((opt, optIdx) => {
                                                                      const letter = String.fromCharCode(65 + optIdx);
                                                                      const cleanOpt = (opt || "").replace(/^[a-zA-Z][\.\)]\s*/, "");
                                                                      return (
                                                                          <div key={optIdx} style={{display: 'flex', gap: 10, marginBottom: 8}}>
                                                                              <span style={{fontWeight: 700}}>{letter}.</span>
                                                                              <span className="highlightable-content" data-field="options" data-qid={q.id} data-optindex={optIdx} dangerouslySetInnerHTML={{__html: renderSafeHTML(cleanOpt)}} />
                                                                          </div>
                                                                      );
                                                                  })}
                                                              </div>
                                                          )}
                                                      </div>
                                                  );
                                              })}
                                          </div>
                                      );
                                  })}
                              </div>
                          </div>
                      )}

                      {/* CỘT CÂU HỎI */}
                      <div className="exam-question-col" style={{ flex: activeExam.type !== "Listening" ? `0 0 ${100 - splitRatio}%` : `0 0 ${100 - splitRatio}%`, height: '100%', display: 'flex', flexDirection: 'column', background: idpC.panelBg, borderLeft: `1px solid ${idpC.border}`, position: 'relative' }}>
                          
                          <div id="question-scroll-area" style={{ flex: 1, overflowY: 'auto', padding: "0 0 40px 0" }} 
                               onInput={(e: any) => { if (e.target && e.target.classList.contains('inline-blank-input')) { e.target.setAttribute('data-dirty', 'true'); handleAnswerChange(e.target.dataset.qid, e.target.value, "BLANK"); } }} 
                               onBlur={(e: any) => { if (e.target && e.target.classList.contains('inline-blank-input')) { e.target.removeAttribute('data-dirty'); handleAnswerChange(e.target.dataset.qid, e.target.value, "BLANK"); } }} 
                               onKeyDown={(e: any) => { if (e.key === 'Enter' && e.target && e.target.classList.contains('inline-blank-input')) { const qId = e.target.dataset.qid; if (qId) handleAutoScrollNext((activeExam!.questions || []).findIndex((x:any) => x.id === qId), (activeExam!.questions || []).length); } }} 
                               onDragOver={(e: any) => { if (e.target && e.target.classList.contains('idp-dropzone')) e.preventDefault(); }} 
                               onDrop={(e: any) => { if (e.target && e.target.classList.contains('idp-dropzone')) { e.preventDefault(); const qId = e.target.dataset.qid; const val = e.dataTransfer.getData("text/plain"); if (qId && val) { handleAnswerChange(qId, val, "DRAG_DROP"); handleAutoScrollNext((activeExam!.questions || []).findIndex((x:any) => x.id === qId), (activeExam!.questions || []).length); } } }} 
                               onClick={(e: any) => { if (e.target && e.target.classList.contains('idp-dropzone') && e.target.classList.contains('filled')) { const qId = e.target.dataset.qid; if (qId) handleAnswerChange(qId, ""); } }}>
                              
                              <div style={{ background: '#fff', padding: '15px 30px', borderBottom: `1px solid ${idpC.border}`, position: 'sticky', top: 0, zIndex: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                                  <div style={{fontWeight: 700, fontSize: 16}}>Questions</div>
                              </div>

                              <div style={{ padding: "30px" }}>
                                  {groupedQuestions.map((group, gIdx) => {
                                      const injectedList = group.context ? processedContexts[group.context]?.injected || [] : [];
                                      const safeHtml = group.context ? processedContexts[group.context]?.html || renderSafeHTML(group.context) : "";
                                      const isDragDropGroup = group.questions.some(q => q.type === "DRAG_DROP");
                                      const dragOptions = isDragDropGroup ? (group.questions.find(q => q.options && q.options.length > 0)?.options || []) : [];
                                      const isMatchingGroup = group.questions.every(q => q.type === "MATCHING");
                                      
                                      if (isMatchingGroup && group.questions.length > 0) {
                                          const opts = group.questions[0].options || [];
                                          return (
                                              <div key={gIdx} style={{marginBottom: 35}}>
                                                  {group.instruction && <div className="idp-instruction highlightable-content" dangerouslySetInnerHTML={{__html: renderSafeHTML(group.instruction)}} />}
                                                  {group.context && <div className="idp-context-box highlightable-content" data-field="groupContext" data-qid={group.questions[0]?.id} style={{lineHeight: 2.2}} dangerouslySetInnerHTML={{__html: obfuscateHTML(group.context)}} />}
                                                  <div style={{overflowX: 'auto'}}>
                                                      <table className="idp-matching-table">
                                                          <thead>
                                                              <tr>
                                                                  <th style={{border: 'none', background: 'transparent'}}></th>
                                                                  {opts.map((_, i) => <th key={i}>{String.fromCharCode(65 + i)}</th>)}
                                                              </tr>
                                                          </thead>
                                                          <tbody>
                                                              {group.questions.map((q) => {
                                                                  const qGlobalIdx = (activeExam.questions || []).findIndex((x:any) => x.id === q.id) + 1;
                                                                  return (
                                                                      <tr id={`question-${q.id}`} key={q.id}>
                                                                          <td>
                                                                              <div style={{display: 'flex', gap: 10, alignItems: 'center'}}>
                                                                                  <span style={{border: '1px solid #ccc', padding: '2px 6px', fontSize: 12, background: '#fff'}}>{qGlobalIdx}</span>
                                                                                  <span dangerouslySetInnerHTML={{__html: renderSafeHTML(q.text)}} />
                                                                              </div>
                                                                          </td>
                                                                          {opts.map((_, oIdx) => (
                                                                              <td key={oIdx} style={{background: '#fff'}}>
                                                                                  <input type="radio" checked={examAnswers[q.id] === oIdx} onChange={() => { handleAnswerChange(q.id, oIdx); handleAutoScrollNext((activeExam!.questions || []).findIndex((x:any) => x.id === q.id), (activeExam!.questions || []).length); }} style={{width: 18, height: 18, accentColor: idpC.blueAccent, cursor: 'pointer', margin: 0}} />
                                                                              </td>
                                                                          ))}
                                                                      </tr>
                                                                  );
                                                              })}
                                                          </tbody>
                                                      </table>
                                                      <div style={{marginTop: 15, display: 'flex', flexWrap: 'wrap', gap: 20, background: '#fafafa', padding: 15, border: '1px solid #ccc'}}>
                                                          {opts.map((opt, i) => <div key={i} style={{fontSize: 14}}><b>{String.fromCharCode(65 + i)}</b> <span dangerouslySetInnerHTML={{__html: renderSafeHTML(opt)}} /></div>)}
                                                      </div>
                                                  </div>
                                              </div>
                                          );
                                      }

                                      return (
                                          <div key={gIdx} style={{marginBottom: 35}}>
                                              {group.instruction && <div className="idp-instruction highlightable-content" dangerouslySetInnerHTML={{__html: renderSafeHTML(group.instruction)}} />}
                                              {isDragDropGroup && dragOptions.length > 0 && (
                                                  <div style={{display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 20, padding: 15, background: '#fff', border: `1px solid ${idpC.border}`}}>
                                                      {dragOptions.map((opt, idx) => (
                                                          <div key={idx} className="idp-draggable" draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", opt)}>{opt}</div>
                                                      ))}
                                                  </div>
                                              )}
                                              {group.context && <StaticHtmlBlock className="idp-context-box highlightable-content" dataField="groupContext" dataQid={group.questions[0]?.id} style={{lineHeight: 2.2}} html={safeHtml} />}
                                              
                                              {group.questions.map((q) => {
                                                  const isAnswered = examAnswers[q.id] !== undefined && examAnswers[q.id] !== "";
                                                  const isInjected = injectedList.includes(q.id);
                                                  if ((q.type === "BLANK" || q.type === "DRAG_DROP") && isInjected) return null;

                                                  return (
                                                      <div id={`question-${q.id}`} key={q.id} className="idp-q-card">
                                                          <div style={{display: 'flex', alignItems: 'flex-start', gap: 15, marginBottom: 15}}>
                                                              <div style={{ background: isAnswered ? '#e6f0ff' : '#fff', color: isAnswered ? idpC.blueAccent : idpC.text, border: `1px solid ${isAnswered ? idpC.blueAccent : '#aaa'}`, width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, flexShrink: 0 }}>
                                                                  {(activeExam.questions || []).findIndex((x:any) => x.id === q.id) + 1}
                                                              </div>
                                                              <div style={{flex: 1, paddingTop: 3}}>
                                                                  <span className="highlightable-content" data-field="text" data-qid={q.id} style={{fontWeight: 600, display: 'block', lineHeight: 1.5}} dangerouslySetInnerHTML={{__html: renderSafeHTML(q.text)}} />
                                                              </div>
                                                          </div>
                                                          <div style={{ marginLeft: 43 }}>
                                                              {q.type === "CHOICE" && (
                                                                  <div style={{display: 'flex', flexDirection: 'column'}}>
                                                                      {(q.options || []).map((opt, optIndex) => {
                                                                          const cleanOpt = (opt || "").replace(/^[a-zA-Z][\.\)]\s*/, "");
                                                                          const isSelected = examAnswers[q.id] === optIndex;
                                                                          return (
                                                                          <label key={optIndex} className={`idp-radio-label ${isSelected ? 'selected' : ''}`}>
                                                                              <input type="radio" name={`q_${q.id}`} checked={isSelected} onChange={() => { handleAnswerChange(q.id, optIndex); handleAutoScrollNext((activeExam!.questions || []).findIndex((x:any) => x.id === q.id), (activeExam!.questions || []).length); }} />
                                                                              <span className="highlightable-content" data-field="options" data-qid={q.id} data-optindex={optIndex} style={{ fontSize: fontSize }} dangerouslySetInnerHTML={{__html: renderSafeHTML(cleanOpt)}} />
                                                                          </label>
                                                                      )})}
                                                                      {isAnswered && <button onClick={() => handleAnswerChange(q.id, "")} style={{background: 'transparent', color: idpC.sub, fontSize: 12, textAlign: 'left', padding: '8px 0 0 0', marginTop: 5, border: 'none', cursor: 'pointer', textDecoration: 'underline'}}>Clear my choice</button>}
                                                                  </div>
                                                              )}
                                                              
                                                              {q.type === "CHOICE_MULTIPLE" && (
                                                                  <div style={{display: 'flex', flexDirection: 'column'}}>
                                                                      {(q.options || []).map((opt, optIndex) => {
                                                                          const cleanOpt = (opt || "").replace(/^[a-zA-Z][\.\)]\s*/, "");
                                                                          const selectedArr = Array.isArray(examAnswers[q.id]) ? examAnswers[q.id] as number[] : [];
                                                                          const isSelected = selectedArr.includes(optIndex);
                                                                          return (
                                                                          <label key={optIndex} className={`idp-radio-label ${isSelected ? 'selected' : ''}`}>
                                                                              <input type="checkbox" style={{width: 18, height: 18, cursor: 'pointer', accentColor: idpC.blueAccent, margin: 0}} checked={isSelected} onChange={(e) => {
                                                                                  let newArr = [...selectedArr];
                                                                                  if (e.target.checked) newArr.push(optIndex); else newArr = newArr.filter(x => x !== optIndex);
                                                                                  handleAnswerChange(q.id, newArr);
                                                                              }} />
                                                                              <span className="highlightable-content" dangerouslySetInnerHTML={{__html: renderSafeHTML(cleanOpt)}} />
                                                                          </label>
                                                                      )})}
                                                                  </div>
                                                              )}

                                                              {q.type === "BLANK" && !isInjected && (
                                                                  <div><input type="text" className="idp-input" placeholder="Type your answer here..." defaultValue={(examAnswers[q.id] as string) || ""} onBlur={(e: any) => handleAnswerChange(q.id, e.target.value, "BLANK")} onKeyPress={(e: any) => { if(e.key==='Enter') { const qIdx = (activeExam!.questions || []).findIndex((x:any) => x.id === q.id); handleAutoScrollNext(qIdx, (activeExam!.questions || []).length); } }} /></div>
                                                              )}

                                                              {q.type === "DRAG_DROP" && !isInjected && (
                                                                  <div style={{marginTop: 5}}>
                                                                      <span className={`idp-dropzone ${(examAnswers[q.id] as string) ? 'filled' : ''}`} data-qid={q.id} data-placeholder="Kéo thả đáp án vào đây">
                                                                          {(examAnswers[q.id] as string) || ""}
                                                                      </span>
                                                                  </div>
                                                              )}
                                                          </div>
                                                      </div>
                                                  );
                                              })}
                                          </div>
                                      )
                                  })}
                              </div>
                          </div>
                      </div>
                 </div> 
                 
                 {/* FOOTER NAVIGATOR CHUẨN IDP TÁCH BIỆT (GHIM CỨNG DƯỚI CÙNG MÀN HÌNH) */}
                 <div className="idp-footer-nav" style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: navGroups.length > 2 ? 'auto' : 50, minHeight: 50, background: '#fff', borderTop: '2px solid #ccc', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 1000 }}>
                     <div style={{ display: 'flex', alignItems: 'center', height: '100%', flex: 1, padding: '10px 0', overflowX: 'auto' }}>
                         
                         {/* BẮT ĐẦU FIX: RENDER CÁC NHÓM NAVIGATOR */}
                         <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px', padding: '0 15px', alignItems: 'center' }}>
                             {navGroups.map((grp, gIdx) => (
                                 <div key={gIdx} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                     <div style={{ fontWeight: 'bold', color: '#333', whiteSpace: 'nowrap', fontSize: 13 }}>{grp.title}</div>
                                     <div className="idp-nav-squares" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                         {grp.questions.map((q, qIdxInGroup) => {
                                             const globalIdx = grp.startIndex + qIdxInGroup;
                                             const isAns = Array.isArray(examAnswers[q.id]) ? (examAnswers[q.id] as any[]).length > 0 : (examAnswers[q.id] !== undefined && examAnswers[q.id] !== "");
                                             const isFlagged = flaggedQuestions?.includes(q.id);
                                             return (
                                                 <button key={q.id} className={`idp-nav-sq ${isAns ? 'ans' : ''} ${isFlagged ? 'flagged' : ''}`} onClick={() => {
                                                     const el = document.getElementById(`question-${q.id}`) || document.querySelector(`[data-qid="${q.id}"]`);
                                                     const scrollArea = document.getElementById('question-scroll-area');
                                                     if (el && scrollArea) {
                                                         el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                                         el.classList.add('highlight-flash');
                                                         setTimeout(() => el.classList.remove('highlight-flash'), 1500);
                                                     }
                                                 }}>
                                                     {globalIdx + 1}
                                                 </button>
                                             );
                                         })}
                                     </div>
                                 </div>
                             ))}
                         </div>
                         {/* KẾT THÚC FIX */}

                     </div>
                     
                     <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
                         <button style={{ width: 40, height: '100%', background: 'none', border: 'none', borderLeft: '1px solid #ddd', fontSize: 20, cursor: 'pointer', color: '#666', alignSelf: 'stretch' }} onClick={() => { document.getElementById('question-scroll-area')?.scrollBy({top: -300, behavior: 'smooth'}); }}>⟨</button>
                         <button style={{ width: 40, height: '100%', background: 'none', border: 'none', borderLeft: '1px solid #ddd', fontSize: 20, cursor: 'pointer', color: '#666', alignSelf: 'stretch' }} onClick={() => { document.getElementById('question-scroll-area')?.scrollBy({top: 300, behavior: 'smooth'}); }}>⟩</button>
                         <button className="idp-submit-btn" title="Submit Exam" onClick={() => submitExam(false)} style={{ width: 50, height: '100%', background: '#111', border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center', transition: '0.2s', alignSelf: 'stretch' }}>
                             <div className="idp-check-icon" style={{ width: 10, height: 18, border: 'solid #fff', borderWidth: '0 3px 3px 0', transform: 'rotate(45deg)', display: 'inline-block', marginBottom: 4 }}></div>
                         </button>
                     </div>
                 </div>
              </div> 
          );
      }

      // ==========================================
      // VIEW: STUDENT DASHBOARD
      // ==========================================
  if (userRole === "STUDENT") {
    // --- LỚP BẢO VỆ & ÉP KIỂU (MAGIC FIX): Ép kiểu "as Student" sẽ dập tắt 100% mọi cảnh báo "possibly undefined" của TS ---
    const me = students.find(s => (s.email || "").toLowerCase() === (currentUser?.email || "").toLowerCase()) as Student;
    
    // NẾU KHÔNG CÓ "ME", CHẶN LUÔN VÀ KHÔNG CHẠY CODE BÊN DƯỚI NỮA
    if (!me) {
        return <div style={{padding: 50, textAlign: 'center', fontSize: 20, color: C.sub}}>Đang tải dữ liệu học viên...</div>;
    }

    const myHistory = history.filter(h => h.studentId === me.id);
    const myQuizResults = quizResults.filter(r => r.studentId === me.id);
    const activeQuizzes = quizzes.filter(q => {
      if (!q.active) return false;
      if (q.audience === "SPECIFIC" && !(q.targetStudentIds || []).includes(me.id)) return false;
      return true;
    });
    const myLinks = sharedLinks.filter(l => {
      if (l.audience === "ALL_STUDENTS") return true;
      if (l.audience === "SPECIFIC_STUDENT" && l.targetStudentId === me.id) return true;
      return false;
    });
    const nextClass = schedules.find(s => s.studentId === me.id && (s.date || "") >= new Date().toISOString().split('T')[0]);
    const currentExp = me.exp || 0;
    const expForNextLevel = ((Math.floor(currentExp / 500) + 1) * 500);
    const progressPct = (currentExp % 500) / 500 * 100;
    const recentScores = [...myQuizResults].sort((a,b) => (b.date || "").localeCompare(a.date || "")).slice(0, 5).reverse();
    const validBandScores = recentScores.filter(r => !isNaN(Number(r.band)));
    const avgBand = validBandScores.length > 0 ? (validBandScores.reduce((acc, curr) => acc + Number(curr.band), 0) / validBandScores.length).toFixed(1) : "N/A";
    const trendIcon = recentScores.length >= 2 ? (Number(recentScores[recentScores.length - 1].band) >= Number(recentScores[recentScores.length - 2].band) ? '📈' : '📉') : '';
    const targetGap = me.target && avgBand !== "N/A" ? (Number(me.target) - Number(avgBand)) : 0;
    const motivationMsg = isNaN(targetGap) ? "" : (targetGap > 0 ? `Bạn cần cố gắng thêm ${targetGap.toFixed(1)} Band nữa để đạt Target!` : `Tuyệt vời! Bạn đã đạt Target.`);

    const handleReviewQuiz = (r: QuizResult) => {
        setReviewQuiz({quiz: quizzes.find(q=>q.id===r.quizId) as Quiz, result: r});
        const reviewed = Array.isArray(me.inventory?.reviewedQuizzes) ? me.inventory!.reviewedQuizzes : [];
        if (!reviewed.includes(r.id)) {
            const newInv = { ...(me.inventory || {}), consumables: me.inventory?.consumables || {}, permanents: me.inventory?.permanents || [], reviewedQuizzes: [...reviewed, r.id] };
            const nx = students.map(s => s.id === me.id ? { ...s, coins: (s.coins || 0) + 20, inventory: newInv } : s);
            setStudents(nx); syncData({ students: nx });
            alert("🔥 CHIẾN THẦN REVIEW: +20 Xu vì đã xem lại lỗi sai trong bài thi!");
        }
    };

    const handleBuyConsumable = (itemName: string, price: number) => {
        if ((me.coins || 0) < price) { alert("Bạn không đủ OS Coins!"); return; }
        if (confirm(`Dùng ${price} xu để đổi "${itemName}"?`)) {
            const currentCons = { ...(me.inventory?.consumables || {}) };
            const currentPerms = Array.isArray(me.inventory?.permanents) ? [...me.inventory!.permanents] : [];
            const newInv = { 
                ...(me.inventory || {}), 
                permanents: currentPerms, 
                consumables: { ...currentCons, [itemName]: (currentCons[itemName] || 0) + 1 } 
            };
            const nx = students.map(s => s.id === me.id ? { ...s, coins: (s.coins || 0) - price, inventory: newInv } : s);
            setStudents(nx); syncData({ students: nx });
            alert("Đổi thành công! Quà đã được chuyển vào 🎒 Túi đồ.");
            setShowCelebration(true); setTimeout(() => setShowCelebration(false), 5000);
        }
    };

    const handleRollGacha = () => {
        if ((me.coins || 0) < 500) { alert("Cần 500 Xu để quay Gacha!"); return; }
        if (confirm("Dùng 500 Xu để mở Hộp Quà Ngẫu Nhiên?")) {
            const pool = [
                { type: "PERMANENT", name: "Giao diện: Cyberpunk" },
                { type: "PERMANENT", name: "Giao diện: Dark VIP" },
                { type: "PERMANENT", name: "Danh hiệu: Chiến Thần IELTS" },
                { type: "PERMANENT", name: "Danh hiệu: Kẻ Hủy Diệt Đề" },
                { type: "CONSUMABLE", name: "Thẻ dời deadline (24h)" },
                { type: "CONSUMABLE", name: "1 Hộp Milo" },
                { type: "CONSUMABLE", name: "1 Ly Trái Chò" },
                { type: "CONSUMABLE", name: "1 Trà sữa Viên Viên" },
                { type: "NONE", name: "Chúc bạn may mắn lần sau 😢" },
                { type: "NONE", name: "Chúc bạn may mắn lần sau 😢" }
            ];
            const reward = pool[Math.floor(Math.random() * pool.length)];
            let newCoins = (me.coins || 0) - 500;
            const currentCons = { ...(me.inventory?.consumables || {}) };
            let currentPerms = Array.isArray(me.inventory?.permanents) ? [...me.inventory!.permanents] : [];
            let msg = `🎁 BẠN QUAY TRÚNG: ${reward.name}`;

            if (reward.type === "PERMANENT") {
                if (currentPerms.includes(reward.name)) {
                    newCoins += 200;
                    msg += `\n\nBạn đã sở hữu vật phẩm này. Hệ thống tự động chuyển hóa thành +200 Xu đền bù!`;
                } else {
                    currentPerms = [...currentPerms, reward.name];
                    msg += `\n\nĐã thêm vào 🎒 Túi đồ (Tab Vĩnh viễn)!`;
                }
            } else if (reward.type === "CONSUMABLE") {
                currentCons[reward.name] = (currentCons[reward.name] || 0) + 1;
                msg += `\n\nĐã thêm vào 🎒 Túi đồ!`;
            }

            const newInv = { ...(me.inventory || {}), consumables: currentCons, permanents: currentPerms };
            const nx = students.map(s => s.id === me.id ? { ...s, coins: newCoins, inventory: newInv } : s);
            setStudents(nx); syncData({ students: nx });
            alert(msg);
            if (reward.type !== "NONE") { setShowCelebration(true); setTimeout(() => setShowCelebration(false), 5000); }
        }
    };

    const handleUseItem = (itemName: string) => {
        if (!confirm(`XÁC NHẬN SỬ DỤNG [${itemName}]?\n\nLƯU Ý: Chỉ bấm Đồng ý khi bạn đang gặp mặt hoặc nhắn tin trực tiếp với Giáo viên để xuất trình mã nhận thưởng. Vật phẩm sẽ bị trừ ngay lập tức!\n\nTiếp tục?`)) return;
        const currentCons = { ...(me.inventory?.consumables || {}) };
        if (currentCons[itemName] > 1) currentCons[itemName] -= 1;
        else delete currentCons[itemName];
        
        const newInv = { ...(me.inventory || {}), permanents: me.inventory?.permanents || [], consumables: currentCons };
        const nx = students.map(s => s.id === me.id ? { ...s, inventory: newInv } : s);
        setStudents(nx); syncData({ students: nx });
        
        const code = `OS-${itemName.substring(0,3).toUpperCase().replace(/\s/g,'')}-${Date.now().toString().slice(-6)}${me.id.substring(0,2).toUpperCase()}`;
        setUseCodeObj({ name: itemName, code });
    };

    const handleEquipItem = (itemName: string) => {
        const newInv = { ...(me.inventory || {}), consumables: me.inventory?.consumables || {}, permanents: me.inventory?.permanents || [] };
        if (itemName.startsWith("Danh hiệu:")) newInv.equippedTitle = itemName.replace("Danh hiệu: ", "");
        if (itemName.startsWith("Giao diện:")) newInv.equippedTheme = itemName;
        const nx = students.map(s => s.id === me.id ? { ...s, inventory: newInv } : s);
        setStudents(nx); syncData({ students: nx });
        alert(`Đã trang bị: ${itemName}`);
    };

    return (
      <div style={{ minHeight: "100vh", background: C.bg, color: C.text, position: 'relative', overflowX: 'hidden' }}>
        {globalStyles}

        {/* MÀN HÌNH NHẮC NỢ BẠO CHÚA */}
        {showDebtWarning && (
            <div style={{position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.95)', zIndex: 999999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20}}>
                <div style={{background: C.err, width: '100%', maxWidth: 500, padding: 30, borderRadius: 16, textAlign: 'center', boxShadow: '0 10px 50px rgba(255,0,0,0.5)', border: '2px solid #fff'}}>
                    <div style={{fontSize: 50, marginBottom: 10}}>⚠️</div>
                    <h1 style={{color: '#fff', margin: '0 0 20px 0', fontSize: 24, textTransform: 'uppercase'}}>THÔNG BÁO QUAN TRỌNG</h1>
                    <div style={{background: '#fff', color: '#000', padding: 20, borderRadius: 8, fontSize: 16, fontWeight: 700, lineHeight: 1.5, textAlign: 'left', whiteSpace: 'pre-wrap'}}>
                        {me.debtMessage}
                    </div>
                    <p style={{color: '#fff', fontSize: 12, marginTop: 20, opacity: 0.8}}>Vui lòng đọc kỹ thông báo trước khi tiếp tục sử dụng hệ thống.</p>
                    <button 
                        disabled={debtConfirmCountdown > 0} 
                        onClick={handleAcknowledgeDebt} 
                        style={{background: debtConfirmCountdown > 0 ? '#666' : '#fff', color: debtConfirmCountdown > 0 ? '#aaa' : C.err, padding: '15px 40px', fontSize: 16, fontWeight: 900, marginTop: 20, border: 'none', borderRadius: 30, cursor: debtConfirmCountdown > 0 ? 'not-allowed' : 'pointer', width: '100%', transition: '0.3s'}}
                    >
                        {debtConfirmCountdown > 0 ? `Vui lòng đợi ${debtConfirmCountdown}s...` : "ĐÃ HIỂU VÀ XÁC NHẬN"}
                    </button>
                </div>
            </div>
        )}

        {showCelebration && (
            <div style={{position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99999, pointerEvents: 'none', display: 'flex', justifyContent: 'space-around'}}>
                {Array.from({length: 30}).map((_, i) => (
                    <div key={i} style={{fontSize: 40, animation: `fall 3s linear infinite`, animationDelay: `${Math.random() * 2}s`}}>{['🎉','🌟','🔥','🚀','🏆'][i%5]}</div>
                ))}
            </div>
        )}

        {announcement && (
            <div style={{ background: C.warn, color: '#fff', padding: '8px', fontSize: 14, fontWeight: 'bold', display: 'flex', alignItems: 'center', zIndex: 1000 }}>
                📢 
                <div className="marquee-container">
                    <div className="marquee-content">{announcement}</div>
                </div>
            </div>
        )}

        <nav style={{ background: C.card, borderBottom: `1px solid ${C.border}`, padding: "12px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ background: C.accent, color: "white", width: 28, height: 28, borderRadius: 6, display: "grid", placeItems: "center", fontWeight: 900 }}>I</div>
            <h1 style={{ margin: 0, fontSize: 16, fontWeight: 900 }}>STUDENT <span style={{ color: C.accent }}>PORTAL</span></h1>
          </div>
          <div style={{display: 'flex', gap: 10, alignItems: 'center'}}>
             <div style={{fontSize: 10, color: isTimeSynced ? C.succ : C.warn, display: 'flex', alignItems: 'center', gap: 4}} title="Đồng bộ giờ máy chủ">
                 🌐 {isTimeSynced ? "Sync: OK" : "Syncing..."}
             </div>
             {lastLoginTime && <div style={{fontSize: 10, color: C.sub, marginRight: 15, display: window.innerWidth > 600 ? 'block' : 'none'}}>Đăng nhập gần nhất: {lastLoginTime}</div>}
             <button onClick={() => setColorblind(!colorblind)} style={{ background: "transparent", fontSize: 18, padding: "0 10px", opacity: colorblind ? 1 : 0.5 }} title="Chế độ Tương phản cao">👁️</button>
             <button onClick={() => setTheme(theme === "light" ? "dark" : "light")} style={{ background: "transparent", fontSize: 18, padding: "0 10px" }}>{theme === "light" ? "🌙" : "☀️"}</button>
             <button onClick={handleLogout} style={{ background: `${C.err}15`, color: C.err, padding: "6px 12px", fontSize: 12, fontWeight: 700 }}>Đăng xuất</button>
          </div>
        </nav>

        <main style={{ maxWidth: 800, margin: "0 auto", padding: "32px 20px" }}>
          
          {me.privateMessage && (
              <div style={{background: `${C.err}15`, border: `2px solid ${C.err}`, color: C.err, padding: 20, borderRadius: 12, marginBottom: 24}}>
                  <h3 style={{marginTop: 0, marginBottom: 5}}>🔔 Thông báo riêng từ Giáo viên:</h3>
                  <div style={{fontWeight: 700}}>{me.privateMessage}</div>
              </div>
          )}

          <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, borderLeft: `6px solid ${C.accent}` }}>
            <div style={{display: 'flex', gap: 15, alignItems: 'center'}}>
              {getAvatar(me.name || "HV")}
              <div>
                <h2 style={{marginTop: 0, fontSize: 24, fontWeight: 900, letterSpacing: -0.5, marginBottom: 5}}>{greetingText}, <span style={{color: C.accent}}>{me.name || "bạn"}</span> 👋</h2>
                {me.inventory?.equippedTitle && <div style={{background: 'linear-gradient(90deg, #FFD700, #FFA500)', color: '#000', padding: '4px 10px', borderRadius: 4, display: 'inline-block', fontSize: 11, fontWeight: 900, marginBottom: 5, textTransform: 'uppercase', boxShadow: '0 2px 8px rgba(255, 215, 0, 0.4)'}}>{me.inventory!.equippedTitle}</div>}
                <p style={{color: C.sub, margin: 0, fontSize: 14, fontWeight: 500}}>Chào mừng quay lại không gian học tập trực tuyến IELTS OS.</p>
              </div>
            </div>
            <div style={{display: 'flex', gap: 10}}>
                <div style={{textAlign: 'center', background: `${C.warn}10`, color: C.warn, padding: '10px 15px', borderRadius: 10, border: `1px solid ${C.warn}30`}}>
                   <div style={{fontSize: 24, marginBottom: 2}}>💰</div>
                   <div style={{fontWeight: 900, fontSize: 12}}>{me.coins || 0} Xu</div>
                </div>
                <div style={{textAlign: 'center', background: `${C.accent}10`, color: C.accent, padding: '10px 15px', borderRadius: 10, border: `1px solid ${C.accent}30`}}>
                   <div style={{fontSize: 24, marginBottom: 2}}>{getGamificationBadge(me.level || 1).split(" ")[0]}</div>
                   <div style={{fontWeight: 900, fontSize: 12}}>Lv.{me.level || 1}</div>
                </div>
            </div>
          </div>

          {useCodeObj && (
              <div style={{position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.9)', zIndex: 99999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#fff'}}>
                  <h2 style={{color: C.succ, fontSize: 32}}>MÃ NHẬN THƯỞNG</h2>
                  <p style={{fontSize: 18, textAlign: 'center'}}>Vật phẩm: <b>{useCodeObj!.name}</b></p>
                  <div style={{background: '#fff', padding: 20, borderRadius: 12, margin: '20px 0'}}>
                      <img src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${useCodeObj!.code}`} alt="QR Code" />
                  </div>
                  <div style={{fontSize: 28, fontWeight: 900, letterSpacing: 5, background: '#222', padding: '10px 30px', borderRadius: 8}}>{useCodeObj!.code}</div>
                  <p style={{color: C.warn, fontSize: 14, maxWidth: 500, textAlign: 'center', marginTop: 15}}>⚠️ Hãy chụp màn hình này và gửi cho Giáo viên để nhận thưởng ngay lập tức. Mã này là duy nhất và không thể khôi phục nếu bị đóng!</p>
                  <button onClick={() => setUseCodeObj(null)} style={{background: C.accent, color: '#fff', padding: '15px 40px', fontSize: 18, marginTop: 30}}>ĐÃ CHỤP ẢNH - ĐÓNG</button>
              </div>
          )}

          {showInventory && (
              <div style={{position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20}}>
                  <div className="card" style={{width: 600, maxWidth: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', background: C.bg}}>
                      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `2px solid ${C.border}`, paddingBottom: 15, marginBottom: 15}}>
                          <h2 style={{margin: 0}}>🎒 Túi Đồ Của Bạn</h2>
                          <button onClick={() => setShowInventory(false)} style={{background: 'transparent', color: C.err, fontSize: 24, padding: 0}}>✖</button>
                      </div>
                      <div style={{display: 'flex', gap: 10, marginBottom: 20}}>
                          <button onClick={() => setInvTab("CONSUMABLE")} style={{flex: 1, padding: 10, background: invTab === "CONSUMABLE" ? C.accent : C.card, color: invTab === "CONSUMABLE" ? '#fff' : C.text, border: `1px solid ${C.border}`, fontWeight: 900}}>🍕 Tiêu hao</button>
                          <button onClick={() => setInvTab("PERMANENT")} style={{flex: 1, padding: 10, background: invTab === "PERMANENT" ? C.accent : C.card, color: invTab === "PERMANENT" ? '#fff' : C.text, border: `1px solid ${C.border}`, fontWeight: 900}}>🏆 Vĩnh viễn</button>
                      </div>
                      <div style={{flex: 1, overflowY: 'auto', display: 'grid', gap: 10}}>
                          {invTab === "CONSUMABLE" && Object.entries(me.inventory?.consumables || {}).map(([name, count]) => (
                              <div key={name} style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 15, background: C.card, borderRadius: 8, border: `1px solid ${C.border}`}}>
                                  <div><div style={{fontWeight: 900}}>{name}</div><div style={{fontSize: 12, color: C.sub}}>Số lượng: {count as number}</div></div>
                                  <button onClick={() => handleUseItem(name)} style={{background: C.succ, color: '#fff', padding: '8px 16px'}}>Dùng ngay</button>
                              </div>
                          ))}
                          {invTab === "CONSUMABLE" && Object.keys(me.inventory?.consumables || {}).length === 0 && <div style={{textAlign: 'center', padding: 30, color: C.sub}}>Túi đồ rỗng. Hãy ghé Cửa hàng nhé!</div>}
                          
                          {invTab === "PERMANENT" && (Array.isArray(me.inventory?.permanents) ? me.inventory!.permanents : []).map((name) => {
                              const safeName = String(name);
                              const isEquipped = (me.inventory?.equippedTheme === safeName || me.inventory?.equippedTitle === safeName.replace("Danh hiệu: ", ""));
                              return (
                              <div key={safeName} style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 15, background: C.card, borderRadius: 8, border: `1px solid ${C.border}`}}>
                                  <div style={{fontWeight: 900, color: C.accent}}>{safeName}</div>
                                  <div style={{display: 'flex', gap: 10}}>
                                      <button onClick={() => handleEquipItem(safeName)} style={{background: isEquipped ? C.succ : C.bg, color: isEquipped ? '#fff' : C.text, border: `1px solid ${C.border}`, padding: '8px 16px'}}>Trang bị</button>
                                  </div>
                              </div>
                          )})}
                          {invTab === "PERMANENT" && (Array.isArray(me.inventory?.permanents) ? me.inventory!.permanents : []).length === 0 && <div style={{textAlign: 'center', padding: 30, color: C.sub}}>Chưa sở hữu vật phẩm vĩnh viễn nào. Hãy thử Vòng quay Gacha!</div>}
                      </div>
                  </div>
              </div>
          )}
{/* HỆ THỐNG NHIỆM VỤ VÀ CỬA HÀNG */}
          <div style={{ display: "grid", gridTemplateColumns: window.innerWidth > 800 ? "1fr 1fr" : "1fr", gap: 20, marginBottom: 24 }}>
             <div className="card" style={{border: `2px solid ${C.warn}`}}>
                 <h3 style={{marginTop: 0, color: C.warn, display: 'flex', alignItems: 'center', gap: 8}}>🎯 NHIỆM VỤ KIẾM XU</h3>
                 <div style={{display: 'grid', gap: 10, fontSize: 13}}>
                     <div style={{display: 'flex', justifyContent: 'space-between', padding: 10, background: C.bg, borderRadius: 8, border: `1px solid ${C.border}`}}>
                         <span>📆 Điểm danh hàng ngày</span>
                         <span style={{fontWeight: 900, color: C.warn}}>+10 Xu</span>
                     </div>
                     <div style={{display: 'flex', justifyContent: 'space-between', padding: 10, background: C.bg, borderRadius: 8, border: `1px solid ${C.border}`}}>
                         <span>🔥 Giữ chuỗi chăm chỉ (7 ngày liên tiếp)</span>
                         <span style={{fontWeight: 900, color: C.warn}}>+300 Xu</span>
                     </div>
                     <div style={{display: 'flex', justifyContent: 'space-between', padding: 10, background: C.bg, borderRadius: 8, border: `1px solid ${C.border}`}}>
                         <span>⏱ Học tập trên 30 phút / 1 giờ / 2 giờ</span>
                         <span style={{fontWeight: 900, color: C.warn}}>+10 / 25 / 60 Xu</span>
                     </div>
                     <div style={{display: 'flex', justifyContent: 'space-between', padding: 10, background: C.bg, borderRadius: 8, border: `1px solid ${C.border}`}}>
                         <span>⚡ Nộp bài sớm trước 12h / 24h deadline</span>
                         <span style={{fontWeight: 900, color: C.warn}}>+100 / 150 Xu</span>
                     </div>
                     <div style={{display: 'flex', justifyContent: 'space-between', padding: 10, background: C.bg, borderRadius: 8, border: `1px solid ${C.border}`}}>
                         <span>🛡 Chiến thần Review (Mở xem lại bài thi sai)</span>
                         <span style={{fontWeight: 900, color: C.warn}}>+20 Xu</span>
                     </div>
                 </div>
             </div>

             <div className="card" style={{border: `2px solid ${C.succ}`, display: 'flex', flexDirection: 'column'}}>
                 <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15}}>
                     <h3 style={{marginTop: 0, marginBottom: 0, color: C.succ, display: 'flex', alignItems: 'center', gap: 8}}>🎁 CỬA HÀNG ĐỔI THƯỞNG</h3>
                     <button onClick={() => setShowInventory(true)} style={{background: C.accent, color: '#fff', padding: '6px 15px', borderRadius: 20, fontWeight: 900}}>🎒 Mở Túi Đồ</button>
                 </div>
                 
                 <div style={{display: 'grid', gap: 10, fontSize: 13, flex: 1}}>
                     <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: C.bg, borderRadius: 8, border: `1px solid ${C.border}`}}>
                         <div>
                             <div style={{fontWeight: 800}}>⏳ Thẻ dời deadline (24h)</div>
                             <div style={{fontSize: 11, color: C.sub}}>Gia hạn thêm thời gian nộp bài.</div>
                         </div>
                         <button onClick={() => handleBuyConsumable("Thẻ dời deadline (24h)", 1000)} style={{background: `${C.warn}20`, color: C.warn, fontWeight: 900, padding: '6px 12px', border: 'none', cursor: 'pointer'}}>1000 💰</button>
                     </div>
                     <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: C.bg, borderRadius: 8, border: `1px solid ${C.border}`}}>
                         <div>
                             <div style={{fontWeight: 800}}>🧃 1 Hộp sữa Milo</div>
                             <div style={{fontSize: 11, color: C.sub}}>Cứu trợ năng lượng giữa giờ học.</div>
                         </div>
                         <button onClick={() => handleBuyConsumable("1 Hộp Milo", 500)} style={{background: `${C.warn}20`, color: C.warn, fontWeight: 900, padding: '6px 12px', border: 'none', cursor: 'pointer'}}>500 💰</button>
                     </div>
                     <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: C.bg, borderRadius: 8, border: `1px solid ${C.border}`}}>
                         <div>
                             <div style={{fontWeight: 800}}>🍹 1 Ly nước Trái Chò</div>
                             <div style={{fontSize: 11, color: C.sub}}>Giải nhiệt tuyệt đỉnh.</div>
                         </div>
                         <button onClick={() => handleBuyConsumable("1 Ly Trái Chò", 1000)} style={{background: `${C.warn}20`, color: C.warn, fontWeight: 900, padding: '6px 12px', border: 'none', cursor: 'pointer'}}>1000 💰</button>
                     </div>
                     <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: C.bg, borderRadius: 8, border: `1px solid ${C.border}`}}>
                         <div>
                             <div style={{fontWeight: 800}}>🧋 1 Trà sữa Viên Viên</div>
                             <div style={{fontSize: 11, color: C.sub}}>Đánh bay cơn buồn ngủ.</div>
                         </div>
                         <button onClick={() => handleBuyConsumable("1 Trà sữa Viên Viên", 1000)} style={{background: `${C.warn}20`, color: C.warn, fontWeight: 900, padding: '6px 12px', border: 'none', cursor: 'pointer'}}>1000 💰</button>
                     </div>
                     
                     <div style={{marginTop: 5, paddingTop: 10, borderTop: `1px dashed ${C.border}`, display: 'flex', flexDirection: 'column', gap: 5}}>
                         <div style={{fontWeight: 800, color: C.accent, display: 'flex', alignItems: 'center', gap: 4}}>🔥 VÒNG QUAY GACHA NHÂN PHẨM</div>
                         <div style={{fontSize: 11, color: C.sub}}>500 Xu/lượt: Cơ hội trúng Giao diện VIP, Danh hiệu độc quyền, hoặc các vật phẩm tiêu hao! (Đồ trùng lặp hoàn 200 Xu)</div>
                         <button onClick={handleRollGacha} style={{background: `linear-gradient(135deg, ${C.accent}, #1E3A8A)`, color: '#fff', padding: '10px', width: '100%', borderRadius: 8, fontWeight: 800, boxShadow: `0 4px 12px ${C.accent}30`}}>🎰 QUAY GACHA (500 💰)</button>
                     </div>
                 </div>
                 {Array.isArray(me.myRewards) && me.myRewards!.length > 0 && (
                     <div style={{marginTop: 15, paddingTop: 15, borderTop: `1px dashed ${C.border}`, fontSize: 12}}>
                         <div style={{fontWeight: 800, color: C.succ, marginBottom: 5}}>🎒 Túi đồ cũ (Đang nâng cấp):</div>
                         <ul style={{margin: 0, paddingLeft: 20}}>
                             {me.myRewards!.map((rw, idx) => <li key={idx} style={{color: C.sub, marginBottom: 4}}>{rw}</li>)}
                         </ul>
                     </div>
                 )}
             </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: window.innerWidth > 800 ? "1fr 1fr 1fr" : "1fr", gap: 20, marginBottom: 24 }}>
            <div className="card" style={{padding: "20px 24px"}}>
              <div style={{ fontSize: 11, fontWeight: 900, color: C.sub, marginBottom: 5 }}>{t('total_hours')}</div>
              <div style={{ fontSize: 28, fontWeight: 900 }}>{(myHistory.reduce((s,h)=>s+((h && h.duration)||0),0)/3600).toFixed(1)}h</div>
            </div>
            <div className="card" style={{padding: "20px 24px"}}>
              <div style={{ fontSize: 11, fontWeight: 900, color: C.sub, marginBottom: 5 }}>{t('avg_band')}</div>
              <div style={{ fontSize: 28, fontWeight: 900, color: C.succ }}>{avgBand} <span style={{fontSize: 18}}>{trendIcon}</span></div>
            </div>
            <div className="card" style={{padding: "20px 24px"}}>
              <div style={{ fontSize: 11, fontWeight: 900, color: C.sub, marginBottom: 5 }}>{t('total_quizzes')}</div>
              <div style={{ fontSize: 28, fontWeight: 900, color: C.warn }}>{myQuizResults.length}</div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: window.innerWidth > 800 ? "1fr 1fr" : "1fr", gap: 20, marginBottom: 24 }}>
              <div className="card" style={{padding: "20px 24px"}}>
                <div style={{ fontSize: 11, fontWeight: 900, color: C.sub, marginBottom: 10 }}>SỔ TAY TỪ VỰNG CỦA TÔI</div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    {(Array.isArray(me.savedVocabs) ? me.savedVocabs : []).slice(-15).map((v, i) => (
                        <a key={i} href={`https://dictionary.cambridge.org/dictionary/english/${v}`} target="_blank" rel="noreferrer" style={{background: `${C.succ}20`, color: C.succ, padding: '4px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700, textDecoration: 'none'}} title="Click để xem từ điển">{v}</a>
                    ))}
                    {(!Array.isArray(me.savedVocabs) || me.savedVocabs!.length === 0) && <div style={{fontSize: 12, color: C.sub}}>Bạn chưa lưu từ nào. Quét đen chữ trong bài thi để lưu!</div>}
                </div>
              </div>

              <div className="card" style={{padding: "20px 24px", background: `linear-gradient(135deg, ${C.card}, ${C.accent}15)`}}>
                <div style={{ fontSize: 11, fontWeight: 900, color: C.accent, marginBottom: 5 }}>🔥 IDIOM OF THE MONTH (B1+)</div>
                <div style={{ fontSize: 18, fontWeight: 900, marginTop: 10 }}>"Rise like a phoenix"</div>
                <div style={{ fontSize: 13, color: C.sub, marginTop: 5, fontStyle: 'italic' }}>Vực dậy mạnh mẽ từ thất bại, tái sinh từ đống tro tàn.</div>
                <div style={{ fontSize: 12, marginTop: 10, background: C.bg, padding: 10, borderRadius: 6, border: `1px solid ${C.border}` }}>
                    <b>Ví dụ:</b> After a disastrous mock test, she worked hard and <i>rose like a phoenix</i> to score a Band 7.0 in her final exam.
                </div>
              </div>
          </div>

          {recentScores.length > 0 && (
            <div className="card" style={{ marginBottom: 24 }}>
                <h3 style={{marginTop: 0, fontSize: 14, color: C.sub, textTransform: 'uppercase'}}>📈 Biểu đồ năng lực (5 Test Gần Nhất)</h3>
                <div style={{display: 'flex', alignItems: 'flex-end', height: 120, gap: 15, marginTop: 20}}>
                    {recentScores.map((sc, idx) => {
                        const bandNum = Number(sc.band);
                        const hPct = isNaN(bandNum) ? 0 : (bandNum / 9) * 100;
                        return (
                            <div key={idx} style={{flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%'}}>
                                <div style={{fontSize: 12, fontWeight: 800, color: C.accent, marginBottom: 5}}>{sc.band}</div>
                                <div style={{width: '100%', background: C.accent, height: `${hPct}%`, borderRadius: '6px 6px 0 0', opacity: idx === recentScores.length - 1 ? 1 : 0.4, transition: '0.5s'}}></div>
                            </div>
                        )
                    })}
                </div>
            </div>
          )}

          {nextClass && (
            <div className="card" style={{ marginBottom: 24, background: `${C.warn}10`, border: `1px solid ${C.warn}40` }}>
              <div style={{ fontSize: 11, fontWeight: 900, color: C.warn, marginBottom: 5 }}>📅 LỊCH HỌC SẮP TỚI CỦA BẠN</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                 <div>
                    <div style={{fontSize: 18, fontWeight: 900}}>{nextClass!.date} <span style={{background: C.warn, color: '#fff', padding: '2px 6px', borderRadius: 4, fontSize: 12, marginLeft: 8}}>{nextClass!.time}</span></div>
                    <div style={{fontSize: 13, color: C.sub, marginTop: 5}}>Giáo viên: {nextClass!.teacher} • Địa điểm: {nextClass!.location}</div>
                 </div>
              </div>
            </div>
          )}

          <div className="card" style={{ marginBottom: 24, padding: "20px 24px" }}>
            <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: 10}}>
              <span style={{fontSize: 12, fontWeight: 800, color: C.sub}}>TIẾN ĐỘ LEVEL HIỆN TẠI</span>
              <span style={{fontSize: 12, fontWeight: 800, color: C.accent}}>{currentExp} / {expForNextLevel} EXP ({progressPct}%)</span>
            </div>
            <div style={{height: 8, background: C.border, borderRadius: 10, overflow: 'hidden'}}>
               <div style={{width: `${progressPct}%`, height: '100%', background: C.accent, transition: 'width 1s ease-in-out', borderRadius: 10}}></div>
            </div>
            <div style={{display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 11, fontWeight: 700, color: C.sub}}>
              <span>CEFR HIỆN TẠI: {me.cefr || "N/A"}</span>
              <span style={{textAlign: 'right'}}>
                  MỤC TIÊU: IELTS {me.target || "N/A"}<br/>
                  <span style={{fontSize: 10, color: targetGap > 0 ? C.warn : C.succ}}>{motivationMsg}</span>
              </span>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 24, border: `2px solid ${C.warn}` }}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                <h3 style={{marginTop: 0, color: C.warn, margin: 0}}>📝 {t('test_room_title')}</h3>
                <input placeholder={t('filter_quizzes')} value={stQuizSearch} onChange={(e: any)=>setStQuizSearch(e.target.value)} style={{width: 150, padding: '4px 8px', fontSize: 12}} />
            </div>
            <div style={{ display: "grid", gap: 15, marginTop: 15 }}>
              {activeQuizzes.filter(q => (q.title || "").toLowerCase().includes((stQuizSearch || "").toLowerCase())).map(q => {
                  const attemptCount = myQuizResults.filter(r => r && r.quizId === q.id).length;
                  const now = getRealTime();
                  const startTime = q.scheduledStart ? parseVNTime(q.scheduledStart) : 0;
                  const endTime = q.scheduledEnd ? parseVNTime(q.scheduledEnd) : Infinity;
                  let statusText = "";
                  let isAvailable = false;
                  let badgeText = "";
                  
                  if (q.isLocked) { statusText = t('status_locked'); badgeText = t('status_locked'); }
                  else if (now < startTime) { 
                      statusText = `${t('opens_at')}: ${new Date(startTime).toLocaleString('vi-VN')}`; 
                      badgeText = t('not_available'); 
                  } 
                  else if (now > endTime) { 
                      statusText = t('status_closed'); 
                      badgeText = t('status_closed'); 
                  } 
                  else if (attemptCount >= (q.maxAttempts || 1)) { 
                      statusText = t('status_no_attempts'); 
                      badgeText = t('status_no_attempts'); 
                  } 
                  else {
                      isAvailable = true;
                      statusText = q.scheduledEnd ? `${t('closes_at')}: ${new Date(endTime).toLocaleString('vi-VN')}` : t('status_available');
                  }

                  // PHƯƠNG ÁN 2: KIỂM TRA KHÓA CỨNG KHI ĐANG THI TRÊN THIẾT BỊ KHÁC
                  const localSessionId = localStorage.getItem("ielts_os_device_session");
                  const isLockedByOtherDevice = me.activeExamId === q.id && me.currentSessionId && me.currentSessionId !== localSessionId;

                  return (
                      <div key={q.id} style={{ background: C.bg, padding: 15, borderRadius: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: `1px solid ${C.border}` }}>
                          <div>
                              <div style={{fontWeight: 800, fontSize: 15}}>
                                  {q.tag && <span style={{fontSize: 10, background: C.accent, color: '#fff', padding: '2px 6px', borderRadius: 4, marginRight: 5}}>{q.tag}</span>}
                                  {q.title} {q.passcode && <span title="Yêu cầu mật khẩu">🔒</span>} 
                                  {q.isSEBRequired && <span title="Bắt buộc thi bằng phần mềm SEB" style={{marginLeft: 5}}>🛡️</span>}
                                  <span style={{fontSize: 10, background: C.card, padding: '2px 6px', borderRadius: 4, marginLeft: 5}}>{q.type}</span>
                              </div>
                              <div style={{fontSize: 12, color: C.sub, marginTop: 4}}>{t('time_limit')}: {q.timeLimit} {t('time_limit')} • {t('questions_count')}: {(q.questions || []).length} • {t('previous_attempts')}: {attemptCount}/{q.maxAttempts || 1}</div>
                              <div style={{fontSize: 11, color: isLockedByOtherDevice ? C.warn : (isAvailable ? C.succ : C.err), marginTop: 4, fontWeight: 700}}>
                                  ⏳ {isLockedByOtherDevice ? "ĐANG LÀM BÀI Ở MÁY KHÁC" : statusText}
                              </div>
                          </div>
                          {(isAvailable && !isLockedByOtherDevice) ? (
                              <div style={{display: 'flex', gap: 10}}>
                                  <button onClick={() => startExam(q, false, true)} style={{ background: C.card, color: C.text, padding: "8px 15px", border: `1px solid ${C.border}`, borderRadius: 6, fontWeight: 700, cursor: 'pointer', fontSize: 12 }} title="Kiểm tra giao diện trước khi thi để đảm bảo không có lỗi hiển thị">🖥️ TEST GIAO DIỆN</button>
                                  <button onClick={() => {
                                      // Khóa bài thi vào phiên này
                                      const currentLocalSession = localStorage.getItem("ielts_os_device_session") || "";
                                      const nx = students.map(s => s.id === me.id ? { ...s, activeExamId: q.id, currentSessionId: currentLocalSession } : s);
                                      setStudents(nx); syncData({ students: nx });
                                      startExam(q, false);
                                  }} style={{ background: C.accent, color: "#fff", padding: "8px 20px", boxShadow: `0 4px 10px ${C.accent}40`, border: 'none', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}>{t('enter_exam')}</button>
                              </div>
                          ) : isLockedByOtherDevice ? (
                              <button onClick={() => {
                                  if(confirm("⚠️ BÀI THI NÀY ĐANG ĐƯỢC MỞ Ở MỘT THIẾT BỊ KHÁC!\n\nNếu bạn tiếp tục, phiên làm bài ở thiết bị kia sẽ bị hủy bỏ và đá văng. Bạn có chắc chắn muốn ép buộc vào thi?")) {
                                      const currentLocalSession = localStorage.getItem("ielts_os_device_session") || "";
                                      const nx = students.map(s => s.id === me.id ? { ...s, activeExamId: q.id, currentSessionId: currentLocalSession } : s);
                                      setStudents(nx); syncData({ students: nx });
                                      startExam(q, false);
                                  }
                              }} style={{ background: C.warn, color: "#fff", padding: "8px 15px", border: 'none', borderRadius: 6, fontWeight: 700, cursor: 'pointer', fontSize: 11 }}>CƯỚP QUYỀN THI</button>
                          ) : (
                              <span style={{background: `${C.err}20`, color: C.err, padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700}}>{badgeText}</span>
                          )}
                      </div>
                  )
              })}
              {activeQuizzes.length === 0 && <div style={{color: C.sub, fontSize: 13, textAlign: 'center', padding: 10}}>{t('no_quizzes')}</div>}
            </div>
            
            {myQuizResults.length > 0 && (
                <div style={{marginTop: 30}}>
                    <div style={{fontSize: 12, fontWeight: 800, color: C.sub, marginBottom: 10}}>{t('test_results_title')}</div>
                    {myQuizResults.map(r => {
                        if (!r) return null;
                        return (
                        <div key={r.id} style={{display: 'flex', justifyContent: 'space-between', padding: 15, borderBottom: `1px solid ${C.border}`, alignItems: 'center'}}>
                            <div>
                                <div style={{fontSize: 14, fontWeight: 800}}>{r.quizTitle}</div>
                                <div style={{fontSize: 11, color: C.sub, marginTop: 4}}>{r.date}</div>
                            </div>
                            <div style={{textAlign: 'right'}}>
                                <div style={{fontSize: 20, fontWeight: 900, color: C.accent}}>{r.score}/{r.total}</div>
                                <div style={{fontSize: 12, fontWeight: 800, color: C.sub, marginBottom: 8}}>Band {r.band}</div>
                                <button onClick={() => handleReviewQuiz(r)} style={{fontSize: 11, background: C.card, border: `1px solid ${C.border}`, color: C.text, padding: '4px 8px'}}>{t('view_review')}</button>
                            </div>
                        </div>
                    )})}
                </div>
            )}
          </div>

          <div className="card" style={{ marginBottom: 24 }}>
            <h3 style={{marginTop: 0, display: 'flex', alignItems: 'center', gap: 8, borderBottom: `1px solid ${C.border}`, paddingBottom: 15}}>📂 Kho Tài Liệu (Drive)</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 15, marginTop: 15 }}>
              {myLinks.map(l => {
                return (
                <div key={l.id} style={{ background: C.bg, padding: 15, borderRadius: 10, border: `1px solid ${C.border}` }}>
                  <div style={{ fontWeight: 800, marginBottom: 10, fontSize: 13, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', height: 35 }}>
                      {getFileIcon(l.url)} {l.title}
                  </div>
                  <div style={{display: 'flex', gap: 8}}>
                    <a href={l.url} target="_blank" rel="noreferrer" style={{ flex: 1, background: C.accent, color: "#fff", padding: "8px", borderRadius: 6, fontSize: 11, textDecoration: "none", textAlign:'center', fontWeight: 700 }}>Mở / Tải xuống</a>
                  </div>
                </div>
              )})}
              {myLinks.length === 0 && <div style={{color: C.sub, fontSize: 13, gridColumn: '1 / -1', textAlign: 'center', padding: 20}}>Chưa có tài liệu nào được chia sẻ.</div>}
            </div>
          </div>

          <div className="card">
            <h3 style={{marginTop: 0, borderBottom: `1px solid ${C.border}`, paddingBottom: 15}}>Lịch sử buổi học & Nhận xét</h3>
            {myHistory.map(h => {
              return (
              <div key={h.id} style={{ borderBottom: `1px solid ${C.border}`, padding: "20px 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: 'center' }}>
                  <span style={{ fontWeight: 900, fontSize: 15 }}>{h.date}</span>
                  <span style={{ fontSize: 10, fontWeight: 800, padding: '4px 10px', background: h.isPaid?`${C.succ}15`:`${C.warn}15`, color: h.isPaid?C.succ:C.warn, borderRadius: 12 }}>{h.isPaid ? 'Đã thanh toán' : 'Nợ học phí'}</span>
                </div>
                <div style={{ color: C.sub, fontSize: 12, marginTop: 6, fontWeight: 600 }}>Giáo viên: {h.teacher}</div>
                <div style={{ marginTop: 12, fontSize: 14, background: C.bg, padding: 15, borderRadius: 8, border: `1px solid ${C.border}`, lineHeight: 1.5 }}>{h.notes || "Không có ghi chú thêm."}</div>
                <div style={{ display: "flex", flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
                  {(Array.isArray(h.skills) ? h.skills : []).map(sk => <span key={sk} style={{ background: C.card, border: `1px solid ${C.border}`, padding: "4px 10px", borderRadius: 6, fontSize: 10, fontWeight: 700, color: C.sub }}>{sk}</span>)}
                </div>
              </div>
            )})}
            {myHistory.length === 0 && <div style={{textAlign: 'center', padding: 30, color: C.sub, fontSize: 13}}>Chưa có buổi học nào được ghi nhận.</div>}
          </div>
        </main>
      </div>
    );
  }

  // ==========================================
  // VIEW: TEACHER / ADMIN PORTAL
  // ==========================================
  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "system-ui, sans-serif", transition: "0.2s" }}>
      {globalStyles}
      <nav className="no-print" style={{ background: C.card, borderBottom: `1px solid ${C.border}`, padding: "10px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ background: C.accent, color: "white", width: 32, height: 32, borderRadius: 8, display: "grid", placeItems: "center", fontWeight: 900 }}>I</div>
          <h1 style={{ margin: 0, fontSize: 16, fontWeight: 900, letterSpacing: -0.5 }}>IELTS <span style={{ color: C.accent }}>OS</span></h1>
        </div>
        <div style={{ display: "flex", gap: 4, overflowX: "auto", alignItems: 'center' }}>
          <div style={{fontSize: 10, fontWeight: 900, padding: '4px 8px', borderRadius: 4, background: serverStatus === "OK" ? "#10B98120" : "#EF444420", color: serverStatus === "OK" ? "#10B981" : "#EF4444", marginRight: 15, whiteSpace: 'nowrap'}} title="Trạng thái Backend Server">
              {serverStatus === "OK" ? "● SERVER HEALTHY" : "● SERVER DOWN"}
          </div>
          <div style={{fontSize: 14, fontWeight: 900, color: C.accent, marginRight: 15}}>{liveTime}</div>
          {(["DASHBOARD", "CLASSROOM", "EXAM_BUILDER", "LIVE_ARENA", "ACADEMICS", "FINANCE", "STUDENTS", "DRIVE", "HISTORY"] as TabType[]).map(t => (
            <button key={t} onClick={() => setActiveTab(t)} className={`tab-btn ${activeTab === t ? 'active' : ''}`}>{t.replace("_", " ")}</button>
          ))}
          <div style={{borderLeft: `1px solid ${C.border}`, margin: '0 5px'}}></div>
          <button onClick={() => setColorblind(!colorblind)} style={{ background: "transparent", fontSize: 18, padding: "0 10px", opacity: colorblind ? 1 : 0.5 }} title="Chế độ Tương phản cao">👁️</button>
          <button onClick={() => setTheme(theme === "light" ? "dark" : "light")} style={{ background: "transparent", fontSize: 18, padding: "0 10px" }}>{theme === "light" ? "🌙" : "☀️"}</button>
          <button onClick={handleLogout} style={{ background: `${C.err}15`, color: C.err, padding: "6px 12px", fontSize: 12, fontWeight: 700 }}>Thoát</button>
        </div>
      </nav>

      <main className="no-print" style={{ maxWidth: 1150, margin: "0 auto", padding: "32px 20px" }}>
        
        {/* ================= DASHBOARD ================= */}
        {activeTab === "DASHBOARD" && (
          <div style={{ display: "grid", gridTemplateColumns: window.innerWidth > 900 ? "1fr 320px" : "1fr", gap: 24 }}>
            <div style={{ display: "grid", gap: 24 }}>
              <div style={{ display: "grid", gridTemplateColumns: window.innerWidth > 600 ? "1fr 1fr" : "1fr", gap: 20 }}>
                <div className="card" style={{ borderTop: `4px solid ${C.succ}` }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: C.sub }}>{t('net_profit')}</div>
                  <div style={{ fontSize: 32, fontWeight: 900 }}>{fmtMoney(stats.net)}</div>
                </div>
                <div className="card" style={{ borderTop: `4px solid ${C.accent}` }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: C.sub }}>{t('total_teaching_hours')}</div>
                  <div style={{ fontSize: 32, fontWeight: 900, color: C.accent }}>{(history.reduce((s,h)=>s+((h && h.duration)||0),0)/3600).toFixed(1)}h</div>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 15 }}>
                  <div className="card" style={{padding: 15, textAlign: 'center'}}>
                      <div style={{fontSize: 10, fontWeight: 800, color: C.sub}}>{t('student_count')}</div>
                      <div style={{fontSize: 20, fontWeight: 900, color: C.text, marginTop: 5}}>{Array.isArray(students) ? students.length : 0}</div>
                  </div>
                  <div className="card" style={{padding: 15, textAlign: 'center'}}>
                      <div style={{fontSize: 10, fontWeight: 800, color: C.sub}}>{t('total_debt')}</div>
                      <div style={{fontSize: 20, fontWeight: 900, color: C.warn, marginTop: 5}}>{fmtMoney(stats?.unpaid || 0)}</div>
                  </div>
                  <div className="card" style={{padding: 15, textAlign: 'center'}}>
                      <div style={{fontSize: 10, fontWeight: 800, color: C.sub}}>{t('drive_docs')}</div>
                      <div style={{fontSize: 20, fontWeight: 900, color: C.accent, marginTop: 5}}>{Array.isArray(sharedLinks) ? sharedLinks.length : 0}</div>
                  </div>
              </div>
              <div className="card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                  <h3 style={{ margin: 0 }}>📅 Lịch dạy: {viewDate}</h3>
                  <button onClick={() => setShowSchedForm(!showSchedForm)} style={{ background: C.accent, color: "#fff", padding: "8px 16px", fontSize: 12 }}>+ Đặt lịch mới</button>
                </div>
                
                {showSchedForm && (
                  <div style={{ background: C.bg, padding: 16, borderRadius: 12, marginBottom: 20, display: "grid", gap: 12, border: `1px solid ${C.border}` }}>
                    <div style={{display:'grid', gridTemplateColumns: window.innerWidth > 600 ? '1fr 1fr' : '1fr', gap:10}}>
                        <div><label style={{fontSize:10, fontWeight: 800, color: C.sub}}>GIỜ BẮT ĐẦU</label><input type="time" value={schedForm.time} onChange={(e: any)=>setSchedForm({...schedForm, time:e.target.value})} /></div>
                        <div>
                          <label style={{fontSize:10, fontWeight: 800, color: C.sub}}>HỌC VIÊN</label>
                          <select value={schedForm.studentId} onChange={(e: any)=>setSchedForm({...schedForm, studentId:e.target.value})}>
                              <option value="">Chọn HS...</option>
                              {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                        </div>
                    </div>
                    <div><label style={{fontSize:10, fontWeight: 800, color: C.sub}}>ĐỊA ĐIỂM / LINK</label><input placeholder="VD: Zoom..." value={schedForm.location} onChange={(e: any)=>setSchedForm({...schedForm, location:e.target.value})} /></div>
                    <button onClick={handleAddSchedule} style={{ background: C.succ, color: "#fff", padding:'12px', marginTop: 5 }}>LƯU LỊCH</button>
                  </div>
                )}

                <div style={{ display: "grid", gap: 10 }}>
                  {schedules.filter(s => s && s.date === viewDate).map(s => (
                    <div key={s.id} style={{ display: "flex", justifyContent: "space-between", padding: "15px", background: C.bg, borderRadius: 10, border: `1px solid ${C.border}` }}>
                      <div>
                        <div style={{fontWeight:800, fontSize: 14}}>{s.studentName} <span style={{background: `${C.accent}20`, color: C.accent, padding: '2px 6px', borderRadius: 4, fontSize: 11, marginLeft: 8}}>{s.time}</span></div>
                        <div style={{fontSize:12, color:C.sub, marginTop: 4}}>{s.teacher} • {s.location}</div>
                      </div>
                      <div style={{display: 'flex', gap: 5}}>
                          <button onClick={() => copyToClipboard(`Chào bạn, nhắc nhẹ hôm nay mình có lịch học IELTS lúc ${s.time} tại ${s.location} nhé!`)} style={{ background: `${C.succ}20`, color: C.succ, fontSize: 12, padding: '4px 8px' }}>Nhắc lịch</button>
                          <button onClick={()=>{ const nx=schedules.filter(x=>x && x.id!==s.id); setSchedules(nx); syncData({schedules:nx}); }} style={{ color: C.err, background: "none", fontSize: 12 }}>Xóa</button>
                      </div>
                    </div>
                  ))}
                  {schedules.filter(s => s && s.date === viewDate).length === 0 && <div style={{textAlign:'center', color:C.sub, padding:30, fontSize: 13}}>Trống lịch ngày này.</div>}
                </div>
              </div>
            </div>

            <div className="card" style={{height:'fit-content'}}>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20}}>
                <button onClick={() => setCalDate(new Date(calDate.getFullYear(), calDate.getMonth()-1))} style={{background:C.bg, color:C.text, padding: '6px 12px'}}>{"<"}</button>
                <div style={{fontWeight:900, fontSize:15, textTransform: 'uppercase'}}>{calHeader}</div>
                <button onClick={() => setCalDate(new Date(calDate.getFullYear(), calDate.getMonth()+1))} style={{background:C.bg, color:C.text, padding: '6px 12px'}}>{">"}</button>
              </div>
              <div className="cal-grid">
                {["S","M","T","W","T","F","S"].map(d => <div key={d} style={{textAlign:'center', fontSize:10, fontWeight:900, color:C.sub, marginBottom: 8}}>{d}</div>)}
                {calendarDays.map((d, idx) => d ? (
                  <div key={idx} onClick={() => setViewDate(d.date)} className={`cal-day ${d.hasSched ? 'has-sched' : ''} ${d.date === viewDate ? 'selected' : ''}`}>{d.day}</div>
                ) : <div key={`empty-${idx}`} className="cal-day empty" />)}
              </div>

              <div style={{marginTop: 30}}>
                  <label style={{fontSize: 10, fontWeight: 800, color: C.sub}}>THÔNG BÁO CHUNG CHO HỌC VIÊN</label>
                  <div style={{display: 'flex', gap: 5, marginTop: 5}}>
                      <input placeholder="VD: Nghỉ lễ 30/4..." value={announcement} onChange={e => setAnnouncement(e.target.value)} onBlur={() => syncData({announcement})} style={{background: C.bg}} />
                      <button onClick={() => { setAnnouncement(""); syncData({announcement: ""}); }} style={{background: C.err, color: '#fff', padding: '0 15px'}} title="Xóa thông báo">X</button>
                  </div>
              </div>
            </div>
            
            {/* BUG TRACKER DASHBOARD */}
            <div className="card" style={{ border: `2px solid ${C.err}`, gridColumn: window.innerWidth > 900 ? '1 / -1' : '1' }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 15 }}>
                    <h3 style={{ margin: 0, color: C.err, display: 'flex', alignItems: 'center', gap: 8 }}>🚨 BUG TRACKER <span style={{fontSize: 12, background: C.err, color: '#fff', padding: '2px 8px', borderRadius: 12}}>{Array.isArray(systemLogs) ? systemLogs.length : 0}</span></h3>
                    <button onClick={() => { if(confirm("Xóa toàn bộ log lỗi?")) { setSystemLogs([]); syncData({systemLogs: []}); } }} style={{ background: `${C.err}20`, color: C.err, padding: '6px 12px', fontSize: 12, fontWeight: 800 }}>🗑 Dọn dẹp Log</button>
                </div>
                <div style={{ maxHeight: 300, overflowY: 'auto', display: 'grid', gap: 8 }}>
                    {systemLogs.map(log => (
                        <div key={log.id} style={{ fontSize: 13, padding: 12, background: C.bg, border: `1px solid ${C.border}`, borderLeft: `4px solid ${C.err}`, borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                                <span style={{ fontWeight: 900, color: C.err }}>[{log.errorType}]</span>
                                <span style={{ color: C.sub, fontSize: 11, fontWeight: 700 }}>{log.timestamp}</span>
                            </div>
                            <div style={{ fontWeight: 600, color: C.text, lineHeight: 1.4 }}>{log.message}</div>
                            <div style={{ color: C.sub, fontSize: 11, background: C.card, padding: '6px 10px', borderRadius: 4 }}>👤 User: <b style={{color: C.accent}}>{log.email}</b> {log.context && `| 🔍 Context: ${log.context}`}</div>
                        </div>
                    ))}
                   {systemLogs.length === 0 && <div style={{ color: C.succ, textAlign: 'center', padding: 30, fontWeight: 800 }}>Hệ thống đang hoạt động ổn định, không có lỗi nào được ghi nhận.</div>}
                    </div>
                </div>
            </div>
        )}

        {/* ================= CLASSROOM (GIAO DIỆN TÍNH GIỜ OFFLINE CŨ) ================= */}
        {activeTab === "CLASSROOM" && (
          <div style={{ display: "grid", gap: 24 }}>
            <div className="card" style={{ display: "grid", gridTemplateColumns: window.innerWidth > 768 ? "1fr 1fr" : "1fr", gap: 24 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 900, color: C.sub, display: "block", marginBottom: 10 }}>CHỌN HỌC VIÊN</label>
                <select value={selStudent} onChange={(e: any) => setSelStudent(e.target.value)}>
                  <option value="">-- Chọn học sinh --</option>
                  {students.map(s => <option key={s.id} value={s.id}>{s.name} ({fmtMoney(s.rate)}/h)</option>)}
                </select>
                <div style={{marginTop: 20, fontSize: 13, color: C.sub, fontWeight: 600}}>
                   👤 Giáo viên phụ trách: <span style={{fontWeight: 800, color: C.accent}}>{myTeacherName}</span>
                </div>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 900, color: C.sub, display: "block", marginBottom: 12 }}>KỸ NĂNG GIẢNG DẠY (TÍCH CHỌN)</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {SKILLS.map(sk => (
                    <button key={sk} onClick={() => setSelSkills(p => p.includes(sk) ? p.filter(x=>x!==sk) : [...p, sk])} style={{ padding: "8px 12px", fontSize: 12, background: selSkills.includes(sk) ? C.accent : C.bg, color: selSkills.includes(sk) ? "#fff" : C.text, border: `1px solid ${C.border}` }}>
                      {selSkills.includes(sk) ? "✓ " : "+ "} {sk}
                    </button>
                  ))}
                </div>
                <div style={{marginTop:20, display:'flex', gap:10}}>
                  <button onClick={() => {resetTimer();}} style={{flex:1, background: C.accent, color: '#fff', border: `1px solid ${C.accent}`}}>Stopwatch</button>
                  <button onClick={() => setShowManualTime(!showManualTime)} style={{flex:1, background: showManualTime?C.warn:C.bg, color: showManualTime?'#fff':C.sub, border: `1px solid ${showManualTime?C.warn:C.border}`}}>+ Nhập Tay</button>
                </div>
              </div>
            </div>

            {showManualTime && (
              <div className="card" style={{ background: `${C.warn}10`, border: `1px solid ${C.warn}50` }}>
                <h3 style={{marginTop: 0, color: C.warn, fontSize: 14}}>⏱ CỘNG GIỜ THỦ CÔNG</h3>
                <div style={{ display: "grid", gridTemplateColumns: window.innerWidth > 600 ? "1fr 1fr auto" : "1fr", gap: 15, alignItems: "end" }}>
                   <div><label style={{fontSize: 10, fontWeight: 800}}>SỐ PHÚT</label><input type="number" placeholder="VD: 90" value={manualMin} onChange={(e: any)=>setManualMin(e.target.value)} style={{background: C.card}} /></div>
                   <div><label style={{fontSize: 10, fontWeight: 800}}>SỐ GIÂY (LẺ)</label><input type="number" placeholder="VD: 30" value={manualSec} onChange={(e: any)=>setManualSec(e.target.value)} style={{background: C.card}} /></div>
                   <button onClick={saveManualSession} style={{ background: C.warn, color: "#fff", padding: "12px 24px" }}>LƯU THÀNH TIỀN</button>
                </div>
              </div>
            )}

            <div className="card" style={{ textAlign: "center", padding: "80px 20px" }}>
              <div className="timer-num" style={{ fontSize: window.innerWidth > 600 ? 150 : 80, fontWeight: 900, lineHeight: 1, marginBottom: 20 }}>
                {fmtTime(elapsed)}
              </div>
              <div style={{ marginBottom: 50, fontSize: 14, fontWeight: 900, color: C.sub, letterSpacing: 4 }}>
                {running ? <span style={{color: C.succ}}>● SYSTEM LIVE</span> : "READY"}
              </div>
              <div style={{ display: "flex", justifyContent: "center", gap: 16 }}>
                {!running ? (
                  <button onClick={() => toggleTimer(true)} style={{ padding: "20px 60px", background: C.accent, color: "#fff", fontSize: 18, boxShadow: `0 10px 20px ${C.accent}40` }}>BẮT ĐẦU</button>
                ) : (
                  <>
                    <button onClick={() => toggleTimer(false)} style={{ padding: "18px 32px", background: C.warn, color: "#fff" }}>TẠM DỪNG</button>
                    <button onClick={handleSaveSession} style={{ padding: "18px 32px", background: C.succ, color: "#fff" }}>LƯU KẾT QUẢ</button>
                  </>
                )}
                {!running && elapsed > 0 && (
                  <button onClick={resetTimer} style={{ background: "transparent", border: `1px solid ${C.border}`, color: C.text, padding: "0 20px" }}>RESET</button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ================= EXAM BUILDER ================= */}
        {activeTab === "EXAM_BUILDER" && (
            <div className="card" style={{position: 'relative', padding: 0}}>
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px 24px', position: 'sticky', top: 52, background: C.card, zIndex: 90, borderBottom: `2px solid ${C.accent}`, borderRadius: '12px 12px 0 0', boxShadow: '0 4px 10px rgba(0,0,0,0.05)'}}>
                    <h2 style={{marginTop: 0, margin: 0, fontSize: 18}}>📝 HỆ THỐNG ĐỀ THI ONLINE</h2>
                    
                   {editingQuiz || keyEditingQuiz ? (
                        <div style={{display: 'flex', gap: 10}}>
                            {editingQuiz && <button onClick={() => window.print()} style={{background: C.text, color: C.bg, padding: '8px 12px', fontSize: 12}}>🖨️ In Đề (PDF)</button>}
                            {editingQuiz && <button onClick={() => saveQuiz()} style={{background: C.accent, color: '#fff', padding: '8px 12px', fontSize: 12}}>💾 LƯU ĐỀ THI</button>}
                            <button onClick={() => {
                                setEditingQuiz(null);
                                setKeyEditingQuiz(null);
                                localStorage.removeItem('ielts_exam_draft');
                            }} style={{background: C.bg, border: `1px solid ${C.border}`, padding: '8px 12px', color: C.text, fontSize: 12}}>QUAY LẠI DANH SÁCH</button>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                          <select value={sortQuiz} onChange={(e: any) => setSortQuiz(e.target.value)} style={{width: 'auto', border: `1px solid ${C.border}`, fontSize: 12}}>
                              <option value="NEW">Mới nhất</option>
                              <option value="OLD">Cũ nhất</option>
                              <option value="AZ">A-Z</option>
                          </select>
                          {localStorage.getItem('ielts_exam_draft') && (
                              <button onClick={() => setEditingQuiz(JSON.parse(localStorage.getItem('ielts_exam_draft') || "{}"))} style={{background: C.warn, color: '#fff', padding: '8px 16px', fontSize: 12}}>Khôi phục nháp</button>
                          )}
                          <button onClick={() => setEditingQuiz({ id: getTrueTime().toString(), title: "Đề thi mới", type: "Reading", timeLimit: 60, maxAttempts: 1, questions: [], active: false, audience: "ALL", targetStudentIds: [] })} style={{background: C.accent, color: '#fff', padding: '8px 16px', fontSize: 12}}>+ TẠO ĐỀ THI MỚI</button>
                          <label style={{ background: C.succ, color: '#fff', padding: '8px 16px', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 12, display: 'flex', alignItems: 'center' }}>
                            📥 NẠP ĐỀ TỪ WORD (.DOCX)
                            <input type="file" accept=".docx" onChange={handleFileUpload} style={{ display: 'none' }} />
                          </label>
                          {selectedQuizzes.length > 0 && (
                              <>
                                <button onClick={() => handleBulkLock(true)} style={{background: C.warn, color: '#fff', padding: '8px 16px', fontSize: 12, borderRadius: 6}}>🔒 Khóa ({selectedQuizzes.length})</button>
                                <button onClick={() => handleBulkLock(false)} style={{background: C.succ, color: '#fff', padding: '8px 16px', fontSize: 12, borderRadius: 6}}>🔓 Mở ({selectedQuizzes.length})</button>
                                <button onClick={handleBulkDeleteQuizzes} style={{background: C.err, color: '#fff', padding: '8px 16px', fontSize: 12, borderRadius: 6}}>🗑 Xóa ({selectedQuizzes.length})</button>
                              </>
                          )}
                        </div>
                    )}
                </div>

                {printBlankSheet && editingQuiz && (
                    <div className="print-area">
                        <div className="unified-report">
                            <div className="report-header">
                                <h1 className="report-title">{editingQuiz!.title} - ANSWER SHEET</h1>
                                <div className="report-subtitle">IELTS Computer-Based Training System</div>
                            </div>
                            <div className="student-meta" style={{gridTemplateColumns: '1fr 1fr 1fr'}}>
                                <div><div className="meta-label">Candidate Name</div><div style={{borderBottom: '1px solid #000', height: 20}}></div></div>
                                <div><div className="meta-label">Date</div><div style={{borderBottom: '1px solid #000', height: 20}}></div></div>
                                <div><div className="meta-label">Score</div><div style={{borderBottom: '1px solid #000', height: 20}}></div></div>
                            </div>
                            <div className="blank-answer-sheet">
                                {editingQuiz!.questions.map((q, i) => (
                                    <div key={q.id} className="ans-box">
                                        <span className="ans-num">{i + 1}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <style>{`@media print { body * { visibility: hidden; } .print-area, .print-area * { visibility: visible; } .print-area { position: absolute; left: 0; top: 0; } }`}</style>
                        <script>{`window.print();`}</script>
                        {setTimeout(() => setPrintBlankSheet(false), 1000) && null}
                    </div>
                )}
                
                {keyEditingQuiz ? (
                    <div style={{background: C.bg, padding: 24, borderRadius: '0 0 12px 12px'}}>
                        <h3 style={{marginTop: 0, marginBottom: 20, color: C.accent}}>🔑 CHỈNH SỬA NHANH BỘ ĐÁP ÁN (KEY): {keyEditingQuiz!.title}</h3>
                        <div style={{display: 'grid', gap: 12, maxHeight: '55vh', overflowY: 'auto', paddingRight: 10, marginBottom: 20}}>
                            {(keyEditingQuiz!.questions || []).map((q, idx) => (
                                <div key={q.id} style={{padding: 12, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 15}}>
                                    <div style={{fontWeight: 800, fontSize: 14, minWidth: 70}}>Câu {idx + 1}:</div>
                                    <div style={{flex: 1, fontSize: 13, maxHeight: 40, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}} dangerouslySetInnerHTML={{__html: q.text}} />
                                    <div style={{width: 250}}>
                                        {q.type === "CHOICE" ? (
                                            <select value={q.correctAnswer} onChange={(e) => {
                                                const nQ = [...keyEditingQuiz!.questions];
                                                nQ[idx] = { ...q, correctAnswer: Number(e.target.value) };
                                                setKeyEditingQuiz({ ...keyEditingQuiz!, questions: nQ });
                                            }}>
                                                {(q.options || []).map((opt, oIdx) => (
                                                    <option key={oIdx} value={oIdx}>Option {oIdx + 1}: {(opt || "").toString().replace(/<[^>]*>/g, '')}</option>
                                                ))}
                                            </select>
                                        ) : (
                                            <input type="text" value={String(q.correctAnswer)} onChange={(e) => {
                                                const nQ = [...keyEditingQuiz!.questions];
                                                nQ[idx] = { ...q, correctAnswer: e.target.value };
                                                setKeyEditingQuiz({ ...keyEditingQuiz!, questions: nQ });
                                            }} placeholder="Nhập từ khóa đúng..." />
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div style={{display: 'flex', gap: 10, justifyContent: 'flex-end'}}>
                            <button onClick={() => {
                                const nx = quizzes.map(x => x.id === keyEditingQuiz!.id ? keyEditingQuiz! : x);
                                setQuizzes(nx); syncData({ quizzes: nx }); setKeyEditingQuiz(null);
                                alert("Đã cập nhật và đồng bộ bộ đáp án mới lên hệ thống!");
                            }} style={{background: C.succ, color: '#fff', padding: '10px 20px'}}>LƯU BỘ KEY ĐÁP ÁN</button>
                            <button onClick={() => setKeyEditingQuiz(null)} style={{background: C.bg, border: `1px solid ${C.border}`, color: C.text, padding: '10px 20px'}}>HỦY BỎ</button>
                        </div>
                    </div>
                ) : editingQuiz ? (
                    <div style={{background: C.bg, padding: 24, borderRadius: '0 0 12px 12px'}}>
                        <div style={{display: 'grid', gridTemplateColumns: window.innerWidth > 600 ? '1fr 1fr 1fr 1fr' : '1fr', gap: 15, marginBottom: 20}}>
                            <div><label style={{fontSize: 10, fontWeight: 800}}>TÊN ĐỀ</label><input value={editingQuiz!.title} onChange={(e: any)=>setEditingQuiz({...editingQuiz!, title: e.target.value})} /></div>
                            <div>
                                <label style={{fontSize: 10, fontWeight: 800}}>LOẠI</label>
                                <select value={editingQuiz!.type} onChange={(e: any)=>setEditingQuiz({...editingQuiz!, type: e.target.value as any})}>
                                    <option value="Reading">Reading</option><option value="Listening">Listening</option>
                                </select>
                            </div>
                            <div><label style={{fontSize: 10, fontWeight: 800}}>THỜI GIAN (PHÚT)</label><input type="number" value={editingQuiz!.timeLimit || ""} onChange={(e: any)=>setEditingQuiz({...editingQuiz!, timeLimit: Number(e.target.value)})} /></div>
                            <div><label style={{fontSize: 10, fontWeight: 800}}>GIỚI HẠN SỐ LẦN LÀM</label><input type="number" value={editingQuiz!.maxAttempts || 1} onChange={(e: any)=>setEditingQuiz({...editingQuiz!, maxAttempts: Number(e.target.value)})} /></div>
                        </div>

                        <div style={{display: 'grid', gridTemplateColumns: window.innerWidth > 600 ? '1fr 1fr 1fr' : '1fr', gap: 15, marginBottom: 20, background: `${C.warn}10`, padding: 15, borderRadius: 8, border: `1px solid ${C.warn}40`}}>
                            <div>
                                <label style={{fontSize: 10, fontWeight: 800, color: C.warn}}>BẮT ĐẦU MỞ ĐỀ (TỪ NGÀY/GIỜ)</label>
                                <input type="datetime-local" value={editingQuiz!.scheduledStart || ""} onChange={(e: any)=>setEditingQuiz({...editingQuiz!, scheduledStart: e.target.value})} style={{border: `1px solid ${C.warn}`}} />
                            </div>
                            <div>
                                <label style={{fontSize: 10, fontWeight: 800, color: C.warn}}>ĐÓNG ĐỀ LÚC (CƯỠNG CHẾ NỘP)</label>
                                <input type="datetime-local" value={editingQuiz!.scheduledEnd || ""} onChange={(e: any)=>setEditingQuiz({...editingQuiz!, scheduledEnd: e.target.value})} style={{border: `1px solid ${C.warn}`}} />
                            </div>
                            <div>
                                <label style={{fontSize: 10, fontWeight: 800, color: C.warn}}>MÃ BẢO VỆ PHÒNG THI</label>
                                <div style={{display: 'flex', gap: 5}}>
                                    <input type="text" placeholder="Mã PIN (VD: 1234)..." value={editingQuiz!.passcode || ""} onChange={(e: any)=>setEditingQuiz({...editingQuiz!, passcode: e.target.value})} style={{border: `1px solid ${C.warn}`, flex: 1}} />
                                    <button onClick={() => setEditingQuiz({...editingQuiz!, passcode: Math.floor(1000 + Math.random() * 9000).toString()})} style={{background: C.warn, color: '#fff', padding: '0 15px', borderRadius: 6}} title="Tạo mã ngẫu nhiên">🎲</button>
                                    <button onClick={() => copyToClipboard(editingQuiz!.passcode || "")} style={{background: C.card, border: `1px solid ${C.warn}`, color: C.text, padding: '0 15px', borderRadius: 6}} title="Copy Mã">📋</button>
                                </div>
                            </div>
                        </div>
                        {editingQuiz!.type === "Listening" && (
                            <div style={{marginBottom: 20}}>
                                <label style={{fontSize: 10, fontWeight: 800}}>FILE NGHE (Link MP3/M4A)</label>
                                <input placeholder="Dán link file nghe của đề thi vào đây..." value={editingQuiz!.audioUrl || ""} onChange={(e: any)=>setEditingQuiz({...editingQuiz!, audioUrl: e.target.value})} />
                            </div>
                        )}

                        <div style={{marginBottom: 20}}>
                            <label style={{fontSize: 10, fontWeight: 800}}>GHI CHÚ NỘI BỘ GIÁO VIÊN</label>
                            <input placeholder="Ghi chú (VD: Lấy từ Cam 18 Test 2)..." value={editingQuiz!.internalNote || ""} onChange={(e: any)=>setEditingQuiz({...editingQuiz!, internalNote: e.target.value})} style={{marginBottom: 10}} />
                        </div>

                        <div style={{marginBottom: 20}}>
                            <label style={{fontSize: 10, fontWeight: 800}}>TAG PHÂN LOẠI</label>
                            <input placeholder="VD: Homework, Midterm..." value={editingQuiz!.tag || ""} onChange={(e: any)=>setEditingQuiz({...editingQuiz!, tag: e.target.value})} style={{maxWidth: 300, display: 'block', marginBottom: 10}} />
                        </div>

                        <div style={{marginBottom: 20}}>
                            <label style={{fontSize: 10, fontWeight: 800}}>LỜI DẶN DÒ TRƯỚC KHI THI (INSTRUCTIONS)</label>
                            <div style={{fontSize: 11, color: C.sub, marginBottom: 10}}>Hiển thị thành một màn hình yêu cầu học sinh đọc và xác nhận trước khi hệ thống bắt đầu tính giờ làm bài.</div>
                            <RichTextEditor 
                                value={(editingQuiz! as any).frontInstructions || ""} 
                                onChange={(v) => setEditingQuiz({...editingQuiz!, frontInstructions: v} as any)}
                                placeholder="Nhập nội quy phòng thi, dặn dò..."
                            />
                        </div>

                        <div style={{marginBottom: 20}}>
                            <label style={{fontSize: 10, fontWeight: 800}}>ĐỐI TƯỢNG GIAO ĐỀ</label>
                            <select value={editingQuiz!.audience || "ALL"} onChange={(e: any) => setEditingQuiz({...editingQuiz!, audience: e.target.value as "ALL" | "SPECIFIC"})} style={{marginBottom: 10}}>
                                <option value="ALL">Tất cả học viên (Public)</option>
                                <option value="SPECIFIC">Chỉ định học viên cụ thể</option>
                            </select>
                            {editingQuiz!.audience === "SPECIFIC" && (
                                <div style={{display: 'flex', flexWrap: 'wrap', gap: 10, padding: 15, background: `${C.accent}10`, borderRadius: 8, border: `1px solid ${C.accent}40`}}>
                                    {students.map(s => (
                                        <label key={s.id} style={{display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, cursor: 'pointer'}}>
                                            <input type="checkbox" checked={editingQuiz!.targetStudentIds?.includes(s.id) || false} onChange={(e: any) => {
                                                const curr = editingQuiz!.targetStudentIds || [];
                                                const next = e.target.checked ? [...curr, s.id] : curr.filter(id => id !== s.id);
                                                setEditingQuiz({...editingQuiz!, targetStudentIds: next});
                                            }} style={{width: 'auto', margin: 0}} />
                                            {s.name}
                                        </label>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="exam-print-only" style={{marginBottom: 20}}>
                            <h4 style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>Danh sách câu hỏi ({(editingQuiz!.questions || []).length}) 
                                <button className="no-print" onClick={() => setEditingQuiz({...editingQuiz!, questions: [...(editingQuiz!.questions || []), {id: getTrueTime().toString() + Math.random(), type: "CHOICE", text: "Câu hỏi mới", options: ["A", "B", "C", "D"], correctAnswer: 0}]})} style={{background: C.succ, color: '#fff', padding: '6px 12px', fontSize: 12}}>+ Thêm câu hỏi</button>
                            </h4>
                            
                            <div className="no-print" style={{marginBottom: 20}}>
                                <label style={{fontSize: 10, fontWeight: 800, color: C.accent}}>NỘI DUNG BÀI ĐỌC</label>
                                <RichTextEditor 
                                    value={editingQuiz!.passage || ""} 
                                    onChange={(v) => setEditingQuiz({...editingQuiz!, passage: v})}
                                    placeholder="Dán hoặc soạn nội dung bài đọc, transcript phần nghe vào đây..."
                                />
                            </div>

                            <div style={{display: 'grid', gap: 15}}>
                                {(editingQuiz!.questions || []).map((q, qIndex) => {
                                    if (!q) return null;
                                    return (
                                    <div key={q.id} style={{background: C.card, padding: 15, borderRadius: 8, border: `1px solid ${C.border}`}}>
                                        <div className="no-print" style={{display: 'flex', gap: 5, marginBottom: 10, flexWrap: 'wrap'}}>
                                            <div style={{fontWeight: 800}}>Câu {qIndex + 1}:</div>
                                            
                                            <div style={{marginLeft: 'auto', display: 'flex', gap: 5}}>
                                                <button onClick={() => {
                                                    if (qIndex > 0) {
                                                        const nQ = [...(editingQuiz!.questions || [])];
                                                        [nQ[qIndex - 1], nQ[qIndex]] = [nQ[qIndex], nQ[qIndex - 1]];
                                                        setEditingQuiz({...editingQuiz!, questions: nQ});
                                                    }
                                                }} style={{background: C.card, border: `1px solid ${C.border}`, color: C.text, fontSize: 12, padding: '2px 8px'}} title="Chuyển lên">↑</button>
                                                
                                                <button onClick={() => {
                                                    if (qIndex < (editingQuiz!.questions?.length || 0) - 1) {
                                                        const nQ = [...(editingQuiz!.questions || [])];
                                                        [nQ[qIndex + 1], nQ[qIndex]] = [nQ[qIndex + 1], nQ[qIndex]];
                                                        setEditingQuiz({...editingQuiz!, questions: nQ});
                                                    }
                                                }} style={{background: C.card, border: `1px solid ${C.border}`, color: C.text, fontSize: 12, padding: '2px 8px'}} title="Chuyển xuống">↓</button>
                                                
                                                <button onClick={() => {
                                                    const nQ = [...(editingQuiz!.questions || [])];
                                                    const dup = { ...q, id: getTrueTime().toString() + Math.random() };
                                                    nQ.splice(qIndex + 1, 0, dup);
                                                    setEditingQuiz({...editingQuiz!, questions: nQ});
                                                }} style={{background: `${C.succ}20`, color: C.succ, fontSize: 12, padding: '2px 8px'}}>⧉ Nhân bản</button>

                                                <button onClick={() => setEditingQuiz({...editingQuiz!, questions: (editingQuiz.questions || []).filter(x=>x && x.id!==q.id)})} style={{color: C.err, background: `${C.err}15`, fontSize: 12, padding: '2px 8px'}}>🗑 Xóa</button>
                                            </div>
                                        </div>

                                        {q.groupContext !== undefined && (
                                            <div className="no-print" style={{marginBottom: 10}}>
                                                <label style={{fontSize: 10, fontWeight: 800, color: C.succ}}>NGỮ CẢNH CHUNG BẢNG/TÓM TẮT (Chỉ hiển thị 1 lần trước câu này)</label>
                                                <RichTextEditor 
                                                    value={q.groupContext || ""} 
                                                    onChange={(v) => {
                                                        const nQ = [...(editingQuiz!.questions || [])]; 
                                                        if(nQ[qIndex]) nQ[qIndex] = { ...nQ[qIndex], groupContext: v }; 
                                                        setEditingQuiz({...editingQuiz!, questions: nQ});
                                                    }}
                                                    placeholder="Dán bảng biểu hoặc đoạn tóm tắt dùng chung vào đây..."
                                                />
                                            </div>
                                        )}

                                        {q.instruction !== undefined && (
                                            <div className="no-print" style={{marginBottom: 10}}>
                                                <label style={{fontSize: 10, fontWeight: 800, color: C.warn}}>HƯỚNG DẪN (Ví dụ: Choose NO MORE THAN TWO WORDS)</label>
                                                <RichTextEditor 
                                                    value={q.instruction || ""} 
                                                    onChange={(v) => {
                                                        const nQ = [...(editingQuiz!.questions || [])]; 
                                                        if(nQ[qIndex]) nQ[qIndex] = { ...nQ[qIndex], instruction: v }; 
                                                        setEditingQuiz({...editingQuiz!, questions: nQ});
                                                    }}
                                                />
                                            </div>
                                        )}

                                        <div className="no-print" style={{display: 'flex', gap: 10, marginBottom: 10}}>
                                            {!q.instruction && (
                                                <button onClick={() => {
                                                    const nQ = [...(editingQuiz!.questions || [])]; 
                                                    if(nQ[qIndex]) nQ[qIndex] = { ...nQ[qIndex], instruction: "Choose ONE word only..." }; 
                                                    setEditingQuiz({...editingQuiz!, questions: nQ});
                                                }} style={{background: 'none', color: C.warn, fontSize: 11, textAlign: 'left', padding: 0}}>+ Thêm Hướng Dẫn</button>
                                            )}
                                            {!q.groupContext && (
                                                <button onClick={() => {
                                                    const nQ = [...(editingQuiz!.questions || [])]; 
                                                    if(nQ[qIndex]) nQ[qIndex] = { ...nQ[qIndex], groupContext: "Nhập tóm tắt..." }; 
                                                    setEditingQuiz({...editingQuiz!, questions: nQ});
                                                }} style={{background: 'none', color: C.succ, fontSize: 11, textAlign: 'left', padding: 0}}>+ Thêm Bảng/Tóm Tắt</button>
                                            )}
                                        </div>

                                        <div className="no-print" style={{marginBottom: 10}}>
                                            <label style={{fontSize: 10, fontWeight: 800, color: C.sub}}>NỘI DUNG CÂU HỎI</label>
                                            <RichTextEditor 
                                                value={q.text || ""} 
                                                onChange={(v) => {
                                                    const nQ = [...(editingQuiz!.questions || [])]; 
                                                    if(nQ[qIndex]) nQ[qIndex] = { ...nQ[qIndex], text: v }; 
                                                    setEditingQuiz({...editingQuiz!, questions: nQ});
                                                }}
                                            />
                                        </div>
                                        
                                        <div className="exam-print-only" style={{display: 'none', fontWeight: 800, marginBottom: 10, whiteSpace: 'pre-wrap'}} dangerouslySetInnerHTML={{__html: `${qIndex + 1}. ${q.text}`}} />

                                        <select className="no-print" value={q.type} onChange={(e: any) => {
                                            const nQ = [...(editingQuiz!.questions || [])]; 
                                            if(nQ[qIndex]) nQ[qIndex] = { ...nQ[qIndex], type: e.target.value as QuestionType, correctAnswer: e.target.value === "CHOICE" ? 0 : "" }; 
                                            setEditingQuiz({...editingQuiz!, questions: nQ});
                                        }} style={{marginBottom: 10}}>
                                            <option value="CHOICE">Trắc nghiệm (1 đáp án)</option>
                                            <option value="CHOICE_MULTIPLE">Nhiều lựa chọn (Nhiều đáp án)</option>
                                            <option value="MATCHING">Nối đặc điểm (Matching Grid)</option>
                                            <option value="BLANK">Điền từ (Nhập phím)</option>
                                            <option value="DRAG_DROP">Kéo - Thả (Vào đoạn văn/Nối câu)</option>
                                        </select>

                                        <div className="no-print" style={{ marginBottom: 10 }}>
                                            <label style={{ fontSize: 10, fontWeight: 800, color: C.sub }}>DẠNG CÂU HỎI CHI TIẾT (TAG DẠNG BÀI)</label>
                                            <select value={q.subType || ""} onChange={(e: any) => {
                                                const nQ = [...(editingQuiz!.questions || [])];
                                                if(nQ[qIndex]) nQ[qIndex] = { ...nQ[qIndex], subType: e.target.value };
                                                setEditingQuiz({...editingQuiz!, questions: nQ});
                                            }}>
                                                <option value="">-- Chưa gắn nhãn dạng bài chi tiết --</option>
                                                <option value="True/False/Not Given">True / False / Not Given</option>
                                                <option value="Matching Headings">Matching Headings</option>
                                                <option value="Multiple Choice">Multiple Choice</option>
                                                <option value="Sentence Completion">Sentence Completion</option>
                                                <option value="Summary Completion">Summary Completion</option>
                                                <option value="Diagram Labeling">Diagram Labeling</option>
                                            </select>
                                        </div>
                                        
                                        {q.type === "CHOICE" ? (
                                            <div style={{display: 'grid', gridTemplateColumns: window.innerWidth > 600 ? '1fr 1fr' : '1fr', gap: 10}}>
                                                <button onClick={() => {
                                                    const nQ = [...editingQuiz!.questions];
                                                    const qCopy = nQ[qIndex];
                                                    const opts = [...qCopy.options!];
                                                    const correctText = opts[qCopy.correctAnswer as number];
                                                    for (let i = opts.length - 1; i > 0; i--) {
                                                        const j = Math.floor(Math.random() * (i + 1));
                                                        [opts[i], opts[j]] = [opts[j], opts[i]];
                                                    }
                                                    nQ[qIndex] = { ...qCopy, options: opts, correctAnswer: opts.indexOf(correctText) };
                                                    setEditingQuiz({...editingQuiz!, questions: nQ});
                                                }} style={{gridColumn: '1 / -1', background: 'none', border: `1px solid ${C.border}`, color: C.text, padding: '4px', fontSize: 11}}>🔀 Đảo vị trí đáp án ngẫu nhiên</button>

                                                {(q.options || []).map((opt, optIndex) => (
                                                    <div key={optIndex} style={{display: 'flex', alignItems: 'center', gap: 5}}>
                                                        <input className="no-print" type="radio" name={`correct_${q.id}`} checked={q.correctAnswer === optIndex} onChange={() => {
                                                            const nQ = [...(editingQuiz!.questions || [])]; 
                                                            if(nQ[qIndex]) nQ[qIndex] = { ...nQ[qIndex], correctAnswer: optIndex }; 
                                                            setEditingQuiz({...editingQuiz!, questions: nQ});
                                                        }} style={{width: 'auto'}} title="Chọn làm đáp án đúng" />
                                                        <div className="exam-print-only" style={{display: 'none', width: 20, height: 20, border: '1px solid #000', borderRadius: '50%'}}></div>
                                                        <input className="no-print" value={opt} onChange={(e: any) => {
                                                            const nQ = [...(editingQuiz!.questions || [])]; 
                                                            if(nQ[qIndex]) {
                                                                const newOpts = [...(nQ[qIndex].options || [])];
                                                                newOpts[optIndex] = e.target.value;
                                                                nQ[qIndex] = { ...nQ[qIndex], options: newOpts }; 
                                                            }
                                                            setEditingQuiz({...editingQuiz!, questions: nQ});
                                                        }} placeholder={`Đáp án ${optIndex+1}`} />
                                                        <span className="exam-print-only" style={{display: 'none'}}>{opt}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div>
                                                <input className="no-print" value={q.correctAnswer as string} onChange={(e: any) => {
                                                    const nQ = [...(editingQuiz!.questions || [])]; 
                                                    if(nQ[qIndex]) nQ[qIndex] = { ...nQ[qIndex], correctAnswer: e.target.value }; 
                                                    setEditingQuiz({...editingQuiz!, questions: nQ});
                                                }} style={{marginBottom: 10}} placeholder="Nhập đáp án đúng (các đáp án thay thế cách nhau bằng dấu /)..." />
                                                <div className="exam-print-only" style={{display: 'none', borderBottom: '1px solid #000', width: '100%', height: 30}}></div>
                                            </div>
                                        )}
                                    </div>
                                )})}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div style={{display: 'grid', gap: 15, padding: 24}}>
                        {quizzes.sort((a,b) => {
                            if(sortQuiz === "OLD") return (a.scheduledStart||"").localeCompare(b.scheduledStart||"");
                            if(sortQuiz === "AZ") return a.title.localeCompare(b.title);
                            return (b.scheduledStart||"").localeCompare(a.scheduledStart||"");
                        }).map(q => {
                            if (!q) return null;
                            const isSelected = selectedQuizzes.includes(q.id);
                            const attemptCount = quizResults.filter(r => r && r.quizId === q.id).length;
                            const targetCount = q.audience === "SPECIFIC" ? (q.targetStudentIds?.length || 0) : students.length;
                            const compRate = targetCount > 0 ? Math.round((attemptCount / targetCount) * 100) : 0;

                            return (
                            <div key={q.id} style={{background: isSelected ? `${C.warn}10` : C.bg, padding: 20, borderRadius: 12, border: `1px solid ${isSelected ? C.warn : C.border}`, position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10}}>
                                <input type="checkbox" checked={isSelected} onChange={(e: any) => {
                                    if(e.target.checked) setSelectedQuizzes([...selectedQuizzes, q.id]);
                                    else setSelectedQuizzes(selectedQuizzes.filter(id => id !== q.id));
                                }} style={{position: 'absolute', top: 20, left: -25, width: 16, height: 16}} />
                                <div>
                                    <div style={{fontWeight: 900, fontSize: 16}}>
                                        {q.tag && <span style={{fontSize: 10, background: C.accent, color: '#fff', padding: '2px 6px', borderRadius: 4, marginRight: 5}}>{q.tag}</span>}
                                        {q.title} {q.passcode && <span title="Có yêu cầu mật khẩu">🔒</span>}
                                        {q.isSEBRequired && <span title="Yêu cầu Safe Exam Browser" style={{marginLeft: 5}}>🛡️</span>}
                                    </div>
                                    <div style={{fontSize: 12, color: C.sub, marginTop: 5}}>
                                        {q.type} • {q.timeLimit} phút • {(q.questions || []).length} câu • Giới hạn: {q.maxAttempts || 1} lần • Giao cho: <span style={{fontWeight:800, color: C.accent}}>{q.audience === "SPECIFIC" ? `${q.targetStudentIds?.length || 0} HS cụ thể` : "Tất cả"}</span>
                                    </div>
                                    <div style={{fontSize: 11, color: C.succ, marginTop: 5, fontWeight: 700}}>Đã làm: {attemptCount} lượt ({compRate}%)</div>
                                    {q.internalNote && <div style={{fontSize: 11, color: C.warn, marginTop: 4}}>📝 Note: {q.internalNote}</div>}
                                </div>
                                <div style={{display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap'}}>
                                    <label style={{fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5, marginRight: 15}}>
                                        <input type="checkbox" checked={q.isLocked || false} onChange={(e: any) => {
                                            const nx = quizzes.map(x => x && x.id === q.id ? {...x, isLocked: e.target.checked} : x);
                                            setQuizzes(nx as Quiz[]); syncData({quizzes: nx});
                                        }} style={{width: 'auto'}} />
                                        Khóa đề (Block)
                                    </label>
                                    <label style={{fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5, marginRight: 15}}>
                                        <input type="checkbox" checked={q.active} onChange={(e: any) => {
                                            const nx = quizzes.map(x => x && x.id === q.id ? {...x, active: e.target.checked} : x);
                                            setQuizzes(nx as Quiz[]); syncData({quizzes: nx});
                                        }} style={{width: 'auto'}} />
                                        Mở thi (Public)
                                    </label>
                                    <button onClick={() => startExam(q, true, false)} style={{background: `${C.accent}20`, color: C.accent, padding: '8px 16px'}}>👁️ Thi thử</button>
                                    <button onClick={() => handleExportExamKey(q)} style={{background: `${C.succ}20`, color: C.succ, padding: '8px 16px'}}>🔑 Tải Key</button>
                                    <button onClick={() => setKeyEditingQuiz(q)} style={{background: `${C.warn}20`, color: C.warn, padding: '8px 16px'}}>🔑 Sửa Key</button>
                                    <button onClick={() => duplicateQuiz(q)} style={{background: `${C.succ}20`, color: C.succ, padding: '8px 16px'}}>Nhân bản</button>
                                    <button onClick={() => handleRecalculateScores(q.id)} style={{background: `${C.warn}20`, color: C.warn, padding: '8px 16px'}} title="Tính lại điểm mọi bài thi dựa trên Key mới nhất">🔄 Chấm lại</button>
                                    <button onClick={() => setEditingQuiz(q)} style={{background: `${C.accent}20`, color: C.accent, padding: '8px 16px'}}>Sửa đề</button>
                                </div>
                            </div>
                        )})}
                        {quizzes.length === 0 && <div style={{textAlign: 'center', color: C.sub, padding: 30}}>Chưa có đề thi nào trong ngân hàng.</div>}
                    </div>
                )}
            </div>
        )}

        {/* ================= LIVE ARENA ================= */}
        {activeTab === "LIVE_ARENA" && (
          <div style={{ display: "grid", gap: 24 }}>
            <div className="card" style={{ background: `linear-gradient(135deg, #111, #1A1A1A)`, color: '#fff', border: `1px solid ${C.accent}` }}>
               <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 10}}>
                   <h2 style={{marginTop: 0, margin: 0, display: 'flex', alignItems: 'center', gap: 10}}>
                       <span style={{animation: 'pulseFast 1s infinite'}}>🔴</span> LIVE EXAM ARENA
                   </h2>
                   <div style={{fontSize: 14, fontWeight: 800, color: C.accent, background: `${C.accent}20`, padding: '8px 16px', borderRadius: 20}}>
                       {(Array.isArray(liveSessions) ? liveSessions : []).filter(s => getRealTime() - (s?.lastUpdate || 0) < 30000).length} Học viên đang online
                   </div>
               </div>
               
               <div style={{display: 'grid', gap: 15}}>
                   {liveSessions.filter(s => getRealTime() - s.lastUpdate < 30000).sort((a,b) => b.progressPct - a.progressPct).map(session => (
                       <div key={session.id} style={{background: 'rgba(255,255,255,0.05)', padding: 20, borderRadius: 10, border: `1px solid rgba(255,255,255,0.1)`, position: 'relative', overflow: 'hidden'}}>
                           {/* Hiệu ứng nhấp nháy đỏ báo hiệu gian lận */}
                           {session.isCheating && <div style={{position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(255,0,0,0.1)', animation: 'pulseFast 1s infinite', pointerEvents: 'none'}} />}
                           
                           <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: 15, position: 'relative', zIndex: 2}}>
                               <div>
                                   <div style={{fontWeight: 900, fontSize: 18, color: '#fff'}}>{session.studentName}</div>
                                   <div style={{fontSize: 13, color: '#aaa', marginTop: 5}}>📝 Đề thi: {session.quizTitle}</div>
                               </div>
                               <div style={{textAlign: 'right'}}>
                                   <div style={{fontSize: 24, fontWeight: 900, color: session.progressPct >= 100 ? C.succ : C.accent}}>{session.progressPct}%</div>
                                   <div style={{fontSize: 12, color: '#aaa', marginTop: 5}}>Đã làm {session.answeredCount}/{session.totalQ} câu</div>
                               </div>
                           </div>
                           
                           {/* Thanh tiến trình (Progress Bar) */}
                           <div style={{height: 12, background: 'rgba(255,255,255,0.1)', borderRadius: 6, overflow: 'hidden', marginBottom: 10, position: 'relative', zIndex: 2}}>
                               <div style={{width: `${session.progressPct}%`, height: '100%', background: session.progressPct >= 100 ? C.succ : C.accent, transition: 'width 1s ease-in-out'}} />
                           </div>
                           
                           {/* Cảnh báo gian lận */}
                           {session.isCheating && (
                               <div style={{fontSize: 12, color: C.err, fontWeight: 900, display: 'flex', alignItems: 'center', gap: 5, marginTop: 10}}>
                                   ⚠️ HỆ THỐNG PHÁT HIỆN GIAN LẬN: Ứng viên vừa chuyển Tab / Thoát toàn màn hình!
                               </div>
                           )}
                       </div>
                   ))}
                   
                   {liveSessions.filter(s => getRealTime() - s.lastUpdate < 30000).length === 0 && (
                       <div style={{textAlign: 'center', padding: 50, color: '#666', fontStyle: 'italic', background: 'rgba(255,255,255,0.02)', borderRadius: 10}}>
                           <div style={{fontSize: 40, marginBottom: 15}}>💤</div>
                           Hiện tại không có học viên nào đang làm bài thi.
                       </div>
                   )}
               </div>
            </div>
          </div>
        )}

        {/* ================= ACADEMICS ================= */}
        {activeTab === "ACADEMICS" && (
          <div style={{ display: "grid", gridTemplateColumns: window.innerWidth > 768 ? "1fr 1fr" : "1fr", gap: 24 }}>
            
            <div style={{display: 'grid', gap: 24, height: 'fit-content'}}>
                <div className="card">
                <h2 style={{marginTop:0, fontSize: 16}}>🎯 TÍNH ĐIỂM NHANH (BAND SCORE)</h2>
                <div style={{display:'flex', gap: 10, alignItems:'center', marginBottom: 20}}>
                    <input type="number" placeholder="Số câu đúng (VD: 32)..." value={calcScore === "" ? "" : calcScore} onChange={(e: any)=>setCalcScore(e.target.value === "" ? "" : Number(e.target.value))} style={{fontSize: 16}} />
                    <div style={{fontWeight: 900, fontSize: 24, color: C.sub}}>/ 40</div>
                </div>
                <div style={{background: C.bg, padding: "30px 20px", borderRadius: 12, textAlign: 'center', border: `1px solid ${C.border}`}}>
                    <div style={{fontSize:11, fontWeight: 800, color: C.sub}}>BAND SCORE ESTIMATED</div>
                    <div style={{fontSize: 56, fontWeight: 900, color: C.accent, margin: '10px 0', lineHeight: 1}}>
                    {calcScore === "" ? "-" : getIeltsBand(Number(calcScore), 40)}
                    </div>
                </div>
                </div>

                <div className="card">
                <h2 style={{marginTop:0, fontSize: 16}}>🏆 TOP HỌC VIÊN CÀY CUỐC</h2>
                <div style={{ display: "grid", gap: 12 }}>
                    {[...students].sort((a,b)=>(b.exp||0)-(a.exp||0)).slice(0,4).map((s,i) => {
                    if (!s) return null;
                    return (
                    <div key={s.id} style={{display:'flex', justifyContent:'space-between', padding: 15, background: C.bg, borderRadius: 10, alignItems: 'center', border: `1px solid ${C.border}`}}>
                        <div style={{display: 'flex', alignItems: 'center', gap: 15}}>
                        <div style={{fontSize: 20}}>{i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "👏"}</div>
                        <div>
                            <div style={{fontWeight: 800, fontSize: 14}}>{s.name}</div>
                            <div style={{fontSize: 11, color: C.sub, marginTop: 4}}>{getGamificationBadge(s.level || 1)} Lv.{s.level || 1}</div>
                        </div>
                        </div>
                        <div style={{fontWeight: 900, color: C.accent, fontSize: 14}}>{s.exp || 0} EXP</div>
                    </div>
                    )})}
                </div>
                </div>
                
                {Object.keys(bandStats).length > 0 && (
                    <div className="card">
                        <h2 style={{marginTop:0, fontSize: 16}}>📈 PHỔ ĐIỂM (BAND DISTRIBUTION)</h2>
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                            {Object.entries(bandStats).sort((a,b) => Number(b[0]) - Number(a[0])).map(([band, count]) => (
                                <div key={band} style={{background: `${C.succ}15`, border: `1px solid ${C.succ}40`, padding: '8px 12px', borderRadius: 8, flex: 1, minWidth: '80px', textAlign: 'center'}}>
                                    <div style={{fontSize: 11, fontWeight: 800, color: C.sub}}>BAND {band}</div>
                                    <div style={{fontSize: 20, fontWeight: 900, color: C.succ}}>{count} <span style={{fontSize:10}}>bài</span></div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <div className="card">
                    <h2 style={{marginTop:0, fontSize: 16}}>📌 IELTS BAND DESCRIPTORS</h2>
                    <div style={{fontSize: 13, display: 'grid', gap: 8, color: C.sub}}>
                        <div style={{display:'flex', justifyContent:'space-between'}}><b style={{color: C.text}}>9.0</b> Expert User</div>
                        <div style={{display:'flex', justifyContent:'space-between'}}><b style={{color: C.text}}>8.0</b> Very Good User</div>
                        <div style={{display:'flex', justifyContent:'space-between'}}><b style={{color: C.text}}>7.0</b> Good User</div>
                        <div style={{display:'flex', justifyContent:'space-between'}}><b style={{color: C.text}}>6.0</b> Competent User</div>
                        <div style={{display:'flex', justifyContent:'space-between'}}><b style={{color: C.text}}>5.0</b> Modest User</div>
                    </div>
                </div>
            </div>

            <div className="card" style={{gridColumn: window.innerWidth > 768 ? '1 / -1' : '1'}}>
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 15, marginBottom: 20}}>
                    <h2 style={{marginTop:0, fontSize: 16, margin: 0}}>📊 KẾT QUẢ BÀI THI & GIÁM SÁT</h2>
                    <div style={{display: 'flex', gap: 10}}>
                        {selectedResults.length > 0 && <button onClick={handleBulkDeleteResults} style={{background: C.err, color: '#fff', padding: '8px 16px', fontSize: 12}}>🗑 XÓA ĐÃ CHỌN ({selectedResults.length})</button>}
                        <button onClick={exportQuizResultsCSV} style={{background: C.succ, color: '#fff', padding: '8px 16px', fontSize: 12}}>⬇️ XUẤT EXCEL TỔNG</button>
                    </div>
                </div>

                <div style={{display: 'grid', gridTemplateColumns: window.innerWidth > 600 ? '1fr 1fr 1fr' : '1fr', gap: 10, marginBottom: 20, padding: 15, background: C.bg, borderRadius: 8, border: `1px solid ${C.border}`}}>
                    <div style={{gridColumn: window.innerWidth > 600 ? '1 / -1' : '1', marginBottom: 5}}>
                        <label style={{fontSize: 10, fontWeight: 800, color: C.sub}}>🔍 TÌM THEO TÊN HỌC VIÊN</label>
                        <input placeholder="Nhập tên học sinh..." value={resultSearch} onChange={(e: any)=>setResultSearch(e.target.value)} style={{background: C.card, border: `1px solid ${C.accent}`}} />
                    </div>
                    <div>
                        <label style={{fontSize: 10, fontWeight: 800, color: C.sub}}>LỌC THEO HỌC VIÊN</label>
                        <select value={resFilterStudent} onChange={(e: any)=>setResFilterStudent(e.target.value)}>
                            <option value="">Tất cả học viên</option>
                            {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label style={{fontSize: 10, fontWeight: 800, color: C.sub}}>LỌC THEO ĐỀ THI</label>
                        <select value={resFilterQuiz} onChange={(e: any)=>setResFilterQuiz(e.target.value)}>
                            <option value="">Tất cả đề thi</option>
                            {quizzes.map(q => <option key={q.id} value={q.id}>{q.title}</option>)}
                        </select>
                        {avgFilteredQuizScore && resFilterQuiz && <div style={{fontSize: 11, color: C.succ, marginTop: 4, fontWeight: 800}}>Điểm trung bình đề này: {avgFilteredQuizScore}</div>}
                    </div>
                    <div>
                        <label style={{fontSize: 10, fontWeight: 800, color: C.sub}}>LỌC THEO BAND ĐIỂM</label>
                        <select value={resFilterBand} onChange={(e: any)=>setResFilterBand(e.target.value)}>
                            <option value="">Tất cả Band</option>
                            <option value=">=7.0">Band 7.0 trở lên</option>
                            <option value="<6.0">Dưới Band 6.0</option>
                        </select>
                    </div>
                </div>

                <div style={{display: 'grid', gap: 15}}>
                    {filteredQuizResults.map(r => {
                        if (!r) return null;
                        const durationStr = r.durationSeconds ? `${Math.floor(r.durationSeconds/60)} phút ${r.durationSeconds%60} giây` : "N/A";
                        const copyText = `Kết quả thi IELTS CBT\nHọc viên: ${r.studentName}\nĐề: ${r.quizTitle}\nĐiểm: ${r.score}/${r.total} (Band ${r.band})\nThời gian làm: ${durationStr}`;
                        const isSelected = selectedResults.includes(r.id);

                        return (
                        <div key={r.id} style={{padding: 20, background: isSelected ? `${C.warn}10` : C.bg, borderRadius: 12, border: `1px solid ${isSelected ? C.warn : C.border}`, borderLeft: `6px solid ${C.accent}`, position: 'relative'}}>
                            <input 
                                type="checkbox" 
                                checked={isSelected} 
                                onChange={(e: any) => {
                                    if(e.target.checked) setSelectedResults([...selectedResults, r.id]);
                                    else setSelectedResults(selectedResults.filter(id => id !== r.id));
                                }}
                                style={{position: 'absolute', top: 20, left: -25, width: 16, height: 16}}
                            />
                            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 15}}>
                                <div>
                                    <div style={{fontWeight: 900, fontSize: 16}}>{r.studentName}</div>
                                    <div style={{fontSize: 13, marginTop: 4, fontWeight: 700}}>{r.quizTitle}</div>
                                </div>
                                <div style={{textAlign: 'right'}}>
                                    <div style={{fontSize: 24, fontWeight: 900, color: C.accent}}>{r.score}/{r.total}</div>
                                    <div style={{fontSize: 12, fontWeight: 800, color: C.sub}}>Band {r.band}</div>
                                </div>
                            </div>
                            
                            <div style={{marginTop: 15, padding: 12, background: C.card, borderRadius: 8, fontSize: 12, display: 'grid', gridTemplateColumns: window.innerWidth > 600 ? '1fr 1fr' : '1fr', gap: 8, border: `1px solid ${C.border}`}}>
                                <div>🕒 Bắt đầu: <b>{r.startTime || "N/A"}</b></div>
                                <div>🏁 Kết thúc: <b>{r.endTime || "N/A"}</b></div>
                                <div>⏱ Thời gian: <b>{durationStr}</b></div>
                                <div>🌐 IP Mạng: <b>{r.ipAddress || "N/A"}</b></div>
                                <div style={{gridColumn: '1 / -1', color: C.sub}}>💻 Thiết bị: {r.deviceInfo || "N/A"}</div>
                                
                                {r.cheatCount > 0 ? (
                                    <div style={{gridColumn: '1 / -1', color: C.err, fontWeight: 800, background: `${C.err}15`, padding: '6px 10px', borderRadius: 4}}>⚠️ Cảnh báo: Phát hiện {r.cheatCount} lần rời khỏi màn hình thi!</div>
                                ) : (
                                    <div style={{gridColumn: '1 / -1', color: C.succ, fontWeight: 800}}>✅ Không phát hiện gian lận.</div>
                                )}
                            </div>

                            <div style={{marginTop: 15}}>
                                <label style={{fontSize: 10, fontWeight: 800, color: C.sub}}>NHẬN XÉT DÀNH CHO HỌC VIÊN NÀY:</label>
                                <div style={{display: 'flex', gap: 10, marginTop: 5}}>
                                    <input 
                                        type="text" 
                                        placeholder="Nhập nhận xét..." 
                                        defaultValue={r.teacherFeedback || ""} 
                                        onBlur={(e: any) => {
                                            if (e.target.value !== r.teacherFeedback) {
                                                const nx = quizResults.map(x => x.id === r.id ? {...x, teacherFeedback: e.target.value} : x);
                                                setQuizResults(nx); syncData({ quizResults: nx });
                                            }
                                        }}
                                        style={{background: C.card}}
                                    />
                                    <button onClick={() => handleVoiceFeedback(r.id)} style={{background: '#FFE066', color: '#000', padding: '0 12px'}} title="Nhập bằng giọng nói (Yêu cầu Chrome)">🎤</button>
                                    <button onClick={() => copyToClipboard(copyText)} style={{background: `${C.accent}15`, color: C.accent, padding: '0 15px', whiteSpace: 'nowrap'}}>📋 Copy Zalo</button>
                                </div>
                                <div style={{display: 'flex', gap: 5, marginTop: 5, flexWrap: 'wrap'}}>
                                    {["Sai chính tả nhiều", "Phân bổ thời gian chưa tốt", "Cần luyện thêm Multiple Choice", "Very good!"].map(ft => (
                                        <button key={ft} onClick={() => {
                                            const nx = quizResults.map(x => x.id === r.id ? {...x, teacherFeedback: (x.teacherFeedback ? x.teacherFeedback + " " : "") + ft} : x);
                                            setQuizResults(nx); syncData({ quizResults: nx });
                                        }} style={{fontSize: 10, padding: '4px 8px', background: C.bg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 4}}>{ft}</button>
                                    ))}
                                </div>
                            </div>
                            
                            <div style={{display: 'flex', gap: 10, marginTop: 15, paddingTop: 15, borderTop: `1px dashed ${C.border}`}}>
                                <button onClick={() => exportDetailedQuizResult(r)} style={{background: C.succ, color: '#fff', fontSize: 11, padding: '6px 12px'}}>📊 Xuất Excel Chấm Câu</button>
                                <button onClick={() => {
                                    if(r.ipAddress && confirm(`Bạn có chắc muốn cấm IP ${r.ipAddress} làm bài?`)) {
                                        const nx = [...bannedIps, r.ipAddress];
                                        setBannedIps(nx); syncData({bannedIps: nx});
                                    }
                                }} style={{background: C.bg, color: C.err, border: `1px solid ${C.border}`, fontSize: 11, padding: '6px 12px'}}>🚫 Cấm IP</button>
                                <button onClick={() => {
                                    if(confirm("Xác nhận hủy và xóa bài thi này?")) {
                                        const nx = quizResults.filter(x => x.id !== r.id);
                                        setQuizResults(nx); syncData({quizResults: nx});
                                    }
                                }} style={{background: C.bg, color: C.err, border: `1px solid ${C.border}`, fontSize: 11, padding: '6px 12px', marginLeft: 'auto'}}>🗑 Hủy bài</button>
                            </div>
                        </div>
                    )})}
                    {filteredQuizResults.length === 0 && <div style={{textAlign: 'center', color: C.sub, padding: 30}}>Không tìm thấy kết quả nào phù hợp.</div>}
                </div>
            </div>
          </div>
        )}

        {/* ================= STUDENTS ================= */}
        {activeTab === "STUDENTS" && (
          <div style={{ display: "grid", gap: 24 }}>
            <div className="card" style={{ borderLeft: `4px solid ${C.accent}` }}>
                <h3 style={{marginTop: 0, display: 'flex', alignItems: 'center', gap: 8}}>🔔 Gửi Thông Báo Hệ Thống (Push Notification)</h3>
                <div style={{display: 'grid', gridTemplateColumns: window.innerWidth > 600 ? '1fr 1fr 1fr auto' : '1fr', gap: 15, alignItems: 'end'}}>
                    <div>
                        <label style={{fontSize:10, fontWeight:800, color:C.sub}}>ĐỐI TƯỢNG NHẬN</label>
                        <select value={pushTarget} onChange={e => setPushTarget(e.target.value)}>
                            <option value="ALL">Tất cả học viên</option>
                            {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label style={{fontSize:10, fontWeight:800, color:C.sub}}>TIÊU ĐỀ THÔNG BÁO</label>
                        <input placeholder="VD: Lịch học gấp..." value={pushTitle} onChange={e => setPushTitle(e.target.value)} />
                    </div>
                    <div>
                        <label style={{fontSize:10, fontWeight:800, color:C.sub}}>NỘI DUNG</label>
                        <input placeholder="VD: Tối nay 8h học bù nhé..." value={pushBody} onChange={e => setPushBody(e.target.value)} />
                    </div>
                    <button onClick={handleSendPush} style={{background: C.accent, color: '#fff', padding: '10px 20px', height: 40}}>GỬI THÔNG BÁO</button>
                </div>
                <div style={{fontSize: 11, color: C.warn, marginTop: 10, fontStyle: 'italic'}}>* Thông báo sẽ hiển thị trực tiếp trên màn hình thiết bị (điện thoại/máy tính) của học sinh ngay khi họ truy cập web. Yêu cầu học sinh bấm Cấp Quyền (Allow Notifications) trên trình duyệt.</div>
            </div>

            <div className="card">
              <h3>{editStId ? "📝 Chỉnh sửa học viên" : "👤 Thêm học viên mới"}</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                <div><label style={{fontSize:10, fontWeight:800, color:C.sub}}>HỌ TÊN</label><input value={newSt.name} onChange={(e: any)=>setNewSt({...newSt, name:e.target.value})} /></div>
                <div><label style={{fontSize:10, fontWeight:800, color:C.sub}}>EMAIL ĐĂNG NHẬP</label><input value={newSt.email} onChange={(e: any)=>setNewSt({...newSt, email:e.target.value})} placeholder="hs@gmail.com" /></div>
                <div><label style={{fontSize:10, fontWeight:800, color:C.sub}}>NGÀY SINH (Tùy chọn)</label><input type="date" value={newSt.dob || ""} onChange={(e: any)=>setNewSt({...newSt, dob:e.target.value})} /></div>
                <div><label style={{fontSize:10, fontWeight:800, color:C.sub}}>HỌC PHÍ/H</label><input type="number" value={newSt.rate} onChange={(e: any)=>setNewSt({...newSt, rate:Number(e.target.value)})} /></div>
                <div><label style={{fontSize:10, fontWeight:800, color:C.sub}}>CEFR (NOW)</label><input value={newSt.cefr} onChange={(e: any)=>setNewSt({...newSt, cefr:e.target.value})} /></div>
                <div><label style={{fontSize:10, fontWeight:800, color:C.sub}}>TARGET BAND</label><input value={newSt.target} onChange={(e: any)=>setNewSt({...newSt, target:e.target.value})} /></div>
                {editStId && (
                    <div><label style={{fontSize:10, fontWeight:800, color:C.warn}}>OS COINS (TẶNG/TRỪ XU)</label><input type="number" value={newSt.coins || 0} onChange={(e: any)=>setNewSt({...newSt, coins:Number(e.target.value)})} style={{borderColor: C.warn}} placeholder="Nhập số xu..." /></div>
                )}
                <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                  <button onClick={handleStudentAction} style={{ flex: 1, background: C.accent, color: "#fff", padding: "12px" }}>{editStId ? "CẬP NHẬT" : "THÊM MỚI"}</button>
                  {editStId && <button onClick={() => { setEditStId(null); setNewSt({name:"", rate:300000, target:"6.5", cefr:"B2", email:"", privateMessage: "", dob: ""}); }} style={{ background: C.bg, color: C.text, padding: "12px 20px" }}>Hủy</button>}
                </div>
              </div>
            </div>
            
            <div style={{display: 'flex', alignItems: 'center', gap: 10, background: C.bg, padding: 15, borderRadius: 8, border: `1px solid ${C.border}`, flexWrap: 'wrap'}}>
                <div style={{display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 200}}>
                    <div style={{fontSize: 20}}>🔍</div>
                    <input placeholder="Tìm kiếm học viên theo tên hoặc email..." value={searchSt} onChange={e => setSearchSt(e.target.value)} style={{border: 'none', background: 'transparent', boxShadow: 'none', padding: 0}} />
                </div>
                <select value={sortStudentBy} onChange={(e: any) => setSortStudentBy(e.target.value)} style={{width: 'auto', border: `1px solid ${C.border}`}}>
                    <option value="NAME">Sắp xếp: Tên (A-Z)</option>
                    <option value="EXP">Sắp xếp: Giờ học (EXP)</option>
                    <option value="DEBT">Sắp xếp: Nợ học phí</option>
                </select>
                <label style={{fontSize: 12, fontWeight: 700, color: C.warn, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer'}}>
                    <input type="checkbox" checked={filterUnpaid} onChange={(e) => setFilterUnpaid(e.target.checked)} style={{width: 'auto', margin: 0}} />
                    Chỉ hiện học sinh đang nợ
                </label>
                <button onClick={exportStudentsCSV} style={{background: C.succ, color: '#fff', padding: '8px 15px', fontSize: 12}}>⬇ Xuất CSV</button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 20 }}>
              {[...students].filter(s => s.name.toLowerCase().includes(searchSt.toLowerCase()) || (s.email||"").toLowerCase().includes(searchSt.toLowerCase())).filter(s => {
                  if (!filterUnpaid) return true;
                  const stUnpaid = history.filter(h => h && h.studentId === s.id && !h.isPaid).reduce((sum, h) => sum + (h.earnings || 0), 0);
                  return stUnpaid > 0;
              }).sort((a,b) => {
                  if (a.isPinned && !b.isPinned) return -1;
                  if (!a.isPinned && b.isPinned) return 1;
                  if (sortStudentBy === "EXP") return (b.exp || 0) - (a.exp || 0);
                  if (sortStudentBy === "DEBT") {
                      const debtA = history.filter(h => h.studentId === a.id && !h.isPaid).reduce((s, h) => s + (h.earnings || 0), 0);
                      const debtB = history.filter(h => h.studentId === b.id && !h.isPaid).reduce((s, h) => s + (h.earnings || 0), 0);
                      return debtB - debtA;
                  }
                  return a.name.localeCompare(b.name);
              }).map(s => {
                if (!s) return null;
                const stUnpaid = history.filter(h => h && h.studentId === s.id && !h.isPaid).reduce((sum, h) => sum + (h.earnings || 0), 0);
                
                const sResults = quizResults.filter(r => r.studentId === s.id).sort((a,b) => b.date.localeCompare(a.date));
                const sTrend = sResults.length >= 2 ? (Number(sResults[0].band) >= Number(sResults[1].band) ? '🔥' : '📉') : '';

                return (
                <div key={s.id} className="card" style={{ position: "relative", display: 'flex', flexDirection: 'column', justifyContent: 'space-between', border: s.isPinned ? `2px solid ${C.accent}` : `1px solid ${C.border}` }}>
                  <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10}}>
                      <div style={{ fontSize: 18, fontWeight: 900, paddingRight: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                          <button onClick={() => { const nx = students.map(x => x.id === s.id ? {...x, isPinned: !x.isPinned} : x); setStudents(nx); syncData({students: nx}); }} style={{background: 'transparent', border: 'none', fontSize: 16, padding: 0}} title="Ghim học viên">{s.isPinned ? '📌' : '📍'}</button>
                          {getAvatar(s.name)}
                          <div>
                              {s.name} {sTrend}
                              {s.dob && <span style={{fontSize: 11, color: C.sub, fontWeight: 500, display: 'block'}}>{getAge(s.dob)}</span>}
                          </div>
                      </div>
                      <div style={{ background: C.bg, padding: "4px 10px", borderRadius: 20, fontSize: 11, fontWeight: 900, border: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>{getGamificationBadge(s.level || 1)} Lv.{s.level || 1}</div>
                  </div>
                  <div>
                      <div style={{ fontSize: 12, color: C.sub, marginTop: 5 }}>Level: {s.cefr} • Target: {s.target}</div>
                      <div style={{ fontSize: 12, color: C.accent, marginTop: 5, fontWeight: 600, display: 'flex', gap: 5, alignItems: 'center' }}>
                          {s.email || "Chưa có email"}
                          {s.email && <button onClick={() => copyToClipboard(s.email as string)} style={{background: 'transparent', color: C.accent, padding: 0, fontSize: 12}} title="Copy Email">📋</button>}
                      </div>
                      {stUnpaid > 0 && <div style={{ fontSize: 12, color: C.err, marginTop: 5, fontWeight: 800 }}>Đang nợ: {fmtMoney(stUnpaid)}</div>}
                      
                      <div style={{marginTop: 10}}>
                          <input 
                              type="text" 
                              placeholder="Nhập lời nhắn riêng cho HV này..." 
                              defaultValue={s.privateMessage || ""} 
                              onBlur={(e: any) => {
                                  if (e.target.value !== s.privateMessage) {
                                      const nx = students.map(x => x.id === s.id ? {...x, privateMessage: e.target.value} : x);
                                      setStudents(nx); syncData({students: nx});
                                  }
                              }}
                              style={{fontSize: 11, padding: '6px 10px', background: `${C.warn}10`, border: `1px solid ${C.warn}50`, color: C.warn}}
                          />
                      </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 15, flexWrap: 'wrap' }}>
                    {stUnpaid > 0 && (
                        <div style={{display: 'flex', gap: 5, width: '100%'}}>
                            <button onClick={() => copyToClipboard(`Chào phụ huynh, hiện tại em ${s.name} đang còn khoản học phí chưa thanh toán là ${fmtMoney(stUnpaid)}. Phụ huynh vui lòng hoàn thiện giúp trung tâm nhé!`)} style={{ flex: 1, background: `${C.warn}15`, color: C.warn, fontSize: 11, padding: "6px" }}>Copy SMS</button>
                            <button onClick={() => {
                                if (confirm(`Bạn có chắc muốn gửi CẢNH BÁO ĐỎ tới thẳng màn hình của ${s.name}?\nHọc sinh sẽ bị khóa màn hình cho đến khi bấm Xác nhận.`)) {
                                    const msg = `Chào ${s.name},\n\nHệ thống ghi nhận bạn đang có khoản học phí chưa thanh toán là ${fmtMoney(stUnpaid)}.\n\nVui lòng hoàn thiện sớm để không bị gián đoạn quá trình học và làm bài thi trên nền tảng nhé!`;
                                    const nx = students.map(x => x.id === s.id ? {...x, debtMessage: msg} : x);
                                    setStudents(nx); syncData({students: nx});
                                    alert("Đã gửi cảnh báo đỏ thành công!");
                                }
                            }} style={{ flex: 1, background: C.err, color: '#fff', fontSize: 11, padding: "6px", fontWeight: 700 }}>🚨 Đòi Nợ In-App</button>
                        </div>
                    )}
                    <button onClick={() => { 
                        if(confirm(`Tặng 100 OS Coins cho ${s.name}?`)) {
                            const nx = students.map(x => x.id === s.id ? {...x, coins: (x.coins || 0) + 100} : x);
                            setStudents(nx); syncData({students: nx});
                        }
                    }} style={{ flex: 1, background: `${C.succ}15`, color: C.succ, fontSize: 12, padding: "8px", fontWeight: 700 }}>🎁 Thưởng Xu</button>
                    <button onClick={() => { setEditStId(s.id); setNewSt({...s}); }} style={{ flex: 1, background: `${C.accent}15`, color: C.accent, fontSize: 12, padding: "8px" }}>Sửa</button>
                    <button onClick={() => { if(confirm("Xóa?")){ const nx=students.filter(x=>x && x.id!==s.id); setStudents(nx as Student[]); syncData({students:nx}); } }} style={{ flex: 1, background: `${C.err}15`, color: C.err, fontSize: 12, padding: "8px" }}>Xóa</button>
                  </div>
                </div>
              )})}
            </div>
          </div>
        )}

        {/* ================= FINANCE ================= */}
        {activeTab === "FINANCE" && (
          <div style={{ display: "grid", gap: 24 }}>
            <div className="card" style={{padding: 30}}>
               <h3 style={{marginTop: 0, textAlign: 'center'}}>📊 TỔNG QUAN TÀI CHÍNH</h3>
               <div style={{display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20}}>
                   <div>
                       <div style={{fontSize: 11, fontWeight: 800, color: C.succ, marginBottom: 5}}>TỔNG THU: {fmtMoney(totalRev)}</div>
                       <div style={{height: 12, background: `${C.succ}20`, borderRadius: 6, overflow: 'hidden'}}>
                           <div style={{width: `${revPct}%`, height: '100%', background: C.succ}} />
                       </div>
                   </div>
                   <div>
                       <div style={{fontSize: 11, fontWeight: 800, color: C.err, marginBottom: 5}}>TỔNG CHI: {fmtMoney(totalExp)}</div>
                       <div style={{height: 12, background: `${C.err}20`, borderRadius: 6, overflow: 'hidden'}}>
                           <div style={{width: `${100 - revPct}%`, height: '100%', background: C.err}} />
                       </div>
                   </div>
               </div>
               <div style={{textAlign: 'center', fontSize: 18, borderTop: `1px solid ${C.border}`, paddingTop: 15}}>LÃI RÒNG: <span style={{color: C.accent, fontWeight: 900, fontSize: 28}}>{fmtMoney(stats.net)}</span></div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: window.innerWidth > 768 ? "1fr 1fr" : "1fr", gap: 24 }}>
                <div className="card">
                <h3>Báo cáo Nguồn Thu</h3>
                <div style={{marginBottom: 20}}>
                    {TEACHERS.map(t => (
                        <div key={t} style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", borderBottom: `1px solid ${C.border}` }}>
                        <div><div style={{fontWeight:700, fontSize:14}}>{t}</div><div style={{fontSize:11, color:C.sub}}>{(history.filter(h=>h && h.teacher===t).reduce((s,h)=>s+((h && h.duration)||0),0)/3600).toFixed(1)}h giảng dạy</div></div>
                        <div style={{fontWeight:900, color:C.accent}}>{fmtMoney(history.filter(h=>h && h.teacher===t).reduce((s,h)=>s+((h && h.earnings)||0),0))}</div>
                        </div>
                    ))}
                </div>
                
                <div style={{marginTop: 30, marginBottom: 10, fontWeight: 900}}>Cộng thêm thu nhập đột xuất:</div>
                <div style={{ display: "flex", flexWrap: 'wrap', gap: 10, marginBottom: 20 }}>
                    <input placeholder="Lý do thu..." value={newTrans.title} onChange={(e: any)=>setNewTrans({...newTrans, title:e.target.value})} style={{flex: '1 1 150px'}} />
                    <input type="number" placeholder="Tiền..." value={newTrans.amount || ""} onChange={(e: any)=>setNewTrans({...newTrans, amount:Number(e.target.value)})} style={{flex: '1 1 100px'}} />
                    <button onClick={() => handleAddTransaction("INCOME")} style={{ background: C.succ, color: "#fff", padding: "10px 20px" }}>Lưu</button>
                </div>
                {transactions.filter(t=>t && t.type==="INCOME").map(t => {
                    if (!t) return null;
                    return (
                    <div key={t.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px", background: C.bg, borderRadius: 10, marginBottom: 8 }}>
                    <div><div style={{fontSize:13, fontWeight:700}}>{t.title}</div><div style={{fontSize:11, color: C.sub}}>{t.date}</div></div>
                    <div style={{display: "flex", alignItems: "center", gap: 12}}>
                        <span style={{color:C.succ, fontWeight:800}}>+{fmtMoney(t.amount)}</span>
                        <button onClick={()=>{ const nx=transactions.filter(x=>x && x.id!==t.id); setTransactions(nx as Transaction[]); syncData({transactions:nx}); }} style={{ color: C.err, background: "none", fontSize: 18, padding: 0 }}>×</button>
                    </div>
                    </div>
                )})}

                <div style={{ marginTop: 30, padding: 20, background: C.bg, borderRadius: 15, display:'flex', justifyContent:'space-between' }}>
                    <span style={{fontWeight:900}}>TỔNG THU:</span><span style={{ color: C.succ, fontSize:24, fontWeight:900 }}>{fmtMoney(stats.totalRev)}</span>
                </div>
                </div>
                
                <div className="card">
                <h3>Báo cáo Nguồn Chi</h3>
                <div style={{ display: "flex", flexWrap: 'wrap', gap: 10, marginBottom: 20 }}>
                    <input placeholder="Lý do chi..." value={newTrans.title} onChange={(e: any)=>setNewTrans({...newTrans, title:e.target.value})} style={{flex: '1 1 150px'}} />
                    <input type="number" placeholder="Tiền..." value={newTrans.amount || ""} onChange={(e: any)=>setNewTrans({...newTrans, amount:Number(e.target.value)})} style={{flex: '1 1 100px'}} />
                    <button onClick={() => handleAddTransaction("EXPENSE")} style={{ background: C.err, color: "#fff", padding: "10px 20px" }}>Lưu</button>
                </div>
                {transactions.filter(t=>t && t.type==="EXPENSE").map(t => {
                    if (!t) return null;
                    return (
                    <div key={t.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px", background: C.bg, borderRadius: 10, marginBottom: 8 }}>
                    <div><div style={{fontSize:13, fontWeight:700}}>{t.title}</div><div style={{fontSize:11, color: C.sub}}>{t.date}</div></div>
                    <div style={{display: "flex", alignItems: "center", gap: 12}}>
                        <span style={{color:C.err, fontWeight:800}}>-{fmtMoney(t.amount)}</span>
                        <button onClick={()=>{ const nx=transactions.filter(x=>x && x.id!==t.id); setTransactions(nx as Transaction[]); syncData({transactions:nx}); }} style={{ color: C.err, background: "none", fontSize: 18, padding: 0 }}>×</button>
                    </div>
                    </div>
                )})}
                </div>
            </div>
          </div>
        )}

        {/* ================= HISTORY & REPORT ================= */}
        {activeTab === "HISTORY" && (
           <div style={{ display: "grid", gap: 20 }}>
            <div className="no-print card" style={{ display: "flex", gap: 15, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <label style={{fontSize:12, fontWeight:800}}>LỌC THEO HỌC VIÊN ĐỂ IN BÁO CÁO</label>
                <select value={selStudent} onChange={(e: any)=>setSelStudent(e.target.value)}>
                  <option value="">Tất cả</option>
                  {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              {selectedSessions.length > 0 && <button onClick={handleBulkDeleteHistory} style={{ background: C.err, color: "#fff", padding: "12px 24px" }}>🗑 XÓA ({selectedSessions.length})</button>}
              <button onClick={() => {
                  if(!selStudent) { alert("Vui lòng chọn 1 học sinh cụ thể để in báo cáo Report Card!"); return; }
                  window.print();
              }} style={{ padding: "12px 24px", background: "#000", color: "#fff" }}>🖨 IN BÁO CÁO (PDF)</button>
              <button onClick={exportCSV} style={{ padding: "12px 24px", background: C.succ, color: "#fff" }}>📊 XUẤT EXCEL</button>
            </div>
            
            <div className="no-print card" style={{ background: `linear-gradient(135deg, ${C.accent}, #1E3A8A)`, color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{fontSize: 12, opacity: 0.8, fontWeight: 700}}>TỔNG GIỜ DẠY</div>
                <div style={{fontSize: 24, fontWeight: 900}}>{currentViewHours.toFixed(1)}h</div>
              </div>
              <div style={{textAlign: 'right'}}>
                <div style={{fontSize: 12, opacity: 0.8, fontWeight: 700}}>TỔNG THU NHẬP</div>
                <div style={{fontSize: 24, fontWeight: 900}}>{fmtMoney(currentViewEarnings)}</div>
              </div>
            </div>

            {/* RADAR KỸ NĂNG */}
            {Object.keys(teacherSkillStats).length > 0 && (
                <div className="no-print card" style={{marginBottom: 20}}>
                <h3 style={{marginTop: 0}}>Phân bổ thời gian theo kỹ năng</h3>
                <div style={{display: 'flex', gap: 10, flexWrap: 'wrap'}}>
                    {Object.entries(teacherSkillStats).map(([sk, time]) => (
                    <div key={sk} style={{background: C.bg, border: `1px solid ${C.border}`, padding: '8px 12px', borderRadius: 8}}>
                        <div style={{fontSize: 11, fontWeight: 800, color: C.sub}}>{sk}</div>
                        <div style={{fontSize: 15, fontWeight: 900, color: C.accent}}>{((time as number)/3600).toFixed(1)}h</div>
                    </div>
                    ))}
                </div>
                </div>
            )}

            <div className="no-print" style={{display: 'grid', gap: 15}}>
              {filteredHistory.map(h => {
                if (!h) return null;
                const isSelected = selectedSessions.includes(h.id.toString());
                return (
                <div key={h.id} className="card" style={{ position: 'relative', borderLeft: `8px solid ${h.isPaid ? C.succ : C.warn}`, background: isSelected ? `${C.warn}10` : C.card, border: isSelected ? `1px solid ${C.warn}` : `1px solid ${C.border}` }}>
                  <input 
                      type="checkbox" 
                      checked={isSelected} 
                      onChange={(e: any) => {
                          if(e.target.checked) setSelectedSessions([...selectedSessions, h.id.toString()]);
                          else setSelectedSessions(selectedSessions.filter(id => id !== h.id.toString()));
                      }}
                      style={{position: 'absolute', top: 20, left: -25, width: 16, height: 16}}
                  />
                  <div style={{display: 'grid', gridTemplateColumns: window.innerWidth > 600 ? '1fr 1fr 1fr 1fr' : '1fr 1fr', gap: 15, marginBottom: 15}}>
                    <div><div style={{fontSize: 10, color: C.sub, fontWeight: 800}}>HỌC VIÊN</div><div style={{fontWeight: 700}}>{h.studentName}</div></div>
                    <div><div style={{fontSize: 10, color: C.sub, fontWeight: 800}}>NGÀY</div><div style={{fontWeight: 700}}>{h.date}</div></div>
                    <div><div style={{fontSize: 10, color: C.sub, fontWeight: 800}}>GIÁO VIÊN</div><div style={{fontWeight: 700}}>{h.teacher}</div></div>
                    <div><div style={{fontSize: 10, color: C.sub, fontWeight: 800}}>HỌC PHÍ</div><div style={{fontWeight: 700}}>{fmtMoney(h.earnings)}</div></div>
                  </div>
                  
                  <div>
                     <div style={{fontSize: 10, color: C.sub, fontWeight: 800, marginBottom: 8}}>NHẬN XÉT CỦA GIÁO VIÊN</div>
                     <textarea value={h.notes || ""} onChange={(e: any) => { const nx=history.map(x=>x && x.id===h.id?{...x,notes:e.target.value}:x); setHistory(nx as Session[]); }} onBlur={() => syncData({history})} style={{height: 80, fontSize: 13, background: C.bg, border: 'none'}} placeholder="Nhập nhận xét chi tiết..." />
                     <div style={{display: 'flex', gap: 5, marginTop: 8, flexWrap: 'wrap'}}>
                         {QUICK_NOTES.map((qn: string) => (
                             <button key={qn} onClick={() => { const nx=history.map(x=>x && x.id===h.id?{...x,notes: (x.notes ? x.notes + ". " : "") + qn}:x); setHistory(nx as Session[]); syncData({history:nx}); }} style={{fontSize: 10, padding: '4px 8px', background: C.card, border: `1px solid ${C.border}`, color: C.text}}>{qn}</button>
                         ))}
                     </div>
                  </div>

                  <div style={{textAlign:'right', marginTop:20, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 15}}>
                     {!h.isPaid ? (
                         <button onClick={() => { 
                             const nxHistory = history.map(x => x && x.id === h.id ? { ...x, isPaid: true } : x); 
                             
                             // Tự động gỡ "Lệnh đòi nợ" nếu học sinh đã thanh toán hết các buổi
                             const remainingDebt = nxHistory.filter(session => session.studentId === h.studentId && !session.isPaid).reduce((sum, session) => sum + (session.earnings || 0), 0);
                             let nxStudents = students;
                             if (remainingDebt <= 0) {
                                 nxStudents = students.map(s => s.id === h.studentId ? { ...s, debtMessage: undefined } : s);
                                 setStudents(nxStudents);
                             }
                             
                             setHistory(nxHistory as Session[]); 
                             syncData({ history: nxHistory, students: nxStudents }); 
                         }} style={{background: `${C.warn}20`, color: C.warn, fontSize: 12, padding: '6px 12px', border: `1px solid ${C.warn}`}}>Thu tiền nhanh 💰</button>
                     ) : (
                         <button onClick={() => { const nx=history.map(x=>x && x.id===h.id?{...x,isPaid:false}:x); setHistory(nx as Session[]); syncData({history:nx}); }} style={{background: `${C.succ}20`, color: C.succ, fontSize: 12, padding: '6px 12px', border: `1px solid ${C.succ}`}}>Đã thu tiền ✔️</button>
                     )}
                     <button onClick={() => { if(confirm("Xóa?")){ const nx=history.filter(x=>x && x.id!==h.id); setHistory(nx as Session[]); syncData({history:nx}); } }} style={{ background: "none", color: C.err, fontSize: 11 }}>🗑 Xóa buổi</button>
                  </div>
                </div>
              )})}
              {filteredHistory.length === 0 && <div style={{textAlign: "center", color: C.sub, padding: 40}}>Không có lịch sử nào phù hợp.</div>}
            </div>

            {/* UNIFIED PROGRESS REPORT (Chỉ hiện khi In) */}
            <div className="print-area">
                {selStudent && students.find(s=>s.id === selStudent) ? (() => {
                    const st = students.find(s=>s.id === selStudent)!;
                    const stHistory = history.filter(h => h.studentId === st.id);
                    const totalSecs = stHistory.reduce((s, h) => s + (h.duration || 0), 0);
                    return (
                        <div className="unified-report">
                            <div className="report-header">
                                <h1 className="report-title">IELTS ACADEMIC PROGRESS REPORT</h1>
                                <div className="report-subtitle">Official Learning Record • IELTS Workspace</div>
                            </div>
                            
                            <div className="student-meta">
                                <div>
                                    <div className="meta-label">Student Name</div>
                                    <div style={{fontSize: 18, fontWeight: 800}}>{st.name}</div>
                                </div>
                                <div>
                                    <div className="meta-label">Current Level / Target</div>
                                    <div style={{fontSize: 18, fontWeight: 800}}>{st.cefr || "N/A"} ➞ {st.target || "N/A"}</div>
                                </div>
                                <div>
                                    <div className="meta-label">Total Training Hours</div>
                                    <div style={{fontSize: 16, fontWeight: 800}}>{(totalSecs / 3600).toFixed(1)} Hours</div>
                                </div>
                                <div>
                                    <div className="meta-label">Report Date</div>
                                    <div style={{fontSize: 16, fontWeight: 800}}>{new Date().toLocaleDateString('vi-VN')}</div>
                                </div>
                            </div>

                            <div className="meta-label" style={{marginBottom: 10}}>SESSION LOGS</div>
                            <table className="session-table">
                                <thead>
                                    <tr>
                                        <th>Date</th>
                                        <th>Instructor</th>
                                        <th>Skills Covered</th>
                                        <th>Duration</th>
                                        <th>Teacher's Notes</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {stHistory.map(h => (
                                        <tr key={h.id}>
                                            <td style={{whiteSpace: 'nowrap'}}>{h.date.split(' ')[1] || h.date}</td>
                                            <td>{h.teacher.split(' ')[h.teacher.split(' ').length-1]}</td>
                                            <td>{(h.skills || []).join(', ')}</td>
                                            <td>{Math.round((h.duration || 0)/60)}m</td>
                                            <td>{h.notes || "-"}</td>
                                         </tr>
                                    ))}
                                </tbody>
                             </table>

                            <div className="eval-box">
                                <div className="meta-label">OVERALL EVALUATION & RECOMMENDATION</div>
                                <div style={{height: 150}}></div>
                            </div>

                            <div className="signature-area">
                                <div>
                                    <div style={{fontSize: 11, fontWeight: 800, color: '#555', textTransform: 'uppercase'}}>Student Signature</div>
                                    <div className="sig-line"></div>
                                </div>
                                <div>
                                    <div style={{fontSize: 11, fontWeight: 800, color: '#555', textTransform: 'uppercase'}}>Academic Director</div>
                                    <div className="sig-line"></div>
                                    <div style={{fontWeight: 800}}>Trương Thanh Trung</div>
                                </div>
                            </div>
                        </div>
                    );
                })() : (
                    <div style={{textAlign: 'center', padding: 50, border: '2px dashed #000'}}>Vui lòng chọn một học sinh trong bộ lọc ở trang Web trước khi In để tạo Báo Cáo.</div>
                )}
            </div>
          </div>
        )}

        {/* ================= DRIVE ================= */}
        {activeTab === "DRIVE" && (
          <div style={{ display: "grid", gap: 24 }}>
            <div className="card">
              <h2 style={{ marginTop: 0, fontSize: 18 }}>☁️ TẢI LÊN TÀI LIỆU (DRIVE HUB)</h2>
              <div style={{ display: "grid", gridTemplateColumns: window.innerWidth > 600 ? "1fr 1fr 1fr" : "1fr", gap: 15, marginBottom: 20 }}>
                <div>
                  <label style={{fontSize: 10, fontWeight: 800, color: C.sub}}>TÊN TÀI LIỆU</label>
                  <input placeholder="VD: Cam 18 Test 1..." value={newLink.title} onChange={(e: any)=>setNewLink({...newLink, title:e.target.value})} />
                </div>
                <div>
                  <label style={{fontSize: 10, fontWeight: 800, color: C.sub}}>LINK (DRIVE/DROPBOX)</label>
                  <input placeholder="https://..." value={newLink.url} onChange={(e: any)=>setNewLink({...newLink, url:e.target.value})} />
                </div>
                <div>
                  <label style={{fontSize: 10, fontWeight: 800, color: C.sub}}>ĐỐI TƯỢNG XEM</label>
                  <select value={linkAudience} onChange={(e: any)=>setLinkAudience(e.target.value as any)}>
                    <option value="ALL_STUDENTS">Tất cả học viên (Public)</option>
                    <option value="TEACHERS">Chỉ Giáo viên (Private)</option>
                    <option value="SPECIFIC_STUDENT">Giao cho cá nhân</option>
                  </select>
                </div>
              </div>

              {linkAudience === "SPECIFIC_STUDENT" && (
                <div style={{marginBottom: 20}}>
                  <label style={{fontSize: 10, fontWeight: 800, color: C.sub}}>CHỌN HỌC VIÊN NHẬN TÀI LIỆU NÀY</label>
                  <select value={linkTargetId} onChange={(e: any)=>setLinkTargetId(e.target.value)} style={{maxWidth: 400}}>
                    <option value="">-- Chọn một học viên --</option>
                    {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              )}

              <button onClick={handleAddLink} style={{ background: C.accent, color: "#fff", padding: "12px 24px" }}>+ LƯU TÀI LIỆU</button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: window.innerWidth > 800 ? "1fr 1fr 1fr" : "1fr", gap: 20 }}>
               <div className="card" style={{background: C.bg, border: `1px solid ${C.border}`}}>
                 <h3 style={{marginTop: 0, fontSize: 14, color: C.err, borderBottom: `2px solid ${C.err}`, paddingBottom: 10}}>🔒 NỘI BỘ GIÁO VIÊN</h3>
                 <div style={{display: 'grid', gap: 10}}>
                   {sharedLinks.filter(l => l && l.audience === "TEACHERS").map(l => (
                     <div key={l.id} style={{background: C.card, padding: 15, borderRadius: 8, border: `1px solid ${C.border}`}}>
                       <div style={{fontWeight: 800, fontSize: 13, marginBottom: 8}}>{getFileIcon(l.url)} {l.title}</div>
                       <div style={{display: 'flex', gap: 5}}>
                         <a href={l.url} target="_blank" rel="noreferrer" style={{fontSize: 11, background: C.accent, color: '#fff', padding: '4px 8px', borderRadius: 4, textDecoration: 'none'}}>Mở</a>
                         <button onClick={()=>copyToClipboard(l.url)} style={{fontSize: 11, background: C.bg, border: `1px solid ${C.border}`, padding: '4px 8px', cursor: 'pointer', color: C.text}}>Copy</button>
                         <button onClick={()=>{ const nx=sharedLinks.filter(x=>x && x.id!==l.id); setSharedLinks(nx as SharedLink[]); syncData({sharedLinks:nx}); }} style={{fontSize: 11, background: `${C.err}15`, color: C.err, padding: '4px 8px', marginLeft: 'auto'}}>Xóa</button>
                       </div>
                     </div>
                   ))}
                 </div>
               </div>

               <div className="card" style={{background: C.bg, border: `1px solid ${C.border}`}}>
                 <h3 style={{marginTop: 0, fontSize: 14, color: C.succ, borderBottom: `2px solid ${C.succ}`, paddingBottom: 10}}>🌍 TÀI LIỆU CHUNG (ALL)</h3>
                 <div style={{display: 'grid', gap: 10}}>
                   {sharedLinks.filter(l => l && l.audience === "ALL_STUDENTS").map(l => (
                     <div key={l.id} style={{background: C.card, padding: 15, borderRadius: 8, border: `1px solid ${C.border}`}}>
                       <div style={{fontWeight: 800, fontSize: 13, marginBottom: 8}}>{getFileIcon(l.url)} {l.title}</div>
                       <div style={{display: 'flex', gap: 5}}>
                         <a href={l.url} target="_blank" rel="noreferrer" style={{fontSize: 11, background: C.accent, color: '#fff', padding: '4px 8px', borderRadius: 4, textDecoration: 'none'}}>Mở</a>
                         <button onClick={()=>copyToClipboard(l.url)} style={{fontSize: 11, background: C.bg, border: `1px solid ${C.border}`, padding: '4px 8px', cursor: 'pointer', color: C.text}}>Copy</button>
                         <button onClick={()=>{ const nx=sharedLinks.filter(x=>x && x.id!==l.id); setSharedLinks(nx as SharedLink[]); syncData({sharedLinks:nx}); }} style={{fontSize: 11, background: `${C.err}15`, color: C.err, padding: '4px 8px', marginLeft: 'auto'}}>Xóa</button>
                       </div>
                     </div>
                   ))}
                 </div>
               </div>

               <div className="card" style={{background: C.bg, border: `1px solid ${C.border}`}}>
                 <h3 style={{marginTop: 0, fontSize: 14, color: C.warn, borderBottom: `2px solid ${C.warn}`, paddingBottom: 10}}>👤 TÀI LIỆU CÁ NHÂN</h3>
                 <div style={{display: 'grid', gap: 10}}>
                   {sharedLinks.filter(l => l && l.audience === "SPECIFIC_STUDENT").map(l => (
                     <div key={l.id} style={{background: C.card, padding: 15, borderRadius: 8, border: `1px solid ${C.border}`}}>
                       <div style={{fontSize: 10, color: C.warn, fontWeight: 800, marginBottom: 4}}>GIAO CHO: {l.targetStudentName}</div>
                       <div style={{fontWeight: 800, fontSize: 13, marginBottom: 8}}>{getFileIcon(l.url)} {l.title}</div>
                       <div style={{display: 'flex', gap: 5}}>
                         <a href={l.url} target="_blank" rel="noreferrer" style={{fontSize: 11, background: C.accent, color: '#fff', padding: '4px 8px', borderRadius: 4, textDecoration: 'none'}}>Mở</a>
                         <button onClick={()=>copyToClipboard(l.url)} style={{fontSize: 11, background: C.bg, border: `1px solid ${C.border}`, padding: '4px 8px', cursor: 'pointer', color: C.text}}>Copy</button>
                         <button onClick={()=>{ const nx=sharedLinks.filter(x=>x && x.id!==l.id); setSharedLinks(nx as SharedLink[]); syncData({sharedLinks:nx}); }} style={{fontSize: 11, background: `${C.err}15`, color: C.err, padding: '4px 8px', marginLeft: 'auto'}}>Xóa</button>
                       </div>
                     </div>
                   ))}
                 </div>
               </div>
            </div>
          </div>
        )}

      </main>
      
      {!activeExam && (
          <button onClick={scrollToTop} style={{position: 'fixed', bottom: 20, right: 20, background: C.accent, color: '#fff', width: 45, height: 45, borderRadius: '50%', fontSize: 20, boxShadow: '0 4px 10px rgba(0,0,0,0.3)', zIndex: 999, border: 'none', cursor: 'pointer'}}>↑</button>
      )}

      {/* NÚT CHUYỂN ĐỔI NGÔN NGỮ NHANH */}
      {!activeExam && (
          <button 
              onClick={() => i18n.changeLanguage(i18n.language === 'en' ? 'vi' : 'en')} 
              style={{position: 'fixed', bottom: 20, left: 20, background: C.card, color: C.text, border: `2px solid ${C.border}`, padding: '10px 15px', borderRadius: 30, fontSize: 14, fontWeight: 900, boxShadow: '0 4px 10px rgba(0,0,0,0.1)', zIndex: 999, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8}}
          >
              🌐 {i18n.language === 'en' ? 'Tiếng Việt' : 'English'}
          </button>
      )}
    </div>
  );
}