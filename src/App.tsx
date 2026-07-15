import React, { useState, useEffect, useRef, useMemo } from "react";
import * as THREE from "three";
import DOMPurify from "dompurify";
import { initializeApp } from "firebase/app";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, onSnapshot, runTransaction, setDoc, writeBatch } from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, type User } from "firebase/auth";
import { getStorage, ref as storageRef, uploadBytesResumable, getDownloadURL } from "firebase/storage";
// ==========================================
// HỘP ĐEN (ERROR BOUNDARY) CHỐNG TRẮNG TRANG
// ==========================================

const firebaseConfig = { apiKey: "AIzaSyA48L2oDMyYlsQUVfp7YUh3u1p7vA2NJN0", authDomain: "ielts-os.firebaseapp.com", projectId: "ielts-os", storageBucket: "ielts-os.firebasestorage.app", messagingSenderId: "205768597474", appId: "1:205768597474:web:7427d4cbae2d3a8d49a3b", measurementId: "G-NW0X6QDL6W" };
const app = initializeApp(firebaseConfig);
// THI OFFLINE: bật cache IndexedDB cục bộ -> onSnapshot trả đề từ cache khi mất mạng.
// Tự fallback về memory cache nếu trình duyệt không hỗ trợ (ẩn danh, nhiều tab cũ...).
let db: ReturnType<typeof initializeFirestore>;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
} catch (e) {
  console.warn("Persistent cache unavailable, fallback memory:", e);
  db = initializeFirestore(app, {});
}
const auth = getAuth(app);
const storage = getStorage(app);
const getApiBase = () => ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname) ? "http://localhost:8000" : "";
const DB_DOC_REF = doc(db, "ielts_workspace", "trung_linh_data");
const LIVE_DOC_REF = doc(db, "ielts_workspace", "live_arena");
const VOCAB_ROOT_COLLECTION = "ielts_vocab";
const vocabStudentKey = (email: string) => encodeURIComponent(String(email || "").trim().toLowerCase());
const vocabCardsRef = (email: string) => collection(db, VOCAB_ROOT_COLLECTION, vocabStudentKey(email), "cards");
const persistVocabCards = async (email: string, notebook: VocabCard[], tombstones: string[] = []) => {
  const cards = new Map<string, any>();
  (Array.isArray(notebook) ? notebook : []).forEach(card => {
    if (card?.id) cards.set(String(card.id), { ...card, id: String(card.id), deleted: false });
  });
  (Array.isArray(tombstones) ? tombstones : []).forEach(id => {
    if (id) cards.set(String(id), { id: String(id), deleted: true });
  });

  const entries = Array.from(cards.values());
  for (let offset = 0; offset < entries.length; offset += 400) {
    const batch = writeBatch(db);
    entries.slice(offset, offset + 400).forEach(card => {
      const cleanCard = JSON.parse(JSON.stringify({
        ...card,
        ownerEmail: String(email || "").trim().toLowerCase(),
        updatedAt: Date.now(),
      }));
      batch.set(doc(vocabCardsRef(email), String(card.id)), cleanCard, { merge: true });
    });
    await batch.commit();
  }
};

// ==========================================
// HÀNG ĐỢI NỘP BÀI OFFLINE (lưu nhiều kết quả, đồng bộ khi có mạng)
// ==========================================
const offlineQueueKey = (email?: string | null) => `ielts_offline_queue_${email || "anon"}`;
const readOfflineQueue = (email?: string | null): any[] => {
  try { const s = localStorage.getItem(offlineQueueKey(email)); return s ? JSON.parse(s) : []; } catch { return []; }
};
const writeOfflineQueue = (email: string | null | undefined, q: any[]) => {
  try { localStorage.setItem(offlineQueueKey(email), JSON.stringify(q)); } catch {}
};
const pushOfflineResult = (email: string | null | undefined, result: any) => {
  const q = readOfflineQueue(email);
  q.push(result);
  writeOfflineQueue(email, q);
};

// ==========================================
// TRUE TIME ENGINE V2 (BẤT TỬ & CHỐNG HACK)
// ==========================================
let serverBaseTime = Date.now();
let performanceBase = performance.now();
let isTimeSynced = false;

const fetchWithTimeout = async (url: string, init: RequestInit = {}, timeoutMs = 5000) => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timeout);
    }
};

const syncTimeNetwork = async (): Promise<boolean> => {
    try {
        // Tuyệt chiêu: Lấy giờ từ chính server Host web thông qua HTTP Header (Bỏ qua API, không thể bị chặn)
        const res = await fetchWithTimeout(window.location.origin, { method: 'HEAD', cache: 'no-store' });
        const dateHeader = res.headers.get('Date');
        const serverTime = dateHeader ? new Date(dateHeader).getTime() : Number.NaN;
        if (res.ok && Number.isFinite(serverTime)) {
            serverBaseTime = serverTime;
            performanceBase = performance.now();
            isTimeSynced = true;
            return true;
        }
        
        // Backup API nếu cách 1 lỗi
        const fallback = await fetchWithTimeout("https://timeapi.io/api/Time/current/zone?timeZone=Asia/Ho_Chi_Minh");
        if (!fallback.ok) throw new Error(`Time API returned ${fallback.status}`);
        const data = await fallback.json();
        const fallbackTime = new Date(data.dateTime + "+07:00").getTime();
        if (!Number.isFinite(fallbackTime)) throw new Error("Invalid time response");
        serverBaseTime = fallbackTime;
        performanceBase = performance.now();
        isTimeSynced = true;
        return true;
    } catch (e) {
        console.warn("Network time is unavailable; using the device clock.");
        return false;
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
      test_room_title: "TEST ROOM",
      exam_tab_available: "Available",
      exam_tab_results: "Results & Review",
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
      unanswered_label: "Unanswered",
      // --- Student Portal (Phase 1) ---
      loading_student: "Loading student data...",
      ptab_home: "Overview",
      ptab_exams: "Test Room",
      ptab_vocab: "Vocabulary",
      ptab_progress: "Progress",
      ptab_rewards: "Rewards",
      ready_conquer: "Ready to conquer your IELTS goals today?",
      coins_label: "Coins",
      private_msg_title: "Private message from your teacher:",
      time_synced: "TIME SYNCED",
      time_syncing: "SYNCING...",
      my_inventory: "Your Inventory",
      my_inventory_btn: "My Inventory",
      consumables_tab: "Consumables",
      permanent_tab: "Permanent",
      quantity_label: "Quantity",
      use_now: "Use now",
      equip_btn: "Equip",
      inventory_empty_consumable: "Your bag is empty. Visit the Store!",
      inventory_empty_permanent: "No permanent items yet. Try the Gacha wheel!",
      gacha_spin: "LUCKY GACHA SPIN",
      gacha_cost: "500 OS Coins / Spin",
      debt_notice_title: "IMPORTANT NOTICE",
      debt_read_carefully: "Please read this notice carefully before continuing to use the system.",
      debt_acknowledge: "I UNDERSTAND AND CONFIRM",
      debt_wait: "Please wait {{s}}s...",
      reward_code_title: "REWARD CODE",
      item_label: "Item",
      reward_screenshot_warn: "Send this code to your teacher to claim your reward. The teacher verifies it in the system — each code is unique, single-use and cannot be faked. Editing the image won't work.",
      captured_close: "SCREENSHOT TAKEN - CLOSE",
      rc_verify_title: "Verify reward code",
      rc_verify_desc: "Enter the code the student sent. The system checks it against the ledger — fake/edited codes won't exist, and each code can only be redeemed once.",
      rc_verify_btn: "Check",
      rc_redeem_btn: "Confirm & give reward",
      rc_student: "Student",
      rc_item: "Item",
      rc_created: "Issued at",
      rc_fake: "Code not found. It may be fake or edited — do NOT give the reward.",
      rc_used: "This code was already redeemed at",
      locked_other_device: "TAKING TEST ON ANOTHER DEVICE",
      test_ui_btn: "TEST UI",
      force_take: "FORCE ENTRY",
      band_label: "Band",
      opens_at: "Opens at",
      closes_at: "Closes at",
      motivation_need: "You need {{gap}} more band(s) to reach your Target!",
      motivation_reached: "Excellent! You have reached your Target.",
      // --- Teacher: tabs / shell / login (Phase 2) ---
      tab_DASHBOARD: "Dashboard",
      tab_CLASSROOM: "Classroom",
      tab_EXAM_BUILDER: "Exam Builder",
      tab_LIVE_ARENA: "Live Arena",
      tab_ACADEMICS: "Academics",
      tab_FINANCE: "Finance",
      tab_STUDENTS: "Students",
      tab_DRIVE: "Drive",
      tab_HISTORY: "History",
      role_teacher: "TEACHER",
      backend_status: "Backend server status",
      contrast_mode: "High contrast",
      login_heading: "Sign in",
      login_welcome: "Welcome back. Please enter your credentials.",
      show_hide_pwd: "Show / hide password",
      syncing_cloud: "SYNCING CLOUD DATA...",
      // --- Teacher: Dashboard ---
      dash_greeting: "Welcome back",
      dash_overview: "Business overview & quick operations",
      dash_revenue_month: "REVENUE THIS MONTH",
      dash_unpaid: "OUTSTANDING DEBT",
      dash_students_total: "TOTAL STUDENTS",
      dash_sessions_month: "SESSIONS THIS MONTH",
      dash_quick_actions: "QUICK ACTIONS",
      dash_recent_sessions: "RECENT SESSIONS",
      dash_no_data: "No data yet.",
      dash_upcoming: "UPCOMING SCHEDULE",
      dash_announce_title: "Announcement to students",
      dash_announce_save: "Save announcement",
      dash_announce_ph: "Enter a marquee announcement for the student portal...",
      // --- Common (teacher) ---
      common_save: "Save",
      common_cancel: "Cancel",
      common_delete: "Delete",
      common_edit: "Edit",
      common_add: "Add",
      common_close: "Close",
      common_search: "Search...",
      common_confirm: "Confirm",
      common_actions: "Actions",
      common_name: "Name",
      common_date: "Date",
      common_note: "Note",
      common_total: "Total",
      common_loading: "Loading...",
      common_none: "None",
      net_profit: "NET PROFIT",
      total_teaching_hours: "TOTAL TEACHING HOURS",
      student_count: "STUDENTS",
      total_debt: "OUTSTANDING DEBT",
      drive_docs: "DRIVE DOCUMENTS",
      total_revenue: "Total revenue",
      pending_payment: "Pending",
      teaching_schedule: "Teaching schedule",
      add_schedule: "New schedule",
      start_time: "START TIME",
      student_label: "STUDENT",
      select_student: "Select student...",
      location_link: "LOCATION / LINK",
      save_schedule: "SAVE SCHEDULE",
      remind_schedule: "Remind",
      no_schedule_day: "No schedule for this day.",
      sched_duration: "DURATION (MIN)",
      att_present: "Attended",
      att_absent: "Absent",
      att_done: "Attended",
      att_was_absent: "Absent",
      att_confirm: "Confirm {{name}} attended? Auto-bill {{money}}.",
      att_billed: "Lesson logged & billed successfully!",
      att_reschedule: "Reset",
      ea_title: "Weakness analysis by question type",
      ea_center: "Center-wide accuracy",
      ea_no_data: "No exam data yet to analyze.",
      ea_weakest: "Weakest",
      ea_questions_n: "{{n}} answers",
      ea_students_weak: "Students needing focus",
      ai_tip: "Generate feedback with AI",
      ai_generating: "AI is writing...",
      ai_error: "AI feedback failed. Check API key / connection.",
      chart_band_title: "Band progress over time",
      chart_pick_student: "Select a student in the filter below to see their band progress.",
      chart_my_progress: "My band progress",
      chart_no_progress: "Complete a test to see your progress chart.",
      explain_why: "Why?",
      explain_loading: "Explaining...",
      explain_title: "Explanation",
      eb_transcribe: "Listen & make transcript (AI)",
      eb_transcribing: "Listening to audio...",
      eb_transcript_ready: "Transcript saved",
      eb_transcript_hint: "Generates a transcript so explanations can quote the audio.",
      eb_tr_uploading: "Uploading audio...",
      eb_tr_segment: "Listening {{a}}-{{b}} min...",
      vocab_words: "words",
      vocab_due: "due",
      vocab_generate: "Generate from my tests",
      vocab_generating: "Analysing...",
      vocab_empty_hint: "Tap Generate — AI reads the tests you've taken and picks the words, phrasal verbs, idioms, collocations & grammar worth learning, unique to you.",
      vocab_flashcard: "Flashcards",
      vocab_list: "List",
      vocab_done_today: "All caught up for today!",
      vocab_tap_flip: "Tap to flip",
      vocab_pronounce: "Listen to pronunciation",
      vocab_forgot: "Forgot",
      vocab_remember: "Got it",
      vocab_cat_all: "All",
      vocab_cat_word: "Words",
      vocab_cat_phrasal_verb: "Phrasal verbs",
      vocab_cat_idiom: "Idioms",
      vocab_cat_collocation: "Collocations",
      vocab_cat_grammar: "Grammar",
      vocab_kinds_title: "Item types for AI to prioritise",
      vocab_kinds_hint: "Pick which kinds AI should focus on next time you tap Generate. At least one must stay on.",
      vocab_count_label: "How many to generate",
      vocab_from_test: "from your test",
      announce_to_students: "GENERAL ANNOUNCEMENT",
      announce_ph: "E.g. Holiday on Apr 30...",
      clear_announce: "Clear announcement",
      clean_logs: "Clean logs",
      confirm_clear_logs: "Clear all error logs?",
      system_healthy: "System is running smoothly, no errors recorded.",
      zoom_ph: "E.g. Zoom...",
      // --- SEB guide ---
      seb_title: "SECURE BROWSER REQUIRED (SEB)",
      seb_intro_a: "The test",
      seb_intro_b: "is set to strict secure mode. You CANNOT take it on a normal browser (Chrome/Safari/Edge).",
      seb_steps_header: "STEPS TO ENTER THE TEST:",
      seb_back_btn: "I UNDERSTAND, GO BACK",
      // --- Classroom ---
      cls_select_student_label: "SELECT STUDENT",
      cls_select_student_opt: "-- Select student --",
      cls_teacher_incharge: "Teacher in charge:",
      cls_skills_label: "TEACHING SKILLS (TICK TO SELECT)",
      cls_manual_input: "+ Manual entry",
      cls_manual_title: "ADD TIME MANUALLY",
      cls_minutes: "MINUTES",
      cls_seconds: "SECONDS",
      cls_save_money: "SAVE AS EARNINGS",
      cls_start: "START",
      cls_pause: "PAUSE",
      cls_save_result: "SAVE RESULT",
      cls_ready: "READY",
      cls_live: "SYSTEM LIVE",
      // --- Finance ---
      fin_overview: "FINANCIAL OVERVIEW",
      fin_total_in: "TOTAL INCOME",
      fin_total_out: "TOTAL EXPENSE",
      fin_net: "NET PROFIT",
      fin_income_report: "Income Report",
      fin_expense_report: "Expense Report",
      fin_teaching: "teaching",
      fin_extra_income: "Add extra income:",
      fin_reason_in: "Income reason...",
      fin_reason_out: "Expense reason...",
      fin_amount: "Amount...",
      // --- Drive ---
      drv_upload_title: "UPLOAD DOCUMENT (DRIVE HUB)",
      drv_doc_name: "DOCUMENT NAME",
      drv_doc_name_ph: "E.g. Cam 18 Test 1...",
      drv_link_label: "LINK (DRIVE/DROPBOX)",
      drv_audience: "AUDIENCE",
      drv_aud_all: "All students (Public)",
      drv_aud_teachers: "Teachers only (Private)",
      drv_aud_specific: "Assign to individual",
      drv_pick_student: "SELECT STUDENT TO RECEIVE THIS",
      drv_pick_student_opt: "-- Select a student --",
      drv_save_doc: "+ SAVE DOCUMENT",
      drv_internal: "TEACHER INTERNAL",
      drv_common: "COMMON DOCUMENTS (ALL)",
      drv_personal: "PERSONAL DOCUMENTS",
      drv_open: "Open",
      drv_assigned_to: "ASSIGNED TO:",
      // --- Pending exam (pre-start) ---
      pend_loading: "Loading test data...",
      pend_loading_desc: "The system is securely downloading images and audio to your device.",
      pend_loaded: "Data loaded successfully",
      pend_loaded_desc: "All data is safely cached offline.",
      // --- Live Arena ---
      live_count_suffix: "students testing",
      live_exam_label: "Test:",
      live_done: "Done {{a}}/{{b}} questions",
      live_cheat: "CHEATING DETECTED: the candidate switched tab / exited fullscreen!",
      live_send_msg: "Send direct message",
      live_empty: "No students are currently taking a test.",
      // --- Students ---
      stu_push_title: "Send System Notification (Push Notification)",
      stu_push_target: "RECIPIENT",
      stu_push_all: "All students",
      stu_push_subject: "NOTIFICATION TITLE",
      stu_push_subject_ph: "E.g. Urgent schedule...",
      stu_push_content: "CONTENT",
      stu_push_content_ph: "E.g. Make-up class at 8pm tonight...",
      stu_push_send: "SEND NOTIFICATION",
      stu_push_note: "* The notification shows directly on the student's device (phone/computer) as soon as they open the web. Ask students to tap Allow Notifications in their browser.",
      stu_edit_title: " Edit student",
      stu_add_title: "Add new student",
      stu_fullname: "FULL NAME",
      stu_login_email: "LOGIN EMAIL",
      stu_dob: "DATE OF BIRTH (Optional)",
      stu_rate: "TUITION/HR",
      stu_cefr_now: "CEFR (NOW)",
      stu_target_band: "TARGET BAND",
      stu_os_cup: <g><path d="M6 3h12l-1.5 17a2 2 0 0 1-2 1.8h-5A2 2 0 0 1 7.5 20L6 3z"/><path d="M5 8h14"/><path d="M12 3v-1.5"/></g>,
    coins: "OS COINS (GIVE/DEDUCT)",
      stu_coins_ph: "Enter coins...",
      stu_update: "UPDATE",
      stu_add_new: "ADD NEW",
      stu_search_ph: "Search students by name or email...",
      stu_sort_name: "Sort: Name (A-Z)",
      stu_sort_exp: "Sort: Study hours (EXP)",
      stu_sort_debt: "Sort: Tuition debt",
      stu_only_debt: "Show debtors only",
      stu_export_csv: "Excel",
      stu_no_email: "No email yet",
      hub_overview: "Overview",
      hub_students_count: "{{n}} students",
      hub_tab_results: "Test results",
      hub_tab_sessions: "Sessions",
      hub_tab_finance: "Tuition & Rewards",
      hub_total_students: "Total students",
      hub_debtors: "Debtors",
      hub_total_debt: "Total tuition debt",
      hub_total_hours: "Total teaching hours",
      hub_avg_band: "Avg band",
      hub_hours: "Hours",
      hub_tests: "Tests",
      hub_debt_short: "Tuition debt",
      hub_coins: "OS Coins",
      hub_no_band: "No band data yet.",
      hub_unpaid_sessions: "Unpaid sessions",
      hub_no_unpaid: "No outstanding sessions.",
      hub_export_pdf: "Export PDF",
      hub_copy_sms: "Copy SMS",
      hub_evidence_note: "Private note (shown to student)",
      stu_debt_label: "Owing:",
      stu_private_ph: "Enter a private note for this student...",
      stu_debt_inapp: "In-App Debt Reminder",
      stu_reward_coins: "Reward Coins",
      gift_manual_btn: "Grant Gift",
      gift_modal_title: "Manually grant gift",
      gift_modal_sub: "Send straight to the student's bag — no coins or gacha needed.",
      gift_sec_coins: "OS Coins",
      gift_sec_consumable: "Real-world rewards (consumables)",
      gift_sec_permanent: "Cosmetics & titles (permanent)",
      gift_custom_label: "Custom item",
      gift_custom_ph: "e.g. 1 free private lesson",
      gift_qty: "Qty",
      gift_grant: "Grant",
      gift_owned: "Owned",
      gift_done: "Sent gift to student!",
      gift_coins_amount: "Amount",
      // --- History ---
      hist_filter_print: "FILTER BY STUDENT TO PRINT REPORT",
      hist_all: "All",
      hist_delete: "DELETE",
      hist_print_pdf: "PRINT REPORT (PDF)",
      hist_export_excel: "EXPORT EXCEL",
      hist_total_hours: "TOTAL TEACHING HOURS",
      hist_total_income: "TOTAL INCOME",
      hist_skill_dist: "Time distribution by skill",
      hist_col_student: "STUDENT",
      hist_col_date: "DATE",
      hist_col_teacher: "TEACHER",
      hist_col_fee: "TUITION",
      hist_teacher_notes: "TEACHER'S NOTES",
      hist_notes_ph: "Enter detailed feedback...",
      hist_collect_fast: "Collect payment",
      hist_collected: "Paid",
      hist_delete_session: "Delete session",
      hist_no_match: "No matching history.",
      hist_print_hint: "Please select a student in the filter on the web before printing to generate the Report.",
      // --- Academics ---
      acad_calc_title: "QUICK BAND CALCULATOR",
      acad_calc_ph: "Correct answers (e.g. 32)...",
      acad_top_students: "TOP HARD-WORKING STUDENTS",
      acad_band_dist: "BAND DISTRIBUTION",
      acad_tests_unit: "tests",
      acad_results_title: "TEST RESULTS & MONITORING",
      acad_delete_selected: "DELETE SELECTED",
      acad_export_all: "EXPORT FULL EXCEL",
      acad_search_name: "SEARCH BY STUDENT NAME",
      acad_search_ph: "Enter student name...",
      acad_filter_student: "FILTER BY STUDENT",
      acad_all_students: "All students",
      acad_filter_quiz: "FILTER BY TEST",
      acad_all_quizzes: "All tests",
      acad_avg_quiz: "Average score for this test:",
      acad_filter_band: "FILTER BY BAND",
      acad_all_bands: "All bands",
      acad_band_7up: "Band 7.0 and above",
      acad_band_under6: "Below Band 6.0",
      acad_min: "min",
      acad_sec: "sec",
      acad_started: "Started:",
      acad_ended: "Ended:",
      acad_duration: "Duration:",
      acad_ip: "Network IP:",
      acad_device: "Device:",
      acad_cheat_warn: "Warning: Detected {{n}} exit(s) from the exam screen!",
      acad_no_cheat: "No cheating detected.",
      acad_feedback_label: "FEEDBACK FOR THIS STUDENT:",
      acad_feedback_ph: "Enter feedback...",
      acad_copy_zalo: "Copy Zalo",
      acad_fb1: "Many spelling errors",
      acad_fb2: "Poor time management",
      acad_fb3: "Needs more Multiple Choice practice",
      acad_fb4: "Very good!",
      acad_export_detail: "Export Per-Question Excel",
      acad_ban_ip: "Ban IP",
      acad_cancel_test: "Void test",
      acad_no_results: "No matching results found.",
      // --- Review Quiz ---
      rev_test_part: "Test section",
      rev_part: "Section",
      rev_mcq: "Multiple choice",
      rev_total_band: "Total score (Band)",
      rev_detail: "Test details",
      rev_correct: "Correct",
      rev_incorrect: "Incorrect",
      rev_skipped: "Skipped",
      rev_questions_unit: "Questions",
      rev_result: "Result",
      rev_time: "Time spent",
      rev_accuracy: "Accuracy",
      rev_correct_count: "Correct answers",
      // --- Exam Builder ---
      eb_title: "EXAM LIBRARY & AUTHORING SYSTEM",
      eb_upload_docx: "IMPORT (.DOCX)",
      eb_create_new: "Create new exam",
      eb_edit_key: "EDIT ANSWER KEY:",
      eb_q: "Question",
      eb_answer_ph: "Enter answer...",
      eb_save_key: "SAVE NEW KEY",
      eb_nav_title: "QUESTION NAVIGATION",
      eb_quiz_fallback: "Exam",
      eb_questions_unit: "questions",
      eb_no_questions: "No questions yet. Click the button below to add.",
      eb_type_blank: "Fill-in",
      eb_type_match: "Matching",
      eb_type_drag: "Drag & drop",
      eb_type_multi: "Multiple answers",
      eb_type_choice: "Multiple choice",
      eb_add_question: "Add question",
      eb_add_blank_group: "Fill-in group",
      eb_title_ph: "Exam name...",
      eb_settings: "Settings",
      eb_close: "Close",
      eb_save: "Save",
      eb_passage_title: "READING PASSAGE / CONTEXT",
      eb_passage_ph: "Enter the passage content for section {{n}}...",
      eb_question_list: "QUESTION LIST",
      eb_opt_choice: "Multiple choice (1 answer)",
      eb_opt_multi: "Multiple select (many answers)",
      eb_opt_match: "Matching (Matching Grid)",
      eb_opt_blank: "Fill-in (Inline Blank)",
      eb_opt_drag: "Drag - Drop (Drag Drop)",
      eb_subtype_none: "-- Question form (Tag) --",
      eb_move_up: "Move up",
      eb_move_down: "Move down",
      eb_duplicate: "Duplicate",
      eb_delete: "Delete",
      eb_instructions_label: "INSTRUCTIONS (shared by the group)",
      eb_instructions_ph: "E.g. Questions 1–5. Choose the correct letter A, B, C or D.",
      eb_inline_para: "FILL-IN PASSAGE (INLINE INPUT)",
      eb_blank_hint_a: "Type",
      eb_blank_hint_b: "into the passage to create a blank.",
      eb_renumber_title: "Renumber the blanks in order of appearance",
      eb_renumber: "Renumber",
      eb_insert_blank: "Insert new blank",
      eb_para_ph: "Write a continuous passage here, just like Word...",
      eb_blank_answers: "ANSWERS FOR THE BLANKS ABOVE:",
      eb_blank_missing_title: "You haven't typed this blank marker in the passage!",
      eb_blank_answer_ph: "E.g. True/False...",
      eb_question_content: "QUESTION CONTENT",
      eb_answer_label: "ANSWER",
      eb_select_n: "SELECT",
      eb_pick_correct: "Mark as the correct answer",
      eb_option_ph: "Enter option {{letter}}...",
      eb_adv_settings: "Advanced settings",
      eb_basic_info: "BASIC INFORMATION",
      eb_folder: "FOLDER",
      eb_exam_type: "EXAM TYPE",
      eb_time_minutes: "TIME (MINUTES)",
      eb_max_attempts: "MAX ATTEMPTS",
      eb_audio_link: "AUDIO LINK (MP3)",
      eb_audio_ph: "Enter the audio file URL...",
      eb_upload_audio: "Upload audio",
      eb_audio_uploading: "Uploading audio...",
      eb_audio_ready: "Hosted on your site",
      eb_audio_upload_failed: "Audio upload failed",
      eb_audio_hosted_hint: "Upload MP3/M4A/WAV to create a clean site audio link.",
      eb_audio_mode: "AUDIO MODE",
      eb_audio_strict: "Exam (play once)",
      eb_audio_practice: "Practice (replay)",
      eb_security_sched: "SECURITY & SCHEDULE",
      eb_pin: "PASSWORD (PIN)",
      eb_pin_ph: "Leave blank if not locked",
      eb_open_at: "OPENS AT",
      eb_close_at: "CLOSES AT",
      eb_require_seb: "Require SEB Browser",
      eb_active_on: "Active (Students can see it)",
      eb_active_off: "Off (Draft)",
      eb_distribution: "DISTRIBUTION (AUDIENCE)",
      eb_specific: "Assign to specific students",
      eb_pick_students: "TICK STUDENTS ALLOWED TO TAKE THIS:",
      eb_search_results: "Search results",
      eb_new_folder: "New folder",
      eb_search_quiz_ph: "Search exams...",
      eb_folders_area: "FOLDERS",
      eb_quiz_list: "EXAM LIST",
      eb_move_folder: "Move folder",
      eb_lock_quiz: "Lock exam",
      eb_unlock_quiz: "Unlock",
      eb_locked_title: "Locked",
      eb_minutes: "min",
      eb_questions_short: "questions",
      eb_public: "Public:",
      eb_st_locked: "Locked",
      eb_st_open: "Open",
      eb_st_off: "Off",
      eb_preview_exam: "Preview",
      eb_download_key: "Download Key",
      eb_recalc: "Re-grade",
      eb_edit_key_btn: "Edit Key",
      eb_edit_exam: "Edit exam",
      eb_folder_empty: "This folder is empty.",
      // --- Tooltips ---
      tip_pin_student: "Pin student",
      tip_voice_input: "Voice input (requires Chrome)",
      tip_sync_server: "Server time sync",
      tip_dict: "Click to view dictionary",
      tip_pwd_required: "Password required",
      tip_seb_required: "Must use SEB software to take the exam",
      tip_test_ui: "Check the interface before the exam to ensure no display errors"
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
      welcome_morning: "Chào buổi sáng",
      welcome_afternoon: "Chào buổi chiều",
      welcome_evening: "Chào buổi tối",
      welcome_back: "Chào mừng quay lại không gian học tập trực tuyến IELTS OS.",
      total_hours: "TỔNG GIỜ ĐÃ HỌC",
      avg_band: "BAND ĐIỂM TRUNG BÌNH",
      total_quizzes: "TỔNG BÀI THI ĐÃ NỘP",
      vocab_notebook: "SỔ TAY TỪ VỰNG CỦA TÔI",
      no_vocab: "Bạn chưa lưu từ nào. Quét đen chữ trong bài thi để lưu!",
      performance_chart: "Biểu đồ năng lực (5 Test Gần Nhất)",
      upcoming_class: "LỊCH HỌC SẮP TỚI CỦA BẠN",
      instructor: "Giáo viên",
      location: "Địa điểm",
      current_progress: "TIẾN ĐỘ LEVEL HIỆN TẠI",
      current_cefr: "CEFR HIỆN TẠI",
      target_band: "MỤC TIÊU",
      test_room_title: "PHÒNG THI",
      exam_tab_available: "Đề khả dụng",
      exam_tab_results: "Kết quả & Review",
      filter_quizzes: "Lọc bài thi...",
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
      drive_hub_title: "Kho Tài Liệu (Drive)",
      open_download: "Mở / Tải xuống",
      no_shared_links: "Chưa có tài liệu nào được chia sẻ.",
      class_history_title: "Lịch sử buổi học & Nhận xét",
      no_history: "Chưa có buổi học nào được ghi nhận.",
      tuition_paid: "Đã thanh toán",
      tuition_debt: "Nợ học phí",
      no_additional_notes: "Không có ghi chú thêm.",
      fullscreen_warning: "YÊU CẦU TOÀN MÀN HÌNH",
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
      exit_focus_mode: "Thoát Focus Mode",
      reading_passage_title: "READING PASSAGE",
      font_btn: "Aa Font",
      lines_btn: "Số dòng",
      paper_btn: "Giấy",
      align_btn: "Căn lề",
      spacing_btn: "Dòng",
      scratchpad_placeholder: "Nhập nháp ở đây (Lưu tự động). Bấm Ctrl+Enter để chèn mốc thời gian...",
      scratchpad_close: "Đóng nháp",
      scratchpad_open: "Mở Giấy Nháp",
      flag_title: "Đánh dấu câu này",
      clear_choice: "Bỏ chọn đáp án",
      word_count: "Word count",
      words_label: "từ",
      hide_note: "Ẩn ghi chú",
      show_note: "Ghi chú câu này",
      note_placeholder: "Ghi chú riêng cho câu này (chỉ mình bạn thấy)...",
      question_board: "SƠ ĐỒ CÂU HỎI",
      answered_label: "Đã làm",
      unanswered_label: "Chưa làm",
      // --- Student Portal (Phase 1) ---
      loading_student: "Đang tải dữ liệu học viên...",
      ptab_home: "Tổng quan",
      ptab_exams: "Phòng thi",
      ptab_vocab: "Từ vựng",
      ptab_progress: "Tiến độ",
      ptab_rewards: "Phần thưởng",
      ready_conquer: "Sẵn sàng chinh phục mục tiêu IELTS của bạn hôm nay?",
      coins_label: "Xu",
      private_msg_title: "Thông báo riêng từ Giáo viên:",
      time_synced: "ĐÃ ĐỒNG BỘ GIỜ",
      time_syncing: "ĐANG ĐỒNG BỘ...",
      my_inventory: "Túi Đồ Của Bạn",
      my_inventory_btn: "Túi Đồ Của Tôi",
      consumables_tab: "Tiêu hao",
      permanent_tab: "Vĩnh viễn",
      quantity_label: "Số lượng",
      use_now: "Dùng ngay",
      equip_btn: "Trang bị",
      inventory_empty_consumable: "Túi đồ rỗng. Hãy ghé Cửa hàng nhé!",
      inventory_empty_permanent: "Chưa sở hữu vật phẩm vĩnh viễn nào. Hãy thử Vòng quay Gacha!",
      gacha_spin: "QUAY GACHA MAY MẮN",
      gacha_cost: "500 OS Coins / Lượt",
      debt_notice_title: "THÔNG BÁO QUAN TRỌNG",
      debt_read_carefully: "Vui lòng đọc kỹ thông báo trước khi tiếp tục sử dụng hệ thống.",
      debt_acknowledge: "ĐÃ HIỂU VÀ XÁC NHẬN",
      debt_wait: "Vui lòng đợi {{s}}s...",
      reward_code_title: "MÃ NHẬN THƯỞNG",
      item_label: "Vật phẩm",
      reward_screenshot_warn: "Gửi mã này cho Giáo viên để nhận thưởng. Giáo viên sẽ kiểm tra mã trong hệ thống — mỗi mã là duy nhất, chỉ dùng được 1 lần và không thể làm giả. Photoshop sẽ vô hiệu.",
      captured_close: "ĐÃ CHỤP ẢNH - ĐÓNG",
      rc_verify_title: "Xác minh mã thưởng",
      rc_verify_desc: "Nhập mã học viên gửi. Hệ thống đối chiếu với sổ cái — mã giả/chỉnh sửa sẽ không tồn tại, và mỗi mã chỉ trả thưởng được 1 lần.",
      rc_verify_btn: "Kiểm tra",
      rc_redeem_btn: "Xác nhận & trả thưởng",
      rc_student: "Học viên",
      rc_item: "Vật phẩm",
      rc_created: "Phát hành lúc",
      rc_fake: "Không tìm thấy mã. Có thể là mã giả hoặc đã chỉnh sửa — KHÔNG trả thưởng.",
      rc_used: "Mã này đã được trả thưởng lúc",
      locked_other_device: "ĐANG LÀM BÀI Ở MÁY KHÁC",
      test_ui_btn: "TEST GIAO DIỆN",
      force_take: "CƯỚP QUYỀN THI",
      band_label: "Band",
      opens_at: "Mở lúc",
      closes_at: "Đóng lúc",
      motivation_need: "Bạn cần cố gắng thêm {{gap}} Band nữa để đạt Target!",
      motivation_reached: "Tuyệt vời! Bạn đã đạt Target.",
      // --- Teacher: tabs / shell / login (Phase 2) ---
      tab_DASHBOARD: "Tổng quan",
      tab_CLASSROOM: "Lớp học",
      tab_EXAM_BUILDER: "Soạn đề",
      tab_LIVE_ARENA: "Phòng thi trực tiếp",
      tab_ACADEMICS: "Học thuật",
      tab_FINANCE: "Tài chính",
      tab_STUDENTS: "Học viên",
      tab_DRIVE: "Kho tài liệu",
      tab_HISTORY: "Lịch sử",
      role_teacher: "GIÁO VIÊN",
      backend_status: "Trạng thái máy chủ Backend",
      contrast_mode: "Tương phản cao",
      login_heading: "Đăng nhập",
      login_welcome: "Chào mừng quay lại. Vui lòng nhập thông tin đăng nhập của bạn.",
      show_hide_pwd: "Hiện / ẩn mật khẩu",
      syncing_cloud: "ĐANG ĐỒNG BỘ DỮ LIỆU ĐÁM MÂY...",
      // --- Teacher: Dashboard ---
      dash_greeting: "Chào mừng trở lại",
      dash_overview: "Tổng quan kinh doanh & thao tác nhanh",
      dash_revenue_month: "DOANH THU THÁNG NÀY",
      dash_unpaid: "CÔNG NỢ TỒN ĐỌNG",
      dash_students_total: "TỔNG SỐ HỌC VIÊN",
      dash_sessions_month: "SỐ BUỔI HỌC THÁNG NÀY",
      dash_quick_actions: "THAO TÁC NHANH",
      dash_recent_sessions: "BUỔI HỌC GẦN ĐÂY",
      dash_no_data: "Chưa có dữ liệu.",
      dash_upcoming: "LỊCH SẮP TỚI",
      dash_announce_title: "Thông báo tới học viên",
      dash_announce_save: "Lưu thông báo",
      dash_announce_ph: "Nhập thông báo chạy chữ cho cổng học viên...",
      // --- Common (teacher) ---
      common_save: "Lưu",
      common_cancel: "Hủy",
      common_delete: "Xóa",
      common_edit: "Sửa",
      common_add: "Thêm",
      common_close: "Đóng",
      common_search: "Tìm kiếm...",
      common_confirm: "Xác nhận",
      common_actions: "Thao tác",
      common_name: "Tên",
      common_date: "Ngày",
      common_note: "Ghi chú",
      common_total: "Tổng",
      common_loading: "Đang tải...",
      common_none: "Không có",
      net_profit: "LỢI NHUẬN RÒNG",
      total_teaching_hours: "TỔNG GIỜ DẠY",
      student_count: "SỐ HỌC VIÊN",
      total_debt: "CÔNG NỢ",
      drive_docs: "TÀI LIỆU DRIVE",
      total_revenue: "Tổng thu",
      pending_payment: "Chờ thanh toán",
      teaching_schedule: "Lịch dạy",
      add_schedule: "Đặt lịch mới",
      start_time: "GIỜ BẮT ĐẦU",
      student_label: "HỌC VIÊN",
      select_student: "Chọn HV...",
      location_link: "ĐỊA ĐIỂM / LINK",
      save_schedule: "LƯU LỊCH",
      remind_schedule: "Nhắc lịch",
      no_schedule_day: "Trống lịch ngày này.",
      sched_duration: "THỜI LƯỢNG (PHÚT)",
      att_present: "Có mặt",
      att_absent: "Vắng",
      att_done: "Đã học",
      att_was_absent: "Vắng",
      att_confirm: "Xác nhận {{name}} đã học? Tự động tính phí {{money}}.",
      att_billed: "Đã ghi nhận buổi học & tính phí thành công!",
      att_reschedule: "Đặt lại",
      ea_title: "Phân tích lỗi theo dạng câu hỏi",
      ea_center: "Tỉ lệ đúng toàn trung tâm",
      ea_no_data: "Chưa có dữ liệu bài thi để phân tích.",
      ea_weakest: "Yếu nhất",
      ea_questions_n: "{{n}} lượt trả lời",
      ea_students_weak: "Học viên cần tập trung",
      ai_tip: "Tạo nhận xét bằng AI",
      ai_generating: "AI đang viết...",
      ai_error: "Tạo nhận xét AI thất bại. Kiểm tra API key / kết nối.",
      chart_band_title: "Tiến bộ band theo thời gian",
      chart_pick_student: "Chọn học viên ở bộ lọc bên dưới để xem biểu đồ tiến bộ band.",
      chart_my_progress: "Tiến bộ band của tôi",
      chart_no_progress: "Hoàn thành một bài thi để xem biểu đồ tiến bộ.",
      explain_why: "Vì sao?",
      explain_loading: "Đang giải thích...",
      explain_title: "Giải thích",
      eb_transcribe: "Nghe & tạo transcript (AI)",
      eb_transcribing: "Đang nghe audio...",
      eb_transcript_ready: "Đã có transcript",
      eb_transcript_hint: "Tạo transcript để phần giải thích trích dẫn được lời thoại.",
      eb_tr_uploading: "Đang tải audio lên...",
      eb_tr_segment: "Đang nghe phút {{a}}-{{b}}...",
      vocab_words: "từ",
      vocab_due: "cần ôn",
      vocab_generate: "Tạo từ đề đã làm",
      vocab_generating: "Đang phân tích...",
      vocab_empty_hint: "Bấm Tạo — AI đọc các đề bạn đã làm và chọn ra từ lẻ, cụm động từ, thành ngữ, kết hợp từ & cấu trúc ngữ pháp đáng học, riêng cho bạn.",
      vocab_flashcard: "Thẻ ghi nhớ",
      vocab_list: "Danh sách",
      vocab_done_today: "Đã ôn hết từ cho hôm nay!",
      vocab_tap_flip: "Chạm để lật",
      vocab_pronounce: "Nghe phát âm",
      vocab_forgot: "Chưa nhớ",
      vocab_remember: "Đã nhớ",
      vocab_cat_all: "Tất cả",
      vocab_cat_word: "Từ lẻ",
      vocab_cat_phrasal_verb: "Cụm động từ",
      vocab_cat_idiom: "Thành ngữ",
      vocab_cat_collocation: "Kết hợp từ",
      vocab_cat_grammar: "Cấu trúc",
      vocab_kinds_title: "Nhóm mục muốn AI ưu tiên trích",
      vocab_kinds_hint: "Chọn nhóm AI sẽ tập trung cho lần bấm Tạo tiếp theo. Phải bật ít nhất một nhóm.",
      vocab_count_label: "Số lượng muốn tạo",
      vocab_from_test: "trích từ đề",
      announce_to_students: "THÔNG BÁO CHUNG CHO HỌC VIÊN",
      announce_ph: "VD: Nghỉ lễ 30/4...",
      clear_announce: "Xóa thông báo",
      clean_logs: "Dọn dẹp Log",
      confirm_clear_logs: "Xóa toàn bộ log lỗi?",
      system_healthy: "Hệ thống đang hoạt động ổn định, không có lỗi nào được ghi nhận.",
      zoom_ph: "VD: Zoom...",
      // --- SEB guide ---
      seb_title: "YÊU CẦU TRÌNH DUYỆT BẢO MẬT (SEB)",
      seb_intro_a: "Bài thi",
      seb_intro_b: "được thiết lập ở chế độ bảo mật nghiêm ngặt. Bạn KHÔNG THỂ làm bài trên trình duyệt thông thường (Chrome/Safari/Edge).",
      seb_steps_header: "HƯỚNG DẪN CÁC BƯỚC ĐỂ VÀO THI:",
      seb_back_btn: "ĐÃ HIỂU VÀ QUAY LẠI",
      // --- Classroom ---
      cls_select_student_label: "CHỌN HỌC VIÊN",
      cls_select_student_opt: "-- Chọn học viên --",
      cls_teacher_incharge: "Giáo viên phụ trách:",
      cls_skills_label: "KỸ NĂNG GIẢNG DẠY (TÍCH CHỌN)",
      cls_manual_input: "+ Nhập tay",
      cls_manual_title: "CỘNG GIỜ THỦ CÔNG",
      cls_minutes: "SỐ PHÚT",
      cls_seconds: "SỐ GIÂY (LẺ)",
      cls_save_money: "LƯU THÀNH TIỀN",
      cls_start: "BẮT ĐẦU",
      cls_pause: "TẠM DỪNG",
      cls_save_result: "LƯU KẾT QUẢ",
      cls_ready: "SẴN SÀNG",
      cls_live: "ĐANG CHẠY",
      // --- Finance ---
      fin_overview: "TỔNG QUAN TÀI CHÍNH",
      fin_total_in: "TỔNG THU",
      fin_total_out: "TỔNG CHI",
      fin_net: "LÃI RÒNG",
      fin_income_report: "Báo cáo Nguồn Thu",
      fin_expense_report: "Báo cáo Nguồn Chi",
      fin_teaching: "giảng dạy",
      fin_extra_income: "Cộng thêm thu nhập đột xuất:",
      fin_reason_in: "Lý do thu...",
      fin_reason_out: "Lý do chi...",
      fin_amount: "Tiền...",
      // --- Drive ---
      drv_upload_title: "TẢI LÊN TÀI LIỆU (DRIVE HUB)",
      drv_doc_name: "TÊN TÀI LIỆU",
      drv_doc_name_ph: "VD: Cam 18 Test 1...",
      drv_link_label: "LINK (DRIVE/DROPBOX)",
      drv_audience: "ĐỐI TƯỢNG XEM",
      drv_aud_all: "Tất cả học viên (Public)",
      drv_aud_teachers: "Chỉ Giáo viên (Private)",
      drv_aud_specific: "Giao cho cá nhân",
      drv_pick_student: "CHỌN HỌC VIÊN NHẬN TÀI LIỆU NÀY",
      drv_pick_student_opt: "-- Chọn một học viên --",
      drv_save_doc: "+ LƯU TÀI LIỆU",
      drv_internal: "NỘI BỘ GIÁO VIÊN",
      drv_common: "TÀI LIỆU CHUNG (ALL)",
      drv_personal: "TÀI LIỆU CÁ NHÂN",
      drv_open: "Mở",
      drv_assigned_to: "GIAO CHO:",
      // --- Pending exam (pre-start) ---
      pend_loading: "Đang tải dữ liệu bài thi...",
      pend_loading_desc: "Hệ thống đang tải bảo mật hình ảnh và âm thanh xuống máy của bạn.",
      pend_loaded: "Tải dữ liệu thành công",
      pend_loaded_desc: "Tất cả dữ liệu đã được lưu trữ (cache) offline an toàn.",
      // --- Live Arena ---
      live_count_suffix: "Học viên đang thi",
      live_exam_label: "Đề thi:",
      live_done: "Đã làm {{a}}/{{b}} câu",
      live_cheat: "HỆ THỐNG PHÁT HIỆN GIAN LẬN: Ứng viên vừa chuyển Tab / Thoát toàn màn hình!",
      live_send_msg: "Gửi thông báo trực tiếp",
      live_empty: "Hiện tại không có học viên nào đang làm bài thi.",
      // --- Students ---
      stu_push_title: "Gửi Thông Báo Hệ Thống (Push Notification)",
      stu_push_target: "ĐỐI TƯỢNG NHẬN",
      stu_push_all: "Tất cả học viên",
      stu_push_subject: "TIÊU ĐỀ THÔNG BÁO",
      stu_push_subject_ph: "VD: Lịch học gấp...",
      stu_push_content: "NỘI DUNG",
      stu_push_content_ph: "VD: Tối nay 8h học bù nhé...",
      stu_push_send: "GỬI THÔNG BÁO",
      stu_push_note: "* Thông báo sẽ hiển thị trực tiếp trên màn hình thiết bị (điện thoại/máy tính) của học sinh ngay khi họ truy cập web. Yêu cầu học sinh bấm Cấp Quyền (Allow Notifications) trên trình duyệt.",
      stu_edit_title: " Chỉnh sửa học viên",
      stu_add_title: "Thêm học viên mới",
      stu_fullname: "HỌ TÊN",
      stu_login_email: "EMAIL ĐĂNG NHẬP",
      stu_dob: "NGÀY SINH (Tùy chọn)",
      stu_rate: "HỌC PHÍ/H",
      stu_cefr_now: "CEFR (NOW)",
      stu_target_band: "TARGET BAND",
      stu_os_coins: "OS COINS (TẶNG/TRỪ XU)",
      stu_coins_ph: "Nhập số xu...",
      stu_update: "CẬP NHẬT",
      stu_add_new: "THÊM MỚI",
      stu_search_ph: "Tìm kiếm học viên theo tên hoặc email...",
      stu_sort_name: "Sắp xếp: Tên (A-Z)",
      stu_sort_exp: "Sắp xếp: Giờ học (EXP)",
      stu_sort_debt: "Sắp xếp: Nợ học phí",
      stu_only_debt: "Chỉ hiện học sinh đang nợ",
      stu_export_csv: "Excel",
      stu_no_email: "Chưa có email",
      hub_overview: "Tổng quan",
      hub_students_count: "{{n}} học viên",
      hub_tab_results: "Kết quả thi",
      hub_tab_sessions: "Buổi học",
      hub_tab_finance: "Học phí & Quà",
      hub_total_students: "Tổng học viên",
      hub_debtors: "Đang nợ",
      hub_total_debt: "Tổng học phí nợ",
      hub_total_hours: "Tổng giờ dạy",
      hub_avg_band: "Band TB",
      hub_hours: "Tổng giờ",
      hub_tests: "Bài thi",
      hub_debt_short: "Học phí nợ",
      hub_coins: "OS Coins",
      hub_no_band: "Chưa có dữ liệu band.",
      hub_unpaid_sessions: "Các buổi chưa thu",
      hub_no_unpaid: "Không còn nợ buổi nào.",
      hub_export_pdf: "Xuất PDF",
      hub_copy_sms: "Copy SMS",
      hub_evidence_note: "Tin nhắn riêng (hiện cho HV)",
      stu_debt_label: "Đang nợ:",
      stu_private_ph: "Nhập lời nhắn riêng cho HV này...",
      stu_debt_inapp: "Đòi Nợ In-App",
      stu_reward_coins: "Thưởng Xu",
      gift_manual_btn: "Tặng quà",
      gift_modal_title: "Tặng quà thủ công",
      gift_modal_sub: "Gửi thẳng vào túi đồ học viên — không cần xu hay gacha.",
      gift_sec_coins: "OS Coins",
      gift_sec_consumable: "Phần thưởng thực tế (vật phẩm)",
      gift_sec_permanent: "Cosmetic & Danh hiệu (vĩnh viễn)",
      gift_custom_label: "Vật phẩm tự nhập",
      gift_custom_ph: "VD: 1 buổi học kèm miễn phí",
      gift_qty: "SL",
      gift_grant: "Tặng",
      gift_owned: "Đã có",
      gift_done: "Đã gửi quà cho học viên!",
      gift_coins_amount: "Số lượng",
      // --- History ---
      hist_filter_print: "LỌC THEO HỌC VIÊN ĐỂ IN BÁO CÁO",
      hist_all: "Tất cả",
      hist_delete: "XÓA",
      hist_print_pdf: "IN BÁO CÁO (PDF)",
      hist_export_excel: "XUẤT EXCEL",
      hist_total_hours: "TỔNG GIỜ DẠY",
      hist_total_income: "TỔNG THU NHẬP",
      hist_skill_dist: "Phân bổ thời gian theo kỹ năng",
      hist_col_student: "HỌC VIÊN",
      hist_col_date: "NGÀY",
      hist_col_teacher: "GIÁO VIÊN",
      hist_col_fee: "HỌC PHÍ",
      hist_teacher_notes: "NHẬN XÉT CỦA GIÁO VIÊN",
      hist_notes_ph: "Nhập nhận xét chi tiết...",
      hist_collect_fast: "Thu tiền nhanh",
      hist_collected: "Đã thu tiền",
      hist_delete_session: "Xóa buổi",
      hist_no_match: "Không có lịch sử nào phù hợp.",
      hist_print_hint: "Vui lòng chọn một học sinh trong bộ lọc ở trang Web trước khi In để tạo Báo Cáo.",
      // --- Academics ---
      acad_calc_title: "TÍNH ĐIỂM NHANH (BAND SCORE)",
      acad_calc_ph: "Số câu đúng (VD: 32)...",
      acad_top_students: "TOP HỌC VIÊN CÀY CUỐC",
      acad_band_dist: "PHỔ ĐIỂM (BAND DISTRIBUTION)",
      acad_tests_unit: "bài",
      acad_results_title: "KẾT QUẢ BÀI THI & GIÁM SÁT",
      acad_delete_selected: "XÓA ĐÃ CHỌN",
      acad_export_all: "XUẤT EXCEL TỔNG",
      acad_search_name: "TÌM THEO TÊN HỌC VIÊN",
      acad_search_ph: "Nhập tên học sinh...",
      acad_filter_student: "LỌC THEO HỌC VIÊN",
      acad_all_students: "Tất cả học viên",
      acad_filter_quiz: "LỌC THEO ĐỀ THI",
      acad_all_quizzes: "Tất cả đề thi",
      acad_avg_quiz: "Điểm trung bình đề này:",
      acad_filter_band: "LỌC THEO BAND ĐIỂM",
      acad_all_bands: "Tất cả Band",
      acad_band_7up: "Band 7.0 trở lên",
      acad_band_under6: "Dưới Band 6.0",
      acad_min: "phút",
      acad_sec: "giây",
      acad_started: "Bắt đầu:",
      acad_ended: "Kết thúc:",
      acad_duration: "Thời gian:",
      acad_ip: "IP Mạng:",
      acad_device: "Thiết bị:",
      acad_cheat_warn: "Cảnh báo: Phát hiện {{n}} lần rời khỏi màn hình thi!",
      acad_no_cheat: "Không phát hiện gian lận.",
      acad_feedback_label: "NHẬN XÉT DÀNH CHO HỌC VIÊN NÀY:",
      acad_feedback_ph: "Nhập nhận xét...",
      acad_copy_zalo: "Copy Zalo",
      acad_fb1: "Sai chính tả nhiều",
      acad_fb2: "Phân bổ thời gian chưa tốt",
      acad_fb3: "Cần luyện thêm Multiple Choice",
      acad_fb4: "Very good!",
      acad_export_detail: "Xuất Excel Chấm Câu",
      acad_ban_ip: "Cấm IP",
      acad_cancel_test: "Hủy bài",
      acad_no_results: "Không tìm thấy kết quả nào phù hợp.",
      // --- Review Quiz ---
      rev_test_part: "Phần kiểm tra",
      rev_part: "Phần thi",
      rev_mcq: "Trắc nghiệm",
      rev_total_band: "Tổng điểm (Band)",
      rev_detail: "Chi tiết bài thi",
      rev_correct: "Trả lời đúng",
      rev_incorrect: "Trả lời sai",
      rev_skipped: "Đã bỏ qua",
      rev_questions_unit: "Câu",
      rev_result: "Kết quả làm bài",
      rev_time: "Thời gian làm bài",
      rev_accuracy: "Độ chính xác",
      rev_correct_count: "Câu đúng",
      // --- Exam Builder ---
      eb_title: "KHO ĐỀ THI & HỆ THỐNG BIÊN SOẠN",
      eb_upload_docx: "NẠP ĐỀ (.DOCX)",
      eb_create_new: "Tạo đề mới",
      eb_edit_key: "CHỈNH SỬA BỘ ĐÁP ÁN:",
      eb_q: "Câu",
      eb_answer_ph: "Nhập đáp án...",
      eb_save_key: "LƯU BỘ KEY MỚI",
      eb_nav_title: "ĐIỀU HƯỚNG CÂU HỎI",
      eb_quiz_fallback: "Đề thi",
      eb_questions_unit: "câu hỏi",
      eb_no_questions: "Chưa có câu hỏi. Bấm nút bên dưới để thêm.",
      eb_type_blank: "Điền từ",
      eb_type_match: "Nối",
      eb_type_drag: "Kéo thả",
      eb_type_multi: "Nhiều đáp án",
      eb_type_choice: "Trắc nghiệm",
      eb_add_question: "Thêm câu hỏi",
      eb_add_blank_group: "Nhóm điền từ",
      eb_title_ph: "Tên đề thi...",
      eb_settings: "Cài đặt",
      eb_close: "Đóng",
      eb_save: "Lưu",
      eb_passage_title: "BÀI ĐỌC / NGỮ CẢNH",
      eb_passage_ph: "Nhập nội dung bài đọc cho phần {{n}}...",
      eb_question_list: "DANH SÁCH CÂU HỎI",
      eb_opt_choice: "Trắc nghiệm (1 đáp án)",
      eb_opt_multi: "Nhiều lựa chọn (Nhiều đáp án)",
      eb_opt_match: "Nối đặc điểm (Matching Grid)",
      eb_opt_blank: "Điền từ (Inline Blank)",
      eb_opt_drag: "Kéo - Thả (Drag Drop)",
      eb_subtype_none: "-- Dạng bài (Tag) --",
      eb_move_up: "Chuyển lên",
      eb_move_down: "Chuyển xuống",
      eb_duplicate: "Nhân bản",
      eb_delete: "Xóa",
      eb_instructions_label: "ĐỀ BÀI / HƯỚNG DẪN (dùng chung cho cả nhóm)",
      eb_instructions_ph: "VD: Questions 1–5. Choose the correct letter A, B, C or D.",
      eb_inline_para: "ĐOẠN VĂN ĐIỀN TỪ (INLINE INPUT)",
      eb_blank_hint_a: "Gõ phím",
      eb_blank_hint_b: "vào đoạn văn để đục lỗ.",
      eb_renumber_title: "Đánh số lại các ô trống theo thứ tự xuất hiện",
      eb_renumber: "Đánh số lại",
      eb_insert_blank: "Chèn ô trống mới",
      eb_para_ph: "Soạn thảo đoạn văn liền mạch ở đây, y như Word...",
      eb_blank_answers: "ĐÁP ÁN CHO CÁC Ô TRỐNG BÊN TRÊN:",
      eb_blank_missing_title: "Bạn chưa gõ ký tự lỗ trống này trong đoạn văn!",
      eb_blank_answer_ph: "VD: True/False...",
      eb_question_content: "NỘI DUNG CÂU HỎI",
      eb_answer_label: "ĐÁP ÁN",
      eb_select_n: "CHỌN",
      eb_pick_correct: "Chọn làm đáp án đúng",
      eb_option_ph: "Nhập lựa chọn {{letter}}...",
      eb_adv_settings: "Cài đặt nâng cao",
      eb_basic_info: "THÔNG TIN CƠ BẢN",
      eb_folder: "THƯ MỤC",
      eb_exam_type: "LOẠI ĐỀ",
      eb_time_minutes: "THỜI GIAN (PHÚT)",
      eb_max_attempts: "SỐ LẦN LÀM TỐI ĐA",
      eb_audio_link: "LINK AUDIO (MP3)",
      eb_audio_ph: "Nhập đường dẫn file âm thanh...",
      eb_upload_audio: "Tải audio lên",
      eb_audio_uploading: "Đang tải audio...",
      eb_audio_ready: "Đã lưu trên web của bạn",
      eb_audio_upload_failed: "Tải audio lỗi",
      eb_audio_hosted_hint: "Tải MP3/M4A/WAV để tạo link audio sạch của web mình.",
      eb_audio_mode: "CHẾ ĐỘ AUDIO",
      eb_audio_strict: "Thi thật (nghe 1 lần)",
      eb_audio_practice: "Luyện tập (tua/nghe lại)",
      eb_security_sched: "BẢO MẬT & LỊCH THI",
      eb_pin: "MẬT KHẨU (PIN)",
      eb_pin_ph: "Để trống nếu không khóa",
      eb_open_at: "MỞ ĐỀ LÚC",
      eb_close_at: "ĐÓNG ĐỀ LÚC",
      eb_require_seb: "Yêu cầu dùng SEB Browser",
      eb_active_on: "Đang bật (Học viên thấy được)",
      eb_active_off: "Đang tắt (Bản nháp)",
      eb_distribution: "PHÂN PHỐI (AUDIENCE)",
      eb_specific: "Chỉ định cụ thể từng HS",
      eb_pick_students: "TÍCH CHỌN HỌC VIÊN ĐƯỢC LÀM BÀI:",
      eb_search_results: "Kết quả tìm kiếm",
      eb_new_folder: "Thư mục mới",
      eb_search_quiz_ph: "Tìm kiếm đề thi...",
      eb_folders_area: "KHU VỰC THƯ MỤC",
      eb_quiz_list: "DANH SÁCH ĐỀ THI",
      eb_move_folder: "Chuyển thư mục",
      eb_lock_quiz: "Khóa đề",
      eb_unlock_quiz: "Mở khóa",
      eb_locked_title: "Đã khóa",
      eb_minutes: "phút",
      eb_questions_short: "câu",
      eb_public: "Public:",
      eb_st_locked: "Khóa",
      eb_st_open: "Đang mở",
      eb_st_off: "Tắt",
      eb_preview_exam: "Thi thử",
      eb_download_key: "Tải Key",
      eb_recalc: "Chấm lại",
      eb_edit_key_btn: "Sửa Key",
      eb_edit_exam: "Sửa đề",
      eb_folder_empty: "Thư mục này rỗng.",
      // --- Tooltips ---
      tip_pin_student: "Ghim học viên",
      tip_voice_input: "Nhập bằng giọng nói (Yêu cầu Chrome)",
      tip_sync_server: "Đồng bộ giờ máy chủ",
      tip_dict: "Click để xem từ điển",
      tip_pwd_required: "Yêu cầu mật khẩu",
      tip_seb_required: "Bắt buộc thi bằng phần mềm SEB",
      tip_test_ui: "Kiểm tra giao diện trước khi thi để đảm bảo không có lỗi hiển thị"
    }
  }
};

// ==========================================
// I18N: NGÔN NGỮ THEO VAI TRÒ (teacher/student độc lập)
// Một instance i18n duy nhất; lưu pref riêng theo vai trò trong localStorage.
// Mặc định cả hai vai trò = "en". Màn hình thi luôn ép "en".
// ==========================================
const getRoleLang = (role: "TEACHER" | "STUDENT" | null): string => {
  try {
    const v = role ? localStorage.getItem("ielts_lang_" + role) : null;
    return v === "vi" || v === "en" ? v : "en";
  } catch { return "en"; }
};
const setRoleLang = (role: "TEACHER" | "STUDENT" | null, lng: string) => {
  try { if (role) localStorage.setItem("ielts_lang_" + role, lng); } catch {}
  i18n.changeLanguage(lng);
};

i18n.use(initReactI18next).init({
  resources,
  lng: "en", // Khởi tạo "en"; sẽ áp pref theo vai trò sau khi đăng nhập (xem effect userRole)
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

interface VocabCard { id: string; word: string; phonetic?: string; pos?: string; meaning?: string; example?: string; cefr?: string; category?: string; evidence?: string; box: number; due: number; createdAt: number; }
interface Student { id: string; name: string; phone: string; rate: number; target: string; cefr: string; exp: number; level: number; email?: string; savedVocabs?: string[]; vocabNotebook?: VocabCard[]; vocabTombstones?: string[]; isPinned?: boolean; privateMessage?: string; dob?: string; coins?: number; myRewards?: string[]; inventory?: { consumables: Record<string, number>; permanents: string[]; equippedTitle?: string; equippedTheme?: string; equippedFrame?: string; equippedPet?: string; reviewedQuizzes?: string[]; }; lastLoginDate?: string; currentStreak?: number; currentSessionId?: string; sessionClaimedAt?: number; activeExamId?: string; debtMessage?: string; pendingNotifications?: {id: string, title: string, body: string}[]; }
interface Rubric { vocab: string; grammar: string; fluency: string; task: string; }
interface Session { id: string | number; studentId: string; studentName: string; teacher: string; skills: string[]; date: string; duration: number; rate: number; earnings: number; notes: string; rubric: Rubric; isPaid: boolean; }
interface Schedule { id: string; date: string; time: string; teacher: string; studentId: string; studentName: string; subject: string; location: string; duration?: number; status?: "PENDING" | "DONE" | "ABSENT"; billed?: boolean; }
interface SharedLink { id: string; title: string; url: string; date: string; audience: "TEACHERS" | "ALL_STUDENTS" | "SPECIFIC_STUDENT"; targetStudentId: string; targetStudentName: string; }
interface Transaction { id: string; title: string; amount: number; date: string; type: "INCOME" | "EXPENSE"; }
interface SystemLog { id: string; errorType: string; message: string; context?: string; timestamp: string; email?: string; }
interface RewardCode { code: string; studentId: string; studentName: string; item: string; createdAt: number; redeemed: boolean; redeemedAt?: number; redeemedBy?: string; }

type QuestionType = "CHOICE" | "BLANK" | "CHOICE_MULTIPLE" | "MATCHING" | "DRAG_DROP" | "DRAG_DROP_HEADING" | "SHORT_ANSWER";
interface QuizQuestion { id: string; type: QuestionType; subType?: string; instruction?: string; groupContext?: string; text: string; options?: string[]; correctAnswer: string | number | number[]; passageIndex?: number; }
interface QuizSection { passage: string; questions: QuizQuestion[]; }
interface Quiz { _activePassageTab?: number; _showSettings?: boolean;  id: string; title: string; type: "Reading" | "Listening" | "Integrated" | string; timeLimit: number; maxAttempts: number; questions: QuizQuestion[]; sections?: QuizSection[]; active: boolean; passage?: string; transcript?: string; images?: string[]; audioUrl?: string; audioMode?: 'strict' | 'practice'; audience?: "ALL" | "SPECIFIC"; targetStudentIds?: string[]; scheduledStart?: string; scheduledEnd?: string; isLocked?: boolean; passcode?: string; internalNote?: string; tag?: string; isSEBRequired?: boolean; folder?: string; }
interface QuizResult { id: string; quizId: string; quizTitle: string; studentId: string; studentName: string; date: string; score: number; total: number; band: number | string; cheatCount: number; startTime?: string; endTime?: string; durationSeconds?: number; deviceInfo?: string; ipAddress?: string; teacherFeedback?: string; answers: Record<string, any>; scratchpad?: string; flaggedQuestions?: string[]; isRead?: boolean; }

const getQuestionPointCount = (q: any) =>
  q?.type === "CHOICE_MULTIPLE" && Array.isArray(q.correctAnswer)
    ? Math.max(1, q.correctAnswer.length)
    : 1;

const getQuizPointTotal = (quiz: any) =>
  (quiz?.questions || []).reduce((sum: number, q: any) => sum + getQuestionPointCount(q), 0);

const getQuizQuestionNumber = (questions: any[] = [], qId: string) => {
  let n = 1;
  for (const q of questions) {
    if (q?.id === qId) return n;
    n += getQuestionPointCount(q);
  }
  const fallbackIdx = questions.findIndex((q: any) => q?.id === qId);
  return fallbackIdx >= 0 ? fallbackIdx + 1 : 1;
};

const getQuizQuestionLabel = (questions: any[] = [], q: any) => {
  const start = getQuizQuestionNumber(questions, q?.id);
  const end = start + getQuestionPointCount(q) - 1;
  return end > start ? `${start}-${end}` : `${start}`;
};

const getChoiceMultipleScore = (q: any, studentAns: any) => {
  const correctArr = (Array.isArray(q.correctAnswer) ? q.correctAnswer : [q.correctAnswer]).map(Number);
  const selectedArr = Array.isArray(studentAns)
    ? studentAns.map(Number)
    : (studentAns !== undefined && studentAns !== "" ? [Number(studentAns)] : []);
  const selected = Array.from(new Set(selectedArr.filter(Number.isFinite)));
  return selected.filter(x => correctArr.includes(x)).length;
};
interface LiveSession { id: string; studentId: string; studentName: string; quizId: string; quizTitle: string; answeredCount: number; totalQ: number; lastUpdate: number; isCheating: boolean; progressPct: number; }

// ==========================================
// UTILS
// ==========================================
const safeString = (val: any) => (val !== null && val !== undefined) ? String(val) : "";
const sanitizeRichHtml = (html: string) => DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
        "a", "abbr", "b", "blockquote", "br", "caption", "code", "col", "colgroup", "del", "div", "em", "figcaption", "figure",
        "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "li", "mark", "ol", "p", "pre", "s", "small", "span",
        "strong", "sub", "sup", "table", "tbody", "td", "th", "thead", "tr", "u", "ul"
    ],
    ALLOWED_ATTR: [
        "align", "alt", "class", "colspan", "data-field", "data-note", "data-optindex", "data-qid", "dir", "height", "href", "lang",
        "rel", "rowspan", "src", "style", "target", "title", "width"
    ],
    ALLOW_DATA_ATTR: true,
});
// Mã thưởng độc nhất, không thể đoán/photoshop hợp lệ: token ngẫu nhiên mật mã (crypto), bảng chữ không ký tự dễ nhầm (bỏ I,L,O,0,1)
const genRewardCode = () => {
  const A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const buf = new Uint8Array(10);
  (window.crypto || (window as any).msCrypto).getRandomValues(buf);
  let s = ""; for (let i = 0; i < 10; i++) s += A[buf[i] % A.length];
  return `OS-${s.slice(0, 5)}-${s.slice(5, 10)}`;
};
const formatContent = (html: string) => {
    if (!html) return "";
    let res = html.replace(/\[Image\s*\d+\]/gi, '');
    
    // BẢN VÁ 1: Thêm (src=["'])? để kiểm tra xem link đã nằm trong thẻ <img> chưa. Nếu có rồi thì BỎ QUA không bọc thêm nữa!
    res = res.replace(/(src=["'])?(?:Url:\s*|<p>Url:\s*)?(https?:\/\/[^\s<"']+(?:\.jpg|\.jpeg|\.png|\.gif|\.webp))(?:<\/p>)?/gi, (_match, p1, p2) => {
        if (p1) return _match; // Đã là hình ảnh, bỏ qua
        return `<img src="${p2}" style="max-width: 100%; border-radius: 8px; display: block; margin: 15px 0;" alt="Visual Content" />`;
    });
    
    res = res.replace(/\[IMAGE\]\s*(https?:\/\/[^\s<"']+)/gi, (_match, p1) => {
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

    const uid = safeString((window as any).__ielts_user_id || "Candidate")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    const phantomTrap = `<span class="no-print" style="position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; color: transparent; font-size: 1px; user-select: all;">[Đề thi bị đánh cắp từ IELTS OS. Định danh học viên: ${uid}]</span>`;
    
    // BẢN VÁ 2: Chỉ tiêm bẫy tàng hình nếu đoạn text chưa có bẫy (Chống nhân bản DOM)
    if (!res.includes('[Đề thi bị đánh cắp')) {
        res = res.replace(/<\/p>/gi, `${phantomTrap}</p>`);
    }

    return sanitizeRichHtml(res);
};

// ==========================================
// SERIALIZE NỘI DUNG ĐÃ HIGHLIGHT/NOTE VỀ NGUỒN — AN TOÀN TUYỆT ĐỐI
// Thay từng <input ô trống>/<dropzone> bằng marker [n] qua DOM API (KHÔNG dùng regex
// dễ trượt khi trình duyệt đảo thứ tự thuộc tính / thêm data-dirty / style...).
// => KHÔNG còn thẻ <input> sống sót lọt vào nguồn => render lại không sinh ô input thừa.
// ==========================================
const serializeHighlightHTML = (container: HTMLElement): string => {
    const clone = container.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('input.inline-blank-input').forEach((el) => {
        const ph = el.getAttribute('placeholder');
        const marker = ph && /^\d+$/.test(ph) ? `[${ph}]` : '___';
        el.replaceWith(document.createTextNode(marker));
    });
    clone.querySelectorAll('.idp-dropzone').forEach((el) => {
        const num = el.getAttribute('data-num');
        el.replaceWith(document.createTextNode(num && /^\d+$/.test(num) ? `[${num}]` : '___'));
    });
    clone.querySelectorAll('.idp-heading-slot-render').forEach((el) => {
        el.replaceWith(document.createTextNode('[HEADING_SLOT]'));
    });
    // Gỡ lớp vùng-chọn-tạm nếu còn sót, giữ nguyên text bên trong.
    clone.querySelectorAll('.idp-temp-selection').forEach((el) => {
        const parent = el.parentNode; if (!parent) return;
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        parent.removeChild(el);
    });
    return clone.innerHTML;
};

// ==========================================
// BẢN VÁ: ĐỘNG CƠ MàHÓA DỊ BIỆT (EXTREME OBFUSCATOR)
// Chống lộ 100% nội dung, cấu trúc, độ dài từ, khoảng cách.
// Giữ lại duy nhất các thẻ HTML và cú pháp số câu hỏi để DOM không sập.
// ==========================================
const obfuscateHTML = (html?: string) => {
    if (!html) return "";
    
    // 1. Phân tách HTML tags và Text content để không làm vỡ thẻ
    return html.replace(/(<[^>]+>)|([^<]+)/g, (match, tag, text) => {
        if (tag) return match; 
        if (!text.trim()) return text; 
        
        // 2. Bảo toàn CÚ PHÁP CU HỎI (VD: [1], (2), 12., _____, ......)
        // Dùng ký tự đặc biệt \uFFFF làm mốc tách an toàn
        const safeText = text.replace(/(\[\d+\]|\(\d+\)|\b\d+\b\.|_{2,}|\.{4,})/g, (m: string) => `\uFFFF${m}\uFFFF`);
        
        // 3. Biến đổi DỊ BIỆT phần chữ còn lại
        return safeText.split('\uFFFF').map((chunk: string) => {
            // Nếu là khối bảo toàn -> trả về nguyên vẹn để thuật toán Regex Nội Suy thẻ <input> hoạt động
            if (chunk.match(/^(\[\d+\]|\(\d+\)|\b\d+\b\.|_{2,}|\.{4,})$/)) return chunk;
            
            // Nếu là text thường -> Phá vỡ hoàn toàn độ dài và ký tự
            // Thay thế mỗi từ bằng một khối block ngẫu nhiên từ 2-8 ký tự
            return chunk.replace(/[a-zA-Z0-9\u00C0-\u1EF9]+/g, () => {
                const blocks = ["██", "▓▓▓", "▒▒▒▒", "░░░░░", "██████", "▓▓▓▓▓▓▓", "▒▒▒▒▒▒▒▒"];
                return blocks[Math.floor(Math.random() * blocks.length)];
            });
        }).join('');
    });
};

const createTestUIQuiz = (q: Quiz): Quiz => {
    return {
        ...q,
        title: "ENCRYPTED UI TEST",
        passage: obfuscateHTML(q.passage || ""),
        audioUrl: "https://actions.google.com/sounds/v1/alarms/beep_short.ogg",
        // CHỐNG LỘ BÀI ĐỌC: đề Reading nhiều phần render từ sections[].passage (KHÔNG phải q.passage).
        // Phải mã hóa cả passage lẫn questions bên trong từng section, nếu không cột bài đọc bên trái lộ nguyên văn.
        sections: q.sections?.map(sec => ({
            ...sec,
            passage: obfuscateHTML(sec.passage || ""),
            questions: (sec.questions || []).map(qst => ({
                ...qst,
                text: obfuscateHTML(qst.text),
                instruction: obfuscateHTML(qst.instruction || ""),
                groupContext: obfuscateHTML(qst.groupContext || ""),
                options: qst.options?.map(opt => obfuscateHTML(opt)),
            }))
        })),
        questions: q.questions.map(qst => ({
            ...qst,
            text: obfuscateHTML(qst.text),
            instruction: obfuscateHTML(qst.instruction || ""),
            groupContext: obfuscateHTML(qst.groupContext || ""),
            options: qst.options?.map(opt => obfuscateHTML(opt)),
            correctAnswer: (qst.type === "CHOICE" ? 0 : "███") as any
        }))
    };
};
// ==========================================
// COMPONENT: BỘ ĐỆM BẢO VỆ DOM (DOM SHIELD)
// Khóa chặt HTML tĩnh thành Component độc lập. Ngăn chặn tuyệt đối React re-render phá DOM.
// ==========================================
const StaticHtmlBlock = React.memo(({ html, className, dataField, dataQid, dataOptIndex, style, tagName = "div" }: any) => {
    const Tag = tagName as any;
    return <Tag className={className} data-field={dataField} data-qid={dataQid} data-optindex={dataOptIndex} style={style} dangerouslySetInnerHTML={{__html: html}} />;
}, (prevProps, nextProps) => prevProps.html === nextProps.html && prevProps.dataOptIndex === nextProps.dataOptIndex && prevProps.dataQid === nextProps.dataQid);

// ==========================================
// COMPONENT: NÚT ĐỔI NGÔN NGỮ (EN | VI) — lưu pref theo vai trò
// ==========================================
const LanguageToggle = ({ role }: { role: "TEACHER" | "STUDENT" | null }) => {
    const { i18n } = useTranslation();
    const cur = i18n.language === "vi" ? "vi" : "en";
    return (
        <div style={{ display: "inline-flex", border: "1px solid rgba(0,0,0,0.12)", borderRadius: 8, overflow: "hidden", fontSize: 11.5, fontWeight: 800, flexShrink: 0 }} title="Ngôn ngữ / Language">
            {(["en", "vi"] as const).map((lng) => (
                <button key={lng} type="button" onClick={() => { if (lng !== cur) setRoleLang(role, lng); }}
                    style={{ padding: "5px 9px", border: "none", cursor: "pointer", background: cur === lng ? "#4338ca" : "transparent", color: cur === lng ? "#fff" : "#888", transition: "0.15s" }}>
                    {lng.toUpperCase()}
                </button>
            ))}
        </div>
    );
};

// ==========================================
// COMPONENT: BIỂU ĐỒ TIẾN BỘ BAND (SVG thuần, không thư viện)
// ==========================================
const BandTrendChart = ({ data, color = "#4338ca", height = 170 }: { data: { label: string; band: number }[]; color?: string; height?: number }) => {
    const pts = (data || [])
        .map(d => ({ label: d.label, band: Math.max(0, Math.min(9, Number(d.band))) }))
        .filter(d => !isNaN(d.band));
    if (pts.length === 0) return <div style={{ textAlign: "center", color: "#94a3b8", padding: 24, fontSize: 13 }}>—</div>;
    const W = 320, H = height, padL = 26, padR = 12, padT = 14, padB = 24;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const x = (i: number) => pts.length === 1 ? padL + plotW / 2 : padL + plotW * (i / (pts.length - 1));
    const y = (b: number) => padT + plotH * (1 - b / 9);
    const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.band).toFixed(1)}`).join(" ");
    const areaPath = `${linePath} L${x(pts.length - 1).toFixed(1)},${(padT + plotH).toFixed(1)} L${x(0).toFixed(1)},${(padT + plotH).toFixed(1)} Z`;
    const gridBands = [9, 8, 7, 6, 5, 4];
    const showLabel = (i: number) => pts.length <= 6 || i === 0 || i === pts.length - 1;
    return (
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} preserveAspectRatio="xMidYMid meet">
            <defs><linearGradient id="bandgrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.22" /><stop offset="100%" stopColor={color} stopOpacity="0.02" /></linearGradient></defs>
            {gridBands.map(b => (
                <g key={b}>
                    <line x1={padL} y1={y(b)} x2={W - padR} y2={y(b)} stroke="#e2e8f0" strokeWidth="1" strokeDasharray="3 3" />
                    <text x={padL - 5} y={y(b) + 3} textAnchor="end" fontSize="8" fill="#94a3b8" fontWeight="700">{b}</text>
                </g>
            ))}
            {pts.length > 1 && <path d={areaPath} fill="url(#bandgrad)" />}
            <path d={linePath} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            {pts.map((p, i) => (
                <g key={i}>
                    <circle cx={x(i)} cy={y(p.band)} r="3.5" fill="#fff" stroke={color} strokeWidth="2" />
                    <text x={x(i)} y={y(p.band) - 7} textAnchor="middle" fontSize="8.5" fontWeight="800" fill={color}>{p.band}</text>
                    {showLabel(i) && <text x={x(i)} y={H - 7} textAnchor="middle" fontSize="7.5" fill="#94a3b8">{p.label}</text>}
                </g>
            ))}
        </svg>
    );
};

// ==========================================
// COMPONENT: LOGO THƯƠNG HIỆU (mũ tốt nghiệp trên nền gradient)
// ==========================================
const BrandLogo = ({ size = 40, radius, stops, mark = "#ffffff" }: { size?: number; radius?: number; stops?: [string, string, string]; mark?: string }) => {
    const uid = React.useId().replace(/[:]/g, "");
    const rx = radius ?? Math.round(size * 0.28);
    const [s0, s1, s2] = stops ?? ["#4F46E5", "#6D28D9", "#9333EA"];
    return (
        <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: "block", flexShrink: 0 }}>
            <defs>
                <linearGradient id={`bg${uid}`} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor={s0} />
                    <stop offset="0.55" stopColor={s1} />
                    <stop offset="1" stopColor={s2} />
                </linearGradient>
            </defs>
            <rect x="0" y="0" width="48" height="48" rx={rx * 48 / size} fill={`url(#bg${uid})`} />
            <rect x="0" y="0" width="48" height="23" rx={rx * 48 / size} fill="#ffffff" opacity="0.10" />
            {/* Mũ tốt nghiệp */}
            <path d="M24 12.5 L41.5 20 L24 27.5 L6.5 20 Z" fill={mark} />
            <path d="M14 22.4 L14 29.2 C14 32.8 34 32.8 34 29.2 L34 22.4 L24 26.7 Z" fill={mark} opacity="0.80" />
            <path d="M41.5 20 L41.5 29.5" stroke={mark} strokeWidth="1.7" strokeLinecap="round" />
            <circle cx="41.5" cy="31.2" r="1.9" fill={mark} />
        </svg>
    );
};

// Chữ thương hiệu IELTS OS (OS nhấn màu/đậm)
const BrandWordmark = ({ size = 18, color = "#1D1D1F", osColor = "#6D28D9", light = false }: { size?: number; color?: string; osColor?: string; light?: boolean }) => (
    <span style={{ fontSize: size, fontWeight: 800, letterSpacing: -0.4, color, whiteSpace: "nowrap" }}>
        IELTS<span style={{ color: light ? "rgba(255,255,255,0.92)" : osColor, marginLeft: size * 0.22 }}>OS</span>
    </span>
);

// ==========================================
// ICON SET (line-style, Lucide-like) — thay emoji ở UI chrome. KHÔNG đụng phòng thi.
// ==========================================
const Ico = ({ name, size = 18, color = "currentColor", sw = 2, style }: { name: string; size?: number; color?: string; sw?: number; style?: any }) => {
    const paths: Record<string, any> = {
        eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></>,
        coins: <><circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/></>,
        clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
        users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>,
        file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/></>,
        calendar: <><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></>,
        gift: <><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/></>,
        bag: <><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></>,
        bell: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></>,
        wallet: <><path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V5"/><path d="M3 5v14a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-4"/><circle cx="16" cy="12" r="1"/></>,
        trending: <><path d="M22 7 13.5 15.5l-5-5L2 17"/><path d="M16 7h6v6"/></>,
        target: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></>,
        alert: <><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></>,
        trophy: <><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></>,
        gear: <><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z"/><circle cx="12" cy="12" r="3"/></>,
        book: <><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3Z"/></>,
        folder: <><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></>,
        pin: <><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></>,
        trash: <><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></>,
        search: <><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></>,
        user: <><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></>,
        list: <><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></>,
        monitor: <><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></>,
        home: <><path d="M3 9.5 12 3l9 6.5"/><path d="M5 10v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10"/><path d="M9 21v-6h6v6"/></>,
        lock: <><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></>,
        shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/></>,
        cards: <><rect x="3" y="5" width="13" height="14" rx="2"/><path d="M8 5V3M12 5V3M21 8v9a2 2 0 0 1-2 2"/></>,
        edit: <><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></>,
        chevronUp: <><path d="m18 15-6-6-6 6"/></>,
        chevronDown: <><path d="m6 9 6 6 6-6"/></>,
        check: <><path d="M20 6 9 17l-5-5"/></>,
        xcircle: <><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/></>,
        copy: <><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>,
        x: <><path d="M18 6 6 18"/><path d="m6 6 12 12"/></>,
        plus: <><path d="M12 5v14"/><path d="M5 12h14"/></>,
        arrowLeft: <><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></>,
        fileText: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></>,
        printer: <><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></>,
        key: <><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/></>,
        save: <><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></>,
        download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></>,
        cloud: <><path d="M17.5 19a4.5 4.5 0 0 0 0-9h-1.8A7 7 0 1 0 4 15.3"/></>,
        wrench: <><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></>,
        compass: <><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></>,
        hash: <><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></>,
        unlock: <><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></>,
        refresh: <><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></>,
        expand: <><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></>,
        moon: <><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></>,
        crown: <><path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7z"/><path d="M5 20h14"/></>,
        star: <><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></>,
        medal: <><path d="M7.21 15 2.66 7.14a2 2 0 0 1 .13-2.2L4.4 2.8A2 2 0 0 1 6 2h12a2 2 0 0 1 1.6.8l1.6 2.14a2 2 0 0 1 .14 2.2L16.79 15"/><circle cx="12" cy="17" r="5"/><path d="M11 17h2"/></>,
        sparkles: <><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/></>,
        mic: <><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></>,
        headphones: <><path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5a9 9 0 0 1 18 0v5a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/></>,
        volume2: <><path d="M11 5 6 9H2v6h4l5 4Z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></>,
        dot: <><circle cx="12" cy="12" r="6" fill="currentColor" stroke="none"/></>,
        arrowRight: <><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></>,
        arrowUp: <><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></>,
        arrowDown: <><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></>,
        moveV: <><polyline points="8 7 12 3 16 7"/><polyline points="8 17 12 21 16 17"/><line x1="12" y1="3" x2="12" y2="21"/></>,
        play: <><polygon points="6 4 20 12 6 20 6 4"/></>,
        music: <><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></>,
        link: <><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.5-1.5"/></>,
        ruler: <><path d="M21.3 8.7 8.7 21.3a1 1 0 0 1-1.4 0l-4.6-4.6a1 1 0 0 1 0-1.4L15.3 2.7a1 1 0 0 1 1.4 0l4.6 4.6a1 1 0 0 1 0 1.4Z"/><path d="m7.5 10.5 2 2"/><path d="m10.5 7.5 2 2"/><path d="m13.5 4.5 2 2"/></>,
        puzzle: <><path d="M19.4 12.5a2 2 0 1 0 0-3.4V7a2 2 0 0 0-2-2h-2.1a2 2 0 1 0-3.4 0H7a2 2 0 0 0-2 2v2.1a2 2 0 1 0 0 3.4V15a2 2 0 0 0 2 2h2.1a2 2 0 1 0 3.4 0H17a2 2 0 0 0 2-2z"/></>,
        trendingDown: <><polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/></>,
        megaphone: <><path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></>,
        ban: <><circle cx="12" cy="12" r="10"/><line x1="4.9" y1="4.9" x2="19.1" y2="19.1"/></>,
        pointer: <><path d="M7 14V5a2 2 0 0 1 4 0v6"/><path d="M11 11V3a2 2 0 0 1 4 0v8"/><path d="M15 10a2 2 0 0 1 4 0v3a7 7 0 0 1-7 7h-1a8 8 0 0 1-7-5l-1-2"/></>,
        checkSquare: <><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></>,
        radio: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/></>,
        info: <><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></>,
        siren: <><path d="M7 18v-6a5 5 0 0 1 10 0v6"/><path d="M5 21h14"/><path d="M12 2v1"/><path d="m4.6 5.6 .7.7"/><path d="m18.7 6.3 .7-.7"/></>,
        cross: <><path d="M11 2a2 2 0 0 0-2 2v5H4a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h5v5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-5h5a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2h-5V4a2 2 0 0 0-2-2z"/></>,
        clipboard: <><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></>,
        chat: <><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/></>,
        barChart: <><path d="M3 3v18h18"/><path d="M7 16v-4"/><path d="M12 16V8"/><path d="M17 16v-7"/></>,
        bulb: <><path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5.76.76 1.23 1.52 1.41 2.5"/></>,
        zap: <><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="currentColor" stroke="none"/></>,
        heart: <><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" fill="currentColor" stroke="none"/></>,
        flame: <><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" fill="currentColor" stroke="none"/></>,
    };
    return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={style}>{paths[name] || null}</svg>;
};

// ==========================================
// COMPONENT: SEVERER SCENE — phản diện 3D (Three.js) cho THREADS
// API mệnh lệnh qua ref: strike() đòn của bạn · lash() boss quật lại · setRage(0..1) theo máu · perish()/revive()
// Materials unlit (lines/points/emissive) để hiển thị ổn định bất kể đơn vị ánh sáng three.
// ==========================================
type SevererHandle = { strike: () => void; lash: () => void; setRage: (r: number) => void; perish: () => void; revive: () => void; };
const SevererScene = React.forwardRef<SevererHandle, {}>((_props, ref) => {
    const mountRef = React.useRef<HTMLDivElement>(null);
    const api = React.useRef<any>({});
    React.useImperativeHandle(ref, () => ({
        strike: () => api.current.strike && api.current.strike(),
        lash: () => api.current.lash && api.current.lash(),
        setRage: (r: number) => api.current.setRage && api.current.setRage(r),
        perish: () => api.current.perish && api.current.perish(),
        revive: () => api.current.revive && api.current.revive(),
    }), []);

    React.useEffect(() => {
        const mount = mountRef.current; if (!mount) return;
        let W = mount.clientWidth || 360, H = mount.clientHeight || 320;
        let renderer: THREE.WebGLRenderer;
        try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' }); }
        catch { return; }
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(W, H); renderer.domElement.style.display = 'block';
        mount.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 120);
        camera.position.set(0, 0, 7);

        const TEAL = new THREE.Color('#2DD4BF'), VIOLET = new THREE.Color('#A78BFA'), ROSE = new THREE.Color('#FB3D5B');
        const CORE_Y = 1.15;

        // Starfield
        const starN = 540, sp = new Float32Array(starN * 3);
        for (let i = 0; i < starN; i++) { const r = 16 + Math.random() * 30, th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1); sp[i * 3] = r * Math.sin(ph) * Math.cos(th); sp[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th); sp[i * 3 + 2] = r * Math.cos(ph); }
        const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
        const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x7a90b0, size: 0.06, transparent: true, opacity: 0.6 }));
        scene.add(stars);

        const core = new THREE.Group(); core.position.y = CORE_Y; scene.add(core);

        // ===== LÕI SEVERER — shader: pha lê đen QUẰN QUẠI (vertex displacement noise) + gân dung nham + fresnel =====
        const SNOISE = `
          vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
          vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
          vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
          vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
          float snoise(vec3 v){
            const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
            vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
            vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
            vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy; i=mod289(i);
            vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
            float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
            vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
            vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
            vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
            vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
            vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
            vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
            vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
            p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
            vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
            return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
          }`;
        const cu: any = { uTime: { value: 0 }, uRage: { value: 0 }, uHit: { value: 0 },
            uColA: { value: TEAL.clone() }, uColB: { value: VIOLET.clone() }, uHot: { value: ROSE.clone() } };
        const coreMat = new THREE.ShaderMaterial({
            uniforms: cu,
            vertexShader: SNOISE + `
              uniform float uTime,uRage,uHit; varying vec3 vN; varying vec3 vView; varying float vNz;
              void main(){
                vec3 p=position;
                float n=snoise(normal*1.7+vec3(uTime*0.55));
                float n2=snoise(normal*4.3-vec3(uTime*0.9));
                float spike=snoise(normal*9.0+vec3(uTime*0.35));
                float disp=(n*0.17+n2*0.06)*(0.6+uRage*1.35)+uHit*0.4*n+max(spike,0.0)*0.14*uRage;
                p+=normal*disp; vNz=n;
                vec4 wp=modelMatrix*vec4(p,1.0);
                vN=normalize(mat3(modelMatrix)*normal); vView=normalize(cameraPosition-wp.xyz);
                gl_Position=projectionMatrix*viewMatrix*wp;
              }`,
            fragmentShader: `
              uniform float uTime,uRage; uniform vec3 uColA,uColB,uHot;
              varying vec3 vN; varying vec3 vView; varying float vNz;
              void main(){
                float fres=pow(1.0-max(dot(normalize(vN),normalize(vView)),0.0),2.3);
                vec3 edge=mix(uColA,uHot,uRage);
                vec3 veinC=mix(uColB,uHot,uRage*0.8);
                float vein=smoothstep(0.22,0.62,abs(vNz));
                vec3 col=vec3(0.012,0.016,0.026);
                col=mix(col,veinC,vein*(0.35+uRage*0.7));
                col+=edge*fres*(0.95+uRage*1.2);
                col+=uHot*uRage*0.2*(0.5+0.5*sin(uTime*7.0));
                gl_FragColor=vec4(col,1.0);
              }`,
        });
        const coreGeo = new THREE.IcosahedronGeometry(1.25, 4);
        const coreMesh = new THREE.Mesh(coreGeo, coreMat); core.add(coreMesh);

        // Tim dung nham (sprite phát sáng lộ qua khe nứt)
        const heartCv = document.createElement('canvas'); heartCv.width = heartCv.height = 128;
        const hg = heartCv.getContext('2d')!; const grd = hg.createRadialGradient(64, 64, 2, 64, 64, 64);
        grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.22, 'rgba(255,110,130,0.95)'); grd.addColorStop(1, 'rgba(255,50,80,0)');
        hg.fillStyle = grd; hg.fillRect(0, 0, 128, 128);
        const heartTex = new THREE.CanvasTexture(heartCv);
        const heart = new THREE.Sprite(new THREE.SpriteMaterial({ map: heartTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
        heart.scale.setScalar(1.6); core.add(heart);

        // ===== LƯỠI NĂNG LƯỢNG (shears) — gai sáng sắc trên các vành nghiêng, xoay cuồng =====
        const blades: any[] = []; const bladeGeo = new THREE.ConeGeometry(0.055, 1.5, 3);
        for (let i = 0; i < 16; i++) {
            const m: any = new THREE.Mesh(bladeGeo, new THREE.MeshBasicMaterial({ color: TEAL.clone(), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
            m._a = (i / 16) * Math.PI * 2; m._r = 1.95 + (i % 3) * 0.2; m._spd = 1.1 + (i % 3) * 0.3; m._tilt = (i % 3) * 0.7;
            core.add(m); blades.push(m);
        }

        // ===== SÉT NỨT (lightning arcs) =====
        const bolts: any[] = []; const _tmpPts: THREE.Vector3[] = [];
        const makeBolt = (ln: any) => {
            const a = Math.random() * Math.PI * 2, a2 = a + (Math.random() - 0.5) * 1.5;
            const p0 = new THREE.Vector3(Math.cos(a) * 1.3, (Math.random() - 0.5) * 1.2, Math.sin(a) * 1.3);
            const p1 = new THREE.Vector3(Math.cos(a2) * (2.2 + Math.random()), (Math.random() - 0.5) * 2.2, Math.sin(a2) * (2.2 + Math.random()));
            _tmpPts.length = 0; const seg = 6;
            for (let i = 0; i <= seg; i++) { const f = i / seg; const v = p0.clone().lerp(p1, f); if (i > 0 && i < seg) v.add(new THREE.Vector3((Math.random() - 0.5) * 0.55, (Math.random() - 0.5) * 0.55, (Math.random() - 0.5) * 0.55)); _tmpPts.push(v); }
            ln.geometry.setFromPoints(_tmpPts); ln._life = 1;
        };
        for (let i = 0; i < 4; i++) {
            const ln: any = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: VIOLET.clone(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
            ln._life = 0; makeBolt(ln); ln._life = 0; core.add(ln); bolts.push(ln);
        }

        // ===== BÃO HẠT (chỉ bị nuốt) =====
        const stormN = 420, stP = new Float32Array(stormN * 3), stData: any[] = [];
        for (let i = 0; i < stormN; i++) { const a = Math.random() * Math.PI * 2, rr = 1.6 + Math.random() * 2.4, y = (Math.random() - 0.5) * 2.4; stData.push({ a, rr, y, sp: 0.3 + Math.random() * 0.85 }); stP[i * 3] = Math.cos(a) * rr; stP[i * 3 + 1] = y; stP[i * 3 + 2] = Math.sin(a) * rr; }
        const stormGeo = new THREE.BufferGeometry(); stormGeo.setAttribute('position', new THREE.BufferAttribute(stP, 3));
        const storm = new THREE.Points(stormGeo, new THREE.PointsMaterial({ color: TEAL.clone(), size: 0.045, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
        core.add(storm);

        let rage = 0, recoil = 0, shake = 0, deathT = 0, reviveT = 0, hidden = false, raf = 0, t = 0, boltT = 0;
        const REVIVE_DUR = 1.05;
        const backOut = (f: number) => { const c1 = 2.4, c3 = c1 + 1; const x = f - 1; return 1 + c3 * x * x * x + c1 * x * x; }; // nảy nhẹ ở cuối
        const beams: any[] = [];
        const _v1 = new THREE.Vector3(), _ax = new THREE.Vector3(1, 0, 0), _up = new THREE.Vector3(0, 1, 0);
        const bladeCol = new THREE.Color();

        api.current.strike = () => {
            recoil = Math.min(1.6, recoil + 1);
            const from = new THREE.Vector3((Math.random() - 0.5) * 6, -3.4 + Math.random(), 2 + Math.random() * 2.5);
            const dir = new THREE.Vector3().subVectors(new THREE.Vector3(0, CORE_Y, 0), from); const len = dir.length();
            const mesh: any = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.16, len, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
            mesh.position.copy(from).add(dir.clone().multiplyScalar(0.5));
            mesh.quaternion.setFromUnitVectors(_up, dir.clone().normalize());
            scene.add(mesh); beams.push({ mesh, life: 1 });
        };
        api.current.lash = () => { shake = 1; recoil = Math.min(1.7, recoil + 0.7); bolts.forEach((b: any) => makeBolt(b)); };
        api.current.setRage = (r: number) => { rage = Math.max(0, Math.min(1, r)); };
        api.current.perish = () => { deathT = 1.0; reviveT = 0; recoil = 1.7; rage = 1; bolts.forEach((b: any) => makeBolt(b)); };
        // Hồi sinh: tái tạo từ con số 0 — phình lên có nảy + bùng sét + tim loé, KHÔNG pop tức thì.
        api.current.revive = () => { deathT = 0; rage = 0; reviveT = REVIVE_DUR; recoil = 1.4; core.visible = true; core.scale.setScalar(0.001); bolts.forEach((b: any) => makeBolt(b)); };

        const clock = new THREE.Clock();
        const onVis = () => { hidden = document.hidden; };
        document.addEventListener('visibilitychange', onVis);

        const animate = () => {
            raf = requestAnimationFrame(animate);
            if (hidden) return;
            const dt = Math.min(clock.getDelta(), 0.05); t += dt;
            stars.rotation.y += dt * 0.02; stars.rotation.x += dt * 0.004;
            recoil = Math.max(0, recoil - dt * 3.0);
            core.rotation.y += dt * (0.2 + rage * 0.85); core.rotation.x += dt * 0.1;
            // shader uniforms + chuyển màu theo cuồng nộ
            cu.uTime.value = t; cu.uRage.value = rage; cu.uHit.value = recoil;
            cu.uColA.value.copy(TEAL).lerp(ROSE, rage * 0.9);
            cu.uColB.value.copy(VIOLET).lerp(ROSE, rage * 0.7);
            const pulse = 1 + Math.sin(t * (2 + rage * 3)) * (0.03 + rage * 0.05) + recoil * 0.18;
            if (deathT > 0) { deathT = Math.max(0, deathT - dt); const k = deathT / 1.0; core.scale.setScalar(Math.max(0.001, k) * pulse); if (deathT === 0) core.visible = false; }
            else if (reviveT > 0) { reviveT = Math.max(0, reviveT - dt); const f = 1 - reviveT / REVIVE_DUR; core.scale.setScalar(Math.max(0.001, backOut(f)) * pulse); core.rotation.y += dt * 2.5 * (1 - f); }
            else if (core.visible) core.scale.setScalar(pulse);
            // tim dung nham
            (heart.material as any).opacity = Math.min(1, 0.18 + rage * 0.7 + recoil * 0.6);
            heart.scale.setScalar(1.25 + rage * 0.7 + recoil * 0.5 + Math.sin(t * 5) * 0.08);
            (heart.material as any).color.copy(ROSE).lerp(new THREE.Color('#ffffff'), 0.4 + recoil * 0.4);
            // lưỡi
            bladeCol.copy(TEAL).lerp(ROSE, rage * 0.9);
            blades.forEach((b: any) => {
                b._a += dt * b._spd * (1 + rage * 1.4); const r = b._r + recoil * 0.5; const tilt = b._tilt + t * 0.12;
                _v1.set(Math.cos(b._a) * r, 0, Math.sin(b._a) * r).applyAxisAngle(_ax, tilt); b.position.copy(_v1);
                _v1.set(-Math.sin(b._a), 0, Math.cos(b._a)).applyAxisAngle(_ax, tilt).normalize(); b.quaternion.setFromUnitVectors(_up, _v1);
                (b.material as any).color.lerp(bladeCol, 0.12); (b.material as any).opacity = 0.5 + rage * 0.45;
            });
            // sét
            boltT -= dt; if (boltT <= 0) { boltT = 0.07 + Math.random() * 0.16; makeBolt(bolts[(Math.random() * bolts.length) | 0]); }
            bolts.forEach((b: any) => { b._life = Math.max(0, b._life - dt * 4.5); (b.material as any).opacity = b._life * (0.4 + 0.6 * Math.random()) * (0.55 + rage * 0.6); (b.material as any).color.copy(VIOLET).lerp(ROSE, rage); });
            // bão hạt
            const pos = stormGeo.attributes.position.array as any;
            for (let i = 0; i < stormN; i++) { const d = stData[i]; d.a += dt * d.sp * (0.5 + rage * 1.6); const rr = d.rr + Math.sin(t * 1.3 + i) * 0.16; pos[i * 3] = Math.cos(d.a) * rr; pos[i * 3 + 1] = d.y + Math.sin(t * 0.8 + d.a) * 0.2; pos[i * 3 + 2] = Math.sin(d.a) * rr; }
            stormGeo.attributes.position.needsUpdate = true; (storm.material as any).color.copy(bladeCol);
            // đòn đánh
            for (let i = beams.length - 1; i >= 0; i--) { const b = beams[i]; b.life -= dt * 3; b.mesh.material.opacity = Math.max(0, b.life); b.mesh.scale.x = b.mesh.scale.z = 0.4 + (1 - b.life) * 1.3; if (b.life <= 0) { scene.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose(); beams.splice(i, 1); } }
            shake = Math.max(0, shake - dt * 2.4);
            camera.position.x = Math.sin(t * 44) * shake * 0.3; camera.position.y = 0.55 + Math.cos(t * 39) * shake * 0.24; camera.position.z = 7 + Math.sin(t * 0.3) * 0.25;
            camera.lookAt(0, 0.7, 0);
            renderer.render(scene, camera);
        };
        animate();

        const onResize = () => { W = mount.clientWidth || W; H = mount.clientHeight || H; renderer.setSize(W, H); camera.aspect = W / H; camera.updateProjectionMatrix(); };
        const ro = new ResizeObserver(onResize); ro.observe(mount);

        return () => {
            cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener('visibilitychange', onVis);
            beams.forEach((b: any) => { scene.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose(); });
            heartTex.dispose();
            scene.traverse((o: any) => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: any) => m.dispose()); });
            renderer.dispose(); if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
        };
    }, []);

    return <div ref={mountRef} style={{ position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none' }} />;
});

// ==========================================
// COMPONENT: THREADS — duel đối kháng từ vựng vs The Severer (3D), cốt truyện theo act
// Lõi: nối nghĩa ↔ từ = đòn đánh; vỏ roguelike: ante leo thang + mutator + bank/push + boss + glyph.
// Đúng/sai feed thẳng SRS (onReview). Chốt run = coins (onAward, cha giới hạn 3 lượt thưởng/ngày).
// ==========================================
const VocabBlitz = ({ cards, C, onReview, onAward, awardsLeft = 0 }: any) => {
    const T = {
        bg: '#08090C', deep: '#050609', glass: 'rgba(255,255,255,0.045)', glass2: 'rgba(255,255,255,0.025)',
        core: 'rgba(10,12,17,0.72)', line: 'rgba(255,255,255,0.10)', line2: 'rgba(255,255,255,0.055)',
        ink: '#ECEEF3', sub: '#8A91A1', faint: '#5A6172',
        emerald: '#34D399', teal: '#2DD4BF', violet: '#A78BFA', amber: '#FBBF24', rose: '#FB7185',
        fDisp: "var(--heading), system-ui, sans-serif", fMono: "var(--mono), ui-monospace, monospace",
    };
    const pool = React.useMemo(() => (cards || []).filter((c: any) => c && c.word && c.meaning), [cards]);
    const enough = pool.length >= 6;

    const [phase, setPhase] = React.useState<'idle' | 'playing' | 'inter' | 'bust' | 'glyph'>('idle');
    const [ante, setAnte] = React.useState(1);
    const [fray, setFray] = React.useState(1);          // 1→0: sợi chỉ đang sờn (timer)
    const [frayNonce, setFrayNonce] = React.useState(0); // bump để arm lại timer
    const [glyphs, setGlyphs] = React.useState<string[]>([]); // relic giữ suốt run
    const [glyphPick, setGlyphPick] = React.useState<string[]>([]);
    const [pot, setPot] = React.useState(0);
    const [lastReward, setLastReward] = React.useState(0);
    const [integ, setInteg] = React.useState(3);
    const [round, setRound] = React.useState<any>(null);
    const [tIdx, setTIdx] = React.useState(0);
    const [consumed, setConsumed] = React.useState<Record<string, boolean>>({});
    const [wrongKey, setWrongKey] = React.useState<string>('');
    const [linkKey, setLinkKey] = React.useState<string>('');
    const [chain, setChain] = React.useState(0);
    const [muted, setMuted] = React.useState(false);
    const [hit, setHit] = React.useState<'' | 'good' | 'bad'>('');
    const [bossHit, setBossHit] = React.useState(0); // số đòn đã trúng boss act hiện tại
    const lockRef = React.useRef(false);
    const mutedRef = React.useRef(false);
    const sceneRef = React.useRef<SevererHandle>(null);
    React.useEffect(() => { mutedRef.current = muted; }, [muted]);
    React.useEffect(() => () => stopBed(), []);

    // ---------- Sound (warm, lowpass-filtered synth) ----------
    const acRef = React.useRef<any>(null);
    const filtRef = React.useRef<any>(null);
    const delayRef = React.useRef<any>(null);
    const bedRef = React.useRef<any>(null);
    const getAC = () => {
        if (!acRef.current) {
            try {
                const ac = new (window.AudioContext || (window as any).webkitAudioContext)();
                const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2600; f.Q.value = 0.6; f.connect(ac.destination);
                // Send vọng (delay + feedback) tạo chiều sâu không gian cho tiếng link/clear/bank.
                const d = ac.createDelay(1.0); d.delayTime.value = 0.26;
                const fb = ac.createGain(); fb.gain.value = 0.34;
                const wet = ac.createGain(); wet.gain.value = 0.5;
                d.connect(fb); fb.connect(d); d.connect(wet); wet.connect(f);
                acRef.current = ac; filtRef.current = f; delayRef.current = d;
            } catch { }
        }
        return acRef.current;
    };
    // Bè nền (drone) — chạy suốt run, dừng khi bank/bust/idle.
    const startBed = () => {
        const ac = getAC(); if (!ac || mutedRef.current) return; stopBed();
        try {
            const o1 = ac.createOscillator(), o2 = ac.createOscillator(), g = ac.createGain();
            o1.type = 'sine'; o2.type = 'sine'; o1.frequency.value = 65.41; o2.frequency.value = 65.41; o2.detune.value = 9;
            g.gain.setValueAtTime(0.0001, ac.currentTime); g.gain.linearRampToValueAtTime(0.045, ac.currentTime + 2.4);
            const lfo = ac.createOscillator(), lg = ac.createGain(); lfo.frequency.value = 0.07; lg.gain.value = 0.018; lfo.connect(lg); lg.connect(g.gain);
            o1.connect(g); o2.connect(g); g.connect(filtRef.current || ac.destination); o1.start(); o2.start(); lfo.start();
            bedRef.current = { o1, o2, lfo, g };
        } catch { }
    };
    const stopBed = () => {
        const b = bedRef.current, ac = acRef.current; if (!b || !ac) { bedRef.current = null; return; }
        try { const t = ac.currentTime; b.g.gain.cancelScheduledValues(t); b.g.gain.setValueAtTime(b.g.gain.value, t); b.g.gain.linearRampToValueAtTime(0.0001, t + 0.5); b.o1.stop(t + 0.6); b.o2.stop(t + 0.6); b.lfo.stop(t + 0.6); } catch { }
        bedRef.current = null;
    };
    // Mở khoá Web Audio trên mobile/iOS: phải resume + phát 1 buffer câm TRONG cử chỉ chạm.
    const unlockRef = React.useRef(false);
    const unlockAudio = () => {
        const ac = getAC(); if (!ac) return;
        if (ac.state === 'suspended') { try { ac.resume(); } catch { } }
        if (unlockRef.current) return;
        unlockRef.current = true;
        try { const b = ac.createBuffer(1, 1, 22050); const s = ac.createBufferSource(); s.buffer = b; s.connect(ac.destination); s.start(0); } catch { }
    };
    const voice = (freq: number, dur: number, type: OscillatorType, vol: number, when = 0, detune = 0, glide?: number, space = false) => {
        if (mutedRef.current) return;
        const ac = getAC(); if (!ac) return;
        const o = ac.createOscillator(); const g = ac.createGain();
        o.type = type; o.detune.value = detune; const t0 = ac.currentTime + when;
        o.frequency.setValueAtTime(freq, t0); if (glide) o.frequency.exponentialRampToValueAtTime(glide, t0 + dur);
        g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(vol, t0 + 0.014); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(g); g.connect(filtRef.current || ac.destination); if (space && delayRef.current) g.connect(delayRef.current);
        o.start(t0); o.stop(t0 + dur + 0.04);
    };
    const PENTA = [0, 2, 4, 7, 9, 12, 14, 16];
    const nt = (semi: number, base = 261.63) => base * Math.pow(2, semi / 12);
    const sLink = (ch: number) => { const s = PENTA[Math.min(ch, PENTA.length - 1)]; voice(nt(s), 0.5, 'triangle', 0.16, 0, -6, undefined, true); voice(nt(s + 7), 0.5, 'sine', 0.1, 0, 4, undefined, true); voice(nt(s + 12), 0.32, 'triangle', 0.06, 0.02); };
    const sClear = () => [0, 4, 7, 12, 16].forEach((s, i) => voice(nt(s, 392), 0.45, 'triangle', 0.13, i * 0.06, i % 2 ? 5 : -5, undefined, true));
    const sWrong = () => { voice(96, 0.3, 'sine', 0.28, 0, 0, 60); voice(140, 0.2, 'sawtooth', 0.09, 0.02, 0, 110); };
    const sMut = () => { voice(150, 0.6, 'sawtooth', 0.12, 0, 0, 480); voice(300, 0.5, 'sine', 0.06, 0.05); };
    const sBank = () => [0, 7, 12, 16, 19].forEach((s, i) => voice(nt(s, 523), 0.4, 'sine', 0.14, i * 0.05, 0, undefined, true));
    const sPush = () => voice(180, 0.5, 'sawtooth', 0.16, 0, 0, 520);
    const sBust = () => [12, 7, 3, 0, -5].forEach((s, i) => voice(nt(s, 196), 0.42, 'triangle', 0.18, i * 0.12, 8));

    const esc = (s: string) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const GAP = '·····';
    // Tạo câu ví dụ có chỗ trống — khớp cả dạng biến thể (run→running, study→studied). null nếu không thể tạo gap.
    const blankExample = (word: string, example: string): string | null => {
        if (!word || !example) return null;
        const base = String(word).trim();
        const w = esc(base);
        const pats: RegExp[] = [
            new RegExp('\\b' + w + '\\b', 'i'),
            new RegExp('\\b' + w + '(?:s|es|ed|ing|d|ies|ied|er|est|ly)\\b', 'i'),
        ];
        if (base.length > 3) {
            const stem = esc(base.replace(/(?:e|y)$/i, ''));
            pats.push(new RegExp('\\b' + stem + '(?:e|es|ed|ing|ies|ied)\\b', 'i'));
        }
        for (const p of pats) { if (p.test(example)) return String(example).replace(p, GAP); }
        return null;
    };
    const shuffle = (a: any[]) => { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };
    const scramble = (w: string) => { if (w.length < 3) return w.toUpperCase(); let s = w; let g = 0; while (s === w && g++ < 6) s = shuffle(w.split('')).join(''); return s.toUpperCase(); };
    const uniqByKey = (arr: any[], key: string, taken: Set<string>) => { const out: any[] = []; for (const c of arr) { const v = String(c[key] || '').toLowerCase(); if (v && !taken.has(v)) { taken.add(v); out.push(c); } } return out; };

    const MUTATORS: Record<string, any> = {
        NONE: { name: 'STANDARD', desc: 'Match each meaning to its word', color: T.teal, mult: 1 },
        REVERSE: { name: 'INVERSION', desc: 'Word shown — pick the meaning', color: T.violet, mult: 1.4 },
        BLIND: { name: 'BLACKOUT', desc: 'Only the example is shown', color: T.amber, mult: 1.6 },
        SCRAMBLE: { name: 'CIPHER', desc: 'Letters are scrambled', color: T.rose, mult: 1.5 },
        FLOOD: { name: 'OVERLOAD', desc: 'More decoys on the board', color: T.emerald, mult: 1.3 },
    };
    const GLYPHS: Record<string, any> = {
        CHRONO: { name: 'CHRONO', desc: 'Threads fray 35% slower for the rest of the run', color: T.teal, icon: 'clock' },
        TWIN: { name: 'TWIN', desc: 'All pot rewards ×1.5 from now on', color: T.amber, icon: 'zap' },
        MEND: { name: 'MEND', desc: 'Restore your integrity to full, right now', color: T.emerald, icon: 'heart' },
    };
    const potMult = glyphs.includes('TWIN') ? 1.5 : 1;
    const fraySlow = glyphs.includes('CHRONO') ? 1.35 : 1;

    // Cốt truyện: mỗi act một câu lore (đối kháng The Severer).
    const LORE = [
        'The lexicon hangs by a thread. The Severer circles.',
        'It tastes a word and forgets it for you. Re-weave faster.',
        'The shears widen. Meaning bleeds at the edges.',
        'It has eaten a language before. You are merely next.',
        'Bind it tighter — every snapped thread feeds the void.',
        'It knows your words now. It waits where you hesitate.',
    ];
    const loreFor = (a: number) => LORE[Math.min(a - 1, LORE.length - 1)];

    // Một "đợt" (wave) target+tile cho cùng mutator.
    const buildWave = (mut: string, a: number, tc: number) => {
        const reverse = mut === 'REVERSE';
        const gappable = pool.filter((c: any) => blankExample(c.word, c.example) != null);
        const sourcePool = mut === 'BLIND' ? gappable : pool;
        const targets = shuffle(sourcePool).slice(0, tc);
        const decoys = Math.min((mut === 'FLOOD' ? 4 : 2) + Math.floor(a / 2), 5);
        const taken = new Set<string>(targets.map((c: any) => String((reverse ? c.meaning : c.word) || '').toLowerCase()));
        const decoyCards = uniqByKey(shuffle(pool.filter((c: any) => !targets.includes(c))), reverse ? 'meaning' : 'word', taken).slice(0, decoys);
        const tiles = shuffle([...targets, ...decoyCards]).map((c: any, i: number) => {
            const raw = reverse ? c.meaning : c.word;
            return { key: 'tl' + i + '_w' + (c.id || i) + '_' + Math.random().toString(36).slice(2, 6), value: String(raw), display: (mut === 'SCRAMBLE' && !reverse) ? scramble(String(raw)) : String(raw) };
        });
        const prompts = targets.map((c: any) => reverse ? c.word : (mut === 'BLIND' ? (blankExample(c.word, c.example) || c.meaning) : c.meaning));
        return { targets, tiles, prompts, reverse };
    };
    const pickMutator = (a: number, tc: number) => {
        if (a < 2) return 'NONE';
        const gappable = pool.filter((c: any) => blankExample(c.word, c.example) != null);
        const opts = ['REVERSE', 'BLIND', 'FLOOD', 'NONE'];
        const valid = opts.filter(m => m !== 'BLIND' || gappable.length >= tc);
        return valid[Math.floor(Math.random() * valid.length)];
    };
    const makeRound = (a: number) => {
        const tc = Math.max(3, Math.min(4 + Math.floor((a - 1) / 2), 6, pool.length - 1));
        const mut = pickMutator(a, tc);
        const boss = a >= 3 && a % 3 === 0; // mỗi 3 ante: The Severer (2 đợt)
        const waves = boss ? 2 : 1;
        return { ...buildWave(mut, a, tc), mut, boss, waves, waveIdx: 0, tc, bossMax: tc * waves };
    };

    const beginRun = () => {
        unlockAudio();
        sMut(); startBed(); lockRef.current = false; sceneRef.current?.revive();
        setAnte(1); setPot(0); setInteg(3); setChain(0); setConsumed({}); setTIdx(0); setBossHit(0);
        setGlyphs([]); setGlyphPick([]); setFray(1); setFrayNonce(n => n + 1);
        setWrongKey(''); setLinkKey(''); setHit(''); setRound(makeRound(1)); setPhase('playing');
    };
    const nextRound = () => { const a = ante + 1; sMut(); startBed(); sceneRef.current?.revive(); setAnte(a); setTIdx(0); setConsumed({}); setChain(0); setBossHit(0); setWrongKey(''); setLinkKey(''); lockRef.current = false; setRound(makeRound(a)); setPhase('playing'); };
    const bankRun = () => { sBank(); stopBed(); onAward && onAward(pot); setPhase('idle'); };

    const target = round ? round.targets[tIdx] : null;
    const answer = target ? String(round.reverse ? target.meaning : target.word).toLowerCase() : '';
    const prompt = round && round.prompts ? round.prompts[tIdx] : '';

    const onTile = (tile: any) => {
        if (lockRef.current || phase !== 'playing' || consumed[tile.key]) return;
        const correct = tile.value.toLowerCase() === answer;
        if (correct) {
            lockRef.current = true;
            setLinkKey(tile.key); setHit('good'); window.setTimeout(() => setHit(''), 320);
            sceneRef.current?.strike();           // đòn đánh vào The Severer
            setBossHit(h => h + 1);
            sLink(chain); setChain(c => c + 1);
            onReview && onReview(target.id, true);
            window.setTimeout(() => {
                setConsumed(p => ({ ...p, [tile.key]: true })); setLinkKey('');
                if (tIdx + 1 >= round.targets.length) {
                    if (round.waveIdx + 1 < round.waves) {
                        // Boss còn máu — đợt kế tiếp cùng mutator.
                        setRound((r: any) => ({ ...r, ...buildWave(r.mut, ante, r.tc), waveIdx: r.waveIdx + 1 }));
                        setTIdx(0); setConsumed({});
                    } else {
                        // Hạ gục act.
                        const base = Math.round((5 + ante * 3) * (MUTATORS[round.mut].mult)) + chain;
                        const r = Math.round(base * (round.boss ? 2 : 1) * potMult);
                        setPot(p => p + r); setLastReward(r); sClear(); sceneRef.current?.perish();
                        if (round.boss) { stopBed(); offerGlyphs(); setPhase('glyph'); } else { setPhase('inter'); }
                    }
                } else { setTIdx(i => i + 1); }
                lockRef.current = false;
            }, 340);
        } else {
            setWrongKey(tile.key); setHit('bad'); setChain(0); sWrong();
            sceneRef.current?.lash();
            window.setTimeout(() => setWrongKey(''), 450); window.setTimeout(() => setHit(''), 360);
            onReview && onReview(target.id, false);
            loseInteg();
        }
    };

    const loseInteg = () => {
        setInteg(prev => {
            const left = prev - 1;
            if (left <= 0) { lockRef.current = true; stopBed(); window.setTimeout(() => { sBust(); setPhase('bust'); }, 480); }
            return Math.max(0, left);
        });
    };
    // Hết giờ (sợi chỉ sờn đứt) = mất 1 integrity, arm lại timer cho cùng target.
    const frayOut = () => {
        if (lockRef.current || phase !== 'playing') return;
        setHit('bad'); window.setTimeout(() => setHit(''), 360);
        setChain(0); sWrong(); sceneRef.current?.lash();
        loseInteg();
        setFrayNonce(n => n + 1);
    };
    // Boss càng gần chết càng cuồng nộ (đổi màu/rung).
    React.useEffect(() => { const max = round?.bossMax || 1; sceneRef.current?.setRage(Math.min(1, bossHit / max)); }, [bossHit, round]);
    const offerGlyphs = () => {
        const owned = new Set(glyphs);
        let cand = Object.keys(GLYPHS).filter(k => k === 'MEND' || !owned.has(k));
        if (cand.length < 2) cand = Object.keys(GLYPHS);
        setGlyphPick(shuffle(cand).slice(0, 2));
    };
    const claimGlyph = (k: string) => {
        sBank();
        if (k === 'MEND') setInteg(3); else setGlyphs(g => g.includes(k) ? g : [...g, k]);
        setPhase('inter');
    };

    // Đồng hồ "sờn chỉ" — đếm ngược mỗi target; càng ante cao càng gấp; boss gấp đôi.
    React.useEffect(() => {
        if (phase !== 'playing' || !round) return;
        const dur = Math.max(2800, 7200 - (ante - 1) * 480) * (round.boss ? 0.6 : 1) * fraySlow;
        setFray(1);
        const start = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        let raf = 0;
        const tick = (now: number) => {
            if (!lockRef.current) {
                const f = Math.max(0, 1 - (now - start) / dur);
                setFray(prev => Math.abs(prev - f) > 0.008 ? f : prev); // throttle re-render
                if (f <= 0) { frayOut(); return; }
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase, round, tIdx, frayNonce]);

    const noise = "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")";
    const styleTag = (
        <style>{`
          .thx{ position:relative; border-radius:26px; overflow:hidden; isolation:isolate;
            background:
              radial-gradient(120% 80% at 12% -8%, ${T.violet}1F, transparent 46%),
              radial-gradient(120% 90% at 96% 8%, ${T.teal}1C, transparent 50%),
              radial-gradient(90% 70% at 50% 118%, ${T.emerald}14, transparent 55%),
              ${T.bg};
            border:1px solid ${T.line}; box-shadow:0 30px 80px -40px #000, inset 0 1px 0 rgba(255,255,255,0.05);
            color:${T.ink}; font-family:${T.fDisp}; padding:22px 20px 24px; min-height:460px;
            transition:box-shadow .4s cubic-bezier(.32,.72,0,1); }
          .thx.bad{ box-shadow:0 0 0 1.5px ${T.rose}, 0 30px 80px -40px #000, inset 0 0 60px -10px ${T.rose}55; }
          .thx.good{ box-shadow:0 0 0 1px ${T.emerald}66, 0 30px 80px -40px #000, inset 0 1px 0 rgba(255,255,255,0.05); }
          .thx-grain{ position:absolute; inset:0; background-image:${noise}; background-size:160px; opacity:.05; mix-blend-mode:overlay; pointer-events:none; z-index:0; }
          .thx-orb{ position:absolute; border-radius:50%; filter:blur(46px); opacity:.5; pointer-events:none; z-index:0; animation:thxDrift 16s ease-in-out infinite; }
          @keyframes thxDrift{ 0%,100%{ transform:translate(0,0) } 50%{ transform:translate(14px,-18px) } }
          .thx-z{ position:relative; z-index:2; }
          .thx-bezel{ background:${T.glass}; border:1px solid ${T.line2}; border-radius:22px; padding:6px; }
          .thx-core{ background:${T.core}; border:1px solid ${T.line2}; border-radius:16px; box-shadow:inset 0 1px 0 rgba(255,255,255,0.07); }
          .thx-eyebrow{ font-family:${T.fMono}; font-size:10px; letter-spacing:.28em; text-transform:uppercase; color:${T.sub}; }
          .thx-tile{ font-family:${T.fDisp}; cursor:pointer; transition:transform .5s cubic-bezier(.32,.72,0,1), border-color .3s, background .3s, box-shadow .3s, opacity .4s; will-change:transform; }
          .thx-tile:not(.dim):not(.lock):hover{ transform:translateY(-3px); border-color:${T.teal}88; box-shadow:0 12px 28px -14px ${T.teal}, inset 0 1px 0 rgba(255,255,255,0.08); }
          .thx-tile:not(.dim):active{ transform:scale(.97); }
          .thx-tile.dim{ opacity:.28; }
          .thx-tile.wrong{ animation:thxShake .45s cubic-bezier(.36,.07,.19,.97); border-color:${T.rose}; color:${T.rose}; }
          .thx-tile.link{ animation:thxLink .34s cubic-bezier(.32,.72,0,1) forwards; border-color:${T.emerald}; color:${T.emerald}; }
          @keyframes thxLink{ 0%{ transform:scale(1) } 35%{ transform:scale(1.12); box-shadow:0 0 30px -4px ${T.emerald} } 100%{ transform:translateY(-26px) scale(.9); opacity:0 } }
          @keyframes thxShake{ 0%,100%{transform:translateX(0)} 22%{transform:translateX(-9px)} 44%{transform:translateX(8px)} 66%{transform:translateX(-5px)} 88%{transform:translateX(3px)} }
          @keyframes thxRise{ 0%{opacity:0; transform:translateY(16px) scale(.96); filter:blur(6px)} 100%{opacity:1; transform:none; filter:blur(0)} }
          .thx-enter{ animation:thxRise .55s cubic-bezier(.32,.72,0,1) both; }
          @keyframes thxPromptIn{ 0%{opacity:0; transform:translateY(10px)} 100%{opacity:1; transform:none} }
          .thx-prompt{ animation:thxPromptIn .4s cubic-bezier(.32,.72,0,1); }
          .thx-cta{ font-family:${T.fDisp}; cursor:pointer; transition:transform .35s cubic-bezier(.32,.72,0,1), filter .3s, box-shadow .3s; }
          .thx-cta:hover{ filter:brightness(1.08); transform:translateY(-2px) }
          .thx-cta:active{ transform:scale(.97) }
          @keyframes thxScaleIn{ 0%{opacity:0; transform:scale(.9)} 100%{opacity:1; transform:none} }
          .thx-pop{ animation:thxScaleIn .5s cubic-bezier(.34,1.56,.64,1) both; }
          .thx.bad .thx-crack{ opacity:1; }
          .thx-crack{ position:absolute; inset:0; z-index:5; pointer-events:none; opacity:0; transition:opacity .12s; mix-blend-mode:screen;
            background:
              linear-gradient(115deg, transparent 49.6%, ${T.rose}cc 49.8%, transparent 50.1%) 0 0/220px 220px,
              linear-gradient(60deg, transparent 49.7%, ${T.rose}99 49.9%, transparent 50.2%) 40px 10px/300px 300px; }
        `}</style>
    );

    const Shell = (children: any) => (
        <div className={'thx ' + hit} onPointerDown={unlockAudio}>
            {styleTag}
            <SevererScene ref={sceneRef} />
            <div className="thx-grain" />
            <div className="thx-z">{children}</div>
            <div className="thx-crack" />
        </div>
    );

    // ---------- IDLE ----------
    if (phase === 'idle') {
        return Shell(
            <div style={{ textAlign: 'center', padding: '26px 6px 18px' }}>
                <div className="thx-eyebrow" style={{ marginBottom: 14 }}>Vocabulary · Roguelike</div>
                <div className="thx-enter" style={{ fontFamily: T.fDisp, fontSize: 44, fontWeight: 700, letterSpacing: '0.16em', lineHeight: 1, background: `linear-gradient(120deg,${T.teal},${T.violet})`, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', paddingLeft: '0.16em' }}>THREADS</div>
                <div style={{ fontSize: 13.5, color: T.sub, margin: '16px auto 0', maxWidth: 340, lineHeight: 1.6 }}>Link <span style={{ color: T.ink }}>meanings to words</span> before each thread <span style={{ color: T.amber }}>frays</span>. Every ante draws a <span style={{ color: T.violet }}>mutator</span>; every third, <span style={{ color: T.rose }}>The Severer</span> strikes. Clear it, then <span style={{ color: T.teal }}>bank</span> or push your luck.</div>
                <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 14, margin: '20px 0 22px', fontFamily: T.fMono, fontSize: 11, color: T.faint, letterSpacing: '0.05em' }}>
                    <span>3 SLIPS = OVER</span><span style={{ color: T.line }}>/</span><span>BEAT THE FRAY</span><span style={{ color: T.line }}>/</span><span>BANK · PUSH</span>
                </div>
                {enough ? (
                    <button className="thx-cta" onClick={beginRun} style={{ display: 'inline-flex', alignItems: 'center', gap: 14, background: T.ink, color: T.deep, border: 'none', padding: '13px 16px 13px 26px', borderRadius: 999, fontWeight: 700, fontSize: 15, boxShadow: `0 14px 34px -14px ${T.teal}` }}>
                        Start run
                        <span style={{ width: 34, height: 34, borderRadius: 999, background: T.deep, color: T.teal, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Ico name="arrowRight" size={16} /></span>
                    </button>
                ) : (
                    <div style={{ fontSize: 13, color: T.sub, fontStyle: 'italic', padding: '12px 0' }}>You need at least <b style={{ color: T.ink }}>6 words</b> in your notebook. Generate or add some first.</div>
                )}
                <div className="thx-eyebrow" style={{ marginTop: 22, color: T.faint }}>{Math.max(0, awardsLeft)}/3 rewarded runs left today</div>
            </div>
        );
    }

    // ---------- INTERSTITIAL (Bank / Push) ----------
    if (phase === 'inter') {
        const willReward = awardsLeft > 0;
        return Shell(
            <div className="thx-pop" style={{ textAlign: 'center', padding: '22px 6px 16px' }}>
                <div className="thx-eyebrow" style={{ color: T.emerald }}>Ante {ante} · The Severer reels</div>
                <div style={{ fontSize: 12.5, color: T.faint, fontStyle: 'italic', maxWidth: 320, margin: '12px auto 0', lineHeight: 1.55 }}>{loreFor(ante + 1)}</div>
                <div style={{ fontFamily: T.fMono, fontSize: 12, color: T.sub, marginTop: 16 }}>+{lastReward} to the pot</div>
                <div style={{ fontFamily: T.fDisp, fontSize: 56, fontWeight: 700, lineHeight: 1, margin: '4px 0 2px', letterSpacing: '-0.02em' }}>{pot}</div>
                <div className="thx-eyebrow" style={{ marginBottom: 22 }}>points in the pot</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, maxWidth: 420, margin: '0 auto' }}>
                    <button className="thx-cta thx-bezel" onClick={bankRun} style={{ textAlign: 'left', border: `1px solid ${T.emerald}55` }}>
                        <div className="thx-core" style={{ padding: '14px 16px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: T.emerald, fontWeight: 700, fontSize: 15 }}><Ico name="download" size={15} /> Bank</div>
                            <div style={{ fontFamily: T.fMono, fontSize: 11, color: T.sub, marginTop: 5 }}>{willReward ? `+${pot} OS Coins, end run` : 'no rewards left — 0 coins'}</div>
                        </div>
                    </button>
                    <button className="thx-cta thx-bezel" onClick={nextRound} style={{ textAlign: 'left', border: `1px solid ${T.violet}55` }}>
                        <div className="thx-core" style={{ padding: '14px 16px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: T.violet, fontWeight: 700, fontSize: 15 }}><Ico name="zap" size={15} /> Push</div>
                            <div style={{ fontFamily: T.fMono, fontSize: 11, color: T.sub, marginTop: 5 }}>Ante {ante + 1} · lose it all if you bust</div>
                        </div>
                    </button>
                </div>
                <div style={{ display: 'inline-flex', gap: 5, marginTop: 20 }}>{[0, 1, 2].map(i => <span key={i} style={{ width: 26, height: 4, borderRadius: 4, background: i < integ ? T.teal : T.line }} />)}</div>
            </div>
        );
    }

    // ---------- GLYPH DRAFT (sau khi hạ boss The Severer) ----------
    if (phase === 'glyph') {
        return Shell(
            <div className="thx-pop" style={{ textAlign: 'center', padding: '22px 6px 16px' }}>
                <div className="thx-eyebrow" style={{ color: T.amber }}>The Severer · defeated</div>
                <div style={{ fontFamily: T.fDisp, fontSize: 30, fontWeight: 700, margin: '10px 0 4px', color: T.ink }}>Claim a Glyph</div>
                <div style={{ fontSize: 12.5, color: T.sub, maxWidth: 320, margin: '0 auto 22px', lineHeight: 1.6 }}>A relic from the severed thread — it stays with you for the rest of the run.</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, maxWidth: 420, margin: '0 auto' }}>
                    {glyphPick.map((k: string) => { const G = GLYPHS[k]; return (
                        <button key={k} className="thx-cta thx-bezel" onClick={() => claimGlyph(k)} style={{ textAlign: 'left', border: `1px solid ${G.color}66` }}>
                            <div className="thx-core" style={{ padding: '16px 16px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: G.color, fontWeight: 700, fontSize: 15, fontFamily: T.fMono, letterSpacing: '0.1em' }}><Ico name={G.icon} size={16} /> {G.name}</div>
                                <div style={{ fontSize: 12, color: T.sub, marginTop: 7, lineHeight: 1.5 }}>{G.desc}</div>
                            </div>
                        </button>
                    ); })}
                </div>
                {glyphs.length > 0 && <div className="thx-eyebrow" style={{ marginTop: 18, color: T.faint }}>Held: {glyphs.join(' · ')}</div>}
            </div>
        );
    }

    // ---------- BUST ----------
    if (phase === 'bust') {
        return Shell(
            <div className="thx-pop" style={{ textAlign: 'center', padding: '40px 6px' }}>
                <div className="thx-eyebrow" style={{ color: T.rose }}>Run over</div>
                <div style={{ fontFamily: T.fDisp, fontSize: 40, fontWeight: 700, margin: '12px 0 2px', color: T.ink }}>Threads snapped</div>
                <div style={{ fontSize: 13.5, color: T.sub, maxWidth: 300, margin: '0 auto', lineHeight: 1.6 }}>You reached <b style={{ color: T.ink }}>ante {ante}</b> and lost the <b style={{ color: T.faint, textDecoration: 'line-through' }}>{pot}</b>-point pot. Should have banked sooner.</div>
                <button className="thx-cta" onClick={beginRun} style={{ marginTop: 24, display: 'inline-flex', alignItems: 'center', gap: 12, background: T.ink, color: T.deep, border: 'none', padding: '12px 14px 12px 24px', borderRadius: 999, fontWeight: 700, fontSize: 15 }}>
                    New run <span style={{ width: 32, height: 32, borderRadius: 999, background: T.deep, color: T.teal, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Ico name="refresh" size={15} /></span>
                </button>
            </div>
        );
    }

    // ---------- PLAYING ----------
    const M = MUTATORS[round.mut];
    const reverse = round.reverse;
    return Shell(
        <div>
            {/* HUD */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                    <span className="thx-eyebrow">Ante</span>
                    <span style={{ fontFamily: T.fMono, fontWeight: 700, fontSize: 18, color: T.ink }}>{String(ante).padStart(2, '0')}</span>
                </div>
                <div style={{ display: 'inline-flex', gap: 5 }}>{[0, 1, 2].map(i => <span key={i} style={{ width: 24, height: 4, borderRadius: 4, background: i < integ ? T.teal : T.rose + '66', transition: 'background .3s' }} />)}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontFamily: T.fMono, fontSize: 13, color: T.sub }}>pot <b style={{ color: T.amber }}>{pot}</b></span>
                    <button onClick={() => setMuted(m => { const nm = !m; mutedRef.current = nm; if (nm) stopBed(); else startBed(); return nm; })} title={muted ? 'Unmute' : 'Mute'} style={{ background: 'transparent', border: 'none', color: T.faint, cursor: 'pointer', padding: 2, display: 'inline-flex' }}><Ico name={muted ? 'ban' : 'music'} size={15} /></button>
                </div>
            </div>

            {/* Boss HP */}
            {(() => {
                const bossHP = Math.max(0, 1 - bossHit / (round.bossMax || 1));
                const hc = bossHP > 0.5 ? T.teal : bossHP > 0.22 ? T.amber : T.rose;
                return (
                    <div style={{ marginBottom: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
                            <span style={{ fontFamily: T.fMono, fontSize: 11, letterSpacing: '0.18em', color: round.boss ? T.rose : T.sub, fontWeight: 700 }}>THE SEVERER{round.boss ? ` · ACT ${ante}` : ''}</span>
                            <span style={{ fontFamily: T.fMono, fontSize: 10, color: T.faint }}>{Math.ceil(bossHP * 100)}%</span>
                        </div>
                        <div style={{ height: 7, borderRadius: 6, background: 'rgba(0,0,0,0.45)', border: `1px solid ${T.line2}`, overflow: 'hidden' }}>
                            <div style={{ width: (bossHP * 100) + '%', height: '100%', background: `linear-gradient(90deg, ${hc}, ${hc}aa)`, boxShadow: `0 0 12px ${hc}`, transition: 'width .35s cubic-bezier(.32,.72,0,1), background .3s' }} />
                        </div>
                    </div>
                );
            })()}

            {/* Stage — chừa chỗ cho The Severer (3D) lộ diện */}
            <div style={{ height: 116 }} />

            {/* Mutator + Boss chip */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                {round.boss && (
                    <div className="thx-enter" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 999, border: `1px solid ${T.rose}66`, background: `${T.rose}1c` }}>
                        <span style={{ color: T.rose, display: 'inline-flex' }}><Ico name="flame" size={13} /></span>
                        <span style={{ fontFamily: T.fMono, fontSize: 11, letterSpacing: '0.18em', color: T.rose, fontWeight: 700 }}>THE SEVERER</span>
                        <span style={{ fontSize: 11.5, color: T.sub }}>×2 reward · clear before it cuts</span>
                    </div>
                )}
                <div className="thx-enter" style={{ display: 'inline-flex', alignItems: 'center', gap: 9, padding: '6px 12px', borderRadius: 999, border: `1px solid ${M.color}44`, background: `${M.color}14` }}>
                    <span style={{ width: 6, height: 6, borderRadius: 999, background: M.color, boxShadow: `0 0 8px ${M.color}` }} />
                    <span style={{ fontFamily: T.fMono, fontSize: 11, letterSpacing: '0.16em', color: M.color, fontWeight: 700 }}>{M.name}</span>
                    <span style={{ fontSize: 11.5, color: T.sub }}>{M.desc}</span>
                </div>
                {glyphs.map((k: string) => <span key={k} title={GLYPHS[k].desc} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 999, border: `1px solid ${GLYPHS[k].color}55`, background: `${GLYPHS[k].color}14`, color: GLYPHS[k].color, fontFamily: T.fMono, fontSize: 10, letterSpacing: '0.1em', fontWeight: 700 }}><Ico name={GLYPHS[k].icon} size={11} /> {k}</span>)}
            </div>

            {/* Thread progress */}
            <div style={{ display: 'flex', gap: 5, marginBottom: 14 }}>
                {round.targets.map((_: any, i: number) => <span key={i} style={{ flex: 1, height: 3, borderRadius: 3, background: i < tIdx ? T.emerald : i === tIdx ? T.ink : T.line, transition: 'background .3s' }} />)}
            </div>

            {/* Fray timer — sợi chỉ đang sờn */}
            {(() => {
                const fc = fray > 0.5 ? T.teal : fray > 0.25 ? T.amber : T.rose;
                return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14 }}>
                        <span className="thx-eyebrow" style={{ color: fc, transition: 'color .3s' }}>Fray</span>
                        <div style={{ flex: 1, height: 5, borderRadius: 5, background: T.line2, overflow: 'hidden' }}>
                            <div style={{ width: (fray * 100) + '%', height: '100%', borderRadius: 5, background: `linear-gradient(90deg, ${fc}, ${fc}bb)`, boxShadow: `0 0 10px ${fc}`, transition: 'background .3s' }} />
                        </div>
                    </div>
                );
            })()}

            {/* Prompt */}
            <div className="thx-bezel" style={{ marginBottom: 16, boxShadow: fray < 0.25 ? `0 0 0 1px ${T.rose}55` : 'none', transition: 'box-shadow .3s' }}>
                <div className="thx-core thx-prompt" key={tIdx} style={{ padding: '18px 20px', minHeight: 78, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <div className="thx-eyebrow" style={{ marginBottom: 8, color: M.color }}>{reverse ? 'Word → pick meaning' : round.mut === 'BLIND' ? 'Fill the gap' : 'Meaning → pick word'}</div>
                    <div style={{ fontFamily: T.fDisp, fontSize: reverse ? 26 : 17, fontWeight: reverse ? 700 : 500, color: T.ink, lineHeight: 1.4 }}>{prompt}</div>
                </div>
            </div>

            {/* Tiles */}
            <div style={{ display: 'grid', gridTemplateColumns: reverse ? '1fr' : '1fr 1fr', gap: 9 }}>
                {round.tiles.map((tile: any, i: number) => {
                    const dim = !!consumed[tile.key];
                    const cls = 'thx-tile thx-enter' + (dim ? ' dim' : '') + (wrongKey === tile.key ? ' wrong' : '') + (linkKey === tile.key ? ' link' : '') + (lockRef.current ? ' lock' : '');
                    return (
                        <button key={tile.key} className={cls} disabled={dim} onClick={() => onTile(tile)}
                            style={{ background: 'rgba(7,9,13,0.62)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', border: `1px solid ${T.line}`, color: T.ink, borderRadius: 14, padding: reverse ? '13px 16px' : '14px 12px', fontWeight: reverse ? 500 : 600, fontSize: reverse ? 13.5 : 15, textAlign: reverse ? 'left' : 'center', minHeight: reverse ? 0 : 52, lineHeight: 1.4, letterSpacing: round.mut === 'SCRAMBLE' && !reverse ? '0.12em' : 'normal', animationDelay: (i * 0.04) + 's', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)' }}>
                            {tile.display}
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

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
                    tblHtml += `<td style="padding: 8px; border: 1px solid #ccc; min-width: 50px;"> </td>`;
                }
                tblHtml += "</tr>";
            }
            tblHtml += "</table><p> </p>";
            exec("insertHTML", tblHtml);
        }
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
        <div className="no-print" style={{ border: '2px solid #ccc', borderRadius: 8, overflow: 'hidden', background: '#fff', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
            <div style={{ display: 'flex', gap: 6, padding: '8px 12px', background: '#f8f9fa', borderBottom: '2px solid #ddd', flexWrap: 'wrap', alignItems: 'center' }}>
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
  const [isMobile, setIsMobile] = useState(typeof window !== "undefined" && window.innerWidth < 640);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  useEffect(() => {
      const onResize = () => setIsMobile(window.innerWidth < 640);
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
  }, []);
  // HUB HỌC VIÊN (master-detail): hồ sơ đang mở + tab con trong hồ sơ + chế độ thêm HV.
  const [profileId, setProfileId] = useState<string | null>(null);
  const [profileTab, setProfileTab] = useState<"overview" | "results" | "sessions" | "finance">("overview");
  const [showAddStudent, setShowAddStudent] = useState(false);
  const [ovTool, setOvTool] = useState<"" | "calc" | "push" | "verify">("");
  // GV tặng quà thủ công (không cần xu/gacha): id HV đang mở modal tặng quà, hoặc null
  const [giftFor, setGiftFor] = useState<string | null>(null);
  const [giftCustom, setGiftCustom] = useState("");
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
  const studentsRef = useRef<Student[]>([]);
  const vocabStoreReadyRef = useRef<Record<string, boolean>>({});
  const vocabPersistInFlightRef = useRef<Record<string, boolean>>({});
  const vocabMigrationAttemptedRef = useRef<Record<string, boolean>>({});
  useEffect(() => { studentsRef.current = students; }, [students]);
  const [history, setHistory] = useState<Session[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [sharedLinks, setSharedLinks] = useState<SharedLink[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [quizResults, setQuizResults] = useState<QuizResult[]>([]);
  const [bannedIps, setBannedIps] = useState<string[]>([]);
  const [liveSessions, setLiveSessions] = useState<LiveSession[]>([]);
  const [systemLogs, setSystemLogs] = useState<SystemLog[]>([]);
  const [rewardCodes, setRewardCodes] = useState<RewardCode[]>([]);
  const [verifyCodeInput, setVerifyCodeInput] = useState("");
  const [verifyResult, setVerifyResult] = useState<{ status: "NONE" | "VALID" | "USED" | "FAKE"; entry?: RewardCode } | null>(null);
  const [serverStatus, setServerStatus] = useState<"OK" | "DOWN">("OK");
 
  // BẢN CANONICAL DUY NHẤT (đã hợp nhất 2 bản trùng tên gây mất dấu quét):
  // 1. Có nhánh 'sections' (quét trong BÀI ĐỌC lưu vào sections[idx].passage — trước đây rơi vào hư không).
  // 2. Mọi cập nhật câu hỏi được MIRROR vào cả prev.questions LẪN prev.sections[].questions
  //    (2 bản sao độc lập — thiếu mirror là render theo section mất dấu quét dù state có).
  const syncHighlightState = (prev: any, field: string, qId: string, cleanHTML: string, optIndex?: string | null) => {
      if (!prev) return null;
      if (field === 'passage' || field === 'sections') {
          if (prev.sections && prev.sections.length) {
              const ns = [...prev.sections];
              const si = Math.max(0, Math.min(currentSectionIndex, ns.length - 1));
              ns[si] = { ...ns[si], passage: cleanHTML };
              return { ...prev, sections: ns, passage: si === 0 ? cleanHTML : prev.passage };
          }
          return { ...prev, passage: cleanHTML };
      }

      const targetQ = (prev.questions || []).find((qx: any) => qx.id === qId);
      const oldCtx = targetQ?.groupContext;
      const oldIns = targetQ?.instruction;
      const oldOptsStr = targetQ?.options ? JSON.stringify(targetQ.options) : null;
      const isSharedOptionsType = targetQ?.type === 'CHOICE_MULTIPLE' || targetQ?.type === 'MATCHING';

      const applyToQ = (qx: any) => {
          let updated: any = { ...qx };
          let modified = false;

          if (field === 'options' && optIndex !== null && optIndex !== undefined) {
              if (qx.id === qId || (isSharedOptionsType && qx.type === targetQ?.type && JSON.stringify(qx.options) === oldOptsStr)) {
                  const newOpts = [...(qx.options || [])];
                  newOpts[Number(optIndex)] = cleanHTML;
                  updated.options = newOpts;
                  modified = true;
              }
          } else if (qx.id === qId) {
              updated[field] = cleanHTML;
              modified = true;
          }

          if (field === 'groupContext' && oldCtx && qx.groupContext === oldCtx) {
              updated.groupContext = cleanHTML;
              modified = true;
          }
          if (field === 'instruction' && (qx.id === qId || (oldIns && qx.instruction === oldIns))) {
              updated.instruction = cleanHTML;
              modified = true;
          }

          return modified ? updated : qx;
      };

      const nQ = (prev.questions || []).map(applyToQ);
      const nSecs = (prev.sections && prev.sections.length)
          ? prev.sections.map((sec: any) => ({ ...sec, questions: (sec.questions || []).map(applyToQ) }))
          : prev.sections;
      return { ...prev, questions: nQ, sections: nSecs };
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
  const [schedForm, setSchedForm] = useState({ time: "08:00", location: "Online", studentId: "", duration: 90 });
  const [aiLoadingId, setAiLoadingId] = useState<string | null>(null);
  const [explainMap, setExplainMap] = useState<Record<string, { loading: boolean; text: string }>>({});
  const [vocabGenLoading, setVocabGenLoading] = useState(false);
  const [transcribeLoading, setTranscribeLoading] = useState(false);
  const [transcribeMsg, setTranscribeMsg] = useState("");
  const [audioUploadProgress, setAudioUploadProgress] = useState<number | null>(null);
  const [audioUploadMsg, setAudioUploadMsg] = useState("");
  const [vocabView, setVocabView] = useState<"list" | "study" | "game">("study");
  const [vocabFilter, setVocabFilter] = useState<string>("all");
  const [vocabKinds, setVocabKinds] = useState<string[]>(["word", "phrasal_verb", "idiom", "collocation", "grammar"]);
  const [vocabCount, setVocabCount] = useState<number>(15); // số lượng từ HS muốn AI tạo mỗi lần
  const [showVocabKinds, setShowVocabKinds] = useState(false);
  const [studyFlipped, setStudyFlipped] = useState(false);

  const [editingQuiz, setEditingQuiz] = useState<Quiz | null>(null);
  const editingQuizRef = useRef<Quiz | null>(null); // FIX: ref để tránh stale closure trong saveQuiz
  const [keyEditingQuiz, setKeyEditingQuiz] = useState<Quiz | null>(null);
  const [activeExam, setActiveExam] = useState<Quiz | null>(null);
  const [pendingExamState, setPendingExamState] = useState<{quiz: Quiz, isPreview: boolean, isStudentTestUI: boolean} | null>(null);
  // I18N: áp ngôn ngữ theo vai trò khi đăng nhập/đổi vai trò; LUÔN ép "en" khi đang trong phòng thi.
  useEffect(() => {
    if (activeExam) { i18n.changeLanguage("en"); }
    else if (userRole) { i18n.changeLanguage(getRoleLang(userRole)); }
  }, [userRole, activeExam]);
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
  const [reviewSectionIdx, setReviewSectionIdx] = useState(0);
  const [showCelebration, setShowCelebration] = useState(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  // Thanh audio DÍNH TRÊN ở màn Review (sao chép layout phòng thi) — khỏi cuộn tìm player
  const [rvAudioCur, setRvAudioCur] = useState(0);
  const [rvAudioDur, setRvAudioDur] = useState(0);
  const [rvAudioPlaying, setRvAudioPlaying] = useState(false);
  const [pendingAudioResume, setPendingAudioResume] = useState<{time: number, status: string} | null>(null);
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
  const [, _setAudioTested] = useState(false);
  const [audioStatus, setAudioStatus] = useState<"IDLE" | "LOADING" | "PLAYING" | "PAUSED" | "ENDED">("IDLE");
  const [audioCur, setAudioCur] = useState(0);   // vị trí audio (chế độ practice)
  const [audioRate, setAudioRate] = useState(1); // tốc độ phát (practice): 1 / 1.25 / 1.5 / 2
  const [audioDur, setAudioDur] = useState(0);   // tổng thời lượng audio
  const [_audioVolume, _setAudioVolume] = useState<number>(1);
  const [meetAudioIssue, setMeetAudioIssue] = useState(false);
  const [audioDiagLog, setAudioDiagLog] = useState<string[]>([]);
  const [audioDiagText, setAudioDiagText] = useState("");
  const [_hideTimer, _setHideTimer] = useState(false);
  const [timeAlert, setTimeAlert] = useState("");
  const [_isSepia, _setIsSepia] = useState(false);
  const [_fontSize, _setFontSize] = useState(16);
  const [_lineHeight, _setLineHeight] = useState(1.15); 
  const [_textAlign, _setTextAlign] = useState("left");
  const [_showLineNumbers, _setShowLineNumbers] = useState(false);
  const [_fontFam, _setFontFam] = useState("serif");
  
  // NEW EXAM STATE CHUẨN IDP
  const [examTheme, setExamTheme] = useState<'default'|'dark'|'yellow'>('default');
  const [examTextSize, setExamTextSize] = useState<'standard'|'large'|'xlarge'>('standard');
  const [showOptionsModal, setShowOptionsModal] = useState(false);
  const [optionsView, setOptionsView] = useState<'main'|'contrast'|'textsize'>('main');
  const [showBellModal, setShowBellModal] = useState(false);
  
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
        const [examCurrentQId, setExamCurrentQId] = useState<string>("");
        const [selectionMenu, setSelectionMenu] = useState<{x: number, y: number, range: Range, container: HTMLElement} | null>(null);
  const [noteInputMenu, setNoteInputMenu] = useState<{x: number, y: number, range?: Range, container: HTMLElement, existingNode?: HTMLElement, text: string} | null>(null);
  // PANEL NOTES (chuẩn Inspera): mở bằng nút ✎ trên top bar; notesTick ép quét lại DOM notes sau mỗi sửa/xóa.
  const [showNotesPanel, setShowNotesPanel] = useState(false);
  const [notesTick, setNotesTick] = useState(0);
  const [noteDeleteIdx, setNoteDeleteIdx] = useState<string | null>(null);
  const [noteExpandKeys, setNoteExpandKeys] = useState<Record<string, boolean>>({}); // Show more/less cho snippet dài trong panel Notes
  const [_saveStatus, setSaveStatus] = useState<string>("Saved");
  const [isPreview, setIsPreview] = useState(false);
  const [resultSearch, setResultSearch] = useState("");
  const [printBlankSheet, setPrintBlankSheet] = useState(false);
  const [hardLocked, setHardLocked] = useState(false);
  const [sebGuideQuiz, setSebGuideQuiz] = useState<Quiz | null>(null);
  const [screenshotFlash, setScreenshotFlash] = useState(false);
  const screenshotFlashRef = useRef<number | null>(null);
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
  // BẢN VÁ: DOM-SAFE HIGHLIGHT REMOVAL & SỬA GHI CHÚ NOTE
  // =========================================================
  useEffect(() => {
      const handleSafeHighlightRemoval = (e: MouseEvent) => {
          const target = e.target as HTMLElement;

          // CHẶN MENU CHUỘT PHẢI / LONG PRESS CỦA TRÌNH DUYỆT VÀ HỆ ĐIỀU HÀNH
          if (e.type === 'contextmenu' && target.closest('.exam-content-block')) {
              e.preventDefault();
          }

          // Click vào Note: KHÔNG mở hộp thoại tại chỗ nữa (chuẩn Inspera) — mở PANEL Notes bên phải.
          if (target && target.classList?.contains('student-note-hl')) {
              e.preventDefault();
              e.stopPropagation();
              setShowNotesPanel(true);
              setNotesTick(t => t + 1);
              setSelectionMenu(null);
              return;
          }
          
          // Xử lý Click vào Highlight vàng: Rút ruột và xóa bỏ
          const isHighlightNode = target && (target.tagName === 'MARK' || target.classList?.contains('idp-highlight') || target.classList?.contains('student-highlight'));
          if (isHighlightNode) {
              e.preventDefault(); e.stopPropagation();
              const parent = target.parentNode;
              if (!parent) return;
              const container = target.closest('.highlightable-content');

              while (target.firstChild) parent.insertBefore(target.firstChild, target);
              parent.removeChild(target);
              parent.normalize();

              if (container) container.dispatchEvent(new CustomEvent('highlight-removed', { bubbles: true }));
          }
      };

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
        input.classList.toggle('filled', input.value !== ""); // đã nhập -> viền xanh

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
  }, [activeExam, examAnswers, currentSectionIndex]);
  const [offlineMedia, setOfflineMedia] = useState<Record<string, string>>({});
  const [isOfflineReady, setIsOfflineReady] = useState(false);

  useEffect(() => { (window as any).__ielts_offline_media = offlineMedia; }, [offlineMedia]);

  useEffect(() => {
      const currentQuiz = activeExam || pendingExamState?.quiz;
      if (!currentQuiz || isPreview || userRole !== "STUDENT") {
          setOfflineMedia({});
          setIsOfflineReady(currentQuiz && (isPreview || userRole !== "STUDENT") ? true : false);
          return;
      }
      setIsOfflineReady(false);
      let isMounted = true;
      const urlsToCache = new Set<string>();

      // Audio must stay on its native URL. Turning a cross-origin stream into a Blob breaks Range support
      // and can create a zero-byte/error Blob on another device or browser.
      if (currentQuiz.images) currentQuiz.images.forEach(img => urlsToCache.add(img));

      const extractImgUrls = (html: string) => {
          if (!html) return;
          const matches = Array.from(html.matchAll(/<img[^>]+src="([^">]+)"/gi));
          for (const m of matches) {
              if (m[1] && m[1].startsWith('http')) urlsToCache.add(m[1]);
          }
      };

      const oldDict = (window as any).__ielts_offline_media;
      (window as any).__ielts_offline_media = null;

      extractImgUrls(formatContent(currentQuiz.passage || ""));
      currentQuiz.questions.forEach(q => {
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
              const controller = new AbortController();
              const timeout = window.setTimeout(() => controller.abort(), 12000);
              try {
                  const res = await fetch(url, { signal: controller.signal });
                  const contentType = res.headers.get("content-type") || "";
                  if (!res.ok || (contentType && !contentType.startsWith("image/"))) throw new Error("Invalid image response");
                  const blob = await res.blob();
                  if (!blob.size) throw new Error("Empty image response");
                  if (isMounted) setOfflineMedia(prev => ({ ...prev, [url]: URL.createObjectURL(blob) }));
              } catch (e) { console.warn("Background auto-download error:", url); }
              finally { clearTimeout(timeout); }
              loadedCount++;
          }
          if (isMounted && loadedCount === urls.length) setIsOfflineReady(true);
      };
      cacheAssets();
      return () => { isMounted = false; };
  }, [activeExam?.id, pendingExamState?.quiz?.id, isPreview, userRole]);

  const [showInventory, setShowInventory] = useState(false);
  const [invTab, setInvTab] = useState<"CONSUMABLE"|"PERMANENT">("CONSUMABLE");
  // Portal học viên chia tab để hết cuộn dài: Tổng quan / Phòng thi / Từ vựng / Tiến độ / Phần thưởng
  const [portalTab, setPortalTab] = useState<"home"|"exams"|"vocab"|"progress"|"rewards">("home");
  // Sub-tab trong Phòng thi HS (hết cuộn): đề khả dụng / kết quả & review
  const [examRoomTab, setExamRoomTab] = useState<"available"|"results">("available");
  // Sub-tab trong hồ sơ HS phía giáo viên: kết quả thi / buổi học / thống kê
  const [stuProfileTab, setStuProfileTab] = useState<"results"|"sessions"|"stats">("results");
  // Hàng kết quả thi / buổi học (GV) bung chi tiết theo id
  const [expandedResultId, setExpandedResultId] = useState<string|number|null>(null);
  const [expandedSessionId, setExpandedSessionId] = useState<string|number|null>(null);
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

  // Mô hình session "claim rồi mới canh chiếm quyền" — chống TỰ đăng xuất do drift id / readback cache.
  // sessionConfirmedRef: lần tải trang này ta đã từng xác nhận sở hữu phiên chưa? (reset khi logout)
  // myClaimAtRef: MỐC THỜI GIAN ta claim phiên gần nhất — chỉ nhường khi thiết bị khác claim MỚI HƠN.
  const sessionConfirmedRef = useRef(false);
  const myClaimAtRef = useRef(0);
  // CHỐNG "GIẬT" KHI XÓA DATA: số ghi của chính mình đang chạy + thời điểm hết chặn snapshot.
  const writeInFlightRef = useRef(0);
  const suppressSnapshotUntilRef = useRef(0);

  // Keep an on-device retry record until Firestore confirms a quiz transaction.
  const pendingQuizWriteKey = () => `ielts_pending_quiz_write_${String(currentUser?.email || "teacher").toLowerCase()}`;
  const readPendingQuizWrite = () => {
    try {
      const raw = localStorage.getItem(pendingQuizWriteKey());
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && Array.isArray(parsed.quizzes) ? parsed : null;
    } catch (e) { return null; }
  };
  const writePendingQuizWrite = (quizzesToSave: any[], deletedIds: string[] = []) => {
    try { localStorage.setItem(pendingQuizWriteKey(), JSON.stringify({ quizzes: quizzesToSave, deletedIds })); } catch (e) {}
  };
  const clearPendingQuizWrite = () => {
    try { localStorage.removeItem(pendingQuizWriteKey()); } catch (e) {}
  };
  // Sổ từ là dữ liệu do học sinh tạo. Giữ bản ghi local cho tới khi transaction xác nhận,
  // để refresh/đóng tab ngay sau khi thêm từ cũng không thể làm mất dữ liệu.
  const pendingVocabWriteKey = () => `ielts_pending_vocab_write_${String(currentUser?.email || "student").toLowerCase()}`;
  const readPendingVocabWrite = () => {
    try {
      const raw = localStorage.getItem(pendingVocabWriteKey());
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && Array.isArray(parsed.notebook) ? parsed : null;
    } catch (e) { return null; }
  };
  const writePendingVocabWrite = (notebook: any[], tombstones: any[] = []) => {
    try { localStorage.setItem(pendingVocabWriteKey(), JSON.stringify({ notebook, tombstones })); } catch (e) {}
  };
  const clearPendingVocabWrite = () => {
    try { localStorage.removeItem(pendingVocabWriteKey()); } catch (e) {}
  };
  const mergeVocabNotebook = (serverNotebook: any, localNotebook: any, serverTombstones: any, localTombstones: any) => {
    const tombstones = Array.from(new Set([
      ...(Array.isArray(serverTombstones) ? serverTombstones : []),
      ...(Array.isArray(localTombstones) ? localTombstones : []),
    ].map(String))).slice(-800);
    const cards = new Map<string, any>();
    (Array.isArray(serverNotebook) ? serverNotebook : []).forEach((card: any) => {
      if (card?.id) cards.set(String(card.id), card);
    });
    (Array.isArray(localNotebook) ? localNotebook : []).forEach((card: any) => {
      if (card?.id) cards.set(String(card.id), { ...cards.get(String(card.id)), ...card });
    });
    return { notebook: Array.from(cards.values()).filter((card: any) => !tombstones.includes(String(card.id))), tombstones };
  };
  const mergeQuizCatalog = (serverQuizzes: any[], localQuizzes: any[], deletedIds: string[] = []) => {
    const deleted = new Set((deletedIds || []).map(String));
    const local = (Array.isArray(localQuizzes) ? localQuizzes : []).filter(q => q && q.id && !deleted.has(String(q.id)));
    const localIds = new Set(local.map(q => String(q.id)));
    return [...local, ...(Array.isArray(serverQuizzes) ? serverQuizzes : []).filter(q => q && q.id && !deleted.has(String(q.id)) && !localIds.has(String(q.id)))];
  };

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
      let shouldForceSyncSession = false;

      if (!localSessionId) {
          localSessionId = "DEV_SESSION_" + Date.now().toString() + "_" + Math.random().toString(36).substring(2, 7);
          localStorage.setItem("ielts_os_device_session", localSessionId);
          localStorage.setItem("ielts_os_session_created_at", Date.now().toString());
          shouldForceSyncSession = true;
      }

      // ===== SESSION CHỐNG TỰ ĐĂNG XUẤT — so theo MỐC THỜI GIAN claim, không chỉ so id =====
      // LỖI CŨ: effect chạy mỗi khi 'students' đổi; hễ currentSessionId(server) lệch localSessionId là
      // đá ra "đăng nhập máy khác" -> mọi action tự logout. So-id-thuần vẫn dính RACE: state local lạc quan
      // ghi id ta rồi onSnapshot trả về dữ liệu CŨ TỪ CACHE (id cũ) -> đá nhầm ngay khi vừa login.
      // SỬA: mỗi lần claim ghi kèm 'sessionClaimedAt'. Chỉ NHƯỜNG khi ta đã từng sở hữu VÀ server mang
      // id khác với mốc claim MỚI HƠN mốc của ta (= thiết bị khác đăng nhập sau). Dữ liệu cũ đọc về
      // (mốc cũ hơn/bằng) -> chỉ GIÀNH LẠI quyền, KHÔNG đá. getTrueTime() để giảm lệch đồng hồ giữa máy.
      let newSessionClaimedAt = meLocal.sessionClaimedAt || 0;
      if (meLocal.currentSessionId === localSessionId) {
          sessionConfirmedRef.current = true;                          // đang sở hữu phiên hợp lệ
          if (newSessionClaimedAt > myClaimAtRef.current) myClaimAtRef.current = newSessionClaimedAt;
      } else if (sessionConfirmedRef.current && newSessionClaimedAt > myClaimAtRef.current) {
          alert("SECURITY WARNING: Your account was logged in from another device!\n\nThe system will automatically log out this session to protect your data and exam progress.");
          handleLogout();
          return;
      } else if (!sessionConfirmedRef.current) {
          // Lần tải/đăng nhập đầu tiên trong phiên này -> GIÀNH quyền MỘT LẦN (mốc mới), KHÔNG đá.
          newSessionClaimedAt = getTrueTime();
          myClaimAtRef.current = newSessionClaimedAt;
          shouldForceSyncSession = true;
      }
      // else: đã sở hữu cục bộ + chỉ là dữ liệu CŨ đọc về (mốc không mới hơn) -> BỎ QUA, KHÔNG ghi đè.
      // (Tránh write-storm ghi bằng state cũ -> đây từng là nguồn làm bay mất quà permanents.)

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
          let msg = `DAILY ATTENDANCE: +20 Coins\n Current streak: ${newStreak} days.`;
          if (newStreak > 0 && newStreak % 7 === 0) {
              bonusCoins += 300;
              msg += `\n 7-DAY STREAK BONUS: +300 Coins!`;
          }
          newCoins += bonusCoins;
          alert(msg);
      }

      if (shouldUpdate) {
          const nx = students.map(s => s.id === meLocal.id ? { ...s, coins: newCoins, lastLoginDate: today, currentStreak: newStreak, currentSessionId: localSessionId || undefined, sessionClaimedAt: newSessionClaimedAt, activeExamId: newActiveExamId } : s);
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
    const [, _setSortQuiz] = useState<"NEW"|"OLD"|"AZ">("NEW");
  const [builderFolder, setBuilderFolder] = useState("Root");
  const [builderSearch, setBuilderSearch] = useState("");
  const [builderSectionIndex, setBuilderSectionIndex] = useState(0);   
  const [, _setScrollPct] = useState(0);
  const [_showQuestionNotes, _setShowQuestionNotes] = useState<Record<string, boolean>>({});
  const [_showQuestionMap, _setShowQuestionMap] = useState(false);
  const [enableTimerBeep, _setEnableTimerBeep] = useState(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioPlayRequestRef = useRef(false);
  const examAudioShouldPlayRef = useRef(false);
  const examAudioResumeTimerRef = useRef<number | null>(null);
  const examAudioRecoveryAttemptsRef = useRef(0);
  const externalPauseTimesRef = useRef<number[]>([]);
  const meetAudioIssueRef = useRef(false);
  const androidAudioCtxRef = useRef<AudioContext | null>(null);
  const examTimerRef = useRef<number | null>(null);
  const forceSubmitExamRef = useRef<(() => void) | null>(null);
  const latestExamState = useRef({ activeExam, examAnswers, flaggedQuestions, examCheatCount, qNotes, scratchpadText, isPreview, examStartTime, crossedOptions, currentUser, students, enableTimerBeep }); 

  const isListeningExamAudio = () => {
    if (!activeExam) return false;
    const type = String(activeExam.type || "").toLowerCase();
    return type.includes("listen") || activeExam.type === "Integrated";
  };

  const isListeningReviewAudio = () => {
    if (!reviewQuiz?.quiz?.audioUrl) return false;
    const type = String(reviewQuiz.quiz.type || "").toLowerCase();
    return type.includes("listen") || reviewQuiz.quiz.type === "Integrated";
  };

  const hasListeningAudio = () => isListeningExamAudio() || isListeningReviewAudio();

  const isStrictExamAudio = () => {
    return isListeningExamAudio() && (activeExam as any).audioMode !== "practice";
  };

  const clearExamAudioResumeTimer = () => {
    if (examAudioResumeTimerRef.current !== null) {
      window.clearTimeout(examAudioResumeTimerRef.current);
      examAudioResumeTimerRef.current = null;
    }
  };

  const setManagedAudioLoading = () => {
    if (isListeningReviewAudio()) setRvAudioPlaying(false);
    else setAudioStatus("LOADING");
  };

  const getAudioModeLabel = () => {
    if (isListeningReviewAudio()) return "review";
    if (!activeExam) return "none";
    return String((activeExam as any).audioMode || "once");
  };

  const isTouchAudioHost = () => {
    return Boolean(
      navigator.maxTouchPoints > 0 ||
      (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) ||
      /Android|Mobile|Tablet|SamsungBrowser/i.test(navigator.userAgent)
    );
  };

  const recordAudioDiagnostic = (event: string, audio?: HTMLAudioElement | null, detail = "") => {
    const line = JSON.stringify({
      at: new Date().toISOString(),
      event,
      mode: getAudioModeLabel(),
      t: Number((audio?.currentTime || 0).toFixed(2)),
      paused: audio?.paused,
      ended: audio?.ended,
      readyState: audio?.readyState,
      networkState: audio?.networkState,
      error: audio?.error ? `${audio.error.code}:${audio.error.message || ""}` : "",
      visibility: document.visibilityState,
      focused: document.hasFocus(),
      touchHost: isTouchAudioHost(),
      maxTouchPoints: navigator.maxTouchPoints || 0,
      attempts: examAudioRecoveryAttemptsRef.current,
      detail,
      ua: navigator.userAgent
    });
    setAudioDiagLog(prev => [...prev.slice(-79), line]);
  };

  const warmAndroidAudioPath = async () => {
    if (!isTouchAudioHost()) return;
    try {
      const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextCtor) return;
      const ctx = androidAudioCtxRef.current || new AudioContextCtor();
      androidAudioCtxRef.current = ctx;
      if (ctx.state === "suspended") await ctx.resume();
      const buffer = ctx.createBuffer(1, 1, 22050);
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      gain.gain.value = 0.00001;
      source.buffer = buffer;
      source.connect(gain);
      gain.connect(ctx.destination);
      source.start(0);
    } catch (error) {
      recordAudioDiagnostic("audio-context-warm-failed", audioRef.current, error instanceof Error ? error.name : String(error));
    }
  };

  const rememberExternalPause = (audio: HTMLAudioElement) => {
    const now = Date.now();
    externalPauseTimesRef.current = [...externalPauseTimesRef.current.filter(t => now - t < 7000), now];
    if (externalPauseTimesRef.current.length >= 3) {
      meetAudioIssueRef.current = true;
      setMeetAudioIssue(true);
      recordAudioDiagnostic("external-audio-focus-suspected", audio, `${externalPauseTimesRef.current.length} pauses/7s`);
    }
  };

  const copyAudioDiagnostic = async () => {
    const audio = audioRef.current;
    const snapshot = JSON.stringify({
      at: new Date().toISOString(),
      issue: "Android Google Meet audio interruption",
      mode: getAudioModeLabel(),
      currentTime: audio?.currentTime || 0,
      duration: audio?.duration || 0,
      paused: audio?.paused,
      readyState: audio?.readyState,
      networkState: audio?.networkState,
      src: audio?.currentSrc || audio?.src || "",
      visibility: document.visibilityState,
      focused: document.hasFocus(),
      touchHost: isTouchAudioHost(),
      maxTouchPoints: navigator.maxTouchPoints || 0,
      userAgent: navigator.userAgent
    });
    const text = [snapshot, ...audioDiagLog].join("\n");
    setAudioDiagText(text);
    try {
      await navigator.clipboard.writeText(text);
      alert("Audio diagnostic copied. If paste is empty, use the visible log box.");
    } catch {
      window.prompt("Copy audio diagnostic", text);
    }
  };

  const renderMeetAudioNotice = () => meetAudioIssue ? (
    <div style={{ margin: '8px 0', padding: '10px 12px', border: '1px solid #f59e0b', background: '#fffbeb', color: '#78350f', borderRadius: 6, fontSize: 13, lineHeight: 1.35 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <span>Google Meet on Android is interrupting audio focus. Mic on/off may not fix this; use Meet screen share audio if available, or use Zoom/desktop for stable listening.</span>
        <span style={{ display: 'inline-flex', gap: 8 }}>
          <button onClick={() => { if (isListeningReviewAudio()) void requestReviewAudioPlayback(); else void requestExamAudioPlayback(); }} style={{ border: '1px solid #92400e', background: '#fff7ed', color: '#78350f', borderRadius: 4, padding: '5px 9px', fontWeight: 800, cursor: 'pointer' }}>Resume</button>
          <button onClick={copyAudioDiagnostic} style={{ border: '1px solid #92400e', background: '#fff7ed', color: '#78350f', borderRadius: 4, padding: '5px 9px', fontWeight: 800, cursor: 'pointer' }}>Show log</button>
        </span>
      </div>
      {audioDiagText && (
        <textarea
          readOnly
          value={audioDiagText}
          onFocus={(e) => e.currentTarget.select()}
          style={{ marginTop: 8, width: '100%', height: 96, boxSizing: 'border-box', border: '1px solid #f59e0b', borderRadius: 4, background: '#fff', color: '#111827', fontFamily: 'Consolas, monospace', fontSize: 11 }}
        />
      )}
    </div>
  ) : null;

  const recoverInterruptedExamAudio = (audio: HTMLAudioElement) => {
    if (!hasListeningAudio() || !examAudioShouldPlayRef.current || audio.ended) return;
    if (meetAudioIssueRef.current) {
      setManagedAudioLoading();
      return;
    }
    if (examAudioResumeTimerRef.current !== null) return;
    setManagedAudioLoading();
    const retryDelay = Math.min(1500, 120 + examAudioRecoveryAttemptsRef.current * 180);
    examAudioResumeTimerRef.current = window.setTimeout(async () => {
      examAudioResumeTimerRef.current = null;
      if (!hasListeningAudio() || !examAudioShouldPlayRef.current || audioRef.current !== audio || !audio.paused || audio.ended) return;
      if (audioPlayRequestRef.current) {
        recoverInterruptedExamAudio(audio);
        return;
      }
      audioPlayRequestRef.current = true;
      try {
        audio.playbackRate = isListeningReviewAudio() ? playbackRate : audioRate;
        await warmAndroidAudioPath();
        recordAudioDiagnostic("auto-resume-attempt", audio);
        await audio.play();
      } catch (error) {
        examAudioRecoveryAttemptsRef.current += 1;
        recordAudioDiagnostic("auto-resume-failed", audio, error instanceof Error ? `${error.name}:${error.message}` : String(error));
        console.warn("Exam audio auto-resume failed:", error);
      } finally {
        audioPlayRequestRef.current = false;
        if (examAudioShouldPlayRef.current && audio.paused && !audio.ended) recoverInterruptedExamAudio(audio);
      }
    }, retryDelay);
  };

  const requestManagedAudioPlayback = async (rate: number) => {
    const audio = audioRef.current;
    if (!audio || (!audio.currentSrc && !audio.src)) return;

    clearExamAudioResumeTimer();
    meetAudioIssueRef.current = false;
    setMeetAudioIssue(false);
    externalPauseTimesRef.current = [];
    examAudioShouldPlayRef.current = true;
    examAudioRecoveryAttemptsRef.current = 0;
    if (audioPlayRequestRef.current) return;
    audioPlayRequestRef.current = true;
    if (audio.ended) audio.currentTime = 0;
    audio.playbackRate = rate;
    setManagedAudioLoading();
    try {
      await warmAndroidAudioPath();
      recordAudioDiagnostic("user-play-attempt", audio);
      await audio.play();
    } catch (error) {
      recordAudioDiagnostic("user-play-failed", audio, error instanceof Error ? `${error.name}:${error.message}` : String(error));
      console.warn("Exam audio could not start:", error);
    } finally {
      audioPlayRequestRef.current = false;
      if (examAudioShouldPlayRef.current && audio.paused && !audio.ended) recoverInterruptedExamAudio(audio);
    }
  };

  const requestExamAudioPlayback = () => requestManagedAudioPlayback(audioRate);

  const pauseExamAudioPlayback = () => {
    examAudioShouldPlayRef.current = false;
    clearExamAudioResumeTimer();
    const audio = audioRef.current;
    if (audio) audio.pause();
    if (isListeningReviewAudio()) setRvAudioPlaying(false);
  };

  const handleExamAudioPlaying = () => {
    clearExamAudioResumeTimer();
    examAudioShouldPlayRef.current = true;
    examAudioRecoveryAttemptsRef.current = 0;
    recordAudioDiagnostic("playing", audioRef.current);
    if ("mediaSession" in navigator) {
      try { navigator.mediaSession.playbackState = "playing"; } catch { }
    }
    if (isListeningReviewAudio()) setRvAudioPlaying(true);
    else setAudioStatus("PLAYING");
  };

  const handleExamAudioPause = (audio: HTMLAudioElement) => {
    if (audio.ended) return;
    recordAudioDiagnostic("pause", audio);
    if (hasListeningAudio() && examAudioShouldPlayRef.current) {
      rememberExternalPause(audio);
      recoverInterruptedExamAudio(audio);
      return;
    }
    if ("mediaSession" in navigator) {
      try { navigator.mediaSession.playbackState = "paused"; } catch { }
    }
    if (isListeningReviewAudio()) setRvAudioPlaying(false);
    else setAudioStatus("PAUSED");
  };

  const handleExamAudioEnded = () => {
    examAudioShouldPlayRef.current = false;
    clearExamAudioResumeTimer();
    recordAudioDiagnostic("ended", audioRef.current);
    if ("mediaSession" in navigator) {
      try { navigator.mediaSession.playbackState = "none"; } catch { }
    }
    if (isListeningReviewAudio()) setRvAudioPlaying(false);
    else setAudioStatus("ENDED");
  };

  const handleExamAudioError = (error: MediaError | null) => {
    recordAudioDiagnostic("error", audioRef.current, error ? `${error.code}:${error.message || ""}` : "");
    if (error?.code === MediaError.MEDIA_ERR_ABORTED && examAudioShouldPlayRef.current && audioRef.current) {
      recoverInterruptedExamAudio(audioRef.current);
      return;
    }
    examAudioShouldPlayRef.current = false;
    clearExamAudioResumeTimer();
    audioPlayRequestRef.current = false;
    console.warn("Exam audio source failed:", error);
    if (isListeningReviewAudio()) setRvAudioPlaying(false);
    else setAudioStatus("IDLE");
  };

  const updateExamMediaSessionPosition = (audio: HTMLAudioElement) => {
    const mediaSession = (navigator as any).mediaSession;
    if (!mediaSession?.setPositionState || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    try {
      mediaSession.setPositionState({
        duration: audio.duration,
        playbackRate: audio.playbackRate || 1,
        position: Math.min(audio.currentTime || 0, audio.duration)
      });
    } catch { }
  };

  const requestReviewAudioPlayback = () => requestManagedAudioPlayback(playbackRate);

  const [resFilterStudent, setResFilterStudent] = useState<string>("");
  const [resFilterQuiz, setResFilterQuiz] = useState<string>("");
  const [resFilterBand, setResFilterBand] = useState<string>("");

  const playBeep = (freq = 800, duration = 300) => {
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

  
useEffect(() => {
      localStorage.setItem('ielts_pref_sepia', _isSepia.toString());
      localStorage.setItem('ielts_pref_fontsize', _fontSize.toString());
      localStorage.setItem('ielts_pref_lineheight', _lineHeight.toString());
      localStorage.setItem('ielts_pref_align', _textAlign);
      localStorage.setItem('ielts_pref_lines', _showLineNumbers.toString());
      localStorage.setItem('ielts_pref_fontfam', _fontFam);
  }, [_isSepia, _fontSize, _lineHeight, _textAlign, _showLineNumbers, _fontFam]);

  useEffect(() => {
      const clockInt = setInterval(() => setLiveTime(new Date(getRealTime()).toLocaleTimeString('vi-VN')), 1000);
      return () => clearInterval(clockInt);
  }, [activeExam, examTimeLeft]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
    void syncTimeNetwork().then((synced) => { setTimeOffset(0); setIsTimeSynced(synced); });
    const savedLogin = localStorage.getItem('ielts_last_login');
    if (savedLogin) setLastLoginTime(savedLogin);
    
    const handleOffline = () => setIsOffline(true);
    const handleOnline = () => { setIsOffline(false); flushOfflineQueue(); };
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => { window.removeEventListener("offline", handleOffline); window.removeEventListener("online", handleOnline); };
  }, [quizResults, currentUser]);

  // Đồng bộ hàng đợi nộp bài offline (gọi khi online lại + khi tải app)
  const flushOfflineQueue = async () => {
    const email = currentUser?.email;
    if (!email || !navigator.onLine) return;
    // Tương thích ngược: gộp key cũ (1 kết quả) vào hàng đợi
    const legacy = localStorage.getItem(`ielts_offline_result_${email}`);
    let q = readOfflineQueue(email);
    if (legacy) { try { q = [JSON.parse(legacy), ...q]; } catch {} localStorage.removeItem(`ielts_offline_result_${email}`); }
    if (!q.length) return;
    try {
      setQuizResults(prev => {
        const ids = new Set(prev.map(r => r.id));
        return [...q.filter((r: any) => !ids.has(r.id)), ...prev];
      });
      await syncData({ quizResults: q }); // transaction tự gộp theo id, không ghi đè bài cũ
      writeOfflineQueue(email, []);
      alert(`Đã đồng bộ ${q.length} bài thi offline lên máy chủ thành công!`);
    } catch (e) {
      console.warn("Flush offline queue failed, will retry later:", e);
    }
  };

  // Flush khi app vừa tải xong và đang online (phòng khi sự kiện 'online' bị bỏ lỡ lúc app đóng)
  useEffect(() => {
    if (loaded && currentUser?.email && navigator.onLine) flushOfflineQueue();
  }, [loaded, currentUser]);

  const myTeacherName = useMemo(() => {
    if (!currentUser) return "Teacher";
    const e = currentUser.email?.toLowerCase() || "";
    if (e === "trung@ielts.os") return "Truong Thanh Trung";
    if (e === "linh@ielts.os") return "Vi Thi Khanh Linh";
    return e.split("@")[0] || "Teacher";
  }, [currentUser, userRole]);

  const greetingText = useMemo(() => {
      const hour = new Date().getHours();
      if (hour < 12) return t('welcome_morning');
      if (hour < 18) return t('welcome_afternoon');
      return t('welcome_evening');
  }, [i18n.language]);

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
// ==========================================
// VÁ LỖI MÀN HÌNH TRẮNG: BỘ LỌC RÁC FIREBASE
// ==========================================
const clean = (arr: any) => Array.isArray(arr) ? arr.filter(item => item !== null && item !== undefined) : [];

// ===== LỚP CHỐNG MẤT QUÀ Ở PHÍA ĐỌC =====
// permanents và vocabNotebook đều là dữ liệu do học sinh tạo. onSnapshot có thể trả snapshot CŨ từ cache
// hoặc server chưa kịp có write -> dữ liệu vừa thêm biến mất trước mắt. Với vocab, merge theo ID + tombstone
// và chỉ xóa retry record khi snapshot server xác nhận đã có đủ dữ liệu đó.
const mergeMyPermanents = (prev: any, incoming: any[]) => {
  try {
    const email = String((window as any).__ielts_user_id || "").toLowerCase();
    if (!email) return incoming;
    const bkKey = "ielts_os_perms_" + email;
    let backup: string[] = [];
    try { backup = JSON.parse(localStorage.getItem(bkKey) || "[]"); } catch (e) { backup = []; }
    const prevArr = Array.isArray(prev) ? prev : [];
    const prevMe = prevArr.find((s: any) => String(s?.email || "").toLowerCase() === email);
    const prevPerms = Array.isArray(prevMe?.inventory?.permanents) ? prevMe.inventory.permanents : [];
    const pendingVocab = readPendingVocabWrite();
    return incoming.map((s: any) => {
      if (String(s?.email || "").toLowerCase() !== email) return s;
      const inPerms = Array.isArray(s?.inventory?.permanents) ? s.inventory.permanents : [];
      const union = Array.from(new Set([...(Array.isArray(backup) ? backup : []), ...prevPerms, ...inPerms]));
      const dedicatedReady = vocabStoreReadyRef.current[email];
      const mergedVocab = dedicatedReady
        ? {
            notebook: Array.isArray(prevMe?.vocabNotebook) ? prevMe.vocabNotebook : [],
            tombstones: Array.isArray(prevMe?.vocabTombstones) ? prevMe.vocabTombstones : [],
          }
        : mergeVocabNotebook(
            s.vocabNotebook,
            [...(Array.isArray(prevMe?.vocabNotebook) ? prevMe.vocabNotebook : []), ...(pendingVocab?.notebook || [])],
            s.vocabTombstones,
            [...(Array.isArray(prevMe?.vocabTombstones) ? prevMe.vocabTombstones : []), ...(pendingVocab?.tombstones || [])]
          );
      if (pendingVocab) {
        const serverIds = new Set((Array.isArray(s.vocabNotebook) ? s.vocabNotebook : []).map((card: any) => String(card?.id || "")));
        const serverTombs = new Set((Array.isArray(s.vocabTombstones) ? s.vocabTombstones : []).map(String));
        const confirmedCards = pendingVocab.notebook.every((card: any) => !card?.id || serverIds.has(String(card.id)));
        const confirmedDeletes = (pendingVocab.tombstones || []).every((id: any) => serverTombs.has(String(id)));
        if (confirmedCards && confirmedDeletes) clearPendingVocabWrite();
      }
      try { localStorage.setItem(bkKey, JSON.stringify(union)); } catch (e) {}
      return {
        ...s,
        inventory: { consumables: {}, ...(s.inventory || {}), permanents: union },
        vocabNotebook: mergedVocab.notebook,
        vocabTombstones: mergedVocab.tombstones,
      };
    });
  } catch (e) { return incoming; }
};

const unsub = onSnapshot(DB_DOC_REF, (snap) => {
  // CHỐNG "GIẬT": bỏ qua snapshot từ server khi ĐANG có ghi của chính mình hoặc vừa ghi xong (cửa sổ ngắn).
  // Lúc này state local đã là nguồn đúng; nếu để snapshot CŨ đè vào thì data vừa xóa sẽ nhấp nháy hiện lại.
  if (writeInFlightRef.current > 0 || Date.now() < suppressSnapshotUntilRef.current) return;
  if (snap.exists()) {
    const d = snap.data();
    // Bọc toàn bộ dữ liệu qua hàm clean() để triệt tiêu null/undefined
    setStudents((prev: any) => mergeMyPermanents(prev, clean(d.students)));
    setHistory(clean(d.history));
    setTransactions(clean(d.transactions)); 
    setSchedules(clean(d.schedules));
    setSharedLinks(clean(d.sharedLinks)); 
    const serverQuizzes = clean(d.quizzes);
    const pendingQuizWrite = userRole === "TEACHER" ? readPendingQuizWrite() : null;
    if (pendingQuizWrite) {
      const recoveredQuizzes = mergeQuizCatalog(serverQuizzes, pendingQuizWrite.quizzes, pendingQuizWrite.deletedIds);
      setQuizzes(recoveredQuizzes);
      // The prior browser session ended before Firestore acknowledged its write. Retry
      // after this snapshot has settled; syncData clears the record only on success.
      window.setTimeout(() => { void syncData({ quizzes: recoveredQuizzes, __quizDeletedIds: pendingQuizWrite.deletedIds || [] }); }, 0);
    } else {
      setQuizzes(serverQuizzes);
    }
    setQuizResults(clean(d.quizResults)); 
    setBannedIps(clean(d.bannedIps));
    setAnnouncement(d.announcement || "");
    setSystemLogs(clean(d.systemLogs));
    setRewardCodes(clean(d.rewardCodes));
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
    if (!loaded || userRole !== "STUDENT" || !currentUser?.email) return;
    const vocabEmail = String(currentUser.email).trim().toLowerCase();
    const unsubVocab = onSnapshot(vocabCardsRef(vocabEmail), (snap) => {
      const snapshotNotebook: VocabCard[] = [];
      const snapshotTombstones: string[] = [];
      snap.docs.forEach(cardSnap => {
        const value: any = cardSnap.data() || {};
        const id = String(value.id || cardSnap.id);
        if (value.deleted) snapshotTombstones.push(id);
        else snapshotNotebook.push({ ...value, id } as VocabCard);
      });

      const pending = readPendingVocabWrite();
      const me = studentsRef.current.find(s => String(s.email || "").trim().toLowerCase() === vocabEmail);
      const legacyNotebook = Array.isArray(me?.vocabNotebook) ? me.vocabNotebook : [];
      const legacyTombstones = Array.isArray(me?.vocabTombstones) ? me.vocabTombstones : [];
      let notebook = snapshotNotebook;
      let tombstones = snapshotTombstones;
      const shouldMigrateLegacy = snap.empty && !vocabMigrationAttemptedRef.current[vocabEmail]
        && (legacyNotebook.length > 0 || legacyTombstones.length > 0);

      if (shouldMigrateLegacy) vocabMigrationAttemptedRef.current[vocabEmail] = true;
      if (shouldMigrateLegacy || pending) {
        const merged = mergeVocabNotebook(
          snapshotNotebook,
          [...legacyNotebook, ...(pending?.notebook || [])],
          snapshotTombstones,
          [...legacyTombstones, ...(pending?.tombstones || [])]
        );
        notebook = merged.notebook;
        tombstones = merged.tombstones;
        if (!vocabPersistInFlightRef.current[vocabEmail]) {
          vocabPersistInFlightRef.current[vocabEmail] = true;
          void persistVocabCards(vocabEmail, notebook, tombstones)
            .catch(error => console.error("Dedicated vocab write failed; Firebase offline queue will retry:", error))
            .finally(() => { vocabPersistInFlightRef.current[vocabEmail] = false; });
        }
      }

      if (snap.size > 0) vocabStoreReadyRef.current[vocabEmail] = true;
      if (pending) {
        const serverIds = new Set(snapshotNotebook.map(card => String(card.id)));
        const serverTombs = new Set(snapshotTombstones.map(String));
        const confirmedCards = pending.notebook.every((card: any) => !card?.id || serverIds.has(String(card.id)));
        const confirmedDeletes = (pending.tombstones || []).every((id: any) => serverTombs.has(String(id)));
        if (confirmedCards && confirmedDeletes) clearPendingVocabWrite();
      }
      setStudents(prev => prev.map(student =>
        String(student.email || "").trim().toLowerCase() === vocabEmail
          ? { ...student, vocabNotebook: notebook, vocabTombstones: tombstones }
          : student
      ));
    }, error => {
      console.error("Dedicated vocab listener failed:", error);
    });
    return () => unsubVocab();
  }, [currentUser, loaded, userRole]);

  useEffect(() => {
      latestExamState.current = { activeExam, examAnswers, flaggedQuestions, examCheatCount, qNotes, scratchpadText, isPreview, examStartTime, crossedOptions, currentUser, students, enableTimerBeep };
  }, [activeExam, examAnswers, flaggedQuestions, examCheatCount, qNotes, scratchpadText, isPreview, examStartTime, crossedOptions, currentUser, students, enableTimerBeep]);

  // FIX: Sync editingQuizRef với editingQuiz state
  useEffect(() => {
      editingQuizRef.current = editingQuiz;
  }, [editingQuiz]);

  useEffect(() => {
      setAudioUploadProgress(null);
      setAudioUploadMsg("");
  }, [editingQuiz?.id]);

  useEffect(() => {
      // ĐàFIX: Thuật toán kéo Splitter cũ đã bị vô hiệu hóa để chống xung đột scroll.
      // Chúng ta sẽ dùng Pointer Events hiện đại gắn trực tiếp vào thanh Splitter ở DOM bên dưới.
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

                      // ĐàFIX: Bắt quả tang hành vi Tải lại trang (Reload) hoặc Thoát App (Kill App)
                      let restoredCheatCount = (saved.cheatCount || 0) + 1;
                      setExamCheatCount(restoredCheatCount);
                      if (restoredCheatCount >= 3) {
                          setGracePeriod(0); // Cưỡng chế nộp bài ngay lập tức nếu quá 3 lần
                      } else {
                          setHardLocked(true); // Khóa màn hình bắt gõ chữ RETURN
                      }

                      setActiveExam(saved.quiz); 
                      setExamAnswers(saved.answers || {});
                      setFlaggedQuestions(saved.flags || []); 
                      setExamStartTime(saved.startTime); 
                      setExamTimeLeft(timeLeft); 
                      trueEndTimeRef.current = saved.startTime + (saved.quiz.timeLimit * 60 * 1000);
                      setQNotes(saved.qNotes || {}); 
                      setScratchpadText(saved.scratchpad || "");
                      setIsFocusMode(false);
                      setCrossedOptions(saved.crossed || {});
                      
                      if (saved.quiz.type === "Listening" && saved.quiz.audioUrl) {
                          _setAudioTested(true);
                          if (saved.audioStatus === "ENDED") {
                              setAudioStatus("ENDED");
                          } else if (saved.audioStatus === "PLAYING" || saved.audioTime > 0) {
                              // Lưu mốc thời gian Audio bị ngắt để Lát nữa tua (Seek) tới đúng giây đó
                              setPendingAudioResume({ time: saved.audioTime || 0, status: saved.audioStatus || "IDLE" });
                              setAudioStatus("IDLE");
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
              alert(`ERROR: ${reason}. OVER 3 VIOLATIONS! EXAM AUTO-SUBMITTED.`);
              forceSubmitExamRef.current?.();
              return newCount;
            } else {
              setHardLocked(true);
              return newCount;
            }
          });
      };

      const handleVisibilityChange = () => { if (document.hidden) triggerCheatPenalty("Leaving exam window / Switching tabs"); };
      const handleBeforeUnload = (e: any) => { e.preventDefault(); e.returnValue = ""; };
      const disableCtrlF = (e: KeyboardEvent) => {
          const key = (e.key || "").toLowerCase();
          const ctrl = e.ctrlKey || e.metaKey;
          if (ctrl && key === 'f') { e.preventDefault(); alert("WARNING: Search function is disabled!"); return; }
          // Chặn Ctrl/Cmd+S (lưu trang) và Ctrl/Cmd+Shift+P khi thí sinh đang thi thật (không áp dụng thi thử GV / SEB tự chặn ở tầng OS)
          if (ctrl && key === 's') { e.preventDefault(); e.stopPropagation(); return; }
          if (ctrl && e.shiftKey && key === 'p') { e.preventDefault(); e.stopPropagation(); return; }
      };
      const handleFullscreenChange = () => { 
          if (!document.fullscreenElement) { 
              setIsFocusMode(false); 
              triggerCheatPenalty("Exiting fullscreen (Esc)");
          } 
      };
      
      document.addEventListener("visibilitychange", handleVisibilityChange);
      window.addEventListener("beforeunload", handleBeforeUnload);
      window.addEventListener('keydown', disableCtrlF, true);
      document.addEventListener('fullscreenchange', handleFullscreenChange);
      
      return () => { 
          document.removeEventListener("visibilitychange", handleVisibilityChange); 
          window.removeEventListener("beforeunload", handleBeforeUnload); 
          window.removeEventListener('keydown', disableCtrlF, true);
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
            key === 'F13' ||                                            // Một số bàn phím map PrtSc  F13
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
                        alert('Screenshot attempt detected! OVER 3 VIOLATIONS. EXAM AUTO-SUBMITTED.');
                        forceSubmitExamRef.current?.();
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
        const examUser = state.currentUser;
        if (exactTimeLeft > 0 && exactTimeLeft % 5 === 0 && !state.isPreview && examUser) {
            setLiveSessions(prev => {
                const ansCount = Object.keys(state.examAnswers).filter(k => state.examAnswers[k] !== undefined && state.examAnswers[k] !== "").length;
                const pct = Math.round((ansCount / state.activeExam!.questions.length) * 100);
                const me = state.students.find(s => s.email?.toLowerCase() === examUser.email?.toLowerCase());
                const newSession: LiveSession = {
                    id: examUser.email || "unknown", studentId: me?.id || "unknown", studentName: me?.name || examUser.email?.split('@')[0] || "Student",
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
            if (state.enableTimerBeep) playBeep(1200, 800);
            if (examTimerRef.current) window.clearInterval(examTimerRef.current);
        } else {
            setExamTimeLeft(exactTimeLeft);
            if (exactTimeLeft === 600) { setTimeAlert("10 minutes left!"); setTimeout(()=>setTimeAlert(""), 5000); if (state.enableTimerBeep) playBeep(880, 200); }
            if (exactTimeLeft === 300) { setTimeAlert("5 minutes left!"); setTimeout(()=>setTimeAlert(""), 5000); if (state.enableTimerBeep) playBeep(880, 300); }
            if (exactTimeLeft <= 60 && exactTimeLeft % 10 === 0) { if (state.enableTimerBeep) playBeep(1000, 500); }
        }
        
        let aTime = 0; let aStatus = "IDLE";
        if (audioRef.current) {
            aTime = audioRef.current.currentTime;
            aStatus = audioRef.current.ended ? "ENDED" : (!audioRef.current.paused ? "PLAYING" : "PAUSED");
        }

        if (!state.isPreview) {
            localStorage.setItem(`ielts_os_exam_state_${state.currentUser?.email}`, JSON.stringify({ 
                quiz: state.activeExam, startTime: state.examStartTime, answers: state.examAnswers, flags: state.flaggedQuestions, cheatCount: state.examCheatCount, qNotes: state.qNotes, scratchpad: state.scratchpadText, crossed: state.crossedOptions, audioTime: aTime, audioStatus: aStatus
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
          forceSubmitExamRef.current?.();
          setGracePeriod(null);
      }
  }, [gracePeriod]);

  useEffect(() => {
      if (activeExam) {
          const checkFullscreen = () => setIsFullScreen(!!document.fullscreenElement);
          checkFullscreen();
          document.addEventListener('fullscreenchange', checkFullscreen);
          return () => document.removeEventListener('fullscreenchange', checkFullscreen);
      }
      setIsFullScreen(true);
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

  useEffect(() => { if (audioRef.current) audioRef.current.volume = _audioVolume; }, [_audioVolume]);

  useEffect(() => {
      setMeetAudioIssue(false);
      meetAudioIssueRef.current = false;
      setAudioDiagLog([]);
      setAudioDiagText("");
      externalPauseTimesRef.current = [];
      examAudioRecoveryAttemptsRef.current = 0;
  }, [activeExam?.id, activeExam?.audioUrl, reviewQuiz?.quiz?.id, reviewQuiz?.quiz?.audioUrl]);

  useEffect(() => {
      const currentAudio = isListeningReviewAudio() ? reviewQuiz?.quiz : activeExam;
      if (!currentAudio?.audioUrl || !hasListeningAudio() || !("mediaSession" in navigator)) return;
      if (isTouchAudioHost()) return;
      try {
          navigator.mediaSession.metadata = new MediaMetadata({
              title: currentAudio.title || "IELTS Listening Audio",
              artist: "IELTS OS",
              album: "Listening Test"
          });
          navigator.mediaSession.setActionHandler("play", () => {
              if (isListeningReviewAudio()) void requestReviewAudioPlayback();
              else void requestExamAudioPlayback();
          });
          navigator.mediaSession.setActionHandler("pause", () => {
              const audio = audioRef.current;
              if (audio && examAudioShouldPlayRef.current) recoverInterruptedExamAudio(audio);
          });
          navigator.mediaSession.setActionHandler("seekbackward", (details: MediaSessionActionDetails) => {
              if (!isListeningReviewAudio() && (activeExam as any)?.audioMode !== "practice") return;
              const audio = audioRef.current;
              if (!audio) return;
              audio.currentTime = Math.max(0, audio.currentTime - (details.seekOffset || 10));
              if (isListeningReviewAudio()) setRvAudioCur(audio.currentTime || 0);
              else setAudioCur(audio.currentTime || 0);
              updateExamMediaSessionPosition(audio);
          });
          navigator.mediaSession.setActionHandler("seekforward", (details: MediaSessionActionDetails) => {
              if (!isListeningReviewAudio() && (activeExam as any)?.audioMode !== "practice") return;
              const audio = audioRef.current;
              if (!audio) return;
              audio.currentTime = Math.min(audio.duration || Number.MAX_SAFE_INTEGER, audio.currentTime + (details.seekOffset || 10));
              if (isListeningReviewAudio()) setRvAudioCur(audio.currentTime || 0);
              else setAudioCur(audio.currentTime || 0);
              updateExamMediaSessionPosition(audio);
          });
      } catch { }
      return () => {
          try {
              navigator.mediaSession.setActionHandler("play", null);
              navigator.mediaSession.setActionHandler("pause", null);
              navigator.mediaSession.setActionHandler("seekbackward", null);
              navigator.mediaSession.setActionHandler("seekforward", null);
              navigator.mediaSession.playbackState = "none";
          } catch { }
      };
  }, [activeExam?.id, activeExam?.audioUrl, (activeExam as any)?.audioMode, reviewQuiz?.quiz?.id, reviewQuiz?.quiz?.audioUrl, audioRate, playbackRate]);

  useEffect(() => {
      if (!hasListeningAudio()) return;
      const watchdog = window.setInterval(() => {
          const audio = audioRef.current;
          if (audio && examAudioShouldPlayRef.current && audio.paused && !audio.ended) recoverInterruptedExamAudio(audio);
      }, 500);
      return () => window.clearInterval(watchdog);
  }, [activeExam?.id, (activeExam as any)?.audioMode, reviewQuiz?.quiz?.id, audioRate, playbackRate, meetAudioIssue]);

  useEffect(() => {
      if (!activeExam) {
          examAudioShouldPlayRef.current = false;
          clearExamAudioResumeTimer();
          if (audioRef.current) {
              audioRef.current.pause();
              audioRef.current.currentTime = 0;
          }
          setAudioStatus("IDLE");
          _setAudioTested(false);
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
        const res = await fetch(`${getApiBase()}/api/health`);
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
    // CHỐNG "GIẬT" KHI XÓA: đánh dấu đang có ghi của chính mình. onSnapshot sẽ KHÔNG đè state
    // local trong lúc transaction đang bay (snapshot CŨ còn trong đường truyền sẽ làm data xóa hiện lại).
    const quizDeleteIds = Array.isArray(newData.__quizDeletedIds) ? newData.__quizDeletedIds.map(String) : [];
    const pendingVocab = newData.__vocabPending && Array.isArray(newData.__vocabPending.notebook)
      ? newData.__vocabPending : null;
    if (Array.isArray(newData.quizzes) && userRole === "TEACHER") {
      writePendingQuizWrite(newData.quizzes, quizDeleteIds);
    }
    if (pendingVocab && userRole === "STUDENT") {
      writePendingVocabWrite(pendingVocab.notebook, pendingVocab.tombstones || []);
    }
    writeInFlightRef.current++;
    try {
      await runTransaction(db, async (transaction) => {
        const sfDoc = await transaction.get(DB_DOC_REF);
        if (!sfDoc.exists()) {
          const initialData = { ...newData };
          delete initialData.__quizDeletedIds;
          delete initialData.__vocabPending;
          if (Array.isArray(initialData.quizzes) && quizDeleteIds.length) {
            initialData.quizzes = mergeQuizCatalog([], initialData.quizzes, quizDeleteIds);
            initialData.quizTombstones = quizDeleteIds.slice(-1000);
          }
          transaction.set(DB_DOC_REF, JSON.parse(JSON.stringify(initialData)));
          return;
        }
        
        const serverData = sfDoc.data() || {};
        const finalUpdate: any = {};

        Object.keys(newData).forEach((key) => {
          if (key === "__quizDeletedIds") return;
          if (key === "__vocabPending") return;
          const localVal = newData[key];
          const serverVal = serverData[key];

          if (!Array.isArray(localVal)) {
            finalUpdate[key] = localVal;
            return;
          }

          const serverArr = Array.isArray(serverVal) ? serverVal : [];

          // SỔ CÁI MÃ THƯỞNG: luôn gộp theo "code" (không ghi đè) để học viên append & giáo viên redeem không xung đột
          if (key === "rewardCodes") {
            const mergedArr = [...serverArr];
            localVal.forEach((localItem: any) => {
              const idx = mergedArr.findIndex((s: any) => s.code === localItem.code);
              if (idx === -1) mergedArr.push(localItem);
              else mergedArr[idx] = { ...mergedArr[idx], ...localItem };
            });
            finalUpdate[key] = mergedArr;
            return;
          }

          // Quiz catalog is a shared collection, not a replaceable blob. Merge by ID so
          // a stale full-list payload cannot delete a quiz created by a newer write.
          // Explicit deletes carry tombstones, preventing a stale tab from restoring them.
          if (key === "quizzes" && userRole === "TEACHER") {
            const tombstones = Array.from(new Set([
              ...(Array.isArray(serverData.quizTombstones) ? serverData.quizTombstones : []),
              ...quizDeleteIds,
            ].map(String))).slice(-1000);
            finalUpdate.quizzes = mergeQuizCatalog(serverArr, localVal, tombstones);
            if (quizDeleteIds.length) finalUpdate.quizTombstones = tombstones;
            return;
          }

          if (userRole === "TEACHER") {
            if (key === "students") {
              finalUpdate[key] = localVal.map((localItem: any) => {
                const serverItem = serverArr.find((s: any) => s.id === localItem.id);
                if (serverItem) {
                  // CHỐNG MẤT QUÀ (GV ghi cũng KHÔNG được làm bay inventory HV): permanents/reviewedQuizzes
                  // là APPEND-ONLY -> union; phần inventory còn lại ƯU TIÊN SERVER (HV là chủ kho đồ của mình),
                  // nên GV ghi bằng snapshot cũ KHÔNG xoá được consumables/equipped/quà của HV.
                  const _tsv = serverItem.inventory || {};
                  const _tlc = localItem.inventory || {};
                  const _tuniq = (a: any, b: any) => Array.from(new Set([
                    ...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])
                  ]));
                  const mergedInv = {
                    ..._tlc, ..._tsv,
                    permanents: _tuniq(_tsv.permanents, _tlc.permanents),
                    reviewedQuizzes: _tuniq(_tsv.reviewedQuizzes, _tlc.reviewedQuizzes),
                    consumables: _tsv.consumables || _tlc.consumables || {},
                  };
                  return {
                    ...serverItem,
                    ...localItem,
                    // CHỐNG MẤT XP/COINS: exp & level chỉ TĂNG (HV học/thi + GV log buổi đều CỘNG) -> lấy MAX,
                    // GV ghi bằng state cũ (thấp hơn) KHÔNG bao giờ kéo tụt XP. Cùng lớp bug với vocab/inventory.
                    exp: Math.max(Number(serverItem.exp) || 0, Number(localItem.exp) || 0),
                    level: Math.max(Number(serverItem.level) || 1, Number(localItem.level) || 1),
                    // Coins: GV ghi generic (sửa tên/rate…) KHÔNG được kéo tụt số xu HV vừa kiếm -> chặn bằng MAX.
                    // (Hệ quả: GV muốn TRỪ xu phải dùng luồng riêng — xem ghi chú SESSION_HANDOFF.)
                    coins: Math.max(Number(serverItem.coins) || 0, Number(localItem.coins) || 0),
                    inventory: mergedInv,
                    // CHỐNG BAY SỔ TỪ VỰNG: HV là chủ sổ — GV ghi (kể cả bằng state cũ) KHÔNG bao giờ được đè vocabNotebook.
                    vocabNotebook: serverItem.vocabNotebook !== undefined ? serverItem.vocabNotebook : (localItem.vocabNotebook || []),
                    vocabTombstones: serverItem.vocabTombstones !== undefined ? serverItem.vocabTombstones : (localItem.vocabTombstones || []),
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
                    // CHỐNG MẤT QUÀ: inventory.permanents & reviewedQuizzes là APPEND-ONLY (chỉ thêm).
                    // Một lần ghi (kể cả ghi bằng state cũ) KHÔNG được làm GIẢM chúng -> hợp (union) server ∪ local.
                    // serverItem ở đây là dữ liệu MỚI NHẤT đọc trong transaction nên union luôn an toàn.
                    const _sv = serverItem.inventory || {};
                    const _lc = myLocalInfo.inventory || {};
                    const _uniq = (a: any, b: any) => Array.from(new Set([
                      ...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])
                    ]));
                    const mergedInventory = {
                      ..._sv, ..._lc,
                      permanents: _uniq(_sv.permanents, _lc.permanents),
                      reviewedQuizzes: _uniq(_sv.reviewedQuizzes, _lc.reviewedQuizzes),
                      consumables: _lc.consumables || _sv.consumables || {},
                    };
                    // CHỐNG BAY SỔ TỪ VỰNG: hợp (union) server ∪ local theo id — ghi bằng state cũ KHÔNG làm mất từ.
                    // Xóa chủ động dùng "bia mộ" (vocabTombstones, append-only) để không bị hồi sinh sau merge.
                    const mergedVocab = mergeVocabNotebook(
                      serverItem.vocabNotebook, myLocalInfo.vocabNotebook,
                      serverItem.vocabTombstones, myLocalInfo.vocabTombstones
                    );
                    return {
                      ...serverItem,
                      ...myLocalInfo,
                      // exp/level chỉ tăng -> MAX chống mất XP kể cả khi state HV bị cũ (đa thiết bị / suppress window).
                      exp: Math.max(Number(serverItem.exp) || 0, Number(myLocalInfo.exp) || 0),
                      level: Math.max(Number(serverItem.level) || 1, Number(myLocalInfo.level) || 1),
                      vocabNotebook: mergedVocab.notebook,
                      vocabTombstones: mergedVocab.tombstones,
                      inventory: mergedInventory,
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

        // Vocab đã chuyển sang collection riêng. Khi collection đã có dữ liệu xác nhận,
        // bỏ bản mirror cũ khỏi document tổng để nó không thể phình quá giới hạn hoặc bị ghi đè.
        const ownEmail = String(currentUser?.email || "").trim().toLowerCase();
        if (userRole === "STUDENT" && ownEmail && vocabStoreReadyRef.current[ownEmail]
            && Array.isArray(finalUpdate.students)) {
          finalUpdate.students = finalUpdate.students.map((student: any) => {
            if (String(student?.email || "").trim().toLowerCase() !== ownEmail) return student;
            const cleanStudent = { ...student };
            delete cleanStudent.vocabNotebook;
            delete cleanStudent.vocabTombstones;
            return cleanStudent;
          });
        }
        const cleanUpdate = JSON.parse(JSON.stringify(finalUpdate));
        transaction.update(DB_DOC_REF, cleanUpdate);
      });
      if (Array.isArray(newData.quizzes) && userRole === "TEACHER") clearPendingQuizWrite();
      // Không xóa retry record tại đây. onSnapshot chỉ xóa sau khi chính snapshot server
      // đã chứa đủ thẻ/tombstone, tránh snapshot cache cũ đè mất thẻ sau khoảng 1 giây.
      return true;
    } catch (error: any) {
      console.error("Critical Sync Blocked:", error);
      if (typeof logErrorToSystem === "function") {
        logErrorToSystem("CRITICAL_SYNC_FAIL", error.message || String(error), { user: currentUser?.email });
      }
      return false;
    } finally {
      // Hết ghi: giữ thêm 1 khoảng ngắn để hứng nốt snapshot CŨ còn sót trên đường truyền,
      // tránh data vừa xóa nhấp nháy hiện lại. State local lúc này đã là nguồn đúng.
      writeInFlightRef.current = Math.max(0, writeInFlightRef.current - 1);
      if (writeInFlightRef.current === 0) {
        suppressSnapshotUntilRef.current = Date.now() + 800;
      }
    }
  };
  const syncLiveArena = async (sessions: LiveSession[]) => { try { await setDoc(LIVE_DOC_REF, { sessions }, { merge: true }); } catch (error) {} };

  // GIÁO VIÊN: tra cứu mã thưởng trong sổ cái (chống photoshop — mã giả sẽ không tồn tại)
  const handleVerifyCode = () => {
    const code = (verifyCodeInput || "").trim().toUpperCase();
    if (!code) { setVerifyResult(null); return; }
    const entry = rewardCodes.find(r => (r.code || "").toUpperCase() === code);
    if (!entry) { setVerifyResult({ status: "FAKE" }); return; }
    setVerifyResult({ status: entry.redeemed ? "USED" : "VALID", entry });
  };
  // GIÁO VIÊN: xác nhận trả thưởng  đánh dấu đã dùng (một lần duy nhất)
  const handleRedeemCode = () => {
    if (!verifyResult?.entry || verifyResult.status !== "VALID") return;
    const e = verifyResult.entry;
    const updated: RewardCode = { ...e, redeemed: true, redeemedAt: Date.now(), redeemedBy: (currentUser?.email || "TEACHER") };
    const nx = rewardCodes.map(r => r.code === e.code ? updated : r);
    setRewardCodes(nx); syncData({ rewardCodes: nx });
    setVerifyResult({ status: "USED", entry: updated });
  };
  const handleLogin = async (e: any) => {
    e.preventDefault(); setLoginError("");
    try { await signInWithEmailAndPassword(auth, email, password); } 
    catch (error) { setLoginError("Wrong email or password!"); }
  };
  const handleLogout = () => {
    sessionConfirmedRef.current = false;   // quên quyền sở hữu phiên -> lần đăng nhập sau sẽ claim lại sạch
    myClaimAtRef.current = 0;
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

  // PHÂN TÍCH LỖI THEO DẠNG CÂU HỎI (toàn trung tâm + theo học viên)
  const errorAnalytics = useMemo(() => {
    const typeLabel = (q: QuizQuestion) => q.subType || (q.type === 'CHOICE' ? 'Multiple Choice' : q.type === 'MATCHING' ? 'Matching' : q.type === 'CHOICE_MULTIPLE' ? 'Multi-select' : 'Completion');
    const isOk = (q: QuizQuestion, sAns: any) => {
      if (q.type === 'CHOICE' || q.type === 'MATCHING') return sAns === q.correctAnswer;
      if (q.type === 'CHOICE_MULTIPLE') { const arr = Array.isArray(q.correctAnswer) ? q.correctAnswer : [q.correctAnswer]; return sAns !== undefined && sAns !== "" && arr.includes(Number(sAns)); }
      return String(q.correctAnswer).split('/').map(s => s.trim().toLowerCase()).includes(String(sAns ?? "").trim().toLowerCase());
    };
    const typeStats: Record<string, { correct: number; total: number }> = {};
    const studentStats: Record<string, { name: string; types: Record<string, { correct: number; total: number }> }> = {};
    (quizResults || []).forEach(r => {
      if (!r || !r.answers) return;
      const quiz = (quizzes || []).find(q => q && q.id === r.quizId);
      if (!quiz || !Array.isArray(quiz.questions)) return;
      quiz.questions.forEach(q => {
        if (!q) return;
        const label = typeLabel(q);
        const ok = isOk(q, r.answers[q.id]);
        if (!typeStats[label]) typeStats[label] = { correct: 0, total: 0 };
        typeStats[label].total++; if (ok) typeStats[label].correct++;
        if (!studentStats[r.studentId]) studentStats[r.studentId] = { name: r.studentName, types: {} };
        const stt = studentStats[r.studentId].types;
        if (!stt[label]) stt[label] = { correct: 0, total: 0 };
        stt[label].total++; if (ok) stt[label].correct++;
      });
    });
    const centerTypes = Object.entries(typeStats)
      .map(([label, v]) => ({ label, correct: v.correct, total: v.total, rate: v.total ? Math.round((v.correct / v.total) * 100) : 0 }))
      .sort((a, b) => a.rate - b.rate);
    const weakStudents = Object.values(studentStats).map(s => {
      let worst = { label: "", rate: 101, total: 0 };
      Object.entries(s.types).forEach(([label, v]) => { const rate = v.total ? Math.round((v.correct / v.total) * 100) : 0; if (v.total >= 2 && rate < worst.rate) worst = { label, rate, total: v.total }; });
      return { name: s.name, ...worst };
    }).filter(s => s.label && s.rate < 60).sort((a, b) => a.rate - b.rate).slice(0, 6);
    // Lỗi sai theo TỪNG học viên (cho hồ sơ chi tiết): map studentId -> mảng {label, rate, total} sắp theo rate tăng.
    const studentTypes: Record<string, { label: string; rate: number; total: number }[]> = {};
    Object.entries(studentStats).forEach(([sid, s]) => {
      studentTypes[sid] = Object.entries(s.types)
        .map(([label, v]) => ({ label, total: v.total, rate: v.total ? Math.round((v.correct / v.total) * 100) : 0 }))
        .sort((a, b) => a.rate - b.rate);
    });
    return { centerTypes, weakStudents, studentTypes };
  }, [quizResults, quizzes]);

  // Tiện ích cho biểu đồ band: rút gọn ngày + tạo chuỗi điểm theo thời gian (sắp theo id = mốc thời gian)
  const shortDate = (s: string) => { const m = String(s || "").match(/\d{1,2}\/\d{1,2}(?:\/\d{2,4})?/); return m ? m[0] : ""; };
  const bandSeries = (results: QuizResult[]) => [...(results || [])]
    .sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0))
    .map(r => ({ label: shortDate(r.date), band: Number(r.band) }))
    .filter(d => !isNaN(d.band));

  // NHẬN XÉT BẰNG AI cho 1 kết quả thi
  const handleAiFeedback = async (r: QuizResult) => {
    if (aiLoadingId) return;
    setAiLoadingId(r.id);
    try {
      const quiz = (quizzes || []).find(q => q && q.id === r.quizId);
      let weak = "N/A";
      let details = "";
      let wrongCount = 0;
      if (quiz && Array.isArray(quiz.questions)) {
        const isOk = (q: QuizQuestion, sAns: any) => {
          if (q.type === 'CHOICE' || q.type === 'MATCHING') return sAns === q.correctAnswer;
          if (q.type === 'CHOICE_MULTIPLE') { const arr = Array.isArray(q.correctAnswer) ? q.correctAnswer : [q.correctAnswer]; return sAns !== undefined && sAns !== "" && arr.includes(Number(sAns)); }
          return String(q.correctAnswer).split('/').map(s => s.trim().toLowerCase()).includes(String(sAns ?? "").trim().toLowerCase());
        };
        const stripTags = (s: any) => String(s ?? "").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
        const g: Record<string, { c: number; t: number }> = {};
        const wrongLines: string[] = [];
        quiz.questions.forEach((q, i) => {
          const label = q.subType || q.type;
          const sAns = r.answers?.[q.id];
          if (!g[label]) g[label] = { c: 0, t: 0 };
          g[label].t++;
          if (isOk(q, sAns)) { g[label].c++; return; }
          wrongCount++;
          let stu = "", cor = "";
          if (q.type === 'CHOICE' || q.type === 'MATCHING') {
            stu = (sAns === undefined || sAns === "") ? "(trống)" : stripTags(q.options?.[Number(sAns)] ?? sAns);
            cor = stripTags(q.options?.[Number(q.correctAnswer)] ?? q.correctAnswer);
          } else if (q.type === 'CHOICE_MULTIPLE') {
            const arr = Array.isArray(q.correctAnswer) ? q.correctAnswer : [q.correctAnswer];
            stu = (sAns === undefined || sAns === "") ? "(trống)" : stripTags(q.options?.[Number(sAns)] ?? sAns);
            cor = arr.map((idx: any) => stripTags(q.options?.[Number(idx)] ?? idx)).join(" / ");
          } else {
            stu = (sAns === undefined || sAns === "") ? "(trống)" : stripTags(sAns);
            cor = stripTags(q.correctAnswer);
          }
          if (wrongLines.length < 30)
            wrongLines.push(`#${i + 1} [${label}] HV: "${stu.slice(0, 70)}" | Đúng: "${cor.slice(0, 70)}"`);
        });
        weak = Object.entries(g).map(([k, v]) => `${k}: ${v.c}/${v.t}`).join(", ");
        details = wrongLines.join("\n");
      }
      const API_BASE = getApiBase();
      const resp = await fetch(`${API_BASE}/api/ai_feedback`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang: i18n.language === "vi" ? "vi" : "en", studentName: r.studentName, quizTitle: r.quizTitle, type: quiz?.type || "", score: r.score, total: r.total, band: r.band, weakness: weak, wrongCount, details })
      });
      const data = await resp.json();
      if (data.success && data.feedback) {
        const nx = quizResults.map(x => x.id === r.id ? { ...x, teacherFeedback: data.feedback } : x);
        setQuizResults(nx); syncData({ quizResults: nx });
      } else {
        alert(t('ai_error') + (data.error ? "\n" + data.error : ""));
      }
    } catch (e: any) {
      alert(t('ai_error') + "\n" + (e?.message || String(e)));
    } finally {
      setAiLoadingId(null);
    }
  };

  // #5: Giải thích từng câu sai bằng AI trong màn Review
  const handleAiExplain = async (q: QuizQuestion, studentAnsRaw: any, quiz: Quiz) => {
    if (explainMap[q.id]?.loading) return;
    setExplainMap(prev => ({ ...prev, [q.id]: { loading: true, text: "" } }));
    try {
      const stripTags = (s: any) => String(s ?? "").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
      const optStr = (q.options || []).map((o, idx) => `${String.fromCharCode(65 + idx)}. ${stripTags(o)}`).join(" | ");
      let correctStr = "", stuStr = "";
      const blank = studentAnsRaw === undefined || studentAnsRaw === "" || studentAnsRaw === null;
      if (q.type === 'CHOICE' || q.type === 'MATCHING') {
        correctStr = stripTags(q.options?.[Number(q.correctAnswer)] ?? q.correctAnswer);
        stuStr = blank ? "(trống)" : stripTags(q.options?.[Number(studentAnsRaw)] ?? studentAnsRaw);
      } else if (q.type === 'CHOICE_MULTIPLE') {
        const arr = Array.isArray(q.correctAnswer) ? q.correctAnswer : [q.correctAnswer];
        correctStr = arr.map((idx: any) => stripTags(q.options?.[Number(idx)] ?? idx)).join(" / ");
        stuStr = blank ? "(trống)" : stripTags(q.options?.[Number(studentAnsRaw)] ?? studentAnsRaw);
      } else {
        correctStr = stripTags(q.correctAnswer);
        stuStr = blank ? "(trống)" : stripTags(studentAnsRaw);
      }
      const fullQuiz = (quizzes || []).find(x => x && x.id === quiz?.id) || quiz;
      // FIX: câu thuộc Passage 2/3 phải lấy đúng bài đọc của section đó, KHÔNG dùng fullQuiz.passage
      // (backend chỉ gán passage = sections[0] = Passage 1 -> AI nhận nhầm văn bản, báo "không tìm thấy").
      let qPassage: string = fullQuiz?.passage || "";
      let qSectionIndex = (typeof (q as any).passageIndex === 'number') ? (q as any).passageIndex : -1;
      const secs = (fullQuiz as any)?.sections;
      if (Array.isArray(secs) && secs.length) {
        if (qSectionIndex < 0 || qSectionIndex >= secs.length) qSectionIndex = secs.findIndex((sec: any) => (sec?.questions || []).some((qq: any) => qq && qq.id === q.id));
        if (qSectionIndex >= 0 && secs[qSectionIndex]) qPassage = secs[qSectionIndex].passage || qPassage;
      }
      const quizTypeLower = String(fullQuiz?.type || quiz?.type || "").toLowerCase();
      const isListeningQuestion = quizTypeLower.includes("listen") || (quizTypeLower.includes("integrated") && qSectionIndex === 0);
      // Listening transcript first so its answer-bearing timestamp markers survive the API context limit.
      const ctxParts = isListeningQuestion
        ? [stripTags(fullQuiz?.transcript), stripTags(q.groupContext), stripTags(qPassage)].filter(Boolean)
        : [stripTags(q.groupContext), stripTags(qPassage), stripTags(fullQuiz?.transcript)].filter(Boolean);
      const context = ctxParts.join("\n").trim().slice(0, 24000);
      const API_BASE = getApiBase();
      const resp = await fetch(`${API_BASE}/api/ai_explain`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lang: i18n.language === "vi" ? "vi" : "en",
          question: stripTags(q.text),
          options: optStr,
          correct: correctStr,
          studentAnswer: stuStr,
          context,
          isListening: isListeningQuestion,
          questionType: q.type,
          questionSubType: q.subType || "",
          integratedPart: quizTypeLower.includes("integrated") && qSectionIndex >= 0 ? qSectionIndex + 1 : 0,
          isVietnameseHighSchoolIntegrated: quizTypeLower.includes("integrated") && qSectionIndex >= 1 && qSectionIndex <= 6,
        })
      });
      const data = await resp.json();
      if (data.success && data.explanation) setExplainMap(prev => ({ ...prev, [q.id]: { loading: false, text: data.explanation } }));
      else setExplainMap(prev => ({ ...prev, [q.id]: { loading: false, text: "" + (data.error || "Lỗi") } }));
    } catch (e: any) {
      setExplainMap(prev => ({ ...prev, [q.id]: { loading: false, text: "" + (e?.message || String(e)) } }));
    }
  };

  // Listening: AI nghe audio (1 file lớn) -> upload 1 lần + chép lời theo từng cửa sổ 8 phút rồi ghép -> lưu vào đề
  const makeAudioSafeName = (name: string) => {
    const ext = (name.match(/\.[a-z0-9]+$/i)?.[0] || ".mp3").toLowerCase();
    const base = name.replace(/\.[a-z0-9]+$/i, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "audio";
    return `${base}${ext}`;
  };

  const base64UrlEncode = (value: string) =>
    btoa(unescape(encodeURIComponent(value))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

  const buildHostedAudioUrl = (storagePath: string, token: string, fileName: string) => {
    const host = getApiBase() || window.location.origin;
    const key = base64UrlEncode(`${storagePath}|${token}`);
    return `${host}/api/audio/${key}/${encodeURIComponent(fileName)}`;
  };

  const handleAudioFileUpload = async (file: File) => {
    const quiz = editingQuizRef.current || editingQuiz;
    if (!quiz) return;
    if (!file.type.startsWith("audio/") && !/\.(mp3|m4a|wav|ogg|aac)$/i.test(file.name)) {
      alert("File này không phải audio hợp lệ.");
      return;
    }
    setAudioUploadProgress(0);
    setAudioUploadMsg(t("eb_audio_uploading"));
    try {
      const safeName = makeAudioSafeName(file.name);
      const quizId = String(quiz.id || getTrueTime()).replace(/[^a-zA-Z0-9_-]/g, "");
      const path = `exam-audio/${quizId}/${Date.now()}_${safeName}`;
      const task = uploadBytesResumable(storageRef(storage, path), file, {
        contentType: file.type || "audio/mpeg",
        customMetadata: { originalName: file.name, quizId },
      });
      await new Promise<void>((resolve, reject) => {
        let sawBytes = false;
        const noProgressTimer = window.setTimeout(() => {
          if (!sawBytes) {
            task.cancel();
            reject(new Error("Upload audio bị kẹt ở 0%. Firebase Storage có thể đang bị chặn CORS/permission hoặc chưa bật quyền ghi cho exam-audio/. Hãy dán link audio công khai vào ô Audio Link để dùng tạm."));
          }
        }, 20000);
        task.on("state_changed",
          snap => {
            if (snap.bytesTransferred > 0) {
              sawBytes = true;
              window.clearTimeout(noProgressTimer);
            }
            setAudioUploadProgress(Math.max(1, Math.round((snap.bytesTransferred / snap.totalBytes) * 100)));
          },
          err => {
            window.clearTimeout(noProgressTimer);
            reject(err);
          },
          () => {
            window.clearTimeout(noProgressTimer);
            resolve();
          }
        );
      });
      const rawUrl = await getDownloadURL(task.snapshot.ref);
      const token = new URL(rawUrl).searchParams.get("token") || "";
      const hostedUrl = buildHostedAudioUrl(path, token, safeName);
      setEditingQuiz((prev: any) => prev ? { ...prev, audioUrl: hostedUrl } : prev);
      setAudioUploadMsg(t("eb_audio_ready"));
    } catch (e: any) {
      console.error("Audio upload failed:", e);
      setAudioUploadMsg(t("eb_audio_upload_failed"));
      alert((e?.message || String(e)) + "\n\nNếu lỗi permission, cần bật Firebase Storage và cho teacher được ghi vào exam-audio/.");
    } finally {
      setTimeout(() => setAudioUploadProgress(null), 1600);
    }
  };

  const handleTranscribe = async () => {
    const quiz = editingQuiz;
    if (!quiz || transcribeLoading) return;
    if (!quiz.audioUrl) { alert("Đề này chưa có link audio. Hãy thêm link audio trước khi tạo transcript."); return; }
    if (quiz.transcript && !confirm("Đề đã có transcript. Tạo lại sẽ ghi đè bản cũ. Tiếp tục?")) return;
    const lang = i18n.language === "vi" ? "vi" : "en";
    const API_BASE = getApiBase();
    setTranscribeLoading(true);
    setTranscribeMsg(t('eb_transcribing'));
    try {
      const resp = await fetch(`${API_BASE}/api/ai_transcribe`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang, audioUrl: quiz.audioUrl })
      });
      const data = await resp.json();
      if (data.success && data.transcript) {
        const transcript = data.transcript;
        setEditingQuiz((prev: any) => prev ? { ...prev, transcript } : prev);
        const nx = quizzes.map(q => q.id === quiz.id ? { ...q, transcript } : q);
        setQuizzes(nx); syncData({ quizzes: nx });
        alert(`Đã nghe & tạo transcript (${transcript.length} ký tự) và lưu vào đề. Nút "Vì sao" giờ trích dẫn được lời thoại.`);
      } else {
        alert("" + (data.error || "Lỗi tạo transcript"));
      }
    } catch (e: any) {
      alert("" + (e?.message || String(e)));
    } finally {
      setTranscribeLoading(false);
      setTranscribeMsg("");
    }
  };

  // #3: Sổ tay từ vựng thông minh (AI trích từ đề HV đã làm) + lặp lại ngắt quãng (Leitner)
  const SRS_DAYS = [0, 1, 3, 7, 16, 35]; // theo box 1..5
  const findMe = () => students.find(s => (s.email || "").toLowerCase() === (currentUser?.email || "").toLowerCase());
  const vocabItemKey = (value: any) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
  const saveMyVocabNotebook = (notebook: VocabCard[], tombstones: string[] = []) => {
    const me = findMe();
    if (!me) return;
    const nx = students.map(s => s.id === me.id ? { ...s, vocabNotebook: notebook, vocabTombstones: tombstones } : s);
    setStudents(nx);
    const email = String(currentUser?.email || "").trim().toLowerCase();
    if (!email) return;
    // LocalStorage chỉ là retry buffer cho thao tác chưa được Firestore xác nhận.
    // Nguồn chính là collection ielts_vocab/{student}/cards; Firebase IndexedDB tự xếp hàng offline.
    writePendingVocabWrite(notebook, tombstones);
    void persistVocabCards(email, notebook, tombstones)
      .catch(error => console.error("Dedicated vocab write failed; retry buffer retained:", error));
  };

  const handleGenerateVocab = async () => {
    const me = findMe();
    if (!me || vocabGenLoading) return;
    const stripTags = (s: any) => String(s ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
    const isOk = (q: QuizQuestion, sAns: any) => {
      if (q.type === 'CHOICE' || q.type === 'MATCHING') return sAns === q.correctAnswer;
      if (q.type === 'CHOICE_MULTIPLE') { const arr = Array.isArray(q.correctAnswer) ? q.correctAnswer : [q.correctAnswer]; return sAns !== undefined && sAns !== "" && arr.includes(Number(sAns)); }
      return String(q.correctAnswer).split('/').map(x => x.trim().toLowerCase()).includes(String(sAns ?? "").trim().toLowerCase());
    };
    const myRes = quizResults.filter(r => r.studentId === me.id);
    if (myRes.length === 0) { alert("Bạn chưa làm đề nào để trích từ vựng."); return; }
    setVocabGenLoading(true);
    try {
      let transcripts = "", passages = "", qtext = "", wrongCtx = "";
      const seen = new Set<string>();
      // ĐỌC ÍT NHẤT 5 ĐỀ GẦN NHẤT (distinct), mới nhất trước.
      const RECENT_TESTS = 5;
      const ordered = [...myRes].sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));
      for (const r of ordered) {
        if (seen.size >= RECENT_TESTS) break;
        const quiz = quizzes.find(q => q.id === r.quizId);
        if (!quiz || seen.has(quiz.id)) continue;
        seen.add(quiz.id);
        // Transcript (Listening) GIÀU phrasal verb -> gom riêng để ưu tiên.
        transcripts += " " + stripTags(quiz.transcript);
        // Gộp TẤT CẢ bài đọc (sections[].passage), không chỉ passage 1.
        const secs = Array.isArray((quiz as any).sections) ? (quiz as any).sections : [];
        if (secs.length) secs.forEach((s: any) => { passages += " " + stripTags(s?.passage); });
        else passages += " " + stripTags(quiz.passage);
        (quiz.questions || []).forEach(q => {
          qtext += " " + stripTags(q.text) + " " + stripTags(q.groupContext);
          if (!isOk(q, r.answers?.[q.id])) wrongCtx += " " + stripTags(q.text) + " " + stripTags(q.groupContext);
        });
      }
      // Transcript trước (giàu phrasal verb, không bị cắt mất), rồi bài đọc, rồi câu hỏi.
      let source = (transcripts + " " + passages + " " + qtext).replace(/\s+/g, " ").trim().slice(0, 60000);
      wrongCtx = wrongCtx.replace(/\s+/g, " ").trim().slice(0, 2000);
      const existing = new Set((me.vocabNotebook || []).map(c => vocabItemKey(c.word)).filter(Boolean));
      const requestedCount = Math.max(5, Math.min(40, vocabCount || 15));
      const excludeWords = (me.vocabNotebook || []).map(c => String(c.word || "").trim()).filter(Boolean).slice(0, 800);
      const API_BASE = getApiBase();
      const resp = await fetch(`${API_BASE}/api/ai_vocab`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang: i18n.language === "vi" ? "vi" : "en", count: requestedCount, minCount: requestedCount, target: me.target || "", source, wrongContext: wrongCtx, exclude: excludeWords, kinds: (vocabKinds && vocabKinds.length ? vocabKinds : ["word", "phrasal_verb", "idiom", "collocation", "grammar"]) })
      });
      const data = await resp.json();
      if (!data.success || !Array.isArray(data.items)) { alert("" + (data.error || "Lỗi tạo từ vựng")); return; }
      const now = getTrueTime();
      const returnedKeys = new Set<string>();
      const newCards: VocabCard[] = data.items
        .filter((it: any) => {
          const key = vocabItemKey(it?.word);
          if (!it || !it.word || !key || existing.has(key) || returnedKeys.has(key)) return false;
          returnedKeys.add(key);
          return true;
        })
        .map((it: any, i: number) => ({
          id: `vocab_${now}_${Math.random().toString(36).slice(2, 8)}_${i}`, word: String(it.word), phonetic: it.phonetic || "", pos: it.pos || "",
          meaning: it.meaning_en || it.meaning_vi || it.meaning || "", example: it.example || "", cefr: it.cefr || "",
          category: String(it.category || "word"), evidence: it.source_sentence || it.evidence || "",
          box: 1, due: now, createdAt: now,
        }));
      if (newCards.length === 0) { alert("Không có từ mới (có thể đã có sẵn trong sổ)."); return; }
      const nxNotebook = [...newCards, ...(me.vocabNotebook || [])];
      saveMyVocabNotebook(nxNotebook, me.vocabTombstones || []);
      setVocabView("study"); setStudyFlipped(false);
      const droppedN = Number(data.dropped) || 0;
      alert(`Đã thêm ${newCards.length}/${requestedCount} mục mới vào sổ tay!` + (droppedN > 0 ? `\nAI đã tự loại ${droppedN} mục không khớp nguyên văn trong đề.` : "") + (newCards.length < requestedCount ? "\nNguồn đề hiện không còn đủ mục mới, đã tránh trùng và không bịa thêm." : ""));
    } catch (e: any) {
      alert("" + (e?.message || String(e)));
    } finally {
      setVocabGenLoading(false);
    }
  };

  const reviewVocabCard = (cardId: string, remembered: boolean) => {
    const me = findMe();
    if (!me) return;
    const now = getTrueTime();
    const nxNotebook = (me.vocabNotebook || []).map(c => {
      if (c.id !== cardId) return c;
      const box = remembered ? Math.min(5, (c.box || 1) + 1) : 1;
      const due = remembered ? now + SRS_DAYS[box] * 86400000 : now + 10 * 60000;
      return { ...c, box, due };
    });
    saveMyVocabNotebook(nxNotebook, me.vocabTombstones || []);
  };

  const deleteVocabCard = (cardId: string) => {
    const me = findMe();
    if (!me) return;
    const nxNotebook = (me.vocabNotebook || []).filter(c => c.id !== cardId);
    // Ghi "bia mộ" để merge chống-mất-từ không hồi sinh thẻ đã chủ động xóa
    const nxTomb = Array.from(new Set([...(me.vocabTombstones || []), cardId])).slice(-800);
    saveMyVocabNotebook(nxNotebook, nxTomb);
  };

  const getGamificationBadge = (lvl: number) => { if (lvl >= 10) return "Master"; if (lvl >= 5) return "Elite"; return "Novice"; };
  const getIeltsBand = (score: number, total: number = 40, skill: string = "Reading") => {
    if (!total || total === 0) return "N/A";
    const norm = ((score || 0) / total) * 40;
    const isListening = String(skill || "").toLowerCase().includes("listen");
    if (isListening) {
      // Bang quy doi IELTS Listening (raw / 40)
      if (norm >= 39) return 9.0; if (norm >= 37) return 8.5; if (norm >= 35) return 8.0;
      if (norm >= 32) return 7.5; if (norm >= 30) return 7.0; if (norm >= 26) return 6.5;
      if (norm >= 23) return 6.0; if (norm >= 18) return 5.5; if (norm >= 16) return 5.0;
      if (norm >= 13) return 4.5; if (norm >= 10) return 4.0; if (norm >= 6) return 3.5;
      if (norm >= 4) return 3.0; return "N/A";
    }
    // Bang quy doi IELTS Academic Reading (raw / 40)
    if (norm >= 39) return 9.0; if (norm >= 37) return 8.5; if (norm >= 35) return 8.0;
    if (norm >= 33) return 7.5; if (norm >= 30) return 7.0; if (norm >= 27) return 6.5;
    if (norm >= 23) return 6.0; if (norm >= 19) return 5.5; if (norm >= 15) return 5.0;
    if (norm >= 13) return 4.5; if (norm >= 10) return 4.0; if (norm >= 8) return 3.5;
    if (norm >= 6) return 3.0; if (norm >= 4) return 2.5; return "N/A";
  };
  const copyToClipboard = (text: string) => { if (!text) return; navigator.clipboard.writeText(text); alert("Copied!"); };
  const scrollToTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });

  // ==========================================
  // MAGIC FIX TỐI THƯỢNG: VÙNG XANH FAKE & BẮT CHỮ PRO MAX (V7 ANDROID/SAMSUNG)
  // ==========================================
  useEffect(() => {
      if (!activeExam) return;

      let selTimeout: number;

      const clearTempSelection = () => {
          const temps = document.querySelectorAll('.idp-temp-selection');
          temps.forEach(target => {
              const parent = target.parentNode;
              if (parent) {
                  while (target.firstChild) parent.insertBefore(target.firstChild, target);
                  parent.removeChild(target);
                  parent.normalize();
              }
          });
      };

      const processSelection = () => {
          const sel = window.getSelection();
          if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
          const textStr = sel.toString().trim();
          if (textStr.length === 0) return;

          try {
              // 1. CHOT TOA DO VA COPY RANGE NGAY LAP TUC
              const range = sel.getRangeAt(0).cloneRange();
              let rect = range.getBoundingClientRect();

              // KHAC PHUC LOI HIEM: Android Chrome doi khi tra ve toa do 0x0
              if (rect.width === 0 && rect.height === 0) {
                  const rects = range.getClientRects();
                  if (rects.length > 0) rect = rects[0];
              }

              // 2. DO TIM VUNG LAM BAI HOP LE (BAO VE CHONG QUET RA NGOAI LE)
              let container: HTMLElement | null = null;
              let node: Node | null = range.commonAncestorContainer;
              while (node && node !== document.body) {
                  if (node.nodeType === 1 && (node as HTMLElement).classList.contains('highlightable-content')) {
                      container = node as HTMLElement; break;
                  }
                  node = node.parentNode;
              }

              if (!container) {
                  sel.removeAllRanges(); // Quet bay ra ngoai le -> Xoa vung chon
                  return;
              }

              // 3. CHUAN HOA DIEM DAU / DIEM CUOI (CHONG MAT CHU)
              let startNode = range.startContainer; let startOffset = range.startOffset;
              if (startNode.nodeType === 1) {
                  startNode = startNode.childNodes[Math.min(startOffset, Math.max(0, startNode.childNodes.length - 1))] || startNode;
                  startOffset = 0;
                  while (startNode.nodeType === 1 && startNode.firstChild) startNode = startNode.firstChild;
              }

              let endNode = range.endContainer; let endOffset = range.endOffset;
              if (endNode.nodeType === 1) {
                  endNode = endNode.childNodes[Math.max(0, endOffset - 1)] || endNode;
                  while (endNode.nodeType === 1 && endNode.lastChild) endNode = endNode.lastChild;
                  endOffset = endNode.nodeType === 3 ? (endNode.textContent?.length || 0) : 0;
              }

              // KHÔNG snap tròn từ nữa: highlight/note đúng CHÍNH XÁC đoạn thí sinh quét, không tự ý bao trọn từ.
              clearTempSelection();

              // 4. GOM TOAN BO CHU VAO MANG
              const nodesToWrap: Text[] = [];
              if (startNode === endNode && startNode.nodeType === 3) {
                  nodesToWrap.push(startNode as Text);
              } else {
                  const tw = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT, null);
                  let curr = tw.nextNode();
                  let inRange = false;
                  while (curr) {
                      if (curr === startNode) inRange = true;
                      if (inRange && curr.textContent && curr.textContent.trim().length > 0) nodesToWrap.push(curr as Text);
                      if (curr === endNode) break;
                      curr = tw.nextNode();
                  }

                  if (nodesToWrap.length === 0) {
                      const tw2 = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT, null);
                      let n = tw2.nextNode();
                      while (n) {
                          if (range.intersectsNode(n) && n.textContent && n.textContent.trim().length > 0) nodesToWrap.push(n as Text);
                          n = tw2.nextNode();
                      }
                  }
              }

              // 5. RUT LOI NATIVE SELECTION (BOP CHET MENU EDGE/CHROME/SAMSUNG NGAY LAP TUC)
              sel.removeAllRanges();

              // 6. XU LY DOM DE TAO VUNG XANH FAKE MUOT MA
              if (nodesToWrap.length > 0) {
                  nodesToWrap.forEach(n => {
                      let textNode = n;
                      const isStart = n === startNode;
                      const isEnd = n === endNode;

                      if (isStart && isEnd) {
                          const splitLen = endOffset - startOffset;
                          if (splitLen > 0 && startOffset < textNode.length) {
                              const mid = textNode.splitText(startOffset);
                              if (splitLen < mid.length) mid.splitText(splitLen);
                              textNode = mid;
                          }
                      } else if (isStart) {
                          if (startOffset < textNode.length) textNode = textNode.splitText(startOffset);
                      } else if (isEnd) {
                          if (endOffset > 0 && endOffset < textNode.length) textNode.splitText(endOffset);
                      }

                      const parent = textNode.parentNode as HTMLElement;
                      if (parent && !parent.classList?.contains('student-highlight') && !parent.classList?.contains('student-note-hl') && !parent.classList?.contains('idp-temp-selection')) {
                          const span = document.createElement("span");
                          span.className = 'idp-temp-selection';
                          parent.insertBefore(span, textNode);
                          span.appendChild(textNode);
                      }
                  });

                  // 7. HIEN THI POPUP O VI TRI CHINH GIUA AN TOAN
                  setSelectionMenu({ x: rect.left + rect.width / 2, y: rect.top - 10, container, range: null as any });
              }

          } catch (e) {
              console.error("V7 Engine Error:", e);
              const fallbackSel = window.getSelection();
              if (fallbackSel) fallbackSel.removeAllRanges();
          }
      };

      const handlePointerDown = (e: Event) => {
          // Ghi toạ độ nhấn xuống -> click handler của MCQ so khoảng cách để phân biệt BẤM (chọn đáp án) vs QUÉT (highlight).
          const pt: any = (e as TouchEvent).touches?.[0] || e;
          if (pt && typeof pt.clientX === 'number') (window as any).__examPtrDown = { x: pt.clientX, y: pt.clientY };
      };

      const handlePointerUp = (e: Event) => {
          if ((e.target as HTMLElement).closest('.idp-popup-menu') || (e.target as HTMLElement).closest('.idp-note-input-modal')) return;

          // Chay dong bo ngay lap tuc khi tha tay/chuot. Rieng Touch/Android can delay nhe 50ms de OS nha Selection
          if (e.type === 'mouseup') {
              processSelection();
          } else {
              setTimeout(() => processSelection(), 50);
          }
      };

      // BAY SU KIEN DOC QUYEN CHO ANDROID (CHONG KET)
      const handleTouchCancelOrContext = () => {
          setTimeout(() => processSelection(), 50);
      };

      const onSelectionChange = () => {
          clearTimeout(selTimeout);
          selTimeout = window.setTimeout(() => {
              // BAY KET CUOI CUNG: Neu qua 600ms khong co bien dong chu, ep he thong chay
              processSelection();
          }, 600);
      };

      const hideMenuOnClick = (e: MouseEvent | TouchEvent) => {
          const target = e.target as HTMLElement;
          if (!target.closest('.idp-popup-menu') && !target.closest('.idp-note-input-modal') && !target.classList.contains('student-note-hl')) {
              setSelectionMenu(null);
              setNoteInputMenu(null);
              clearTempSelection();
          }
      };

      document.addEventListener('selectionchange', onSelectionChange);

      document.addEventListener('mousedown', handlePointerDown);
      document.addEventListener('touchstart', handlePointerDown, { passive: true });

      document.addEventListener('mouseup', handlePointerUp);
      document.addEventListener('touchend', handlePointerUp);

      // BO 3 BAY SU KIEN CHUYEN TRI ANDROID/SAMSUNG TABLET
      document.addEventListener('touchcancel', handleTouchCancelOrContext);
      document.addEventListener('contextmenu', handleTouchCancelOrContext);
      document.addEventListener('visibilitychange', handleTouchCancelOrContext);

      document.addEventListener('mousedown', hideMenuOnClick);
      document.addEventListener('touchstart', hideMenuOnClick, { passive: true });

      const handleSyncRequest = (e: Event) => {
          const container = e.target as HTMLElement;
          const field = container.getAttribute('data-field');
          const qId = container.getAttribute('data-qid');
          const optIndex = container.getAttribute('data-optindex');
          if (field) {
              const cleanHTML = serializeHighlightHTML(container);
              setActiveExam(prev => syncHighlightState(prev, field, qId || "", cleanHTML, optIndex));
          }
      };
      document.addEventListener('highlight-removed', handleSyncRequest);

      return () => {
          clearTimeout(selTimeout);
          document.removeEventListener('selectionchange', onSelectionChange);
          document.removeEventListener('mousedown', handlePointerDown);
          document.removeEventListener('touchstart', handlePointerDown);
          document.removeEventListener('mouseup', handlePointerUp);
          document.removeEventListener('touchend', handlePointerUp);
          document.removeEventListener('touchcancel', handleTouchCancelOrContext);
          document.removeEventListener('contextmenu', handleTouchCancelOrContext);
          document.removeEventListener('visibilitychange', handleTouchCancelOrContext);
          document.removeEventListener('mousedown', hideMenuOnClick);
          document.removeEventListener('touchstart', hideMenuOnClick);
          document.removeEventListener('highlight-removed', handleSyncRequest);
          clearTempSelection();
      };
  }, [activeExam]);

  // =========================================================
  // CHAN CHROME "TOUCH TO SEARCH" (thanh dich truot len tu day khi CHAM 1 tu).
  // Nuot cu CHAM NHANH tren vung bai doc -> Chrome khong kich hoat thanh dich.
  // GIU-roi-KEO (highlight) la gesture khac nen KHONG bi anh huong.
  // =========================================================
  useEffect(() => {
      if (!activeExam) return;
      let tapTime = 0; let tapX = 0; let tapY = 0; let tapValid = false;
      const onTS = (e: TouchEvent) => {
          const t = e.target as HTMLElement;
          const okZone = !!(t && t.closest && t.closest('.highlightable-content'));
          const isInteractive = !!(t && t.closest && t.closest('input, textarea, button, a, .inline-blank-input, .student-highlight, .student-note-hl'));
          tapValid = okZone && !isInteractive;
          if (!tapValid) return;
          const tch = e.touches[0]; if (!tch) { tapValid = false; return; }
          tapTime = Date.now(); tapX = tch.clientX; tapY = tch.clientY;
      };
      const onTE = (e: TouchEvent) => {
          if (!tapValid) return;
          tapValid = false;
          const tch = e.changedTouches[0]; if (!tch) return;
          const dt = Date.now() - tapTime;
          const dist = Math.hypot(tch.clientX - tapX, tch.clientY - tapY);
          // CHAM NHANH (khong phai long-press, khong phai keo chon) -> nuot de chan Touch to Search.
          // Chi nuot khi KHONG co vung chon (de khong dung thao tac highlight).
          if (dt < 280 && dist < 12) {
              const sel = window.getSelection();
              if (!sel || sel.isCollapsed) { e.preventDefault(); }
          }
      };
      document.addEventListener('touchstart', onTS, { passive: true });
      document.addEventListener('touchend', onTE, { passive: false });
      return () => {
          document.removeEventListener('touchstart', onTS);
          document.removeEventListener('touchend', onTE);
      };
  }, [activeExam]);

  const executeHighlightOrNote = (type: 'HIGHLIGHT' | 'NOTE', noteText?: string) => {
      if (noteInputMenu?.existingNode) {
          const node = noteInputMenu.existingNode;
          const container = noteInputMenu.container;
          if (noteText === undefined || noteText === null) {
              const parent = node.parentNode;
              if (parent) { while (node.firstChild) parent.insertBefore(node.firstChild, node); parent.removeChild(node); parent.normalize(); }
          } else { node.setAttribute('data-note', noteText); }
          
          if (container) {
              const field = container.getAttribute('data-field'); const qId = container.getAttribute('data-qid'); const optIndex = container.getAttribute('data-optindex');
              if (field) {
                  const cleanHTML = serializeHighlightHTML(container);
                  setActiveExam(prev => syncHighlightState(prev, field, qId || "", cleanHTML, optIndex));
              }
          }
          setNoteInputMenu(null); return;
      }

      const targetMenu = selectionMenu || noteInputMenu;
      if (!targetMenu) return;
      const { container } = targetMenu;

      const temps = container.querySelectorAll('.idp-temp-selection');
      if (temps.length > 0) {
          temps.forEach(target => {
              target.className = type === 'HIGHLIGHT' ? "student-highlight" : "student-note-hl";
              if (type === 'NOTE' && noteText) {
                  target.setAttribute('data-note', noteText);
              }
          });

          const field = container.getAttribute('data-field'); const qId = container.getAttribute('data-qid'); const optIndex = container.getAttribute('data-optindex');
          if (field && activeExam) {
              const cleanHTML = serializeHighlightHTML(container);
              setActiveExam(prev => syncHighlightState(prev, field, qId || "", cleanHTML, optIndex));
          }
      }

      setSelectionMenu(null); setNoteInputMenu(null);
  };

  const applyCustomAction = (type: 'HIGHLIGHT' | 'NOTE') => {
      if (!selectionMenu) return;
      if (type === 'HIGHLIGHT') executeHighlightOrNote('HIGHLIGHT');
      else {
          // Chuẩn Inspera: tạo note NGAY (text rỗng) rồi mở panel Notes bên phải để nhập.
          executeHighlightOrNote('NOTE', '');
          setShowNotesPanel(true);
          setNotesTick(t => t + 1);
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
      if (!url) return null;
      if (url.includes('.pdf')) return <Ico name="file" size={14} style={{verticalAlign:'-2px'}} />;
      if (url.includes('.doc')) return <Ico name="file" size={14} style={{verticalAlign:'-2px'}} />;
      if (url.includes('.mp3') || url.includes('.m4a')) return <Ico name="music" size={14} style={{verticalAlign:'-2px'}} />;
      return <Ico name="link" size={14} style={{verticalAlign:'-2px'}} />;
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
      alert(`Excellent! Student ${st.name} leveled up to Level ${newLevel}!`); 
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
    const nx = [{ id: getTrueTime().toString(), date: viewDate, time: schedForm.time, location: schedForm.location, teacher: myTeacherName, studentId: schedForm.studentId, studentName: st.name, subject: "IELTS Core", duration: Number(schedForm.duration) || 90, status: "PENDING" as const, billed: false }, ...schedules];
    setSchedules(nx); syncData({ schedules: nx }); setShowSchedForm(false);
  };

  // Điểm danh: có mặt -> tự tạo buổi học (history) + tính phí; vắng -> đánh dấu, không tính phí
  const markAttendance = (sched: Schedule, present: boolean) => {
    if (!present) {
      const nx = schedules.map(x => x.id === sched.id ? { ...x, status: "ABSENT" as const, billed: false } : x);
      setSchedules(nx); syncData({ schedules: nx });
      return;
    }
    if (sched.billed) { alert("Buổi học này đã được tính phí rồi!"); return; }
    const st = students.find(s => s.id === sched.studentId);
    if (!st) { alert("Không tìm thấy học viên!"); return; }
    const mins = Number(sched.duration) || 90;
    const secs = mins * 60;
    const earnings = calcEarn(secs, st.rate);
    if (!confirm(t('att_confirm', { name: st.name, money: fmtMoney(earnings) }))) return;

    const session: Session = {
      id: getTrueTime().toString(), studentId: st.id, studentName: st.name, teacher: sched.teacher || myTeacherName,
      skills: ["Mock Test"], date: new Date().toLocaleString("vi-VN"), duration: secs, rate: st.rate,
      earnings, notes: `Buổi học theo lịch ${sched.date} ${sched.time}`,
      rubric: { vocab: "", grammar: "", fluency: "", task: "" }, isPaid: false
    };
    const newExp = (st.exp || 0) + Math.round(secs / 60);
    const newLevel = Math.floor(newExp / 500) + 1;
    const earnedCoins = secs >= 7200 ? 60 : (secs >= 3600 ? 25 : (secs >= 1800 ? 10 : 0));
    const nxStudents = students.map(s => s.id === st.id ? { ...s, exp: newExp, level: newLevel, coins: (s.coins || 0) + earnedCoins, debtMessage: s.debtMessage || "" } : s);
    const nxHistory = [session, ...history];
    const nxSched = schedules.map(x => x.id === sched.id ? { ...x, status: "DONE" as const, billed: true } : x);
    setStudents(nxStudents); setHistory(nxHistory); setSchedules(nxSched);
    syncData({ students: nxStudents, history: nxHistory, schedules: nxSched });
    alert(t('att_billed'));
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

  // Xuất Excel (.xlsx) định dạng đẹp: tiêu đề, header xanh đậm, zebra, freeze, auto-filter.
  const downloadXLSX = async (filename: string, sheetName: string, columns: { header: string; width: number }[], rows: (string | number)[][], title?: string) => {
      const mod: any = await import('exceljs');
      const ExcelJS: any = mod.default || mod;
      const wb = new ExcelJS.Workbook();
      wb.creator = 'IELTS OS';
      const ws = wb.addWorksheet(sheetName);
      columns.forEach((cc, idx) => { ws.getColumn(idx + 1).width = cc.width; });
      let hr = 1;
      if (title) {
          ws.mergeCells(1, 1, 1, columns.length);
          const tc = ws.getCell(1, 1);
          tc.value = title;
          tc.font = { bold: true, size: 16, color: { argb: 'FF1E3A8A' } };
          tc.alignment = { horizontal: 'center', vertical: 'middle' };
          ws.getRow(1).height = 28;
          hr = 2;
      }
      const headerRow = ws.getRow(hr);
      columns.forEach((cc, idx) => {
          const cell = headerRow.getCell(idx + 1);
          cell.value = cc.header;
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
          cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
          cell.border = { bottom: { style: 'thin', color: { argb: 'FF3B82F6' } } };
      });
      headerRow.height = 24;
      rows.forEach((arr, ri) => {
          const row = ws.getRow(hr + 1 + ri);
          arr.forEach((v, ci) => {
              const cell = row.getCell(ci + 1);
              cell.value = v as any;
              cell.alignment = { vertical: 'middle', wrapText: true, horizontal: typeof v === 'number' ? 'center' : 'left' };
              cell.border = { bottom: { style: 'hair', color: { argb: 'FFE5E7EB' } } };
              if (ri % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
          });
      });
      ws.views = [{ state: 'frozen', ySplit: hr }];
      ws.autoFilter = { from: { row: hr, column: 1 }, to: { row: hr, column: columns.length } };
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = filename; link.click();
  };

  const exportCSV = () => {
      const cols = [{header:'Ngày', width:14},{header:'Học viên', width:22},{header:'Giáo viên', width:18},{header:'Kỹ năng', width:24},{header:'Thời lượng (phút)', width:16},{header:'Học phí', width:14},{header:'Trạng thái', width:12}];
      const rows: (string|number)[][] = history.map(h => [h.date, h.studentName, h.teacher, (h.skills||[]).join(' - '), Math.round((h.duration||0)/60), h.earnings||0, h.isPaid ? 'Đã thu' : 'Chưa thu']);
      downloadXLSX('IELTS_BAO_CAO_BUOI_HOC.xlsx', 'Báo cáo', cols, rows, 'BÁO CÁO BUỔI HỌC');
  };

  const exportStudentsCSV = () => {
      const cols = [{header:'Họ tên', width:24},{header:'Email', width:26},{header:'Trình độ', width:10},{header:'Mục tiêu', width:10},{header:'Học phí/giờ', width:14},{header:'Còn nợ', width:14}];
      const rows: (string|number)[][] = students.map(s => {
          const sDebt = history.filter(h => h.studentId === s.id && !h.isPaid).reduce((sum, h) => sum + (h.earnings||0), 0);
          return [s.name, s.email||'', s.cefr, s.target, s.rate, sDebt];
      });
      downloadXLSX('IELTS_DANH_SACH_HOC_VIEN.xlsx', 'Học viên', cols, rows, 'DANH SÁCH HỌC VIÊN');
  };

  const exportQuizResultsCSV = () => {
      const cols = [{header:'Ngày', width:14},{header:'Học viên', width:22},{header:'Đề thi', width:26},{header:'Điểm', width:10},{header:'Band', width:8},{header:'Gian lận', width:9},{header:'Thời gian (s)', width:12},{header:'IP', width:14},{header:'Thiết bị', width:20},{header:'Nhận xét GV', width:30}];
      const rows: (string|number)[][] = quizResults.map(r => [r.date, r.studentName, r.quizTitle, `${r.score}/${r.total}`, r.band, r.cheatCount, r.durationSeconds||0, r.ipAddress||'', r.deviceInfo||'', r.teacherFeedback||'']);
      downloadXLSX('IELTS_KET_QUA_THI.xlsx', 'Kết quả', cols, rows, 'KẾT QUẢ THI CBT');
  };

  const exportDetailedQuizResult = (r: QuizResult) => {
      const qz = quizzes.find(x => x.id === r.quizId);
      if (!qz) { alert('Không tìm thấy dữ liệu đề gốc!'); return; }
      const strip = (t: any) => String(t).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const rows: (string|number)[][] = qz.questions.map((q, i) => {
          const options = q.options || [];
          let correctDisplay: any = q.correctAnswer;
          let studentDisplay: any = (r.answers && r.answers[q.id] !== undefined) ? r.answers[q.id] : '';
          let isCorrect = 'Sai';
          if (q.type === 'CHOICE' || q.type === 'MATCHING') {
              correctDisplay = options[q.correctAnswer as number] || q.correctAnswer;
              studentDisplay = (r.answers && r.answers[q.id] !== undefined) ? (options[r.answers[q.id] as number] || '') : '';
              if (r.answers && r.answers[q.id] === q.correctAnswer) isCorrect = 'Đúng';
          } else {
              const sAns = String(studentDisplay).trim().toLowerCase();
              const correctStrs = String(q.correctAnswer).split('/').map((s: string) => s.trim().toLowerCase());
              if (correctStrs.includes(sAns)) isCorrect = 'Đúng';
          }
          return [i+1, strip(q.text), strip(correctDisplay), strip(studentDisplay), isCorrect];
      });
      const cols = [{header:'Câu', width:6},{header:'Nội dung câu hỏi', width:50},{header:'Đáp án đúng', width:22},{header:'Học viên trả lời', width:22},{header:'Kết quả', width:10}];
      downloadXLSX(`CHITIET_${r.studentName}_${r.quizTitle}.xlsx`, 'Chi tiết', cols, rows, `${r.studentName} — ${r.quizTitle} (${r.score}/${r.total}, Band ${r.band})`);
  };

  // Xuất PDF báo cáo tiến độ — TẢI THẲNG file .pdf (html2pdf = html2canvas + jsPDF). Render trong iframe
  // cô lập (khỏi đụng CSS app) + dùng html2canvas nên tiếng Việt có dấu hiển thị đúng.
  const exportStudentReportPDF = async (st: Student) => {
      const sHistory = history.filter(h => h && h.studentId === st.id);
      const sResults = quizResults.filter(r => r && r.studentId === st.id).sort((a, b) => safeString(a.date).localeCompare(safeString(b.date)));
      const totalH = (sHistory.reduce((s, h) => s + (h.duration || 0), 0) / 3600).toFixed(1);
      const validB = sResults.filter(r => !isNaN(Number(r.band)));
      const avgB = validB.length ? (validB.reduce((a, c) => a + Number(c.band), 0) / validB.length).toFixed(1) : "—";
      const esc = (x: any) => String(x ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const today = new Date().toLocaleDateString('vi-VN');
      const sessionRows = sHistory.map(h => `<tr><td>${esc((h.date || "").split(' ').slice(-1)[0] || h.date)}</td><td>${esc((h.skills || []).join(', ') || '—')}</td><td style="text-align:center">${Math.round((h.duration || 0) / 60)}'</td><td>${esc(h.notes || '—')}</td></tr>`).join('');
      const resultRows = sResults.map(r => `<tr><td>${esc(r.date)}</td><td>${esc(r.quizTitle)}</td><td style="text-align:center">${esc(r.score)}/${esc(r.total)}</td><td style="text-align:center;font-weight:700">${esc(r.band)}</td><td>${esc(r.teacherFeedback || '—')}</td></tr>`).join('');
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Báo cáo tiến độ — ${esc(st.name)}</title>
<style>
@page { size: A4; margin: 16mm 14mm; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1f2430; margin: 0; font-size: 12px; line-height: 1.5; }
.head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #4F46E5; padding-bottom: 14px; }
.brand { font-size: 22px; font-weight: 800; letter-spacing: -0.5px; color: #1f2430; }
.brand span { color: #6D28D9; }
.sub { font-size: 10px; letter-spacing: 2px; text-transform: uppercase; color: #8a8fa0; margin-top: 2px; }
.docmeta { text-align: right; font-size: 10.5px; color: #6b7280; }
h2 { font-size: 18px; margin: 22px 0 4px; font-weight: 700; }
.muted { color: #8a8fa0; font-size: 11px; }
.cards { display: flex; gap: 10px; margin: 18px 0 6px; }
.kpi { flex: 1; border: 1px solid #e7e8ee; border-radius: 10px; padding: 12px 14px; }
.kpi .l { font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.5px; color: #8a8fa0; }
.kpi .v { font-size: 24px; font-weight: 800; color: #4F46E5; margin-top: 4px; }
.sec { font-size: 10px; font-weight: 800; letter-spacing: 1.5px; text-transform: uppercase; color: #4F46E5; margin: 24px 0 8px; border-bottom: 1px solid #ececf2; padding-bottom: 5px; }
table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
th { text-align: left; background: #f6f6fb; color: #4b5563; font-weight: 700; text-transform: uppercase; font-size: 9px; letter-spacing: 0.4px; padding: 7px 9px; border-bottom: 1.5px solid #e2e3ea; }
td { padding: 7px 9px; border-bottom: 1px solid #eef0f4; vertical-align: top; }
tr:nth-child(even) td { background: #fafafc; }
.evalbox { border: 1px solid #e7e8ee; border-radius: 10px; height: 120px; margin-top: 8px; }
.sign { display: flex; justify-content: space-between; margin-top: 40px; text-align: center; font-size: 10.5px; }
.sign .line { border-top: 1px solid #1f2430; width: 200px; margin: 36px auto 6px; }
.foot { margin-top: 26px; text-align: center; color: #aeb2c0; font-size: 9px; border-top: 1px solid #ececf2; padding-top: 8px; }
</style></head><body>
<div class="head"><div><div class="brand">IELTS<span>OS</span></div><div class="sub">Academic Progress Report</div></div>
<div class="docmeta">Report date: <b>${today}</b><br/>Academic Director: <b>Trương Thanh Trung</b></div></div>
<h2>${esc(st.name)}</h2>
<div class="muted">${esc(st.email || '')} · Level ${esc(st.cefr || 'N/A')} → Target IELTS ${esc(st.target || 'N/A')}</div>
<div class="cards">
<div class="kpi"><div class="l">Average band</div><div class="v">${avgB}</div></div>
<div class="kpi"><div class="l">Training hours</div><div class="v">${totalH}h</div></div>
<div class="kpi"><div class="l">Sessions</div><div class="v">${sHistory.length}</div></div>
<div class="kpi"><div class="l">Tests taken</div><div class="v">${sResults.length}</div></div>
</div>
${resultRows ? `<div class="sec">Test results</div><table><thead><tr><th>Date</th><th>Test</th><th>Score</th><th>Band</th><th>Teacher feedback</th></tr></thead><tbody>${resultRows}</tbody></table>` : ''}
${sessionRows ? `<div class="sec">Session logs</div><table><thead><tr><th>Date</th><th>Skills covered</th><th>Duration</th><th>Teacher notes</th></tr></thead><tbody>${sessionRows}</tbody></table>` : ''}
<div class="sec">Overall evaluation &amp; recommendation</div><div class="evalbox"></div>
<div class="sign"><div>Student signature<div class="line"></div></div><div>Academic Director<div class="line"></div><b>Trương Thanh Trung</b></div></div>
<div class="foot">Generated by IELTS OS · Official learning record · ${today}</div>
</body></html>`;
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:fixed;left:-10000px;top:0;width:820px;height:1160px;border:0;';
      document.body.appendChild(iframe);
      const idoc = iframe.contentWindow!.document;
      idoc.open(); idoc.write(html); idoc.close();
      try {
          await new Promise(res => setTimeout(res, 350));
          const mod: any = await import('html2pdf.js');
          const html2pdf = mod.default || mod;
          await html2pdf().set({
              margin: [10, 10, 12, 10],
              filename: `IELTS_Report_${(safeString(st.name).replace(/\s+/g, '_') || 'student')}.pdf`,
              image: { type: 'jpeg', quality: 0.98 },
              html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
              jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
              pagebreak: { mode: ['css', 'legacy'] },
          }).from(idoc.body).save();
      } catch (e: any) {
          alert('Không tạo được PDF: ' + (e && e.message ? e.message : e));
      } finally {
          iframe.remove();
      }
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
      const response = await fetch(`${getApiBase()}/api/upload_docx`, { method: "POST", body: formData });
      const data = await response.json();
      if (data.success && data.quiz) {
        const newQuiz: Quiz = { ...data.quiz, audience: "ALL", targetStudentIds: [], maxAttempts: 1, isLocked: false, folder: builderFolder }; 
        saveQuiz(newQuiz);
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

  const saveQuiz = (quizToSave?: any) => {
      const isEvent = quizToSave && typeof quizToSave.preventDefault === 'function';
      const targetQuiz = isEvent ? undefined : quizToSave;

      if (targetQuiz) {
          // Branch A: gọi với quiz object trực tiếp (duplicateQuiz, handleFileUpload)
          const qz = JSON.parse(JSON.stringify({
              ...targetQuiz,
              id: targetQuiz.id || getTrueTime().toString()
          }));
          setQuizzes(prev => {
              const existingIndex = prev.findIndex(q => q.id === qz.id);
              const updated = [...prev];
              if (existingIndex !== -1) updated[existingIndex] = qz;
              else updated.unshift(qz);
              syncData({ quizzes: updated });
              return updated;
          });
          alert(`Đã lưu đề "${qz.title}" thành công!`);
      } else {
          // Branch B: gọi từ nút "LƯU ĐỀ THI" (không có argument)
          // FIX ROOT CAUSE: Lấy snapshot qua ref thay vì updater lồng nhau.
          // Gọi setQuizzes lồng trong setEditingQuiz updater khiến React batch
          // dùng snapshot quizzes cũ từ closure  quiz mới không được commit.
          const currentSnapshot = editingQuizRef.current;
          if (!currentSnapshot) return;
          if (!currentSnapshot.title) {
              alert("Vui lòng nhập tên đề thi!");
              return;
          }

          const qz = JSON.parse(JSON.stringify({
              ...currentSnapshot,
              id: currentSnapshot.id || getTrueTime().toString()
          }));

          // Ba lệnh độc lập, KHÔNG lồng nhau  React batch an toàn
          setEditingQuiz(null);
          localStorage.removeItem('ielts_exam_draft');

          setQuizzes(prev => {
              const existingIndex = prev.findIndex(q => q.id === qz.id);
              const updated = [...prev];
              if (existingIndex !== -1) updated[existingIndex] = qz;
              else updated.unshift(qz);
              syncData({ quizzes: updated });
              return updated;
          });

          setTimeout(() => alert(`Đã lưu đề "${qz.title}" thành công!`), 0);
      }
  };
  
  const duplicateQuiz = (q: Quiz) => {
      const newQuiz = JSON.parse(JSON.stringify({
          ...q,
          id: typeof crypto !== "undefined" && crypto.randomUUID
              ? `quiz_${crypto.randomUUID()}`
              : `quiz_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          title: q.title + " (Copy)",
          active: false,
          isLocked: true
      }));
      setQuizzes(prev => [newQuiz, ...prev.filter(x => x.id !== newQuiz.id)]);
      void syncData({ quizzes: [newQuiz] }).then(saved => {
          alert(saved ? "Exam duplicated successfully!" : "The copy is saved on this device and will retry automatically when the connection returns.");
      });
  };

  const handleBulkLock = (locked: boolean) => {
      if(!confirm(`Confirm Lock / Unlock ${selectedQuizzes.length} exams?`)) return;
      const nx = quizzes.map(q => selectedQuizzes.includes(q.id) ? { ...q, isLocked: locked } : q);
      setQuizzes(nx); syncData({quizzes: nx}); setSelectedQuizzes([]);
  }

  const handleAnswerChange = (questionId: string, answer: any, _type?: string) => {
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
      if (bannedIps.includes(studentIp) && !isTeacherPreview && !isStudentTestUI) { alert("ACCESS DENIED. Your IP has been banned from taking exams."); return; }
      
      if (!isTeacherPreview && !isStudentTestUI) {
          const now = getRealTime();
          if (quiz.scheduledStart && now < parseVNTime(quiz.scheduledStart)) { alert("Bài thi này chưa tới giờ mở!"); return; }
          if (quiz.scheduledEnd && now > parseVNTime(quiz.scheduledEnd)) { alert("Bài thi này đã quá hạn và bị đóng!"); return; }
          
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

  // ROOT-CAUSE FIX (bug "sửa builder không tác động đề thật"):
  // Builder sửa mảng phẳng quiz.questions, nhưng đề thật render từ sections[].questions.
  // Với đề upload .docx (có cả hai mảng), 2 mảng lệch nhau => edit không hiển thị.
  // Hàm này dựng lại sections[].questions TỪ mảng phẳng (nguồn chân lý duy nhất) ngay
  // khi mở đề: lấy đúng object đã-sửa theo id, tôn trọng thứ tự + thêm/xoá ở builder.
  const normalizeExamSections = (quiz: any) => {
      if (!quiz || !quiz.sections || !quiz.sections.length || !Array.isArray(quiz.questions)) return quiz;
      // Ưu tiên passageIndex (đề mới), fallback membership từ sections[].questions (đề cũ).
      const memberOf: Record<string, number> = {};
      quiz.sections.forEach((sec: any, i: number) => (sec.questions || []).forEach((q: any) => { if (q && q.id != null) memberOf[q.id] = i; }));
      const rebuilt = quiz.sections.map((sec: any) => ({ ...sec, questions: [] as any[] }));
      const lastIdx = rebuilt.length - 1;
      quiz.questions.forEach((q: any) => {
          if (!q || q.id == null) return;
          let i = (typeof q.passageIndex === 'number') ? q.passageIndex : memberOf[q.id];
          if (i == null || i < 0 || i >= rebuilt.length) i = lastIdx; // câu mới thêm ở builder -> section cuối
          rebuilt[i].questions.push(q);
      });
      return { ...quiz, sections: rebuilt };
  };

  const confirmStartExam = (quiz: Quiz, isTeacherPreview = false, isStudentTestUI = false) => {
      // isStudentTestUI: dùng đề mã hóa + đánh dấu isPreview để KHÔNG lưu kết quả thật
      const quizToLoad = normalizeExamSections(isStudentTestUI ? createTestUIQuiz(quiz) : quiz);
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
      setAudioStatus("IDLE");
      setAudioCur(0);
      setAudioDur(0);
      setPendingAudioResume(null);
      audioPlayRequestRef.current = false;
      
      setActiveExam(quizToLoad);
      setCurrentSectionIndex(0); // Reset Tab khi mở đề mới
      
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
              if (q.type === "CHOICE" || q.type === "MATCHING") { 
                      if (studentAns === q.correctAnswer) newScore++; 
                  } 
                  else if (q.type === "CHOICE_MULTIPLE") {
                      newScore += getChoiceMultipleScore(q, studentAns);
                  }
                  else {
                      if (studentAns !== undefined && studentAns !== null) {
                          const sAns = String(studentAns).trim().toLowerCase();
                          const cA = String(q.correctAnswer).split("/").map(s => s.trim().toLowerCase());
                          if (cA.includes(sAns)) newScore++;
                      }
                  }
          });
          const totalPoints = getQuizPointTotal(qz);
          return {...r, score: newScore, total: totalPoints, band: getIeltsBand(newScore, totalPoints, qz.type)};
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
      const totalQ = getQuizPointTotal(state.activeExam);
      state.activeExam.questions.forEach((q) => {
          const studentAns = state.examAnswers[q.id];
          if (q.type === "CHOICE" || q.type === "MATCHING") { 
                  if (studentAns === q.correctAnswer) score++; 
              } 
              else if (q.type === "CHOICE_MULTIPLE") {
                  score += getChoiceMultipleScore(q, studentAns);
              }
              else {
                  if (studentAns !== undefined && studentAns !== null) {
                      const sAns = String(studentAns).trim().toLowerCase();
                      const correctStrs = String(q.correctAnswer).split("/").map(s => s.trim().toLowerCase());
                      if (correctStrs.includes(sAns)) score++;
                  }
              }
      });

      const band = getIeltsBand(score, totalQ, state.activeExam.type);

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

      if (isOffline || !navigator.onLine) {
          pushOfflineResult(currentUser?.email, result);
          setQuizResults(prev => [result, ...prev]);
          alert("NETWORK ERROR! The exam has been saved locally and queued. Please do not clear your browser cache; it will auto-sync when the connection is restored.");
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
      _setAudioTested(false);
      if (Number(band) >= 7.0) { setShowCelebration(true); setTimeout(() => setShowCelebration(false), 8000); }
        alert(`EXAM SUBMITTED! Score: ${score}/${totalQ}. Band: ${band}.`);
        setActiveExam(null); setGracePeriod(null); setHardLocked(false);
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    }
  forceSubmitExamRef.current = forceSubmitExam;
  const submitExam = (isTimeUp = false) => {
    if (!activeExam) return;
    if (!isTimeUp) {
        const timeRatio = examTimeLeft / (activeExam.timeLimit * 60);
        
        if (timeRatio > 0.5) { if (!confirm(`WARNING: You still have more than half the time left! Please review your answers carefully.\nDo you still want to submit early?`)) return; }

        const unanswered = activeExam.questions.filter(q => examAnswers[q.id] === undefined || examAnswers[q.id] === "");
        const flagged = activeExam.questions.filter(q => flaggedQuestions.includes(q.id));

        let msg = "Confirm submission?";
        if (unanswered.length > 0) msg = `YOU HAVE ${unanswered.length} UNANSWERED QUESTIONS: ${unanswered.map(q => activeExam.questions.indexOf(q)+1).join(", ")}!\n\n` + msg;
        else if (flagged.length > 0) msg = `You still have ${flagged.length} flagged questions.\n\n` + msg;
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
      setQuizzes(nx); syncData({ quizzes: nx, __quizDeletedIds: selectedQuizzes }); setSelectedQuizzes([]);
  };

  // ==========================================
  // STYLES & CALCS
  // ==========================================
  const calHeader = calDate.toLocaleString(i18n.language === 'vi' ? 'vi-VN' : 'en-US', { month: "long", year: "numeric" });
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
         if (!r) return false;
         if (resFilterStudent && r.studentId !== resFilterStudent) return false;
         if (resFilterQuiz && r.quizId !== resFilterQuiz) return false;
         if (resFilterBand === ">=7.0" && Number(r.band) < 7.0) return false;
         if (resFilterBand === "<6.0" && Number(r.band) >= 6.0) return false;
         
         // ĐàFIX BỌC KHIÊN SAFE STRING
         if (resultSearch && !safeString(r.studentName).toLowerCase().includes(safeString(resultSearch).toLowerCase())) return false;
         
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
      const results = quizResults.filter(r => r && r.quizId === resFilterQuiz);
      if (results.length === 0) return "N/A";
      const validScores = results.map(r => Number(r.band)).filter(b => !isNaN(b));
          if (validScores.length === 0) return "N/A";
          return (validScores.reduce((a,b)=>a+b, 0) / validScores.length).toFixed(1);
      }, [quizResults, resFilterQuiz]);

          // ==========================================
      // GIAO DIỆN CHUẨN MỰC APPLE (IOS 17 / MACOS SONOMA AESTHETIC)
      // ==========================================
      // Sắc nhấn theo VAI TRÒ: Student = teal (học tập), Teacher = indigo (biên soạn/quyền hạn),
      // màn đăng nhập (null) = indigo cao cấp. Colorblind giữ xanh tương phản cao cho mọi vai trò.
      const _roleAccent = colorblind ? "#0055FF"
        : userRole === "STUDENT" ? "#0D9488"   // teal-600
        : userRole === "TEACHER" ? "#5145E5"   // indigo
        : "#5145E5";                            // login
      const C = {
        bg: colorblind ? "#FFFFFF" : "#FAFAF8", // Off-white ẤM (bớt "phòng lab", thêm chất "giấy")
        card: "#FFFFFF", // Thẻ Card trắng nguyên khối
        border: colorblind ? "#CCCCCC" : "rgba(23, 18, 33, 0.09)", // Viền mờ hơi ngả tím (ấm)
        text: "#1A1726", // Đen ngả tím nhẹ, bớt khô
        sub: "#7C7689", // Xám ghi có nhiệt cho text phụ
        accent: _roleAccent,
        succ: colorblind ? "#008A00" : "#0E9F6E", // Emerald
        warn: colorblind ? "#E59700" : "#F59E0B", // Amber
        err: colorblind ? "#E50000" : "#EF4444" // Red
      };
      // _C_BASE: bảng màu GỐC. Portal học viên phủ theme vĩnh viễn lên _C_BASE (shadow C cục bộ),
      // KHÔNG ảnh hưởng phòng thi vì phòng thi (activeExam) đã return TRƯỚC block học viên.
      const _C_BASE = C;

  const globalStyles = useMemo(() => (
        <style>{`
          * { box-sizing: border-box; }
          html, body, #root { width: 100% !important; max-width: 100% !important; margin: 0 !important; padding: 0 !important; overflow-x: hidden; -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
          body { --accent: ${C.accent}; background: ${C.bg}; color: ${C.text}; font-family: var(--sans), -apple-system, "Segoe UI", Roboto, sans-serif; line-height: 1.5; -webkit-font-smoothing: antialiased; letter-spacing: -0.011em; }
          /* HEADING có "giọng" riêng (Space Grotesk) — phá cảm giác máy móc của system-ui */
          h1, h2, h3, h4, .heading-font { font-family: var(--heading), system-ui, sans-serif; letter-spacing: -0.02em; }

          /* NÚT BẤM (BUTTONS) - KHÔNG GIẬT CỤC */
          button { cursor: pointer; border: none; border-radius: 10px; transition: opacity 0.2s ease, transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 0.2s ease; font-weight: 600; font-family: inherit; display: inline-flex; align-items: center; justify-content: center; }
          button:active { transform: scale(0.97); opacity: 0.8; }

          /* Ô NHẬP LIỆU (INPUTS) - SANG XỊN */
          input, select, textarea { background: #FFFFFF; color: ${C.text}; border: 1px solid ${C.border}; border-radius: 10px; padding: 14px 16px; outline: none; width: 100%; font-family: inherit; transition: all 0.2s ease; font-size: 15px; box-shadow: 0 1px 2px rgba(0,0,0,0.02); }
          input::placeholder, textarea::placeholder { color: #A1A1A6; }
          input:focus, select:focus, textarea:focus { border-color: ${C.accent}; box-shadow: 0 0 0 4px ${C.accent}26; }

          /* CARD — phân cấp: bo 20px (nhỏ hơn input/nút 10px tạo nhịp), shadow LỆCH XUỐNG + viền sáng trong = vật liệu thật */
          @keyframes cardIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
          .card { background: ${C.card}; border: 1px solid ${C.border}; border-radius: 20px; padding: 32px; box-shadow: 0 1px 2px rgba(23,18,33,0.04), 0 12px 28px -10px rgba(23,18,33,0.10), inset 0 1px 0 rgba(255,255,255,0.7); transition: box-shadow 0.3s ease, transform 0.3s cubic-bezier(0.2,0.8,0.2,1); animation: cardIn 0.38s cubic-bezier(0.21,1.02,0.73,1) both; }
          .card:hover { box-shadow: 0 2px 4px rgba(23,18,33,0.05), 0 22px 48px -12px rgba(23,18,33,0.16), inset 0 1px 0 rgba(255,255,255,0.7); transform: translateY(-3px); }
          
          /* THANH CUỘN (SCROLLBAR) - MACOS STYLE */
          ::-webkit-scrollbar { width: 8px; height: 8px; }
          ::-webkit-scrollbar-track { background: transparent; }
          ::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.15); border-radius: 10px; border: 2px solid ${C.bg}; }
          ::-webkit-scrollbar-thumb:hover { background: rgba(0,0,0,0.3); }
          .card ::-webkit-scrollbar-thumb { border-color: ${C.card}; }
          
          /* SEGMENTED CONTROL (IOS TABS) */
          .ios-tabs-container { display: inline-flex; background: rgba(118, 118, 128, 0.12); padding: 4px 4px 6px; border-radius: 14px; gap: 4px; overflow-x: auto; overflow-y: hidden; scrollbar-width: thin; scrollbar-color: rgba(0,0,0,0.28) transparent; }
          .ios-tabs-container::-webkit-scrollbar { height: 6px; }
          .ios-tabs-container::-webkit-scrollbar-track { background: transparent; }
          .ios-tabs-container::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.25); border-radius: 10px; }
          .ios-tabs-container::-webkit-scrollbar-thumb:hover { background: rgba(0,0,0,0.4); }
          .tab-btn { padding: 8px 16px; background: transparent; color: ${C.text}; font-size: 14px; font-weight: 600; border-radius: 10px; transition: all 0.2s ease; white-space: nowrap; box-shadow: none; opacity: 0.7; }
          .tab-btn:hover { opacity: 1; }
          .tab-btn.active { color: #000; background: #FFF; box-shadow: 0 3px 8px rgba(0, 0, 0, 0.12), 0 1px 1px rgba(0,0,0,0.04); opacity: 1; }
          
          /* ANIMATED GRADIENTS (LÀM MỊN) */
          @keyframes mesh { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
          .mesh-bg { background: linear-gradient(-45deg, #e5e5ea, #f5f5f7, #ffffff, #e5e5ea); background-size: 400% 400%; animation: mesh 20s ease infinite; }
          
          /* CÁC THÀNH PHẦN KHÁC */
          .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; margin-top: 10px; }
          .cal-day { aspect-ratio: 1; display: grid; place-items: center; font-size: 13px; border-radius: 8px; cursor: pointer; border: 1px solid transparent; color: ${C.text}; font-weight: 500; transition: 0.2s; }
          .cal-day:hover { background: rgba(0,0,0,0.05); }
          .cal-day.empty { cursor: default; border: none; background: transparent; }
          .cal-day.empty:hover { background: transparent; }
          .cal-day.has-sched { background: ${C.accent}15; color: ${C.accent}; font-weight: 700; border-color: ${C.accent}30; }
          .cal-day.selected { background: ${C.accent} !important; color: #fff !important; font-weight: 700; box-shadow: 0 4px 10px ${C.accent}4D; }
          .timer-num { font-family: var(--mono), 'SFMono-Regular', Consolas, monospace; font-weight: 700; letter-spacing: -1px; font-variant-numeric: tabular-nums; }
          @keyframes pulseFast { 0%, 100% { opacity: 1; color: ${C.err}; } 50% { opacity: 0.7; color: #ff0000; } }
          .pulse-fast { animation: pulseFast 1s infinite; }
          .booting-screen { height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; background: ${C.bg}; color: ${C.text}; font-family: -apple-system, system-ui; font-size: 14px; letter-spacing: 2px; font-weight: 600; text-transform: uppercase; }
          .booting-spinner { width: 32px; height: 32px; border: 3px solid rgba(0,0,0,0.1); border-top-color: ${C.text}; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 24px; }
          @keyframes spin { to { transform: rotate(360deg); } }
          @keyframes fall { 0% { transform: translateY(-100vh) rotate(0deg); opacity: 1;} 100% { transform: translateY(100vh) rotate(360deg); opacity: 0;} }
          @keyframes confettiFall { 0% { transform: translateY(-10vh) rotate(0deg); opacity: 1; } 100% { transform: translateY(110vh) rotate(540deg); opacity: 0.9; } }
          @keyframes celebPop { 0% { transform: scale(0.3); opacity: 0; } 45% { transform: scale(1.25); opacity: 1; } 70% { transform: scale(0.95); } 100% { transform: scale(1); opacity: 0; } }
          .group-context { padding: 20px; background: #F4F2EC; border-left: 3px solid ${C.accent}; border-radius: 4px 14px 14px 4px; margin-bottom: 24px; font-style: italic; color: ${C.text}; white-space: pre-wrap; overflow-x: auto; }
          .highlightable-content table { width: auto !important; max-width: 100% !important; border-collapse: collapse !important; margin: 15px auto !important; }
          .highlightable-content table td, .highlightable-content table th { padding: 8px !important; border: 1px solid #ccc !important; }
          .marquee-container { overflow: hidden; white-space: nowrap; width: 100%; flex: 1; margin-left: 10px; }
          .marquee-content { display: inline-block; animation: marquee 15s linear infinite; }
          @keyframes marquee { 0% { transform: translateX(100%); } 100% { transform: translateX(-100%); } }
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
      /* ĐOẠN CONTEXT (summary / notes / flow-chart) — chuẩn IELTS CBT đẹp */
      .idp-context-box { background: var(--einput, #fff); border: 1px solid var(--eborder, #e0e0e0); border-radius: 10px; padding: 18px 24px; line-height: 2.0; }
      .idp-context-box > div, .idp-context-box [data-field="groupContext"] > div { margin: 2px 0; }
      .idp-context-box [style*="list-item"] { margin-left: 22px; }
      .idp-flow-arrow { text-align: center; color: var(--eblue, #0969da); font-size: 22px; line-height: 1; margin: 8px auto; font-weight: 800; }
      .idp-inline-input { transition: border-color .15s, box-shadow .15s; }
      .idp-inline-input:focus { outline: none; border-color: var(--eblue, #0969da) !important; box-shadow: 0 0 0 2px rgba(9,105,218,0.18); }
      .idp-matching-table tbody tr:hover { background: rgba(9,105,218,0.05); }
      .idp-matching-table input[type="radio"] { cursor: pointer; }
          `}</style>
  ), [colorblind, C.card, C.text, C.border, C.sub, C.accent, C.bg, C.err, C.warn, _fontFam]);

  // ==========================================
  // MEMOIZED EXAM STRUCTURE
  // ROOT FIX: tách groupedQuestions + processedContexts ra khỏi render scope.
  // Dependency: activeExam?.questions — chỉ thay đổi khi đề mới / highlight thay đổi,
  // KHÔNG thay đổi khi timer tick (setExamTimeLeft không động đến activeExam).
  //  dangerouslySetInnerHTML nhận cùng chuỗi  React bỏ qua DOM update  input không bị remount  focus giữ nguyên.
  // ==========================================
  const _examRenderSafeHTML = (raw: string | undefined): string => {
      if (!raw) return "";
      return (raw.includes('student-highlight') || raw.includes('student-note-hl')) ? raw : formatContent(raw);
  };

  const examGroupedQuestions = useMemo(() => {
      if (!activeExam) return [] as { context: string; instruction: string; startIndex: number; questions: QuizQuestion[] }[];
      type ExamGroup = { context: string; instruction: string; startIndex: number; questions: QuizQuestion[] };
      const result: ExamGroup[] = [];
      let cur: any = null; // ĐàFIX: Dùng 'any' để vô hiệu hóa lỗi Type 'never' ảo của TypeScript
      (activeExam.questions || []).forEach((q: QuizQuestion, index: number) => {
          const ctx = q.groupContext || "";
          const ins = q.instruction || "";
          const sameContext = !cur || ctx === "" || cur.context === ctx;
          const sameInstruction = !cur || ins === cur.instruction || (ins === "" && cur.instruction !== "");
          if (cur && cur.questions.length > 0 && sameContext && sameInstruction) {
              if (!cur.instruction && ins) cur.instruction = ins;
              cur.questions.push(q);
          } else {
              if (cur && cur.questions.length > 0) result.push(cur as ExamGroup);
              cur = { context: ctx || (cur ? cur.context : ""), instruction: ins, startIndex: index, questions: [q] };
          }
      });
      if (cur && cur.questions.length > 0) result.push(cur as ExamGroup);
      return result;
  }, [activeExam?.questions]);


  const examProcessedContexts = useMemo(() => {
      if (!activeExam || examGroupedQuestions.length === 0) return { contexts: {}, qTexts: {} };
      const resultCtx: Record<string, { html: string; injected: string[] }> = {};
      const resultQText: Record<string, { html: string; inlineInjected: boolean }> = {};
      const allQ = activeExam.questions || [];
      
      examGroupedQuestions.forEach((group) => {
          // Ô input co giãn theo NHÓM: đáp án DÀI NHẤT + nới thêm. Đáp án đa biến thể "July 18/18 July/..." chỉ tính 1 BIẾN THỂ dài nhất.
          const _variantLen = (s: string) => Math.max(...s.split('/').map(v => v.trim().length), 0);
          const _bAns = group.questions.filter((q: any) => q.type === 'BLANK').map((q: any) => String(q.correctAnswer || "")).filter(s => s.length > 0);
          const _maxA = _bAns.length ? Math.max(..._bAns.map(_variantLen)) : 10;
          const _inW = Math.max(70, Math.min(320, Math.round(_maxA * 9) + 30));
          const _dOpts = ((group.questions.find((q: any) => q.options && q.options.length)?.options) || []).map((o: any) => String(o));
          const _avgO = _dOpts.length ? _dOpts.reduce((a, s) => a + s.length, 0) / _dOpts.length : 12;
          const _zoneW = Math.max(80, Math.min(300, Math.round(_avgO * 7.2) + 34));
          if (group.context && !resultCtx[group.context]) {
              let res = _examRenderSafeHTML(group.context);
              const injected: string[] = [];
              group.questions.forEach((gq: QuizQuestion) => {
                  if (gq.type === 'BLANK' || gq.type === 'DRAG_DROP') {
                      const qIndexGlobal = allQ.findIndex((x: any) => x.id === gq.id) + 1;
                      const inputHtml = gq.type === 'DRAG_DROP'
                          ? `<span class="idp-dropzone" data-qid="${gq.id}" style="min-width:${_zoneW}px">${qIndexGlobal}</span>`
                          : `<input type="text" class="idp-inline-input inline-blank-input" data-qid="${gq.id}" placeholder="${qIndexGlobal}" autocomplete="off" style="width:${_inW}px" />`;
                      
                      // Regex thông minh: Bắt số câu có gạch dưới, số trong ngoặc, hoặc số nằm trơ trọi trong thẻ HTML/Bảng
                      const exactRegex = new RegExp(
                          `(?:\\(|\\[)\\b${qIndexGlobal}\\b(?:\\)|\\])|` + 
                          `\\b${qIndexGlobal}\\b\\.?\\s*(?:_{2,}|\\.{4,})|` + 
                          `(>\\s*)\\b${qIndexGlobal}\\b\\.?(\\s*<)|` + 
                          `(^\\s*)\\b${qIndexGlobal}\\b\\.?(\\s*$)`
                      , 'i');
                      
                      let matched = false;
                      let newRes = res.replace(exactRegex, (_match, p1, p2, p3, p4) => {
                          matched = true;
                          if (p1 !== undefined && p2 !== undefined) return `${p1}${qIndexGlobal} ${inputHtml}${p2}`;
                          if (p3 !== undefined && p4 !== undefined) return `${p3}${qIndexGlobal} ${inputHtml}${p4}`;
                          return inputHtml;
                      });
                      
                      if (!matched) {
                          const fallbackRegex = /_{2,}|\.{4,}/;
                          if (fallbackRegex.test(newRes)) {
                              newRes = newRes.replace(fallbackRegex, inputHtml);
                              matched = true;
                          }
                      }
                      
                      if (matched) { res = newRes; injected.push(gq.id); }
                  }
              });
              resultCtx[group.context] = { html: res, injected };
          }

          group.questions.forEach((gq: QuizQuestion) => {
              let resText = _examRenderSafeHTML(gq.text);
              let inlineInjected = false;
              const isAlreadyInjected = resultCtx[group.context]?.injected.includes(gq.id);
              
              if (!isAlreadyInjected && (gq.type === 'BLANK' || gq.type === 'DRAG_DROP')) {
                  const qIndexGlobal = allQ.findIndex((x: any) => x.id === gq.id) + 1;
                  const inputHtml = gq.type === 'DRAG_DROP'
                      ? `<span class="idp-dropzone" data-qid="${gq.id}" style="min-width:${_zoneW}px">${qIndexGlobal}</span>`
                      : `<input type="text" class="idp-inline-input inline-blank-input" data-qid="${gq.id}" placeholder="${qIndexGlobal}" autocomplete="off" style="width:${_inW}px" />`;
                  
                  const exactRegex = new RegExp(
                      `(?:\\(|\\[)\\b${qIndexGlobal}\\b(?:\\)|\\])|` + 
                      `\\b${qIndexGlobal}\\b\\.?\\s*(?:_{2,}|\\.{4,})|` + 
                      `(>\\s*)\\b${qIndexGlobal}\\b\\.?(\\s*<)|` + 
                      `(^\\s*)\\b${qIndexGlobal}\\b\\.?(\\s*$)`
                  , 'i');
                  
                  let matched = false;
                  let newResText = resText.replace(exactRegex, (_match, p1, p2, p3, p4) => {
                      matched = true;
                      if (p1 !== undefined && p2 !== undefined) return `${p1}${qIndexGlobal} ${inputHtml}${p2}`;
                      if (p3 !== undefined && p4 !== undefined) return `${p3}${qIndexGlobal} ${inputHtml}${p4}`;
                      return inputHtml;
                  });
                  
                  if (!matched) {
                      const fallbackRegex = /_{2,}|\.{4,}/;
                      if (fallbackRegex.test(newResText)) {
                          newResText = newResText.replace(fallbackRegex, inputHtml);
                          matched = true;
                      }
                  }
                  
                  if (matched) { resText = newResText; inlineInjected = true; }
              }
              resultQText[gq.id] = { html: resText, inlineInjected };
          });
      });
      return { contexts: resultCtx, qTexts: resultQText };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examGroupedQuestions]);

  // ==========================================
  // VIEW RENDER
  // ==========================================
  if (authChecking) return <div className="booting-screen"><div style={{ marginBottom: 24, filter: "drop-shadow(0 10px 24px rgba(109,40,217,0.35))" }}><BrandLogo size={58} /></div><div className="booting-spinner"></div><div style={{animation: 'pulse 2s infinite', fontWeight: 600}}>AUTHENTICATING...</div></div>;

  if (!currentUser) {
    // ==========================================
    // ĐĂNG NHẬP — "EDITORIAL LUXE": nền đen tuyền, 1 màu nhấn vàng champagne,
    // bố cục bất đối xứng kiểu tạp chí, serif Fraunces, hiệu ứng wow (spotlight
    // theo con trỏ + aurora trôi + thẻ nghiêng 3D + entrance animation).
    // ==========================================
    const GOLD = "#E7C470", GOLD_BRIGHT = "#F4DFA8", GOLD_DEEP = "#B8923E";
    const CREAM = "#F6EBCB", CREAM_DIM = "rgba(246,235,203,0.56)", INK = "#1a1305";
    const lxYear = new Date().getFullYear();
    const lxFeats: [string, string, string][] = [
      ["01", "Phòng thi chuẩn IDP", "Giao diện computer-based mô phỏng phòng thi thật."],
      ["02", "Chấm & phân tích tức thì", "Band điểm, hạn chế và lộ trình cải thiện ngay sau khi nộp."],
      ["03", "Chống gian lận", "Tích hợp Safe Exam Browser, khoá môi trường thi."],
    ];
    const lxNoise = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E")`;
    // WOW #1: spotlight bám con trỏ — cập nhật CSS var trực tiếp lên DOM (không re-render).
    const lxStageMove = (e: any) => {
      const r = e.currentTarget.getBoundingClientRect();
      e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
      e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
    };
    // WOW #2: thẻ form nghiêng 3D nhẹ theo vị trí con trỏ.
    const lxCardMove = (e: any) => {
      const r = e.currentTarget.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      e.currentTarget.style.setProperty("--rx", `${px * 7}deg`);
      e.currentTarget.style.setProperty("--ry", `${-py * 7}deg`);
    };
    const lxCardLeave = (e: any) => {
      e.currentTarget.style.setProperty("--rx", "0deg");
      e.currentTarget.style.setProperty("--ry", "0deg");
    };
    return (
      <div onMouseMove={lxStageMove} style={{ minHeight: "100dvh", display: "flex", position: "relative", overflow: "hidden", background: "#060507", ["--mx" as any]: "60%", ["--my" as any]: "28%" } as any}>
        {globalStyles}
        <style>{`
          @media (max-width: 980px){
            .lx-hero{ display:none !important; }
            .lx-form-col{ flex:1 1 100% !important; flex-direction:column !important; justify-content:flex-start !important; align-items:center !important; padding:34px 22px 42px !important; overflow-y:auto !important; }
            .lx-mhero{ display:flex !important; }
            .lx-card{ transform:none !important; }
          }
          @media (max-width: 420px){
            .lx-cardinner{ padding:30px 22px !important; border-radius:20px !important; }
            .lx-mhero h1{ font-size:clamp(28px,8.5vw,36px) !important; }
          }
          @keyframes lxRise{ from{ opacity:0; transform:translateY(20px);} to{ opacity:1; transform:translateY(0);} }
          @keyframes lxAurora1{ 0%{ transform:translate(-8%,-6%) scale(1);} 50%{ transform:translate(10%,8%) scale(1.25);} 100%{ transform:translate(-8%,-6%) scale(1);} }
          @keyframes lxAurora2{ 0%{ transform:translate(6%,8%) scale(1.1);} 50%{ transform:translate(-9%,-7%) scale(1.32);} 100%{ transform:translate(6%,8%) scale(1.1);} }
          @keyframes lxShimmer{ 0%{ background-position:-160% 0;} 100%{ background-position:260% 0;} }
          .lx-rise{ opacity:0; animation:lxRise .9s cubic-bezier(.22,.61,.36,1) forwards; }
          .lx-card{ transform:perspective(1200px) rotateX(var(--ry,0deg)) rotateY(var(--rx,0deg)); transition:transform .18s ease-out; transform-style:preserve-3d; }
          .lx-input{ width:100%; padding:14px 16px; font-size:15px; border:1px solid rgba(231,196,112,0.18); border-radius:13px; background:rgba(255,255,255,0.03); outline:none; color:${CREAM}; transition:border-color .2s, box-shadow .2s, background .2s; box-sizing:border-box; font-family:var(--heading); letter-spacing:.3px; }
          .lx-input::placeholder{ color:rgba(246,235,203,0.28); letter-spacing:0; }
          .lx-input:focus{ border-color:rgba(231,196,112,0.6); background:rgba(231,196,112,0.05); box-shadow:0 0 0 4px rgba(231,196,112,0.13); }
          .lx-feat{ display:flex; gap:18px; align-items:baseline; padding:15px 2px; border-top:1px solid rgba(231,196,112,0.13); }
          .lx-feat:last-child{ border-bottom:1px solid rgba(231,196,112,0.13); }
          .lx-num{ font-family:var(--mono); font-size:13px; font-weight:700; color:${GOLD}; letter-spacing:1px; }
          .lx-submit{ position:relative; overflow:hidden; }
          .lx-submit:hover{ transform:translateY(-2px); box-shadow:0 18px 42px rgba(231,196,112,0.32) !important; }
          .lx-submit > span{ position:relative; z-index:2; }
          .lx-submit::after{ content:""; position:absolute; inset:0; z-index:1; background:linear-gradient(110deg, transparent 25%, rgba(255,255,255,0.5) 50%, transparent 75%); background-size:200% 100%; animation:lxShimmer 4s ease-in-out infinite; }
          .lx-eye:hover{ color:${GOLD} !important; }
        `}</style>

        {/* WOW #2: aurora vàng trôi chậm sau lớp tối */}
        <div aria-hidden style={{ position: "absolute", inset: "-20%", zIndex: 0, pointerEvents: "none" }}>
            <div style={{ position: "absolute", width: "62vw", height: "62vw", left: "-12%", top: "-16%", background: `radial-gradient(circle, ${GOLD}24, transparent 62%)`, filter: "blur(46px)", animation: "lxAurora1 19s ease-in-out infinite" }} />
            <div style={{ position: "absolute", width: "52vw", height: "52vw", right: "-14%", bottom: "-20%", background: `radial-gradient(circle, ${GOLD}1c, transparent 60%)`, filter: "blur(54px)", animation: "lxAurora2 23s ease-in-out infinite" }} />
        </div>
        {/* Chất liệu hạt — phá cảm giác phẳng "số hoá" */}
        <div aria-hidden style={{ position: "absolute", inset: 0, zIndex: 1, opacity: 0.45, mixBlendMode: "overlay", backgroundImage: lxNoise, pointerEvents: "none" }} />
        {/* WOW #1: spotlight bám con trỏ */}
        <div aria-hidden style={{ position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none", background: `radial-gradient(560px circle at var(--mx) var(--my), ${GOLD}1f, transparent 60%)` }} />
        {/* Vignette làm sâu rìa */}
        <div aria-hidden style={{ position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none", background: "radial-gradient(125% 125% at 50% -10%, transparent 52%, rgba(0,0,0,0.72) 100%)" }} />

        {/* CỘT TRÁI — EDITORIAL */}
        <div className="lx-hero" style={{ flex: "1.12 1 0", position: "relative", zIndex: 2, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "60px 4vw 54px 6vw", color: CREAM }}>
            <div className="lx-rise" style={{ display: "flex", alignItems: "center", gap: 14, animationDelay: ".05s" }}>
                <div style={{ filter: `drop-shadow(0 10px 22px ${GOLD}33)` }}><BrandLogo size={46} stops={[GOLD_BRIGHT, GOLD, GOLD_DEEP]} mark={INK} /></div>
                <BrandWordmark size={20} color={CREAM} light />
            </div>
            <div style={{ position: "relative" }}>
                {/* số thứ tự khổng lồ kiểu tạp chí, mờ phía sau */}
                <div aria-hidden style={{ position: "absolute", top: -88, left: -14, fontFamily: "var(--display)", fontSize: "clamp(160px, 20vw, 260px)", fontWeight: 600, lineHeight: 1, color: "rgba(231,196,112,0.055)", pointerEvents: "none", userSelect: "none" }}>№</div>
                <div className="lx-rise" style={{ position: "relative", fontFamily: "var(--mono)", fontSize: 12, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase", color: GOLD, marginBottom: 24, animationDelay: ".15s" }}>Computer-based IELTS · Since {lxYear}</div>
                <h1 className="lx-rise" style={{ position: "relative", fontFamily: "var(--display)", fontSize: "clamp(44px, 5vw, 70px)", lineHeight: 1.02, fontWeight: 500, margin: "0 0 24px", letterSpacing: -1, color: CREAM, animationDelay: ".25s" }}>Vừa học vừa thi<br/><span style={{ fontStyle: "italic", background: `linear-gradient(100deg, ${GOLD_BRIGHT}, ${GOLD_DEEP})`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>Tiến bộ tức thì!</span></h1>
                <p className="lx-rise" style={{ position: "relative", fontSize: 16.5, lineHeight: 1.75, color: CREAM_DIM, maxWidth: 460, margin: "0 0 36px", animationDelay: ".35s" }}>Hệ thống thi thử chuẩn IDP, chấm điểm tức thì, sổ từ vựng thông minh và quản lý lớp học.</p>
                <div className="lx-rise" style={{ maxWidth: 480, animationDelay: ".45s" }}>
                    {lxFeats.map(([n, h, d]) => (
                        <div key={n} className="lx-feat">
                            <span className="lx-num">{n}</span>
                            <div>
                                <div style={{ fontFamily: "var(--heading)", fontSize: 15.5, fontWeight: 700, color: CREAM, marginBottom: 4 }}>{h}</div>
                                <div style={{ fontSize: 13.5, lineHeight: 1.55, color: CREAM_DIM }}>{d}</div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
            <div className="lx-rise" style={{ fontFamily: "var(--mono)", fontSize: 11.5, letterSpacing: 0.5, color: "rgba(246,235,203,0.4)", animationDelay: ".55s" }}>© {lxYear} IELTS OS — Computer-based Testing Platform</div>
        </div>

        {/* CỘT PHẢI — THẺ KÍNH NỔI, NGHIÊNG 3D */}
        <div className="lx-form-col" style={{ flex: "0.9 1 0", position: "relative", zIndex: 2, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 5vw" }}>
            {/* MOBILE HERO — chỉ hiện ≤980px (cột trái bị ẩn) */}
            <div className="lx-mhero lx-rise" style={{ display: "none", flexDirection: "column", width: "100%", maxWidth: 430, marginBottom: 22, color: CREAM, animationDelay: ".15s" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 18 }}>
                    <div style={{ filter: `drop-shadow(0 8px 18px ${GOLD}33)` }}><BrandLogo size={34} stops={[GOLD_BRIGHT, GOLD, GOLD_DEEP]} mark={INK} /></div>
                    <BrandWordmark size={16} color={CREAM} light />
                </div>
                <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, fontWeight: 700, letterSpacing: 2.5, textTransform: "uppercase", color: GOLD, marginBottom: 10 }}>Computer-based IELTS · Since {lxYear}</div>
                <h1 style={{ fontFamily: "var(--display)", fontSize: "clamp(30px, 8vw, 40px)", lineHeight: 1.05, fontWeight: 500, margin: "0 0 12px", letterSpacing: -0.6 }}>Vừa học vừa thi <span style={{ fontStyle: "italic", background: `linear-gradient(100deg, ${GOLD_BRIGHT}, ${GOLD_DEEP})`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>tiến bộ tức thì.</span></h1>
                <p style={{ fontSize: 14, lineHeight: 1.6, color: CREAM_DIM, margin: 0 }}>Thi thử chuẩn IDP · chấm điểm tức thì · sổ từ vựng thông minh.</p>
            </div>
            <div onMouseMove={lxCardMove} onMouseLeave={lxCardLeave} className="lx-card lx-rise" style={{ width: 430, maxWidth: "100%", animationDelay: ".35s" }}>
                <div className="lx-cardinner" style={{ position: "relative", background: "linear-gradient(165deg, rgba(30,25,15,0.74), rgba(10,9,7,0.84))", border: "1px solid rgba(231,196,112,0.18)", borderRadius: 24, padding: "42px 38px", boxShadow: "0 44px 96px -34px rgba(0,0,0,0.92), inset 0 1px 0 rgba(231,196,112,0.13)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" }}>
                    <div aria-hidden style={{ position: "absolute", top: 0, left: 30, right: 30, height: 1, background: `linear-gradient(90deg, transparent, ${GOLD}aa, transparent)` }} />
                    <form onSubmit={handleLogin}>
                        <div className="lx-mobile-brand" style={{ display: "none", alignItems: "center", gap: 11, marginBottom: 26 }}>
                            <BrandLogo size={36} stops={[GOLD_BRIGHT, GOLD, GOLD_DEEP]} mark={INK} />
                            <BrandWordmark size={16} color={CREAM} light />
                        </div>
                        <div style={{ fontFamily: "var(--mono)", fontSize: 11, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase", color: GOLD, marginBottom: 14 }}>Secure Access</div>
                        <h2 style={{ fontFamily: "var(--display)", fontSize: 32, fontWeight: 500, color: CREAM, margin: "0 0 8px", letterSpacing: -0.5 }}>{t('login_heading')}</h2>
                        <p style={{ color: CREAM_DIM, fontSize: 14.5, margin: "0 0 30px", lineHeight: 1.6 }}>{t('login_welcome')}</p>
                        {loginError && <div style={{ background: "rgba(229,144,114,0.12)", color: "#E59072", border: "1px solid rgba(229,144,114,0.3)", padding: "12px 14px", borderRadius: 12, fontSize: 13, marginBottom: 20, fontWeight: 600, textAlign: "center" }}>{loginError}</div>}
                        <div style={{ display: "grid", gap: 18 }}>
                            <div>
                                <label style={{ fontFamily: "var(--mono)", fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: CREAM_DIM, marginBottom: 9, display: "block" }}>{t('email_label')}</label>
                                <input className="lx-input" type="email" value={email} onChange={(e: any) => setEmail(e.target.value)} required placeholder="name@example.com" />
                            </div>
                            <div>
                                <label style={{ fontFamily: "var(--mono)", fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: CREAM_DIM, marginBottom: 9, display: "block" }}>{t('pwd_label')}</label>
                                <div style={{ position: "relative" }}>
                                    <input className="lx-input" type={showPwd ? "text" : "password"} value={password} onChange={(e: any) => setPassword(e.target.value)} required placeholder="••••••••" style={{ paddingRight: 46 }} />
                                    <button type="button" className="lx-eye" onClick={() => setShowPwd(!showPwd)} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: 6, color: CREAM_DIM, display: "flex", transition: "color .2s" }} title={t('show_hide_pwd')}>
                                        {showPwd
                                            ? <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                                            : <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                        }
                                    </button>
                                </div>
                            </div>
                            <button type="submit" className="lx-submit" style={{ background: `linear-gradient(180deg, ${GOLD_BRIGHT}, ${GOLD})`, color: INK, padding: "15px", marginTop: 8, fontSize: 15, fontWeight: 800, borderRadius: 13, border: "none", cursor: "pointer", boxShadow: `0 12px 32px ${GOLD}3d`, transition: "transform .15s, box-shadow .15s", letterSpacing: 0.5, fontFamily: "var(--heading)" }}><span>{t('login_btn')}</span></button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
      </div>
    );
  }

  if (!loaded) return <div className="booting-screen"><div style={{ marginBottom: 24, filter: "drop-shadow(0 10px 24px rgba(109,40,217,0.35))" }}><BrandLogo size={58} /></div><div className="booting-spinner"></div><div style={{animation: 'pulse 2s infinite', fontWeight: 600}}>{t('syncing_cloud')}</div></div>;

  // #7: Lớp phủ hiệu ứng mừng (level-up / band cao) — dùng chung cho mọi màn hình
  const confettiColors = ['#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#0A84FF', '#5856D6', '#FF2D55'];
  const confettiOverlay = showCelebration ? (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 2147483000, overflow: 'hidden' }}>
      {Array.from({ length: 70 }).map((_, i) => {
        const left = (i * 137.5) % 100;
        const delay = (i % 10) * 0.08;
        const dur = 2.6 + (i % 7) * 0.35;
        const w = 7 + (i % 5) * 2;
        return <div key={i} style={{ position: 'absolute', top: '-5vh', left: `${left}%`, width: w, height: w * 0.45, background: confettiColors[i % confettiColors.length], borderRadius: 2, animation: `confettiFall ${dur}s linear ${delay}s forwards` }} />;
      })}
      <div style={{ position: 'absolute', top: '32%', left: 0, right: 0, textAlign: 'center', fontSize: 72, animation: 'celebPop 1.6s ease forwards' }}><Ico name="sparkles" size={64} /></div>
    </div>
  ) : null;

  if (reviewQuiz) {
      let currentContext = "";
      const rvSections = reviewQuiz.quiz.sections || [];
      const rvHasSections = rvSections.length > 1;
      const rvMemberOf: Record<string, number> = {};
      rvSections.forEach((sec, i) => (sec.questions || []).forEach((q: any) => { if (q && q.id != null) rvMemberOf[q.id] = i; }));
      const rvSectionOf = (q: any) => (typeof q.passageIndex === 'number' ? q.passageIndex : (rvMemberOf[q.id] ?? 0));
      const rvActiveIdx = rvHasSections ? Math.min(reviewSectionIdx, rvSections.length - 1) : 0;
      const rvType = String(reviewQuiz.quiz.type || "").toLowerCase();
      const rvIsListeningExam = rvType.includes("listen");
      const rvIsIntegrated = rvType.includes("integrated");
      const rvIsListeningPart = (idx: number) => rvIsListeningExam || (rvIsIntegrated && idx === 0);
      const rvActiveIsListening = rvIsListeningPart(rvActiveIdx);
      const rvUsePartLabels = rvIsListeningExam || rvIsIntegrated;
      // Timestamp trong giải thích AI -> nút bấm tua audio review tới đúng mốc bắt đầu.
      const rvSeek = (tstr: string) => {
          const time = String(tstr).match(/\d{1,2}:\d{2}(?::\d{2})?/)?.[0];
          if (!time) return;
          const p = time.split(':').map(Number);
          const secs = p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
          const el = document.getElementById('review-audio') as HTMLAudioElement | null;
          if (!el) return;
          // Chặn mốc vượt độ dài file (mốc rác) — không tua bậy
          if (el.duration && isFinite(el.duration) && secs > el.duration) return;
          el.currentTime = secs;
          setRvAudioCur(secs);
          void requestReviewAudioPlayback();
      };
      const rvRenderExplain = (txt: string) => {
          const token = /(?:\[|\()\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:-|–|—|to)\s*\d{1,2}:\d{2}(?::\d{2})?)?(?:\]|\))/;
          const parts = String(txt || '').split(new RegExp(`(${token.source})`, 'g'));
          return parts.map((p, pi) => token.test(p)
              ? <button key={pi} onClick={() => rvSeek(p)} title="Bấm để tua audio tới mốc này" aria-label={`Nghe lại từ ${p.match(/\d{1,2}:\d{2}(?::\d{2})?/)?.[0] || 'mốc này'}`} style={{ background: 'none', border: 'none', padding: 0, color: '#d97706', fontWeight: 800, cursor: 'pointer', textDecoration: 'underline', fontSize: 'inherit', fontFamily: 'inherit' }}>{p}</button>
              : <React.Fragment key={pi}>{p}</React.Fragment>);
      };
      return (
          <div style={{ height: "100vh", background: C.bg, color: C.text, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              {globalStyles}
              <div style={{ flex: 'none', background: C.card, padding: "15px 24px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", zIndex: 100 }}>
                  <div style={{fontWeight: 900, fontSize: 18}}>REVIEW: {reviewQuiz.quiz.title}</div>
                  <button onClick={() => setReviewQuiz(null)} style={{background: C.bg, color: C.text, border: `1px solid ${C.border}`, padding: '8px 20px'}}>Back</button>
              </div>
              {rvHasSections && (
                  <div style={{ flex: 'none', display: 'flex', background: C.card, borderBottom: `1px solid ${C.border}`, padding: '0 24px', overflowX: 'auto', zIndex: 90 }}>
                      {rvSections.map((sec, idx) => {
                          const isActive = rvActiveIdx === idx;
                          return (
                              <div key={idx} onClick={() => setReviewSectionIdx(idx)} style={{ flexShrink: 0, padding: '12px 22px', cursor: 'pointer', fontWeight: isActive ? 900 : 600, fontSize: 14, color: isActive ? C.accent : C.sub, borderBottom: isActive ? `3px solid ${C.accent}` : '3px solid transparent', transition: '0.15s', whiteSpace: 'nowrap' }}>
                                  {rvUsePartLabels ? `Part ${idx + 1}` : `Passage ${idx + 1}`}
                              </div>
                          );
                      })}
                  </div>
              )}
              {/* THANH AUDIO DÍNH TRÊN — sao chép phòng thi: play/pause · thời gian · thanh tua · tốc độ; luôn hiện, khỏi cuộn tìm */}
              {rvActiveIsListening && reviewQuiz.quiz.audioUrl && (() => {
                  const src = reviewQuiz.quiz.audioUrl;
                  const safeCur = Math.min(rvAudioCur, rvAudioDur || 0);
                  const pct = rvAudioDur ? (safeCur / rvAudioDur) * 100 : 0;
                  return (
                      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: '9px 24px', background: C.card, borderBottom: `1px solid ${C.border}`, zIndex: 80 }}>
                          <audio id="review-audio" ref={audioRef} preload="auto" playsInline src={src}
                              onContextMenu={(e) => e.preventDefault()}
                              onLoadedMetadata={(e: any) => { const audio = e.currentTarget as HTMLAudioElement; setRvAudioDur(audio.duration || 0); updateExamMediaSessionPosition(audio); }}
                              onTimeUpdate={(e: any) => { const audio = e.currentTarget as HTMLAudioElement; setRvAudioCur(audio.currentTime || 0); updateExamMediaSessionPosition(audio); }}
                              onPlay={(e: any) => recordAudioDiagnostic("play", e.currentTarget as HTMLAudioElement)}
                              onPlaying={handleExamAudioPlaying}
                              onPause={(e: any) => handleExamAudioPause(e.currentTarget as HTMLAudioElement)}
                              onEnded={handleExamAudioEnded}
                              onCanPlay={(e: any) => { const audio = e.currentTarget as HTMLAudioElement; recordAudioDiagnostic("canplay", audio); if (examAudioShouldPlayRef.current && audio.paused) recoverInterruptedExamAudio(audio); }}
                              onWaiting={(e: any) => recordAudioDiagnostic("waiting", e.currentTarget as HTMLAudioElement)}
                              onStalled={(e: any) => recordAudioDiagnostic("stalled", e.currentTarget as HTMLAudioElement)}
                              onSuspend={(e: any) => recordAudioDiagnostic("suspend", e.currentTarget as HTMLAudioElement)}
                              onAbort={(e: any) => recordAudioDiagnostic("abort", e.currentTarget as HTMLAudioElement)}
                              onEmptied={(e: any) => recordAudioDiagnostic("emptied", e.currentTarget as HTMLAudioElement)}
                              onError={(e: any) => handleExamAudioError(e.currentTarget.error)}
                              style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }} />
                          <button title="Play / Pause" onClick={() => { const a = audioRef.current; if (!a) return; if (a.paused) void requestReviewAudioPlayback(); else pauseExamAudioPlayback(); }}
                              style={{ width: 32, height: 32, flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${C.border}`, borderRadius: 5, background: C.bg, color: C.text, cursor: 'pointer', padding: 0 }}>
                              {rvAudioPlaying ? <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg> : <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>}
                          </button>
                          <span style={{ flex: 'none', fontFamily: 'Consolas, monospace', fontSize: 12, color: C.sub }}>{fmtTime(Math.floor(safeCur))}</span>
                          <input type="range" min={0} max={rvAudioDur || 0} step={0.1} value={safeCur}
                              onChange={(e: any) => { const a = audioRef.current; if (a) { a.currentTime = Number(e.target.value); setRvAudioCur(Number(e.target.value)); } }}
                              style={{ flex: 1, height: 4, borderRadius: 2, appearance: 'none', WebkitAppearance: 'none', outline: 'none', cursor: 'pointer', background: `linear-gradient(to right, ${C.accent} 0%, ${C.accent} ${pct}%, ${C.border} ${pct}%, ${C.border} 100%)` }} />
                          <span style={{ flex: 'none', fontFamily: 'Consolas, monospace', fontSize: 12, color: C.sub }}>{fmtTime(Math.floor(rvAudioDur))}</span>
                          <div style={{ display: 'flex', gap: 5, flex: 'none' }}>
                              {[1, 1.25, 1.5, 2].map(r => (
                                  <button key={r} title={`Speed ${r}x`} onClick={() => { setPlaybackRate(r); const a = audioRef.current; if (a) a.playbackRate = r; }}
                                      style={{ border: `1px solid ${playbackRate === r ? C.accent : C.border}`, background: playbackRate === r ? C.accent : C.bg, color: playbackRate === r ? '#fff' : C.sub, fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 4, cursor: 'pointer' }}>{r}×</button>
                              ))}
                          </div>
                      </div>
                  );
              })()}
              {renderMeetAudioNotice()}
              <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                  {!rvActiveIsListening && (() => {
                      const passageHtml = (rvHasSections ? (rvSections[rvActiveIdx]?.passage) : reviewQuiz.quiz.passage) || "";
                      const secQs = rvHasSections ? (rvSections[rvActiveIdx]?.questions || []) : (reviewQuiz.quiz.questions || []);
                      const headingQs = secQs.filter((q: any) => q.type === "DRAG_DROP_HEADING");
                      const hasSlots = headingQs.length > 0 && /\[HEADING_SLOT\]/i.test(passageHtml);
                      const headingOpts: any[] = (headingQs.find((q: any) => q.options && q.options.length)?.options) || [];
                      const rnorm = (v: any) => String(v ?? "").trim().toLowerCase();
                      const headingBody = (roman: string) => {
                          const o = headingOpts.find((opt: any) => {
                              const tt = typeof opt === 'string' ? opt : (opt.text || "");
                              const m = tt.match(/^\s*([ivxlcdm]+)[\.\)]/i);
                              return m && rnorm(m[1]) === rnorm(roman);
                          });
                          const tt = o ? (typeof o === 'string' ? o : (o.text || "")) : "";
                          return tt.replace(/^\s*[ivxlcdm]+[\.\)]\s*/i, '');
                      };
                      return (
                      <div style={{ width: '50%', height: '100%', overflowY: 'auto', padding: "30px 40px", borderRight: `1px solid ${C.border}`, lineHeight: 1.8, fontSize: 16, background: '#fff', color: '#333' }}>
                          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `2px solid ${C.accent}`, marginBottom: 15, paddingBottom: 10}}>
                              <h2 style={{marginTop: 0, color: C.accent, margin: 0}}>{rvIsIntegrated ? `PART ${rvActiveIdx + 1}` : 'READING PASSAGE'}</h2>
                          </div>
                          {/* LIST OF HEADINGS — hiện rõ để đối chiếu (review matching headings) */}
                          {hasSlots && headingOpts.length > 0 && (
                              <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 16px', marginBottom: 18, background: C.bg }}>
                                  <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.sub, marginBottom: 8 }}>List of Headings</div>
                                  {headingOpts.map((opt: any, oi: number) => {
                                      const tt = typeof opt === 'string' ? opt : (opt.text || "");
                                      const m = tt.match(/^\s*([ivxlcdm]+)[\.\)]\s*(.*)/i);
                                      return (
                                          <div key={oi} style={{ display: 'flex', gap: 10, fontSize: 13.5, lineHeight: 1.5, marginBottom: 5 }}>
                                              <span style={{ flexShrink: 0, fontStyle: 'italic', fontWeight: 700, color: C.accent, minWidth: 26 }}>{m ? m[1].toLowerCase() : ''}</span>
                                              <span>{m ? m[2] : tt}</span>
                                          </div>
                                      );
                                  })}
                              </div>
                          )}
                          {reviewQuiz.quiz.images?.map((imgUrl, idx) => <img key={idx} src={imgUrl} alt="Reading passage illustration" style={{maxWidth: '100%', borderRadius: 8, display: 'block', marginBottom: 15}} />)}
                          {hasSlots ? (() => {
                              const chunks = passageHtml.split(/<div[^>]*>\s*\[HEADING_SLOT\]\s*<\/div>|\[HEADING_SLOT\]/gi);
                              return (
                                  <div id="ielts-passage-content" style={{ textAlign: 'justify' }}>
                                      {chunks[0] && chunks[0].trim() && <div style={{ whiteSpace: 'pre-wrap' }} dangerouslySetInnerHTML={{ __html: formatContent(chunks[0]) }} />}
                                      {headingQs.map((hq: any, hi: number) => {
                                          const para = String.fromCharCode(65 + hi);
                                          const placed = reviewQuiz.result.answers?.[hq.id];
                                          const correct = String(hq.correctAnswer || "");
                                          const ok = !!placed && rnorm(placed) === rnorm(correct);
                                          return (
                                              <React.Fragment key={hq.id}>
                                                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, margin: '20px 0 10px', fontSize: 14, lineHeight: 1.4 }}>
                                                      <span style={{ fontWeight: 800, color: C.text, flexShrink: 0 }}>Paragraph {para}</span>
                                                      <span style={{ background: ok ? `${C.succ}1e` : `${C.err}1e`, color: ok ? C.succ : C.err, border: `1px solid ${ok ? C.succ : C.err}`, borderRadius: 6, padding: '3px 9px', fontWeight: 700, fontSize: 12.5 }}>
                                                          Your answer: {placed ? `${String(placed).toLowerCase()} — ${headingBody(String(placed))}` : '—'}
                                                      </span>
                                                      {!ok && (
                                                          <span style={{ background: `${C.accent}1e`, color: C.accent, border: `1px solid ${C.accent}`, borderRadius: 6, padding: '3px 9px', fontWeight: 700, fontSize: 12.5 }}>
                                                              Correct: {correct.toLowerCase()} — {headingBody(correct)}
                                                          </span>
                                                      )}
                                                  </div>
                                                  {chunks[hi + 1] && chunks[hi + 1].trim() && <div style={{ whiteSpace: 'pre-wrap' }} dangerouslySetInnerHTML={{ __html: formatContent(chunks[hi + 1]) }} />}
                                              </React.Fragment>
                                          );
                                      })}
                                  </div>
                              );
                          })() : (
                              <div id="ielts-passage-content" style={{whiteSpace: 'pre-wrap', textAlign: 'justify'}} dangerouslySetInnerHTML={{__html: formatContent(passageHtml)}} />
                          )}
                      </div>
                      );
                  })()}
                  {/* LISTENING: CỘT TRÁI = chỉ text câu hỏi theo section (y chang layout passage|questions của Reading) + nút tải transcript */}
                  {rvActiveIsListening && (() => {
                      let leftCtx = "";
                      const tr = reviewQuiz.quiz.transcript || "";
                      const downloadTranscript = () => {
                          const body = /<[a-z][\s\S]*>/i.test(tr) ? tr : tr.split(/\n+/).map(l => `<p>${l.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</p>`).join('');
                          const html = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word'><head><meta charset='utf-8'><title>Transcript</title></head><body>${body}</body></html>`;
                          const blob = new Blob(['﻿', html], { type: 'application/msword' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a'); a.href = url; a.download = `${(reviewQuiz.quiz.title || 'transcript').replace(/[^\w-]+/g,'_')}_transcript.doc`;
                          document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
                      };
                      let lastBank = "";
                      return (
                          <div className="rv-qview" style={{ width: '50%', height: '100%', overflowY: 'auto', overflowX: 'hidden', padding: '22px 28px', borderRight: `1px solid ${C.border}`, background: '#fff', color: '#333' }}>
                              {/* Read-only, TINH GỌN, KHÔNG TRÀN VIỀN: chống overflow bảng/ảnh + thu nhỏ so với phòng thi vì chỉ có nửa màn hình */}
                              <style>{`
                                .rv-qview, .rv-qview * { box-sizing: border-box; }
                                .rv-qview .group-context, .rv-qview .rv-ql-text { overflow-wrap: anywhere; word-break: break-word; }
                                .rv-qview .group-context { max-width: 100%; overflow-x: auto; font-size: 13.5px; line-height: 1.55; margin-bottom: 12px; }
                                .rv-qview .group-context table { max-width: 100%; border-collapse: collapse; font-size: 12.5px; }
                                .rv-qview .group-context td, .rv-qview .group-context th { border: 1px solid ${C.border}; padding: 4px 7px; }
                                .rv-qview .group-context img { max-width: 100%; height: auto; }
                                .rv-qview .rv-ql { margin-bottom: 13px; }
                                .rv-qview .rv-ql-head { display: flex; gap: 8px; line-height: 1.5; font-size: 13.5px; }
                                .rv-qview .rv-ql-num { font-weight: 800; color: ${C.accent}; flex-shrink: 0; min-width: 20px; }
                                .rv-qview .rv-ql-opts { list-style: none; margin: 6px 0 0 28px; padding: 0; display: flex; flex-direction: column; gap: 5px; }
                                .rv-qview .rv-ql-opt { display: flex; gap: 8px; align-items: flex-start; font-size: 13px; line-height: 1.45; color: #444; }
                                .rv-qview .rv-ql-mark { flex-shrink: 0; width: 15px; height: 15px; border: 1.5px solid #9aa4b2; margin-top: 1px; }
                                .rv-qview .rv-ql-mark.round { border-radius: 50%; }
                                .rv-qview .rv-ql-bank { margin: 6px 0 4px 28px; display: flex; flex-wrap: wrap; gap: 6px; }
                                .rv-qview .rv-ql-tag { border: 1px solid ${C.border}; border-radius: 5px; padding: 3px 9px; font-size: 12.5px; background: ${C.bg}; color: #333; }
                                .rv-qview .rv-ql-blank { display: inline-block; min-width: 30px; padding: 0 8px; border-bottom: 1.5px solid #9aa4b2; color: ${C.accent}; font-weight: 700; text-align: center; }
                              `}</style>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, borderBottom: `2px solid ${C.accent}`, marginBottom: 14, paddingBottom: 10 }}>
                                  <h2 style={{ margin: 0, color: C.accent, fontSize: 16 }}>{rvHasSections ? `PART ${rvActiveIdx + 1} — QUESTIONS` : 'QUESTIONS'}</h2>
                                  {tr ? (
                                      <button onClick={downloadTranscript} style={{ flexShrink: 0, background: C.bg, color: C.text, border: `1px solid ${C.border}`, padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                          Transcript (.doc)
                                      </button>
                                  ) : null}
                              </div>
                              {reviewQuiz.quiz.questions.map((q, i) => {
                                  if (rvHasSections && rvSectionOf(q) !== rvActiveIdx) return null;
                                  const showCtx = q.groupContext && q.groupContext !== leftCtx;
                                  if (showCtx) { leftCtx = q.groupContext as string; lastBank = ""; }
                                  const opts = Array.isArray(q.options) ? q.options : [];
                                  const isMulti = q.type === 'CHOICE_MULTIPLE';
                                  const isMCQ = (q.type === 'CHOICE' || isMulti) && opts.length > 0;
                                  const isBankType = (q.type === 'DRAG_DROP' || q.type === 'MATCHING' || q.type === 'DRAG_DROP_HEADING') && opts.length > 0;
                                  // Kho lựa chọn (matching/drag-drop) DÙNG CHUNG cả nhóm -> chỉ hiện MỘT lần khi options đổi.
                                  const bankKey = isBankType ? JSON.stringify(opts) : "";
                                  const showBank = isBankType && bankKey !== lastBank;
                                  if (showBank) lastBank = bankKey;
                                  // Câu là ô trống inline trong form/context -> đã hiện trong group-context, không lặp text.
                                  const textInCtx = showCtx || (leftCtx && (leftCtx as string).indexOf(`[${i + 1}]`) !== -1);
                                  return (
                                      <React.Fragment key={q.id}>
                                          {showCtx && <div className="group-context" dangerouslySetInnerHTML={{ __html: formatContent(q.groupContext || "") }} />}
                                          {showBank && (
                                              <div className="rv-ql-bank">
                                                  {opts.map((o: any, oi: number) => <span key={oi} className="rv-ql-tag">{String(o).replace(/^\s*[A-Za-z][\.\)]\s*/, '')}</span>)}
                                              </div>
                                          )}
                                          {!textInCtx && (
                                              <div className="rv-ql">
                                                  <div className="rv-ql-head">
                                                      <span className="rv-ql-num">{i + 1}.</span>
                                                      <span className="rv-ql-text" dangerouslySetInnerHTML={{ __html: formatContent(q.text || "") }} />
                                                  </div>
                                                  {isMCQ && (
                                                      <ul className="rv-ql-opts">
                                                          {opts.map((o: any, oi: number) => (
                                                              <li key={oi} className="rv-ql-opt">
                                                                  <span className={`rv-ql-mark ${isMulti ? '' : 'round'}`} />
                                                                  <span dangerouslySetInnerHTML={{ __html: formatContent(String(o).replace(/^\s*[A-Za-z][\.\)]\s*/, '')) }} />
                                                              </li>
                                                          ))}
                                                      </ul>
                                                  )}
                                              </div>
                                          )}
                                      </React.Fragment>
                                  );
                              })}
                          </div>
                      );
                  })()}
                  <div style={{ flex: 1, minWidth: 0, width: '50%', height: '100%', overflowY: 'auto', padding: "30px 40px", background: C.bg }}>
                      
                      {(() => {
                          const rqQuiz = reviewQuiz.quiz;
                          const rqRes = reviewQuiz.result;
                          
                          // Phân tích và tính toán dữ liệu thống kê
                          let correctCount = rqRes.score;
                          let totalQs = rqRes.total;
                          let skippedCount = 0;
                          
                          rqQuiz.questions.forEach(q => {
                              const ans = rqRes.answers[q.id];
                              let isSkipped = false;
                              if (ans === undefined || ans === null || ans === "") isSkipped = true;
                              if (Array.isArray(ans) && ans.length === 0) isSkipped = true;
                              if (isSkipped) skippedCount++;
                          });
                          
                          let incorrectCount = totalQs - correctCount - skippedCount;
                          if (incorrectCount < 0) incorrectCount = 0;
                          
                          const accuracy = ((correctCount / totalQs) * 100).toFixed(1);
                          const bandNum = Number(rqRes.band) || 0;
                          const bandPct = (bandNum / 9) * 100;
                          const durM = Math.floor((rqRes.durationSeconds || 0) / 60);
                          const durS = (rqRes.durationSeconds || 0) % 60;
                          const timeStr = durM > 0 ? `${durM} ${t('acad_min')} ${durS} ${t('acad_sec')}` : `${durS} ${t('acad_sec')}`;

                          return (
                              <>
                                  {/* DASHBOARD THỐNG KÊ TỔNG QUAN (UI MỚI TỪ ẢNH MẪU) */}
                                  <div style={{background: '#fff', borderRadius: 16, marginBottom: 24, boxShadow: '0 4px 20px rgba(0,0,0,0.05)', overflow: 'hidden', border: `1px solid #e2e8f0`}}>
                                      
                                      {/* KHỐI 1: PHẦN KIỂM TRA (TOP) */}
                                      <div style={{padding: '30px 40px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f1f5f9', flexWrap: 'wrap', gap: 20}}>
                                          <div>
                                              <div style={{fontSize: 18, fontWeight: 900, color: '#1e293b', marginBottom: 20}}>{t('rev_test_part')}</div>
                                              <div style={{display: 'flex', gap: 40, flexWrap: 'wrap'}}>
                                                  <div>
                                                      <div style={{fontSize: 12, color: '#64748b', marginBottom: 4}}>{t('rev_part')}</div>
                                                      <div style={{fontWeight: 700, color: '#334155', fontSize: 14}}>{rqQuiz.title}</div>
                                                  </div>
                                                  <div>
                                                      <div style={{fontSize: 12, color: '#64748b', marginBottom: 4}}>{t('rev_mcq')}</div>
                                                      <div style={{fontWeight: 700, color: '#334155', fontSize: 14}}>{correctCount}/{totalQs}</div>
                                                  </div>
                                                  <div>
                                                      <div style={{fontSize: 12, color: '#64748b', marginBottom: 4}}>{t('rev_total_band')}</div>
                                                      <div style={{fontWeight: 700, color: '#334155', fontSize: 14}}>{rqRes.band}</div>
                                                  </div>
                                              </div>
                                          </div>
                                          
                                          {/* Vòng tròn điểm (Donut Chart CSS) */}
                                          <div style={{position: 'relative', width: 120, height: 120, borderRadius: '50%', background: `conic-gradient(#facc15 ${bandPct}%, #e2e8f0 0)`, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                                              <div style={{width: 90, height: 90, background: '#fff', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 900, color: '#eab308'}}>
                                                  {rqRes.band}
                                              </div>
                                          </div>
                                      </div>

                                      {/* KHỐI 2: CHI TIẾT BÀI THI (BOTTOM) */}
                                      <div style={{padding: '30px 40px', background: '#f8fafc'}}>
                                          <div style={{fontSize: 16, fontWeight: 800, color: '#1e293b', marginBottom: 20}}>{t('rev_detail')}</div>
                                          <div style={{display: 'flex', gap: 24, flexWrap: 'wrap'}}>
                                              
                                              {/* 3 Cột icon tròn (Đúng / Sai / Bỏ qua) */}
                                              <div style={{flex: 1, display: 'flex', justifyContent: 'space-around', background: '#fff', padding: '24px 20px', borderRadius: 12, border: '1px solid #e2e8f0', minWidth: 300}}>
                                                  <div style={{textAlign: 'center'}}>
                                                      <div style={{width: 48, height: 48, background: '#22c55e', color: '#fff', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 10px'}}>
                                                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                                      </div>
                                                      <div style={{fontSize: 13, color: '#22c55e', fontWeight: 600}}>{t('rev_correct')}</div>
                                                      <div style={{fontSize: 15, fontWeight: 800, color: '#1e293b', marginTop: 4}}>{correctCount} {t('rev_questions_unit')}</div>
                                                  </div>
                                                  <div style={{textAlign: 'center'}}>
                                                      <div style={{width: 48, height: 48, background: '#ef4444', color: '#fff', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 10px'}}>
                                                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                                      </div>
                                                      <div style={{fontSize: 13, color: '#ef4444', fontWeight: 600}}>{t('rev_incorrect')}</div>
                                                      <div style={{fontSize: 15, fontWeight: 800, color: '#1e293b', marginTop: 4}}>{incorrectCount} {t('rev_questions_unit')}</div>
                                                  </div>
                                                  <div style={{textAlign: 'center'}}>
                                                      <div style={{width: 48, height: 48, background: '#f97316', color: '#fff', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 10px'}}>
                                                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" y1="5" x2="19" y2="19"></line></svg>
                                                      </div>
                                                      <div style={{fontSize: 13, color: '#f97316', fontWeight: 600}}>{t('rev_skipped')}</div>
                                                      <div style={{fontSize: 15, fontWeight: 800, color: '#1e293b', marginTop: 4}}>{skippedCount} {t('rev_questions_unit')}</div>
                                                  </div>
                                              </div>

                                              {/* Lưới thông tin phụ (Grid 2x2) */}
                                              <div style={{flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, background: '#fff', padding: '24px', borderRadius: 12, border: '1px solid #e2e8f0', minWidth: 300}}>
                                                  <div style={{display: 'flex', alignItems: 'flex-start', gap: 12}}>
                                                      <div style={{color: '#1e293b', background: '#f1f5f9', padding: 8, borderRadius: 8}}><Ico name="clipboard" size={18} /></div>
                                                      <div>
                                                          <div style={{fontSize: 12, color: '#64748b', fontWeight: 600}}>{t('rev_result')}</div>
                                                          <div style={{fontSize: 14, fontWeight: 800, color: '#1e293b', marginTop: 2}}>{correctCount}/{totalQs} {t('rev_questions_unit')}</div>
                                                      </div>
                                                  </div>
                                                  <div style={{display: 'flex', alignItems: 'flex-start', gap: 12}}>
                                                      <div style={{color: '#1e293b', background: '#f1f5f9', padding: 8, borderRadius: 8}}><Ico name="clock" size={18} /></div>
                                                      <div>
                                                          <div style={{fontSize: 12, color: '#64748b', fontWeight: 600}}>{t('rev_time')}</div>
                                                          <div style={{fontSize: 14, fontWeight: 800, color: '#1e293b', marginTop: 2}}>{timeStr}</div>
                                                      </div>
                                                  </div>
                                                  <div style={{display: 'flex', alignItems: 'flex-start', gap: 12}}>
                                                      <div style={{color: '#1e293b', background: '#f1f5f9', padding: 8, borderRadius: 8}}><Ico name="target" size={18} /></div>
                                                      <div>
                                                          <div style={{fontSize: 12, color: '#64748b', fontWeight: 600}}>{t('rev_accuracy')}</div>
                                                          <div style={{fontSize: 14, fontWeight: 800, color: '#1e293b', marginTop: 2}}>{accuracy}%</div>
                                                      </div>
                                                  </div>
                                                  <div style={{display: 'flex', alignItems: 'flex-start', gap: 12}}>
                                                      <div style={{color: '#1e293b', background: '#f1f5f9', padding: 8, borderRadius: 8}}><Ico name="check" size={18} /></div>
                                                      <div>
                                                          <div style={{fontSize: 12, color: '#64748b', fontWeight: 600}}>{t('rev_correct_count')}</div>
                                                          <div style={{fontSize: 14, fontWeight: 800, color: '#1e293b', marginTop: 2}}>{correctCount} / {totalQs} {t('rev_questions_unit')}</div>
                                                      </div>
                                                  </div>
                                              </div>
                                          </div>
                                      </div>
                                  </div>

                                  {/* CÁC THÔNG TIN BỔ SUNG (Audio, Feedback, Flagged, Scratchpad, Weakness Analysis) */}
                                  <div style={{background: '#fff', padding: '30px 40px', borderRadius: 16, marginBottom: 24, border: `1px solid #e2e8f0`, boxShadow: '0 4px 20px rgba(0,0,0,0.02)'}}>
                                      
                                      {rqRes.teacherFeedback && <div style={{marginBottom: 15, background: `#fffbeb`, border: '1px solid #fde68a', color: '#92400e', padding: 16, borderRadius: 12, fontSize: 14}}><b style={{color: '#b45309'}}><Ico name="chat" size={15} style={{verticalAlign:'-2px',marginRight:6,display:'inline-block'}} />Teacher's feedback:</b><br/>{rqRes.teacherFeedback}</div>}
                                      
                                      {rqRes.flaggedQuestions && rqRes.flaggedQuestions.length > 0 && (
                                          <div style={{marginBottom: 15, color: '#ef4444', fontSize: 14, background: '#fef2f2', border: '1px solid #fecaca', padding: 16, borderRadius: 12}}>
                                              <b style={{color: '#b91c1c'}}><Ico name="pin" size={15} style={{verticalAlign:'-2px',marginRight:6,display:'inline-block'}} />Flagged questions during exam:</b> {rqRes.flaggedQuestions.map((id: string) => rqQuiz.questions.findIndex(q=>q.id===id)+1).join(', ')}
                                          </div>
                                      )}
                                      
                                      {rqRes.scratchpad && (
                                          <div style={{marginBottom: 20, background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534', padding: 16, borderRadius: 12, fontSize: 14, whiteSpace: 'pre-wrap'}}>
                                              <b style={{color: '#15803d'}}> Your notes:</b><br/>{rqRes.scratchpad}
                                          </div>
                                      )}

                                      <div style={{marginTop: 10}}>
                                          <div style={{fontSize: 14, fontWeight: 800, marginBottom: 15, color: '#1e293b'}}><Ico name="barChart" size={15} style={{verticalAlign:'-2px',marginRight:6,display:'inline-block'}} />WEAKNESS ANALYSIS BY TYPE</div>
                                          <div style={{display: 'flex', gap: 15, flexWrap: 'wrap'}}>
                                              {(() => {
                                                  const groups: Record<string, QuizQuestion[]> = {};
                                                  rqQuiz.questions.forEach(q => {
                                                      const label = q.subType || (q.type === 'CHOICE' ? 'Multiple Choice' : 'Sentence Completion');
                                                      if (!groups[label]) groups[label] = [];
                                                      groups[label].push(q);
                                                  });
                                                  return Object.entries(groups).map(([label, typeQs]) => {
                                                      let correctInType = 0;
                                                      typeQs.forEach(q => {
                                                          const sAns = rqRes.answers[q.id];
                                                          if ((q.type === "CHOICE" || q.type === "MATCHING") && sAns === q.correctAnswer) correctInType++;
                                                          else if (q.type === "CHOICE_MULTIPLE") {
                                                              const correctArr = Array.isArray(q.correctAnswer) ? q.correctAnswer : [q.correctAnswer];
                                                              if (sAns !== undefined && sAns !== "" && correctArr.includes(Number(sAns))) correctInType++;
                                                          }
                                                          else if (sAns !== undefined && sAns !== null) {
                                                              if (String(q.correctAnswer).split("/").map(s => s.trim().toLowerCase()).includes(String(sAns).trim().toLowerCase())) correctInType++;
                                                          }
                                                      });
                                                      const rate = Math.round((correctInType / typeQs.length) * 100);
                                                      return (
                                                          <div key={label} style={{flex: '1 1 calc(50% - 15px)', minWidth: 160, background: '#f8fafc', padding: 16, borderRadius: 12, border: `1px solid #e2e8f0`}}>
                                                              <div style={{fontSize: 12, color: '#64748b', fontWeight: 700, textTransform: 'uppercase'}}>{label}</div>
                                                              <div style={{fontSize: 18, fontWeight: 900, marginTop: 4, color: rate >= 70 ? '#22c55e' : '#ef4444'}}>{correctInType}/{typeQs.length} ({rate}%)</div>
                                                          </div>
                                                      );
                                                  });
                                              })()}
                                          </div>
                                      </div>
                                  </div>
                              </>
                          );
                      })()}
                      
                      {reviewQuiz.quiz.questions.map((q, i) => {
                          if (rvHasSections && rvSectionOf(q) !== rvActiveIdx) return null;
                          const studentAns = (reviewQuiz.result.answers && reviewQuiz.result.answers[q.id] !== undefined) ? reviewQuiz.result.answers[q.id] : undefined;
                          let isCorrect = false;
                              let correctDisplay: string | number = String(q.correctAnswer);
                              
                              if (q.type === "CHOICE" || q.type === "MATCHING") {
                                  isCorrect = studentAns === q.correctAnswer;
                                  correctDisplay = q.options ? q.options[q.correctAnswer as number] : String(q.correctAnswer);
                              } else if (q.type === "CHOICE_MULTIPLE") {
                                  const correctArr = Array.isArray(q.correctAnswer) ? q.correctAnswer : [q.correctAnswer];
                                  isCorrect = studentAns !== undefined && studentAns !== "" && correctArr.includes(Number(studentAns));
                                  correctDisplay = correctArr.map((idx: any) => q.options ? q.options[idx] : idx).join(" / ");
                              } else {
                                  const sA = String(studentAns || "").trim().toLowerCase();
                                  const cA = String(q.correctAnswer).split("/").map(s => s.trim().toLowerCase());
                                  isCorrect = cA.includes(sA);
                              }

                          const showContext = q.groupContext && q.groupContext !== currentContext;
                          if (showContext) currentContext = q.groupContext as string;

                          // === HIỆN ĐỦ LỰA CHỌN + đánh dấu đúng/sai (MCQ, matching heading) ===
                          const rvOpts = Array.isArray(q.options) ? q.options : [];
                          const rvShowOpts = rvOpts.length > 0 && ["CHOICE", "CHOICE_MULTIPLE", "MATCHING", "DRAG_DROP_HEADING"].includes(q.type);
                          const rvIsMulti = q.type === "CHOICE_MULTIPLE";
                          const rvNorm = (v: any) => String(v ?? "").trim().toLowerCase();
                          const rvCMulti = rvIsMulti ? (Array.isArray(q.correctAnswer) ? q.correctAnswer : [q.correctAnswer]).map(Number) : [];
                          const rvSMulti = rvIsMulti ? (Array.isArray(studentAns) ? studentAns.map(Number) : (studentAns !== undefined && studentAns !== "" ? [Number(studentAns)] : [])) : [];
                          const rvOptMark = (oi: number, otext: string) => {
                              if (q.type === "CHOICE" || q.type === "MATCHING") return { correct: Number(q.correctAnswer) === oi, chosen: studentAns !== undefined && studentAns !== "" && Number(studentAns) === oi };
                              if (rvIsMulti) return { correct: rvCMulti.includes(oi), chosen: rvSMulti.includes(oi) };
                              const lab = (otext.match(/^\s*([ivxlcdm]+|[A-Za-z])[\.\)]/i) || [])[1];
                              return { correct: !!lab && rvNorm(q.correctAnswer) === rvNorm(lab), chosen: !!lab && rvNorm(studentAns) === rvNorm(lab) };
                          };
                          return (
                          <React.Fragment key={q.id}>
                              {showContext && <div className="group-context" dangerouslySetInnerHTML={{__html: formatContent(q.groupContext || "")}} />}
                              <div className="card" style={{marginBottom: 20, borderLeft: `5px solid ${isCorrect ? C.succ : C.err}`}}>
                                  <div style={{fontWeight: 800, marginBottom: 12}}>Question {i+1}: <span style={{fontWeight: 500}} dangerouslySetInnerHTML={{__html: formatContent(q.text)}} /></div>
                                  {rvShowOpts ? (
                                      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
                                          {rvOpts.map((o: any, oi: number) => {
                                              const { correct, chosen } = rvOptMark(oi, String(o));
                                              const bd = correct ? C.succ : (chosen ? C.err : C.border);
                                              const bg = correct ? `${C.succ}14` : (chosen ? `${C.err}12` : 'transparent');
                                              const clean = String(o).replace(/^\s*([ivxlcdm]+|[A-Za-z]{1,3})[\.\)]\s*/i, '');
                                              return (
                                                  <li key={oi} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 11px', borderRadius: 8, border: `1px solid ${bd}`, background: bg, fontSize: 14, lineHeight: 1.5 }}>
                                                      <span style={{ flexShrink: 0, marginTop: 1, color: correct ? C.succ : (chosen ? C.err : C.sub) }}>
                                                          {correct
                                                              ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                                                              : (chosen
                                                                  ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                                                  : <span style={{ display: 'inline-block', width: 15, height: 15, border: `1.5px solid ${C.border}`, borderRadius: rvIsMulti ? 3 : '50%' }} />)}
                                                      </span>
                                                      <span style={{ flex: 1, color: C.text }} dangerouslySetInnerHTML={{ __html: formatContent(clean) }} />
                                                      {chosen && <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 800, color: correct ? C.succ : C.err, alignSelf: 'center', whiteSpace: 'nowrap' }}>Your answer</span>}
                                                      {correct && !chosen && <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 800, color: C.succ, alignSelf: 'center', whiteSpace: 'nowrap' }}>Correct</span>}
                                                  </li>
                                              );
                                          })}
                                      </ul>
                                  ) : (
                                  <div style={{display:'flex', gap: 10, fontSize: 14, flexWrap: 'wrap'}}>
                                      <div style={{background: isCorrect ? `${C.succ}20` : `${C.err}20`, color: isCorrect ? C.succ : C.err, padding: '8px 12px', borderRadius: 6, flex: 1, minWidth: 140}}>
                                          <b>Your answer:</b> {(studentAns === undefined || studentAns === "" || (Array.isArray(studentAns) && studentAns.length === 0)) ? "No answer" : String(studentAns)}
                                      </div>
                                      {!isCorrect && (
                                          <div style={{background: `${C.accent}20`, color: C.accent, padding: '8px 12px', borderRadius: 6, flex: 1, minWidth: 140}}>
                                              <b>Correct answer:</b> {correctDisplay}
                                          </div>
                                      )}
                                  </div>
                                  )}
                                  {!isCorrect && (
                                      <div style={{marginTop: 12}}>
                                          {!explainMap[q.id] ? (
                                              <button onClick={() => handleAiExplain(q, studentAns, reviewQuiz.quiz)} style={{background: 'linear-gradient(135deg,#8b5cf6,#6366f1)', color: '#fff', fontSize: 12, fontWeight: 800, padding: '6px 14px', borderRadius: 8}}><Ico name="bulb" size={15} style={{verticalAlign:'-2px',marginRight:6,display:'inline-block'}} />{t('explain_why')}</button>
                                          ) : explainMap[q.id].loading ? (
                                              <div style={{fontSize: 13, color: C.sub, fontWeight: 600}}><Ico name="refresh" size={14} style={{verticalAlign:'-2px',marginRight:6,display:'inline-block'}} />{t('explain_loading')}</div>
                                          ) : (
                                              <div style={{background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 10, padding: '12px 14px', fontSize: 13.5, lineHeight: 1.6, color: '#1e293b', whiteSpace: 'pre-line'}}>
                                                  <b style={{color: '#6d28d9'}}><Ico name="bulb" size={15} style={{verticalAlign:'-2px',marginRight:6,display:'inline-block'}} />{t('explain_title')}:</b><br/>{rvRenderExplain(explainMap[q.id].text)}
                                              </div>
                                          )}
                                      </div>
                                  )}
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
                          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 1 }}><Ico name="alert" size={14} style={{verticalAlign:'-2px',margin:'0 6px 0 0',display:'inline-block'}} />{t('seb_title')}</h2>
                      </div>
                      <div style={{ padding: '30px', fontSize: 15, lineHeight: 1.6, color: '#333' }}>
                          <p style={{ marginTop: 0, fontWeight: 700, fontSize: 16 }}>{t('seb_intro_a')} <span style={{ color: '#0969da' }}>"{sebGuideQuiz.title}"</span> {t('seb_intro_b')}</p>

                          <div style={{ background: '#fff3cd', border: '1px solid #ffe69c', padding: 20, borderRadius: 8, marginTop: 20 }}>
                              <div style={{ fontWeight: 900, color: '#856404', marginBottom: 15, fontSize: 16 }}><Ico name="wrench" size={14} style={{verticalAlign:'-2px',margin:'0 6px 0 0',display:'inline-block'}} />{t('seb_steps_header')}</div>
                              <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 12, color: '#664d03' }}>
                                  <li><b>Tải phần mềm gốc:</b> Truy cập trang web chính thức <a href="https://safeexambrowser.org/download_en.html" target="_blank" rel="noreferrer" style={{ color: '#0969da', fontWeight: 'bold', textDecoration: 'underline' }}>safeexambrowser.org</a> để tải và cài đặt phiên bản SEB phù hợp cho máy tính của bạn (Windows hoặc macOS).</li>
                                  <li><b>Tải file phòng thi:</b> Bấm "Đã hiểu và quay lại" để đóng thông báo này. Chuyển sang Tab <b>Kho Tài Liệu (Drive)</b> trên hệ thống IELTS OS. Tìm và tải file cấu hình đuôi <b>.seb</b> (VD: <i>IELTS_OS.seb</i>) mà giáo viên đã cung cấp.</li>
                                  <li><b>Đóng ứng dụng:</b> Tắt tất cả các phần mềm nhắn tin, trình duyệt khác, hoặc phần mềm quay màn hình đang chạy trên máy tính.</li>
                                  <li><b>Kích hoạt:</b> Nhấn đúp chuột vào file <b>.seb</b> vừa tải về. SEB sẽ tự động khởi động, khóa máy tính và đưa bạn thẳng vào không gian thi an toàn. Bắt đầu đăng nhập và thi như bình thường.</li>
                              </ol>
                          </div>
                      </div>
                      <div style={{ padding: '20px 30px', background: '#f8f9fa', borderTop: `1px solid #d1d5db`, display: 'flex', justifyContent: 'center' }}>
                          <button onClick={() => setSebGuideQuiz(null)} style={{ background: '#343a40', color: '#fff', padding: '12px 40px', fontWeight: 800, fontSize: 15, borderRadius: 4, border: 'none', cursor: 'pointer', transition: '0.2s' }}>{t('seb_back_btn')}</button>
                      </div>
                  </div>
              </div>
          );
      }
      if (pendingExamState) {
          const q = pendingExamState.quiz;
          const isListeningExam = String(q.type).toLowerCase().includes("listen");
          return (
              <div style={{ height: "100vh", background: '#fff', color: '#24292f', display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: 'Arial, Helvetica, sans-serif' }}>
                  <style>{`
                      @keyframes idp-spin { to { transform: rotate(360deg); } }
                      .idp-spinner { width: 48px; height: 48px; border: 4px solid #e0e0e0; border-top-color: #111; border-radius: 50%; animation: idp-spin 0.8s linear infinite; margin: 0 auto 24px; }
                      .idp-start-btn { background: #111; color: #fff; border: none; border-radius: 3px; padding: 13px 44px; font-size: 15px; font-weight: 700; cursor: pointer; transition: background 0.15s; letter-spacing: 0.3px; }
                      .idp-start-btn:hover { background: #333; }
                      .idp-back-btn { background: transparent; color: #57606a; border: 1px solid #d1d5db; border-radius: 3px; padding: 13px 28px; font-size: 15px; font-weight: 600; cursor: pointer; transition: background 0.1s; }
                      .idp-back-btn:hover { background: #f4f5f7; }
                  `}</style>
                  <div style={{ background: '#fff', maxWidth: 720, width: '100%', border: '1px solid #d1d5db', boxShadow: '0 4px 24px rgba(0,0,0,0.10)', display: 'flex', flexDirection: 'column', maxHeight: '92vh' }}>
                      {/* Header bar — IDP style */}
                      <div style={{ background: '#24292f', padding: '20px 32px', color: '#fff', display: 'flex', alignItems: 'center', gap: 16 }}>
                          <img src="https://d2snzxottmona5.cloudfront.net/releases/3.60.0/images/logo/ielts.svg" alt="IELTS" style={{ height: 22, userSelect: 'none', flexShrink: 0 }} />
                          <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.2)', flexShrink: 0 }}></div>
                          <div>
                              <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.3 }}>{q.title}</div>
                              <div style={{ fontSize: 12, opacity: 0.6, marginTop: 2 }}>{isListeningExam ? 'Listening Test' : 'Academic Reading Test'} · {q.timeLimit} min · {(q.questions || []).length} questions</div>
                          </div>
                      </div>

                      {/* Body */}
                      <div className="instructions-content" style={{ padding: '32px', overflowY: 'auto', flex: 1, fontSize: 15, lineHeight: 1.7, color: '#24292f' }}>
                      <div style={{ textAlign: 'center', padding: '0 0 32px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                          {!isOfflineReady ? (
                              <>
                                  <div className="idp-spinner"></div>
                                  <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8, color: '#24292f' }}>{t('pend_loading')}</div>
                                  <div style={{ fontSize: 14, color: '#57606a' }}>{t('pend_loading_desc')}</div>
                              </>
                          ) : (
                              <>
                                  <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#2da44e', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 900, margin: '0 auto 16px' }}><Ico name="check" size={24} /></div>
                                  <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8, color: '#24292f' }}>{t('pend_loaded')}</div>
                                  <div style={{ fontSize: 14, color: '#57606a' }}>{t('pend_loaded_desc')}</div>
                              </>
                          )}
                      </div>
                      <hr style={{ border: 'none', borderTop: '1px solid #d1d5db', margin: '0 0 24px' }} />

                      {(q as any).frontInstructions ? (
                          <div dangerouslySetInnerHTML={{ __html: formatContent((q as any).frontInstructions) }} />
                      ) : (
                          <div style={{ fontSize: 14, color: '#24292f', lineHeight: 1.8 }}>
                              <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 12 }}>Instructions to Candidates</div>
                              <ul style={{ margin: 0, paddingLeft: 22, display: 'flex', flexDirection: 'column', gap: 7, color: '#333' }}>
                                  <li>Answer <strong>all</strong> the questions.</li>
                                  <li>You can change your answers at any time during the test.</li>
                                  {isListeningExam && <li>You will hear the recording <strong>once only</strong>. You cannot pause or rewind the audio.</li>}
                                  <li><strong>Time allowed:</strong> {q.timeLimit} minutes</li>
                                  <li>Do <strong>not</strong> refresh or close the browser window during the test.</li>
                              </ul>
                          </div>
                      )}
                  </div>

                  <div style={{ padding: '18px 32px', background: '#f4f5f7', borderTop: '1px solid #d1d5db', display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                      <button className="idp-back-btn" onClick={() => setPendingExamState(null)}>Back</button>
                      <button className="idp-start-btn" disabled={!isOfflineReady} style={{ opacity: isOfflineReady ? 1 : 0.5, cursor: isOfflineReady ? 'pointer' : 'not-allowed' }} onClick={() => {
                          if (!isOfflineReady) return;
                          const { quiz, isPreview, isStudentTestUI } = pendingExamState;
                          setPendingExamState(null);
                          confirmStartExam(quiz, isPreview, isStudentTestUI);
                      }}>
                          {isListeningExam ? <span style={{display:'inline-flex',alignItems:'center',gap:6}}><Ico name="play" size={14} /> Start Test</span> : 'Start Test'}
                      </button>
                  </div>
                  </div>
              </div>
          );
      }

      if (activeExam) {
          const isIntegrated = activeExam.type === "Integrated";
          // Đã fix: Chỉ Part 1 (index 0) của Integrated mới full màn hình như Listening, các Part còn lại tự động chia 2 cột.
          const isListening = String(activeExam.type).toLowerCase().includes("listen") || (isIntegrated && currentSectionIndex === 0);
          const isTimeRunningOut = examTimeLeft < 300; 

          const getNavigatorGroups = () => {
              const qs = activeExam?.questions;
              if (!Array.isArray(qs) || qs.length === 0) return [];
              const totalQs = qs.length;
              const groups: { title: string, questions: any[], startIndex: number }[] = [];
              
              // Tự động chia nhóm Sa bàn theo các Section (Passage) do Backend trả về
              if (activeExam?.sections && activeExam.sections.length > 0) {
                  let startIndex = 0;
                  const secPrefix = isListening ? "Part" : (isIntegrated ? "Part" : "Passage");
                  return activeExam.sections.map((sec, i) => {
                      const group = { title: `${secPrefix} ${i+1}`, questions: sec.questions, startIndex };
                      startIndex += sec.questions.length;
                      return group;
                  });
              }

              if (isIntegrated) {
                  groups.push({ title: "Part 1", questions: qs.slice(0, 10), startIndex: 0 });
                  if (totalQs > 10) groups.push({ title: "Part 2", questions: qs.slice(10, 50), startIndex: 10 });
                  if (totalQs > 50) groups.push({ title: "Part 3", questions: qs.slice(50), startIndex: 50 });
                  return groups;
              }

              if (!isListening && totalQs === 40) {
                  groups.push({ title: "Passage 1", questions: qs.slice(0, 13), startIndex: 0 });
                  groups.push({ title: "Passage 2", questions: qs.slice(13, 26), startIndex: 13 });
                  groups.push({ title: "Passage 3", questions: qs.slice(26, 40), startIndex: 26 });
                  return groups;
              }
              let chunkSize = 10;
              let prefix = isListening ? "Part" : (totalQs > 40 && totalQs <= 50 ? "Part" : "Group");
              if (totalQs <= 20) chunkSize = 5;
              for (let i = 0; i < totalQs; i += chunkSize) {
                  const end = Math.min(i + chunkSize, totalQs);
                  groups.push({ title: `${prefix} ${Math.floor(i / chunkSize) + 1}`, questions: qs.slice(i, end), startIndex: i });
              }
              return groups;
          };
          const navGroups = getNavigatorGroups();

          // Tìm DOM element của 1 câu hỏi (card có id, HOẶC input/span inline có data-qid)
          const findQuestionEl = (id: string): HTMLElement | null =>
              (document.getElementById(`question-${id}`) as HTMLElement | null)
              || (document.querySelector(`[data-qid="${id}"]`) as HTMLElement | null);

          // "Câu đang làm" = câu user vừa tương tác (focus/click). CHỈ câu này mới có ô vuông xanh dương ở nav.
          const markCurrentFromEvent = (e: any) => {
              const t = e.target;
              if (!t || !t.closest) return;
              const withQid = t.closest('[data-qid]');
              let id = withQid ? withQid.getAttribute('data-qid') : null;
              if (!id) { const card = t.closest('[id^="question-"]'); if (card && card.id) id = card.id.slice(9); }
              if (id) setExamCurrentQId(id);
          };

          // Viền vàng flash mượt đánh dấu câu vừa nhảy tới (cả input inline)
          const flashQuestion = (id: string) => {
              const el = findQuestionEl(id);
              if (!el) return;
              el.classList.remove('idp-q-focus-flash');
              void el.offsetWidth; // ép reflow để chạy lại animation
              el.classList.add('idp-q-focus-flash');
              window.setTimeout(() => el.classList.remove('idp-q-focus-flash'), 1700);
          };

          // Chuyển câu trước/sau theo DANH SÁCH CÂU của section đang xem (chạy cả inline input)
          const navigateQuestion = (dir: number) => {
              const grp = navGroups[currentSectionIndex];
              if (!grp || !grp.questions.length) return;
              const ids = grp.questions.map((q: any) => q.id);
              let idx = ids.indexOf(examCurrentQId);
              if (idx === -1) idx = (dir > 0 ? -1 : 0);
              const next = Math.max(0, Math.min(ids.length - 1, idx + dir));
              const targetId = ids[next];
              const el = findQuestionEl(targetId);
              if (el) {
                  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  setExamCurrentQId(targetId);
                  flashQuestion(targetId);
              }
          };

          const idpC = {
              bg: "#ffffff", panelBg: "#f4f5f7", border: "#d1d5db", text: "#24292f", sub: "#57606a",
              accent: "#d32f2f", blueAccent: "#0969da", succ: "#2da44e", warn: "#bf8700"
          };

          const renderSafeHTML = (raw: string | undefined) => {
              if (!raw) return "";
              return (raw.includes('student-highlight') || raw.includes('student-note-hl')) ? sanitizeRichHtml(raw) : formatContent(raw);
          };

          // syncHighlightState: DÙNG BẢN CANONICAL ở App.template (đã có nhánh sections + mirror sections[].questions).

          // ĐàXÓA MỘT CÁCH TRIỆT ĐỂ handleLocalHighlight ĐỂ NHƯỜNG CHỖ CHO TÍNH NĂNG POPUP 2 LỰA CHỌN

          const processedContexts = examProcessedContexts;

          // ==========================================
          // ĐàFIX: MERGE QUESTION & INLINE INPUT RENDER
          // ==========================================
         // ==========================================
          // ĐàFIX: Render từng câu riêng biệt, không gộp. 
          // Hỗ trợ highlight Multiple Choice và gỡ Flex wrap phá layout.
          // ==========================================
          // ==========================================
          // ĐàFIX: Khôi phục gộp các câu CHOICE_MULTIPLE liên tiếp (VD: 27-28)
          // ==========================================
          const renderQuestionsList = (group: any, injectedList: string[] = []) => {
              // Ô co giãn theo nhóm (đáp án DÀI NHẤT + nới thêm) cho input standalone/inline trong card.
              const _rA = group.questions.filter((q: any) => q.type === 'BLANK').map((q: any) => String(q.correctAnswer || "")).filter((s: string) => s.length > 0);
              const _rVarLen = (s: string) => Math.max(...s.split('/').map((v: string) => v.trim().length), 0);
              const _rMax = _rA.length ? Math.max(..._rA.map(_rVarLen)) : 10;
              const rInputW = Math.max(70, Math.min(320, Math.round(_rMax * 9) + 30));
              const mergedQs: any[] = [];
              for (let i = 0; i < group.questions.length; i++) {
                  const q = group.questions[i];
                  if (q.type === 'CHOICE_MULTIPLE') {
                      let j = i + 1;
                      const sharedIds = [q.id];
                      while (j < group.questions.length && group.questions[j].type === 'CHOICE_MULTIPLE' && JSON.stringify(group.questions[j].options) === JSON.stringify(q.options)) {
                          sharedIds.push(group.questions[j].id);
                          j++;
                      }
                      if (sharedIds.length > 1) {
                          mergedQs.push({ ...q, isMerged: true, mergedIds: sharedIds });
                          i = j - 1;
                          continue;
                      }
                  }
                  mergedQs.push(q);
              }

              return mergedQs.map((q: any) => {
                  const isMerged = q.isMerged;
                  const qIds = isMerged ? q.mergedIds : [q.id];
                  const allExamQuestions = activeExam.questions || [];
                  const firstGlobalIdx = getQuizQuestionNumber(allExamQuestions, qIds[0]);
                  const lastQForLabel = allExamQuestions.find((x: any) => x.id === qIds[qIds.length - 1]) || q;
                  const lastGlobalIdx = getQuizQuestionNumber(allExamQuestions, qIds[qIds.length - 1]) + getQuestionPointCount(lastQForLabel) - 1;
                  const numberLabel = lastGlobalIdx > firstGlobalIdx ? `${firstGlobalIdx}-${lastGlobalIdx}` : `${firstGlobalIdx}`;
                  
                  const isAnswered = isMerged 
                      ? qIds.some((id: string) => { const a = examAnswers[id]; return Array.isArray(a) ? a.length > 0 : (a !== undefined && a !== ""); })
                      : Array.isArray(examAnswers[q.id]) ? examAnswers[q.id].length > 0 : (examAnswers[q.id] !== undefined && examAnswers[q.id] !== "");

                  // Ô vuông xanh quanh SỐ CÂU chỉ hiện ở câu ĐANG LÀM (không phải câu đã trả lời).
                  const isCurrentQ = !!examCurrentQId && qIds.includes(examCurrentQId);

                  const isInjectedIntoContext = injectedList.some(id => qIds.includes(id));
                  const qTextData = processedContexts.qTexts[q.id] || { html: renderSafeHTML(q.text), inlineInjected: false };
                  const isInlineInjected = qTextData.inlineInjected || false;
                  if ((q.type === "BLANK" || q.type === "DRAG_DROP") && isInjectedIntoContext) return null;
                  
                  const isBlankType = q.type === "BLANK" || q.type === "DRAG_DROP";
                  const tfngSource = `${q.subType || ""} ${q.text || ""} ${q.instruction || ""}`;
                  const isTFNGQuestion =
                      q.subType === "True/False/Not Given" ||
                      /true\s*\/\s*false\s*\/\s*not\s*given/i.test(tfngSource) ||
                      /\btrue\b[\s\S]*\bfalse\b[\s\S]*\bnot\s+given\b/i.test(tfngSource);
                  const isYNNGQuestion =
                      q.subType === "Yes/No/Not Given" ||
                      /yes\s*\/\s*no\s*\/\s*not\s*given/i.test(tfngSource) ||
                      /\byes\b[\s\S]*\bno\b[\s\S]*\bnot\s+given\b/i.test(tfngSource);
                  // Fill-in-blank thật (số đã hiện trong ô input) -> BỎ số tròn đầu dòng (kế thừa reading).
                  const isFillBlank = q.type === "BLANK" && !isTFNGQuestion && !isYNNGQuestion;
                  // DRAG_DROP nối (kéo tag thả vào ô) -> số nằm TRONG ô thả, BỎ vòng tròn số như fill-blank (chuẩn IDP hình 2).
                  const isDragDrop = q.type === "DRAG_DROP";
                  
                  

                  // --- [NNG CẤP: KHỐI LIỀN MẠCH & KÉO THẢ] ---
                  const _isContinuousBlock =
    q.type === "BLANK" &&
    (q.subType === "SUMMARY" ||
     q.subType === "NOTES");
     
const _isFlowChart =
    q.type === "BLANK" &&
    q.subType === "FLOWCHART";
                  
                  let parsedHtmlText = qTextData.html;

                  // 2. GIAO DIỆN SENTENCE COMPLETION & STANDARD CARDS (SUMMARY/NOTES/FLOWCHART fall-through ở đây)

                  // 2. GIAO DIỆN DRAG & DROP HEADING (Chuẩn IDP Kéo-Thả)
if (q.type === "DRAG_DROP_HEADING") {
    // Chúng ta không render card câu hỏi ở đây nữa, 
    // vì Dropzone đã được inject thẳng vào bài đọc ở cột trái.
    return null; 
}
                  // 3. GIAO DIỆN SENTENCE COMPLETION & STANDARD CARDS
                  return (
                      <div id={`question-${qIds[0]}`} key={qIds.join('-')} className="idp-q-card" style={isBlankType ? { padding: '0 0 6px 0', marginBottom: 6, borderBottom: 'none' } : {}}>
                          <div style={{display: 'flex', alignItems: 'flex-start', gap: (isFillBlank || isDragDrop) ? 0 : 12}}>
                              {/* Số câu chuẩn IDP: số TRẦN, không vòng tròn; ĐANG LÀM -> Ô VUÔNG viền xanh (viền transparent giữ layout không xê dịch).
                                  CĂN HÀNG: lineHeight của số = ĐÚNG line-box thật của chữ câu hỏi (var(--efont) × 1.15 — vì rule
                                  `.idp-q-text-inline { line-height:1.15 !important }` đè lên mọi lineHeight khác). Cùng flex-start + border-box
                                  => tâm số trùng tâm dòng chữ đầu, KHÔNG magic-number, tự co giãn theo cỡ chữ HS chọn. */}
                              {!isFillBlank && !isDragDrop && (
                              <div style={{ background: 'transparent', color: idpC.text, border: `1.5px solid ${isCurrentQ ? idpC.blueAccent : 'transparent'}`, minWidth: 26, borderRadius: 3, boxSizing: 'border-box', padding: '0 5px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, flexShrink: 0, lineHeight: 'calc(var(--efont) * 1.15)', marginTop: 'calc(var(--efont) * -0.12)' }}>
                                  {numberLabel}
                              </div>
                              )}
                              <div style={{flex: 1, lineHeight: 1.6}}>
                                  <StaticHtmlBlock tagName="span" className="highlightable-content idp-q-text-inline" dataField="text" dataQid={q.id} style={{fontWeight: 400}} html={parsedHtmlText} />
                                  
                                  {q.type === "BLANK" && !isTFNGQuestion && !isYNNGQuestion && !isInjectedIntoContext && !isInlineInjected && (
                                      (() => {
                                          const hasBlankInText = (q.text || "").includes("___") || (q.text || "").includes("…") || (q.text || "").includes("____");
                                          return hasBlankInText ? (
                                              <input type="text" className={`idp-inline-input ${(examAnswers[q.id] as string) ? 'filled' : ''}`} placeholder={firstGlobalIdx.toString()} defaultValue={(examAnswers[q.id] as string) || ""} onInput={(e: any) => e.target.classList.toggle('filled', !!e.target.value)} onBlur={(e: any) => handleAnswerChange(q.id, e.target.value, "BLANK")} onKeyPress={(e: any) => { if(e.key==='Enter') handleAutoScrollNext(firstGlobalIdx, (activeExam!.questions || []).length); }} style={{ textAlign: 'center', width: rInputW }} />
                                          ) : null;
                                      })()
                                  )}
                                  {q.type === "DRAG_DROP" && !isInjectedIntoContext && !isInlineInjected && (
                                      <span className={`idp-dropzone ${(examAnswers[q.id] as string) ? 'filled' : ''}`} data-qid={q.id} title="Kéo đáp án thả vào đây">
                                          {(examAnswers[q.id] as string) || firstGlobalIdx}
                                      </span>
                                  )}
                              </div>
                          </div>
                          
                          <div style={{ marginLeft: (isFillBlank || isDragDrop) ? 0 : 40, marginTop: 8 }}>
                              {q.type === "BLANK" && !isTFNGQuestion && !isYNNGQuestion && !isInjectedIntoContext && !isInlineInjected && !(q.text || "").includes("___") && !(q.text || "").includes("____") && (
                                  <input type="text" className={`idp-input ${(examAnswers[q.id] as string) ? 'filled' : ''}`} placeholder={`${firstGlobalIdx}`} defaultValue={(examAnswers[q.id] as string) || ""} onInput={(e: any) => e.target.classList.toggle('filled', !!e.target.value)} onBlur={(e: any) => handleAnswerChange(q.id, e.target.value, "BLANK")} onKeyPress={(e: any) => { if(e.key==='Enter') handleAutoScrollNext(firstGlobalIdx, (activeExam!.questions || []).length); }} style={{maxWidth: rInputW, marginTop: 4, textAlign: 'center', borderRadius: '3px'}} />
                              )}
                              
                              {(q.type === "CHOICE" || isTFNGQuestion || isYNNGQuestion) && (
    <div style={{display: 'flex', flexDirection: 'column'}}>
        <ul className="vertical" style={{ listStyleType: 'none', padding: 0, margin: '4px 0 0 0' }}>
            {(() => {
                // Fallback options cho TFNG nếu backend trả về rỗng
                let effectiveOptions = q.options;
                const isTFNG = isTFNGQuestion;
                const isYNNG = isYNNGQuestion;

if ((!effectiveOptions || effectiveOptions.length === 0)) {
    if (isTFNG) {
        effectiveOptions = [
            "TRUE",
            "FALSE",
            "NOT GIVEN"
        ];
    } else if (isYNNG) {
        effectiveOptions = [
            "YES",
            "NO",
            "NOT GIVEN"
        ];
    }
}
                // Nếu vẫn không có options thì không render (tránh crash)
                if (!effectiveOptions || effectiveOptions.length === 0) return null;
                
                return effectiveOptions.map((opt: string, optIndex: number) => {
                    const cleanOpt = (opt || "").replace(/^[a-zA-Z][\.\)]\s*/, "");
                    const isSelected = examAnswers[q.id] === optIndex;
                    const optionId = `idp_opt_${q.id}_${optIndex}`;
                    
                    const _isTFNG = q.subType === "True/False/Not Given" || q.subType === "Yes/No/Not Given" ||
                                    (effectiveOptions.some((o: any) => {
                                        const s = String(o ?? "").trim().toUpperCase();
                                        return s === "TRUE" || s === "FALSE" || s === "NOT GIVEN" || s === "YES" || s === "NO";
                                    }));
                    return (
                        <li key={optIndex} className="idp-mcq-row" style={{ display: 'flex', alignItems: 'flex-start', marginBottom: '2px', gap: '11px', cursor: 'pointer', background: isSelected ? '#cfe2f3' : undefined }}
                            onClick={(e: any) => {
                                if (e.target && e.target.tagName === 'INPUT') return; // radio tự xử lý qua onChange
                                // QUÉT (kéo chuột) != BẤM: engine đã removeAllRanges trước khi click bắn nên phải đo khoảng cách kéo
                                const dn = (window as any).__examPtrDown;
                                if (dn && Math.hypot(e.clientX - dn.x, e.clientY - dn.y) > 6) return;
                                if ((e.currentTarget as HTMLElement).querySelector('.idp-temp-selection, .student-highlight, .student-note-hl')?.contains(e.target)) return;
                                const sel = window.getSelection();
                                if (sel && sel.toString().trim().length > 0) return;
                                handleAnswerChange(q.id, optIndex); handleAutoScrollNext(firstGlobalIdx, (activeExam.questions || []).length);
                            }}>
                            {/* Vùng chọn mở rộng ra cả dòng (kể cả text) — quét chữ để highlight vẫn được, chỉ bấm mới tính là chọn */}
                            <input
                                type="radio"
                                id={optionId}
                                name={`q_${q.id}`}
                                checked={isSelected}
                                onChange={() => { handleAnswerChange(q.id, optIndex); handleAutoScrollNext(firstGlobalIdx, (activeExam.questions || []).length); }}
                                className="idp-mcq-radio"
                            />
                            <StaticHtmlBlock tagName="span" className="highlightable-content idp-mcq-opt" dataField="options" dataQid={q.id} dataOptIndex={String(optIndex)} style={{ color: 'var(--etext)' }} html={renderSafeHTML(cleanOpt)} />
                        </li>
                    );
                });
            })()}
        </ul>
    </div>
)}
                              
                              {q.type === "CHOICE_MULTIPLE" && (
                                  <div style={{display: 'flex', flexDirection: 'column'}}>
                                      {(q.options || []).map((opt: string, optIndex: number) => {
                                          const cleanOpt = (opt || "").replace(/^[a-zA-Z][\.\)]\s*/, "");
                                          let isSelected = false;
                                          if (isMerged) {
                                              isSelected = qIds.some((id: string) => {
                                                  const ans = examAnswers[id];
                                                  return Array.isArray(ans) ? ans.includes(optIndex) : ans === optIndex;
                                              });
                                          } else {
                                              const selectedArr = Array.isArray(examAnswers[q.id]) ? examAnswers[q.id] as number[] : [];
                                              isSelected = selectedArr.includes(optIndex);
                                          }

                                          const toggleThisOpt = (checked: boolean) => {
                                              if (isMerged) {
                                                  let currentSel: number[] = [];
                                                  qIds.forEach((id: string) => {
                                                      const ans = examAnswers[id];
                                                      if (Array.isArray(ans)) currentSel.push(...ans);
                                                      else if (ans !== undefined && ans !== "") currentSel.push(Number(ans));
                                                  });
                                                  currentSel = Array.from(new Set(currentSel));

                                                  if (checked) {
                                                      if (currentSel.length < qIds.length) currentSel.push(optIndex);
                                                      else { alert(`You can only choose ${qIds.length} options.`); return; }
                                                  } else {
                                                      currentSel = currentSel.filter(x => x !== optIndex);
                                                  }

                                                  const newAnswers = { ...examAnswers };
                                                  qIds.forEach((id: string, idx: number) => {
                                                      newAnswers[id] = currentSel[idx] !== undefined ? currentSel[idx] : "";
                                                  });
                                                  setExamAnswers(newAnswers);
                                                  setSaveStatus("Saving...");
                                                  setTimeout(() => setSaveStatus("Saved"), 500);
                                              } else {
                                                  const selectedArr = Array.isArray(examAnswers[q.id]) ? examAnswers[q.id] as number[] : [];
                                                  let newArr = [...selectedArr];
                                                  const maxChoices = getQuestionPointCount(q);
                                                  if (checked) {
                                                      if (!newArr.includes(optIndex)) {
                                                          if (newArr.length >= maxChoices) { alert(`You can only choose ${maxChoices} options.`); return; }
                                                          newArr.push(optIndex);
                                                      }
                                                  } else {
                                                      newArr = newArr.filter(x => x !== optIndex);
                                                  }
                                                  handleAnswerChange(q.id, newArr);
                                              }
                                          };
                                          return (
                                          <div key={optIndex} className={`idp-radio-label ${isSelected ? 'selected' : ''}`} style={{display: 'flex', alignItems: 'flex-start', gap: 10, padding: '7px 12px', borderRadius: 6, transition: 'colors 0.15s ease-in-out', background: isSelected ? '#f0f6ff' : '#fff', border: `1px solid ${isSelected ? idpC.blueAccent : '#ccc'}`, margin: '0 0 6px 0', cursor: 'pointer'}}
                                              onClick={(e: any) => {
                                                  if (e.target && e.target.tagName === 'INPUT') return; // checkbox tự xử lý qua onChange
                                                  // QUÉT (kéo chuột) != BẤM: đo khoảng cách kéo vì selection đã bị engine xoá trước khi click bắn
                                                  const dn = (window as any).__examPtrDown;
                                                  if (dn && Math.hypot(e.clientX - dn.x, e.clientY - dn.y) > 6) return;
                                                  if ((e.currentTarget as HTMLElement).querySelector('.idp-temp-selection, .student-highlight, .student-note-hl')?.contains(e.target)) return;
                                                  const sel = window.getSelection();
                                                  if (sel && sel.toString().trim().length > 0) return;
                                                  toggleThisOpt(!isSelected);
                                              }}>
                                              {/* Vùng chọn mở rộng ra cả dòng (kể cả text) — quét chữ để highlight vẫn được, chỉ bấm mới tính là chọn */}
                                              <input type="checkbox" className="idp-mcq-check" checked={isSelected} onChange={(e) => toggleThisOpt(e.target.checked)} />
                                              <StaticHtmlBlock tagName="span" className="highlightable-content idp-mcq-opt" dataField="options" dataQid={q.id} dataOptIndex={String(optIndex)} html={renderSafeHTML(cleanOpt)} />
                                          </div>
                                      )})}
                                  </div>
                              )}
                          </div>
                      </div>
                  );
                  }
              );
          };

          return (
              <div className={`exam-content-block notranslate theme-${examTheme} text-${examTextSize}`} translate="no" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'var(--ebg)', color: 'var(--etext)', display: "flex", flexDirection: "column", filter: !isWindowFocused && !isPreview ? 'blur(10px) grayscale(50%)' : 'none', transition: 'filter 0.3s', fontFamily: "Arial, Helvetica, sans-serif" }} 
                   onCopy={_e => {_e.preventDefault(); alert("WARNING: Copy function disabled!"); }} 
                   onCut={_e => { _e.preventDefault(); alert("WARNING: Cut function disabled!"); }} 
                   onPaste={_e => { _e.preventDefault(); alert("WARNING: Paste function disabled!"); }} 
                   
                   onContextMenu={(e: any) => {
                       if (e.target && e.target.classList && e.target.classList.contains('student-highlight')) {
                           e.preventDefault();
                           const target = e.target as HTMLElement;
                           const container = target.closest('.highlightable-content');
                           
                           target.outerHTML = target.innerHTML;
                           
                           if (container) {
                               const field = container.getAttribute('data-field');
                               const qId = container.getAttribute('data-qid');
                               const optIndex = container.getAttribute('data-optindex');
                               
                               if (field) {
                                   const cleanHTML = serializeHighlightHTML(container as HTMLElement);
                                   setActiveExam(prev => syncHighlightState(prev, field, qId || "", cleanHTML, optIndex));
                               }
                           }
                       } else {
                           e.preventDefault(); 
                       }
                   }}>
                  
                  {(String(activeExam.type).toLowerCase().includes("listen") || activeExam.type === "Integrated") && (
                      <audio ref={audioRef} preload="auto" playsInline src={activeExam.audioUrl || ""}
                          onEnded={handleExamAudioEnded}
                          onPlay={(e: any) => recordAudioDiagnostic("play", e.currentTarget as HTMLAudioElement)}
                          onPlaying={handleExamAudioPlaying}
                          onPause={(e: any) => handleExamAudioPause(e.currentTarget as HTMLAudioElement)}
                          onError={(e: any) => handleExamAudioError(e.currentTarget.error)}
                          onCanPlay={(e: any) => { const audio = e.currentTarget as HTMLAudioElement; recordAudioDiagnostic("canplay", audio); if (examAudioShouldPlayRef.current && audio.paused) recoverInterruptedExamAudio(audio); }}
                          onWaiting={(e: any) => recordAudioDiagnostic("waiting", e.currentTarget as HTMLAudioElement)}
                          onStalled={(e: any) => recordAudioDiagnostic("stalled", e.currentTarget as HTMLAudioElement)}
                          onSuspend={(e: any) => recordAudioDiagnostic("suspend", e.currentTarget as HTMLAudioElement)}
                          onAbort={(e: any) => recordAudioDiagnostic("abort", e.currentTarget as HTMLAudioElement)}
                          onEmptied={(e: any) => recordAudioDiagnostic("emptied", e.currentTarget as HTMLAudioElement)}
                          onLoadedMetadata={(e: any) => {
                              const audio = e.currentTarget as HTMLAudioElement;
                              setAudioDur(audio.duration || 0);
                              updateExamMediaSessionPosition(audio);
                              if (pendingAudioResume && Number.isFinite(pendingAudioResume.time) && pendingAudioResume.time > 0) {
                                  audio.currentTime = Math.min(pendingAudioResume.time, Math.max(0, (audio.duration || pendingAudioResume.time) - 0.1));
                                  setAudioCur(audio.currentTime);
                                  updateExamMediaSessionPosition(audio);
                                  setPendingAudioResume(null);
                              }
                          }}
                          onTimeUpdate={(e: any) => { const audio = e.currentTarget as HTMLAudioElement; if ((activeExam as any).audioMode === 'practice') setAudioCur(audio.currentTime || 0); updateExamMediaSessionPosition(audio); }}
                          style={{position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none'}} />
                  )}

                  {globalStyles}
                  {/* HIDDEN DIV DỌN DẸP TS WARNING */}
                  <div style={{display: 'none'}} data-legacy={String(splitRatio) + String(setSplitRatio) + String(isDraggingSplitter) + String(setIsDraggingSplitter) + String(_isSepia) + String(_setIsSepia) + String(_lineHeight) + String(_setLineHeight) + String(_textAlign) + String(_setTextAlign) + String(_showLineNumbers) + String(_setShowLineNumbers) + String(_fontFam) + String(_setFontFam) + String(_setAudioTested) + String(_setScrollPct) + String(_showQuestionNotes) + String(_setShowQuestionNotes) + String(_toggleStrike) + String(_toggleFlag) + String(_isFocusMode) + String(setIsFocusMode) + String(isFullScreen) + String(setIsFullScreen) + String(isWindowFocused) + String(enableTimerBeep) + String(_setEnableTimerBeep)}></div>

                  <style>{`
                      html, body, #root { overflow: hidden !important; height: 100% !important; max-height: 100% !important; margin: 0 !important; padding: 0 !important; -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
                      /* APPLE SAFARI LANDSCAPE FIX: Đồng bộ tọa độ chạm với hiển thị thực tế */
                      @supports (-webkit-touch-callout: none) {
                          html, body, #root, .exam-content-block { height: -webkit-fill-available !important; max-height: -webkit-fill-available !important; }
                      }
                      
                      /* THEME & TEXT SIZE ENGINE CHUẨN IDP */
                      .exam-content-block { --ebg: #ffffff; --epanel: #ffffff; --eborder: #d1d5db; --etext: #24292f; --esub: #57606a; --eaccent: #d32f2f; --eblue: #0969da; --einput: #ffffff; --efont: 15px; --eboxbg: #f0efe9; --hlbg: #8b1a1a; --hlfg: #ffffff; --notebg: #2563eb; --notefg: #ffffff; }
                      .exam-content-block.theme-dark { --ebg: #000000; --epanel: #000000; --eborder: #444444; --etext: #ffffff; --esub: #aaaaaa; --eaccent: #ffffff; --eblue: #ffffff; --einput: #222222; --eboxbg: #1c1c1c; --hlbg: #FFE066; --hlfg: #000000; --notebg: #93c5fd; --notefg: #000000; }
                      .exam-content-block.theme-yellow { --ebg: #000000; --epanel: #000000; --eborder: #ffcc00; --etext: #ffcc00; --esub: #ccaa00; --eaccent: #ffcc00; --eblue: #ffcc00; --einput: #222222; --eboxbg: #1a1500; --hlbg: #9ca3af; --hlfg: #000000; --notebg: #93c5fd; --notefg: #000000; }
                      .exam-content-block.text-large { --efont: 20px; }
                      .exam-content-block.text-xlarge { --efont: 24px; }

                      .exam-content-block, .exam-passage-col, .exam-question-col { background: var(--ebg) !important; color: var(--etext) !important; }
                      /* Cột câu hỏi co tự do -> bảng/nội dung to KHÔNG chặn splitter */
                      .exam-question-col { min-width: 0 !important; }
                      .exam-passage-col { min-width: 0 !important; }
                      
                      .exam-content-block .highlightable-content, .exam-content-block .highlightable-content *, .exam-content-block .idp-q-text-inline, .exam-content-block .idp-q-text-inline * {
                          color: var(--etext) !important; background-color: transparent !important; line-height: 1.15 !important; cursor: text;
                      }
                      .exam-content-block .idp-instruction, .exam-content-block .idp-context-box, .exam-content-block .idp-text-content, .exam-content-block .scorableItemHeadline { cursor: text; }
                      /* FIX "cỡ chữ bài đọc không tác động": chỉ đặt cỡ NỀN trên KHỐI (KHÔNG ép '*' bằng !important),
                         để cỡ chữ giáo viên chỉnh cho từng đoạn ở Builder vẫn hiển thị đúng; phần text không chỉnh tay vẫn theo nút phóng to/thu nhỏ của học viên (--efont). */
                      .exam-content-block .highlightable-content, .exam-content-block .idp-q-text-inline {
                          font-size: var(--efont);
                      }
                      /* Khôi phục in đậm tuyệt đối và hủy căn giữa máy móc */
                      .exam-content-block strong, .exam-content-block b, .exam-content-block strong *, .exam-content-block b * { font-weight: 900 !important; font-weight: bold !important; display: inline !important; }
                      .exam-content-block .idp-text-content { text-align: justify; word-break: break-word; }
                      .exam-content-block .idp-instruction, .exam-content-block .idp-q-text-inline, .exam-content-block .idp-context-box { text-align: left; }
                      
                      .exam-content-block .idp-radio-label { background: var(--einput) !important; border-color: var(--eborder) !important; color: var(--etext) !important; }
                      .exam-content-block .idp-radio-label.selected { border-color: var(--eblue) !important; }
                      /* O chon NHO GON chuan IDP (15px). CAN HANG: marginTop = (line-box that cua chu - 15)/2 de tam o tron
                         trung tam DONG CHU DAU. Line-box that = var(--efont) * 1.15 (rule .highlightable-content ep line-height:1.15).
                         Row set font-size/line-height tuong minh nen em cua o = var(--efont) -> calc chuan, tu co gian theo co chu. */
                      .exam-content-block .idp-mcq-row { padding: 5px 8px; border-radius: 4px; font-size: var(--efont); line-height: 1.15; }
                      .exam-content-block .idp-mcq-radio, .exam-content-block .idp-mcq-check {
                          width: 15px; height: 15px; flex-shrink: 0; cursor: pointer;
                          margin: calc((1.15em - 15px) / 2 - 0.12em) 0 0 0;
                          accent-color: var(--eblue);
                      }
                      /* BỎ khung xám xấu quanh ô tròn/vuông khi click (focus ring mặc định) — giao diện IDP gốc không có */
                      .exam-content-block .idp-mcq-radio:focus, .exam-content-block .idp-mcq-check:focus { outline: none !important; box-shadow: none !important; }
                      /* Input đã nhập KHÔNG giữ viền xanh — viền chỉ xanh khi :focus (đang làm câu đó), blur ra thì về viền thường. */
                      .exam-content-block .idp-mcq-row:hover { background: rgba(128,128,128,0.13); }
                      .exam-content-block .idp-mcq-opt { cursor: pointer; text-align: left !important; }
                      .exam-content-block input.idp-input, .exam-content-block input.idp-inline-input { background: var(--einput) !important; color: var(--etext) !important; border-color: var(--eborder) !important; font-size: var(--efont) !important; }
                      .exam-content-block .idp-instruction { background: var(--epanel) !important; border-color: var(--eborder) !important; color: var(--etext) !important; }
                      .exam-content-block .idp-context-box { background: var(--epanel) !important; border-color: var(--eborder) !important; color: var(--etext) !important; }
                      .exam-content-block .idp-q-card { border-color: var(--eborder) !important; }
                      .exam-content-block .idp-footer-nav { background: var(--ebg) !important; border-color: var(--eborder) !important; }
                      .exam-content-block .idp-nav-sq { background: transparent !important; border: none !important; border-top: 2px solid #9ca3af !important; border-radius: 0 !important; color: var(--etext) !important; }
                      .exam-content-block .idp-nav-sq.ans { border: none !important; border-top: 2px solid #16a34a !important; }
                      .exam-content-block .idp-nav-sq.cur { border: 1.5px solid var(--eblue) !important; border-radius: 3px !important; color: var(--eblue) !important; }
                      
                      .exam-content-block table, .exam-content-block th, .exam-content-block td { border-color: var(--eborder) !important; color: var(--etext) !important; }
                      .exam-content-block th, .exam-content-block td:first-child { background: var(--epanel) !important; }
                      .exam-content-block td { background: var(--ebg) !important; }
                      .exam-content-block .idp-matching-legend { background: var(--epanel) !important; border-color: var(--eborder) !important; color: var(--etext) !important; }
                      .exam-content-block .idp-matching-legend-key { color: var(--eblue) !important; }
                      .exam-content-block .idp-dragdrop-pool { background: var(--epanel) !important; border-color: var(--eborder) !important; }
                      .exam-content-block .idp-draggable { background: var(--einput) !important; border-color: var(--eborder) !important; color: var(--etext) !important; }
                      .exam-content-block .idp-dropzone { background: var(--epanel) !important; border-color: var(--eborder) !important; color: var(--etext) !important; }
                      .exam-content-block .idp-dropzone.filled { background: var(--ebg) !important; border-color: var(--eblue) !important; color: var(--etext) !important; }
                      .exam-content-block .idp-section-header { color: var(--esub) !important; border-bottom-color: var(--eborder) !important; }
                      .exam-content-block .idp-opt-letter { background: var(--epanel) !important; border-color: var(--eborder) !important; color: var(--etext) !important; }

                      /* ĐàFIX UI CHUẨN: Popup Highlight & Giao diện Tooltip Nhập Ghi Chú */
                      /* POPUP QUÉT CHỮ — sao chép Inspera: 2 nút NGANG [Note | Highlight], icon trên, chữ dưới, vạch chia dọc */
                      .idp-popup-menu { position: absolute; background: #fff; border-radius: 10px; display: flex; flex-direction: row; padding: 0; box-shadow: 0 2px 12px rgba(0,0,0,0.22); z-index: 999999; transform: translate(-50%, -100%); margin-top: -10px; border: 1px solid #d8dce1; overflow: hidden; }
                      .idp-popup-menu::after { content: ''; position: absolute; bottom: -8px; left: 50%; transform: translateX(-50%); border-width: 8px 8px 0; border-style: solid; border-color: #fff transparent transparent transparent; filter: drop-shadow(0 2px 2px rgba(0,0,0,0.05)); }
                      .idp-popup-btn { background: transparent; border: none; color: #3b4149; font-size: 12px; font-weight: 500; padding: 7px 16px 6px; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 2px; line-height: 1; }
                      .idp-popup-btn + .idp-popup-btn { border-left: 1px solid #e2e5e9; }
                      .idp-popup-btn:hover { background: #f4f5f7; }
                      
                      /* THANH AUDIO PRACTICE (trên nav bar) — tối giản IDP: track mảnh, thumb tròn đen, không màu mè */
                      .idp-audio-bar { flex: none; display: flex; align-items: center; gap: 12px; padding: 7px 20px; background: var(--epanel); border-top: 1px solid var(--eborder); }
                      .idp-audio-play { width: 30px; height: 30px; flex: none; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--eborder); border-radius: 4px; background: var(--einput); color: var(--etext); cursor: pointer; padding: 0; transition: border-color .12s; }
                      .idp-audio-play:hover { border-color: var(--etext); }
                      .idp-audio-time { flex: none; font-family: Consolas, monospace; font-size: 12px; color: var(--esub); line-height: 1; }
                      .idp-audio-range { -webkit-appearance: none; appearance: none; flex: 1; height: 4px; border-radius: 2px; outline: none; cursor: pointer; margin: 0; padding: 0; border: none; }
                      .idp-audio-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 13px; height: 13px; border-radius: 50%; background: var(--etext); border: none; cursor: pointer; }
                      .idp-audio-range::-moz-range-thumb { width: 13px; height: 13px; border-radius: 50%; background: var(--etext); border: none; cursor: pointer; }
                      .idp-audio-range::-moz-range-track { height: 4px; border-radius: 2px; background: transparent; }
                      .idp-rate-btn { border: 1px solid var(--eborder); background: var(--einput); color: var(--esub); font-size: 11px; font-weight: 700; padding: 3px 7px; border-radius: 3px; cursor: pointer; line-height: 1.2; transition: .12s; }
                      .idp-rate-btn:hover { border-color: var(--etext); color: var(--etext); }
                      .idp-rate-btn.on { background: var(--etext); color: var(--ebg); border-color: var(--etext); }
                      /* PANEL NOTES (Inspera style) */
                      .idp-notes-panel { position: absolute; top: 60px; right: 0; bottom: 0; width: 310px; background: #fff; border-left: 1px solid #d1d5db; z-index: 1500; display: flex; flex-direction: column; box-shadow: -4px 0 16px rgba(0,0,0,0.08); color: #111; }
                      .idp-notes-panel-head { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; font-size: 15px; font-weight: 700; border-bottom: 1px solid #e5e7eb; }
                      .idp-notes-panel-body { flex: 1; overflow-y: auto; padding: 12px 16px; }
                      .idp-note-item { padding: 10px 12px; border-radius: 8px; margin-bottom: 12px; background: #fff; transition: background .12s; }
                      .idp-note-item:hover, .idp-note-item.confirm { background: #2447c5; color: #fff; }
                      .idp-note-item:hover .idp-note-link, .idp-note-item.confirm .idp-note-link { color: #fff; }
                      .idp-note-jump { display: block; width: 100%; text-align: left; background: none; border: none; padding: 0 0 8px 0; cursor: pointer; font-size: 13px; line-height: 1.45; color: inherit; }
                      .idp-note-jump strong { font-weight: 800; margin-right: 6px; }
                      .idp-note-jump em { font-style: italic; }
                      .idp-note-jump:hover em { text-decoration: underline; }
                      .idp-note-panel-input { width: 100%; box-sizing: border-box; border: 1px solid #9ca3af; border-radius: 3px; padding: 8px 10px; font-size: 13px; outline: none; background: #fff; color: #111; transition: border-color .12s, box-shadow .12s; }
                      .idp-note-panel-input:hover, .idp-note-panel-input:focus { border-color: #2563eb; box-shadow: 0 0 0 1px #2563eb inset; }
                      .idp-note-link { background: none; border: none; cursor: pointer; font-size: 13px; font-weight: 600; color: #2563eb; padding: 6px 0 0 0; }
                      .idp-note-link:hover { text-decoration: underline; }
                      .idp-note-link.light { color: #fff; }
                      .idp-note-input-modal { position: absolute; background: #fff; border-radius: 6px; padding: 12px; box-shadow: 0 8px 30px rgba(0,0,0,0.2); z-index: 999999; transform: translate(-50%, 10px); border: 1px solid #d1d5db; min-width: 250px; }
                      .idp-note-input-modal::before { content: ''; position: absolute; top: -8px; left: 50%; transform: translateX(-50%); border-width: 0 8px 8px; border-style: solid; border-color: transparent transparent #fff transparent; filter: drop-shadow(0 -2px 2px rgba(0,0,0,0.05)); }

                      .idp-section-tab { flex: 1; text-align: center; padding: 12px 5px; cursor: pointer; border-bottom: 3px solid transparent; transition: 0.2s; color: var(--esub); position: relative; }
                      .idp-section-tab.active { border-bottom-color: var(--etext); color: var(--etext); font-weight: 900; background: var(--epanel); }
                      .idp-progress-bg { position: absolute; top: 0; left: 10%; right: 10%; height: 3px; background: var(--eborder); border-radius: 3px; overflow: hidden; }
                      .idp-progress-fill { height: 100%; background: var(--etext); transition: width 0.3s ease; }
                      
                      .student-note-hl { background-color: var(--notebg, #2563eb) !important; color: var(--notefg, #fff) !important; cursor: pointer; position: relative; padding-right: 18px; border-radius: 2px; }
                      .student-note-hl::after { content: ''; position: absolute; right: 3px; top: 50%; transform: translateY(-50%); width: 12px; height: 12px; background: url('data:image/svg+xml;utf8,<svg viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg"><path d="M20 2H4C2.9 2 2 2.9 2 4V22L6 18H20C21.1 18 22 17.1 22 16V4C22 2.9 21.1 2 20 2Z"/></svg>') no-repeat center; background-size: contain; }
                      
                      /* ĐàFIX: Đồng bộ màu quét chuột nguyên bản với màu FAKE của hệ thống */
                      .exam-content-block ::selection { background-color: #b3d4fc !important; color: inherit !important; }
                      .exam-content-block ::-moz-selection { background-color: #b3d4fc !important; color: inherit !important; }

                      .exam-content-block .highlightable-content .student-highlight, .exam-content-block .highlightable-content .student-highlight *, .exam-content-block .idp-q-text-inline .student-highlight, .exam-content-block .idp-q-text-inline .student-highlight * { background-color: var(--hlbg) !important; color: var(--hlfg) !important; cursor: pointer; }
                      .exam-content-block .highlightable-content .student-note-hl, .exam-content-block .highlightable-content .student-note-hl *, .exam-content-block .idp-q-text-inline .student-note-hl, .exam-content-block .idp-q-text-inline .student-note-hl * { background-color: var(--notebg) !important; color: var(--notefg) !important; cursor: pointer; }
                      .exam-content-block .idp-temp-selection,
                      .exam-content-block .highlightable-content .idp-temp-selection,
                      .exam-content-block .highlightable-content .idp-temp-selection * { background-color: #b3d4fc !important; color: #000 !important; }

                      .exam-passage-col img, .exam-question-col img { max-width: 100% !important; height: auto !important; object-fit: contain; border-radius: 4px; margin: 10px 0; }
                      .exam-two-column { width: 100% !important; max-width: 100% !important; margin: 0 !important; }
                      ::-webkit-scrollbar { width: 10px; height: 10px; }
                      ::-webkit-scrollbar-track { background: #f1f1f1; border-left: 1px solid #ddd; }
                      ::-webkit-scrollbar-thumb { background: #c1c1c1; border-radius: 10px; }
                      ::-webkit-scrollbar-thumb:hover { background: #a8a8a8; }
                      .idp-radio-label { display: flex; align-items: center; gap: 10px; padding: 7px 12px; border-radius: 4px; cursor: pointer; transition: 0.1s; margin-bottom: 6px; background: #fff; border: 1px solid #ccc; }
                      .idp-radio-label:hover { background: #f8f9fa; border-color: #bbb; }
                      .idp-radio-label.selected { background: #f0f6ff; border-color: ${idpC.blueAccent}; }
                      input[type="radio"], input[type="checkbox"] { width: 18px; height: 18px; cursor: pointer; accent-color: ${idpC.blueAccent}; margin: 0; flex-shrink: 0; }
                      .idp-input { border: 1px solid #777; padding: 8px 12px; font-size: 15px; border-radius: 4px; width: 100%; box-shadow: inset 0 1px 2px rgba(0,0,0,0.05); outline: none; transition: 0.2s; }
                      .idp-input:focus { border-color: ${idpC.blueAccent}; box-shadow: 0 0 0 2px rgba(9, 105, 218, 0.2); }
                      
                      /* ĐàFIX: Hỗ trợ Black mode, căn giữa, chữ màu động chuẩn IDP */
                      .idp-inline-input { border: 1px solid var(--eborder); border-radius: 3px; padding: 2px 8px; min-width: 60px; width: auto; font-size: var(--efont); font-weight: 600; color: var(--etext); outline: none; text-align: center !important; background: var(--einput); box-shadow: inset 0 1px 2px rgba(0,0,0,0.05); margin: 0 6px; font-family: inherit; transition: 0.2s; vertical-align: baseline; display: inline-block; }
                      .idp-inline-input:focus { border-color: #0969da; box-shadow: 0 0 0 2px rgba(9, 105, 218, 0.2); }
                      .idp-inline-input::placeholder { color: var(--etext); font-weight: 800; opacity: 0.8; }
                      
                      /* ĐàFIX: Đưa Instruction và Context về chuẩn IDP (trong suốt, không viền, khoảng cách chuẩn) */
                      /* THANG SPACING ĐỒNG BỘ (IDP): --q-gap 28px giữa các NHÓM câu; --note-line 7px giữa các dòng note/form. */
                      .exam-content-block { --q-gap: 16px; --note-line: 6px; }
                      .question-rubric { margin-bottom: 10px; }
                      .question-rubric h3.scorableItemHeadline { font-size: 16px; font-weight: 700; color: var(--etext); margin: 0 0 8px 0; font-family: inherit; }

                      .idp-instruction { background: transparent !important; border: none !important; color: var(--etext) !important; padding: 0 !important; margin: 0 !important; font-size: var(--efont); line-height: 1.5; }
                      .idp-instruction strong, .idp-instruction b { font-weight: 700 !important; }
                      .idp-instruction p, .idp-instruction div { margin: 0 !important; padding: 0 !important; }
                      /* Dòng nhãn cột kéo-thả: ẩn khỏi instruction (đã hiện ở header cột) nhưng GIỮ trong DOM để serialize không làm mất */
                      .idp-instruction .idp-draglabel-hide { display: none !important; }

                      .idp-context-box { background: transparent !important; border: none !important; color: var(--etext) !important; padding: 0; margin-bottom: 10px; font-size: var(--efont); line-height: 1.55; overflow-x: auto; max-width: 100%; }
                      /* Bảng điền từ: full-width để 2 bảng (vd S3 Q24-30) LUÔN BẰNG NHAU. */
                      .idp-context-box table { width: 100% !important; max-width: 100%; font-size: calc(var(--efont) - 1px); }
                      /* Bảng KHÔNG xuống dòng lẻ ký tự. Thay vào đó: cột hẹp tới đâu -> TỰ THU NHỎ chữ + ô nhập
                         (container query theo bề rộng cột câu hỏi), quá nữa thì cuộn ngang trong khung. */
                      .idp-context-box { container-type: inline-size; }
                      .idp-context-box td, .idp-context-box th { word-break: normal; }
                      .idp-context-box table input.idp-inline-input { box-sizing: border-box; }
                      @container (max-width: 760px) {
                          .idp-context-box table, .idp-context-box td, .idp-context-box th { font-size: calc(var(--efont) - 2px) !important; }
                          .idp-context-box td, .idp-context-box th { padding: 5px 7px !important; }
                          .idp-context-box table input.idp-inline-input { width: 110px !important; min-width: 0; padding: 2px 5px; }
                      }
                      @container (max-width: 600px) {
                          .idp-context-box table, .idp-context-box td, .idp-context-box th { font-size: calc(var(--efont) - 3.5px) !important; }
                          .idp-context-box td, .idp-context-box th { padding: 4px 5px !important; }
                          .idp-context-box table input.idp-inline-input { width: 84px !important; font-size: calc(var(--efont) - 3px) !important; }
                      }
                      .idp-context-box td, .idp-context-box th { font-size: calc(var(--efont) - 1px); }
                      .idp-context-box table input.idp-inline-input { max-width: 100%; }
                      .idp-context-box p { margin: 0 0 var(--note-line) 0 !important; }
                      .idp-context-box p:last-child { margin-bottom: 0 !important; }
                      .idp-context-box > div:first-child strong { display: block; font-size: calc(var(--efont) + 2px); margin-bottom: 10px; text-transform: none; letter-spacing: normal; font-weight: 700 !important; }

                      .idp-q-card { padding: 0 0 10px 0; margin-bottom: 10px; border-bottom: 1px solid #eaeaea; transition: 0.2s; }
                      .idp-q-card:last-child { border-bottom: none; }
                      .idp-flowchart-panel { border: 1.5px solid #0969da; border-radius: 8px; padding: 18px 24px; background: var(--ebg); max-width: 680px; margin: 0 auto 18px; }
                      .idp-flowchart-node { border: 1px solid #d8dee4; border-radius: 6px; background: rgba(255,255,255,0.65); padding: 10px 12px; line-height: 1.45; font-size: var(--efont); font-weight: 600; color: var(--etext); }
                      .idp-flowchart-arrow { width: 20px; text-align: center; font-size: 18px; font-weight: 800; line-height: 1; margin: 5px 0 5px 18px; color: #24292f; }
                      .idp-flowchart-number { display: inline-flex; align-items: center; justify-content: center; min-width: 24px; height: 24px; border: 1px solid #8c959f; border-radius: 50%; background: #fff; font-size: 12px; font-weight: 800; margin-right: 8px; }
                      .idp-flowchart-text p, .idp-flowchart-text div { margin: 0; padding: 0; }
                      .idp-flow-arrow { text-align: center; font-size: 20px; font-weight: 800; line-height: 1; margin: 8px 0; color: var(--etext); }
                      
                      /* ĐàFIX: Ép văn bản câu hỏi thành Inline, Line spacing khít khịt theo yêu cầu */
                      .idp-q-text-inline p, .idp-q-text-inline div { margin: 0; padding: 0; }
                      .idp-q-text-inline { font-weight: 400 !important; line-height: 1.15; font-size: var(--efont); }
                      .idp-q-text-inline strong, .idp-q-text-inline b { font-weight: 700 !important; }
                      
                      /* ĐàFIX: Nới rộng Navigator thoải mái */
                      .idp-footer-nav { position: relative; width: 100%; min-height: 52px; max-height: 40vh; background: #fff; border-top: 2px solid #ccc; display: flex; justify-content: space-between; align-items: stretch; z-index: 1000; flex-shrink: 0; box-shadow: 0 -2px 10px rgba(0,0,0,0.05); }
                      .idp-nav-squares { display: flex; gap: 8px; padding: 0; flex: 1; align-items: flex-start; height: 100%; flex-wrap: wrap; }
                      /* NAV CHUẨN IELTS: số trần, đã trả lời = gạch chân xanh, câu hiện tại = khung xanh */
                      .idp-nav-sq { min-width: 26px; height: 30px; padding: 3px 6px 0; border: none; border-top: 2px solid #cbd0d6; background: transparent; cursor: pointer; font-size: 14px; font-weight: 600; color: #1a1a1a; display: flex; justify-content: center; align-items: center; border-radius: 0; flex-shrink: 0; box-sizing: border-box; transition: 0.12s; }
                      .idp-nav-sq.ans { border-top: 2px solid #16a34a; }
                      .idp-nav-sq.cur { border: 1.5px solid #0a66c2; border-radius: 3px; color: #0a66c2; font-weight: 800; }
                      .idp-nav-sq.flagged { border-top: 2px solid #bf8700; color: #7a5200; }
                      .idp-nav-sq:hover { background: rgba(128,128,128,0.12); }
                      .idp-pnav-label { background: transparent; border: none; cursor: pointer; font-size: 14px; font-weight: 700; color: var(--esub); padding: 4px 2px; white-space: nowrap; transition: color 0.15s; }
                      .idp-pnav-label.active { color: var(--etext); font-weight: 800; }
                      .idp-pnav-label:hover { color: var(--eblue); }
                      .idp-submit-btn { width: 50px; height: 100%; background: #222; border: none; cursor: pointer; display: flex; justify-content: center; align-items: center; transition: 0.2s; }
                      .idp-submit-btn:hover { background: #000; }
                      /* === NÚT CHUYỂN CÂU (PREV/NEXT) + SUBMIT — giống realieltsexams === */
                      /* Mũi tên chuyển câu: VUÔNG GÓC, sát nhau (chuẩn Inspera) */
                      .idp-qnav-fab { position: absolute; right: 20px; bottom: 18px; display: flex; gap: 5px; z-index: 40; }
                      .idp-qnav-btn { width: 44px; height: 44px; border-radius: 2px; background: #1b1e2b; color: #fff; border: 1px solid #1b1e2b; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: background .18s ease, color .18s ease; box-shadow: 0 2px 8px rgba(27,30,43,0.25); }
                      .idp-qnav-btn:hover { background: #fff; color: #1b1e2b; }
                      /* Nút nộp: khít TOÀN BỘ vùng trắng, vuông góc */
                      .idp-submit-fab { width: 64px; height: 100%; border-radius: 0; background: #ececec; color: #3a3d47; border: none; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: background .18s ease, color .18s ease; }
                      .idp-submit-fab:hover { background: #1b1e2b; color: #fff; }
                      .idp-check-icon { width: 16px; height: 26px; border: solid #fff; border-width: 0 4px 4px 0; transform: rotate(45deg); display: inline-block; margin-bottom: 6px; }
                      .highlight-flash { animation: flashYellow 1.5s; }
                      @keyframes flashYellow { 0%, 100% { background-color: transparent; } 50% { background-color: #fff3cd; } }
                      /* Quầng vàng đánh dấu câu mũi tên vừa tới — nở quầng sáng mờ ảo rồi tan dần */
                      .idp-q-focus-flash { animation: qFocusFlash 2.2s cubic-bezier(0.22, 0.61, 0.36, 1) forwards; border-radius: 8px; will-change: box-shadow, background-color; }
                      @keyframes qFocusFlash {
                          0%   { box-shadow: 0 0 0 0 rgba(245,158,11,0), 0 0 0 0 rgba(245,158,11,0); background-color: rgba(245,158,11,0); }
                          14%  { box-shadow: 0 0 18px 6px rgba(245,158,11,0.45), 0 0 0 1px rgba(245,158,11,0.55); background-color: rgba(245,158,11,0.13); }
                          45%  { box-shadow: 0 0 14px 5px rgba(245,158,11,0.26), 0 0 0 1px rgba(245,158,11,0.30); background-color: rgba(245,158,11,0.07); }
                          100% { box-shadow: 0 0 26px 10px rgba(245,158,11,0), 0 0 0 1px rgba(245,158,11,0); background-color: rgba(245,158,11,0); }
                      }
                      
                      /* ĐàFIX: Tăng độ ưu tiên CSS (Specificity) cực đại để ghi đè luật transparent của hệ thống */
                      .exam-content-block .highlightable-content .student-highlight,
                      .exam-content-block .highlightable-content .student-highlight *,
                      .exam-content-block .idp-q-text-inline .student-highlight,
                      .exam-content-block .idp-q-text-inline .student-highlight * {
                          background-color: var(--hlbg) !important;
                          color: var(--hlfg) !important;
                          cursor: pointer;
                      }

                      /* Hình 9: Loading spinner */
                      .idp-spinner { width: 48px; height: 48px; border: 4px solid #e0e0e0; border-top-color: #111; border-radius: 50%; animation: idp-spin 0.8s linear infinite; margin: 0 auto 24px; }
                      @keyframes idp-spin { to { transform: rotate(360deg); } }

                      /* Hình 3: Matching matrix table */
                      .idp-matching-table { border-collapse: collapse; width: 100%; font-size: 14px; }
                      .idp-matching-table th { background: #f4f5f7; border: 1px solid #ccc; padding: 8px 12px; text-align: center; font-weight: 700; color: #24292f; min-width: 42px; }
                      .idp-matching-table td { border: 1px solid #ddd; padding: 10px 12px; vertical-align: middle; background: #fff; }
                      .idp-matching-table td:first-child { background: #fafafa; font-size: 13px; }
                      .idp-matching-table tbody tr:hover td { background: #f8f9ff; }
                      .idp-matching-table input[type="radio"] { display: block; margin: 0 auto; width: 17px; height: 17px; cursor: pointer; accent-color: #0969da; }
                      .idp-matching-legend { display: flex; flex-wrap: wrap; gap: 16px 24px; background: #f4f5f7; padding: 12px 15px; border: 1px solid #ccc; border-top: none; font-size: 13px; }
                      .idp-matching-legend-item { display: flex; align-items: baseline; gap: 6px; }
                      .idp-matching-legend-key { font-weight: 800; min-width: 18px; color: #0969da; }

                      /* Hình 6: Drag-drop 2-column layout */
                      .idp-dragdrop-workspace { display: flex; gap: 24px; align-items: flex-start; }
                      .idp-dragdrop-flowchart { flex: 1; min-width: 0; }
                      .idp-dragdrop-pool { flex: 0 0 180px; background: #f4f5f7; border: 1px solid #d1d5db; border-radius: 4px; padding: 12px; }
                      .idp-dragdrop-pool-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #57606a; margin-bottom: 10px; }
                      .idp-draggable { display: block; border: 1px solid #333; padding: 7px 12px; margin-bottom: 7px; background: #fff; cursor: grab; border-radius: 3px; font-weight: 700; font-size: 13px; transition: box-shadow 0.1s, opacity 0.15s; user-select: none; }
                      .idp-draggable:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.12); }
                      .idp-draggable:active { cursor: grabbing; opacity: 0.7; }
                      .idp-dropzone { display: inline-block; min-width: 110px; min-height: 28px; border: 2px dashed #888; background: #fafafa; vertical-align: middle; margin: 0 4px; padding: 2px 10px; font-weight: 700; color: #0969da; cursor: pointer; text-align: center; border-radius: 3px; transition: border-color 0.15s, background 0.15s; }
                      .idp-dropzone.filled { border-style: solid; border-color: #0969da; background: #e6f0ff; color: #0550ae; }
                      .idp-dropzone:not(.filled):hover { border-color: #0969da; background: #f0f6ff; }

                      /* WORD-BANK kéo-thả (summary completion từ box, chuẩn IELTS Mate) */
                      .idp-wordbank { display: flex; flex-wrap: wrap; gap: 10px; padding: 16px; background: var(--epanel); border: 1px solid var(--eborder); border-radius: 8px; margin-bottom: 18px; }
                      .idp-wordbank-item { display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; background: var(--einput); border: 1px solid var(--eborder); border-radius: 6px; cursor: grab; font-size: var(--efont); font-weight: 600; color: var(--etext); user-select: none; transition: box-shadow .1s, opacity .15s; }
                      .idp-wordbank-item:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.12); }
                      .idp-wordbank-item:active { cursor: grabbing; }
                      .idp-wordbank-item.used { opacity: 0.35; cursor: default; pointer-events: none; }
                      .idp-wb-letter { display: inline-flex; align-items: center; justify-content: center; min-width: 22px; height: 22px; border: 1px solid var(--eblue); border-radius: 4px; color: var(--eblue); font-size: 12px; font-weight: 800; flex-shrink: 0; }
                      /* ===== KÉO-THẢ NỐI 2 CỘT (compact, chuẩn IDP) — cột trái kho tag, cột phải mục có ô thả ===== */
                      .idp-match2 { display: flex; gap: 40px; align-items: flex-start; margin-top: 4px; }
                      .idp-match2-bank { flex: 0 0 auto; min-width: 150px; max-width: 300px; display: flex; flex-direction: column; gap: 6px; }
                      /* Cột mục = lưới 2 cột: nhãn co theo nội dung (fit-content -> ngắn thì bó sát, câu dài thì tự xuống dòng),
                         ô thả nằm SÁT ngay sau nhãn (không phí khoảng trắng). justify-content:start dồn về trái, kho tag ở xa phải. */
                      .idp-match2-items { flex: 1; min-width: 0; display: grid; grid-template-columns: fit-content(46%) minmax(150px, 300px); column-gap: 18px; row-gap: 8px; align-items: center; justify-content: start; }
                      .idp-match2-h { grid-column: 1 / -1; justify-self: start; text-align: left; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; color: var(--esub); margin-bottom: 3px; }
                      /* Heading kho tag (Attractions/Theorists): căn GIỮA so với list tag bên dưới */
                      .idp-match2-bank .idp-match2-h { text-align: center; justify-self: stretch; }
                      .idp-match2-tag { text-align: center; }
                      .idp-match2-name { text-align: left; }
                      .idp-match2-tag { border: 1px solid var(--eborder); border-radius: 4px; padding: 6px 12px; background: var(--einput); color: var(--etext); cursor: grab; font-size: 13px; line-height: 1.25; user-select: none; transition: border-color .12s, box-shadow .12s; }
                      .idp-match2-tag:hover { border-color: var(--eblue); box-shadow: 0 1px 5px rgba(0,0,0,.1); }
                      .idp-match2-tag:active { cursor: grabbing; opacity: .7; }
                      .idp-match2-empty { color: var(--esub); font-size: 12px; padding: 4px 0; }
                      .idp-match2-name { font-size: var(--efont); line-height: 1.3; }
                      .idp-match2-items .idp-dropzone { width: 100%; box-sizing: border-box; min-height: 26px; margin: 0; padding: 3px 10px; line-height: 1.4; }
                      .idp-drag-summary { line-height: 2.2; }
                      /* Giữ giãn dòng cho đoạn tóm tắt kể cả khi mang class highlightable-content (vốn ép line-height 1.15) */
                      .exam-content-block .idp-drag-summary.highlightable-content { line-height: 2.4 !important; }
                      .idp-drag-summary .idp-dropzone { min-width: 96px; }

                      /* Section header Listening */
                      .idp-section-header { font-size: 12px; font-weight: 700; color: #57606a; text-transform: uppercase; letter-spacing: 0.6px; padding: 0 0 8px 0; margin-bottom: 14px; border-bottom: 2px solid #d1d5db; display: flex; align-items: center; gap: 8px; }

                      /* Option letter badge */
                      .idp-opt-letter { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%; border: 1px solid #bbb; font-size: 12px; font-weight: 700; color: #555; flex-shrink: 0; background: #f4f5f7; }
                      .idp-radio-label.selected .idp-opt-letter { border-color: #0969da; color: #0969da; background: #e6f0ff; }
                  `}</style>

                  {showScratchpad && (
                      <div style={{ position: 'fixed', bottom: 60, right: 30, width: 350, background: '#fff', border: `1px solid ${idpC.border}`, borderRadius: 8, boxShadow: '0 10px 40px rgba(0,0,0,0.2)', zIndex: 99999, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                          <div style={{ background: idpC.panelBg, padding: '10px 15px', borderBottom: `1px solid ${idpC.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 'bold' }}>
                               My Notes
                              <button onClick={() => setShowScratchpad(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 16, color: idpC.sub }}><Ico name="x" size={16} /></button>
                          </div>
                          <textarea 
                              value={scratchpadText} 
                              onChange={(e: any) => setScratchpadText(e.target.value)}
                              placeholder="Type your rough notes here..."
                              style={{width: '100%', height: 200, border: 'none', padding: 15, resize: 'none', outline: 'none', fontSize: 14, fontFamily: 'monospace'}}
                          />
                      </div>
                  )}

                  {!isFullScreen && userRole === "STUDENT" && !isPreview && (
                      <div style={{position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: '#000', zIndex: 9999999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#fff'}}>
                          <h1 style={{fontSize: 40, fontWeight: 900, textAlign: 'center', color: C.err}}><Ico name="alert" size={34} color={C.err} style={{verticalAlign:'-4px', marginRight:12, display:'inline-block'}} />FULLSCREEN REQUIRED</h1>
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
                  
                  {isOffline && <div style={{background: C.err, color: '#fff', textAlign: 'center', padding: 8, fontWeight: 900, fontSize: 14, animation: 'pulse 1s infinite'}}><Ico name="siren" size={15} color="#fff" style={{verticalAlign:'-2px', marginRight:8, display:'inline-block'}} />CONNECTION LOST! Local auto-save active.</div>}
                  {screenshotFlash && <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: '#fff', zIndex: 2147483647, pointerEvents: 'none' }} />}

                  {!isPreview && (
                      <div style={{
                          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none', zIndex: 9500, overflow: 'hidden',
                          userSelect: 'none', WebkitUserSelect: 'none', display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '50px', padding: '20px', opacity: 0.02
                      }}>
                          {Array.from({ length: 40 }).map((_, i) => (
                              <div key={i} style={{ transform: 'rotate(-30deg)', fontSize: 15, fontWeight: 900, color: '#000', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                                  CONFIDENTIAL | ID: {students.find(s => s.email?.toLowerCase() === currentUser?.email?.toLowerCase())?.name || "Student"} | {currentUser?.email}
                              </div>
                          ))}
                      </div>
                  )}
                  
                  {/* MODAL OPTIONS IDP */}
                  {showOptionsModal && (
                      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, height: '100%', background: 'rgba(0,0,0,0.4)', zIndex: 999999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '15px', boxSizing: 'border-box' }}>
                          <div style={{ width: 600, maxWidth: '100%', maxHeight: '100%', display: 'flex', flexDirection: 'column', background: '#fff', color: '#000', borderRadius: 6, overflow: 'hidden', boxShadow: '0 10px 40px rgba(0,0,0,0.2)' }}>
                              <div style={{ flex: 'none', padding: '16px 20px', display: 'flex', justifyContent: 'center', alignItems: 'center', borderBottom: '1px solid #eee', position: 'relative' }}>
                                  {optionsView !== 'main' && (
                                      <button onClick={() => setOptionsView('main')} style={{ position: 'absolute', left: 20, background: 'none', border: 'none', fontWeight: 'bold', fontSize: 15, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, padding: 0 }}>
                                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg> Options
                                      </button>
                                  )}
                                  <div style={{ fontSize: 18, fontWeight: 500 }}>
                                      {optionsView === 'main' ? 'Options' : optionsView === 'contrast' ? 'Contrast' : 'Text size'}
                                  </div>
                                  <button onClick={() => setShowOptionsModal(false)} style={{ position: 'absolute', right: 20, background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', fontWeight: 'bold', padding: 0, lineHeight: 1 }}>×</button>
                              </div>
                              
                              <div style={{ padding: '24px 30px', overflowY: 'auto', flex: 1, WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' }}>
                                  {optionsView === 'main' && (
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                                          <div onClick={() => setOptionsView('contrast')} style={{ padding: '16px 20px', border: '1px solid #d1d5db', borderRadius: 4, display: 'flex', justifyContent: 'space-between', cursor: 'pointer', fontSize: 16, alignItems: 'center', transition: '0.15s' }} onMouseOver={e => e.currentTarget.style.background='#f4f5f7'} onMouseOut={e => e.currentTarget.style.background='#fff'}>
                                              <div style={{display: 'flex', alignItems: 'center', gap: 12}}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 2v20M12 2a10 10 0 0 1 0 20z" fill="#666"/></svg> Contrast</div>
                                              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
                                          </div>
                                          <div onClick={() => setOptionsView('textsize')} style={{ padding: '16px 20px', border: '1px solid #d1d5db', borderRadius: 4, display: 'flex', justifyContent: 'space-between', cursor: 'pointer', fontSize: 16, alignItems: 'center', transition: '0.15s' }} onMouseOver={e => e.currentTarget.style.background='#f4f5f7'} onMouseOut={e => e.currentTarget.style.background='#fff'}>
                                              <div style={{display: 'flex', alignItems: 'center', gap: 12}}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg> Text size</div>
                                              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
                                          </div>
                                      </div>
                                  )}

                                  {optionsView === 'contrast' && (
                                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                                          {[
                                              { id: 'default', label: 'Black on white', previewBg: '#fff', previewColor: '#000' },
                                              { id: 'dark', label: 'White on black', previewBg: '#000', previewColor: '#fff' },
                                              { id: 'yellow', label: 'Yellow on black', previewBg: '#000', previewColor: '#ffcc00' }
                                          ].map(t => (
                                              <div key={t.id} onClick={() => setExamTheme(t.id as any)} style={{ padding: '16px 20px', border: '1px solid #d1d5db', borderBottom: t.id !== 'yellow' ? 'none' : '1px solid #d1d5db', display: 'flex', justifyContent: 'space-between', cursor: 'pointer', alignItems: 'center', background: examTheme === t.id ? '#f8f9fa' : '#fff' }}>
                                                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 15, fontWeight: examTheme === t.id ? 'bold' : 'normal' }}>
                                                      <div style={{ width: 24, display: 'flex', alignItems: 'center' }}>{examTheme === t.id && <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}</div>
                                                      {t.label}
                                                  </div>
                                                  <div style={{ background: t.previewBg, color: t.previewColor, padding: '4px 12px', border: '1px solid #ccc', fontSize: 12, fontWeight: 'bold' }}>
                                                      {t.label}
                                                  </div>
                                              </div>
                                          ))}
                                      </div>
                                  )}

                                  {optionsView === 'textsize' && (
                                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                                          {[
                                              { id: 'standard', label: 'Standard' },
                                              { id: 'large', label: 'Large' },
                                              { id: 'xlarge', label: 'Extra large' }
                                          ].map((t, idx) => (
                                              <div key={t.id} onClick={() => setExamTextSize(t.id as any)} style={{ padding: '16px 20px', border: '1px solid #d1d5db', borderBottom: idx !== 2 ? 'none' : '1px solid #d1d5db', display: 'flex', alignItems: 'center', gap: 16, cursor: 'pointer', background: examTextSize === t.id ? '#f8f9fa' : '#fff', fontSize: 15, fontWeight: examTextSize === t.id ? 'bold' : 'normal' }}>
                                                  <div style={{ width: 24, display: 'flex', alignItems: 'center' }}>{examTextSize === t.id && <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}</div>
                                                  {t.label}
                                              </div>
                                          ))}
                                      </div>
                                  )}
                              </div>
                          </div>
                      </div>
                  )}

                  {/* MODAL NOTIFICATION BELL IDP */}
                  {showBellModal && currentUser && (
                      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.4)', zIndex: 999999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <div style={{ width: 500, maxWidth: '90%', background: '#fff', color: '#000', borderRadius: 4, overflow: 'hidden', boxShadow: '0 4px 24px rgba(0,0,0,0.15)' }}>
                              <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #eee' }}>
                                  <div style={{ fontSize: 18, fontWeight: 500 }}>Notifications</div>
                                  <button onClick={() => {
                                      setShowBellModal(false);
                                      if (currentUser) {
                                          const nx = students.map(s => (s.email || "").toLowerCase() === (currentUser.email || "").toLowerCase() ? { ...s, pendingNotifications: [] } : s);
                                          setStudents(nx); syncData({ students: nx });
                                      }
                                  }} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', fontWeight: 'bold', padding: 0, lineHeight: 1 }}>×</button>
                              </div>
                              <div style={{ padding: '24px', maxHeight: '60vh', overflowY: 'auto' }}>
                                  {(() => {
                                      const meNotifs = currentUser ? students.find(s => (s.email || "").toLowerCase() === (currentUser.email || "").toLowerCase())?.pendingNotifications : null;
                                      return meNotifs && meNotifs.length > 0 ? (
                                          meNotifs.map((n, i) => (
                                              <div key={i} style={{ padding: '16px', border: '1px solid #e2e8f0', borderRadius: 8, marginBottom: 12, background: '#f8fafc' }}>
                                                  <div style={{ fontWeight: 800, marginBottom: 8, color: '#d32f2f', display: 'flex', alignItems: 'center', gap: 8 }}>
                                                      <Ico name="chat" size={17} color="#d32f2f" style={{flexShrink:0}} /> {n.title}
                                                  </div>
                                                  <div style={{ fontSize: 15, lineHeight: 1.6, color: '#334155' }}>{n.body}</div>
                                              </div>
                                          ))
                                      ) : (
                                          <div style={{ textAlign: 'center', color: '#64748b', padding: '30px 0', fontSize: 15 }}>No new notifications</div>
                                      );
                                  })()}
                              </div>
                              <div style={{ background: '#f8f9fa', padding: '12px 20px', borderTop: '1px solid #eee', textAlign: 'right' }}>
                                  <button onClick={() => {
                                      setShowBellModal(false);
                                      if (currentUser) {
                                          const nx = students.map(s => (s.email || "").toLowerCase() === (currentUser.email || "").toLowerCase() ? { ...s, pendingNotifications: [] } : s);
                                          setStudents(nx); syncData({ students: nx });
                                      }
                                  }} style={{ background: '#24292f', color: '#fff', border: 'none', padding: '8px 24px', borderRadius: 4, fontWeight: 'bold', cursor: 'pointer' }}>Đóng & Đánh dấu đã đọc</button>
                              </div>
                          </div>
                      </div>
                  )}

                  {/* HEADER — Top_Bar chuẩn IDP SẠCH */}
                  <div style={{ display: 'flex', flex: 'none', background: 'var(--epanel)', padding: "0 24px", borderBottom: `1px solid var(--eborder)`, position: "sticky", top: 0, zIndex: 100, justifyContent: "space-between", alignItems: "center", height: 60, color: 'var(--etext)' }}>
                      {/* LEFT: Logo + Exam title */}
                      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                          <img src={examTheme === 'dark' || examTheme === 'yellow' ? "https://d2snzxottmona5.cloudfront.net/releases/3.60.0/images/logo/ielts-white.svg" : "https://d2snzxottmona5.cloudfront.net/releases/3.60.0/images/logo/ielts.svg"} alt="IELTS" style={{ height: 26, userSelect: 'none', flexShrink: 0 }} />
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                              <div style={{ fontWeight: 800, fontSize: 16 }}>{students.find(s => s.email?.toLowerCase() === currentUser?.email?.toLowerCase())?.name || "Student"} | {currentUser?.email}</div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                                  {(!isPreview) && (
                                      <div className={isTimeRunningOut ? 'pulse-fast' : ''} style={{ fontSize: 13, fontWeight: 600, color: isTimeRunningOut ? '#d32f2f' : 'var(--esub)' }}>
                                          {Math.floor(examTimeLeft / 60)} minutes remaining
                                      </div>
                                  )}
                                  {/* STRICT: chỉ báo tĩnh "Audio is Playing" (không có thanh tua) */}
                                  {isListening && (activeExam as any).audioMode !== 'practice' && audioStatus === "PLAYING" && (
                                      <div style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg> Audio is Playing
                                      </div>
                                  )}
                                  {/* PRACTICE: chỉ báo nhẹ trên header — player đầy đủ nằm ở thanh dưới (trên nav bar) */}
                                  {isListening && (activeExam as any).audioMode === 'practice' && audioStatus === "PLAYING" && (
                                      <div style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg> Audio is Playing
                                      </div>
                                  )}
                              </div>
                          </div>
                      </div>

                      {/* RIGHT: Controls */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
                          {/* Preview Exit */}
                          {isPreview && (
                              <button onClick={() => { setActiveExam(null); setIsPreview(false); if (document.fullscreenElement) document.exitFullscreen().catch(()=>{}); }}
                                  style={{background: 'var(--etext)', color: 'var(--ebg)', padding: '6px 16px', fontSize: 13, fontWeight: 700, borderRadius: 3, border: 'none', cursor: 'pointer'}}>
                                  {userRole === "STUDENT" ? "EXIT TEST UI" : "EXIT PREVIEW"}
                              </button>
                          )}

                          {/* WiFi */}
                          <div title={isOffline ? "Offline" : "Online"}>
                              {isOffline ? (
                                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"></path><path d="M10.71 5.05A16 16 0 0 1 22.58 9"></path><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line></svg>
                              ) : (
                                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"></path><path d="M1.42 9a16 16 0 0 1 21.16 0"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line></svg>
                              )}
                          </div>

                          {/* Bell Notification */}
                          <div style={{ position: 'relative', cursor: 'pointer', display: 'flex', alignItems: 'center' }} onClick={() => setShowBellModal(true)}>
                              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
                              {(() => {
                                  const meInExam = currentUser ? students.find(s => (s.email || "").toLowerCase() === (currentUser.email || "").toLowerCase()) : null;
                                  return (meInExam?.pendingNotifications?.length || 0) > 0 ? (
                                      <div style={{ position: 'absolute', top: -6, right: -6, background: '#d32f2f', color: '#fff', fontSize: 10, fontWeight: 'bold', borderRadius: '50%', width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'pulseFast 1s infinite' }}>
                                          {meInExam!.pendingNotifications!.length}
                                      </div>
                                  ) : null;
                              })()}
                          </div>

                          {/* Hamburger Menu */}
                          <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }} onClick={() => { setShowOptionsModal(true); setOptionsView('main'); }}>
                              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
                          </div>

                          {/* Nút Notes (chuẩn Inspera: ✎ trong ô vuông) — mở panel Notes bên phải */}
                          <div title="Notes" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }} onClick={() => { setShowNotesPanel(v => !v); setNoteDeleteIdx(null); setNotesTick(t => t + 1); }}>
                              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                          </div>
                      </div>
                  </div>

                 {/* Thanh chọn Passage trên đầu đã bỏ (đề thi IDP thật không có) — chuyển passage bằng thanh review dưới chân. */}

          {/* BANNER PASSAGE FULL-WIDTH (tràn cả màn hình, không bị splitter ngăn) */}
          {(!String(activeExam.type).toLowerCase().includes("listen") && !(activeExam.type === "Integrated" && currentSectionIndex === 0)) && (() => {
              const navG = navGroups[currentSectionIndex];
              const qStart = navG ? navG.startIndex + 1 : 1;
              const qEnd = navG ? navG.startIndex + navG.questions.length : qStart;
              const label = activeExam.type === "Integrated" ? `PART ${currentSectionIndex + 1}` : `READING PASSAGE ${currentSectionIndex + 1}`;
              return (
                  <div style={{ flex: 'none', background: 'var(--eboxbg)', padding: '12px 40px', textAlign: 'left', borderBottom: '1px solid var(--eborder)' }}>
                      <div style={{ fontWeight: 800, fontSize: 'calc(var(--efont) + 1px)', color: 'var(--etext)', letterSpacing: '0.01em' }}>{label}</div>
                      <div style={{ fontSize: 'var(--efont)', color: 'var(--etext)', marginTop: 2 }}>Read the text and answer questions {qStart}–{qEnd}.</div>
                  </div>
              );
          })()}

          <div className="exam-two-column" style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative', cursor: isDraggingSplitter ? 'col-resize' : 'default' }} onMouseMove={(e: any) => { if (isDraggingSplitter) { const nr = (e.clientX / window.innerWidth) * 100; if (nr > 20 && nr < 80) setSplitRatio(nr); } }} onMouseUp={() => setIsDraggingSplitter && setIsDraggingSplitter(false)} onMouseLeave={() => setIsDraggingSplitter && setIsDraggingSplitter(false)} onTouchMove={(e: any) => { if (isDraggingSplitter && e.touches && e.touches[0]) { e.preventDefault(); const nr = (e.touches[0].clientX / window.innerWidth) * 100; if (nr > 20 && nr < 80) setSplitRatio(nr); } }} onTouchEnd={() => setIsDraggingSplitter && setIsDraggingSplitter(false)} onTouchCancel={() => setIsDraggingSplitter && setIsDraggingSplitter(false)}>
              
              {/* 1. MÀN HÌNH CHỜ AUDIO (CHO LISTENING) */}
              {(String(activeExam.type).toLowerCase().includes("listen") || (activeExam.type === "Integrated" && currentSectionIndex === 0)) && (audioStatus === "IDLE" || audioStatus === "LOADING" || ((activeExam as any).audioMode !== 'practice' && audioStatus === "PAUSED")) && (
                  <div style={{ position: 'absolute', inset: 0, background: 'rgba(30,30,30,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {/* Màn chờ audio — sao chép Inspera: overlay mờ, icon tai nghe TRẮNG (SVG, không emoji), 2 dòng text, nút ⏵ Play trắng */}
                      <div style={{ color: '#fff', textAlign: 'center', maxWidth: 760, width: '92%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                          <svg width="96" height="96" viewBox="0 0 24 24" fill="#ffffff" style={{ marginBottom: 18 }}><path d="M12 2.5a9 9 0 0 0-9 9v5.2A2.8 2.8 0 0 0 5.8 19.5h.7a1.5 1.5 0 0 0 1.5-1.5v-4.5a1.5 1.5 0 0 0-1.5-1.5h-1.5v-.5a7 7 0 0 1 14 0v.5h-1.5a1.5 1.5 0 0 0-1.5 1.5V18a1.5 1.5 0 0 0 1.5 1.5h.7A2.8 2.8 0 0 0 21 16.7v-5.2a9 9 0 0 0-9-9z"/></svg>
                          <div style={{ fontSize: 15, lineHeight: 1.5, marginBottom: 14 }}>
                              {(activeExam as any).audioMode === 'practice'
                                  ? 'You will be listening to an audio clip during this test. Practice mode: you may pause, rewind and replay the audio while answering the questions.'
                                  : 'You will be listening to an audio clip during this test. You will not be permitted to pause or rewind the audio while answering the questions.'}
                          </div>
                          <div style={{ fontSize: 15, marginBottom: 22 }}>To continue, click Play.</div>
                          {renderMeetAudioNotice()}
                          <button onClick={() => { void requestExamAudioPlayback(); }}
                              style={{ background: '#fff', color: '#111', border: 'none', padding: '10px 24px', fontSize: 15, fontWeight: 600, cursor: 'pointer', borderRadius: 4, display: 'inline-flex', alignItems: 'center', gap: 9 }}>
                              <svg width="20" height="20" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#111"/><polygon points="10 8 16.5 12 10 16" fill="#fff"/></svg>
                              Play
                          </button>
                      </div>
                  </div>
              )}

              {/* 2. CỘT TRÁI: CHỈ HIỂN THỊ BÀI ĐỌC (PASSAGE) */}
              {(!String(activeExam.type).toLowerCase().includes("listen") && !(activeExam.type === "Integrated" && currentSectionIndex === 0)) && (
                  <div className="exam-passage-col" style={{ width: (!String(activeExam!.type).toLowerCase().includes("listen") && !(activeExam.type === "Integrated" && currentSectionIndex === 0)) ? `${splitRatio}%` : '100%', height: '100%', overflowY: 'auto', padding: "24px 40px 30px", background: 'var(--ebg)' }}>
                      {(() => {
                          const passageHtml = activeExam?.sections 
                              ? activeExam.sections[currentSectionIndex]?.passage 
                              : (activeExam.passage || "");
                          if (!passageHtml || passageHtml.trim() === "") return <div style={{ color: 'var(--esub)', textAlign: 'center', padding: 40 }}><i>Reading passage content is not available for this section.</i></div>;

                          // MATCHING HEADINGS: dropzone nam TREN moi doan, nhan A/B/C
                          const secQs = activeExam?.sections ? (activeExam.sections[currentSectionIndex]?.questions || []) : (activeExam?.questions || []);
                          const headingQs = secQs.filter((q: any) => q.type === "DRAG_DROP_HEADING");
                          // Marker từ DOCX có thể bị Word bọc bằng div/p/span/strong/em; nhận cả marker đứng trần.
                          const headingSlotPattern = String.raw`(?:<(?:div|p)[^>]*>\s*)?(?:<(?:span|strong|b|em|i)[^>]*>\s*)*\[HEADING_SLOT\]\s*(?:<\/(?:span|strong|b|em|i)>\s*)*(?:<\/(?:div|p)>)?`;
                          const SLOT_RE = new RegExp(headingSlotPattern, "i");
                          if (headingQs.length > 0 && SLOT_RE.test(passageHtml)) {
                              const chunks = passageHtml.split(new RegExp(headingSlotPattern, "gi"));
                              const hOpts = (headingQs.find((q: any) => q.options && q.options.length) || {}).options || [];
                              const lookupHeading = (roman: string) => {
                                  const o = hOpts.find((opt: any) => {
                                      const t = typeof opt === 'string' ? opt : ((opt as any).text || "");
                                      const m = t.match(/^([ivxlcdmIVXLCDM]+)[.)]\s*/i);
                                      return m && m[1].toLowerCase() === (roman || "").toLowerCase();
                                  });
                                  if (!o) return "";
                                  const t = typeof o === 'string' ? o : ((o as any).text || "");
                                  return t.replace(/^[ivxlcdmIVXLCDM]+[.)]\s*/i, '');
                              };
                              return (
                                  <div className="highlightable-content idp-text-content" data-field="sections" data-qid="" style={{ lineHeight: 1.8 }}>
                                      {chunks[0] && chunks[0].trim() && <StaticHtmlBlock html={renderSafeHTML(chunks[0])} />}
                                      {headingQs.map((q: any, i: number) => {
                                          const letter = String.fromCharCode(65 + i);
                                          const filled = examAnswers[q.id] as string;
                                          const isFilled = !!filled;
                                          return (
                                              <React.Fragment key={q.id}>
                                              <div className="idp-heading-slot-render">
                                                  <div id={`question-${q.id}`} style={{display:'flex', alignItems:'center', gap:10, margin:'22px 0 8px'}}>
                                                      <span style={{flexShrink:0, fontWeight:800, fontSize:15, color:'var(--etext)'}}>{letter}</span>
                                                      <div
                                                          onDragOver={(e: any) => e.preventDefault()}
                                                          onDrop={(e: any) => { e.preventDefault(); const val = e.dataTransfer.getData("text/plain"); if (val) handleAnswerChange(q.id, val, "DRAG_DROP"); }}
                                                          onClick={() => { if (isFilled) handleAnswerChange(q.id, ""); }}
                                                          title={isFilled ? "Click to clear" : "Drag a heading here"}
                                                          style={{flex:1, minHeight:40, border:`1.5px dashed ${isFilled ? 'var(--eblue)' : '#bbb'}`, borderRadius:6, display:'flex', alignItems:'center', gap:10, padding:'6px 14px', background: isFilled ? 'rgba(26,115,232,0.06)' : 'var(--ecard)', cursor: isFilled ? 'pointer' : 'default', transition:'all .15s'}}>
                                                          {isFilled ? (
                                                              <>
                                                                  <span style={{fontStyle:'italic', fontWeight:700, fontSize:13, color:'var(--eblue)', flexShrink:0}}>{filled}</span>
                                                                  <span style={{flex:1, fontSize:12.5, color:'var(--etext)', lineHeight:1.4}} dangerouslySetInnerHTML={{__html: renderSafeHTML(lookupHeading(filled))}} />
                                                                  <span style={{fontSize:11, color:'var(--esub)', flexShrink:0, opacity:.6}}>&#10005;</span>
                                                              </>
                                                          ) : (
                                                              <span style={{color:'var(--esub)', fontSize:12.5, fontStyle:'italic'}}>Drag heading here</span>
                                                          )}
                                                      </div>
                                                  </div>
                                              </div>
                                              {chunks[i+1] && chunks[i+1].trim() && <StaticHtmlBlock html={renderSafeHTML(chunks[i+1])} />}
                                              </React.Fragment>
                                          );
                                      })}
                                  </div>
                              );
                          }
                          return <StaticHtmlBlock className="highlightable-content idp-text-content" dataField="sections" dataQid="" html={renderSafeHTML(passageHtml)} style={{ lineHeight: 1.8 }} />;
                      })()}
                  </div>
              )}
              {/* SPLITTER chuẩn Inspera: rãnh xám mảnh + nút vuông ↔ ở giữa. Vùng bắt chuột RỘNG 28px (đè mép 2 cột) — trỏ gần khe là kéo được. */}
              {(!String(activeExam!.type).toLowerCase().includes("listen") && !(activeExam.type === "Integrated" && currentSectionIndex === 0)) && (
                  <div onMouseDown={(e: any) => { e.preventDefault(); setIsDraggingSplitter && setIsDraggingSplitter(true); }}
                       onTouchStart={(e: any) => { e.preventDefault(); setIsDraggingSplitter && setIsDraggingSplitter(true); }}
                       title="Drag to resize"
                       style={{ width: 28, margin: '0 -9px', background: 'transparent', cursor: 'col-resize', zIndex: 30, display: 'flex', alignItems: 'stretch', justifyContent: 'center', flexShrink: 0, position: 'relative' }}>
                       <div style={{ width: 10, background: '#ededed', borderLeft: '1px solid #d1d5db', borderRight: '1px solid #d1d5db', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                           <div style={{ width: 26, height: 26, borderRadius: 2, background: isDraggingSplitter ? '#1b1e2b' : '#fff', border: '1px solid #9aa0a6', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }}>
                               <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={isDraggingSplitter ? '#fff' : '#3a3d47'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="12" x2="20" y2="12"/><polyline points="8 8 4 12 8 16"/><polyline points="16 8 20 12 16 16"/></svg>
                           </div>
                       </div>
                  </div>
              )}
              {/* LỚP PHỦ KHI KÉO: nuốt mọi sự kiện của bảng/text bên dưới -> kéo mượt không bị gò bó */}
              {isDraggingSplitter && (
                  <div style={{ position: 'absolute', inset: 0, zIndex: 9000, cursor: 'col-resize', userSelect: 'none' }}
                       onMouseMove={(e: any) => { const nr = (e.clientX / window.innerWidth) * 100; if (nr > 20 && nr < 80) setSplitRatio(nr); }}
                       onMouseUp={() => setIsDraggingSplitter && setIsDraggingSplitter(false)}
                       onTouchMove={(e: any) => { if (e.touches && e.touches[0]) { const nr = (e.touches[0].clientX / window.innerWidth) * 100; if (nr > 20 && nr < 80) setSplitRatio(nr); } }}
                       onTouchEnd={() => setIsDraggingSplitter && setIsDraggingSplitter(false)} />
              )}
              <div className="exam-question-col" style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--ebg)', position: 'relative' }}>
                  {/* NÚT CHUYỂN CÂU NỔI (giống realieltsexams) */}
                  <div className="idp-qnav-fab no-print">
                      <button className="idp-qnav-btn" title="Câu trước" onClick={() => navigateQuestion(-1)}>
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
                      </button>
                      <button className="idp-qnav-btn" title="Câu sau" onClick={() => navigateQuestion(1)}>
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                      </button>
                  </div>
                  <div id="question-scroll-area" style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: "0 0 84px 0" }}
                       onFocusCapture={markCurrentFromEvent}
                       onClickCapture={markCurrentFromEvent}
                       onInput={(e: any) => {
                           if (e.target && e.target.classList.contains('inline-blank-input')) {
                               e.target.setAttribute('data-dirty', 'true');
                               e.target.classList.toggle('filled', !!e.target.value); // viền xanh ngay khi gõ
                               const qid = e.target.dataset.qid;
                               const val = e.target.value;
                               if ((window as any)[`debounce_${qid}`]) clearTimeout((window as any)[`debounce_${qid}`]);
                               (window as any)[`debounce_${qid}`] = setTimeout(() => { handleAnswerChange(qid, val, "BLANK"); }, 400);
                           }
                       }}
                       onBlur={(e: any) => {
                           if (e.target && e.target.classList.contains('inline-blank-input')) {
                               e.target.removeAttribute('data-dirty');
                               handleAnswerChange(e.target.dataset.qid, e.target.value, "BLANK");
                           }
                       }}
                       onKeyDown={(e: any) => { if (e.key === 'Enter' && e.target && e.target.classList.contains('inline-blank-input')) { const qId = e.target.dataset.qid; if (qId) handleAutoScrollNext((activeExam!.questions || []).findIndex((x:any) => x.id === qId), (activeExam!.questions || []).length); } }}
                       onDragOver={(e: any) => { if (e.target && e.target.classList.contains('idp-dropzone')) e.preventDefault(); }}
                       onDrop={(e: any) => { if (e.target && e.target.classList.contains('idp-dropzone')) { e.preventDefault(); const qId = e.target.dataset.qid; const val = e.dataTransfer.getData("text/plain"); if (qId && val) { handleAnswerChange(qId, val, "DRAG_DROP"); handleAutoScrollNext((activeExam!.questions || []).findIndex((x:any) => x.id === qId), (activeExam!.questions || []).length); } } }}
                       onClick={(e: any) => { if (e.target && e.target.classList.contains('idp-dropzone') && e.target.classList.contains('filled')) { const qId = e.target.dataset.qid; if (qId) handleAnswerChange(qId, ""); } }}>

                      <div style={{ maxWidth: (!String(activeExam!.type).toLowerCase().includes("listen") && !(activeExam!.type === "Integrated" && currentSectionIndex === 0)) ? '100%' : 860, margin: '0 auto', padding: "12px 22px 20px" }}>
                                  {(String(activeExam!.type).toLowerCase().includes("listen") || activeExam.type === "Integrated") && (
                                      <div className="idp-section-header">
                                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zM5 7.5a1.5 1.5 0 013 0v3a1.5 1.5 0 01-3 0v-3zm6 0a1.5 1.5 0 01-3 0v3a1.5 1.5 0 013 0v-3z" fill="#57606a"/></svg>
                                          {activeExam.type === "Integrated" ? `Part ${currentSectionIndex + 1}` : `Part ${currentSectionIndex + 1}`}
                                      </div>
                                  )}
                                  {/* LỌC & RENDER CU HỎI */}
                  {(() => {
                      // ĐàFIX: Gom nhóm câu hỏi trực tiếp từ mảng questions của Tab hiện tại
                      const currentSectionQuestions = activeExam?.sections 
                          ? (activeExam.sections[currentSectionIndex]?.questions || [])
                          : (activeExam?.questions || []);
                          
                      const visibleGroups: { context: string; instruction: string; questions: any[] }[] = [];
                      let tempGroup: { context: string; instruction: string; questions: any[] } | null = null;

                      currentSectionQuestions.forEach((q: any) => {
                          const ctx = q.groupContext || "";
                          const ins = q.instruction || "";
                          // Nếu groupContext có nội dung mới, TÁCH NHÓM MỚI. Nếu rỗng, vẫn gộp vào nhóm cũ để không bị rời rạc
                          const sameContext = !tempGroup || ctx === "" || tempGroup.context === ctx;
                          // Instruction can appear only on the first question of a contiguous group.
                          // Keep following empty-instruction questions in that group so 29-34 stays together.
                          const sameInstruction = !tempGroup || ins === tempGroup.instruction || (ins === "" && tempGroup.instruction !== "");
                          if (!tempGroup || !sameContext || !sameInstruction) {
                              if (tempGroup) visibleGroups.push(tempGroup);
                              tempGroup = { context: ctx, instruction: ins, questions: [q] };
                          } else {
                              if (!tempGroup.instruction && ins) tempGroup.instruction = ins;
                              tempGroup.questions.push(q);
                          }
                      });
                      if (tempGroup) visibleGroups.push(tempGroup);
                      
                      return visibleGroups.map((group) => {
                          // Ô input co giãn theo NHÓM (đáp án DÀI NHẤT + nới thêm) — đồng bộ công thức với App.template.
                          const _gAns = group.questions.filter((q: any) => q.type === 'BLANK').map((q: any) => String(q.correctAnswer || "")).filter((s: string) => s.length > 0);
                          const _gVarLen = (s: string) => Math.max(...s.split('/').map((v: string) => v.trim().length), 0);
                          const _gMaxA = _gAns.length ? Math.max(..._gAns.map(_gVarLen)) : 10;
                          const groupInputW = Math.max(70, Math.min(320, Math.round(_gMaxA * 9) + 30));
                          const _gOpts = ((group.questions.find((q: any) => q.options && q.options.length)?.options) || []).map((o: any) => String(o));
                          const _gAvgO = _gOpts.length ? _gOpts.reduce((a: number, s: string) => a + s.length, 0) / _gOpts.length : 12;
                          const groupZoneW = Math.max(80, Math.min(300, Math.round(_gAvgO * 7.2) + 34));
                          const injectedListRaw = group.context ? processedContexts.contexts[group.context]?.injected || [] : [];
                          const safeHtmlRaw = group.context ? (processedContexts.contexts[group.context]?.html || renderSafeHTML(group.context)) : "";
                          const safeHtml = (() => {
                              if (!safeHtmlRaw) return "";
                              let out = safeHtmlRaw.replace(/\[(\d+)\]/g, (match, num) => {
                                  const tIdx = parseInt(num, 10) - 1;
                                  const tQ = activeExam?.questions?.[tIdx];
                                  if (!tQ) return match;
                                  // PHẢI giống HỆT input của System1 (App.template) để TRƯỚC == SAU highlight.
                                  return `<input type="text" class="idp-inline-input inline-blank-input" data-qid="${tQ.id}" placeholder="${num}" autocomplete="off" style="width:${groupInputW}px" />`;
                              });
                              // Flow-chart: biến <div>↓</div> trơ -> mũi tên có style chuẩn IELTS CBT
                              out = out.replace(/<div[^>]*>\s*(?:↓|⬇|▼|⇩|\|\s*v|->|→)\s*<\/div>/gi, '<div class="idp-flow-arrow">↓</div>');
                              // CHUẨN HÓA SPACING NOTE/FORM (chống "cực thô"): với whiteSpace:pre-wrap, newline
                              // NẰM GIỮA 2 THẺ BLOCK bị render thành dòng trống thừa -> khoảng cách to & lệch.
                              // Gỡ newline giữa các thẻ + gộp newline lặp => spacing do CSS kiểm soát, đều tăm tắp.
                              out = out.replace(/>\s*\n\s*</g, '><').replace(/[ \t]*\n{2,}[ \t]*/g, '\n');
                              return out;
                          })();
                          // CHỐNG Ô INPUT THỪA (nguồn chân lý): câu nào ĐÃ có ô input thực sự hiện trong
                          // context html cuối cùng thì TUYỆT ĐỐI không render thêm ô standalone -> không bao giờ nhân đôi.
                          const injectedList = (() => {
                              const ids = new Set<string>(injectedListRaw);
                              const re = /<input\b[^>]*\bclass="[^"]*inline-blank-input[^"]*"[^>]*>/gi;
                              let m: RegExpExecArray | null;
                              while ((m = re.exec(safeHtml)) !== null) {
                                  const qm = m[0].match(/data-qid="([^"]+)"/i);
                                  if (qm) ids.add(qm[1]);
                              }
                              return Array.from(ids);
                          })();
                          const isDragDropGroup = group.questions.some(q => q.type === "DRAG_DROP");
                  const isFlowChartGroup = false;
                  const dragOptions = isDragDropGroup ? (group.questions.find(q => q.options && q.options.length > 0)?.options || []) : [];
                  // Nhãn 2 cột kéo-thả: rút các dòng nhãn ngắn trong instruction (vd "Attractions", "Areas of the festival").
                  const dragLabels = (() => {
                      // Bóc span highlight/note/temp + thẻ inline TRƯỚC khi tách dòng — nếu không, học sinh highlight
                      // 1 cụm chữ trong instruction là dòng bị cắt đôi -> nhãn cột nhảy lung tung/biến mất.
                      const plain = (group.instruction || "")
                          .replace(/<\/?(?:span|strong|b|em|i|u|mark|sup|sub|a)[^>]*>/gi, "")
                          .replace(/<[^>]+>/g, "\n");
                      return plain.split(/\n+/).map(s => s.trim()).filter(Boolean)
                          .filter(s => s.length <= 28 && /[a-zA-Z]/.test(s) && !/^(questions?|choose|write|complete|match|which|what|who|list of)/i.test(s) && !/\d/.test(s));
                  })();
                  const dragBankLabel = dragLabels[0] || "Options";   // cột trái = kho tag
                  const dragItemsLabel = dragLabels[1] || "";          // cột phải = các mục có ô thả
                  // ẨN 2 dòng nhãn bằng CSS class, KHÔNG xoá khỏi HTML — nếu xoá, học sinh highlight vào instruction
                  // sẽ serialize bản-thiếu-nhãn ghi đè state -> nhãn mất VĨNH VIỄN (bug "Attractions" về "Options").
                  let dragCleanInstruction = group.instruction || "";
                  dragLabels.forEach(l => { dragCleanInstruction = dragCleanInstruction.split(`<div>${l}</div>`).join(`<div class="idp-draglabel-hide">${l}</div>`); });
                  const isMatchingGroup = group.questions.every(q => q.type === "MATCHING");
                  // Matching INFORMATION (option chỉ là chữ cái A-F = nhãn đoạn văn) -> KHÔNG cần legend nhỏ.
                  const isInfoMatching = isMatchingGroup && (group.questions[0]?.options || []).length > 0 && (group.questions[0]?.options || []).every((o: any) => /^[A-Za-z]$/.test(String(o).trim()));
                  const isDragDropHeadingGroup = group.questions.every(q => q.type === "DRAG_DROP_HEADING");
                  const headingOptions = isDragDropHeadingGroup ? (group.questions.find(q => q.options && q.options.length > 0)?.options || []) : [];
                  // WORD-BANK (tóm tắt kéo-thả): nhóm DRAG_DROP có đoạn context + danh sách từ -> render kiểu IELTS Mate
                  const isWordBankDrag = isDragDropGroup && !!group.context && dragOptions.length > 0;
                  const wordBankSummaryHtml = isWordBankDrag ? (() => {
                      let html = renderSafeHTML(group.context);
                      html = html.replace(/\[(\d+)\]/g, (m: string, num: string) => {
                          const tIdx = parseInt(num, 10) - 1;
                          const tQ = (activeExam?.questions || [])[tIdx];
                          if (!tQ) return m;
                          const val = examAnswers[tQ.id];
                          const filled = val !== undefined && val !== "" && !(Array.isArray(val) && val.length === 0);
                          const disp = filled ? String(val) : num;
                          return `<span class="idp-dropzone ${filled ? 'filled' : ''}" data-qid="${tQ.id}" data-num="${num}" style="min-width:${groupZoneW}px">${disp}</span>`;
                      });
                      return html;
                  })() : "";
                  
                  const isHtmlEmpty = (htmlStr: string) => !htmlStr || (!htmlStr.includes('<img') && htmlStr.replace(/<[^>]*>?/gm, '').replace(/ /g, '').trim() === '');
                  const showInstruction = !isHtmlEmpty(group.instruction);

                  // CHỈ HIỂN THỊ CONTEXT Ở CỘT CU HỎI NẾU:
                  // 1. Đang ở layout 1 cột (Listening/Part 1) HOẶC
                  // 2. Form 2 cột nhưng câu hỏi có đoạn văn CONTEXT PHỤ (khác với bài đọc chính đã ở cột trái)
                  const isListeningLayout = String(activeExam!.type).toLowerCase().includes("listen") || (activeExam.type === "Integrated" && currentSectionIndex === 0);
                  const mainPassage = activeExam?.sections ? activeExam.sections[currentSectionIndex]?.passage : (activeExam.passage || visibleGroups[0]?.context || "");
                  const showContext = !isHtmlEmpty(group.context) && (isListeningLayout || group.context !== mainPassage);

                  // ĐàFIX: Tự động tính toán Header "Questions X-Y" chuẩn IDP
                  const firstGlobalIdx = (activeExam.questions || []).findIndex((x:any) => x.id === group.questions[0].id) + 1;
                  const lastGlobalIdx = (activeExam.questions || []).findIndex((x:any) => x.id === group.questions[group.questions.length - 1].id) + 1;
                  const groupTitle = firstGlobalIdx === lastGlobalIdx ? `Question ${firstGlobalIdx}` : `Questions ${firstGlobalIdx}–${lastGlobalIdx}`;
                  
                  // Kiểm tra xem backend đã parse title vào trong instruction/context chưa, nếu chưa thì render
                  const hasHeaderInInstruction = (group.instruction || "").match(/(?:Questions?|QUESTIONS?)\s*\d+(?:\s*(?:-|–|to)\s*\d+)?/i);
                  const hasHeaderInContext = (group.context || "").match(/(?:Questions?|QUESTIONS?)\s*\d+(?:\s*(?:-|–|to)\s*\d+)?/i);
                  const shouldShowAutoHeader = !hasHeaderInInstruction && !hasHeaderInContext;

                  const renderFlowChart = () => (
                      <div className="idp-flowchart-panel">
                          {group.questions.map((q, flowIdx) => {
                              const qGlobalIdx = (activeExam.questions || []).findIndex((x:any) => x.id === q.id) + 1;
                              const rawText = q.text || "";
                              const blankMatch = rawText.match(/_{2,}|\.{4,}|…|…/);
                              const beforeText = blankMatch && blankMatch.index !== undefined ? rawText.slice(0, blankMatch.index) : rawText;
                              const afterText = blankMatch && blankMatch.index !== undefined ? rawText.slice(blankMatch.index + blankMatch[0].length) : "";
                              const isAnsweredFlow = examAnswers[q.id] !== undefined && examAnswers[q.id] !== "";
                              return (
                                  <React.Fragment key={q.id}>
                                      <div id={`question-${q.id}`} className="idp-flowchart-node">
                                          <span className="idp-flowchart-number">{qGlobalIdx}</span>
                                          <StaticHtmlBlock tagName="span" className="highlightable-content idp-flowchart-text" dataField="text" dataQid={q.id} html={renderSafeHTML(beforeText)} />
                                          <input
                                              type="text"
                                              className={`idp-inline-input inline-blank-input ${isAnsweredFlow ? 'filled' : ''}`}
                                              placeholder={qGlobalIdx.toString()}
                                              defaultValue={(examAnswers[q.id] as string) || ""}
                                              onInput={(e: any) => e.target.classList.toggle('filled', !!e.target.value)}
                                              onBlur={(e: any) => handleAnswerChange(q.id, e.target.value, "BLANK")}
                                              onKeyPress={(e: any) => { if(e.key==='Enter') handleAutoScrollNext(qGlobalIdx, (activeExam!.questions || []).length); }}
                                              style={{ textAlign: 'center', minWidth: 140 }}
                                          />
                                          <StaticHtmlBlock tagName="span" className="highlightable-content idp-flowchart-text" dataField="text" dataQid={q.id} html={renderSafeHTML(afterText)} />
                                      </div>
                                      {flowIdx < group.questions.length - 1 && <div className="idp-flowchart-arrow">↓</div>}
                                  </React.Fragment>
                              );
                          })}
                      </div>
                  );

                  return (
                      <div key={group.questions[0].id} style={{marginBottom: 'var(--q-gap)'}}>
                          <div className="question-rubric">
                              {/* Title + Instruction PHẢI là StaticHtmlBlock (memo) — render dangerouslySetInnerHTML thô sẽ bị React
                                  ghi đè ngay khi popup Note/Highlight mở (re-render) -> vùng quét tạm biến mất, không highlight được. */}
                              {shouldShowAutoHeader && <StaticHtmlBlock tagName="h3" className="scorableItemHeadline highlightable-content" html={groupTitle} />}

                              {showInstruction && <StaticHtmlBlock tagName="section" className="idp-instruction highlightable-content" dataField="instruction" dataQid={group.questions[0]?.id} html={renderSafeHTML((isDragDropGroup && dragOptions.length > 0) ? dragCleanInstruction : group.instruction)} />}
                          </div>
                          
                          {showContext && !isWordBankDrag && (
                                      <div className="idp-context-box" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                          <StaticHtmlBlock className="highlightable-content" dataField="groupContext" dataQid={group.questions[0]?.id} html={safeHtml} />
                                  </div>
                          )}

                          {/* WORD-BANK KÉO-THẢ (chuẩn IELTS Mate): lưới từ phía trên + tóm tắt có ô thả inline */}
                          {isWordBankDrag && (
                              <div style={{marginBottom: 20}}>
                                  <div className="idp-wordbank">
                                      {dragOptions.map((opt: string, idx: number) => {
                                          const used = group.questions.some(q => String(examAnswers[q.id] ?? "") === String(opt));
                                          const letter = String.fromCharCode(65 + idx);
                                          return (
                                              <div key={idx} className={`idp-wordbank-item ${used ? 'used' : ''}`} draggable={!used}
                                                   onDragStart={(e: any) => { if (!used) e.dataTransfer.setData("text/plain", opt); }}>
                                                  <span className="idp-wb-letter">{letter}</span>
                                                  <span>{opt}</span>
                                              </div>
                                          );
                                      })}
                                  </div>
                                  <StaticHtmlBlock className="idp-context-box idp-drag-summary highlightable-content" dataField="groupContext" dataQid={group.questions[0]?.id} style={{whiteSpace: 'pre-wrap', wordBreak: 'break-word'}} html={wordBankSummaryHtml} />
                              </div>
                          )}

                          {isWordBankDrag ? null : isFlowChartGroup ? (
                              renderFlowChart()
                          ) : isMatchingGroup && group.questions.length > 0 ? (
                                                      <div style={{overflowX: 'auto'}}>
                                                          <table className="idp-matching-table">
                                                              <thead>
                                                                  <tr>
                                                                      <th style={{border: '1px solid #ccc', background: '#f4f5f7', textAlign: 'left', minWidth: 200, padding: '8px 12px'}}>Question</th>
                                                                      {(group.questions[0].options || []).map((_: any, i: any) => <th key={i}>{String.fromCharCode(65 + i)}</th>)}
                                                                  </tr>
                                                              </thead>
                                                              <tbody>
                                                                  {group.questions.map((q) => {
                                                                      const qGlobalIdx = (activeExam.questions || []).findIndex((x:any) => x.id === q.id) + 1;
                                                                      return (
                                                                          <tr id={`question-${q.id}`} key={q.id}>
                                                                              <td style={{ verticalAlign: 'middle' }}>
                                                                                  <div style={{display: 'flex', gap: 10, alignItems: 'center'}}>
                                                                                      <span style={{border: '1px solid #ccc', padding: '2px 6px', fontSize: 12, background: '#fff', borderRadius: 2, flexShrink: 0}}>{qGlobalIdx}</span>
                                                                                      <StaticHtmlBlock tagName="span" className="highlightable-content" dataField="text" dataQid={q.id} html={renderSafeHTML(q.text)} />
                                                                                  </div>
                                                                              </td>
                                                                              {(group.questions[0].options || []).map((_: any, i: any) => (
                                                                                  <td key={i} style={{background: '#fff', textAlign: 'center', verticalAlign: 'middle'}}>
                                                                                      <input type="radio" checked={examAnswers[q.id] === i} onChange={() => { handleAnswerChange(q.id, i); handleAutoScrollNext((activeExam!.questions || []).findIndex((x:any) => x.id === q.id), (activeExam!.questions || []).length); }} style={{width: 18, height: 18, accentColor: idpC.blueAccent, cursor: 'pointer', margin: '0 auto', display: 'block'}} />
                                                                                  </td>
                                                                              ))}
                                                                          </tr>
                                                                      );
                                                                  })}
                                                              </tbody>
                                                          </table>
                                                          {!isInfoMatching && (
                                                          <div className="idp-matching-legend">
                                                              {(group.questions[0].options || []).map((opt: string, i: number) => (
                                                                  <div key={i} className="idp-matching-legend-item">
                                                                      <span className="idp-matching-legend-key">{String.fromCharCode(65 + i)}</span>
                                                                      <StaticHtmlBlock tagName="span" className="highlightable-content" dataField="options" dataQid={group.questions[0].id} dataOptIndex={String(i)} html={renderSafeHTML(String(opt).replace(/^\s*[A-Za-z][\.\)]\s*/, ''))} />
                                                                  </div>
                                                              ))}
                                                          </div>
                                                          )}
                                                      </div>
                                                  ) : isDragDropHeadingGroup ? (
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
                                                                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{opacity:.4, flexShrink:0, marginTop:2}}><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>
                                                                    <span style={{flexShrink:0, width:28, fontStyle:'italic', fontWeight:700, fontSize:13, color:'var(--eblue)'}}>{optId}</span>
                                                                    <span style={{flex:1, fontSize:13, lineHeight:1.45, color:'var(--etext)'}} dangerouslySetInnerHTML={{__html: renderSafeHTML(optContent)}} />
                                                                  </div>
                                                                );
                                                              })}
                                                            </div>
                                                            <div style={{fontSize:11.5, color:'var(--esub)', fontStyle:'italic', marginTop:4, lineHeight:1.5}}>Drag each heading to the box above its matching paragraph in the passage.</div>
                                                          </div>
                                                        );
                                                      })()
                                                  ) : isDragDropGroup && dragOptions.length > 0 ? (
                                                      (() => {
                                                          // Tái dùng tag khi số câu > số đáp án (vd 7 câu / 3 theorist) -> kho KHÔNG vơi.
                                                          const reuseTags = group.questions.length > dragOptions.length;
                                                          const usedWords = group.questions.map(q => examAnswers[q.id] as string).filter(Boolean);
                                                          const bankWords = reuseTags ? dragOptions : dragOptions.filter((opt: string) => !usedWords.includes(opt));
                                                          return (
                                                          <div className="idp-match2">
                                                              {/* CỘT TRÁI: các mục có ô thả (chuẩn hình 2: Fossil categories / Points made) */}
                                                              <div className="idp-match2-items" style={{gridTemplateColumns: `fit-content(46%) ${groupZoneW}px`}}>
                                                                  {dragItemsLabel && <div className="idp-match2-h">{dragItemsLabel}</div>}
                                                                  {group.questions.map((q:any) => {
                                                                      const gi = (activeExam.questions || []).findIndex((x:any)=>x.id===q.id)+1;
                                                                      const val = examAnswers[q.id] as string;
                                                                      return (
                                                                          <React.Fragment key={q.id}>
                                                                              <span id={`question-${q.id}`} className="idp-match2-name"><StaticHtmlBlock tagName="span" className="highlightable-content" dataField="text" dataQid={q.id} html={renderSafeHTML(q.text)} /></span>
                                                                              <span className={`idp-dropzone ${val ? 'filled' : ''}`} data-qid={q.id}>{val || gi}</span>
                                                                          </React.Fragment>
                                                                      );
                                                                  })}
                                                              </div>
                                                              {/* CỘT PHẢI: kho tag (Features / Theorists) */}
                                                              <div className="idp-match2-bank">
                                                                  <div className="idp-match2-h">{dragBankLabel}</div>
                                                                  {bankWords.map((opt: string, idx: number) => (
                                                                      <div key={idx} className="idp-match2-tag" draggable onDragStart={(e:any) => e.dataTransfer.setData("text/plain", opt)}>{opt}</div>
                                                                  ))}
                                                                  {bankWords.length === 0 && <div className="idp-match2-empty">—</div>}
                                                              </div>
                                                          </div>
                                                          );
                                                      })()
                                                  ) : (
                                                      renderQuestionsList(group, injectedList)
                                                  )}
                                              </div>
                                          );
                                      });
                                  })()}
                              </div>
                          </div>
                      </div>
                  </div>
                 {/* THANH AUDIO (chỉ practice) — nằm ngay TRÊN nav bar: play/pause · thời gian · thanh tua · tốc độ */}
                 {isListening && (activeExam as any).audioMode === 'practice' && ["PLAYING", "PAUSED", "ENDED"].includes(audioStatus) && (() => {
                     const safeCur = Math.min(audioCur, audioDur || 0);
                     const pct = audioDur ? (safeCur / audioDur) * 100 : 0;
                     return (
                         <div className="idp-audio-bar">
                             <button className="idp-audio-play" title="Play / Pause" onClick={() => { const a = audioRef.current; if (!a) return; if (a.paused) void requestExamAudioPlayback(); else pauseExamAudioPlayback(); }}>
                                 {audioStatus === 'PLAYING' ? <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg> : <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>}
                             </button>
                             <span className="idp-audio-time">{fmtTime(Math.floor(safeCur))}</span>
                             <input type="range" className="idp-audio-range" min={0} max={audioDur || 0} step={0.1} value={safeCur}
                                 onChange={(e: any) => { const a = audioRef.current; if (a) { a.currentTime = Number(e.target.value); setAudioCur(Number(e.target.value)); } }}
                                 style={{ background: `linear-gradient(to right, var(--etext) 0%, var(--etext) ${pct}%, var(--eborder) ${pct}%, var(--eborder) 100%)` }} />
                             <span className="idp-audio-time">{fmtTime(Math.floor(audioDur))}</span>
                             <div style={{ display: 'flex', gap: 5, flex: 'none', marginLeft: 4 }}>
                                 {[1, 1.25, 1.5, 2].map(r => (
                                     <button key={r} className={`idp-rate-btn ${audioRate === r ? 'on' : ''}`} title={`Speed ${r}x`} onClick={() => { setAudioRate(r); const a = audioRef.current; if (a) a.playbackRate = r; }}>{r}×</button>
                                 ))}
                             </div>
                         </div>
                     );
                 })()}

                 {/* FOOTER NAVIGATOR — Bottom_Bar chuẩn IDP */}
                {renderMeetAudioNotice()}
                <div className="idp-footer-nav">
                     {/* HÀNG NAVIGATOR: PASSAGE N + ô số (active) / "X of Y" (inactive) */}
                     <div style={{ display: 'flex', alignItems: 'center', flex: 1, overflowX: 'auto', padding: '0 20px', gap: 20, height: '100%' }}>
                         {navGroups.map((grp, gIdx) => {
                             let answered = 0;
                             grp.questions.forEach(q => { const a = examAnswers[q.id]; if (Array.isArray(a) ? a.length > 0 : (a !== undefined && a !== "")) answered++; });
                             const isActive = currentSectionIndex === gIdx;
                             const curId = (examCurrentQId && grp.questions.some(q => q.id === examCurrentQId)) ? examCurrentQId : null;
                             const allDone = grp.questions.length > 0 && answered === grp.questions.length;
                             const pct = grp.questions.length ? Math.round((answered / grp.questions.length) * 100) : 0;
                             return (
                                 <div key={gIdx} style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                                     <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 4, flexShrink: 0 }}>
                                         {/* THANH TIẾN TRÌNH trên nhãn Part: track xám, fill đen theo % câu đã làm; đủ 10/10 -> fill xanh lá 100% */}
                                         <div style={{ height: 3, width: '100%', minWidth: 42, background: '#e5e7eb', borderRadius: 2, overflow: 'hidden' }}>
                                             <div style={{ height: '100%', width: `${pct}%`, background: allDone ? '#16a34a' : '#111827', transition: 'width .25s ease' }} />
                                         </div>
                                         <button className={`idp-pnav-label ${isActive ? 'active' : ''}`} onClick={() => { setCurrentSectionIndex(gIdx); const el = document.getElementById('question-scroll-area'); if (el) el.scrollTop = 0; }} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
                                             {/* Dấu tích XANH LÁ đơn giản (chỉ nét check) — CHỈ khi hoàn thành toàn bộ part */}
                                             {allDone && <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}><polyline points="20 6 9 17 4 12"/></svg>}
                                             <span>{grp.title}</span>
                                         </button>
                                     </div>
                                     {isActive ? (
                                         <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                             {(() => {
                                                 const mergedNavQs: any[] = [];
                                                 const allQs = activeExam.questions || [];
                                                 for (let i = 0; i < grp.questions.length; i++) {
                                                     const q = grp.questions[i];
                                                     if (q.type === 'CHOICE_MULTIPLE') {
                                                         let j = i + 1; const sharedIds = [q.id];
                                                         while (j < grp.questions.length && grp.questions[j].type === 'CHOICE_MULTIPLE' && JSON.stringify(grp.questions[j].options) === JSON.stringify(q.options)) { sharedIds.push(grp.questions[j].id); j++; }
                                                         if (sharedIds.length > 1) {
                                                             const lastQ = grp.questions[j - 1];
                                                             const startNo = getQuizQuestionNumber(allQs, q.id);
                                                             const endNo = getQuizQuestionNumber(allQs, lastQ.id) + getQuestionPointCount(lastQ) - 1;
                                                             mergedNavQs.push({ isMerged: true, mergedIds: sharedIds, startIndex: startNo - 1, endIndex: endNo - 1 });
                                                             i = j - 1;
                                                             continue;
                                                         }
                                                     }
                                                     const startNo = getQuizQuestionNumber(allQs, q.id);
                                                     const endNo = startNo + getQuestionPointCount(q) - 1;
                                                     mergedNavQs.push({ isMerged: false, id: q.id, startIndex: startNo - 1, endIndex: endNo - 1 });
                                                 }
                                                 return mergedNavQs.map(mq => {
                                                     const isMerged = mq.isMerged; const qIds = isMerged ? mq.mergedIds : [mq.id];
                                                     const numberLabel = mq.endIndex > mq.startIndex ? `${mq.startIndex + 1}-${mq.endIndex + 1}` : `${mq.startIndex + 1}`;
                                                     const isAns = qIds.some((id: string) => Array.isArray(examAnswers[id]) ? (examAnswers[id] as any[]).length > 0 : (examAnswers[id] !== undefined && examAnswers[id] !== ""));
                                                     const isFlagged = qIds.some((id: string) => flaggedQuestions?.includes(id));
                                                     const isCur = qIds.includes(curId);
                                                     return (
                                                         <button key={qIds[0]} className={`idp-nav-sq ${isAns ? 'ans' : ''} ${isFlagged ? 'flagged' : ''} ${isCur ? 'cur' : ''}`}
                                                             onClick={() => {
                                                                 setExamCurrentQId(qIds[0]);
                                                                 const el = findQuestionEl(qIds[0]);
                                                                 if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); flashQuestion(qIds[0]); }
                                                             }}>
                                                             {numberLabel}
                                                         </button>
                                                     );
                                                 });
                                             })()}
                                         </div>
                                     ) : (
                                         <span style={{ fontSize: 12, color: '#9ca3af', whiteSpace: 'nowrap' }}>{answered} of {grp.questions.length}</span>
                                     )}
                                 </div>
                             );
                         })}
                     </div>

                     <div style={{ display: 'flex', alignItems: 'stretch', flex: 'none', borderLeft: '1px solid var(--eborder)', background: 'var(--ebg)', padding: 0 }}>
                         <button className="idp-submit-fab" title="Submit Exam" onClick={() => submitExam(false)}>
                             <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                         </button>
                     </div>
                 </div>

                 {/* POPUP BÔI ĐEN — sao chép Inspera: [Note 「」] | [Highlight ✎] */}
                 {selectionMenu && (
                     <div className="idp-popup-menu" style={{ left: selectionMenu!.x, top: selectionMenu!.y }}>
                         <button className="idp-popup-btn" onMouseDown={(e) => { e.preventDefault(); applyCustomAction('NOTE'); }} onTouchStart={(e) => { e.preventDefault(); applyCustomAction('NOTE'); }}>
                             {/* Icon Inspera 16x16: quote kép đặc “ */}
                             <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path fillRule="evenodd" d="M3.2 3.5h3.6v3.9H4.9c0 1.35.65 2.15 2 2.6l-.65 2.5C3.9 11.9 3.2 10.2 3.2 7.9V3.5zm6 0h3.6v3.9h-1.9c0 1.35.65 2.15 2 2.6l-.65 2.5c-2.35-.6-3.05-2.3-3.05-4.6V3.5z"/></svg>
                             Note
                         </button>
                         <button className="idp-popup-btn" onMouseDown={(e) => { e.preventDefault(); applyCustomAction('HIGHLIGHT'); }} onTouchStart={(e) => { e.preventDefault(); applyCustomAction('HIGHLIGHT'); }}>
                             {/* Icon Inspera 16x16: con trỏ chữ I + vệt highlight dưới chân */}
                             <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path fillRule="evenodd" d="M6.9 1.5c.9 0 1.3.3 1.6.7.3-.4.7-.7 1.6-.7v1.2c-.7 0-1 .35-1 1v5.6c0 .65.3 1 1 1v1.2c-.9 0-1.3-.3-1.6-.7-.3.4-.7.7-1.6.7v-1.2c.7 0 1-.35 1-1V3.7c0-.65-.3-1-1-1V1.5z"/><rect x="3" y="13" width="10" height="2.2" rx="0.4"/></svg>
                             Highlight
                         </button>
                     </div>
                 )}

                 {/* PANEL NOTES BÊN PHẢI (chuẩn Inspera) — đọc từ STATE nên thấy notes của MỌI passage/section */}
                 {showNotesPanel && (() => {
                     void notesTick;
                     type NoteRef = { key: string; secIdx: number; qid: string | null; field: string; optIndex: number | null; occ: number; snippet: string; note: string };
                     const _tmp = document.createElement('div');
                     const notes: NoteRef[] = [];
                     const scanHtml = (html: string, base: { secIdx: number; qid: string | null; field: string; optIndex: number | null; keyBase: string }) => {
                         if (!html || html.indexOf('student-note-hl') === -1) return;
                         _tmp.innerHTML = html;
                         Array.from(_tmp.querySelectorAll('.student-note-hl')).forEach((sp, occ) => {
                             notes.push({ secIdx: base.secIdx, qid: base.qid, field: base.field, optIndex: base.optIndex, occ, snippet: (sp.textContent || '').trim(), note: sp.getAttribute('data-note') || '', key: `${base.keyBase}#${occ}` });
                         });
                     };
                     const secList = (activeExam?.sections && activeExam.sections.length) ? activeExam.sections : null;
                     if (secList) secList.forEach((sec: any, si: number) => scanHtml(sec.passage || '', { secIdx: si, qid: null, field: 'passage', optIndex: null, keyBase: `sec${si}` }));
                     else if (activeExam?.passage) scanHtml(activeExam.passage, { secIdx: 0, qid: null, field: 'passage', optIndex: null, keyBase: 'passage' });
                     const seenShared = new Set<string>();
                     (activeExam?.questions || []).forEach((q: any) => {
                         const si = Math.max(0, navGroups.findIndex(g => g.questions.some((x: any) => x.id === q.id)));
                         scanHtml(q.text || '', { secIdx: si, qid: q.id, field: 'text', optIndex: null, keyBase: `t${q.id}` });
                         if (q.instruction && !seenShared.has('i:' + q.instruction)) { seenShared.add('i:' + q.instruction); scanHtml(q.instruction, { secIdx: si, qid: q.id, field: 'instruction', optIndex: null, keyBase: `i${q.id}` }); }
                         if (q.groupContext && !seenShared.has('c:' + q.groupContext)) { seenShared.add('c:' + q.groupContext); scanHtml(q.groupContext, { secIdx: si, qid: q.id, field: 'groupContext', optIndex: null, keyBase: `c${q.id}` }); }
                         (q.options || []).forEach((op: any, oi: number) => {
                             const s = String(op || '');
                             if (s.indexOf('student-note-hl') !== -1 && !seenShared.has('o:' + s)) { seenShared.add('o:' + s); scanHtml(s, { secIdx: si, qid: q.id, field: 'options', optIndex: oi, keyBase: `o${q.id}_${oi}` }); }
                         });
                     });
                     // LƯỚI AN TOÀN: note đang hiển thị trên DOM nhưng chưa lọt vào state (vd bài đọc) -> vẫn hiện trong panel
                     const stateKeys = new Set(notes.map(n2 => n2.snippet + '||' + n2.note));
                     Array.from(document.querySelectorAll('.exam-content-block .student-note-hl')).forEach((el, di) => {
                         const snippet = (el.textContent || '').trim();
                         const note = el.getAttribute('data-note') || '';
                         if (!stateKeys.has(snippet + '||' + note)) notes.push({ key: `dom${di}`, secIdx: currentSectionIndex, qid: null, field: '__dom', optIndex: null, occ: di, snippet, note });
                     });
                     const findDomEl = (n: NoteRef): HTMLElement | null => {
                         const els = Array.from(document.querySelectorAll('.exam-content-block .student-note-hl')) as HTMLElement[];
                         return els.find(e => (e.textContent || '').trim() === n.snippet && (e.getAttribute('data-note') || '') === n.note) || null;
                     };
                     const getRangeLabel = (n: NoteRef): string => {
                         const qs = activeExam?.questions || [];
                         const gIdx = qs.findIndex((q: any) => q.id === n.qid);
                         if (gIdx < 0) return (navGroups[n.secIdx]?.title || `Section ${n.secIdx + 1}`);
                         const ins = (qs[gIdx] as any).instruction || "";
                         let s = gIdx, e2 = gIdx;
                         while (s > 0 && ((qs[s - 1] as any).instruction || "") === ins) s--;
                         while (e2 < qs.length - 1 && ((qs[e2 + 1] as any).instruction || "") === ins) e2++;
                         return s === e2 ? `${s + 1}` : `${s + 1}–${e2 + 1}`;
                     };
                     // Sửa/xóa note = phẫu thuật TRÊN STATE (không cần DOM đang hiển thị) -> hoạt động liên passage
                     const mutateNote = (n: NoteRef, newNote: string | null) => {
                         if (n.field === '__dom') {
                             // Note chỉ có trong DOM: sửa trực tiếp node + serialize container về state
                             const el = findDomEl(n); if (!el) return;
                             const container = el.closest('.highlightable-content') as HTMLElement | null;
                             if (newNote === null) { const p = el.parentNode; if (p) { while (el.firstChild) p.insertBefore(el.firstChild, el); p.removeChild(el); (p as any).normalize?.(); } }
                             else el.setAttribute('data-note', newNote);
                             if (container) {
                                 const field = container.getAttribute('data-field'); const qId = container.getAttribute('data-qid'); const optIndex = container.getAttribute('data-optindex');
                                 if (field) { const cleanHTML = serializeHighlightHTML(container); setActiveExam(prev => syncHighlightState(prev, field, qId || '', cleanHTML, optIndex)); }
                             }
                             window.setTimeout(() => setNotesTick(t => t + 1), 0);
                             return;
                         }
                         const srcQ = (activeExam?.questions || []).find((x: any) => x.id === n.qid);
                         const src = n.field === 'passage'
                             ? (secList ? (secList[n.secIdx]?.passage || '') : (activeExam?.passage || ''))
                             : (n.field === 'options' ? String(((srcQ as any)?.options || [])[n.optIndex!] || '') : String((srcQ as any)?.[n.field] || ''));
                         if (!src) return;
                         _tmp.innerHTML = src;
                         const sp = _tmp.querySelectorAll('.student-note-hl')[n.occ] as HTMLElement | undefined;
                         if (!sp) return;
                         if (newNote === null) { const p = sp.parentNode; if (p) { while (sp.firstChild) p.insertBefore(sp.firstChild, sp); p.removeChild(sp); (p as any).normalize?.(); } }
                         else sp.setAttribute('data-note', newNote);
                         const clean = _tmp.innerHTML;
                         if (n.field === 'passage') {
                             setActiveExam(prev => {
                                 if (!prev) return prev;
                                 if (prev.sections && prev.sections.length) {
                                     const ns = [...prev.sections]; ns[n.secIdx] = { ...ns[n.secIdx], passage: clean };
                                     return { ...prev, sections: ns, passage: n.secIdx === 0 ? clean : prev.passage };
                                 }
                                 return { ...prev, passage: clean };
                             });
                         } else {
                             setActiveExam(prev => syncHighlightState(prev, n.field, n.qid || '', clean, n.field === 'options' ? String(n.optIndex) : null));
                         }
                         window.setTimeout(() => setNotesTick(t => t + 1), 0);
                     };
                     const jumpTo = (n: NoteRef) => {
                         const doJump = () => {
                             const els = Array.from(document.querySelectorAll('.exam-content-block .student-note-hl')) as HTMLElement[];
                             const el = els.find(e => (e.textContent || '').trim() === n.snippet && (e.getAttribute('data-note') || '') === n.note);
                             if (!el) return;
                             el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                             el.classList.remove('idp-q-focus-flash'); void el.offsetWidth; el.classList.add('idp-q-focus-flash');
                             window.setTimeout(() => el.classList.remove('idp-q-focus-flash'), 1700);
                         };
                         if (n.secIdx >= 0 && n.secIdx !== currentSectionIndex) { setCurrentSectionIndex(n.secIdx); window.setTimeout(doJump, 550); }
                         else doJump();
                     };
                     return (
                         <div className="idp-notes-panel">
                             <div className="idp-notes-panel-head">
                                 <span>Notes</span>
                                 <button onClick={() => { setShowNotesPanel(false); setNoteDeleteIdx(null); }} title="Close" style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', lineHeight: 1, color: 'inherit', padding: 0 }}>×</button>
                             </div>
                             <div className="idp-notes-panel-body">
                                 {notes.length === 0 && <div style={{ color: '#6b7280', fontSize: 13, padding: '14px 4px' }}>No notes yet. Select text and choose “Note”.</div>}
                                 {notes.map((n) => {
                                     const range = getRangeLabel(n);
                                     const confirming = noteDeleteIdx === n.key;
                                     return (
                                         <div key={n.key} className={`idp-note-item ${confirming ? 'confirm' : ''}`}>
                                             {(() => {
                                                 // Chuẩn Inspera: snippet dài -> cắt gọn + nút Show more / Show less
                                                 const SNIP_LIMIT = 110;
                                                 const isLong = n.snippet.length > SNIP_LIMIT;
                                                 const expanded = !!noteExpandKeys[n.key];
                                                 const shown = isLong && !expanded ? n.snippet.slice(0, SNIP_LIMIT).trimEnd() + '…' : n.snippet;
                                                 return (
                                                     <>
                                                         <button className="idp-note-jump" onClick={() => jumpTo(n)}>
                                                             <strong>{range}</strong> <em>{shown}</em>
                                                         </button>
                                                         {isLong && (
                                                             <button className="idp-note-link" style={{ display: 'block', padding: '2px 0 6px', fontSize: 12.5 }}
                                                                 onClick={() => setNoteExpandKeys(p => ({ ...p, [n.key]: !expanded }))}>
                                                                 {expanded ? 'Show less' : 'Show more'}
                                                             </button>
                                                         )}
                                                     </>
                                                 );
                                             })()}
                                             <input
                                                 className="idp-note-panel-input"
                                                 type="text"
                                                 placeholder="Start typing your note"
                                                 defaultValue={n.note}
                                                 onKeyDown={(e: any) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                                                 onBlur={(e: any) => { const v = e.currentTarget.value; if (v !== n.note) mutateNote(n, v); }}
                                             />
                                             {!confirming ? (
                                                 <div style={{ textAlign: 'right' }}>
                                                     <button className="idp-note-link" onClick={() => setNoteDeleteIdx(n.key)}>Delete</button>
                                                 </div>
                                             ) : (
                                                 <>
                                                     <div style={{ fontSize: 13, margin: '8px 0 10px', lineHeight: 1.45 }}>You are about to delete a note from questions {range}</div>
                                                     <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 18 }}>
                                                         <button className="idp-note-link light" onClick={() => setNoteDeleteIdx(null)}>Cancel</button>
                                                         <button className="idp-note-link light" onClick={() => { setNoteDeleteIdx(null); mutateNote(n, null); }}>Confirm deleting</button>
                                                     </div>
                                                 </>
                                             )}
                                         </div>
                                     );
                                 })}
                             </div>
                         </div>
                     );
                 })()}

                 {/* COMPONENT NOTE INPUT THEO HÌNH ẢNH */}
                 {noteInputMenu && (
                     <div className="idp-note-input-modal" style={{ left: noteInputMenu!.x, top: noteInputMenu!.y }}>
                         <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                             <input 
                                 type="text" 
                                 autoFocus
                                 placeholder="Add note..." 
                                 value={noteInputMenu!.text} 
                                 onChange={e => setNoteInputMenu(prev => prev ? {...prev, text: e.target.value} : null)}
                                 style={{ flex: 1, padding: '8px 12px', border: '1px solid #ccc', borderRadius: 4, outline: 'none', fontSize: 13, color: '#000', background: '#fff' }} 
                                 onKeyDown={(e) => { if (e.key === 'Enter') executeHighlightOrNote('NOTE', noteInputMenu!.text); }}
                             />
                             <button 
                                 onClick={() => executeHighlightOrNote('NOTE', noteInputMenu!.text)}
                                 style={{ background: noteInputMenu!.text ? '#eab308' : '#d1d5db', color: noteInputMenu!.text ? '#fff' : '#6b7280', border: 'none', padding: '0 16px', borderRadius: 4, fontWeight: 700, cursor: 'pointer', transition: '0.2s' }}
                             >
                                 Save
                             </button>
                         </div>
                         
                         {noteInputMenu!.existingNode && (
                             <div style={{ display: 'flex', gap: 15, marginTop: 12, paddingTop: 10, borderTop: '1px solid #eee' }}>
                                 <button onClick={() => executeHighlightOrNote('NOTE', null as any)} style={{ background: 'transparent', border: 'none', color: '#333', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                                     <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                                     Delete
                                 </button>
                                 <button onClick={() => executeHighlightOrNote('NOTE', null as any)} style={{ background: 'transparent', border: 'none', color: '#333', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                                             <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                                             Delete All
                                         </button>
                                     </div>
                                 )}
                             </div>
                         )}
                  </div>
              );
          }

      // ==========================================
      // VIEW: STUDENT DASHBOARD
      // ==========================================
  if (userRole === "STUDENT") {
    // --- LỚP BẢO VỆ & ÉP KIỂU (MAGIC FIX): Ép kiểu "as Student" sẽ dập tắt 100% mọi cảnh báo "possibly undefined" của TS ---
    const me = students.find(s => (s.email || "").toLowerCase() === (currentUser?.email || "").toLowerCase()) as Student;
    
    // ============================================================================
    // COSMETIC VĨNH VIỄN (quà gacha): Theme giao diện / Khung avatar / Linh thú.
    // CHỈ áp cho portal học viên — KHÔNG đụng phòng thi (đã return trước block này).
    // Khai báo TRƯỚC guard (!me) để 'C' đã shadow xong khi guard dùng C.sub (tránh TDZ).
    // ============================================================================
    const STUDENT_THEMES: Record<string, Record<string, string>> = {
      "Giao diện: Hoàng Kim": { bg: '#171206', card: '#221A0C', border: 'rgba(231,196,112,0.22)', text: '#F6EBCB', sub: '#C2A867', accent: '#E7C470', succ: '#D8B85A', warn: '#E9C15A', err: '#E59072', glow: '#E7C470' },
      "Giao diện: Nửa Đêm":   { bg: '#080E1C', card: '#0F1A2E', border: 'rgba(124,164,236,0.20)', text: '#E6EDFB', sub: '#90A6C8', accent: '#7CA4EC', succ: '#56C7A8', warn: '#E9C15A', err: '#EC8B86', glow: '#5B8BE0' },
      "Giao diện: Anh Đào":   { bg: '#FFF1F4', card: '#FFFFFF', border: 'rgba(232,140,168,0.28)', text: '#5A2740', sub: '#A8728A', accent: '#E86A98', succ: '#14B8A6', warn: '#F59E0B', err: '#EF4444', glow: '#F7B8CE' },
      "Giao diện: Rừng Sâu":  { bg: '#08130F', card: '#0E1D17', border: 'rgba(78,196,158,0.20)', text: '#DBF2E9', sub: '#84B3A1', accent: '#4EC2A0', succ: '#4EC2A0', warn: '#E9C15A', err: '#EC8B86', glow: '#3FB58F' },
    };
    // Tên các vật phẩm cosmetic (render bằng SVG tự vẽ — xem renderFrameArt / renderPetArt phía dưới)
    const STUDENT_FRAME_NAMES = ["Khung avatar: Vương Miện", "Khung avatar: Rồng Lửa", "Khung avatar: Băng Giá", "Khung avatar: Cầu Vồng", "Khung avatar: Sao Băng"];
    const STUDENT_PET_NAMES = ["Linh thú: Cú Mèo", "Linh thú: Mèo Thần Tài", "Linh thú: Rồng Con", "Linh thú: Cáo Lửa", "Linh thú: Chim Cánh Cụt", "Linh thú: Gấu Trúc"];
    const _eqTheme = me?.inventory?.equippedTheme || '';
    const _themed = !!STUDENT_THEMES[_eqTheme];
    const C = _themed ? { ..._C_BASE, ...STUDENT_THEMES[_eqTheme] } : _C_BASE;
    // glow lấy từ theme (C có thể là _C_BASE không có 'glow') — fallback accent cho an toàn kiểu.
    const _glow = (STUDENT_THEMES[_eqTheme] && STUDENT_THEMES[_eqTheme].glow) || C.accent;

    // NẾU KHÔNG CÓ "ME", CHẶN LUÔN VÀ KHÔNG CHẠY CODE BÊN DƯỚI NỮA
    if (!me) {
        return <div style={{padding: 50, textAlign: 'center', fontSize: 20, color: C.sub}}>{t('loading_student')}</div>;
    }

    // ===================== COSMETIC ART (SVG tự vẽ, KHÔNG emoji) =====================

    // --- KHUNG AVATAR: vòng SVG nhiều lớp (halo nhịp thở + vòng nền + vòng accent xoay + tia lấp lánh + hoạ tiết) ---
    const FRAME_META: Record<string, any> = {
      "Khung avatar: Vương Miện": { g: ['#FFF7DD', '#F2D27A', '#A9802F'], ac: '#FFE9A8', spark: '#FFFDF0', glow: '#E7C470', gem: '#C0392B', gem2: '#2E86C1' },
      "Khung avatar: Rồng Lửa":   { g: ['#FFE08A', '#F97316', '#B91C1C'], ac: '#FFB454', spark: '#FFE7B0', glow: '#F7531C' },
      "Khung avatar: Băng Giá":   { g: ['#F2FEFF', '#7DD3FC', '#2563EB'], ac: '#CDEFFF', spark: '#FFFFFF', glow: '#5BD0F5' },
      "Khung avatar: Cầu Vồng":   { g: ['#F87171', '#FBBF24', '#34D399'], ac: '#60A5FA', spark: '#FFFFFF', glow: '#A78BFA' },
      "Khung avatar: Sao Băng":   { g: ['#EDE9FE', '#A78BFA', '#5B21B6'], ac: '#C4B5FD', spark: '#FFFFFF', glow: '#8B5CF6' },
    };
    // Mỗi khung 1 bản sắc riêng, nhiều lớp SVG động (KHÔNG emoji). Dùng cho header (64) + kho đồ (32).
    const renderFrameArt = (name: string, size: number = 64, ctx: string = '') => {
      const m = FRAME_META[name]; if (!m) return null;
      const uid = 'fr' + name.replace(/[^a-z0-9]/gi, '') + ctx;
      const ring = (n: number, r: number) => Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2 - Math.PI / 2; return { x: +(32 + r * Math.cos(a)).toFixed(2), y: +(32 + r * Math.sin(a)).toFixed(2), deg: +((i / n) * 360).toFixed(1) }; });
      const halo = (values: string, dur: string) => <circle cx="32" cy="32" r="31" fill={`url(#${uid}h)`}><animate attributeName="opacity" values={values} dur={dur} repeatCount="indefinite" /></circle>;
      const wrap = (kids: any, extra: any = null) => (
        <svg width={size} height={size} viewBox="0 0 64 64" style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}>
          <defs>
            <linearGradient id={uid + 'g'} x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor={m.g[0]} /><stop offset="50%" stopColor={m.g[1]} /><stop offset="100%" stopColor={m.g[2]} /></linearGradient>
            <radialGradient id={uid + 'h'}><stop offset="50%" stopColor={m.glow} stopOpacity="0" /><stop offset="82%" stopColor={m.glow} stopOpacity="0.55" /><stop offset="100%" stopColor={m.glow} stopOpacity="0" /></radialGradient>
            <filter id={uid + 'bl'} x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="1.3" /></filter>
            {extra}
          </defs>
          {kids}
        </svg>
      );

      // ===== VƯƠNG MIỆN — vương miện nạm ngọc + vòng ngọc xoay + tia chớp sáng =====
      if (name === "Khung avatar: Vương Miện") {
        const gems = ring(10, 27);
        return wrap(<>
          {halo('0.4;0.85;0.4', '3.6s')}
          <circle cx="32" cy="32" r="28" fill="none" stroke={`url(#${uid}g)`} strokeWidth="1.4" opacity="0.7" />
          <circle cx="32" cy="32" r="25.4" fill="none" stroke={m.ac} strokeWidth="0.9" opacity="0.45" />
          <g>
            {gems.map((p, i) => <g key={i} transform={`translate(${p.x} ${p.y}) rotate(${p.deg})`}><path d="M0 -2 L1.6 0 L0 2 L-1.6 0 Z" fill={i % 3 === 0 ? m.gem : i % 3 === 1 ? m.gem2 : m.spark} stroke={m.g[2]} strokeWidth="0.3"><animate attributeName="opacity" values="0.6;1;0.6" dur={`${2 + (i % 4) * 0.4}s`} repeatCount="indefinite" /></path></g>)}
            <animateTransform attributeName="transform" type="rotate" from="0 32 32" to="360 32 32" dur="24s" repeatCount="indefinite" />
          </g>
          <g><path d="M32 5 A27 27 0 0 1 50.1 12.2" fill="none" stroke={m.spark} strokeWidth="2.2" strokeLinecap="round" opacity="0.9" filter={`url(#${uid}bl)`} /><animateTransform attributeName="transform" type="rotate" from="0 32 32" to="360 32 32" dur="4.5s" repeatCount="indefinite" /></g>
          <g><path d="M23 9 L27 14 L32 5 L37 14 L41 9 L39 16.5 L25 16.5 Z" fill={`url(#${uid}g)`} stroke={m.g[2]} strokeWidth="0.6" />
            <circle cx="32" cy="11.5" r="1.5" fill={m.gem} /><circle cx="27" cy="14" r="1" fill={m.gem2} /><circle cx="37" cy="14" r="1" fill={m.gem2} />
            <circle cx="32" cy="4" r="1.6" fill={m.spark}><animate attributeName="opacity" values="0.5;1;0.5" dur="1.8s" repeatCount="indefinite" /></circle></g>
        </>);
      }

      // ===== RỒNG LỬA — vòng lửa nhiễu loạn (turbulence) + ngọn lửa chớp + tàn lửa bay lên =====
      if (name === "Khung avatar: Rồng Lửa") {
        const tongues = ring(12, 26.5);
        const turb = <filter id={uid + 'tb'} x="-30%" y="-30%" width="160%" height="160%"><feTurbulence type="fractalNoise" baseFrequency="0.03 0.07" numOctaves="2" seed="3" result="t"><animate attributeName="baseFrequency" values="0.03 0.06;0.04 0.09;0.03 0.06" dur="2.6s" repeatCount="indefinite" /></feTurbulence><feDisplacementMap in="SourceGraphic" in2="t" scale="3" /></filter>;
        return wrap(<>
          {halo('0.5;1;0.5', '1.6s')}
          <g filter={`url(#${uid}tb)`}>
            <g>
              {tongues.map((p, i) => <g key={i} transform={`translate(${p.x} ${p.y}) rotate(${p.deg})`}><path d="M0 3 Q-2.2 -2 0 -6.5 Q2.2 -2 0 3 Z" fill={`url(#${uid}g)`}><animate attributeName="opacity" values={`${0.45 + (i % 3) * 0.2};1;${0.45 + (i % 3) * 0.2}`} dur={`${0.6 + (i % 4) * 0.15}s`} repeatCount="indefinite" /></path></g>)}
              <animateTransform attributeName="transform" type="rotate" from="0 32 32" to="360 32 32" dur="11s" repeatCount="indefinite" />
            </g>
          </g>
          <circle cx="32" cy="32" r="24.2" fill="none" stroke={m.ac} strokeWidth="1.1" opacity="0.5" />
          <g fill={m.spark}>
            {[{ x: 32, d: '2.2s' }, { x: 20, d: '2.7s' }, { x: 44, d: '3s' }, { x: 26, d: '3.3s' }, { x: 39, d: '2.5s' }].map((e, i) => <circle key={i} cx={e.x} cy="50" r={1.5 - (i % 2) * 0.5}><animate attributeName="cy" values="50;6" dur={e.d} begin={`${i * 0.4}s`} repeatCount="indefinite" /><animate attributeName="opacity" values="0;1;0" dur={e.d} begin={`${i * 0.4}s`} repeatCount="indefinite" /><animate attributeName="cx" values={`${e.x};${e.x + (i % 2 ? 5 : -5)}`} dur={e.d} begin={`${i * 0.4}s`} repeatCount="indefinite" /></circle>)}
          </g>
        </>, turb);
      }

      // ===== BĂNG GIÁ — pha lê góc cạnh xoay chậm + bông tuyết 4 hướng + tuyết rơi =====
      if (name === "Khung avatar: Băng Giá") {
        const shards = ring(8, 27);
        return wrap(<>
          {halo('0.45;0.9;0.45', '4.2s')}
          <circle cx="32" cy="32" r="25" fill="none" stroke={m.ac} strokeWidth="1" opacity="0.5" />
          <g>
            {shards.map((p, i) => <g key={i} transform={`translate(${p.x} ${p.y}) rotate(${p.deg})`}><path d="M0 -4.2 L2.5 0 L0 4.2 L-2.5 0 Z" fill={`url(#${uid}g)`} stroke={m.spark} strokeWidth="0.4" opacity="0.9"><animate attributeName="opacity" values="0.55;1;0.55" dur={`${2.5 + (i % 3) * 0.6}s`} repeatCount="indefinite" /></path></g>)}
            <animateTransform attributeName="transform" type="rotate" from="0 32 32" to="360 32 32" dur="26s" repeatCount="indefinite" />
          </g>
          {[[32, 5], [59, 32], [32, 59], [5, 32]].map((c, i) => <g key={i} transform={`translate(${c[0]} ${c[1]})`} stroke={m.spark} strokeWidth="0.85" strokeLinecap="round"><path d="M0 -3 V3 M-2.6 -1.5 L2.6 1.5 M-2.6 1.5 L2.6 -1.5"><animate attributeName="opacity" values="0.5;1;0.5" dur={`${2 + i * 0.3}s`} repeatCount="indefinite" /></path></g>)}
          <g fill={m.spark}>{[{ x: 22, d: '3.6s' }, { x: 42, d: '4.2s' }, { x: 32, d: '3.9s' }].map((s, i) => <circle key={i} cx={s.x} cy="8" r="1"><animate attributeName="cy" values="8;52" dur={s.d} begin={`${i * 0.8}s`} repeatCount="indefinite" /><animate attributeName="opacity" values="0;0.9;0" dur={s.d} begin={`${i * 0.8}s`} repeatCount="indefinite" /></circle>)}</g>
        </>);
      }

      // ===== CẦU VỒNG — vòng phổ màu (conic giả) xoay nhanh + tia trắng quét + lăng kính lấp lánh =====
      if (name === "Khung avatar: Cầu Vồng") {
        const HUES = ['#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#30C0C6', '#007AFF', '#5856D6', '#AF52DE', '#FF2D55', '#FF6B00', '#FFD60A', '#22C55E'];
        const segs = ring(12, 27);
        return wrap(<>
          {halo('0.4;0.85;0.4', '3s')}
          <g>
            {segs.map((p, i) => <g key={i} transform={`translate(${p.x} ${p.y}) rotate(${p.deg})`}><rect x="-1.5" y="-2.8" width="3" height="5.6" rx="1.4" fill={HUES[i % HUES.length]} /></g>)}
            <animateTransform attributeName="transform" type="rotate" from="0 32 32" to="360 32 32" dur="6s" repeatCount="indefinite" />
          </g>
          <g><path d="M32 5 A27 27 0 0 1 52.1 16.4" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" opacity="0.85" filter={`url(#${uid}bl)`} /><animateTransform attributeName="transform" type="rotate" from="0 32 32" to="360 32 32" dur="2.4s" repeatCount="indefinite" /></g>
          <g fill="#FFFFFF">{[[14, 18], [50, 16], [52, 48], [16, 50]].map((c, i) => <path key={i} d={`M${c[0]} ${c[1] - 2.4} l0.7 1.7 1.7 0.7 -1.7 0.7 -0.7 1.7 -0.7 -1.7 -1.7 -0.7 1.7 -0.7 Z`}><animate attributeName="opacity" values="0.2;1;0.2" dur={`${1.4 + i * 0.3}s`} repeatCount="indefinite" /></path>)}</g>
        </>);
      }

      // ===== SAO BĂNG — vũ trụ tím, sao chổi quay quanh để lại vệt + tinh tú lấp lánh =====
      const stars = [[12, 16], [52, 14], [56, 40], [10, 44], [44, 54], [22, 8]];
      return wrap(<>
        {halo('0.4;0.9;0.4', '3.4s')}
        <circle cx="32" cy="32" r="26" fill="none" stroke={m.ac} strokeWidth="1" opacity="0.4" strokeDasharray="2 8"><animateTransform attributeName="transform" type="rotate" from="0 32 32" to="360 32 32" dur="16s" repeatCount="indefinite" /></circle>
        <g fill={m.spark}>{stars.map((c, i) => <circle key={i} cx={c[0]} cy={c[1]} r={0.8 + (i % 2) * 0.5}><animate attributeName="opacity" values="0.2;1;0.2" dur={`${1.2 + i * 0.25}s`} repeatCount="indefinite" /></circle>)}</g>
        <g>
          <g transform="translate(32 5)">
            <path d="M0 0 q-10 1.4 -16.5 5.4" stroke={m.ac} strokeWidth="2.4" strokeLinecap="round" fill="none" opacity="0.5" filter={`url(#${uid}bl)`} />
            <path d="M0 -2.6 l0.85 2 2.1 0.6 -2.1 0.6 -0.85 2 -0.85 -2 -2.1 -0.6 2.1 -0.6 Z" fill={m.spark} />
          </g>
          <animateTransform attributeName="transform" type="rotate" from="0 32 32" to="360 32 32" dur="5.5s" repeatCount="indefinite" />
        </g>
        <path d="M32 2 l1.2 3.2 3.2 1.2 -3.2 1.2 -1.2 3.2 -1.2 -3.2 -3.2 -1.2 3.2 -1.2 Z" fill={m.spark}><animateTransform attributeName="transform" type="rotate" from="0 32 7" to="360 32 7" dur="10s" repeatCount="indefinite" /></path>
      </>);
    };

    // --- LINH THÚ "Living Companion": SVG sticker cao cấp (gradient + mắt bóng + hào quang + bệ sáng
    //     + nhịp thở + chớp mắt + trick riêng + hạt). Nhóm <g className="petEyes"> để con ngươi dõi chuột. ---
    const renderPetArt = (name: string, size: number = 46, uid: string = '') => {
      const U = 'pt' + name.replace(/[^a-zA-Z0-9]/g, '') + uid;
      const blink = (r: number) => <animate attributeName="ry" values={`${r};${r};0.5;${r}`} keyTimes="0;0.9;0.95;1" dur="4.6s" repeatCount="indefinite" />;
      const aura = (c: string) => (<><circle cx="70" cy="74" r="40" fill={`url(#${U}au)`} filter={`url(#${U}bl)`}><animate attributeName="opacity" values="0.65;1;0.65" dur="3.1s" repeatCount="indefinite" /></circle></>);
      const plat = (c: string) => <ellipse cx="70" cy="122" rx="28" ry="6.5" fill={`url(#${U}pl)`}><animate attributeName="rx" values="28;20;28" dur="3.4s" repeatCount="indefinite" /></ellipse>;
      const auraStop = (c: string) => (<radialGradient id={`${U}au`}><stop offset="0%" stopColor={c} stopOpacity="0.5" /><stop offset="60%" stopColor={c} stopOpacity="0.16" /><stop offset="100%" stopColor={c} stopOpacity="0" /></radialGradient>);
      const platStop = (c: string) => (<radialGradient id={`${U}pl`}><stop offset="0%" stopColor={c} stopOpacity="0.5" /><stop offset="100%" stopColor={c} stopOpacity="0" /></radialGradient>);
      const blur = <filter id={`${U}bl`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" /></filter>;

      let defs: any = null, art: any = null;

      if (name === "Linh thú: Cáo Lửa") {
        defs = (<><linearGradient id={`${U}fur`} x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#FCD34D" /><stop offset="48%" stopColor="#F97316" /><stop offset="100%" stopColor="#C2410C" /></linearGradient><radialGradient id={`${U}belly`} cx="50%" cy="35%"><stop offset="0%" stopColor="#FFFBEB" /><stop offset="100%" stopColor="#FFE3BF" /></radialGradient>{auraStop('#FB923C')}{platStop('#F97316')}{blur}</>);
        art = (<><g><path d="M96 92 q34 -6 30 -34 q-9 19 -30 16 Z" fill={`url(#${U}fur)`} /><path d="M120 56 q9 -9 9 -4 q-3 9 -9 8 Z" fill="#FFF3E0" /><animateTransform attributeName="transform" type="rotate" values="-7 96 90;9 96 90;-7 96 90" dur="2.2s" repeatCount="indefinite" /></g>
          <ellipse cx="68" cy="80" rx="31" ry="30" fill={`url(#${U}fur)`} /><path d="M68 60 q-22 2 -19 27 q19 9 19 -5 Z" fill={`url(#${U}belly)`} /><path d="M68 60 q22 2 19 27 q-19 9 -19 -5 Z" fill={`url(#${U}belly)`} />
          <path d="M48 52 L43 30 L60 46 Z" fill={`url(#${U}fur)`} /><path d="M88 52 L93 30 L76 46 Z" fill={`url(#${U}fur)`} /><path d="M49 48 L46 36 L56 45 Z" fill="#3A241B" /><path d="M87 48 L90 36 L80 45 Z" fill="#3A241B" />
          <ellipse cx="56" cy="84" rx="5.5" ry="4" fill="#FBA17A" opacity="0.55" /><ellipse cx="80" cy="84" rx="5.5" ry="4" fill="#FBA17A" opacity="0.55" />
          <g className="petEyes"><ellipse cx="58" cy="74" rx="3.4" ry="4" fill="#2A1A14">{blink(4)}</ellipse><ellipse cx="78" cy="74" rx="3.4" ry="4" fill="#2A1A14">{blink(4)}</ellipse><circle cx="59.3" cy="72.4" r="1.1" fill="#fff" /><circle cx="79.3" cy="72.4" r="1.1" fill="#fff" /></g>
          <path d="M64 82 L68 86 L72 82 Z" fill="#2A1A14" /><path d="M44 60 q24 -14 48 0" stroke="#FFF3E0" strokeWidth="2" fill="none" opacity="0.3" strokeLinecap="round" /></>);
        return (<svg width={size} height={size} viewBox="0 0 140 140" style={{ overflow: 'visible' }}><defs>{defs}</defs>{plat('#F97316')}{aura('#FB923C')}<g className="breathe">{art}</g><g fill="#FDBA74"><circle cx="44" cy="74" r="2"><animate attributeName="cy" values="74;36" dur="2.6s" repeatCount="indefinite" /><animate attributeName="opacity" values="0;1;0" dur="2.6s" repeatCount="indefinite" /></circle><circle cx="92" cy="80" r="1.6"><animate attributeName="cy" values="80;44" dur="3.1s" begin="0.6s" repeatCount="indefinite" /><animate attributeName="opacity" values="0;1;0" dur="3.1s" begin="0.6s" repeatCount="indefinite" /></circle><circle cx="70" cy="44" r="1.3"><animate attributeName="cy" values="44;18" dur="2.9s" begin="1.2s" repeatCount="indefinite" /><animate attributeName="opacity" values="0;1;0" dur="2.9s" begin="1.2s" repeatCount="indefinite" /></circle></g></svg>);
      }

      if (name === "Linh thú: Cú Mèo") {
        defs = (<><linearGradient id={`${U}bd`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6D5BD0" /><stop offset="100%" stopColor="#312E81" /></linearGradient><radialGradient id={`${U}be`} cx="50%" cy="35%"><stop offset="0%" stopColor="#C7D2FE" /><stop offset="100%" stopColor="#818CF8" /></radialGradient>{auraStop('#A78BFA')}{platStop('#818CF8')}{blur}</>);
        art = (<><g><ellipse cx="70" cy="82" rx="30" ry="32" fill={`url(#${U}bd)`} /><ellipse cx="70" cy="88" rx="19" ry="22" fill={`url(#${U}be)`} /><path d="M48 40 L46 26 L60 38 Z" fill={`url(#${U}bd)`} /><path d="M92 40 L94 26 L80 38 Z" fill={`url(#${U}bd)`} />
          <g><circle cx="58" cy="66" r="12" fill="#F8FAFF" /><circle cx="82" cy="66" r="12" fill="#F8FAFF" /><g className="petEyes"><ellipse cx="58" cy="66" rx="5" ry="5.6" fill="#1E1B4B">{blink(5.6)}</ellipse><ellipse cx="82" cy="66" rx="5" ry="5.6" fill="#1E1B4B">{blink(5.6)}</ellipse><circle cx="60" cy="63.5" r="1.7" fill="#fff" /><circle cx="84" cy="63.5" r="1.7" fill="#fff" /></g><path d="M64 74 L70 80 L76 74 Z" fill="#FBBF24" /><path d="M70 30 l1 2.4 2.4 1 -2.4 1 -1 2.4 -1 -2.4 -2.4 -1 2.4 -1 Z" fill="#FDE68A" /><animateTransform attributeName="transform" type="rotate" values="0 70 70;-7 70 70;0 70 70;6 70 70;0 70 70" keyTimes="0;0.12;0.5;0.62;1" dur="6s" repeatCount="indefinite" /></g></g></>);
        return (<svg width={size} height={size} viewBox="0 0 140 140" style={{ overflow: 'visible' }}><defs>{defs}</defs>{plat('#818CF8')}{aura('#A78BFA')}<g fill="#E0E7FF"><path d="M70 18 l1.6 4 4 1.6 -4 1.6 -1.6 4 -1.6 -4 -4 -1.6 4 -1.6 Z" /><circle cx="108" cy="54" r="1.6"><animate attributeName="opacity" values="1;0.2;1" dur="1.4s" repeatCount="indefinite" /></circle><circle cx="32" cy="56" r="1.6"><animate attributeName="opacity" values="0.2;1;0.2" dur="1.7s" repeatCount="indefinite" /></circle><circle cx="104" cy="92" r="1.3"><animate attributeName="opacity" values="1;0.3;1" dur="2s" repeatCount="indefinite" /></circle><circle cx="36" cy="92" r="1.3"><animate attributeName="opacity" values="0.3;1;0.3" dur="1.6s" repeatCount="indefinite" /></circle><animateTransform attributeName="transform" type="rotate" from="0 70 70" to="360 70 70" dur="22s" repeatCount="indefinite" /></g><g className="breathe">{art}</g></svg>);
      }

      if (name === "Linh thú: Mèo Thần Tài") {
        defs = (<><radialGradient id={`${U}bd`} cx="50%" cy="35%"><stop offset="0%" stopColor="#FFFFFF" /><stop offset="100%" stopColor="#EFE7DA" /></radialGradient>{auraStop('#F6C453')}{platStop('#F6C453')}{blur}</>);
        art = (<><path d="M48 46 L44 22 L62 40 Z" fill="#FFFFFF" stroke="#E7E1D6" strokeWidth="1" /><path d="M92 46 L96 22 L78 40 Z" fill="#FFFFFF" stroke="#E7E1D6" strokeWidth="1" /><path d="M50 40 L48 30 L58 39 Z" fill="#F4B8C4" /><path d="M90 40 L92 30 L82 39 Z" fill="#F4B8C4" />
          <ellipse cx="70" cy="82" rx="30" ry="31" fill={`url(#${U}bd)`} stroke="#EDE6D8" strokeWidth="1" />
          <path d="M34 76 h14 M34 82 h14 M106 76 h-14 M106 82 h-14" stroke="#D8CFC0" strokeWidth="1.2" />
          <ellipse cx="56" cy="82" rx="5" ry="3.6" fill="#FBD0DB" opacity="0.7" /><ellipse cx="84" cy="82" rx="5" ry="3.6" fill="#FBD0DB" opacity="0.7" />
          <g className="petEyes"><ellipse cx="58" cy="76" rx="3" ry="4.2" fill="#3A3027">{blink(4.2)}</ellipse><ellipse cx="82" cy="76" rx="3" ry="4.2" fill="#3A3027">{blink(4.2)}</ellipse><circle cx="59.4" cy="74" r="1.2" fill="#fff" /><circle cx="83.4" cy="74" r="1.2" fill="#fff" /></g>
          <ellipse cx="70" cy="84" rx="2" ry="1.4" fill="#F4A0AE" /><path d="M50 88 q20 11 40 0" stroke="#E0484F" strokeWidth="3" fill="none" /><circle cx="70" cy="96" r="3" fill="#F6C453" stroke="#D89B22" strokeWidth="1" />
          <g><ellipse cx="100" cy="66" rx="7" ry="8" fill="#FFFFFF" stroke="#EDE6D8" strokeWidth="1" /><animateTransform attributeName="transform" type="rotate" values="-10 100 76;8 100 76;-10 100 76" dur="1.4s" repeatCount="indefinite" /></g>
          <g><circle cx="44" cy="104" r="8" fill="#F6C453" stroke="#D89B22" strokeWidth="1.4" /><circle cx="44" cy="104" r="3.6" fill="none" stroke="#D89B22" strokeWidth="1.2" /><animate attributeName="opacity" values="1;1" dur="2s" repeatCount="indefinite" /><animateTransform attributeName="transform" type="translate" values="0 0;0 -8;0 0" dur="1.4s" repeatCount="indefinite" /></g></>);
        return (<svg width={size} height={size} viewBox="0 0 140 140" style={{ overflow: 'visible' }}><defs>{defs}</defs>{plat('#F6C453')}{aura('#F6C453')}<g className="breathe">{art}</g></svg>);
      }

      if (name === "Linh thú: Rồng Con") {
        defs = (<><linearGradient id={`${U}bd`} x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#86EFAC" /><stop offset="55%" stopColor="#46B36B" /><stop offset="100%" stopColor="#2E7D4F" /></linearGradient><radialGradient id={`${U}gl`} cx="50%" cy="50%"><stop offset="0%" stopColor="#FDE68A" /><stop offset="100%" stopColor="#FDE68A" stopOpacity="0" /></radialGradient>{auraStop('#34D399')}{platStop('#34D399')}{blur}</>);
        art = (<><g><path d="M44 78 q-22 -12 -34 4 q20 4 32 18 Z" fill="#7CD191" /><animateTransform attributeName="transform" type="rotate" values="-8 44 82;10 44 82;-8 44 82" dur="1.3s" repeatCount="indefinite" /></g><g><path d="M96 78 q22 -12 34 4 q-20 4 -32 18 Z" fill="#7CD191" /><animateTransform attributeName="transform" type="rotate" values="8 96 82;-10 96 82;8 96 82" dur="1.3s" repeatCount="indefinite" /></g>
          <ellipse cx="70" cy="84" rx="29" ry="30" fill={`url(#${U}bd)`} /><ellipse cx="70" cy="92" rx="17" ry="18" fill="#CFF3DA" /><ellipse cx="70" cy="92" rx="13" ry="14" fill={`url(#${U}gl)`}><animate attributeName="opacity" values="0.3;1;0.3" dur="2.4s" repeatCount="indefinite" /></ellipse>
          <path d="M54 50 L50 30 L62 46 Z" fill="#FDE68A" /><path d="M86 50 L90 30 L78 46 Z" fill="#FDE68A" />
          <ellipse cx="70" cy="86" rx="11" ry="8" fill="#5FC57E" /><circle cx="65" cy="85" r="1.4" fill="#2E6B43" /><circle cx="75" cy="85" r="1.4" fill="#2E6B43" />
          <g className="petEyes"><ellipse cx="60" cy="72" rx="3" ry="3.6" fill="#1C3D2A">{blink(3.6)}</ellipse><ellipse cx="80" cy="72" rx="3" ry="3.6" fill="#1C3D2A">{blink(3.6)}</ellipse><circle cx="61.3" cy="70.4" r="1.1" fill="#fff" /><circle cx="81.3" cy="70.4" r="1.1" fill="#fff" /></g></>);
        return (<svg width={size} height={size} viewBox="0 0 140 140" style={{ overflow: 'visible' }}><defs>{defs}</defs>{plat('#34D399')}{aura('#34D399')}<g className="breathe">{art}</g><g fill="#CBD5E1"><circle cx="62" cy="84" r="2.2" opacity="0.6"><animate attributeName="cy" values="84;58" dur="2.8s" repeatCount="indefinite" /><animate attributeName="opacity" values="0;0.6;0" dur="2.8s" repeatCount="indefinite" /></circle><circle cx="78" cy="84" r="1.8" opacity="0.6"><animate attributeName="cy" values="84;60" dur="3.2s" begin="0.9s" repeatCount="indefinite" /><animate attributeName="opacity" values="0;0.6;0" dur="3.2s" begin="0.9s" repeatCount="indefinite" /></circle></g></svg>);
      }

      if (name === "Linh thú: Chim Cánh Cụt") {
        defs = (<><linearGradient id={`${U}bd`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3A4253" /><stop offset="100%" stopColor="#1F2430" /></linearGradient><radialGradient id={`${U}be`} cx="50%" cy="35%"><stop offset="0%" stopColor="#FFFFFF" /><stop offset="100%" stopColor="#E7ECF5" /></radialGradient>{auraStop('#67E8F9')}{platStop('#67E8F9')}{blur}</>);
        art = (<><g><path d="M42 74 q-10 16 4 30 Z" fill="#1A1F2B" /><animateTransform attributeName="transform" type="rotate" values="-6 44 76;10 44 76;-6 44 76" dur="1.1s" repeatCount="indefinite" /></g><g><path d="M98 74 q10 16 -4 30 Z" fill="#1A1F2B" /><animateTransform attributeName="transform" type="rotate" values="6 96 76;-10 96 76;6 96 76" dur="1.1s" repeatCount="indefinite" /></g>
          <ellipse cx="70" cy="82" rx="29" ry="34" fill={`url(#${U}bd)`} /><ellipse cx="70" cy="86" rx="18" ry="27" fill={`url(#${U}be)`} />
          <ellipse cx="56" cy="78" rx="5" ry="3.4" fill="#9FE5F2" opacity="0.6" /><ellipse cx="84" cy="78" rx="5" ry="3.4" fill="#9FE5F2" opacity="0.6" />
          <g className="petEyes"><ellipse cx="60" cy="66" rx="2.8" ry="3.6" fill="#12161F">{blink(3.6)}</ellipse><ellipse cx="80" cy="66" rx="2.8" ry="3.6" fill="#12161F">{blink(3.6)}</ellipse><circle cx="61.2" cy="64.4" r="1.1" fill="#fff" /><circle cx="81.2" cy="64.4" r="1.1" fill="#fff" /></g>
          <path d="M64 72 L70 79 L76 72 Z" fill="#F4A33C" /><path d="M58 113 l-4 6 h9 Z" fill="#F4A33C" /><path d="M82 113 l4 6 h-9 Z" fill="#F4A33C" /></>);
        return (<svg width={size} height={size} viewBox="0 0 140 140" style={{ overflow: 'visible' }}><defs>{defs}</defs>{plat('#67E8F9')}{aura('#67E8F9')}<g className="breathe">{art}</g><g fill="#BAE6FD"><circle cx="40" cy="50" r="1.6"><animate attributeName="opacity" values="0;1;0" dur="2.4s" repeatCount="indefinite" /></circle><circle cx="100" cy="58" r="1.3"><animate attributeName="opacity" values="0;1;0" dur="3s" begin="0.8s" repeatCount="indefinite" /></circle></g></svg>);
      }

      if (name === "Linh thú: Gấu Trúc") {
        defs = (<><radialGradient id={`${U}bd`} cx="50%" cy="35%"><stop offset="0%" stopColor="#FFFFFF" /><stop offset="100%" stopColor="#ECEEF0" /></radialGradient>{auraStop('#86E3C0')}{platStop('#86E3C0')}{blur}</>);
        art = (<><circle cx="44" cy="52" r="12" fill="#2B2B2B" /><circle cx="96" cy="52" r="12" fill="#2B2B2B" />
          <ellipse cx="70" cy="84" rx="31" ry="32" fill={`url(#${U}bd)`} stroke="#E4E6E8" strokeWidth="1" />
          <ellipse cx="56" cy="78" rx="9" ry="12" fill="#2B2B2B" transform="rotate(-16 56 78)" /><ellipse cx="84" cy="78" rx="9" ry="12" fill="#2B2B2B" transform="rotate(16 84 78)" />
          <ellipse cx="56" cy="90" rx="5" ry="3.4" fill="#FBC4C4" opacity="0.55" /><ellipse cx="84" cy="90" rx="5" ry="3.4" fill="#FBC4C4" opacity="0.55" />
          <g className="petEyes"><ellipse cx="57" cy="79" rx="2.6" ry="3.4" fill="#FFFFFF">{blink(3.4)}</ellipse><ellipse cx="83" cy="79" rx="2.6" ry="3.4" fill="#FFFFFF">{blink(3.4)}</ellipse><circle cx="57.6" cy="77.6" r="0.9" fill="#cfcfcf" /><circle cx="83.6" cy="77.6" r="0.9" fill="#cfcfcf" /></g>
          <ellipse cx="70" cy="92" rx="3.2" ry="2.2" fill="#2B2B2B" /><path d="M70 94 v3 M70 97 q-3 2.2 -5.4 0 M70 97 q3 2.2 5.4 0" stroke="#2B2B2B" strokeWidth="1.4" fill="none" />
          <ellipse cx="42" cy="98" rx="5.4" ry="7" fill="#2B2B2B" /><ellipse cx="98" cy="98" rx="5.4" ry="7" fill="#2B2B2B" />
          <g><path d="M104 84 q10 -4 16 -16" stroke="#5BA86A" strokeWidth="2.4" fill="none" strokeLinecap="round" /><path d="M118 70 q5 -1 7 -5 q-5 0 -8 3 Z" fill="#7CC98A" /><path d="M112 78 q5 -1 7 -5 q-5 0 -8 3 Z" fill="#7CC98A" /><animateTransform attributeName="transform" type="rotate" values="0 104 84;5 104 84;0 104 84" dur="2.2s" repeatCount="indefinite" /></g></>);
        return (<svg width={size} height={size} viewBox="0 0 140 140" style={{ overflow: 'visible' }}><defs>{defs}</defs>{plat('#86E3C0')}{aura('#86E3C0')}<g className="breathe">{art}</g></svg>);
      }

      return <svg width={size} height={size} viewBox="0 0 140 140" />;
    };

    const myHistory = history.filter(h => h.studentId === me.id);
    const myQuizResults = quizResults.filter(r => r.studentId === me.id);
    const vocabCards = Array.isArray(me.vocabNotebook) ? me.vocabNotebook : [];
    // Phân loại từ vựng: từ lẻ / cụm động từ / thành ngữ / kết hợp từ / cấu trúc ngữ pháp
    const VOCAB_CATS = [
      { key: 'word', icon: 'book', color: C.accent },
      { key: 'phrasal_verb', icon: 'puzzle', color: '#7c3aed' },
      { key: 'idiom', icon: 'chat', color: '#db2777' },
      { key: 'collocation', icon: 'link', color: '#0891b2' },
      { key: 'grammar', icon: 'ruler', color: '#ea580c' },
    ];
    const catMeta = (k: string) => VOCAB_CATS.find(x => x.key === (k || 'word')) || VOCAB_CATS[0];
    const filteredVocab = vocabFilter === 'all' ? vocabCards : vocabCards.filter(c => (c.category || 'word') === vocabFilter);
    const _nowMs = getTrueTime();  // FIX: dùng cùng đồng hồ với due (đặt bằng getTrueTime) -> thẻ mới luôn vào flashcard
    const dueCards = vocabCards.filter(c => (c.due || 0) <= _nowMs);
    const dueCount = dueCards.length;
    const pronounceVocab = (text: string) => {
      const phrase = String(text || '').trim();
      if (!phrase || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
      const utterance = new SpeechSynthesisUtterance(phrase);
      utterance.lang = 'en-GB';
      utterance.rate = 0.82;
      const voices = window.speechSynthesis.getVoices();
      utterance.voice = voices.find(v => /^en-GB/i.test(v.lang)) || voices.find(v => /^en/i.test(v.lang)) || null;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    };
    const canPronounceVocab = (card: VocabCard) => (card.category || 'word') !== 'grammar' && Boolean(String(card.word || '').trim());
    const renderPronounceButton = (card: VocabCard, compact = false, stopCardFlip = false) => !canPronounceVocab(card) ? null : <button type="button" title={`${t('vocab_pronounce')}: ${card.word}`} aria-label={`${t('vocab_pronounce')}: ${card.word}`} onClick={(e) => { if (stopCardFlip) e.stopPropagation(); pronounceVocab(card.word); }} style={{display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: compact ? 24 : 27, height: compact ? 24 : 27, padding: 0, borderRadius: compact ? 6 : 7, border: `1px solid ${C.border}`, background: C.card, color: C.accent, cursor: 'pointer', flexShrink: 0}}><Ico name="volume2" size={compact ? 14 : 15} /></button>;
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
    const trendIcon = recentScores.length >= 2 ? (Number(recentScores[recentScores.length - 1].band) >= Number(recentScores[recentScores.length - 2].band) ? <Ico name="trending" size={14} color={C.succ} /> : <Ico name="trendingDown" size={14} color={C.err} />) : null;
    const targetGap = me.target && avgBand !== "N/A" ? (Number(me.target) - Number(avgBand)) : 0;
    const motivationMsg = isNaN(targetGap) ? "" : (targetGap > 0 ? t('motivation_need', { gap: targetGap.toFixed(1) }) : t('motivation_reached'));

    const handleReviewQuiz = (r: QuizResult) => {
        setReviewQuiz({quiz: quizzes.find(q=>q.id===r.quizId) as Quiz, result: r});
        setReviewSectionIdx(0);
        const reviewed = Array.isArray(me.inventory?.reviewedQuizzes) ? me.inventory!.reviewedQuizzes : [];
        if (!reviewed.includes(r.id)) {
            const newInv = { ...(me.inventory || {}), consumables: me.inventory?.consumables || {}, permanents: me.inventory?.permanents || [], reviewedQuizzes: [...reviewed, r.id] };
            const nx = students.map(s => s.id === me.id ? { ...s, coins: (s.coins || 0) + 20, inventory: newInv } : s);
            setStudents(nx); syncData({ students: nx });
            alert("CHIẾN THẦN REVIEW: +20 Xu vì đã xem lại lỗi sai trong bài thi!");
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
            alert("Đổi thành công! Quà đã được chuyển vào Túi đồ.");
            setShowCelebration(true); setTimeout(() => setShowCelebration(false), 5000);
        }
    };

    const handleRollGacha = () => {
        if ((me.coins || 0) < 500) { alert("Cần 500 Xu để quay Gacha!"); return; }
        if (confirm("Dùng 500 Xu để mở Hộp Quà Ngẫu Nhiên?")) {
            const pool = [
                // 🏆 DANH HIỆU VĨNH VIỄN — đa dạng, hiển thị cạnh tên (equippedTitle)
                { type: "PERMANENT", name: "Danh hiệu: Chiến Thần IELTS" },
                { type: "PERMANENT", name: "Danh hiệu: Kẻ Hủy Diệt Đề" },
                { type: "PERMANENT", name: "Danh hiệu: Học Bá Thượng Đẳng" },
                { type: "PERMANENT", name: "Danh hiệu: Cao Thủ Reading" },
                { type: "PERMANENT", name: "Danh hiệu: Bậc Thầy Từ Vựng" },
                { type: "PERMANENT", name: "Danh hiệu: Vua Tốc Độ" },
                { type: "PERMANENT", name: "Danh hiệu: Huyền Thoại 8.0+" },
                { type: "PERMANENT", name: "Danh hiệu: Mọt Sách Bất Bại" },
                { type: "PERMANENT", name: "Danh hiệu: Thợ Săn Band Điểm" },
                { type: "PERMANENT", name: "Danh hiệu: Ninja Phòng Thi" },
                // 🎨 GIAO DIỆN VĨNH VIỄN — đổi màu portal học viên (equippedTheme)
                { type: "PERMANENT", name: "Giao diện: Hoàng Kim" },
                { type: "PERMANENT", name: "Giao diện: Nửa Đêm" },
                { type: "PERMANENT", name: "Giao diện: Anh Đào" },
                { type: "PERMANENT", name: "Giao diện: Rừng Sâu" },
                // 🖼️ KHUNG AVATAR VĨNH VIỄN — viền + hiệu ứng quanh ảnh đại diện (equippedFrame)
                { type: "PERMANENT", name: "Khung avatar: Vương Miện" },
                { type: "PERMANENT", name: "Khung avatar: Rồng Lửa" },
                { type: "PERMANENT", name: "Khung avatar: Băng Giá" },
                { type: "PERMANENT", name: "Khung avatar: Cầu Vồng" },
                { type: "PERMANENT", name: "Khung avatar: Sao Băng" },
                // 🐾 LINH THÚ VĨNH VIỄN — pet cosmetic nổi góc màn hình (equippedPet)
                { type: "PERMANENT", name: "Linh thú: Cú Mèo" },
                { type: "PERMANENT", name: "Linh thú: Mèo Thần Tài" },
                { type: "PERMANENT", name: "Linh thú: Rồng Con" },
                { type: "PERMANENT", name: "Linh thú: Cáo Lửa" },
                { type: "PERMANENT", name: "Linh thú: Chim Cánh Cụt" },
                { type: "PERMANENT", name: "Linh thú: Gấu Trúc" },
                // 🍕 PHẦN THƯỞNG THỰC TẾ (tốn chi phí GV) — hiếm hơn
                { type: "CONSUMABLE", name: "Thẻ dời deadline (24h)" },
                { type: "CONSUMABLE", name: "1 Hộp Milo" },
                { type: "CONSUMABLE", name: "1 Ly Trái Chò" },
                { type: "CONSUMABLE", name: "1 Trà sữa Viên Viên" },
                // 😢 Trượt — giữ chút hồi hộp
                { type: "NONE", name: "Chúc bạn may mắn lần sau" },
                { type: "NONE", name: "Chúc bạn may mắn lần sau" }
            ];
            const reward = pool[Math.floor(Math.random() * pool.length)];
            let newCoins = (me.coins || 0) - 500;
            const currentCons = { ...(me.inventory?.consumables || {}) };
            let currentPerms = Array.isArray(me.inventory?.permanents) ? [...me.inventory!.permanents] : [];
            let msg = `BẠN QUAY TRÚNG: ${reward.name}`;

            if (reward.type === "PERMANENT") {
                if (currentPerms.includes(reward.name)) {
                    newCoins += 200;
                    msg += `\n\nBạn đã sở hữu vật phẩm này. Hệ thống tự động chuyển hóa thành +200 Xu đền bù!`;
                } else {
                    currentPerms = [...currentPerms, reward.name];
                    msg += `\n\nĐã thêm vào Túi đồ (Tab Vĩnh viễn)!`;
                }
            } else if (reward.type === "CONSUMABLE") {
                currentCons[reward.name] = (currentCons[reward.name] || 0) + 1;
                msg += `\n\nĐã thêm vào Túi đồ!`;
            }

            const newInv = { ...(me.inventory || {}), consumables: currentCons, permanents: currentPerms };
            // Seed backup chống mất quà NGAY khi trúng (sống qua reload; mergeMyPermanents sẽ union lại kể cả khi sync lỗi).
            try { localStorage.setItem("ielts_os_perms_" + String(me.email || "").toLowerCase(), JSON.stringify(currentPerms)); } catch (e) {}
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

        // Mã thưởng độc nhất + ghi vào SỔ CÁI để giáo viên xác minh (chống photoshop & dùng lại)
        const code = genRewardCode();
        const ledgerEntry: RewardCode = { code, studentId: me.id, studentName: me.name, item: itemName, createdAt: Date.now(), redeemed: false };
        const nxCodes = [...rewardCodes, ledgerEntry];
        setStudents(nx); setRewardCodes(nxCodes); syncData({ students: nx, rewardCodes: nxCodes });
        setUseCodeObj({ name: itemName, code });
    };

    const handleEquipItem = (itemName: string) => {
        // TOGGLE: bấm lại vật phẩm đang trang bị -> gỡ ra (undefined).
        const newInv = { ...(me.inventory || {}), consumables: me.inventory?.consumables || {}, permanents: me.inventory?.permanents || [] };
        if (itemName.startsWith("Danh hiệu:")) {
            const v = itemName.replace("Danh hiệu: ", "");
            newInv.equippedTitle = newInv.equippedTitle === v ? undefined : v;
        } else if (itemName.startsWith("Giao diện:")) {
            newInv.equippedTheme = newInv.equippedTheme === itemName ? undefined : itemName;
        } else if (itemName.startsWith("Khung avatar:")) {
            newInv.equippedFrame = newInv.equippedFrame === itemName ? undefined : itemName;
        } else if (itemName.startsWith("Linh thú:")) {
            newInv.equippedPet = newInv.equippedPet === itemName ? undefined : itemName;
        }
        // CHỐNG TỰ ĐĂNG XUẤT: equip là hành động từ CHÍNH thiết bị này -> re-assert ID phiên thiết bị
        // (= localStorage 'ielts_os_device_session'), để effect kiểm tra session KHÔNG hiểu nhầm là
        // "đăng nhập ở thiết bị khác" mỗi khi setStudents chạy. Fallback giữ session cũ nếu chưa có.
        const _deviceSid = (typeof localStorage !== "undefined" && localStorage.getItem("ielts_os_device_session")) || me.currentSessionId;
        const nx = students.map(s => s.id === me.id ? { ...s, inventory: newInv, currentSessionId: _deviceSid || s.currentSessionId } : s);
        setStudents(nx); syncData({ students: nx });
    };

    return (
      <div onMouseMove={(e) => { const pet = document.getElementById('os-pet'); if (!pet) return; const r = pet.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2; const dx = Math.max(-1, Math.min(1, (e.clientX - cx) / 240)) * 2.6; const dy = Math.max(-1, Math.min(1, (e.clientY - cy) / 240)) * 2.2; pet.style.setProperty('--pex', dx.toFixed(2) + 'px'); pet.style.setProperty('--pey', dy.toFixed(2) + 'px'); }} style={{ minHeight: "100vh", background: C.bg, color: C.text, position: 'relative', overflowX: 'hidden' }}>
        {globalStyles}
        {/* PHỦ THEME + NỀN GLOW TRANG TRÍ (chỉ khi đang bật theme giao diện) */}
        {_themed && <>
          <style>{`
          .card { background: ${C.card} !important; border-color: ${C.border} !important; color: ${C.text} !important; }
          input, select, textarea { background: ${C.card} !important; color: ${C.text} !important; border-color: ${C.border} !important; }
          input::placeholder, textarea::placeholder { color: ${C.sub} !important; }
          .ios-tabs-container { background: ${C.border} !important; }
          .tab-btn { color: ${C.text} !important; }
          .tab-btn.active { color: ${C.bg} !important; background: ${C.accent} !important; }
          ::-webkit-scrollbar-thumb { background: ${C.accent}55 !important; border-color: ${C.bg} !important; }
          `}</style>
          <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', background: `radial-gradient(1100px 540px at 50% -12%, ${_glow}24, transparent 62%), radial-gradient(760px 520px at 102% 4%, ${C.accent}14, transparent 56%), radial-gradient(640px 480px at -6% 30%, ${_glow}12, transparent 60%)` }} />
        </>}
        {/* LINH THÚ "Living Companion" — nổi góc màn hình, mắt dõi chuột, bấm để phản ứng */}
        <style>{`
          @keyframes petBob { 0%,100% { transform: translateY(0) rotate(-2.5deg); } 50% { transform: translateY(-9px) rotate(2.5deg); } }
          .breathe { transform-box: fill-box; transform-origin: 50% 72%; animation: breathe 3.4s ease-in-out infinite; }
          @keyframes breathe { 0%,100% { transform: translateY(0) scale(1,1); } 50% { transform: translateY(-4px) scale(1.015,.985); } }
          .petEyes { transform-box: fill-box; transform-origin: center; transform: translate(var(--pex,0px), var(--pey,0px)); transition: transform .12s ease-out; }
          @keyframes petPop { 0%{transform:scale(1)} 28%{transform:translateY(-16px) scale(1.14,.88)} 60%{transform:translateY(0) scale(.94,1.06)} 100%{transform:scale(1)} }
          .petPop { animation: petPop .62s cubic-bezier(.2,.85,.25,1); }
          .petHeart { position:absolute; bottom:42px; left:0; font-size:15px; pointer-events:none; animation: petHeartUp .95s ease-out forwards; }
          @keyframes petHeartUp { 0%{opacity:0; transform:translateY(0) scale(.5)} 25%{opacity:1} 100%{opacity:0; transform:translateY(-50px) scale(1.15)} }
        `}</style>
        {STUDENT_PET_NAMES.indexOf(me.inventory?.equippedPet || '') >= 0 && (
            <div id="os-pet" title={me.inventory?.equippedPet}
                onClick={(e) => {
                    const box = e.currentTarget as HTMLElement; const svg = box.querySelector('svg');
                    if (svg) { svg.classList.remove('petPop'); void (svg as any).getBBox; svg.classList.add('petPop'); setTimeout(() => svg.classList.remove('petPop'), 660); }
                    for (let i = 0; i < 6; i++) { const s = document.createElement('span'); s.className = 'petHeart'; s.textContent = i % 2 ? '★' : '♥'; s.style.left = (6 + Math.random() * 46) + 'px'; s.style.color = i % 2 ? '#FBBF24' : '#FB7185'; s.style.animationDelay = (i * 0.05) + 's'; box.appendChild(s); setTimeout(() => s.remove(), 1050); }
                }}
                style={{ position: 'fixed', right: isMobile ? 12 : 20, bottom: isMobile ? 104 : 20, zIndex: 500, cursor: 'pointer', animation: 'petBob 3.2s ease-in-out infinite', filter: 'drop-shadow(0 9px 11px rgba(0,0,0,0.22))', ['--pex' as any]: '0px', ['--pey' as any]: '0px' }}>
                {renderPetArt(me.inventory?.equippedPet || '', 64, 'live')}
            </div>
        )}
        {confettiOverlay}

        {/* MÀN HÌNH NHẮC NỢ BẠO CHÚA */}
        {showDebtWarning && (
            <div style={{position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.95)', zIndex: 999999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20}}>
                <div style={{background: C.err, width: '100%', maxWidth: 500, padding: 30, borderRadius: 16, textAlign: 'center', boxShadow: '0 10px 50px rgba(255,0,0,0.5)', border: '2px solid #fff'}}>
                    <div style={{fontSize: 50, marginBottom: 10, display: 'flex', justifyContent: 'center'}}><Ico name="alert" size={50} color="#fff" /></div>
                    <h1 style={{color: '#fff', margin: '0 0 20px 0', fontSize: 24, textTransform: 'uppercase'}}>{t('debt_notice_title')}</h1>
                    <div style={{background: '#fff', color: '#000', padding: 20, borderRadius: 8, fontSize: 16, fontWeight: 700, lineHeight: 1.5, textAlign: 'left', whiteSpace: 'pre-wrap'}}>
                        {me.debtMessage}
                    </div>
                    <p style={{color: '#fff', fontSize: 12, marginTop: 20, opacity: 0.8}}>{t('debt_read_carefully')}</p>
                    <button 
                        disabled={debtConfirmCountdown > 0} 
                        onClick={handleAcknowledgeDebt} 
                        style={{background: debtConfirmCountdown > 0 ? '#666' : '#fff', color: debtConfirmCountdown > 0 ? '#aaa' : C.err, padding: '15px 40px', fontSize: 16, fontWeight: 900, marginTop: 20, border: 'none', borderRadius: 30, cursor: debtConfirmCountdown > 0 ? 'not-allowed' : 'pointer', width: '100%', transition: '0.3s'}}
                    >
                        {debtConfirmCountdown > 0 ? t('debt_wait', { s: debtConfirmCountdown }) : t('debt_acknowledge')}
                    </button>
                </div>
            </div>
        )}

        {showCelebration && (
            <div style={{position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99999, pointerEvents: 'none', display: 'flex', justifyContent: 'space-around'}}>
                {Array.from({length: 30}).map((_, i) => (
                    <div key={i} style={{fontSize: 40, animation: `fall 3s linear infinite`, animationDelay: `${Math.random() * 2}s`}}>{['★','✦','✳','◆','✶'][i%5]}</div>
                ))}
            </div>
        )}

        {announcement && (
            <div style={{ background: C.warn, color: '#fff', padding: '8px', fontSize: 14, fontWeight: 'bold', display: 'flex', alignItems: 'center', zIndex: 1000 }}>
                 
                <div className="marquee-container">
                    <div className="marquee-content">{announcement}</div>
                </div>
            </div>
        )}

        <nav style={{ background: 'rgba(255, 255, 255, 0.85)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderBottom: `1px solid rgba(226, 232, 240, 0.8)`, padding: "16px 32px", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, zIndex: 100 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <BrandLogo size={38} />
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, letterSpacing: -0.5, display: 'flex', alignItems: 'center', gap: 8 }}><BrandWordmark size={20} color={C.text} /> <span style={{ background: `${C.accent}14`, color: C.accent, fontSize: 12, fontWeight: 800, padding: '2px 7px', borderRadius: 6 }}>STUDENT</span></h1>
          </div>
          <div style={{display: 'flex', gap: 12, alignItems: 'center'}}>
             <div style={{fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 20, background: isTimeSynced ? `${C.succ}15` : `${C.warn}15`, color: isTimeSynced ? C.succ : C.warn, display: window.innerWidth > 600 ? 'block' : 'none'}} title={t('tip_sync_server')}>
                  {isTimeSynced ? t('time_synced') : t('time_syncing')}
             </div>
             {lastLoginTime && <div style={{fontSize: 12, color: C.sub, fontWeight: 600, marginRight: 15, display: window.innerWidth > 600 ? 'block' : 'none'}}>{t('last_login')} {lastLoginTime}</div>}
             <LanguageToggle role="STUDENT" />
             <button onClick={() => setColorblind(!colorblind)} style={{ background: "transparent", padding: "4px 8px", display: 'flex', alignItems: 'center', color: C.text, opacity: colorblind ? 1 : 0.5 }} title={t('contrast_mode')}><Ico name="eye" size={19} /></button>
             <button onClick={handleLogout} style={{ background: `${C.err}15`, color: C.err, padding: "8px 16px", fontSize: 13, fontWeight: 700, marginLeft: 8 }}>{t('logout')}</button>
          </div>
        </nav>

        <main style={{ maxWidth: 800, margin: "0 auto", padding: isMobile ? "16px 14px 92px" : "32px 20px" }}>
          
          {me.privateMessage && (
              <div style={{background: `${C.err}15`, border: `2px solid ${C.err}`, color: C.err, padding: 20, borderRadius: 12, marginBottom: 24}}>
                  <h3 style={{marginTop: 0, marginBottom: 5, display: 'flex', alignItems: 'center', gap: 8}}><Ico name="bell" size={18} color={C.err} /> {t('private_msg_title')}</h3>
                  <div style={{fontWeight: 700}}>{me.privateMessage}</div>
              </div>
          )}

          {/* STUDENT MOBILE HEADER COMPACT */}
          <div style={{ background: C.card, border: `1px solid ${C.border}80`, borderRadius: isMobile ? 16 : 20, padding: isMobile ? '14px 16px' : '22px 26px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: isMobile ? 10 : 16, flexWrap: 'wrap', marginBottom: isMobile ? 14 : 20, position: 'relative', overflow: 'hidden' }}>
            <div style={{display: 'flex', gap: isMobile ? 12 : 18, alignItems: 'center', zIndex: 1}}>
              {(() => {
                  const _eqFr = me.inventory?.equippedFrame || '';
                  if (!FRAME_META[_eqFr]) return <div style={{boxShadow: `0 0 0 4px ${C.bg}, 0 0 0 6px ${C.border}`}}>{getAvatar(me.name || "HV")}</div>;
                  return (
                    <div style={{ position: 'relative', width: 40, height: 40, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <div style={{ position: 'absolute', inset: -12 }}>{renderFrameArt(_eqFr, 64, 'hdr')}</div>
                        <div style={{ position: 'relative', zIndex: 1, borderRadius: '50%' }}>{getAvatar(me.name || "HV")}</div>
                    </div>
                  );
              })()}
              <div>
                <h2 style={{fontFamily: 'var(--display)', marginTop: 0, fontSize: isMobile ? 19 : 24, fontWeight: 500, letterSpacing: -0.4, marginBottom: isMobile ? 4 : 6}}>{greetingText}, <span style={{color: C.accent, fontStyle: 'italic'}}>{me.name || "bạn"}</span></h2>
                {me.inventory?.equippedTitle && <div style={{background: '#0F172A', color: '#FCD34D', padding: '3px 12px', borderRadius: 20, display: 'inline-block', fontSize: 11, fontWeight: 700, marginBottom: 6, letterSpacing: 0.5}}>{me.inventory!.equippedTitle}</div>}
                <p style={{color: C.sub, margin: 0, fontSize: 13.5}}>{t('ready_conquer')}</p>
              </div>
            </div>
            <div style={{display: 'flex', gap: 10, zIndex: 1}}>
                <div style={{textAlign: 'center', background: C.bg, padding: isMobile ? '8px 12px' : '10px 18px', borderRadius: 14}}>
                   <div style={{marginBottom: 4, display: 'flex', justifyContent: 'center', color: C.warn}}><Ico name="coins" size={20} /></div>
                   <div style={{fontWeight: 800, fontSize: 13, color: C.text}}>{me.coins || 0} <span style={{color: C.sub, fontSize: 11, fontWeight: 600}}>{t('coins_label')}</span></div>
                </div>
                <div style={{textAlign: 'center', background: C.bg, padding: isMobile ? '8px 12px' : '10px 18px', borderRadius: 14}}>
                   <div style={{fontSize: 20, marginBottom: 4}}>{getGamificationBadge(me.level || 1).split(" ")[0]}</div>
                   <div style={{fontWeight: 800, fontSize: 13, color: C.text}}>Lv.{me.level || 1}</div>
                </div>
            </div>
          </div>

          {useCodeObj && (
              <div style={{position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.9)', zIndex: 99999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#fff'}}>
                  <h2 style={{color: C.succ, fontSize: 32}}>{t('reward_code_title')}</h2>
                  <p style={{fontSize: 18, textAlign: 'center'}}>{t('item_label')}: <b>{useCodeObj!.name}</b></p>
                  <div style={{background: '#fff', padding: 20, borderRadius: 12, margin: '20px 0'}}>
                      <img src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${useCodeObj!.code}`} alt="QR Code" />
                  </div>
                  <div style={{fontSize: 28, fontWeight: 900, letterSpacing: 5, background: '#222', padding: '10px 30px', borderRadius: 8}}>{useCodeObj!.code}</div>
                  <p style={{color: C.warn, fontSize: 14, maxWidth: 500, textAlign: 'center', marginTop: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6}}><Ico name="alert" size={15} color={C.warn} />{t('reward_screenshot_warn')}</p>
                  <button onClick={() => setUseCodeObj(null)} style={{background: C.accent, color: '#fff', padding: '15px 40px', fontSize: 18, marginTop: 30}}>{t('captured_close')}</button>
              </div>
          )}

          {showInventory && (
              <div style={{position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20}}>
                  <div className="card" style={{width: 600, maxWidth: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', background: C.bg}}>
                      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `2px solid ${C.border}`, paddingBottom: 15, marginBottom: 15}}>
                          <h2 style={{margin: 0, display: 'flex', alignItems: 'center', gap: 9}}><Ico name="bag" size={20} /> {t('my_inventory')}</h2>
                          <button onClick={() => setShowInventory(false)} style={{background: 'transparent', color: C.err, fontSize: 24, padding: 0}}><Ico name="x" size={20} /></button>
                      </div>
                      <div style={{display: 'flex', gap: 10, marginBottom: 20}}>
                          <button onClick={() => setInvTab("CONSUMABLE")} style={{flex: 1, padding: 10, background: invTab === "CONSUMABLE" ? C.accent : C.card, color: invTab === "CONSUMABLE" ? '#fff' : C.text, border: `1px solid ${C.border}`, fontWeight: 900}}><Ico name="gift" size={14} style={{verticalAlign:'-2px', marginRight:6, display:'inline-block'}} />{t('consumables_tab')}</button>
                          <button onClick={() => setInvTab("PERMANENT")} style={{flex: 1, padding: 10, background: invTab === "PERMANENT" ? C.accent : C.card, color: invTab === "PERMANENT" ? '#fff' : C.text, border: `1px solid ${C.border}`, fontWeight: 900}}><Ico name="trophy" size={16} /> {t('permanent_tab')}</button>
                      </div>
                      <div style={{flex: 1, overflowY: 'auto', display: 'grid', gap: 10}}>
                          {invTab === "CONSUMABLE" && Object.entries(me.inventory?.consumables || {}).map(([name, count]) => (
                              <div key={name} style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 15, background: C.card, borderRadius: 8, border: `1px solid ${C.border}`}}>
                                  <div><div style={{fontWeight: 900}}>{name}</div><div style={{fontSize: 12, color: C.sub}}>{t('quantity_label')}: {count as number}</div></div>
                                  <button onClick={() => handleUseItem(name)} style={{background: C.succ, color: '#fff', padding: '8px 16px'}}>{t('use_now')}</button>
                              </div>
                          ))}
                          {invTab === "CONSUMABLE" && Object.keys(me.inventory?.consumables || {}).length === 0 && <div style={{textAlign: 'center', padding: 30, color: C.sub}}>{t('inventory_empty_consumable')}</div>}
                          
                         {invTab === "PERMANENT" && (Array.isArray(me.inventory?.permanents) ? me.inventory!.permanents : []).map((id: string) => {
    const safeName = String(id);
    const isEquipped = (me.inventory?.equippedTheme === safeName
        || me.inventory?.equippedFrame === safeName
        || me.inventory?.equippedPet === safeName
        || me.inventory?.equippedTitle === safeName.replace("Danh hiệu: ", ""));
    // Preview nhỏ: ô màu gradient (theme) / khung SVG thu nhỏ (frame) / linh thú SVG (pet) / icon cúp (danh hiệu)
    const _thm = STUDENT_THEMES[safeName];
    const _isFrame = STUDENT_FRAME_NAMES.indexOf(safeName) >= 0;
    const _isPet = STUDENT_PET_NAMES.indexOf(safeName) >= 0;
    const preview = _thm
        ? <span style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0, background: `linear-gradient(135deg, ${_thm.accent}, ${_thm.card})`, border: `1px solid ${C.border}`, boxShadow: `0 0 9px ${_thm.glow}55` }} />
        : _isFrame
        ? <span style={{ position: 'relative', width: 32, height: 32, flexShrink: 0, display: 'inline-block' }}>{renderFrameArt(safeName, 32, 'inv')}</span>
        : _isPet
        ? <span style={{ width: 32, height: 32, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{renderPetArt(safeName, 32, 'inv')}</span>
        : <Ico name="trophy" size={18} color={C.warn} />;
    return (
    <div key={safeName} style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 15, background: C.card, borderRadius: 8, border: `1px solid ${isEquipped ? C.succ : C.border}`}}>
        <div style={{display: 'flex', alignItems: 'center', gap: 12, minWidth: 0}}>
            {preview}
            <div style={{fontWeight: 900, color: C.accent, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{safeName}</div>
        </div>
        <div style={{display: 'flex', gap: 10, flexShrink: 0}}>
            <button onClick={() => handleEquipItem(safeName)} style={{background: isEquipped ? C.succ : C.bg, color: isEquipped ? '#fff' : C.text, border: `1px solid ${C.border}`, padding: '8px 16px', fontWeight: 700}}>{isEquipped ? '✓ Đang dùng' : t('equip_btn')}</button>
        </div>
    </div>
)})}
                          {invTab === "PERMANENT" && (Array.isArray(me.inventory?.permanents) ? me.inventory!.permanents : []).length === 0 && <div style={{textAlign: 'center', padding: 30, color: C.sub}}>{t('inventory_empty_permanent')}</div>}
                      </div>
                  </div>
              </div>
          )}
          {/* THANH TAB ĐIỀU HƯỚNG — chia portal thành các trang nhỏ để hết cuộn dài */}
          <div style={{ display: isMobile ? 'none' : 'flex', gap: 6, marginBottom: 24, padding: 5, background: C.card, border: `1px solid ${C.border}80`, borderRadius: 14, overflowX: 'auto' }}>
            {([
              { k: 'home', icon: 'home', label: t('ptab_home') },
              { k: 'exams', icon: 'monitor', label: t('ptab_exams') },
              { k: 'vocab', icon: 'book', label: t('ptab_vocab') },
              { k: 'progress', icon: 'trending', label: t('ptab_progress') },
              { k: 'rewards', icon: 'gift', label: t('ptab_rewards') },
            ] as const).map(tb => {
              const on = portalTab === tb.k;
              return (
                <button key={tb.k} onClick={() => setPortalTab(tb.k)} style={{ flex: '1 0 auto', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '10px 16px', borderRadius: 10, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap', fontSize: 13.5, fontWeight: 700, background: on ? C.accent : 'transparent', color: on ? '#fff' : C.sub, transition: 'background .15s' }}>
                  <Ico name={tb.icon} size={16} color={on ? '#fff' : C.sub} /> {tb.label}
                </button>
              );
            })}
          </div>

          {/* ===== TAB: TỔNG QUAN ===== */}
          {portalTab === "home" && (<>
          <div style={{ display: "grid", gridTemplateColumns: window.innerWidth > 800 ? "repeat(3, 1fr)" : "1fr", gap: 16, marginBottom: 24 }}>
            <div className="card" style={{padding: "20px", display: 'flex', flexDirection: 'column', gap: 8}}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: C.sub }}>
                  <div style={{background: C.bg, color: C.text, width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center'}}><Ico name="clock" size={17} color={C.sub} /></div>
                  <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('total_hours')}</span>
              </div>
              <div style={{ fontFamily: 'var(--display)', fontSize: 34, fontWeight: 500, color: C.text, letterSpacing: -0.5 }}>{(myHistory.reduce((s,h)=>s+((h && h.duration)||0),0)/3600).toFixed(1)}<span style={{fontSize: 18, fontStyle: 'italic', color: C.sub}}>h</span></div>
            </div>
            <div className="card" style={{padding: "20px", display: 'flex', flexDirection: 'column', gap: 8}}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: C.sub }}>
                  <div style={{background: `${C.succ}15`, color: C.succ, width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center'}}><Ico name="trending" size={17} color={C.succ} /></div>
                  <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('avg_band')}</span>
              </div>
              <div style={{ fontFamily: 'var(--display)', fontSize: 34, fontWeight: 500, color: C.succ, letterSpacing: -0.5 }}>{avgBand} <span style={{fontSize: 18}}>{trendIcon}</span></div>
            </div>
            <div className="card" style={{padding: "20px", display: 'flex', flexDirection: 'column', gap: 8}}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: C.sub }}>
                  <div style={{background: `${C.warn}15`, color: C.warn, width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center'}}><Ico name="pin" size={17} color={C.warn} /></div>
                  <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('total_quizzes')}</span>
              </div>
              <div style={{ fontFamily: 'var(--display)', fontSize: 34, fontWeight: 500, color: C.warn, letterSpacing: -0.5 }}>{myQuizResults.length}</div>
            </div>
          </div>

          </>)}

          {/* ===== TAB: PHẦN THƯỞNG ===== */}
          {portalTab === "rewards" && (<>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 32 }}>
              <button 
                  onClick={handleRollGacha} 
                  style={{ background: `linear-gradient(135deg, #FF9500, #FFD60A)`, color: '#000', padding: '16px 40px', borderRadius: 30, fontSize: 18, fontWeight: 900, boxShadow: `0 12px 30px rgba(255, 149, 0, 0.4)`, border: `3px solid #fff`, display: 'flex', alignItems: 'center', gap: 16, cursor: 'pointer', transition: 'transform 0.2s ease', outline: 'none' }}
              >
                  <Ico name="sparkles" size={30} color={C.accent} />
                  <div style={{ textAlign: 'left', lineHeight: 1.2 }}>
                      <div>{t('gacha_spin')}</div>
                      <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.8 }}>{t('gacha_cost')}</div>
                  </div>
              </button>
          </div>

          {/* CỬA HÀNG ĐỔI THƯỞNG DÀN NGANG MÀN HÌNH */}
          <div className="card" style={{ marginBottom: 32 }}>
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 15}}>
                  <h3 style={{marginTop: 0, marginBottom: 0, display: 'flex', alignItems: 'center', gap: 11, fontFamily: 'var(--display)', fontSize: 26, fontWeight: 500, color: C.text}}>
                      <span style={{background: `linear-gradient(135deg, ${C.succ}, #059669)`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent'}}></span><Ico name="gift" size={24} color={C.succ} style={{marginRight: 10}} /><span style={{color: C.text}}>Rewards Store</span><span style={{display: 'none'}}>REWARDS STORE</span>
                  </h3>
                  <button onClick={() => setShowInventory(true)} style={{background: C.accent, color: '#fff', padding: '11px 22px', borderRadius: 14, fontWeight: 700, boxShadow: `0 8px 20px ${C.accent}3a`}}><Ico name="bag" size={15} style={{verticalAlign:'-2px', marginRight:7, display:'inline-block'}} />{t('my_inventory_btn')}</button>
              </div>
              
              <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 16}}>
                  <div style={{background: C.bg, padding: 20, borderRadius: 20, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 16}}>
                      <div>
                          <div style={{fontSize: 28, marginBottom: 8}}>⏳</div>
                          <div style={{fontWeight: 800, fontSize: 16}}>Thẻ dời deadline (24h)</div>
                          <div style={{fontSize: 13, color: C.sub, marginTop: 4}}>Gia hạn thêm thời gian nộp bài.</div>
                      </div>
                      <button onClick={() => handleBuyConsumable("Thẻ dời deadline (24h)", 1000)} style={{background: `${C.warn}20`, color: C.warn, fontWeight: 800, padding: '10px', width: '100%'}}>1000 <Ico name="coins" size={13} style={{verticalAlign:'-2px', display:'inline-block'}} /></button>
                  </div>
                  <div style={{background: C.bg, padding: 20, borderRadius: 20, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 16}}>
                      <div>
                          <div style={{marginBottom: 8}}><Ico name="cup" size={26} color={C.warn} /></div>
                          <div style={{fontWeight: 800, fontSize: 16}}>1 Hộp sữa Milo</div>
                          <div style={{fontSize: 13, color: C.sub, marginTop: 4}}>Cứu trợ năng lượng giữa giờ học.</div>
                      </div>
                      <button onClick={() => handleBuyConsumable("1 Hộp Milo", 500)} style={{background: `${C.warn}20`, color: C.warn, fontWeight: 800, padding: '10px', width: '100%'}}>500 <Ico name="coins" size={13} style={{verticalAlign:'-2px', display:'inline-block'}} /></button>
                  </div>
                  <div style={{background: C.bg, padding: 20, borderRadius: 20, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 16}}>
                      <div>
                          <div style={{marginBottom: 8}}><Ico name="cup" size={26} color={C.warn} /></div>
                          <div style={{fontWeight: 800, fontSize: 16}}>1 Ly nước Trái Chò</div>
                          <div style={{fontSize: 13, color: C.sub, marginTop: 4}}>Giải nhiệt tuyệt đỉnh.</div>
                      </div>
                      <button onClick={() => handleBuyConsumable("1 Ly Trái Chò", 1000)} style={{background: `${C.warn}20`, color: C.warn, fontWeight: 800, padding: '10px', width: '100%'}}>1000 <Ico name="coins" size={13} style={{verticalAlign:'-2px', display:'inline-block'}} /></button>
                  </div>
                  <div style={{background: C.bg, padding: 20, borderRadius: 20, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 16}}>
                      <div>
                          <div style={{marginBottom: 8}}><Ico name="cup" size={26} color={C.warn} /></div>
                          <div style={{fontWeight: 800, fontSize: 16}}>1 Trà sữa Viên Viên</div>
                          <div style={{fontSize: 13, color: C.sub, marginTop: 4}}>Đánh bay cơn buồn ngủ.</div>
                      </div>
                      <button onClick={() => handleBuyConsumable("1 Trà sữa Viên Viên", 1000)} style={{background: `${C.warn}20`, color: C.warn, fontWeight: 800, padding: '10px', width: '100%'}}>1000 <Ico name="coins" size={13} style={{verticalAlign:'-2px', display:'inline-block'}} /></button>
                  </div>
              </div>
              {Array.isArray(me.myRewards) && me.myRewards!.length > 0 && (
                 <div style={{marginTop: 24, paddingTop: 20, borderTop: `1px dashed ${C.border}`, fontSize: 13}}>
                     <div style={{fontWeight: 800, color: C.succ, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 7}}><Ico name="bag" size={14} /> Túi đồ cũ (Đang nâng cấp):</div>
                     <ul style={{margin: 0, paddingLeft: 20}}>
                         {me.myRewards!.map((id: string) => <li key={id} style={{color: C.sub, marginBottom: 4}}>{id}</li>)}
                     </ul>
                 </div>
              )}
          </div>
          </>)}

          {/* ===== TAB: TỪ VỰNG ===== */}
          {portalTab === "vocab" && (<>
          <div className="card" style={{ marginBottom: 24 }}>
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 14}}>
                  <h3 style={{margin: 0, fontSize: 15, display: 'flex', alignItems: 'center', gap: 8}}><Ico name="book" size={17} color={C.accent} /> {t('vocab_notebook')}</h3>
                  <div style={{display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap'}}>
                      <span style={{fontSize: 12, color: C.sub, fontWeight: 700}}>{vocabCards.length} {t('vocab_words')}{dueCount > 0 ? ` · ${dueCount} ${t('vocab_due')}` : ''}</span>
                      <button onClick={() => setShowVocabKinds(v => !v)} title={t('vocab_kinds_title')} style={{background: showVocabKinds ? C.accent : C.bg, color: showVocabKinds ? '#fff' : C.text, fontSize: 13, fontWeight: 800, padding: '8px 11px', borderRadius: 9, border: `1px solid ${showVocabKinds ? C.accent : C.border}`, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center'}}><Ico name="gear" size={16} /></button>
                      <button onClick={handleGenerateVocab} disabled={vocabGenLoading} style={{background: 'linear-gradient(135deg,#8b5cf6,#6366f1)', color: '#fff', fontSize: 12, fontWeight: 800, padding: '8px 13px', borderRadius: 9, opacity: vocabGenLoading ? 0.7 : 1, whiteSpace: 'nowrap'}}>{vocabGenLoading ? <span style={{display:'inline-flex',alignItems:'center',gap:6}}><Ico name="refresh" size={14} /> {t('vocab_generating')}</span> : <span style={{display:'inline-flex',alignItems:'center',gap:6}}><Ico name="sparkles" size={14} /> {t('vocab_generate')}</span>}</button>
                  </div>
              </div>

              {/* BẢNG CHỌN NHÓM AI ƯU TIÊN TRÍCH */}
              {showVocabKinds && (
                  <div style={{marginBottom: 16, padding: '12px 14px', background: C.bg, borderRadius: 11, border: `1px solid ${C.border}`}}>
                      <div style={{fontSize: 11.5, fontWeight: 800, color: C.sub, marginBottom: 8}}>{t('vocab_kinds_title')}</div>
                      <div style={{display: 'flex', gap: 7, flexWrap: 'wrap'}}>
                          {VOCAB_CATS.map(cat => {
                              const on = vocabKinds.includes(cat.key);
                              return (
                                  <button key={cat.key} onClick={() => setVocabKinds(prev => {
                                      if (prev.includes(cat.key)) { const nx = prev.filter(k => k !== cat.key); return nx.length ? nx : prev; }
                                      return [...prev, cat.key];
                                  })} style={{display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 800, padding: '6px 11px', borderRadius: 20, cursor: 'pointer', border: `1px solid ${on ? cat.color : C.border}`, background: on ? cat.color : C.card, color: on ? '#fff' : C.sub}}>
                                      <span style={{display:'inline-flex',alignItems:'center',gap:4}}>{on ? <Ico name="check" size={12} /> : null}<Ico name={cat.icon} size={14} /></span>{t('vocab_cat_' + cat.key)}
                                  </button>
                              );
                          })}
                      </div>
                      <div style={{fontSize: 11, color: C.sub, marginTop: 8, lineHeight: 1.5}}>{t('vocab_kinds_hint')}</div>
                      {/* CHỌN SỐ LƯỢNG TỪ MUỐN TẠO */}
                      <div style={{display: 'flex', alignItems: 'center', gap: 9, marginTop: 12, flexWrap: 'wrap', paddingTop: 12, borderTop: `1px solid ${C.border}`}}>
                          <span style={{fontSize: 11.5, fontWeight: 800, color: C.sub}}>{t('vocab_count_label')}</span>
                          <div style={{display: 'inline-flex', alignItems: 'center', gap: 4, background: C.card, border: `1px solid ${C.border}`, borderRadius: 9, padding: '3px 4px'}}>
                              <button onClick={() => setVocabCount(c => Math.max(5, (c || 15) - 5))} style={{width: 26, height: 26, borderRadius: 7, border: 'none', background: C.bg, color: C.text, fontWeight: 800, fontSize: 16, cursor: 'pointer', lineHeight: 1}}>−</button>
                              <span style={{minWidth: 30, textAlign: 'center', fontWeight: 800, fontSize: 15, color: C.accent}}>{vocabCount}</span>
                              <button onClick={() => setVocabCount(c => Math.min(40, (c || 15) + 5))} style={{width: 26, height: 26, borderRadius: 7, border: 'none', background: C.bg, color: C.text, fontWeight: 800, fontSize: 16, cursor: 'pointer', lineHeight: 1}}>+</button>
                          </div>
                          {[10, 15, 20, 25].map(n => (
                              <button key={n} onClick={() => setVocabCount(n)} style={{fontSize: 12, fontWeight: 800, padding: '5px 11px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${vocabCount === n ? C.accent : C.border}`, background: vocabCount === n ? C.accent : C.card, color: vocabCount === n ? '#fff' : C.sub}}>{n}</button>
                          ))}
                      </div>
                  </div>
              )}

              {vocabCards.length === 0 ? (
                  <div style={{fontSize: 13, color: C.sub, padding: '12px 0', lineHeight: 1.6}}>{t('vocab_empty_hint')}</div>
              ) : (
                  <>
                      <div style={{display: 'flex', gap: 8, marginBottom: 16}}>
                          <button onClick={() => { setVocabView('study'); setStudyFlipped(false); }} style={{flex: 1, background: vocabView === 'study' ? C.accent : C.bg, color: vocabView === 'study' ? '#fff' : C.text, padding: '9px', borderRadius: 9, fontWeight: 800, fontSize: 13, border: `1px solid ${C.border}`}}><Ico name="cards" size={15} /> {t('vocab_flashcard')}{dueCount > 0 ? ` (${dueCount})` : ''}</button>
                          <button onClick={() => setVocabView('list')} style={{flex: 1, background: vocabView === 'list' ? C.accent : C.bg, color: vocabView === 'list' ? '#fff' : C.text, padding: '9px', borderRadius: 9, fontWeight: 800, fontSize: 13, border: `1px solid ${C.border}`}}><Ico name="list" size={15} /> {t('vocab_list')}</button>
                          <button onClick={() => setVocabView('game')} style={{flex: 1, background: vocabView === 'game' ? 'linear-gradient(135deg,#f59e0b,#ef4444)' : C.bg, color: vocabView === 'game' ? '#fff' : C.text, padding: '9px', borderRadius: 9, fontWeight: 800, fontSize: 13, border: `1px solid ${vocabView === 'game' ? 'transparent' : C.border}`}}><Ico name="zap" size={15} /> Blitz</button>
                      </div>

                      {vocabView === 'game' ? (() => {
                          const _gd = new Date(getTrueTime()).toISOString().slice(0, 10);
                          const _rec = ((me as any).vocabGameDaily && (me as any).vocabGameDaily.date === _gd) ? (me as any).vocabGameDaily : { date: _gd, count: 0 };
                          const _awardsLeft = Math.max(0, 3 - (_rec.count || 0));
                          return (
                          <VocabBlitz cards={vocabCards} C={C} awardsLeft={_awardsLeft}
                              onReview={(id: string, ok: boolean) => reviewVocabCard(id, ok)}
                              onAward={(n: number) => {
                                  const gd = new Date(getTrueTime()).toISOString().slice(0, 10);
                                  const rec = ((me as any).vocabGameDaily && (me as any).vocabGameDaily.date === gd) ? (me as any).vocabGameDaily : { date: gd, count: 0 };
                                  if ((rec.count || 0) >= 3 || n <= 0) return; // hết lượt thưởng/ngày
                                  const newRec = { date: gd, count: (rec.count || 0) + 1 };
                                  const nx = students.map((s: any) => s.id === me.id ? ({ ...s, coins: (s.coins || 0) + n, vocabGameDaily: newRec }) : s);
                                  setStudents(nx as any); syncData({ students: nx });
                              }} />
                          );
                      })() : vocabView === 'study' ? (
                          dueCards.length === 0 ? (
                              <div style={{textAlign: 'center', padding: 36, color: C.succ, fontWeight: 800, fontSize: 15}}><Ico name="sparkles" size={16} /> {t('vocab_done_today')}</div>
                          ) : (
                              <div>
                                  <style>{`
                                    .fc-scene{ perspective: 1400px; }
                                    .fc-card{ display:grid; transform-style:preserve-3d; transition: transform .62s cubic-bezier(.34,1.3,.4,1); will-change: transform; cursor:pointer; outline:none; }
                                    .fc-card.flip{ transform: rotateY(180deg); }
                                    .fc-card:focus-visible{ box-shadow:0 0 0 3px ${C.accent}55; border-radius:18px; }
                                    .fc-face{ grid-area:1/1; -webkit-backface-visibility:hidden; backface-visibility:hidden; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:30px 26px; text-align:center; border-radius:18px; min-height:188px; box-shadow:0 10px 30px -18px ${C.accent}66; }
                                    .fc-back{ transform: rotateY(180deg); }
                                    @media (prefers-reduced-motion: reduce){ .fc-card{ transition:none; } }
                                  `}</style>
                                  <div className="fc-scene">
                                      <div className={'fc-card' + (studyFlipped ? ' flip' : '')} tabIndex={0} role="button" aria-label={t('vocab_tap_flip')}
                                          onClick={() => setStudyFlipped(f => !f)}
                                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setStudyFlipped(f => !f); } }}>
                                          {/* MẶT TRƯỚC — từ */}
                                          <div className="fc-face" style={{userSelect: 'none', border: `2px solid ${C.accent}40`, background: C.bg}}>
                                              <div style={{fontSize: 30, fontWeight: 900, color: C.text, lineHeight: 1.15, display: 'inline-flex', alignItems: 'center', gap: 7}}><span>{dueCards[0].word}</span>{!dueCards[0].phonetic && renderPronounceButton(dueCards[0], false, true)}</div>
                                              {dueCards[0].phonetic && <div style={{fontSize: 14, color: C.sub, marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 5}}><span>{dueCards[0].phonetic}</span>{renderPronounceButton(dueCards[0], false, true)}</div>}
                                              <div style={{fontSize: 11, color: C.sub, marginTop: 18, textTransform: 'uppercase', letterSpacing: 1}}><Ico name="pointer" size={14} /> {t('vocab_tap_flip')}</div>
                                          </div>
                                          {/* MẶT SAU — nghĩa */}
                                          <div className="fc-face fc-back" style={{userSelect: 'none', border: `2px solid ${C.accent}`, background: `${C.accent}0d`}}>
                                              <div style={{fontSize: 12, fontWeight: 800, color: catMeta(dueCards[0].category || 'word').color, display: 'inline-flex', alignItems: 'center', gap: 5}}><Ico name={catMeta(dueCards[0].category || 'word').icon} size={13} /> {t('vocab_cat_' + (dueCards[0].category || 'word'))}{dueCards[0].pos ? ` · ${dueCards[0].pos}` : ''}{dueCards[0].cefr ? ` · ${dueCards[0].cefr}` : ''}</div>
                                              <div style={{fontSize: 19, fontWeight: 800, margin: '10px 0', color: C.text}}>{dueCards[0].meaning}</div>
                                              {dueCards[0].example && <div style={{fontSize: 13.5, color: C.sub, fontStyle: 'italic', marginTop: 6, lineHeight: 1.5}}>"{dueCards[0].example}"</div>}
                                          </div>
                                      </div>
                                  </div>
                                  <div style={{display: 'flex', gap: 10, marginTop: 16}}>
                                      <button onClick={() => { reviewVocabCard(dueCards[0].id, false); setStudyFlipped(false); }} style={{flex: 1, background: `${C.err}15`, color: C.err, padding: '13px', borderRadius: 11, fontWeight: 800, fontSize: 14}}><Ico name="xcircle" size={16} /> {t('vocab_forgot')}</button>
                                      <button onClick={() => { reviewVocabCard(dueCards[0].id, true); setStudyFlipped(false); }} style={{flex: 1, background: `${C.succ}15`, color: C.succ, padding: '13px', borderRadius: 11, fontWeight: 800, fontSize: 14}}><Ico name="check" size={16} /> {t('vocab_remember')}</button>
                                  </div>
                              </div>
                          )
                      ) : (
                          <div>
                              {/* CHIP LỌC THEO LOẠI */}
                              <div style={{display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10}}>
                                  {['all', ...VOCAB_CATS.map(x => x.key)].map(k => {
                                      const cnt = k === 'all' ? vocabCards.length : vocabCards.filter(c => (c.category || 'word') === k).length;
                                      const active = vocabFilter === k;
                                      const m = k === 'all' ? null : catMeta(k);
                                      const col = m ? m.color : C.accent;
                                      return (
                                          <button key={k} onClick={() => setVocabFilter(k)} style={{display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5, fontWeight: 800, padding: '5px 10px', borderRadius: 20, cursor: 'pointer', border: `1px solid ${active ? col : C.border}`, background: active ? col : C.bg, color: active ? '#fff' : (cnt ? C.text : C.sub), opacity: cnt || k === 'all' ? 1 : 0.5}}>
                                              {m ? <Ico name={m.icon} size={12} style={{verticalAlign:'-2px',marginRight:4}} /> : null}{t('vocab_cat_' + k)}{cnt > 0 ? ` (${cnt})` : ''}
                                          </button>
                                      );
                                  })}
                              </div>
                              <div style={{display: 'grid', gap: 8, maxHeight: 360, overflowY: 'auto'}}>
                                  {filteredVocab.length === 0 ? (
                                      <div style={{textAlign: 'center', padding: 24, color: C.sub, fontSize: 13}}>—</div>
                                  ) : filteredVocab.map(c => {
                                      const m = catMeta(c.category || 'word');
                                      return (
                                      <div key={c.id} style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, padding: '11px 13px', background: C.bg, borderRadius: 11, border: `1px solid ${C.border}`, borderLeft: `3px solid ${m.color}`}}>
                                          <div style={{flex: 1}}>
                                              <div style={{display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap'}}>
                                                  <b style={{fontSize: 14.5, display: 'inline-flex', alignItems: 'center', gap: 4}}><span>{c.word}</span>{!c.phonetic && renderPronounceButton(c, true)}</b>
                                                  <span style={{fontSize: 9.5, fontWeight: 800, background: `${m.color}18`, color: m.color, padding: '1px 7px', borderRadius: 20, display: 'inline-flex', alignItems: 'center', gap: 4}}><Ico name={m.icon} size={11} /> {t('vocab_cat_' + (c.category || 'word'))}</span>
                                                  {c.phonetic && <span style={{fontSize: 11, color: C.sub, display: 'inline-flex', alignItems: 'center', gap: 4}}><span>{c.phonetic}</span>{renderPronounceButton(c, true)}</span>}
                                                  {c.cefr && <span style={{fontSize: 10, fontWeight: 800, background: `${C.accent}15`, color: C.accent, padding: '1px 6px', borderRadius: 4}}>{c.cefr}</span>}
                                                  <span style={{fontSize: 9, color: C.succ, letterSpacing: 1}} title={`Box ${c.box || 1}/5`}>{'●'.repeat(c.box || 1)}{'○'.repeat(Math.max(0, 5 - (c.box || 1)))}</span>
                                              </div>
                                              <div style={{fontSize: 12.5, color: C.text, marginTop: 3}}>{c.meaning}</div>
                                              {c.example && <div style={{fontSize: 11.5, color: C.sub, fontStyle: 'italic', marginTop: 2}}>"{c.example}"</div>}
                                              {c.evidence && <div style={{fontSize: 11, color: m.color, marginTop: 4, paddingLeft: 8, borderLeft: `2px solid ${m.color}55`, lineHeight: 1.45}}><Ico name="pin" size={13} /> {t('vocab_from_test')}: <span style={{color: C.sub, fontStyle: 'italic'}}>"…{c.evidence}…"</span></div>}
                                          </div>
                                          <button onClick={() => deleteVocabCard(c.id)} style={{background: 'transparent', color: C.err, fontSize: 13, padding: '2px 6px', flexShrink: 0}}><Ico name="x" size={13} /></button>
                                      </div>
                                      );
                                  })}
                              </div>
                          </div>
                      )}
                  </>
              )}
          </div>

          <div className="card" style={{padding: "20px 24px", background: `linear-gradient(135deg, ${C.card}, ${C.accent}15)`, marginBottom: 24}}>
              <div style={{ fontSize: 11, fontWeight: 900, color: C.accent, marginBottom: 5 }}><Ico name="sparkles" size={14} /> IDIOM OF THE MONTH (B1+)</div>
              <div style={{ fontSize: 18, fontWeight: 900, marginTop: 10 }}>"do/work wonders"</div>
              <div style={{ fontSize: 13, color: C.sub, marginTop: 5, fontStyle: 'italic' }}>to help or improve something greatly (According to Merriam-Webster Dictionary).</div>
              <div style={{ fontSize: 12, marginTop: 10, background: C.bg, padding: 10, borderRadius: 6, border: `1px solid ${C.border}` }}>
                  <b>Example:</b> Only making endless efforts may <i>work wonders</i> to help you reach your goal.
              </div>
          </div>
          </>)}

          {/* ===== TAB: TIẾN ĐỘ ===== */}
          {portalTab === "progress" && (<>
          {recentScores.length > 0 && (
            <div className="card" style={{ marginBottom: 24 }}>
                <h3 style={{marginTop: 0, fontSize: 14, color: C.sub, textTransform: 'uppercase'}}><Ico name="trending" size={14} style={{verticalAlign:'-2px',margin:'0 6px 0 0',display:'inline-block'}} />{t('chart_my_progress')}</h3>
                <div style={{marginTop: 12}}>
                    <BandTrendChart data={bandSeries(myQuizResults)} color={C.accent} height={190} />
                </div>
            </div>
          )}
          </>)}

          {/* ===== TAB: TỔNG QUAN (tiếp) — lịch học & tiến độ EXP ===== */}
          {portalTab === "home" && (<>
          {nextClass && (
            <div className="card" style={{ marginBottom: 24, background: `${C.warn}10`, border: `1px solid ${C.warn}40` }}>
              <div style={{ fontSize: 11, fontWeight: 900, color: C.warn, marginBottom: 5 }}><Ico name="calendar" size={13} color={C.warn} /> {t('upcoming_class')}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                 <div>
                    <div style={{fontSize: 18, fontWeight: 900}}>{nextClass!.date} <span style={{background: C.warn, color: '#fff', padding: '2px 6px', borderRadius: 4, fontSize: 12, marginLeft: 8}}>{nextClass!.time}</span></div>
                    <div style={{fontSize: 13, color: C.sub, marginTop: 5, wordBreak: 'break-word'}}>
                        {t('instructor')}: {nextClass!.teacher} • {t('location')}: {
                            (nextClass!.location || "").split(/(https?:\/\/[^\s]+)/g).map((part, i) => 
                                /(https?:\/\/[^\s]+)/.test(part) ? 
                                    <a key={i} href={part} target="_blank" rel="noopener noreferrer" style={{color: C.accent, textDecoration: 'underline', fontWeight: 700}}>{part}</a> 
                                    : <span key={i}>{part}</span>
                            )
                        }
                    </div>
                 </div>
              </div>
            </div>
          )}

          <div className="card" style={{ marginBottom: 24, padding: "20px 24px" }}>
            <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: 10}}>
              <span style={{fontSize: 12, fontWeight: 800, color: C.sub}}>{t('current_progress')}</span>
              <span style={{fontSize: 12, fontWeight: 800, color: C.accent}}>{currentExp} / {expForNextLevel} EXP ({progressPct}%)</span>
            </div>
            <div style={{height: 8, background: C.border, borderRadius: 10, overflow: 'hidden'}}>
               <div style={{width: `${progressPct}%`, height: '100%', background: C.accent, transition: 'width 1s ease-in-out', borderRadius: 10}}></div>
            </div>
            <div style={{display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 11, fontWeight: 700, color: C.sub}}>
              <span>{t('current_cefr')}: {me.cefr || "N/A"}</span>
              <span style={{textAlign: 'right'}}>
                  {t('target_band')}: IELTS {me.target || "N/A"}<br/>
                  <span style={{fontSize: 10, color: targetGap > 0 ? C.warn : C.succ}}>{motivationMsg}</span>
              </span>
            </div>
          </div>
          </>)}

          {/* ===== TAB: PHÒNG THI ===== */}
          {portalTab === "exams" && (<>
          <div className="card" style={{ marginBottom: 24, border: `2px solid ${C.warn}` }}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10}}>
                <h3 style={{marginTop: 0, color: C.warn, margin: 0}}>{t('test_room_title')}</h3>
                {examRoomTab === "available" && (
                  <input placeholder={t('filter_quizzes')} value={stQuizSearch} onChange={(e: any)=>setStQuizSearch(e.target.value)} style={{width: 150, padding: '4px 8px', fontSize: 12}} />
                )}
            </div>
            {/* SUB-TABS: Đề khả dụng | Kết quả & Review — mỗi danh sách ngắn, không cuộn qua nhau */}
            <div style={{display: 'flex', gap: 8, marginTop: 14}}>
              {([
                { k: 'available', label: t('exam_tab_available'), n: activeQuizzes.length },
                { k: 'results', label: t('exam_tab_results'), n: myQuizResults.filter(Boolean).length },
              ] as const).map(sb => {
                const on = examRoomTab === sb.k;
                return (
                  <button key={sb.k} onClick={() => setExamRoomTab(sb.k)} style={{ flex: '0 0 auto', padding: '7px 15px', borderRadius: 8, border: `1px solid ${on ? C.accent : C.border}`, cursor: 'pointer', fontSize: 13, fontWeight: 800, background: on ? C.accent : 'transparent', color: on ? '#fff' : C.sub, transition: 'background .15s' }}>
                    {sb.label}{sb.n > 0 ? ` · ${sb.n}` : ''}
                  </button>
                );
              })}
            </div>
            {examRoomTab === "available" && (
            <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
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
                      <div key={q.id} style={{ background: C.bg, padding: '11px 14px', borderRadius: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, border: `1px solid ${C.border}` }}>
                          <div>
                              <div style={{fontWeight: 800, fontSize: 15}}>
                                  {q.tag && <span style={{fontSize: 10, background: C.accent, color: '#fff', padding: '2px 6px', borderRadius: 4, marginRight: 5}}>{q.tag}</span>}
                                  {q.title} {q.passcode && <span title={t('tip_pwd_required')}><Ico name="lock" size={13} color={C.sub} /></span>}
                                  {q.isSEBRequired && <span title={t('tip_seb_required')} style={{marginLeft: 5}}><Ico name="shield" size={13} color={C.accent} /></span>}
                                  <span style={{fontSize: 10, background: C.card, padding: '2px 6px', borderRadius: 4, marginLeft: 5}}>{q.type}</span>
                              </div>
                              <div style={{fontSize: 12, color: C.sub, marginTop: 4}}>{q.timeLimit} {t('time_limit')} • {(q.questions || []).length} {t('questions_count')} • {t('previous_attempts')}: {attemptCount}/{q.maxAttempts || 1}</div>
                              <div style={{fontSize: 11, color: isLockedByOtherDevice ? C.warn : (isAvailable ? C.succ : C.err), marginTop: 4, fontWeight: 700}}>
                                  <Ico name="clock" size={14} style={{verticalAlign:'-2px',marginRight:6,display:'inline-block'}} />{isLockedByOtherDevice ? t('locked_other_device') : statusText}
                              </div>
                          </div>
                          {(isAvailable && !isLockedByOtherDevice) ? (
                              <div style={{display: 'flex', gap: 10}}>
                                  <button onClick={() => {
    // Chuyển sang chế độ Preview (isPreview = true, isStudentTestUI = true)
    // Điều này sẽ kích hoạt cơ chế mã hóa đề thi và chặn lưu kết quả thật
    startExam(q, true, true);
}} style={{ background: C.card, color: C.text, padding: "8px 15px", border: `1px solid ${C.border}`, borderRadius: 6, fontWeight: 700, cursor: 'pointer', fontSize: 12 }} title={t('tip_test_ui')}><Ico name="monitor" size={13} /> {t('test_ui_btn')}</button>
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
                                  if(confirm("BÀI THI NÀY ĐANG ĐƯỢC MỞ Ở MỘT THIẾT BỊ KHÁC!\n\nNếu bạn tiếp tục, phiên làm bài ở thiết bị kia sẽ bị hủy bỏ và đá văng. Bạn có chắc chắn muốn ép buộc vào thi?")) {
                                      const currentLocalSession = localStorage.getItem("ielts_os_device_session") || "";
                                      const nx = students.map(s => s.id === me.id ? { ...s, activeExamId: q.id, currentSessionId: currentLocalSession } : s);
                                      setStudents(nx); syncData({ students: nx });
                                      startExam(q, false);
                                  }
                              }} style={{ background: C.warn, color: "#fff", padding: "8px 15px", border: 'none', borderRadius: 6, fontWeight: 700, cursor: 'pointer', fontSize: 11 }}>{t('force_take')}</button>
                          ) : (
                              <span style={{background: `${C.err}20`, color: C.err, padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700}}>{badgeText}</span>
                          )}
                      </div>
                  )
              })}
              {activeQuizzes.length === 0 && <div style={{color: C.sub, fontSize: 13, textAlign: 'center', padding: 10}}>{t('no_quizzes')}</div>}
            </div>
            )}

            {examRoomTab === "results" && (
                <div style={{marginTop: 14}}>
                    {myQuizResults.filter(Boolean).length === 0 && <div style={{color: C.sub, fontSize: 13, textAlign: 'center', padding: 24}}>{t('no_quizzes')}</div>}
                    {myQuizResults.map(r => {
                        if (!r) return null;
                        return (
                        <div key={r.id} style={{display: 'flex', justifyContent: 'space-between', gap: 12, padding: '12px 4px', borderBottom: `1px solid ${C.border}`, alignItems: 'center'}}>
                            <div style={{minWidth: 0}}>
                                <div style={{fontSize: 14, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{r.quizTitle}</div>
                                <div style={{fontSize: 11, color: C.sub, marginTop: 3}}>{r.date}</div>
                            </div>
                            <div style={{display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0}}>
                                <div style={{textAlign: 'right'}}>
                                    <div style={{fontSize: 17, fontWeight: 900, color: C.accent, lineHeight: 1}}>{r.score}/{r.total}</div>
                                    <div style={{fontSize: 11, fontWeight: 800, color: C.sub, marginTop: 2}}>{t('band_label')} {r.band}</div>
                                </div>
                                <button onClick={() => handleReviewQuiz(r)} style={{fontSize: 11, fontWeight: 700, background: C.card, border: `1px solid ${C.border}`, color: C.text, padding: '7px 12px', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap'}}>{t('view_review')}</button>
                            </div>
                        </div>
                    )})}
                </div>
            )}
          </div>
          </>)}

          {/* ===== TAB: TIẾN ĐỘ (tiếp) — tài nguyên & lịch sử buổi học ===== */}
          {portalTab === "progress" && (<>
          <div className="card" style={{ marginBottom: 24 }}>
            <h3 style={{marginTop: 0, display: 'flex', alignItems: 'center', gap: 8, borderBottom: `1px solid ${C.border}`, paddingBottom: 15}}><Ico name="folder" size={18} color={C.accent} /> {t('drive_hub_title')}</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 15, marginTop: 15 }}>
              {myLinks.map(l => {
                return (
                <div key={l.id} style={{ background: C.bg, padding: 15, borderRadius: 10, border: `1px solid ${C.border}` }}>
                  <div style={{ fontWeight: 800, marginBottom: 10, fontSize: 13, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', height: 35 }}>
                      {getFileIcon(l.url)} {l.title}
                  </div>
                  <div style={{display: 'flex', gap: 8}}>
                    <a href={l.url} target="_blank" rel="noreferrer" style={{ flex: 1, background: C.accent, color: "#fff", padding: "8px", borderRadius: 6, fontSize: 11, textDecoration: "none", textAlign:'center', fontWeight: 700 }}>{t('open_download')}</a>
                  </div>
                </div>
              )})}
              {myLinks.length === 0 && <div style={{color: C.sub, fontSize: 13, gridColumn: '1 / -1', textAlign: 'center', padding: 20}}>{t('no_shared_links')}</div>}
            </div>
          </div>

          <div className="card">
            <h3 style={{marginTop: 0, borderBottom: `1px solid ${C.border}`, paddingBottom: 15}}>{t('class_history_title')}</h3>
            {myHistory.map(h => {
              return (
              <div key={h.id} style={{ borderBottom: `1px solid ${C.border}`, padding: "20px 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: 'center' }}>
                  <span style={{ fontWeight: 900, fontSize: 15 }}>{h.date}</span>
                  <span style={{ fontSize: 10, fontWeight: 800, padding: '4px 10px', background: h.isPaid?`${C.succ}15`:`${C.warn}15`, color: h.isPaid?C.succ:C.warn, borderRadius: 12 }}>{h.isPaid ? t('tuition_paid') : t('tuition_debt')}</span>
                </div>
                <div style={{ color: C.sub, fontSize: 12, marginTop: 6, fontWeight: 600 }}>{t('instructor')}: {h.teacher}</div>
                <div style={{ marginTop: 12, fontSize: 14, background: C.bg, padding: 15, borderRadius: 8, border: `1px solid ${C.border}`, lineHeight: 1.5 }}>{h.notes || t('no_additional_notes')}</div>
                <div style={{ display: "flex", flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
                  {(Array.isArray(h.skills) ? h.skills : []).map(sk => <span key={sk} style={{ background: C.card, border: `1px solid ${C.border}`, padding: "4px 10px", borderRadius: 6, fontSize: 10, fontWeight: 700, color: C.sub }}>{sk}</span>)}
                </div>
              </div>
            )})}
            {myHistory.length === 0 && <div style={{textAlign: 'center', padding: 30, color: C.sub, fontSize: 13}}>{t('no_history')}</div>}
          </div>
          </>)}
        </main>
        {/* MOBILE BOTTOM TABS */}
        {isMobile && (
          <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 1000, background: 'rgba(255,255,255,0.93)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderTop: `1px solid ${C.border}`, display: 'flex', paddingBottom: 'env(safe-area-inset-bottom)' }}>
            {([
              { k: 'home', icon: 'home', label: t('ptab_home') },
              { k: 'exams', icon: 'monitor', label: t('ptab_exams') },
              { k: 'vocab', icon: 'book', label: t('ptab_vocab') },
              { k: 'progress', icon: 'trending', label: t('ptab_progress') },
              { k: 'rewards', icon: 'gift', label: t('ptab_rewards') },
            ] as const).map(tb => {
              const on = portalTab === tb.k;
              return (
                <button key={tb.k} onClick={() => { setPortalTab(tb.k); window.scrollTo({ top: 0 }); }} style={{ flex: 1, background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '8px 0', color: on ? C.accent : C.sub }}>
                  <Ico name={tb.icon} size={21} color={on ? C.accent : C.sub} />
                  <span style={{ fontSize: 10, fontWeight: on ? 800 : 600 }}>{tb.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ==========================================
  // VIEW: TEACHER / ADMIN PORTAL
  // ==========================================
  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "system-ui, sans-serif", transition: "0.2s" }}>
      {globalStyles}
      {confettiOverlay}
      <nav className="no-print" data-app-unused={String(printBlankSheet)+String(setPrintBlankSheet)+String(builderSectionIndex)+String(setBuilderSectionIndex)} style={{ background: 'rgba(255, 255, 255, 0.85)', backdropFilter: 'blur(30px)', WebkitBackdropFilter: 'blur(30px)', borderBottom: `1px solid ${C.border}`, padding: isMobile ? "9px 14px" : "12px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, zIndex: 100, gap: isMobile ? 10 : 20 }}>
        
        {/* LOGO AREA */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <BrandLogo size={34} />
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: -0.5, display: 'flex', alignItems: 'center', gap: 8 }}>
              <BrandWordmark size={18} color={C.text} /> <span style={{ background: `${C.accent}14`, color: C.accent, fontSize: 11, fontWeight: 800, padding: '2px 7px', borderRadius: 6, letterSpacing: 0.5 }}>{t('role_teacher')}</span>
          </h1>
        </div>

        {/* TABS - SEGMENTED CONTROL IOS STYLE */}
        <div style={{ flex: 1, display: isMobile ? 'none' : 'flex', justifyContent: 'center', overflow: 'hidden' }}>
            <div className="ios-tabs-container">
              {(["DASHBOARD", "CLASSROOM", "EXAM_BUILDER", "LIVE_ARENA", "STUDENTS", "FINANCE", "DRIVE"] as TabType[]).map(tabKey => (
                <button key={tabKey} onClick={() => setActiveTab(tabKey)} className={`tab-btn ${activeTab === tabKey ? 'active' : ''}`}>{t('tab_' + tabKey)}</button>
              ))}
            </div>
        </div>

        {/* STATUS & UTILITIES */}
        <div style={{ display: "flex", gap: 12, alignItems: 'center', flexShrink: 0 }}>
          <div style={{fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 8, background: serverStatus === "OK" ? `${C.succ}15` : `${C.err}15`, color: serverStatus === "OK" ? C.succ : C.err }} title={t('backend_status')}>
              {serverStatus === "OK" ? "API: ON" : "API: OFF"}
          </div>
          <div style={{fontSize: 13, fontWeight: 700, color: C.sub, background: '#F4F2EC', padding: '4px 10px', borderRadius: 8, fontFamily: 'var(--mono), SFMono-Regular, monospace', fontVariantNumeric: 'tabular-nums'}}>{liveTime}</div>
          {!isMobile && <div style={{width: 1, height: 20, background: C.border}}></div>}
          {!isMobile && <LanguageToggle role="TEACHER" />}
          {!isMobile && <button onClick={() => setColorblind(!colorblind)} style={{ background: "transparent", fontSize: 18, padding: "4px", opacity: colorblind ? 1 : 0.5 }} title={t('contrast_mode')}><Ico name="eye" size={18} /></button>}
          {!isMobile && <button onClick={handleLogout} style={{ background: `${C.err}10`, color: C.err, padding: "6px 12px", fontSize: 12, fontWeight: 600, borderRadius: 8 }}>{t('exit')}</button>}
        </div>
      </nav>

      <main className="no-print" data-app-unused={String(printBlankSheet)+String(setPrintBlankSheet)+String(builderSectionIndex)+String(setBuilderSectionIndex)} style={{ maxWidth: 1200, margin: "0 auto", padding: isMobile ? "14px 12px 96px" : "40px 24px", position: 'relative' }}>
        
        {/* Background Mesh (Only visible on Dashboard) */}
        {/* ================= DASHBOARD ================= */}
        {activeTab === "DASHBOARD" && !isMobile && (() => {
          const teachHrs = history.reduce((s,h)=>s+((h && h.duration)||0),0)/3600;
          // Giờ dạy là tích luỹ TRỌN ĐỜI -> không có trần cố định. Mốc động: luôn nhắm tới cột mốc kế tiếp,
          // nên thanh tiến độ không bao giờ tràn 100% và "vô lý" như trần 40h cũ.
          const _hrsMilestones = [10, 25, 50, 100, 200, 350, 500, 750, 1000, 1500, 2000, 3000, 5000];
          const hrsTarget = _hrsMilestones.find(m => m > teachHrs) || Math.ceil((teachHrs + 1) / 1000) * 1000;
          const hrsPct = Math.max(0, Math.min(1, teachHrs / hrsTarget));
          const dToday = new Date();
          const dDateLine = dToday.toLocaleDateString(i18n.language === 'vi' ? 'vi-VN' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
          return (
          <>
            <style>{`
              @keyframes riseIn { from { opacity:0; transform: translateY(14px); } to { opacity:1; transform:none; } }
              .dRise { animation: riseIn .55s cubic-bezier(.22,1,.36,1) both; }
              @keyframes meterGrow { from { width: 0; } }
              .dMeter { animation: meterGrow 1.1s cubic-bezier(.22,1,.36,1) .2s both; }
              .dLedgerCell { transition: background .15s; }
              .dLedgerCell:hover { background: ${C.bg}; }
              @media (prefers-reduced-motion: reduce){ .dRise,.dMeter{ animation: none !important; } }
            `}</style>
          <div style={{ display: "grid", gridTemplateColumns: window.innerWidth > 900 ? "1fr 340px" : "1fr", gap: 28 }}>
            <div style={{ display: "grid", gap: 24 }}>

              {/* SỔ CÁI — Manuscript/Editorial: hairline + thanh accent dọc, serif cho con số chính, mono cho số liệu */}
              <div className="dRise" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16, padding: '14px 26px', borderBottom: `1px solid ${C.border}` }}>
                  <div style={{ fontFamily: 'var(--heading)', fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.sub }}>{t('net_profit')}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: C.sub, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{dDateLine}</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(230px, 1.5fr) repeat(3, minmax(0, 1fr))', alignItems: 'stretch' }}>
                  <div style={{ minWidth: 0, overflow: 'hidden', padding: '24px 26px 22px', borderLeft: `3px solid ${C.accent}` }}>
                    <div style={{ fontFamily: 'var(--display)', fontSize: 'clamp(26px, 2.6vw, 44px)', fontWeight: 550, letterSpacing: '-0.02em', lineHeight: 1.05, color: C.text, whiteSpace: 'nowrap' }}>{fmtMoney(stats.net)}</div>
                    <div style={{ display: 'flex', gap: 22, marginTop: 14, flexWrap: 'wrap' }}>
                      <div style={{ fontSize: 12.5, color: C.sub }}>{t('total_revenue')} <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: C.text, marginLeft: 4 }}>{fmtMoney(stats.totalRev)}</span></div>
                      <div style={{ fontSize: 12.5, color: C.sub }}>{t('pending_payment')} <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: C.warn, marginLeft: 4 }}>{fmtMoney(stats.unpaid)}</span></div>
                    </div>
                  </div>
                  {[
                    { lb: t('student_count'), vl: String(Array.isArray(students) ? students.length : 0), sub: null as any, meter: null as any },
                    { lb: t('drive_docs'), vl: String(Array.isArray(sharedLinks) ? sharedLinks.length : 0), sub: null as any, meter: null as any },
                    { lb: t('total_teaching_hours'), vl: `${teachHrs.toFixed(1)}h`, sub: `/ ${hrsTarget}h`, meter: hrsPct },
                  ].map((cell, ci) => (
                    <div key={ci} className="dLedgerCell" style={{ minWidth: 0, overflow: 'hidden', padding: '24px 20px 22px', borderLeft: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 12 }}>
                      <div style={{ fontFamily: 'var(--heading)', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.sub, lineHeight: 1.4 }}>{cell.lb}</div>
                      <div>
                        <div style={{ fontFamily: 'var(--display)', fontSize: 'clamp(22px, 1.8vw, 30px)', fontWeight: 550, color: C.text, lineHeight: 1, whiteSpace: 'nowrap' }}>{cell.vl}{cell.sub && <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: C.sub, marginLeft: 5 }}>{cell.sub}</span>}</div>
                        {cell.meter !== null && (
                          <div style={{ marginTop: 10, height: 3, background: C.border, borderRadius: 2, overflow: 'hidden' }}>
                            <div className="dMeter" style={{ width: `${Math.round(cell.meter * 100)}%`, height: '100%', background: C.accent }} />
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="dRise" style={{ animationDelay:'0.16s', background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
                {/* Header sổ lịch — Manuscript: micro-label + ngày serif + nút thêm phẳng */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, padding: '14px 26px', borderBottom: `1px solid ${C.border}` }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: 'var(--heading)', fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.sub }}>{t('teaching_schedule')}</div>
                    <div style={{ fontFamily: 'var(--display)', fontSize: 21, fontWeight: 550, color: C.text, marginTop: 2 }}>{viewDate}</div>
                  </div>
                  <button onClick={() => setShowSchedForm(!showSchedForm)} style={{ background: showSchedForm ? 'transparent' : C.accent, color: showSchedForm ? C.sub : '#fff', border: showSchedForm ? `1px solid ${C.border}` : '1px solid transparent', padding: "9px 18px", fontSize: 12, fontWeight: 700, borderRadius: 8, display: 'inline-flex', alignItems: 'center', gap: 7, flexShrink: 0, transition: '.15s' }}>
                    <Ico name={showSchedForm ? "x" : "plus"} size={13} />
                    {showSchedForm ? t('common_cancel') : t('add_schedule')}
                  </button>
                </div>

                {showSchedForm && (
                  <div style={{ padding: '18px 26px', borderBottom: `1px solid ${C.border}`, borderLeft: `3px solid ${C.accent}`, background: C.bg }}>
                    <div style={{ display: 'grid', gridTemplateColumns: window.innerWidth > 760 ? '130px 1.3fr 1.6fr 110px' : '1fr 1fr', gap: 14 }}>
                      {[
                        { lb: t('start_time'), el: <input type="time" value={schedForm.time} onChange={(e: any)=>setSchedForm({...schedForm, time:e.target.value})} style={{ width: '100%' }} /> },
                        { lb: t('student_label'), el: (
                          <select value={schedForm.studentId} onChange={(e: any)=>setSchedForm({...schedForm, studentId:e.target.value})} style={{ width: '100%' }}>
                            <option value="">{t('select_student')}</option>
                            {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                        ) },
                        { lb: t('location_link'), el: <input placeholder={t('zoom_ph')} value={schedForm.location} onChange={(e: any)=>setSchedForm({...schedForm, location:e.target.value})} style={{ width: '100%' }} /> },
                        { lb: t('sched_duration'), el: <input type="number" min={15} step={15} value={schedForm.duration} onChange={(e: any)=>setSchedForm({...schedForm, duration:Number(e.target.value)})} style={{ width: '100%' }} /> },
                      ].map((f, fi) => (
                        <div key={fi} style={{ minWidth: 0 }}>
                          <label style={{ display: 'block', fontFamily: 'var(--heading)', fontSize: 10, fontWeight: 700, letterSpacing: '0.11em', textTransform: 'uppercase', color: C.sub, marginBottom: 6 }}>{f.lb}</label>
                          {f.el}
                        </div>
                      ))}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 16, marginTop: 16 }}>
                      <div style={{ fontSize: 11.5, color: C.sub, marginRight: 'auto', fontFamily: 'var(--mono)' }}>{viewDate} - {schedForm.time || "--:--"}{schedForm.duration ? ` - ${schedForm.duration} min` : ""}</div>
                      <button onClick={() => setShowSchedForm(false)} style={{ background: 'transparent', color: C.sub, border: 'none', fontSize: 12.5, fontWeight: 600, padding: '9px 6px', cursor: 'pointer' }}>{t('common_cancel')}</button>
                      <button onClick={handleAddSchedule} style={{ background: C.accent, color: '#fff', border: 'none', padding: '10px 26px', fontSize: 12.5, fontWeight: 700, borderRadius: 8, cursor: 'pointer' }}>{t('save_schedule')}</button>
                    </div>
                  </div>
                )}
                <div style={{ padding: '16px 26px 20px' }}>

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

        {/* ================= DASHBOARD (MOBILE) ================= */}
        {activeTab === "DASHBOARD" && isMobile && (() => {
          const teachHrs = history.reduce((s,h)=>s+((h && h.duration)||0),0)/3600;
          // Giờ dạy là tích luỹ TRỌN ĐỜI -> không có trần cố định. Mốc động: luôn nhắm tới cột mốc kế tiếp,
          // nên thanh tiến độ không bao giờ tràn 100% và "vô lý" như trần 40h cũ.
          const _hrsMilestones = [10, 25, 50, 100, 200, 350, 500, 750, 1000, 1500, 2000, 3000, 5000];
          const hrsTarget = _hrsMilestones.find(m => m > teachHrs) || Math.ceil((teachHrs + 1) / 1000) * 1000;
          const hrsPct = Math.max(0, Math.min(1, teachHrs / hrsTarget));
          return (
          <>
            <style>{`
              @keyframes riseIn { from { opacity:0; transform: translateY(14px); } to { opacity:1; transform:none; } }
              .dRise { animation: riseIn .55s cubic-bezier(.22,1,.36,1) both; }
              @keyframes meterGrow { from { width: 0; } }
              .dMeter { animation: meterGrow 1s cubic-bezier(.22,1,.36,1) .2s both; }
              @media (prefers-reduced-motion: reduce){ .dRise,.dMeter{ animation: none !important; } }
            `}</style>
          <div style={{ display: 'grid', gap: 14 }}>
            {/* SỔ CÁI (mobile) — flat, thanh accent dọc, serif + mono */}
            <div className="dRise" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ padding: '16px 16px 14px', borderLeft: `3px solid ${C.accent}` }}>
                <div style={{ fontFamily: 'var(--heading)', fontSize: 10, fontWeight: 700, letterSpacing: '0.13em', textTransform: 'uppercase', color: C.sub }}>{t('net_profit')}</div>
                <div style={{ fontFamily: 'var(--display)', fontSize: 30, fontWeight: 550, letterSpacing: '-0.01em', lineHeight: 1.12, marginTop: 3, color: C.text }}>{fmtMoney(stats.net)}</div>
                <div style={{ fontSize: 11.5, color: C.sub, marginTop: 5 }}>{t('total_revenue')} <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: C.text }}>{fmtMoney(stats.totalRev)}</span></div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderTop: `1px solid ${C.border}` }}>
                <div style={{ fontFamily: 'var(--heading)', fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.sub, flexShrink: 0 }}>{t('total_teaching_hours')}</div>
                <div style={{ flex: 1, height: 3, background: C.border, borderRadius: 2, overflow: 'hidden' }}><div className="dMeter" style={{ width: `${Math.round(hrsPct * 100)}%`, height: '100%', background: C.accent }} /></div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, color: C.text, flexShrink: 0 }}>{teachHrs.toFixed(1)}h</div>
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
                <button onClick={() => setShowSchedForm(!showSchedForm)} style={{ background: C.accent, color: '#fff', padding: '7px 13px', fontSize: 12, borderRadius: 9, display: 'inline-flex', alignItems: 'center', gap: 6 }}><Ico name="plus" size={12} />{t('add_schedule')}</button>
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

        {/* ================= CLASSROOM (GIAO DIỆN TÍNH GIỜ OFFLINE CŨ) ================= */}
        {activeTab === "CLASSROOM" && (
          <div style={{ display: "grid", gap: 24 }}>
            <div className="card" style={{ display: "grid", gridTemplateColumns: window.innerWidth > 768 ? "1fr 1fr" : "1fr", gap: 24 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 900, color: C.sub, display: "block", marginBottom: 10 }}>{t('cls_select_student_label')}</label>
                <select value={selStudent} onChange={(e: any) => setSelStudent(e.target.value)}>
                  <option value="">{t('cls_select_student_opt')}</option>
                  {students.map(s => <option key={s.id} value={s.id}>{s.name} ({fmtMoney(s.rate)}/h)</option>)}
                </select>
                <div style={{marginTop: 20, fontSize: 13, color: C.sub, fontWeight: 600}}>
                   <Ico name="user" size={14} /> {t('cls_teacher_incharge')} <span style={{fontWeight: 800, color: C.accent}}>{myTeacherName}</span>
                </div>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 900, color: C.sub, display: "block", marginBottom: 12 }}>{t('cls_skills_label')}</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {SKILLS.map(sk => (
                    <button key={sk} onClick={() => setSelSkills(p => p.includes(sk) ? p.filter(x=>x!==sk) : [...p, sk])} style={{ padding: "8px 12px", fontSize: 12, background: selSkills.includes(sk) ? C.accent : C.bg, color: selSkills.includes(sk) ? "#fff" : C.text, border: `1px solid ${C.border}` }}>
                      {selSkills.includes(sk) ? "" : "+ "} {sk}
                    </button>
                  ))}
                </div>
                <div style={{marginTop:20, display:'flex', gap:10}}>
                  <button onClick={() => {resetTimer();}} style={{flex:1, background: C.accent, color: '#fff', border: `1px solid ${C.accent}`}}>Stopwatch</button>
                  <button onClick={() => setShowManualTime(!showManualTime)} style={{flex:1, background: showManualTime?C.warn:C.bg, color: showManualTime?'#fff':C.sub, border: `1px solid ${showManualTime?C.warn:C.border}`}}>{t('cls_manual_input')}</button>
                </div>
              </div>
            </div>

            {showManualTime && (
              <div className="card" style={{ background: `${C.warn}10`, border: `1px solid ${C.warn}50` }}>
                <h3 style={{marginTop: 0, color: C.warn, fontSize: 14}}>{t('cls_manual_title')}</h3>
                <div style={{ display: "grid", gridTemplateColumns: window.innerWidth > 600 ? "1fr 1fr auto" : "1fr", gap: 15, alignItems: "end" }}>
                   <div><label style={{fontSize: 10, fontWeight: 800}}>{t('cls_minutes')}</label><input type="number" placeholder="VD: 90" value={manualMin} onChange={(e: any)=>setManualMin(e.target.value)} style={{background: C.card}} /></div>
                   <div><label style={{fontSize: 10, fontWeight: 800}}>{t('cls_seconds')}</label><input type="number" placeholder="VD: 30" value={manualSec} onChange={(e: any)=>setManualSec(e.target.value)} style={{background: C.card}} /></div>
                   <button onClick={saveManualSession} style={{ background: C.warn, color: "#fff", padding: "12px 24px" }}>{t('cls_save_money')}</button>
                </div>
              </div>
            )}

            <div className="card" style={{ textAlign: "center", padding: "80px 20px" }}>
              <div className="timer-num" style={{ fontSize: window.innerWidth > 600 ? 150 : 80, fontWeight: 900, lineHeight: 1, marginBottom: 20 }}>
                {fmtTime(elapsed)}
              </div>
              <div style={{ marginBottom: 50, fontSize: 14, fontWeight: 900, color: C.sub, letterSpacing: 4 }}>
                {running ? <span style={{color: C.succ}}> {t('cls_live')}</span> : t('cls_ready')}
              </div>
              <div style={{ display: "flex", justifyContent: "center", gap: 16 }}>
                {!running ? (
                  <button onClick={() => toggleTimer(true)} style={{ padding: "20px 60px", background: C.accent, color: "#fff", fontSize: 18, boxShadow: `0 10px 20px ${C.accent}40` }}>{t('cls_start')}</button>
                ) : (
                  <>
                    <button onClick={() => toggleTimer(false)} style={{ padding: "18px 32px", background: C.warn, color: "#fff" }}>{t('cls_pause')}</button>
                    <button onClick={handleSaveSession} style={{ padding: "18px 32px", background: C.succ, color: "#fff" }}>{t('cls_save_result')}</button>
                  </>
                )}
                {!running && elapsed > 0 && (
                  <button onClick={resetTimer} style={{ background: "transparent", border: `1px solid ${C.border}`, color: C.text, padding: "0 20px" }}>RESET</button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ================= EXAM BUILDER (GOOGLE DRIVE STYLE & SPLIT EDITOR) ================= */}
        {activeTab === "EXAM_BUILDER" && (() => {

            // Xử lý logic Folder Tree
            const currentPath = builderFolder;
            const childFolders = new Set<string>();
            const childQuizzes: any[] = [];

            const quizzesToProcess = builderSearch ? quizzes.filter((q: any) => q.title.toLowerCase().includes(builderSearch.toLowerCase())) : quizzes;

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

            // Tiền xử lý gộp nhóm câu hỏi trong Builder
            const getBuilderGroups = () => {
                if (!editingQuiz || !editingQuiz.questions) return [];
                const qs = editingQuiz.questions;
                const builderGroups: any[] = [];
                for (let i = 0; i < qs.length; i++) {
                    const q = qs[i];
                    if (q.type === 'CHOICE_MULTIPLE' || q.type === 'BLANK' || q.type === 'DRAG_DROP' || q.type === 'SHORT_ANSWER' || q.type === 'DRAG_DROP_HEADING') {
                        let j = i + 1;
                        const sharedQs = [q];
                        // FIX "phân thân": chỉ gộp khi CÙNG groupContext + instruction (khớp logic đề thi),
                        // nếu không flow-chart sẽ nuốt notes/summary và edit lan sang cả nhóm.
                        while (j < qs.length && qs[j].type === q.type
                               && (qs[j].groupContext || "") === (q.groupContext || "")
                               && (qs[j].instruction || "") === (q.instruction || "")) {
                            if (q.type === 'CHOICE_MULTIPLE' && JSON.stringify(qs[j].options) !== JSON.stringify(q.options)) break;
                            sharedQs.push(qs[j]);
                            j++;
                        }
                        if (sharedQs.length > 1) {
                            builderGroups.push({ isMerged: true, questions: sharedQs, startIndex: i, groupType: q.type });
                            i = j - 1;
                            continue;
                        }
                    }
                    builderGroups.push({ isMerged: false, questions: [q], startIndex: i, groupType: q.type });
                }
                return builderGroups;
            };

            const builderGroups = getBuilderGroups();
            const getBuilderSectionCount = () => {
                if (!editingQuiz) return 0;
                const fromSections = editingQuiz.sections?.length || 0;
                const fromQuestions = Math.max(
                    0,
                    ...((editingQuiz.questions || [])
                        .map((q: any) => typeof q.passageIndex === 'number' ? q.passageIndex + 1 : 0))
                );
                const fromActiveTab = (editingQuiz._activePassageTab || 0) + 1;
                const defaultCount = editingQuiz.type === "Integrated"
                    ? 4
                    : (String(editingQuiz.type).toLowerCase().includes('listen') ? 4 : 3);
                return Math.max(fromSections, fromQuestions, fromActiveTab, defaultCount);
            };

            // CHỮA BỆNH STALE CLOSURE: Hàm LƯU BẤT TỬ
            const handleForceSave = () => {
                setEditingQuiz((currentLatestQuiz: any) => {
                    if (!currentLatestQuiz) return currentLatestQuiz;
                    setQuizzes((prevList: any[]) => {
                        const idx = prevList.findIndex(q => q.id === currentLatestQuiz.id);
                        const nx = [...prevList];
                        if (idx > -1) nx[idx] = currentLatestQuiz;
                        else nx.unshift(currentLatestQuiz);
                        // Cập nhật Firebase ngay lập tức
                        if (typeof syncData === 'function') setTimeout(() => syncData({quizzes: nx}), 50);
                        return nx;
                    });
                    alert("Đã lưu mọi nội dung, định dạng và cài đặt thành công!");
                    return currentLatestQuiz;
                });
            };

            // ===== MANUSCRIPT DESIGN TOKENS (đại tu giao diện sửa đề) =====
            // Một họ màu ẤM duy nhất (bỏ xám lạnh slate), bỏ shadow glow, radius thống nhất, 4 font đầy đủ.
            const EB = {
                paper: C.bg,                 // canvas giấy ấm
                sheet: '#FFFFFF',            // tờ soạn thảo
                wash: '#F4F1EA',             // dải nền ấm thay #f8f9fa/#f1f5f9
                washSoft: 'rgba(26,23,38,0.025)',
                line: C.border,              // hairline ấm
                lineSoft: 'rgba(26,23,38,0.07)',
                ink: C.text,
                sub: C.sub,
                accent: C.accent,
                warn: C.warn,
                err: C.err,
                accentWash: `${C.accent}0E`,
                radius: 14, radiusSm: 10,
                shadow: '0 1px 2px rgba(26,23,38,0.04), 0 16px 32px -18px rgba(26,23,38,0.16)',
                fDisplay: "var(--display), Georgia, 'Times New Roman', serif",
                fLabel: 'var(--heading), system-ui, sans-serif',
                fBody: 'var(--sans), system-ui, sans-serif',
                fMono: 'var(--mono), ui-monospace, Consolas, monospace',
            };
            const ebEyebrow: any = { fontFamily: EB.fLabel, fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: EB.sub, display: 'inline-flex', alignItems: 'center', gap: 7 };
            const ebScopedStyle = (
                <style>{`
                  .ebx-root { --ebx-wash:${EB.washSoft}; --ebx-accent:${EB.accent}; --ebx-line:${EB.line}; }
                  .ebx-root button { border-radius: ${EB.radiusSm}px; }
                  .ebx-soft { transition: background .18s ease, border-color .18s ease, color .18s ease, transform .12s ease; }
                  .ebx-soft:hover { background: var(--ebx-wash); }
                  .ebx-soft:active { transform: scale(0.97); }
                  .ebx-nav { border-left: 2px solid transparent; transition: background .16s ease, border-color .16s ease, transform .12s ease; }
                  .ebx-nav:hover { background: var(--ebx-wash); border-left-color: var(--ebx-accent); transform: translateX(2px); }
                  .ebx-opt { transition: background .16s ease, box-shadow .16s ease; }
                  .ebx-opt:hover { background: var(--ebx-wash); }
                  .ebx-icon { transition: background .16s ease, color .16s ease, transform .12s ease; }
                  .ebx-icon:hover { background: var(--ebx-wash); color: var(--ebx-accent); }
                  .ebx-icon:active { transform: scale(0.9); }
                  .ebx-primary { transition: filter .18s ease, transform .12s ease, box-shadow .18s ease; }
                  .ebx-primary:hover { filter: brightness(1.07); }
                  .ebx-primary:active { transform: translateY(1px); }
                  .ebx-block { position: relative; transition: background .2s ease; }
                  .ebx-tab { transition: color .18s ease, background .18s ease; }
                  .ebx-card { transition: border-color .2s ease, box-shadow .25s ease, transform .2s ease; }
                  .ebx-card:hover { border-color: var(--ebx-accent); box-shadow: ${EB.shadow}; transform: translateY(-2px); }
                  @keyframes ebxRise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
                  .ebx-block { animation: ebxRise .34s cubic-bezier(0.21,1.02,0.73,1) both; }
                `}</style>
            );

            return (
            <div className="card ebx-root" style={{position: 'relative', padding: 0, height: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', border: `1px solid ${EB.line}`, borderRadius: 18, background: EB.paper, boxShadow: EB.shadow}}>
                {ebScopedStyle}

                {/* HEAD BAR — hairline, không còn viền accent dày */}
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 26px', background: EB.sheet, zIndex: 90, borderBottom: `1px solid ${EB.line}`, flexShrink: 0}}>
                    <div style={{display: 'flex', alignItems: 'baseline', gap: 12}}>
                        <span style={{fontFamily: EB.fDisplay, fontSize: 21, fontWeight: 600, color: EB.ink, letterSpacing: '-0.01em'}}>{t('eb_title')}</span>
                        <span style={{...ebEyebrow, fontSize: 10, letterSpacing: '0.18em'}}>Workspace</span>
                    </div>

                    {!editingQuiz && !keyEditingQuiz && (
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                          <label className="ebx-soft" style={{ background: EB.sheet, color: EB.ink, padding: '9px 16px', borderRadius: EB.radiusSm, cursor: 'pointer', fontWeight: 600, fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 7, border: `1px solid ${EB.line}` }}>
                            <Ico name="download" size={14} /> {t('eb_upload_docx')}
                            {typeof handleFileUpload === 'function' && <input type="file" accept=".docx" onChange={handleFileUpload as any} style={{ display: 'none' }} />}
                          </label>
                          <button className="ebx-primary" onClick={() => setEditingQuiz({ id: getTrueTime().toString(), title: "Đề thi mới", type: "Reading", folder: builderFolder, timeLimit: 60, maxAttempts: 1, questions: [], active: false, audience: "ALL", targetStudentIds: [] })} style={{background: EB.accent, color: '#fff', padding: '9px 20px', fontSize: 13, borderRadius: EB.radiusSm, border: 'none', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7}}><Ico name="plus" size={14} />{t('eb_create_new')}</button>
                        </div>
                    )}
                </div>

                {/* WORKSPACE AREA */}
                {keyEditingQuiz ? (
                    <div key="key-editor" className="ebx-root" style={{background: EB.paper, padding: 0, flex: 1, overflowY: 'auto'}}>
                      <div style={{maxWidth: 820, margin: '0 auto', padding: '34px 32px 60px'}}>
                        <div style={{...ebEyebrow, marginBottom: 10}}><Ico name="key" size={13} />{t('eb_edit_key')}</div>
                        <h3 style={{margin: '0 0 8px', fontFamily: EB.fDisplay, fontWeight: 600, color: EB.ink, fontSize: 32, letterSpacing: '-0.02em'}}>{keyEditingQuiz!.title}</h3>
                        <div style={{height: 2, width: 56, background: EB.accent, borderRadius: 2, marginBottom: 28}} />
                        <div style={{display: 'grid', gap: 0, marginBottom: 30}}>
                          {(keyEditingQuiz!.questions || []).map((q: any, idx: number) => (
                                <div key={q.id} className="ebx-opt" style={{padding: '14px 4px', borderBottom: `1px solid ${EB.line}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20}}>
                                  <div style={{fontFamily: EB.fMono, fontWeight: 700, fontSize: 14, minWidth: 42, color: EB.accent}}>{idx + 1}</div>
                                    <div style={{flex: 1, fontSize: 14, maxHeight: 45, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: EB.ink}} dangerouslySetInnerHTML={{__html: sanitizeRichHtml(q.text || "")}} />
                                  <div style={{width: 300}}>
                                        {q.type === "CHOICE" ? (
                                            <select value={q.correctAnswer as any} onChange={(e) => {
                                                const nQ = [...keyEditingQuiz!.questions];
                                                nQ[idx] = { ...q, correctAnswer: Number(e.target.value) };
                                                setKeyEditingQuiz({ ...keyEditingQuiz!, questions: nQ });
                                            }} style={{width: '100%', padding: '9px 12px', borderRadius: 10, fontSize: 14, border: `1px solid ${EB.line}`, background: EB.sheet, fontWeight: 600, boxShadow: 'none'}}>
                                                {(q.options || []).map((opt: string, oIdx: number) => (
                                                    <option key={oIdx} value={oIdx}>Option {String.fromCharCode(65 + oIdx)}: {(opt || "").toString().replace(/<[^>]*>/g, '')}</option>
                                              ))}
                                            </select>
                                        ) : (
                                            <input type="text" value={String(q.correctAnswer)} onChange={(e) => {
                                                const nQ = [...keyEditingQuiz!.questions];
                                                nQ[idx] = { ...q, correctAnswer: e.target.value };
                                                setKeyEditingQuiz({ ...keyEditingQuiz!, questions: nQ });
                                            }} placeholder={t('eb_answer_ph')} style={{width: '100%', padding: '9px 12px', borderRadius: 10, fontSize: 14, border: `1px solid ${EB.line}`, background: EB.sheet, fontWeight: 600, color: C.succ, boxShadow: 'none', fontFamily: EB.fMono}} />
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                        <button className="ebx-primary" onClick={() => {
                            const nx = quizzes.map((x: any) => x.id === keyEditingQuiz!.id ? keyEditingQuiz! : x);
                            setQuizzes(nx); if (typeof syncData === 'function') syncData({ quizzes: nx }); setKeyEditingQuiz(null);
                            alert("Đã đồng bộ Key!");
                        }} style={{background: C.succ, color: '#fff', padding: '13px 24px', width: '100%', fontWeight: 700, border: 'none', borderRadius: EB.radiusSm, cursor: 'pointer', fontSize: 15, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8}}><Ico name="save" size={15} />{t('eb_save_key')}</button>
                      </div>
                    </div>

                ) : editingQuiz ? (

                    <div key="full-editor" style={{display: 'flex', flex: 1, overflow: 'hidden', background: C.bg, position: 'relative'}}>

                        {/* ============ PANEL TRÁI: QUESTION NAVIGATOR ============ */}
                        <aside className="no-print" style={{width: 268, flexShrink: 0, background: EB.sheet, borderRight: `1px solid ${EB.line}`, display: 'flex', flexDirection: 'column', overflow: 'hidden'}}>
                            <div style={{padding: '20px 20px 14px', borderBottom: `1px solid ${EB.line}`}}>
                                <div style={{...ebEyebrow, marginBottom: 9}}><Ico name="compass" size={13} />{t('eb_nav_title')}</div>
                                <div style={{fontFamily: EB.fDisplay, fontSize: 17, fontWeight: 600, color: EB.ink, lineHeight: 1.25, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{editingQuiz.title || t('eb_quiz_fallback')}</div>
                                <div style={{fontSize: 12, color: EB.sub, marginTop: 6, fontWeight: 500}}>{editingQuiz.type} <span style={{opacity: .5}}>·</span> <span style={{fontFamily: EB.fMono}}>{(editingQuiz.questions || []).length}</span> {t('eb_questions_unit')}</div>
                            </div>
                            <div style={{flex: 1, overflowY: 'auto', padding: '10px 8px'}}>
                                {builderGroups.length === 0 && <div style={{fontSize: 12, color: EB.sub, fontStyle: 'italic', padding: 16, textAlign: 'center'}}>{t('eb_no_questions')}</div>}
                                {builderGroups.map((grp: any) => {
                                    const qIndex = grp.startIndex;
                                    const firstQ = grp.questions[0];
                                    const lastQ = grp.questions[grp.questions.length - 1];
                                    const firstNo = getQuizQuestionNumber(editingQuiz.questions || [], firstQ?.id);
                                    const lastNo = getQuizQuestionNumber(editingQuiz.questions || [], lastQ?.id) + getQuestionPointCount(lastQ) - 1;
                                    const navTitle = lastNo > firstNo ? `${firstNo}–${lastNo}` : `${firstNo}`;
                                    const typeIcon = grp.groupType === 'BLANK' ? <Ico name="edit" size={14} /> : grp.groupType === 'MATCHING' ? <Ico name="link" size={14} /> : grp.groupType === 'DRAG_DROP' ? <Ico name="pointer" size={14} /> : grp.groupType === 'CHOICE_MULTIPLE' ? <Ico name="checkSquare" size={14} /> : <Ico name="radio" size={14} />;
                                    const typeLabel = grp.groupType === 'BLANK' ? t('eb_type_blank') : grp.groupType === 'MATCHING' ? t('eb_type_match') : grp.groupType === 'DRAG_DROP' ? t('eb_type_drag') : grp.groupType === 'CHOICE_MULTIPLE' ? t('eb_type_multi') : t('eb_type_choice');
                                    return (
                                    <div key={'nav-' + qIndex} className="ebx-nav" onClick={() => { const el = document.getElementById(`builder-q-${qIndex}`); if (el) { el.scrollIntoView({behavior: 'smooth', block: 'center'}); el.style.transition = 'box-shadow .3s'; el.style.boxShadow = `inset 3px 0 0 ${C.accent}`; setTimeout(() => { el.style.boxShadow = 'none'; }, 1400); } }} style={{display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px', borderRadius: EB.radiusSm, cursor: 'pointer', marginBottom: 2}}>
                                        <span style={{fontFamily: EB.fMono, fontSize: 13, fontWeight: 700, color: EB.sub, minWidth: 34}}>{navTitle}</span>
                                        <span style={{color: EB.accent, display: 'inline-flex', opacity: .85}}>{typeIcon}</span>
                                        <div style={{flex: 1, minWidth: 0}}>
                                            <div style={{fontSize: 12.5, fontWeight: 600, color: EB.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{typeLabel}</div>
                                        </div>
                                    </div>
                                )})}
                            </div>
                            <div style={{padding: 14, borderTop: `1px solid ${EB.line}`, display: 'grid', gap: 8}}>
                                <button className="ebx-soft" onClick={() => setEditingQuiz((prev: any) => prev ? {...prev, questions: [...(prev.questions || []), {id: getTrueTime().toString() + Math.random(), type: "CHOICE", text: "Câu hỏi mới", options: ["A", "B", "C", "D"], correctAnswer: 0}]} : prev)} style={{background: EB.sheet, color: EB.ink, padding: '10px', fontSize: 13, borderRadius: EB.radiusSm, fontWeight: 600, border: `1px solid ${EB.line}`, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7}}><Ico name="plus" size={14} />{t('eb_add_question')}</button>
                                <button className="ebx-soft" onClick={() => setEditingQuiz((prev: any) => prev ? {...prev, questions: [...(prev.questions || []), {id: getTrueTime().toString() + Math.random(), type: "BLANK", text: "", groupContext: "", correctAnswer: ""}]} : prev)} style={{background: EB.accentWash, color: EB.accent, padding: '10px', fontSize: 13, borderRadius: EB.radiusSm, fontWeight: 600, border: `1px solid ${C.accent}22`, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7}}><Ico name="edit" size={13} />{t('eb_add_blank_group')}</button>
                            </div>
                        </aside>

                        {/* ============ PANEL GIỮA: SOẠN THẢO KIỂU WORD ============ */}
                        <div style={{flex: 1, overflowY: 'auto', padding: '0', scrollBehavior: 'smooth', background: EB.paper}}>

                            {/* TOP BAR DÍNH — toolbar hairline, không viền dày */}
                            <div className="no-print" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, position: 'sticky', top: 0, background: `${EB.paper}F2`, backdropFilter: 'saturate(180%) blur(8px)', WebkitBackdropFilter: 'saturate(180%) blur(8px)', zIndex: 50, padding: '14px 32px', borderBottom: `1px solid ${EB.line}`}}>
                                <div style={{display: 'flex', gap: 10, alignItems: 'center'}}>
                                    <button className="ebx-soft" onClick={() => setEditingQuiz((prev: any) => prev ? {...prev, _showSettings: !prev._showSettings} : prev)} style={{background: editingQuiz._showSettings ? EB.accent : EB.sheet, color: editingQuiz._showSettings ? '#fff' : EB.ink, padding: '9px 16px', fontSize: 13, fontWeight: 600, borderRadius: EB.radiusSm, border: `1px solid ${editingQuiz._showSettings ? EB.accent : EB.line}`, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7}}><Ico name="gear" size={14} />{t('eb_settings')}</button>
                                </div>
                                <div style={{display: 'flex', gap: 10, flexShrink: 0}}>
                                    <button className="ebx-soft" onClick={() => setEditingQuiz(null)} style={{background: EB.sheet, color: EB.sub, padding: '9px 16px', fontSize: 13, fontWeight: 600, borderRadius: EB.radiusSm, border: `1px solid ${EB.line}`, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7}}><Ico name="x" size={14} />{t('eb_close')}</button>
                                    <button className="ebx-primary" onClick={handleForceSave} style={{background: EB.accent, color: '#fff', padding: '9px 22px', fontSize: 13, fontWeight: 700, borderRadius: EB.radiusSm, border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7}}><Ico name="save" size={14} />{t('eb_save')}</button>
                                </div>
                            </div>

                          {/* CỘT MANUSCRIPT — giới hạn bề ngang cho dễ đọc */}
                          <div style={{maxWidth: 880, margin: '0 auto', padding: '34px 32px 80px'}}>

                            {/* TIÊU ĐỀ ĐỀ THI — Fraunces serif, gõ thẳng trên giấy */}
                            <div style={{marginBottom: 30}}>
                                <div style={{...ebEyebrow, marginBottom: 10}}>{editingQuiz.type} <span style={{opacity: .4}}>·</span> {(editingQuiz.questions || []).length} {t('eb_questions_unit')}</div>
                                <input value={editingQuiz.title} onChange={(e)=>setEditingQuiz((prev: any)=>prev?{...prev, title:e.target.value}:prev)} placeholder={t('eb_title_ph')} style={{width: '100%', fontFamily: EB.fDisplay, fontSize: 38, fontWeight: 600, color: EB.ink, border: 'none', background: 'transparent', outline: 'none', padding: 0, letterSpacing: '-0.02em', lineHeight: 1.1, boxShadow: 'none'}} />
                                <div style={{height: 2, width: 56, background: EB.accent, borderRadius: 2, marginTop: 18}} />
                            </div>

                            {/* SOẠN THẢO BÀI ĐỌC / NGỮ CẢNH — phẳng trên giấy, phân cách bằng hairline */}
                            <div className="no-print ebx-block" style={{ marginBottom: 38 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
                                    <div style={ebEyebrow}><Ico name="book" size={13} />{t('eb_passage_title')}</div>
                                    <div style={{ display: 'flex', gap: 2, background: EB.wash, padding: 4, borderRadius: EB.radiusSm, overflowX: 'auto', maxWidth: '100%' }}>
                                        {(() => {
                                            const sectionCount = getBuilderSectionCount();
                                            return Array.from({ length: sectionCount }, (_: any, idx: number) => {
                                            const isActive = (editingQuiz._activePassageTab || 0) === idx;
                                            const label = editingQuiz.type === "Integrated"
                                                ? `Part ${idx + 1}`
                                                : (String(editingQuiz.type).toLowerCase().includes('listen') ? `Section ${idx + 1}` : `Passage ${idx + 1}`);
                                            return (
                                            <button key={idx} className="ebx-tab" onClick={() => setEditingQuiz((prev: any) => prev ? {...prev, _activePassageTab: idx} : prev)} style={{ padding: '6px 15px', fontSize: 12, borderRadius: 7, background: isActive ? EB.sheet : 'transparent', color: isActive ? EB.ink : EB.sub, boxShadow: isActive ? '0 1px 3px rgba(26,23,38,0.10)' : 'none', fontWeight: isActive ? 700 : 500, border: 'none', cursor: 'pointer' }}>{label}</button>
                                        )})})()}
                                    </div>
                                </div>
                                <div style={{ border: `1px solid ${EB.line}`, borderRadius: EB.radius, overflow: 'hidden', background: EB.sheet }}>
                                    <RichTextEditor
                                        value={
                                            editingQuiz.sections?.[editingQuiz._activePassageTab || 0]?.passage
                                            ?? ((editingQuiz._activePassageTab || 0) === 0 ? (editingQuiz.passage || "") : "")
                                        }
                                        onChange={(v: string) => setEditingQuiz((prev: any) => {
                                            if (!prev) return prev;
                                            const idx = prev._activePassageTab || 0;
                                            // FIX "sửa bài đọc không tác động": đề thi render sections[idx].passage,
                                            // nên LUÔN ghi vào sections[idx]; tab 0 mirror thêm vào passage (fallback đề cũ).
                                            const nextSecs = [...(prev.sections || [])];
                                            while(nextSecs.length <= idx) nextSecs.push({ passage: "", questions: [] });
                                            nextSecs[idx] = { ...nextSecs[idx], passage: v };
                                            const patch: any = { ...prev, sections: nextSecs };
                                            if (idx === 0) patch.passage = v;
                                            return patch;
                                        })}
                                        placeholder={t('eb_passage_ph', { n: (editingQuiz._activePassageTab || 0) + 1 })}
                                    />
                                </div>
                            </div>

                            <div style={{...ebEyebrow, marginBottom: 22, paddingBottom: 14, borderBottom: `1px solid ${EB.line}`, width: '100%', justifyContent: 'flex-start'}}><Ico name="clipboard" size={13} />{t('eb_question_list')} <span style={{fontFamily: EB.fMono, color: EB.accent, marginLeft: 2}}>({(editingQuiz.questions || []).length})</span></div>

                            <div style={{display: 'grid', gap: 0}}>
                                {builderGroups.map((grp: any) => {
                                    const q = grp.questions[0];
                                    const qIndex = grp.startIndex;
                                    const isMerged = grp.isMerged;
                                    const lastIdx = qIndex + grp.questions.length - 1;
                                    const firstQ = grp.questions[0];
                                    const lastQ = grp.questions[grp.questions.length - 1];
                                    const firstNo = getQuizQuestionNumber(editingQuiz.questions || [], firstQ?.id);
                                    const lastNo = getQuizQuestionNumber(editingQuiz.questions || [], lastQ?.id) + getQuestionPointCount(lastQ) - 1;
                                    const titleStr = lastNo > firstNo ? `${t('eb_q')} ${firstNo} - ${lastNo}` : `${t('eb_q')} ${firstNo}`;

                                    // CẬP NHẬT TRỰC TIẾP LÊN STATE GỐC ĐỂ TRÁNH MẤT DỮ LIỆU
                                    const updateGroup = (updater: (qItem: any, offset: number) => any) => {
                                        setEditingQuiz((prev: any) => {
                                            if (!prev) return prev;
                                            const nQ = [...(prev.questions || [])];
                                            grp.questions.forEach((_qItem: any, offset: number) => {
                                                const currentIdx = qIndex + offset;
                                                if(nQ[currentIdx]) nQ[currentIdx] = updater(nQ[currentIdx], offset);
                                            });
                                            return { ...prev, questions: nQ };
                                        });
                                    };

                                    const iconBtn: any = {background: 'transparent', color: EB.sub, border: `1px solid ${EB.line}`, width: 34, height: 34, borderRadius: EB.radiusSm, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center'};
                                    const selBox: any = {padding: '8px 12px', fontSize: 13, borderRadius: EB.radiusSm, fontWeight: 600, border: `1px solid ${EB.line}`, background: EB.sheet, color: EB.ink, outline: 'none', boxShadow: 'none', width: 'auto'};
                                    return (
                                    <div id={`builder-q-${qIndex}`} key={q.id} className="ebx-block" style={{position: 'relative', padding: '30px 0 30px 26px', borderTop: qIndex === 0 ? 'none' : `1px solid ${EB.line}`}}>
                                        {/* THANH ACCENT DỌC thay cho card */}
                                        <div style={{position: 'absolute', left: 0, top: 34, bottom: 34, width: 3, background: EB.accent, borderRadius: 3, opacity: .85}} />

                                        {/* HEADER CỦA NHÓM CÂU HỎI */}
                                        <div className="no-print" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22, flexWrap: 'wrap', gap: 14}}>
                                            <div style={{display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap'}}>
                                                <div style={{fontFamily: EB.fLabel, fontWeight: 700, fontSize: 13, color: EB.accent, letterSpacing: '0.04em', textTransform: 'uppercase'}}>{titleStr}</div>
                                                <select className="ebx-soft" value={q.type} onChange={(e: any) => {
                                                    updateGroup((qItem: any) => ({ ...qItem, type: e.target.value as any, correctAnswer: e.target.value === "CHOICE" ? 0 : "" }));
                                                }} style={selBox}>
                                                    <option value="CHOICE">{t('eb_opt_choice')}</option>
                                                    <option value="CHOICE_MULTIPLE">{t('eb_opt_multi')}</option>
                                                    <option value="MATCHING">{t('eb_opt_match')}</option>
                                                    <option value="BLANK">{t('eb_opt_blank')}</option>
                                                    <option value="DRAG_DROP">{t('eb_opt_drag')}</option>
                                                    <option value="DRAG_DROP_HEADING">Matching Headings (kéo thả)</option>
                                                    <option value="SHORT_ANSWER">Short answer / Sentence completion</option>
                                                </select>
                                                <select className="ebx-soft" value={q.subType || ""} onChange={(e: any) => {
                                                    updateGroup((qItem: any) => ({ ...qItem, subType: e.target.value }));
                                                }} style={{...selBox, color: EB.sub}}>
                                                    <option value="">{t('eb_subtype_none')}</option>
                                                    <option value="True/False/Not Given">True / False / Not Given</option>
                                                    <option value="Matching Headings">Matching Headings</option>
                                                    <option value="Multiple Choice">Multiple Choice</option>
                                                    <option value="Sentence Completion">Sentence Completion</option>
                                                </select>
                                            </div>
                                            <div style={{display: 'flex', gap: 7}}>
                                                <button className="ebx-icon" onClick={() => {
                                                    if (qIndex > 0) {
                                                        setEditingQuiz((prev: any) => {
                                                            if (!prev) return prev;
                                                            const nQ = [...(prev.questions || [])];
                                                            const groupToMove = nQ.splice(qIndex, grp.questions.length);
                                                            nQ.splice(qIndex - 1, 0, ...groupToMove);
                                                            return { ...prev, questions: nQ };
                                                        });
                                                    }
                                                }} style={iconBtn} title={t('eb_move_up')}><Ico name="chevronUp" size={16} /></button>

                                                <button className="ebx-icon" onClick={() => {
                                                    setEditingQuiz((prev: any) => {
                                                        if (!prev) return prev;
                                                        if (lastIdx < (prev.questions?.length || 0) - 1) {
                                                            const nQ = [...(prev.questions || [])];
                                                            const groupToMove = nQ.splice(qIndex, grp.questions.length);
                                                            nQ.splice(qIndex + 1, 0, ...groupToMove);
                                                            return { ...prev, questions: nQ };
                                                        }
                                                        return prev;
                                                    });
                                                }} style={iconBtn} title={t('eb_move_down')}><Ico name="chevronDown" size={16} /></button>

                                                <button className="ebx-soft" onClick={() => {
                                                    setEditingQuiz((prev: any) => {
                                                        if (!prev) return prev;
                                                        const nQ = [...(prev.questions || [])];
                                                        const dups = grp.questions.map((item: any) => ({ ...item, id: getTrueTime().toString() + Math.random() }));
                                                        nQ.splice(lastIdx + 1, 0, ...dups);
                                                        return { ...prev, questions: nQ };
                                                    });
                                                }} style={{...iconBtn, width: 'auto', padding: '0 13px', gap: 6, fontSize: 13, fontWeight: 600}}><Ico name="copy" size={14} />{t('eb_duplicate')}</button>

                                                <button className="ebx-soft" onClick={() => {
                                                    if (confirm("Chắc chắn xóa câu hỏi này?")) {
                                                        setEditingQuiz((prev: any) => {
                                                            if (!prev) return prev;
                                                            const nQ = (prev.questions || []).filter((_: any, i: number) => i < qIndex || i > lastIdx);
                                                            return { ...prev, questions: nQ };
                                                        });
                                                    }
                                                }} style={{...iconBtn, width: 'auto', padding: '0 13px', gap: 6, fontSize: 13, fontWeight: 600, color: EB.err, borderColor: `${C.err}33`}}><Ico name="trash" size={14} />{t('eb_delete')}</button>
                                            </div>
                                        </div>

                                        {/* ĐỀ BÀI / HƯỚNG DẪN (INSTRUCTIONS) - dùng chung cho cả nhóm */}
                                        <div style={{marginBottom: 22}}>
                                            <label style={{...ebEyebrow, marginBottom: 10, display: 'flex'}}><Ico name="pin" size={13} />{t('eb_instructions_label')}</label>
                                            <RichTextEditor value={q.instruction || ""} onChange={(v: string) => {
                                                // FIX "lặp bảng hướng dẫn": đề thi gộp nhóm câu theo instruction giống nhau.
                                                // Sửa hướng dẫn phải lan sang MỌI câu đang dùng chung hướng dẫn cũ, nếu không nhóm bị tách -> hiện 2 bảng.
                                                const oldIns = q.instruction || "";
                                                setEditingQuiz((prev: any) => {
                                                    if (!prev) return prev;
                                                    const groupIds = new Set(grp.questions.map((gi: any) => gi.id));
                                                    const nQ = (prev.questions || []).map((qx: any) =>
                                                        (groupIds.has(qx.id) || (oldIns && (qx.instruction || "") === oldIns))
                                                            ? { ...qx, instruction: v }
                                                            : qx
                                                    );
                                                    return { ...prev, questions: nQ };
                                                });
                                            }} placeholder={t('eb_instructions_ph')} />
                                        </div>

                                        {/* NỘI DUNG CHÍNH DỰA THEO TYPE */}
                                        {grp.groupType === 'DRAG_DROP_HEADING' ? (() => {
                                            const ROMAN = ['i','ii','iii','iv','v','vi','vii','viii','ix','x','xi','xii','xiii','xiv','xv','xvi','xvii','xviii','xix','xx'];
                                            const srcQ = grp.questions.find((x:any) => x.options && x.options.length) || grp.questions[0];
                                            const heads = ((srcQ as any).options || []).map((o:string) => String(o).replace(/^\s*[ivxlcdm]+[.)]\s*/i, ''));
                                            const writeHeads = (arr:string[]) => { const opts = arr.map((txt,i)=>`${ROMAN[i]}. ${txt}`); updateGroup((qItem:any)=>({...qItem, options: opts})); };
                                            return (
                                            <div>
                                                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12, flexWrap:'wrap', gap:10}}>
                                                    <label style={{...ebEyebrow, display:'flex'}}><Ico name="link" size={13} />List of Headings</label>
                                                    <button className="ebx-soft" onClick={()=>writeHeads([...heads, ''])} style={{background:EB.accentWash, color:EB.accent, border:`1px solid ${C.accent}22`, padding:'7px 13px', borderRadius:EB.radiusSm, fontWeight:600, cursor:'pointer', fontSize:13, display:'flex', alignItems:'center', gap:6}}><Ico name="plus" size={13} />Thêm heading</button>
                                                </div>
                                                <div style={{display:'flex', flexDirection:'column', gap:8, marginBottom:24}}>
                                                    {heads.map((txt:string, hi:number) => (
                                                        <div key={hi} style={{display:'flex', alignItems:'center', gap:10, background:EB.sheet, border:`1px solid ${EB.line}`, borderRadius:EB.radiusSm, padding:'8px 12px'}}>
                                                            <span style={{fontFamily:EB.fMono, fontWeight:700, color:EB.accent, fontSize:13, minWidth:30, fontStyle:'italic'}}>{ROMAN[hi]}.</span>
                                                            <input value={txt} onChange={(e:any)=>{ const nx=[...heads]; nx[hi]=e.target.value; writeHeads(nx); }} placeholder="Nội dung heading" style={{flex:1, padding:'8px 10px', fontSize:14, border:'none', background:EB.wash, borderRadius:8, fontWeight:500, outline:'none', color:EB.ink, boxShadow:'none'}} />
                                                            <button className="ebx-icon" onClick={()=>writeHeads(heads.filter((_:any,i:number)=>i!==hi))} style={{background:'transparent', color:EB.err, border:`1px solid ${C.err}33`, width:30, height:30, borderRadius:8, cursor:'pointer', flexShrink:0}}><Ico name="trash" size={13} /></button>
                                                        </div>
                                                    ))}
                                                    {heads.length===0 && <div style={{fontSize:13, color:EB.sub, fontStyle:'italic', padding:'4px 2px'}}>Chưa có heading. Bấm "Thêm heading".</div>}
                                                </div>
                                                <div style={{background:EB.wash, padding:'18px 20px', borderRadius:EB.radius}}>
                                                    <div style={{...ebEyebrow, marginBottom:6, display:'flex'}}><Ico name="key" size={13} />Đáp án (đoạn → heading)</div>
                                                    <div style={{fontSize:12, color:EB.sub, marginBottom:14}}>Mỗi đoạn (A, B, C…) là 1 câu theo thứ tự. Chọn heading đúng.</div>
                                                    <div style={{display:'grid', gap:10}}>
                                                        {grp.questions.map((qItem:any, offset:number) => {
                                                            const letter = String.fromCharCode(65+offset);
                                                            const cur = ((qItem.correctAnswer ?? '') as any).toString().toLowerCase();
                                                            return (
                                                            <div key={qItem.id} style={{display:'flex', alignItems:'center', gap:12}}>
                                                                <div style={{width:30, height:30, borderRadius:'50%', background:EB.accentWash, color:EB.accent, display:'grid', placeItems:'center', fontWeight:700, fontSize:13, flexShrink:0}}>{letter}</div>
                                                                <select value={cur} onChange={(e:any)=>updateGroup((qIt:any,o:number)=>o===offset?{...qIt, correctAnswer:e.target.value}:qIt)} style={{flex:1, padding:'9px 12px', fontSize:14, border:`1px solid ${EB.line}`, background:EB.sheet, borderRadius:10, fontWeight:600, color:EB.ink, boxShadow:'none'}}>
                                                                    <option value="">— chọn heading —</option>
                                                                    {heads.map((txt:string, hi:number) => <option key={hi} value={ROMAN[hi]}>{ROMAN[hi]}. {txt}</option>)}
                                                                </select>
                                                            </div>
                                                        )})}
                                                    </div>
                                                </div>
                                            </div>
                                            );
                                        })() : (grp.groupType === 'BLANK' || grp.groupType === 'DRAG_DROP' || grp.groupType === 'SHORT_ANSWER') ? (
                                            <div>
                                                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10}}>
                                                    <label style={{...ebEyebrow, display: 'flex'}}><Ico name="edit" size={13} />{t('eb_inline_para')}</label>
                                                    <div style={{display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap'}}>
                                                        <div style={{fontSize: 12, color: EB.sub, background: EB.wash, padding: '7px 12px', borderRadius: EB.radiusSm}}>{t('eb_blank_hint_a')} <b style={{color: EB.accent, fontFamily: EB.fMono}}>[{qIndex + 1}]</b> {t('eb_blank_hint_b')}</div>
                                                        <button className="ebx-soft" onClick={() => {
                                                            let counter = qIndex + 1;
                                                            const newCtx = (q.groupContext || "").replace(/\[\d+\]/g, () => `[${counter++}]`);
                                                            updateGroup((qItem: any) => ({ ...qItem, groupContext: newCtx }));
                                                        }} style={{background: 'transparent', color: EB.warn, border: `1px solid ${C.warn}33`, padding: '7px 13px', borderRadius: EB.radiusSm, fontWeight: 600, cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6}} title={t('eb_renumber_title')}>
                                                            {t('eb_renumber')}
                                                        </button>
                                                        <button className="ebx-soft" onClick={() => {
                                                            let missingNum = qIndex + 1;
                                                            for (let i = 0; i < grp.questions.length; i++) {
                                                                if (!(q.groupContext || "").includes(`[${qIndex + 1 + i}]`)) {
                                                                    missingNum = qIndex + 1 + i; break;
                                                                }
                                                            }
                                                            updateGroup((qItem: any) => ({ ...qItem, groupContext: (qItem.groupContext || "") + ` [${missingNum}] ` }));
                                                        }} style={{background: EB.accentWash, color: EB.accent, border: `1px solid ${C.accent}22`, padding: '7px 13px', borderRadius: EB.radiusSm, fontWeight: 600, cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6}}>
                                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
                                                            {t('eb_insert_blank')}
                                                        </button>
                                                    </div>
                                                </div>

                                                {/* THE WORD-LIKE EDITOR BLOCK */}
                                                <div style={{border: `1px solid ${EB.line}`, borderRadius: EB.radius, overflow: 'hidden', marginBottom: 22, background: EB.sheet}}>
                                                    <RichTextEditor value={q.groupContext || ""} onChange={(v: string) => { updateGroup((qItem: any) => ({ ...qItem, groupContext: v })); }} placeholder={t('eb_para_ph')} />
                                                </div>

                                                {(() => {
                                                  const showText = grp.groupType === 'SHORT_ANSWER' || grp.questions.some((x:any)=>(x.text||'').trim());
                                                  return (
                                                <div style={{background: EB.wash, padding: '18px 20px', borderRadius: EB.radius}}>
                                                    <div style={{...ebEyebrow, marginBottom: 14, display: 'flex'}}><Ico name="key" size={13} />{t('eb_blank_answers')}</div>
                                                    <div style={{ display: 'grid', gridTemplateColumns: showText ? '1fr' : 'repeat(auto-fill, minmax(220px, 1fr))', gap: showText ? 10 : 12 }}>
                                                        {grp.questions.map((qItem: any, offset: number) => {
                                                            const qNum = qIndex + 1 + offset;
                                                            const isMissing = !showText && !(q.groupContext || "").includes(`[${qNum}]`);
                                                            return (
                                                            <div key={qItem.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: EB.sheet, padding: '8px 12px', borderRadius: EB.radiusSm, border: `1px solid ${isMissing ? C.err : EB.line}` }}>
                                                                <div style={{ fontFamily: EB.fMono, fontWeight: 700, color: isMissing ? C.err : EB.accent, fontSize: 13, minWidth: 30, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                                    {qNum} {isMissing && <span title={t('eb_blank_missing_title')} style={{cursor: 'help', display: 'inline-flex', verticalAlign: 'middle'}}><Ico name="alert" size={13} color={C.warn} /></span>}
                                                                </div>
                                                                {showText && <input value={qItem.text || ''} onChange={(e:any)=>updateGroup((qIt:any,o:number)=>o===offset?{...qIt, text:e.target.value}:qIt)} placeholder="Nội dung câu (vd: Plastic was first made in ___)" style={{ flex: 2, padding: '8px 10px', fontSize: 14, border: `1px solid ${EB.line}`, background: EB.sheet, borderRadius: 8, fontWeight: 500, outline: 'none', color: EB.ink, boxShadow: 'none' }} />}
                                                                <input value={qItem.correctAnswer as string} onChange={(e: any) => updateGroup((qIt: any, o: number) => o === offset ? { ...qIt, correctAnswer: e.target.value } : qIt)} placeholder={t('eb_blank_answer_ph')} style={{ flex: 1, padding: '8px 10px', fontSize: 14, border: 'none', background: EB.wash, borderRadius: 8, fontWeight: 600, outline: 'none', color: EB.ink, boxShadow: 'none' }} />
                                                            </div>
                                                        )})}
                                                    </div>
                                                </div>
                                                  );
                                                })()}
                                            </div>
                                        ) : (
                                            <div>
                                                <div style={{marginBottom: 22}}>
                                                    <label style={{...ebEyebrow, marginBottom: 10, display: 'flex'}}><Ico name="edit" size={13} />{t('eb_question_content')}</label>
                                                    <div style={{border: `1px solid ${EB.line}`, borderRadius: EB.radius, overflow: 'hidden', background: EB.sheet}}>
                                                        <RichTextEditor value={q.text || ""} onChange={(v: string) => { updateGroup((qItem: any, offset: number) => offset === 0 ? { ...qItem, text: v } : qItem); }} />
                                                    </div>
                                                </div>

                                                <div style={{background: EB.wash, padding: '18px 20px', borderRadius: EB.radius}}>
                                                    <label style={{...ebEyebrow, marginBottom: 14, display: 'flex'}}><Ico name="key" size={13} />{t('eb_answer_label')} {isMerged ? <span style={{textTransform: 'none', letterSpacing: 0, fontFamily: EB.fBody, color: EB.sub}}>({t('eb_select_n')} {grp.questions.length})</span> : ""}</label>
                                                    {q.type === "CHOICE" || q.type === "CHOICE_MULTIPLE" || q.type === "MATCHING" ? (
                                                        <div style={{display: 'flex', flexDirection: 'column', gap: 0}}>
                                                            {(q.options || []).map((opt: string, optIndex: number) => {
                                                                const isChecked = isMerged
                                                                    ? grp.questions.some((qItem: any) => Array.isArray(qItem.correctAnswer) ? qItem.correctAnswer.includes(optIndex) : qItem.correctAnswer === optIndex)
                                                                    : (q.type === "CHOICE" || q.type === "MATCHING" ? q.correctAnswer === optIndex : (Array.isArray(q.correctAnswer) && q.correctAnswer.includes(optIndex)));

                                                                return (
                                                                <div key={optIndex} className="ebx-opt" style={{display: 'flex', alignItems: 'center', gap: 14, background: isChecked ? `${C.succ}12` : 'transparent', padding: '10px 14px', borderRadius: EB.radiusSm, borderLeft: `2px solid ${isChecked ? C.succ : 'transparent'}`, marginBottom: 2}}>
                                                                    <input className="no-print" type={q.type === "CHOICE" || q.type === "MATCHING" ? "radio" : "checkbox"} name={`correct_${q.id}`}
                                                                        checked={isChecked}
                                                                        onChange={(e: any) => {
                                                                            if (isMerged) {
                                                                                let curArr: number[] = [];
                                                                                const firstAns = grp.questions[0].correctAnswer;
                                                                                if (Array.isArray(firstAns)) curArr = [...firstAns];
                                                                                if (e.target.checked) curArr.push(optIndex); else curArr = curArr.filter(x => x !== optIndex);
                                                                                updateGroup((qItem: any) => ({ ...qItem, correctAnswer: curArr }));
                                                                            } else {
                                                                                if (q.type === "CHOICE" || q.type === "MATCHING") updateGroup((qItem: any) => ({ ...qItem, correctAnswer: optIndex }));
                                                                                else {
                                                                                    let curArr = Array.isArray(q.correctAnswer) ? [...(q.correctAnswer as number[])] : [];
                                                                                    if (e.target.checked) curArr.push(optIndex); else curArr = curArr.filter(x => x !== optIndex);
                                                                                    updateGroup((qItem: any) => ({ ...qItem, correctAnswer: curArr }));
                                                                                }
                                                                            }
                                                                        }} style={{width: 19, height: 19, margin: 0, accentColor: C.succ, cursor: 'pointer'}} title={t('eb_pick_correct')} />
                                                                    <div style={{fontFamily: EB.fMono, fontWeight: 700, fontSize: 14, width: 24, textAlign: 'center', color: isChecked ? C.succ : EB.sub}}>{String.fromCharCode(65 + optIndex)}</div>
                                                                    <input value={opt} onChange={(e: any) => {
                                                                        updateGroup((qItem: any) => {
                                                                            const newOpts = [...(qItem.options || [])];
                                                                            newOpts[optIndex] = e.target.value;
                                                                            return { ...qItem, options: newOpts };
                                                                        });
                                                                    }} style={{flex: 1, padding: '9px 12px', fontSize: 14, border: `1px solid ${isChecked ? 'transparent' : EB.line}`, background: EB.sheet, outline: 'none', borderRadius: 8, fontWeight: 500, color: EB.ink, boxShadow: 'none'}} placeholder={t('eb_option_ph', { letter: String.fromCharCode(65 + optIndex) })} />
                                                                </div>
                                                                )})}
                                                        </div>
                                                    ) : null}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )})}
                            </div>
                          </div>
                        </div>

                        {/* ============ PANEL PHẢI: DRAWER CÀI ĐẶT NÂNG CAO ============ */}
                        {editingQuiz._showSettings && (
                          <>
                            <div className="no-print" onClick={() => setEditingQuiz((prev: any) => prev ? {...prev, _showSettings: false} : prev)} style={{position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.25)', zIndex: 80}} />
                            <aside className="no-print" style={{position: 'absolute', top: 0, right: 0, bottom: 0, width: 390, maxWidth: '90%', background: EB.sheet, borderLeft: `1px solid ${EB.line}`, zIndex: 81, overflowY: 'auto', boxShadow: '-16px 0 40px -16px rgba(26,23,38,0.22)'}}>
                                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 22px', borderBottom: `1px solid ${EB.line}`, position: 'sticky', top: 0, background: EB.sheet, zIndex: 5}}>
                                    <div style={{fontFamily: EB.fDisplay, fontSize: 19, fontWeight: 600, color: EB.ink, display: 'inline-flex', alignItems: 'center', gap: 9}}><span style={{color: EB.accent, display: 'inline-flex'}}><Ico name="gear" size={16} /></span>{t('eb_adv_settings')}</div>
                                    <button className="ebx-icon" onClick={() => setEditingQuiz((prev: any) => prev ? {...prev, _showSettings: false} : prev)} style={{background: 'transparent', color: EB.sub, border: `1px solid ${EB.line}`, width: 34, height: 34, borderRadius: EB.radiusSm, cursor: 'pointer'}}><Ico name="x" size={15} /></button>
                                </div>

                                <div style={{padding: 20, display: 'grid', gap: 22}}>

                                    {/* THÔNG TIN CƠ BẢN */}
                                    <div>
                                        <div style={{...ebEyebrow, marginBottom: 14, display: 'flex'}}><Ico name="file" size={13} />{t('eb_basic_info')}</div>
                                        <div style={{display: 'grid', gap: 12}}>
                                            <div><label style={{fontSize: 11, fontWeight: 800, color: C.sub, display: 'block', marginBottom: 6}}>{t('eb_folder')}</label><input className="idp-input" value={editingQuiz.folder || "Root"} onChange={(e)=>setEditingQuiz((prev: any)=>prev?{...prev, folder:e.target.value}:prev)} style={{width: '100%', padding: '10px 14px', borderRadius: 10, background: EB.wash, border: `1px solid ${EB.line}`, boxShadow: 'none'}}/></div>
                                            <div><label style={{fontSize: 11, fontWeight: 800, color: C.sub, display: 'block', marginBottom: 6}}>{t('eb_exam_type')}</label>
                                                <select className="idp-input" value={editingQuiz.type} onChange={(e)=>setEditingQuiz((prev: any)=>prev?{...prev, type:e.target.value as any}:prev)} style={{width: '100%', padding: '10px 14px', borderRadius: 10, background: EB.wash, border: `1px solid ${EB.line}`, boxShadow: 'none'}}>
                                                    <option value="Reading">Reading</option><option value="Listening">Listening</option><option value="Integrated">Integrated</option>
                                                </select>
                                            </div>
                                            <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12}}>
                                                <div><label style={{fontSize: 11, fontWeight: 800, color: C.sub, display: 'block', marginBottom: 6}}>{t('eb_time_minutes')}</label><input type="number" className="idp-input" value={editingQuiz.timeLimit} onChange={(e)=>setEditingQuiz((prev: any)=>prev?{...prev, timeLimit:Number(e.target.value)}:prev)} style={{width: '100%', padding: '10px 14px', borderRadius: 10, background: EB.wash, border: `1px solid ${EB.line}`, boxShadow: 'none'}}/></div>
                                                <div><label style={{fontSize: 11, fontWeight: 800, color: C.sub, display: 'block', marginBottom: 6}}>{t('eb_max_attempts')}</label><input type="number" className="idp-input" value={editingQuiz.maxAttempts || 1} onChange={(e)=>setEditingQuiz((prev: any)=>prev?{...prev, maxAttempts:Number(e.target.value)}:prev)} style={{width: '100%', padding: '10px 14px', borderRadius: 10, background: EB.wash, border: `1px solid ${EB.line}`, boxShadow: 'none'}}/></div>
                                            </div>
                                            {(editingQuiz.type === "Listening" || editingQuiz.type === "Integrated") && (
                                                <div>
                                                    <label style={{fontSize: 11, fontWeight: 800, color: C.sub, display: 'block', marginBottom: 6}}>{t('eb_audio_link')}</label>
                                                    <input className="idp-input" value={editingQuiz.audioUrl || ""} onChange={(e)=>setEditingQuiz((prev: any)=>prev?{...prev, audioUrl:e.target.value}:prev)} style={{width: '100%', padding: '10px 14px', borderRadius: 10, background: EB.wash, border: `1px solid ${EB.line}`, boxShadow: 'none'}} placeholder={t('eb_audio_ph')}/>
                                                    <div style={{display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap'}}>
                                                        <label className="ebx-soft" style={{background: EB.sheet, color: EB.ink, fontSize: 12, fontWeight: 700, padding: '9px 14px', borderRadius: EB.radiusSm, border: `1px solid ${EB.line}`, cursor: audioUploadProgress !== null ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, opacity: audioUploadProgress !== null ? 0.72 : 1}}>
                                                            <Ico name="cloud" size={14} /> {audioUploadProgress !== null ? `${t('eb_audio_uploading')} ${audioUploadProgress}%` : t('eb_upload_audio')}
                                                            <input type="file" accept="audio/*,.mp3,.m4a,.wav,.ogg,.aac" disabled={audioUploadProgress !== null} onChange={(e: any) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void handleAudioFileUpload(f); }} style={{display: 'none'}} />
                                                        </label>
                                                        {audioUploadProgress !== null && <button className="ebx-soft" onClick={() => { setAudioUploadProgress(null); setAudioUploadMsg(""); }} style={{background: EB.sheet, color: C.sub, fontSize: 12, fontWeight: 700, padding: '9px 12px', borderRadius: EB.radiusSm, border: `1px solid ${EB.line}`, cursor: 'pointer'}}>Reset upload</button>}
                                                        <button className="ebx-primary" onClick={handleTranscribe} disabled={transcribeLoading || !editingQuiz.audioUrl} style={{background: transcribeLoading ? C.sub : C.accent, color: '#fff', fontSize: 12, fontWeight: 600, padding: '9px 14px', borderRadius: EB.radiusSm, opacity: (transcribeLoading || !editingQuiz.audioUrl) ? 0.7 : 1, display: 'inline-flex', alignItems: 'center', gap: 6}}>{transcribeLoading ? <span style={{display:'inline-flex',alignItems:'center',gap:6}}><Ico name="refresh" size={14} /> {transcribeMsg || t('eb_transcribing')}</span> : <span style={{display:'inline-flex',alignItems:'center',gap:6}}><Ico name="headphones" size={14} /> {t('eb_transcribe')}</span>}</button>
                                                        {audioUploadMsg ? <span style={{fontSize: 11, fontWeight: 700, color: audioUploadMsg === t('eb_audio_upload_failed') ? C.err : C.succ}}>{audioUploadMsg}</span> : (editingQuiz.transcript ? <span style={{fontSize: 11, fontWeight: 700, color: C.succ}}>{t('eb_transcript_ready')} ({editingQuiz.transcript.length})</span> : <span style={{fontSize: 11, color: C.sub}}>{t('eb_audio_hosted_hint')}</span>)}
                                                    </div>
                                                    {/* CHẾ ĐỘ AUDIO: thi thật (1 lần) | luyện tập (tua) */}
                                                    <div style={{display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap'}}>
                                                        <span style={{fontSize: 11, fontWeight: 800, color: C.sub}}>{t('eb_audio_mode')}</span>
                                                        {[{k: 'strict', l: t('eb_audio_strict')}, {k: 'practice', l: t('eb_audio_practice')}].map(o => {
                                                            const on = (editingQuiz.audioMode || 'strict') === o.k;
                                                            return <button key={o.k} onClick={() => setEditingQuiz((prev: any) => prev ? {...prev, audioMode: o.k} : prev)} style={{fontSize: 12, fontWeight: 700, padding: '7px 13px', borderRadius: EB.radiusSm, cursor: 'pointer', border: `1px solid ${on ? C.accent : EB.line}`, background: on ? C.accent : EB.wash, color: on ? '#fff' : C.sub}}>{o.l}</button>;
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* BẢO MẬT & LỊCH */}
                                    <div>
                                        <div style={{...ebEyebrow, marginBottom: 14, display: 'flex'}}><Ico name="lock" size={13} />{t('eb_security_sched')}</div>
                                        <div style={{display: 'grid', gap: 12}}>
                                            <div><label style={{fontSize: 11, fontWeight: 800, color: C.sub, display: 'block', marginBottom: 6}}>{t('eb_pin')}</label><input className="idp-input" placeholder={t('eb_pin_ph')} value={editingQuiz.passcode || ""} onChange={(e)=>setEditingQuiz((prev: any)=>prev?{...prev, passcode:e.target.value}:prev)} style={{width: '100%', padding: '10px 14px', borderRadius: 10, background: EB.wash, border: `1px solid ${EB.line}`, boxShadow: 'none'}}/></div>
                                            <div><label style={{fontSize: 11, fontWeight: 800, color: C.sub, display: 'block', marginBottom: 6}}>{t('eb_open_at')}</label><input type="datetime-local" className="idp-input" value={editingQuiz.scheduledStart || ""} onChange={(e)=>setEditingQuiz((prev: any)=>prev?{...prev, scheduledStart:e.target.value}:prev)} style={{width: '100%', padding: '10px 14px', borderRadius: 10, background: EB.wash, border: `1px solid ${EB.line}`, boxShadow: 'none'}}/></div>
                                            <div><label style={{fontSize: 11, fontWeight: 800, color: C.sub, display: 'block', marginBottom: 6}}>{t('eb_close_at')}</label><input type="datetime-local" className="idp-input" value={editingQuiz.scheduledEnd || ""} onChange={(e)=>setEditingQuiz((prev: any)=>prev?{...prev, scheduledEnd:e.target.value}:prev)} style={{width: '100%', padding: '10px 14px', borderRadius: 10, background: EB.wash, border: `1px solid ${EB.line}`, boxShadow: 'none'}}/></div>
                                            <label style={{fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', background: `${C.warn}10`, padding: '12px 15px', borderRadius: 8, color: C.warn, border: `1px solid ${C.warn}40`}}>
                                                <input type="checkbox" checked={editingQuiz.isSEBRequired || false} onChange={(e) => setEditingQuiz((prev: any) => prev ? {...prev, isSEBRequired: e.target.checked} : prev)} style={{width: 18, height: 18, margin: 0, cursor: 'pointer'}} />
                                                {t('eb_require_seb')}
                                            </label>
                                            <div style={{display: 'flex', alignItems: 'center', gap: 10, background: editingQuiz.active ? `${C.succ}12` : EB.wash, padding: '12px 15px', borderRadius: 10, border: `1px solid ${editingQuiz.active ? C.succ : EB.line}`}}>
                                                <input type="checkbox" checked={editingQuiz.active || false} onChange={(e)=>setEditingQuiz((prev: any) => prev ? {...prev, active: e.target.checked} : prev)} style={{width: 20, height: 20, cursor: 'pointer'}}/>
                                                <label style={{fontSize: 13, fontWeight: 800, color: editingQuiz.active ? C.succ : C.sub}}>{editingQuiz.active ? t('eb_active_on') : t('eb_active_off')}</label>
                                            </div>
                                        </div>
                                    </div>

                                    {/* PHÂN PHỐI */}
                                    <div>
                                        <div style={{...ebEyebrow, marginBottom: 14, display: 'flex'}}><Ico name="users" size={13} />{t('eb_distribution')}</div>
                                        <select className="idp-input" value={editingQuiz.audience || "ALL"} onChange={(e: any) => setEditingQuiz((prev: any) => prev ? {...prev, audience: e.target.value as any} : prev)} style={{width: '100%', padding: '10px 14px', borderRadius: 10, background: EB.wash, border: `1px solid ${EB.line}`, boxShadow: 'none'}}>
                                            <option value="ALL">{t('drv_aud_all')}</option>
                                            <option value="SPECIFIC">{t('eb_specific')}</option>
                                        </select>
                                        {editingQuiz.audience === "SPECIFIC" && (
                                            <div style={{marginTop: 12, padding: 15, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, maxHeight: 200, overflowY: 'auto'}}>
                                                <div style={{fontSize: 11, fontWeight: 800, color: C.accent, marginBottom: 8}}>{t('eb_pick_students')}</div>
                                                {students.map((s: any) => (
                                                    <label key={s.id} style={{display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 6, cursor: 'pointer'}}>
                                                        <input type="checkbox" checked={(editingQuiz.targetStudentIds || []).includes(s.id)} onChange={(e) => {
                                                            setEditingQuiz((prev: any) => {
                                                                if (!prev) return prev;
                                                                const currentTargets = [...(prev.targetStudentIds || [])];
                                                                if (e.target.checked) currentTargets.push(s.id);
                                                                else {
                                                                    const idx = currentTargets.indexOf(s.id);
                                                                    if (idx > -1) currentTargets.splice(idx, 1);
                                                                }
                                                                return {...prev, targetStudentIds: currentTargets};
                                                            });
                                                        }} style={{width: 16, height: 16, margin: 0, cursor: 'pointer'}} />
                                                        <span style={{fontWeight: 700}}>{s.name}</span> <span style={{color: C.sub}}>({s.email})</span>
                                                    </label>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                </div>
                            </aside>
                          </>
                        )}
                    </div>
                ) : (

                    // 3. GIAO DIỆN QUẢN LÝ ĐỀ THI GOOGLE DRIVE STYLE (Hoàn chỉnh tính năng)
                    <div key="drive-list" style={{display: 'flex', flexDirection: 'column', flex: 1, background: EB.paper, minHeight: 0}}>
                        <div style={{padding: '14px 30px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${EB.line}`, flexWrap: 'wrap', gap: 15, background: EB.sheet}}>
                            <div style={{display: 'flex', alignItems: 'center', gap: 9, fontSize: 16, fontWeight: 600}}>
                                <button className="ebx-soft" onClick={() => { setBuilderFolder("Root"); setBuilderSearch(""); }} style={{background: 'transparent', padding: '4px 8px', color: EB.accent, fontSize: 15, fontWeight: 600, border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 8}}><Ico name="folder" size={15} color={EB.accent} /> Root</button>
                                {builderFolder !== "Root" && !builderSearch && builderFolder.split("/").filter(x=>x!=="Root").map((part, idx, arr) => (
                                    <React.Fragment key={idx}>
                                        <span style={{color: EB.sub, opacity: .6}}>/</span>
                                        <button className="ebx-soft" onClick={() => setBuilderFolder("Root/" + arr.slice(0, idx+1).join("/"))} style={{background: 'transparent', padding: '4px 8px', color: idx === arr.length-1 ? EB.ink : EB.accent, fontSize: 15, fontWeight: 600, border: 'none', cursor: 'pointer', borderRadius: 8}}>{part}</button>
                                    </React.Fragment>
                                ))}
                                {builderSearch && <><span style={{color: EB.sub, opacity: .6}}>/</span> <span style={{color: EB.ink}}>{t('eb_search_results')}</span></>}

                                <button className="ebx-soft" onClick={() => {
                                    const fName = prompt("Nhập tên thư mục mới:");
                                    if(fName && fName.trim()) {
                                        const newFolderPath = builderFolder === "Root" ? `Root/${fName.trim()}` : `${builderFolder}/${fName.trim()}`;
                                        const dummyQuiz = { id: getTrueTime().toString(), title: "Bản nháp (Xóa nếu không dùng)", type: "Reading", folder: newFolderPath, timeLimit: 60, maxAttempts: 1, questions: [], active: false, audience: "ALL", targetStudentIds: [] };
                                        const nx = [dummyQuiz, ...quizzes];
                                        setQuizzes(nx as any); if(typeof syncData === 'function') syncData({quizzes: nx});
                                    }
                                }} style={{background: 'transparent', color: EB.sub, padding: '6px 12px', fontSize: 13, borderRadius: EB.radiusSm, marginLeft: 8, border: `1px solid ${EB.line}`, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6}}><Ico name="plus" size={13} /> {t('eb_new_folder')}</button>
                            </div>
                            <div>
                                <input placeholder={t('eb_search_quiz_ph')} value={builderSearch} onChange={e => setBuilderSearch(e.target.value)} style={{width: 300, padding: '9px 18px', borderRadius: 30, border: `1px solid ${EB.line}`, background: EB.wash, outline: 'none', fontSize: 14, boxShadow: 'none'}} />
                            </div>
                        </div>

                        <div style={{flex: 1, overflowY: 'auto', padding: '30px 30px 60px', maxWidth: 1100, width: '100%', margin: '0 auto'}}>
                            {/* KHU VỰC THƯ MỤC */}
                            {builderSearch === "" && childFolders.size > 0 && (
                                <div style={{marginBottom: 40}}>
                                    <div style={{...ebEyebrow, marginBottom: 15}}><Ico name="folder" size={13} />{t('eb_folders_area')} <span style={{fontFamily: EB.fMono}}>({childFolders.size})</span></div>
                                    <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12}}>
                                        {Array.from(childFolders).map(f => (
                                            <div key={f} className="ebx-card" onClick={() => setBuilderFolder(builderFolder + "/" + f)} style={{background: EB.sheet, padding: '16px 18px', borderRadius: EB.radius, border: `1px solid ${EB.line}`, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14, fontWeight: 600}}>
                                                <span style={{display: 'inline-flex'}}><Ico name="folder" size={22} color={EB.accent} /></span> <span style={{fontSize: 15, color: EB.ink, fontWeight: 600}}>{f}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* KHU VỰC ĐỀ THI */}
                            <div>
                                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10}}>
                                    <div style={ebEyebrow}><Ico name="file" size={13} />{t('eb_quiz_list')} <span style={{fontFamily: EB.fMono}}>({childQuizzes.length})</span></div>
                                    {selectedQuizzes.length > 0 && (
                                        <div style={{display: 'flex', gap: 8, flexWrap: 'wrap'}}>
                                            <button onClick={() => {
                                                const dest = prompt("Nhập đường dẫn thư mục đích (VD: Root/IELTS/Test 1):", "Root");
                                                if(dest) {
                                                    const nx = quizzes.map((q: any) => selectedQuizzes.includes(q.id) ? { ...q, folder: dest } : q);
                                                    setQuizzes(nx); if(typeof syncData === 'function') syncData({quizzes: nx}); setSelectedQuizzes([]);
                                                }
                                            }} style={{background: C.accent, color: '#fff', padding: '8px 16px', fontSize: 13, borderRadius: 8, border: 'none', fontWeight: 800, cursor: 'pointer'}}><Ico name="folder" size={14} style={{verticalAlign:'-2px',margin:'0 6px 0 0',display:'inline-block'}} />{t('eb_move_folder')}</button>
                                            <button onClick={() => typeof handleBulkLock === 'function' && handleBulkLock(true)} style={{background: C.warn, color: '#fff', padding: '8px 16px', fontSize: 13, borderRadius: 8, border: 'none', fontWeight: 800, cursor: 'pointer'}}><Ico name="lock" size={14} style={{verticalAlign:'-2px',margin:'0 6px 0 0',display:'inline-block'}} />{t('eb_lock_quiz')}</button>
                                            <button onClick={() => typeof handleBulkLock === 'function' && handleBulkLock(false)} style={{background: C.succ, color: '#fff', padding: '8px 16px', fontSize: 13, borderRadius: 8, border: 'none', fontWeight: 800, cursor: 'pointer'}}><Ico name="unlock" size={14} style={{verticalAlign:'-2px',margin:'0 6px 0 0',display:'inline-block'}} />{t('eb_unlock_quiz')}</button>
                                            <button onClick={() => typeof handleBulkDeleteQuizzes === 'function' && handleBulkDeleteQuizzes()} style={{background: C.err, color: '#fff', padding: '8px 16px', fontSize: 13, borderRadius: 8, border: 'none', fontWeight: 800, cursor: 'pointer'}}><Ico name="trash" size={14} style={{verticalAlign:'-2px',margin:'0 6px 0 0',display:'inline-block'}} />{t('eb_delete')}</button>
                                        </div>
                                    )}
                                </div>

                                <div style={{display: 'grid', gap: 10}}>
                                    {childQuizzes.map((q: any) => {
                                        const isSelected = selectedQuizzes.includes(q.id);
                                        const ghostBtn: any = {background: 'transparent', color: EB.sub, padding: '7px 13px', fontSize: 13, border: `1px solid ${EB.line}`, borderRadius: EB.radiusSm, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6};
                                        return (
                                        <div key={q.id} className="ebx-card" style={{background: isSelected ? `${C.warn}0E` : EB.sheet, padding: '16px 20px', borderRadius: EB.radius, border: `1px solid ${isSelected ? C.warn : EB.line}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 18}}>
                                            <div style={{display: 'flex', gap: 16, alignItems: 'center'}}>
                                                <input type="checkbox" checked={isSelected} onChange={(e: any) => {
                                                    if(e.target.checked) setSelectedQuizzes([...selectedQuizzes, q.id]);
                                                    else setSelectedQuizzes(selectedQuizzes.filter((id: any) => id !== q.id));
                                                }} style={{width: 18, height: 18, cursor: 'pointer', accentColor: C.accent}} />
                                                <div style={{width: 44, height: 44, borderRadius: EB.radiusSm, background: EB.accentWash, display: 'grid', placeItems: 'center', color: EB.accent, flexShrink: 0}}>{q.type === 'Listening' ? <Ico name="headphones" size={22} /> : <Ico name="book" size={22} />}</div>
                                                <div>
                                                    <div style={{fontFamily: EB.fDisplay, fontWeight: 600, fontSize: 18, color: EB.ink, marginBottom: 5, letterSpacing: '-0.01em'}}>
                                                        {q.title} {q.isLocked && <span title={t('eb_locked_title')} style={{fontSize: 14, display: 'inline-flex', verticalAlign: 'middle'}}><Ico name="lock" size={13} color={EB.sub} /></span>}
                                                    </div>
                                                    <div style={{fontSize: 12.5, color: EB.sub, fontWeight: 500}}>
                                                        {q.type} <span style={{opacity:.5}}>·</span> <span style={{fontFamily: EB.fMono}}>{q.timeLimit}</span> {t('eb_minutes')} <span style={{opacity:.5}}>·</span> <span style={{fontFamily: EB.fMono}}>{(q.questions || []).length}</span> {t('eb_questions_short')} <span style={{opacity:.5}}>·</span> {q.isLocked ? <span style={{textDecoration: 'line-through'}}>{t('eb_st_locked')}</span> : (q.active ? <span style={{color: C.succ, fontWeight: 600}}>{t('eb_st_open')}</span> : t('eb_st_off'))}
                                                    </div>
                                                </div>
                                            </div>
                                            <div style={{display: 'flex', gap: 7, flexWrap: 'wrap'}}>
                                                {typeof startExam === 'function' && <button className="ebx-soft" onClick={() => startExam(q, true, false)} style={ghostBtn}><Ico name="eye" size={14} />{t('eb_preview_exam')}</button>}
                                                {typeof handleExportExamKey === 'function' && <button className="ebx-soft" onClick={() => handleExportExamKey(q)} style={ghostBtn}><Ico name="download" size={14} />{t('eb_download_key')}</button>}
                                                {typeof handleRecalculateScores === 'function' && <button className="ebx-soft" onClick={() => handleRecalculateScores(q.id)} style={ghostBtn}><Ico name="refresh" size={14} />{t('eb_recalc')}</button>}
                                                <button className="ebx-soft" onClick={() => setKeyEditingQuiz(q)} style={{...ghostBtn, color: EB.warn, borderColor: `${C.warn}33`}}><Ico name="key" size={14} />{t('eb_edit_key_btn')}</button>
                                                {typeof duplicateQuiz === 'function' && <button className="ebx-soft" onClick={() => duplicateQuiz(q)} style={{...ghostBtn, color: C.succ, borderColor: `${C.succ}33`}}><Ico name="copy" size={14} />{t('eb_duplicate')}</button>}
                                                <button className="ebx-primary" onClick={() => setEditingQuiz(JSON.parse(JSON.stringify(q)))} style={{background: EB.accent, color: '#fff', padding: '7px 20px', fontSize: 13, border: 'none', borderRadius: EB.radiusSm, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6}}><Ico name="edit" size={14} />{t('eb_edit_exam')}</button>
                                            </div>
                                        </div>
                                    )})}
                                    {childQuizzes.length === 0 && <div style={{textAlign: 'center', color: EB.sub, padding: 50, fontStyle: 'italic', fontSize: 15}}>{t('eb_folder_empty')}</div>}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
            )
        })()}
        {activeTab === "LIVE_ARENA" && (
          <div style={{ display: "grid", gap: 24 }}>
            <div className="card" style={{ background: `linear-gradient(135deg, #EFF6FF, #FFFFFF)`, border: `1px solid #BFDBFE`, padding: 40 }}>
               <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30, flexWrap: 'wrap', gap: 15}}>
                   <h2 style={{marginTop: 0, margin: 0, display: 'flex', alignItems: 'center', gap: 12, color: '#1E3A8A', fontSize: 24, fontWeight: 900, letterSpacing: -0.5}}>
                       <span style={{fontSize: 24, animation: 'pulseFast 1.5s infinite'}}><Ico name="dot" size={18} /></span> LIVE EXAM ARENA
                   </h2>
                   <div style={{fontSize: 14, fontWeight: 800, color: '#1E40AF', background: '#DBEAFE', padding: '10px 20px', borderRadius: 100, border: '1px solid #93C5FD'}}>
                       {(Array.isArray(liveSessions) ? liveSessions : []).filter(s => getRealTime() - (s?.lastUpdate || 0) < 30000).length} {t('live_count_suffix')}
                   </div>
               </div>
               
               <div style={{display: 'grid', gap: 15}}>
                   {liveSessions.filter(s => getRealTime() - s.lastUpdate < 30000).sort((a,b) => b.progressPct - a.progressPct).map(session => (
                       <div key={session.id} style={{background: '#FFFFFF', padding: 24, borderRadius: 20, border: `1px solid #E2E8F0`, boxShadow: '0 4px 15px rgba(0,0,0,0.03)', position: 'relative', overflow: 'hidden'}}>
                           {/* Hiệu ứng nhấp nháy đỏ báo hiệu gian lận */}
                           {session.isCheating && <div style={{position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(239,68,68,0.05)', border: '2px solid rgba(239,68,68,0.5)', animation: 'pulseFast 1s infinite', pointerEvents: 'none'}} />}
                           
                           <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: 15, position: 'relative', zIndex: 2}}>
                               <div>
                                   <div style={{fontWeight: 900, fontSize: 18, color: '#0F172A'}}>{session.studentName}</div>
                                   <div style={{fontSize: 13, color: '#64748B', marginTop: 5}}> {t('live_exam_label')} {session.quizTitle}</div>
                               </div>
                               <div style={{textAlign: 'right'}}>
                                   <div style={{fontSize: 28, fontWeight: 900, color: session.progressPct >= 100 ? C.succ : C.accent}}>{session.progressPct}%</div>
                                   <div style={{fontSize: 12, color: '#64748B', marginTop: 5}}>{t('live_done', { a: session.answeredCount, b: session.totalQ })}</div>
                               </div>
                           </div>
                           
                           {/* Thanh tiến trình (Progress Bar) */}
                           <div style={{height: 12, background: '#F1F5F9', borderRadius: 10, overflow: 'hidden', marginBottom: 10, position: 'relative', zIndex: 2}}>
                               <div style={{width: `${session.progressPct}%`, height: '100%', background: session.progressPct >= 100 ? C.succ : C.accent, transition: 'width 1s ease-in-out'}} />
                           </div>
                           
                           {/* Cảnh báo gian lận */}
                           {session.isCheating && (
                               <div style={{fontSize: 12, color: C.err, fontWeight: 900, display: 'flex', alignItems: 'center', gap: 5, marginTop: 10}}>
                                   {t('live_cheat')}
                               </div>
                           )}
                           
                           <div style={{marginTop: 15, paddingTop: 15, borderTop: `1px dashed ${C.border}`}}>
                               <button onClick={() => {
                                   const msg = prompt(`Nhập thông báo gửi đến thí sinh ${session.studentName} (VD: Đính chính câu 5, cộng 5 phút...):`);
                                   if (msg) {
                                       const targetStudent = students.find(s => s.id === session.studentId);
                                       if (targetStudent) {
                                           const currentPending = targetStudent.pendingNotifications || [];
                                           const newNotif = { id: Date.now().toString(), title: "Message from Invigilator", body: msg };
                                           const nx = students.map(s => s.id === session.studentId ? { ...s, pendingNotifications: [...currentPending, newNotif] } : s);
                                           setStudents(nx);
                                           syncData({ students: nx });
                                           alert("Đã gửi tin nhắn thành công!");
                                       }
                                   }
                               }} style={{background: '#EFF6FF', color: '#1E3A8A', border: '1px solid #BFDBFE', padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 800, width: '100%', display: 'flex', justifyContent: 'center', gap: 8}}>
                                   {t('live_send_msg')}
                               </button>
                           </div>
                       </div>
                   ))}
                   
                   {liveSessions.filter(s => getRealTime() - s.lastUpdate < 30000).length === 0 && (
                       <div style={{textAlign: 'center', padding: 50, color: '#666', fontStyle: 'italic', background: 'rgba(255,255,255,0.02)', borderRadius: 10}}>
                           <div style={{fontSize: 40, marginBottom: 15}}><Ico name="moon" size={36} /></div>
                           {t('live_empty')}
                       </div>
                   )}
               </div>
            </div>
          </div>
        )}

        {/* ================= ACADEMICS ================= */}
        {/* Tab ACADEMICS đã được gộp vào hub "Học viên" (STUDENTS) — Tổng quan + hồ sơ từng HV. */}
        {activeTab === "STUDENTS" && (() => {
          const isWide = window.innerWidth > 900;
          const profile = profileId ? (students.find(s => s && s.id === profileId) || null) : null;
          const unpaidOf = (sid: string) => history.filter(h => h && h.studentId === sid && !h.isPaid).reduce((sum, h) => sum + (Number(h.earnings) || 0), 0);

          const listStudents = [...students]
            .filter(s => s && (safeString(s.name).toLowerCase().includes(safeString(searchSt).toLowerCase()) || safeString(s.email).toLowerCase().includes(safeString(searchSt).toLowerCase())))
            .filter(s => !filterUnpaid || unpaidOf(s!.id) > 0)
            .sort((a, b) => {
              if (!a || !b) return 0;
              if (a.isPinned && !b.isPinned) return -1;
              if (!a.isPinned && b.isPinned) return 1;
              if (sortStudentBy === "EXP") return (Number(b.exp) || 0) - (Number(a.exp) || 0);
              if (sortStudentBy === "DEBT") return unpaidOf(b.id) - unpaidOf(a.id);
              return safeString(a.name).localeCompare(safeString(b.name));
            });

          let pResults: QuizResult[] = [], pSessions: Session[] = [], pHours = 0, pUnpaid = 0, pAvg = "—";
          let pTrend: any = null, pTypes: { label: string; rate: number; total: number }[] = [];
          if (profile) {
            pResults = quizResults.filter(r => r && r.studentId === profile.id).sort((a, b) => safeString(b.date).localeCompare(safeString(a.date)));
            pSessions = history.filter(h => h && h.studentId === profile.id);
            pHours = pSessions.reduce((s, h) => s + ((h && h.duration) || 0), 0) / 3600;
            pUnpaid = unpaidOf(profile.id);
            const valid = pResults.filter(r => !isNaN(Number(r.band)));
            pAvg = valid.length ? (valid.reduce((a, c) => a + Number(c.band), 0) / valid.length).toFixed(1) : "—";
            pTrend = pResults.length >= 2 ? (Number(pResults[0].band) >= Number(pResults[1].band) ? <Ico name="trending" size={14} color={C.succ} /> : <Ico name="trendingDown" size={14} color={C.err} />) : null;
            pTypes = errorAnalytics.studentTypes[profile.id] || [];
          }

          const allHours = history.reduce((s, h) => s + ((h && h.duration) || 0), 0) / 3600;
          const allUnpaidTotal = history.filter(h => h && !h.isPaid).reduce((s, h) => s + (Number(h.earnings) || 0), 0);
          const debtorCount = students.filter(s => s && unpaidOf(s.id) > 0).length;
          const bandDist: Record<string, number> = {};
          quizResults.forEach(r => { if (r && r.band && r.band !== "N/A") bandDist[r.band] = (bandDist[r.band] || 0) + 1; });

          const secHead = (text: string) => <div style={{ fontSize: 10.5, fontWeight: 600, color: C.sub, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 10 }}>{text}</div>;

          const TabBtn = (key: string, label: string, icon: string, count?: number) => (
            <button onClick={() => setProfileTab(key as any)} style={{ flex: 1, padding: '11px 4px', fontSize: 12.5, fontWeight: profileTab === key ? 600 : 500, color: profileTab === key ? C.accent : C.sub, background: 'transparent', borderRadius: 0, borderBottom: `2px solid ${profileTab === key ? C.accent : 'transparent'}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}><Ico name={icon} size={14} /> {label}{count ? <span style={{ fontSize: 10.5, color: C.sub, fontWeight: 500 }}>· {count}</span> : null}</button>
          );

          const statTile = (label: string, value: any, color?: string) => (
            <div style={{ background: C.bg, borderRadius: 14, padding: '16px 18px' }}>
              <div style={{ fontSize: 10.5, fontWeight: 600, color: C.sub, letterSpacing: 0.4, textTransform: 'uppercase' }}>{label}</div>
              <div style={{ fontFamily: 'var(--display)', fontSize: 28, fontWeight: 500, color: color || C.text, marginTop: 6, lineHeight: 1 }}>{value}</div>
            </div>
          );

          const resultCard = (r: QuizResult) => {
            const durationStr = r.durationSeconds ? `${Math.floor(r.durationSeconds / 60)}m ${r.durationSeconds % 60}s` : "N/A";
            const copyText = `Kết quả thi IELTS CBT\nHọc viên: ${r.studentName}\nĐề: ${r.quizTitle}\nĐiểm: ${r.score}/${r.total} (Band ${r.band})\nThời gian làm: ${durationStr}`;
            const open = expandedResultId === r.id;
            return (
              <div key={r.id} style={{ background: C.bg, borderRadius: 14, borderLeft: `3px solid ${C.accent}`, overflow: 'hidden' }}>
                {/* HÀNG GỌN — bấm để bung feedback/chi tiết (hết cuộn dài) */}
                <button onClick={() => setExpandedResultId(open ? null : r.id)} style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 'none', cursor: 'pointer', padding: '12px 15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.quizTitle}</div>
                    <div style={{ fontSize: 11, color: C.sub, marginTop: 3, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span>{r.date || r.startTime || "N/A"}</span>
                      <span><Ico name="clock" size={11} style={{ verticalAlign: -1, marginRight: 3 }} />{durationStr}</span>
                      {r.cheatCount > 0
                        ? <span style={{ color: C.err, fontWeight: 600 }}><Ico name="alert" size={11} style={{ verticalAlign: -1, marginRight: 2 }} />{r.cheatCount}</span>
                        : <span style={{ color: C.succ, fontWeight: 600 }}><Ico name="check" size={11} style={{ verticalAlign: -1 }} /></span>}
                      {r.teacherFeedback ? <span style={{ color: C.accent, fontWeight: 600 }}><Ico name="sparkles" size={11} style={{ verticalAlign: -1, marginRight: 2 }} />fb</span> : null}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontFamily: 'var(--display)', fontSize: 20, fontWeight: 500, color: C.accent, lineHeight: 1 }}>{r.score}/{r.total}</div>
                      <div style={{ fontSize: 10.5, fontWeight: 600, color: C.sub, marginTop: 2 }}>{t('band_label')} {r.band}</div>
                    </div>
                    <Ico name={open ? 'chevronUp' : 'chevronDown'} size={16} color={C.sub} />
                  </div>
                </button>
                {open && (<div style={{ padding: '0 15px 15px' }}>
                <div style={{ fontSize: 11.5, color: C.sub, display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginBottom: 12 }}>
                  <span>{r.startTime || "N/A"}</span>
                  <span>IP {r.ipAddress || "N/A"}</span>
                  {r.cheatCount > 0
                    ? <span style={{ color: C.err, fontWeight: 600 }}>{t('acad_cheat_warn', { n: r.cheatCount })}</span>
                    : <span style={{ color: C.succ, fontWeight: 600 }}><Ico name="check" size={12} style={{ verticalAlign: -2, marginRight: 3 }} />{t('acad_no_cheat')}</span>}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input type="text" placeholder={t('acad_feedback_ph')} defaultValue={r.teacherFeedback || ""}
                    onBlur={(e: any) => { if (e.target.value !== r.teacherFeedback) { const nx = quizResults.map(x => x.id === r.id ? { ...x, teacherFeedback: e.target.value } : x); setQuizResults(nx); syncData({ quizResults: nx }); } }}
                    style={{ background: C.card, fontSize: 13, padding: '8px 10px' }} />
                  <button onClick={() => handleAiFeedback(r)} disabled={aiLoadingId === r.id} title={t('ai_tip')} style={{ background: aiLoadingId === r.id ? C.sub : 'linear-gradient(135deg,#8b5cf6,#6366f1)', color: '#fff', padding: '0 12px', whiteSpace: 'nowrap', fontWeight: 600, opacity: aiLoadingId === r.id ? 0.7 : 1 }}>{aiLoadingId === r.id ? <Ico name="refresh" size={14} /> : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Ico name="sparkles" size={14} /> AI</span>}</button>
                  <button onClick={() => handleVoiceFeedback(r.id)} title={t('tip_voice_input')} style={{ background: '#FFE066', color: '#000', padding: '0 11px' }}><Ico name="mic" size={15} /></button>
                </div>
                <div style={{ display: 'flex', gap: 5, marginTop: 8, flexWrap: 'wrap' }}>
                  {[t('acad_fb1'), t('acad_fb2'), t('acad_fb3'), t('acad_fb4')].map(ft => (
                    <button key={ft} onClick={() => { const nx = quizResults.map(x => x.id === r.id ? { ...x, teacherFeedback: (x.teacherFeedback ? x.teacherFeedback + " " : "") + ft } : x); setQuizResults(nx); syncData({ quizResults: nx }); }} style={{ fontSize: 10.5, padding: '4px 8px', background: C.card, border: `1px solid ${C.border}`, color: C.sub, borderRadius: 6 }}>{ft}</button>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12, paddingTop: 12, borderTop: `1px dashed ${C.border}`, flexWrap: 'wrap' }}>
                  <button onClick={() => copyToClipboard(copyText)} style={{ background: `${C.accent}12`, color: C.accent, fontSize: 11, padding: '6px 11px' }}><Ico name="clipboard" size={13} style={{ verticalAlign: -2, marginRight: 5 }} />{t('acad_copy_zalo')}</button>
                  <button onClick={() => exportDetailedQuizResult(r)} style={{ background: `${C.succ}12`, color: C.succ, fontSize: 11, padding: '6px 11px' }}><Ico name="barChart" size={13} style={{ verticalAlign: -2, marginRight: 5 }} />{t('acad_export_detail')}</button>
                  <button onClick={() => { if (r.ipAddress && confirm(`Cấm IP ${r.ipAddress}?`)) { const nx = [...bannedIps, r.ipAddress]; setBannedIps(nx); syncData({ bannedIps: nx }); } }} style={{ background: 'transparent', color: C.err, border: `1px solid ${C.border}`, fontSize: 11, padding: '6px 11px' }}><Ico name="ban" size={13} style={{ verticalAlign: -2, marginRight: 5 }} />{t('acad_ban_ip')}</button>
                  <button onClick={() => { if (confirm("Xóa bài thi này?")) { const nx = quizResults.filter(x => x.id !== r.id); setQuizResults(nx); syncData({ quizResults: nx }); } }} style={{ background: 'transparent', color: C.err, border: `1px solid ${C.border}`, fontSize: 11, padding: '6px 11px', marginLeft: 'auto' }}><Ico name="trash" size={13} /></button>
                </div>
                </div>)}
              </div>
            );
          };

          const sessionCard = (h: Session) => {
            const open = expandedSessionId === h.id;
            const notePreview = (h.notes || "").replace(/\s+/g, " ").trim();
            return (
            <div key={h.id} style={{ background: C.bg, borderRadius: 14, borderLeft: `3px solid ${h.isPaid ? C.succ : C.warn}`, overflow: 'hidden' }}>
              {/* HÀNG GỌN — bấm để bung ghi chú + thao tác */}
              <button onClick={() => setExpandedSessionId(open ? null : h.id)} style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 'none', cursor: 'pointer', padding: '12px 15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{h.date} <span style={{ color: C.sub, fontWeight: 400 }}>· {h.teacher}</span></div>
                  <div style={{ fontSize: 11, color: C.sub, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 240 }}>{notePreview || t('hist_notes_ph')}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                  <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 9px', borderRadius: 12, background: h.isPaid ? `${C.succ}15` : `${C.warn}15`, color: h.isPaid ? C.succ : C.warn }}>{fmtMoney(h.earnings)}</span>
                  <Ico name={open ? 'chevronUp' : 'chevronDown'} size={16} color={C.sub} />
                </div>
              </button>
              {open && (<div style={{ padding: '0 15px 15px' }}>
              <textarea value={h.notes || ""} onChange={(e: any) => { const nx = history.map(x => x && x.id === h.id ? { ...x, notes: e.target.value } : x); setHistory(nx as Session[]); }} onBlur={() => syncData({ history })} placeholder={t('hist_notes_ph')} style={{ height: 60, fontSize: 13, background: C.card, border: `1px solid ${C.border}` }} />
              <div style={{ display: 'flex', gap: 5, marginTop: 8, flexWrap: 'wrap' }}>
                {QUICK_NOTES.map((qn: string) => (
                  <button key={qn} onClick={() => { const nx = history.map(x => x && x.id === h.id ? { ...x, notes: (x.notes ? x.notes + ". " : "") + qn } : x); setHistory(nx as Session[]); syncData({ history: nx }); }} style={{ fontSize: 10, padding: '4px 8px', background: C.card, border: `1px solid ${C.border}`, color: C.sub }}>{qn}</button>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, marginTop: 12 }}>
                {!h.isPaid ? (
                  <button onClick={() => {
                    const nxHistory = history.map(x => x && x.id === h.id ? { ...x, isPaid: true } : x);
                    const rem = nxHistory.filter(se => se.studentId === h.studentId && !se.isPaid).reduce((sum, se) => sum + (se.earnings || 0), 0);
                    let nxStudents = students;
                    if (rem <= 0) { nxStudents = students.map(s => s.id === h.studentId ? { ...s, debtMessage: undefined } : s); setStudents(nxStudents); }
                    setHistory(nxHistory as Session[]); syncData({ history: nxHistory, students: nxStudents });
                  }} style={{ background: `${C.warn}18`, color: C.warn, fontSize: 12, padding: '6px 12px', border: `1px solid ${C.warn}55` }}>{t('hist_collect_fast')}<Ico name="coins" size={13} style={{ verticalAlign: -2, marginLeft: 6 }} /></button>
                ) : (
                  <button onClick={() => { const nx = history.map(x => x && x.id === h.id ? { ...x, isPaid: false } : x); setHistory(nx as Session[]); syncData({ history: nx }); }} style={{ background: `${C.succ}18`, color: C.succ, fontSize: 12, padding: '6px 12px', border: `1px solid ${C.succ}55` }}>{t('hist_collected')}</button>
                )}
                <button onClick={() => { if (confirm("Xóa buổi học này?")) { const nx = history.filter(x => x && x.id !== h.id); setHistory(nx as Session[]); syncData({ history: nx }); } }} style={{ background: 'none', color: C.err, fontSize: 11 }}><Ico name="trash" size={14} /></button>
              </div>
              </div>)}
            </div>
            );
          };

          const headerIconBtn = (icon: string, onClick: any, title: string, danger?: boolean) => (
            <button onClick={onClick} title={title} style={{ background: danger ? `${C.err}10` : C.bg, color: danger ? C.err : C.sub, border: `1px solid ${C.border}`, padding: '8px 10px', borderRadius: 9 }}><Ico name={icon} size={15} /></button>
          );

          return (
            <div style={{ display: 'grid', gridTemplateColumns: isWide ? '300px 1fr' : '1fr', gap: 20, alignItems: 'start' }}>

              {(isWide || !profile) && (
                <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: '0 10px' }}>
                      <Ico name="search" size={15} color={C.sub} />
                      <input placeholder={t('stu_search_ph')} value={searchSt} onChange={e => setSearchSt(e.target.value)} style={{ border: 'none', background: 'transparent', boxShadow: 'none', padding: '9px 0', fontSize: 13 }} />
                    </div>
                    <button onClick={() => { setEditStId(null); setNewSt({ name: "", rate: 300000, target: "6.5", cefr: "B2", email: "", privateMessage: "", dob: "" }); setShowAddStudent(true); }} title={t('stu_add_new')} style={{ background: C.accent, color: '#fff', width: 40, borderRadius: 10, flexShrink: 0, display: 'grid', placeItems: 'center' }}><Ico name="plus" size={18} color="#fff" /></button>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <select value={sortStudentBy} onChange={(e: any) => setSortStudentBy(e.target.value)} style={{ flex: 1, padding: '7px 10px', fontSize: 12.5 }}>
                      <option value="NAME">{t('stu_sort_name')}</option><option value="EXP">{t('stu_sort_exp')}</option><option value="DEBT">{t('stu_sort_debt')}</option>
                    </select>
                    <label style={{ fontSize: 11, fontWeight: 600, color: C.warn, display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap', cursor: 'pointer' }}>
                      <input type="checkbox" checked={filterUnpaid} onChange={(e) => setFilterUnpaid(e.target.checked)} style={{ width: 'auto', margin: 0 }} />{t('stu_only_debt')}
                    </label>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${C.border}`, paddingBottom: 10 }}>
                    <button onClick={() => setProfileId(null)} style={{ fontSize: 11.5, fontWeight: 600, color: !profile ? C.accent : C.sub, background: !profile ? `${C.accent}12` : 'transparent', padding: '5px 10px', borderRadius: 8 }}><Ico name="barChart" size={13} style={{ verticalAlign: -2, marginRight: 5 }} />{t('hub_overview')}</button>
                    <span style={{ fontSize: 11, color: C.sub }}>{t('hub_students_count', { n: listStudents.length })}</span>
                    <button onClick={exportStudentsCSV} title={t('stu_export_csv')} style={{ fontSize: 11, color: C.succ, background: 'transparent' }}><Ico name="arrowDown" size={13} style={{ verticalAlign: -2, marginRight: 3 }} />{t('stu_export_csv')}</button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: isWide ? '60vh' : 'none', overflowY: 'auto' }}>
                    {listStudents.map(s => { if (!s) return null; const deb = unpaidOf(s.id); const sel = profileId === s.id; return (
                      <button key={s.id} onClick={() => { if (profileId === s.id) { setProfileId(null); } else { setProfileId(s.id); setProfileTab('results'); } }} style={{ textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 10, background: sel ? `${C.accent}12` : C.bg, border: `1px solid ${sel ? C.accent : C.border}` }}>
                        {getAvatar(s.name)}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>{s.isPinned && <Ico name="pin" size={11} color={C.accent} />}{s.name}</div>
                          <div style={{ fontSize: 11, color: C.sub, marginTop: 2 }}>Lv.{s.level || 1} · {s.cefr || '—'}→{s.target || '—'}</div>
                        </div>
                        {deb > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: C.err, background: `${C.err}12`, padding: '2px 6px', borderRadius: 6, whiteSpace: 'nowrap' }}>{fmtMoney(deb)}</span>}
                      </button>
                    ); })}
                    {listStudents.length === 0 && <div style={{ textAlign: 'center', color: C.sub, fontSize: 12, padding: 20 }}>—</div>}
                  </div>
                </div>
              )}

              {(isWide || profile) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

                  {!profile && (
                    <>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
                        {statTile(t('hub_total_students'), students.filter(s => s).length)}
                        {statTile(t('hub_debtors'), debtorCount, C.warn)}
                        {statTile(t('hub_total_debt'), fmtMoney(allUnpaidTotal), C.err)}
                        {statTile(t('hub_total_hours'), allHours.toFixed(1) + 'h', C.accent)}
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: isWide ? '1fr 1fr' : '1fr', gap: 20 }}>
                        <div className="card">
                          {secHead(t('acad_top_students'))}
                          <div style={{ display: 'grid', gap: 7 }}>
                            {[...students].filter(s => s).sort((a, b) => ((b?.exp || 0) - (a?.exp || 0))).slice(0, 5).map((s, i) => s && (
                              <button key={s.id} onClick={() => { setProfileId(s.id); setProfileTab('overview'); }} style={{ textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: C.bg, borderRadius: 10 }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                  <span style={{ width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, color: '#fff', background: i === 0 ? '#C9A227' : i === 1 ? '#8E99A3' : i === 2 ? '#B07A48' : C.sub }}>{i + 1}</span>
                                  <span style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</span>
                                </span>
                                <span style={{ fontSize: 12, fontWeight: 600, color: C.accent }}>{s.exp || 0} EXP</span>
                              </button>
                            ))}
                          </div>
                          {Object.keys(bandDist).length > 0 && (
                            <div style={{ marginTop: 16 }}>
                              {secHead(t('acad_band_dist'))}
                              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                {Object.entries(bandDist).sort((a, b) => Number(b[0]) - Number(a[0])).map(([band, count]) => (
                                  <span key={band} style={{ fontSize: 11.5, fontWeight: 600, color: C.succ, background: `${C.succ}12`, padding: '4px 10px', borderRadius: 8 }}>Band {band}: {count}</span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="card">
                          {secHead(t('ea_title'))}
                          {errorAnalytics.centerTypes.length === 0 ? <div style={{ color: C.sub, fontSize: 12.5 }}>{t('ea_no_data')}</div> : (<>
                            <div style={{ display: 'grid', gap: 9 }}>
                              {errorAnalytics.centerTypes.map(ct => (
                                <div key={ct.label}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, marginBottom: 4 }}><span>{ct.label}</span><span style={{ color: ct.rate >= 70 ? C.succ : ct.rate >= 50 ? C.warn : C.err }}>{ct.rate}%</span></div>
                                  <div style={{ height: 7, background: C.bg, borderRadius: 4, overflow: 'hidden' }}><div style={{ height: '100%', width: `${ct.rate}%`, background: ct.rate >= 70 ? C.succ : ct.rate >= 50 ? C.warn : C.err }} /></div>
                                </div>
                              ))}
                            </div>
                            {errorAnalytics.weakStudents.length > 0 && (
                              <div style={{ marginTop: 14, display: 'grid', gap: 5 }}>
                                {errorAnalytics.weakStudents.map((ws, i) => (
                                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, padding: '6px 10px', background: `${C.err}0d`, borderRadius: 8 }}><span style={{ fontWeight: 600 }}>{ws.name}</span><span style={{ color: C.err, fontWeight: 600 }}>{ws.label} ({ws.rate}%)</span></div>
                                ))}
                              </div>
                            )}
                          </>)}
                        </div>
                      </div>

                      <div className="card">
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {([['calc', t('acad_calc_title'), 'target'], ['push', t('stu_push_title'), 'bell'], ['verify', t('rc_verify_title'), 'lock']] as [string, string, string][]).map(([k, lb, ic]) => (
                            <button key={k} onClick={() => setOvTool(ovTool === k ? "" : k as any)} style={{ fontSize: 12.5, fontWeight: 600, padding: '8px 14px', borderRadius: 10, border: `1px solid ${ovTool === k ? C.accent : C.border}`, background: ovTool === k ? `${C.accent}12` : C.bg, color: ovTool === k ? C.accent : C.text }}><Ico name={ic} size={14} style={{ verticalAlign: -2, marginRight: 6 }} />{lb}</button>
                          ))}
                        </div>

                        {ovTool === 'calc' && (
                          <div style={{ marginTop: 16, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                              <input type="number" placeholder={t('acad_calc_ph')} value={calcScore === "" ? "" : calcScore} onChange={(e: any) => setCalcScore(e.target.value === "" ? "" : Number(e.target.value))} style={{ width: 120, fontSize: 15 }} />
                              <span style={{ fontWeight: 600, fontSize: 18, color: C.sub }}>/ 40</span>
                            </div>
                            <div style={{ flex: 1, minWidth: 160, background: C.bg, padding: '12px 18px', borderRadius: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: 10.5, fontWeight: 600, color: C.sub, letterSpacing: 0.6, textTransform: 'uppercase' }}>Band score</span>
                              <span style={{ fontFamily: 'var(--display)', fontSize: 34, fontWeight: 500, color: C.accent, lineHeight: 1 }}>{calcScore === "" ? "—" : getIeltsBand(Number(calcScore), 40)}</span>
                            </div>
                          </div>
                        )}
                        {ovTool === 'push' && (
                          <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: isWide ? '1fr 1fr 1fr auto' : '1fr', gap: 10, alignItems: 'end' }}>
                            <select value={pushTarget} onChange={e => setPushTarget(e.target.value)}><option value="ALL">{t('stu_push_all')}</option>{students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
                            <input placeholder={t('stu_push_subject_ph')} value={pushTitle} onChange={e => setPushTitle(e.target.value)} />
                            <input placeholder={t('stu_push_content_ph')} value={pushBody} onChange={e => setPushBody(e.target.value)} />
                            <button onClick={handleSendPush} style={{ background: C.accent, color: '#fff', padding: '12px 20px', height: 46 }}>{t('stu_push_send')}</button>
                          </div>
                        )}
                        {ovTool === 'verify' && (
                          <div style={{ marginTop: 16 }}>
                            <div style={{ display: 'flex', gap: 8 }}>
                              <input value={verifyCodeInput} onChange={e => { setVerifyCodeInput(e.target.value); setVerifyResult(null); }} onKeyDown={e => { if (e.key === 'Enter') handleVerifyCode(); }} placeholder="OS-XXXXX-XXXXX" style={{ flex: 1, fontFamily: 'monospace', fontSize: 15, fontWeight: 600, letterSpacing: 2, textTransform: 'uppercase' }} />
                              <button onClick={handleVerifyCode} style={{ background: C.accent, color: '#fff', padding: '0 20px', fontWeight: 600 }}>{t('rc_verify_btn')}</button>
                            </div>
                            {verifyResult && verifyResult.status === "FAKE" && (<div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: `${C.err}12`, color: C.err, fontWeight: 600 }}><Ico name="xcircle" size={15} color={C.err} /> {t('rc_fake')}</div>)}
                            {verifyResult && (verifyResult.status === "VALID" || verifyResult.status === "USED") && verifyResult.entry && (
                              <div style={{ marginTop: 12, padding: 14, borderRadius: 10, background: verifyResult.status === "VALID" ? `${C.succ}0d` : `${C.warn}12`, border: `1px solid ${verifyResult.status === "VALID" ? C.succ : C.warn}` }}>
                                <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: 13 }}><span style={{ color: C.sub }}>{t('rc_student')}:</span><b>{verifyResult.entry.studentName}</b><span style={{ color: C.sub }}>{t('rc_item')}:</span><b>{verifyResult.entry.item}</b></div>
                                {verifyResult.status === "VALID"
                                  ? <button onClick={handleRedeemCode} style={{ marginTop: 12, background: C.succ, color: '#fff', padding: '10px', fontWeight: 600, width: '100%' }}><Ico name="check" size={15} /> {t('rc_redeem_btn')}</button>
                                  : <div style={{ marginTop: 10, color: C.warn, fontWeight: 600, fontSize: 12.5 }}><Ico name="alert" size={14} color={C.warn} /> {t('rc_used')}</div>}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </>
                  )}

                  {profile && (
                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                      <div style={{ padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', borderBottom: `1px solid ${C.border}` }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                          {!isWide && headerIconBtn('arrowLeft', () => setProfileId(null), 'Back')}
                          {getAvatar(profile.name)}
                          <div>
                            <div style={{ fontSize: 19, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>{profile.name} {pTrend}</div>
                            <div style={{ fontSize: 12, color: C.sub, marginTop: 3, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <span>{getGamificationBadge(profile.level || 1)} Lv.{profile.level || 1}</span>
                              <span>· {profile.cefr || '—'} → {profile.target || '—'}</span>
                              {profile.dob && <span>· {getAge(profile.dob)}</span>}
                            </div>
                            <div style={{ fontSize: 12, color: C.accent, marginTop: 3, display: 'flex', alignItems: 'center', gap: 5 }}>
                              {profile.email || t('stu_no_email')}
                              {profile.email && <button onClick={() => copyToClipboard(profile.email as string)} style={{ background: 'transparent', color: C.accent, padding: 0 }}><Ico name="copy" size={12} /></button>}
                            </div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <button onClick={() => exportStudentReportPDF(profile)} style={{ background: `${C.accent}15`, color: C.accent, fontSize: 12.5, padding: '8px 14px', fontWeight: 600 }}><Ico name="fileText" size={14} style={{ verticalAlign: -2, marginRight: 5 }} />{t('hub_export_pdf')}</button>
                          {headerIconBtn('pin', () => { const nx = students.map(x => x.id === profile.id ? { ...x, isPinned: !x.isPinned } : x); setStudents(nx); syncData({ students: nx }); }, t('tip_pin_student'))}
                          {headerIconBtn('edit', () => { setEditStId(profile.id); setNewSt({ ...profile }); setShowAddStudent(true); }, t('common_edit'))}
                          {headerIconBtn('trash', () => { if (confirm(`Xóa học viên ${profile.name}?`)) { const nx = students.filter(x => x && x.id !== profile.id); setStudents(nx as Student[]); syncData({ students: nx }); setProfileId(null); } }, t('common_delete'), true)}
                        </div>
                      </div>

                      <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}`, background: C.bg }}>
                        {TabBtn('overview', t('hub_overview'), 'barChart')}
                        {TabBtn('results', t('hub_tab_results'), 'pin', pResults.length)}
                        {TabBtn('sessions', t('hub_tab_sessions'), 'clock', pSessions.length)}
                        {TabBtn('finance', t('hub_tab_finance'), 'coins')}
                      </div>

                      <div style={{ padding: 24 }}>
                        {profileTab === 'overview' && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12 }}>
                              {statTile(t('hub_avg_band'), pAvg, C.succ)}
                              {statTile(t('hub_hours'), pHours.toFixed(1) + 'h')}
                              {statTile(t('hub_tests'), pResults.length)}
                              {statTile(t('hub_debt_short'), pUnpaid > 0 ? fmtMoney(pUnpaid) : '—', pUnpaid > 0 ? C.err : C.sub)}
                            </div>
                            <div>
                              {secHead(t('chart_band_title'))}
                              {bandSeries(pResults).length > 0 ? <BandTrendChart data={bandSeries(pResults)} /> : <div style={{ textAlign: 'center', color: C.sub, fontSize: 12.5, padding: 20 }}>{t('hub_no_band')}</div>}
                            </div>
                            {pTypes.length > 0 && (
                              <div>
                                {secHead(t('ea_title'))}
                                <div style={{ display: 'grid', gap: 8 }}>
                                  {pTypes.map(ct => (
                                    <div key={ct.label}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, marginBottom: 4 }}><span>{ct.label}</span><span style={{ color: ct.rate >= 70 ? C.succ : ct.rate >= 50 ? C.warn : C.err }}>{ct.rate}% <span style={{ color: C.sub, fontWeight: 400 }}>({t('ea_questions_n', { n: ct.total })})</span></span></div>
                                      <div style={{ height: 7, background: C.bg, borderRadius: 4, overflow: 'hidden' }}><div style={{ height: '100%', width: `${ct.rate}%`, background: ct.rate >= 70 ? C.succ : ct.rate >= 50 ? C.warn : C.err }} /></div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            <div>
                              {secHead(t('hub_evidence_note'))}
                              <input type="text" placeholder={t('stu_private_ph')} defaultValue={profile.privateMessage || ""} onBlur={(e: any) => { if (e.target.value !== profile.privateMessage) { const nx = students.map(x => x.id === profile.id ? { ...x, privateMessage: e.target.value } : x); setStudents(nx); syncData({ students: nx }); } }} style={{ fontSize: 12.5, background: `${C.warn}0d`, border: `1px solid ${C.warn}40`, color: C.text }} />
                            </div>
                          </div>
                        )}

                        {profileTab === 'results' && (
                          <div style={{ display: 'grid', gap: 14 }}>
                            {pResults.length === 0 ? <div style={{ textAlign: 'center', color: C.sub, padding: 30, fontSize: 13 }}>{t('acad_no_results')}</div> : pResults.map(resultCard)}
                          </div>
                        )}

                        {profileTab === 'sessions' && (
                          <div style={{ display: 'grid', gap: 14 }}>
                            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                              <button onClick={exportCSV} style={{ background: `${C.succ}15`, color: C.succ, fontSize: 12, padding: '7px 14px' }}><Ico name="arrowDown" size={13} style={{ verticalAlign: -2, marginRight: 5 }} />{t('hist_export_excel')}</button>
                            </div>
                            {pSessions.length === 0 ? <div style={{ textAlign: 'center', color: C.sub, padding: 30, fontSize: 13 }}>{t('hist_no_match')}</div> : pSessions.map(sessionCard)}
                          </div>
                        )}

                        {profileTab === 'finance' && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                              {statTile(t('hub_total_debt'), pUnpaid > 0 ? fmtMoney(pUnpaid) : '0', pUnpaid > 0 ? C.err : C.succ)}
                              {statTile(t('hub_coins'), profile.coins || 0, C.warn)}
                            </div>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                              <button onClick={() => { if (confirm(`Tặng 100 OS Coins cho ${profile.name}?`)) { const nx = students.map(x => x.id === profile.id ? { ...x, coins: (x.coins || 0) + 100 } : x); setStudents(nx); syncData({ students: nx }); } }} style={{ background: `${C.succ}15`, color: C.succ, fontSize: 12.5, padding: '8px 14px', fontWeight: 600 }}><Ico name="gift" size={14} style={{ verticalAlign: -2, marginRight: 5 }} />{t('stu_reward_coins')}</button>
                              <button onClick={() => setGiftFor(profile.id)} style={{ background: C.accent, color: '#fff', fontSize: 12.5, padding: '8px 14px', fontWeight: 600 }}><Ico name="gift" size={14} style={{ verticalAlign: -2, marginRight: 5 }} />{t('gift_manual_btn')}</button>
                              {pUnpaid > 0 && <>
                                <button onClick={() => copyToClipboard(`Chào phụ huynh, hiện tại em ${profile.name} đang còn khoản học phí chưa thanh toán là ${fmtMoney(pUnpaid)}. Phụ huynh vui lòng hoàn thiện giúp trung tâm nhé!`)} style={{ background: `${C.warn}15`, color: C.warn, fontSize: 12.5, padding: '8px 14px', fontWeight: 600 }}><Ico name="clipboard" size={14} style={{ verticalAlign: -2, marginRight: 5 }} />{t('hub_copy_sms')}</button>
                                <button onClick={() => { if (confirm(`Gửi CẢNH BÁO ĐỎ tới màn hình của ${profile.name}?`)) { const msg = `Chào ${profile.name},\n\nHệ thống ghi nhận bạn đang có khoản học phí chưa thanh toán là ${fmtMoney(pUnpaid)}.\n\nVui lòng hoàn thiện sớm để không bị gián đoạn quá trình học và làm bài thi trên nền tảng nhé!`; const nx = students.map(x => x.id === profile.id ? { ...x, debtMessage: msg } : x); setStudents(nx); syncData({ students: nx }); alert("Đã gửi cảnh báo đỏ!"); } }} style={{ background: C.err, color: '#fff', fontSize: 12.5, padding: '8px 14px', fontWeight: 600 }}><Ico name="siren" size={14} style={{ verticalAlign: -2, marginRight: 5 }} />{t('stu_debt_inapp')}</button>
                              </>}
                            </div>
                            {secHead(t('hub_unpaid_sessions'))}
                            <div style={{ display: 'grid', gap: 8 }}>
                              {pSessions.filter(h => !h.isPaid).length === 0 ? <div style={{ color: C.succ, fontSize: 12.5 }}><Ico name="check" size={14} style={{ verticalAlign: -2, marginRight: 5 }} />{t('hub_no_unpaid')}</div> : pSessions.filter(h => !h.isPaid).map(h => (
                                <div key={h.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: C.bg, borderRadius: 10 }}>
                                  <span style={{ fontSize: 12.5 }}>{h.date} · {fmtMoney(h.earnings)}</span>
                                  <button onClick={() => { const nxHistory = history.map(x => x && x.id === h.id ? { ...x, isPaid: true } : x); const rem = nxHistory.filter(se => se.studentId === profile.id && !se.isPaid).reduce((sum, se) => sum + (se.earnings || 0), 0); let nxStudents = students; if (rem <= 0) { nxStudents = students.map(s => s.id === profile.id ? { ...s, debtMessage: undefined } : s); setStudents(nxStudents); } setHistory(nxHistory as Session[]); syncData({ history: nxHistory, students: nxStudents }); }} style={{ background: `${C.warn}18`, color: C.warn, fontSize: 11.5, padding: '5px 11px', border: `1px solid ${C.warn}55` }}>{t('hist_collect_fast')}</button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* MODAL TẶNG QUÀ THỦ CÔNG — GV gửi thẳng vào túi đồ HV, không cần xu/gacha */}
              {giftFor && (() => {
                const gst = students.find(s => s.id === giftFor);
                if (!gst) return null;
                const owned: string[] = Array.isArray(gst.inventory?.permanents) ? gst.inventory!.permanents : [];
                // Cộng vào kho HV rồi đồng bộ (syncData nhánh GV union permanents nên không bao giờ làm giảm quà)
                const writeInv = (mut: (inv: any) => void, okMsg?: string) => {
                  const nx = students.map(s => {
                    if (s.id !== giftFor) return s;
                    const inv: any = { ...(s.inventory || {}) };
                    inv.consumables = { ...(s.inventory?.consumables || {}) };
                    inv.permanents = [...(Array.isArray(s.inventory?.permanents) ? s.inventory!.permanents : [])];
                    mut(inv);
                    return { ...s, inventory: inv };
                  });
                  setStudents(nx); syncData({ students: nx });
                  if (okMsg) alert(okMsg);
                };
                const giveCoins = (amt: number) => { const nx = students.map(s => s.id === giftFor ? { ...s, coins: (s.coins || 0) + amt } : s); setStudents(nx); syncData({ students: nx }); alert(`+${amt} OS Coins → ${gst.name}`); };
                const giveConsumable = (name: string) => { if (!name.trim()) return; writeInv(inv => { inv.consumables[name] = (inv.consumables[name] || 0) + 1; }, `${t('gift_done')} (${name})`); };
                const givePermanent = (name: string) => { if (owned.includes(name)) return; writeInv(inv => { if (!inv.permanents.includes(name)) inv.permanents.push(name); }, `${t('gift_done')} (${name})`); };
                const CONSUMABLES = ["Thẻ dời deadline (24h)", "1 Hộp Milo", "1 Ly Trái Chò", "1 Trà sữa Viên Viên"];
                const TITLES = ["Chiến Thần IELTS", "Kẻ Hủy Diệt Đề", "Học Bá Thượng Đẳng", "Cao Thủ Reading", "Bậc Thầy Từ Vựng", "Vua Tốc Độ", "Huyền Thoại 8.0+", "Mọt Sách Bất Bại", "Thợ Săn Band Điểm", "Ninja Phòng Thi"].map(x => "Danh hiệu: " + x);
                const THEMES = ["Giao diện: Hoàng Kim", "Giao diện: Nửa Đêm", "Giao diện: Anh Đào", "Giao diện: Rừng Sâu"];
                const FRAMES = ["Khung avatar: Vương Miện", "Khung avatar: Rồng Lửa", "Khung avatar: Băng Giá", "Khung avatar: Cầu Vồng", "Khung avatar: Sao Băng"];
                const PETS = ["Linh thú: Cú Mèo", "Linh thú: Mèo Thần Tài", "Linh thú: Rồng Con", "Linh thú: Cáo Lửa", "Linh thú: Chim Cánh Cụt", "Linh thú: Gấu Trúc"];
                const permChip = (name: string) => {
                  const has = owned.includes(name);
                  return <button key={name} disabled={has} onClick={() => givePermanent(name)} style={{ textAlign: 'left', fontSize: 12, padding: '7px 11px', borderRadius: 9, border: `1px solid ${has ? C.succ : C.border}`, background: has ? `${C.succ}12` : C.bg, color: has ? C.succ : C.text, cursor: has ? 'default' : 'pointer', fontWeight: 600 }}>{has ? <Ico name="check" size={12} style={{verticalAlign:'-1px', marginRight:4, display:'inline-block'}} /> : '+ '}{name.split(': ')[1] || name}{has ? ` · ${t('gift_owned')}` : ''}</button>;
                };
                const grp = (title: string, items: string[]) => (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.sub, margin: '4px 0 7px', textTransform: 'uppercase', letterSpacing: 0.5 }}>{title}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 7 }}>{items.map(permChip)}</div>
                  </div>
                );
                return (
                  <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => { setGiftFor(null); setGiftCustom(""); }}>
                    <div className="card" style={{ width: 600, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto' }} onClick={(e: any) => e.stopPropagation()}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                        <h3 style={{ margin: 0, fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}><Ico name="gift" size={18} color={C.accent} />{t('gift_modal_title')}</h3>
                        <button onClick={() => { setGiftFor(null); setGiftCustom(""); }} style={{ background: 'transparent', color: C.err, fontSize: 22, padding: 0 }}><Ico name="x" size={20} /></button>
                      </div>
                      <div style={{ fontSize: 12.5, color: C.sub, marginBottom: 16 }}>{gst.name} · {t('gift_modal_sub')}</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: C.sub, marginBottom: 7, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('gift_sec_coins')}</div>
                          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>{[50, 100, 200, 500, 1000].map(a => <button key={a} onClick={() => giveCoins(a)} style={{ background: `${C.warn}15`, color: C.warn, fontSize: 12.5, padding: '8px 14px', fontWeight: 700, borderRadius: 9 }}>+{a} <Ico name="coins" size={12} style={{ verticalAlign: -1 }} /></button>)}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: C.sub, marginBottom: 7, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('gift_sec_consumable')}</div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 7 }}>
                            {CONSUMABLES.map(n => <button key={n} onClick={() => giveConsumable(n)} style={{ textAlign: 'left', fontSize: 12, padding: '8px 11px', borderRadius: 9, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontWeight: 600 }}>+ {n}</button>)}
                          </div>
                          <div style={{ display: 'flex', gap: 7, marginTop: 8 }}>
                            <input value={giftCustom} onChange={(e: any) => setGiftCustom(e.target.value)} placeholder={t('gift_custom_ph')} style={{ flex: 1, fontSize: 12.5 }} />
                            <button onClick={() => { giveConsumable(giftCustom.trim()); setGiftCustom(""); }} disabled={!giftCustom.trim()} style={{ background: C.accent, color: '#fff', fontSize: 12.5, padding: '8px 16px', fontWeight: 600, opacity: giftCustom.trim() ? 1 : 0.5 }}>{t('gift_grant')}</button>
                          </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: C.sub, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('gift_sec_permanent')}</div>
                          {grp('Danh hiệu', TITLES)}
                          {grp('Giao diện', THEMES)}
                          {grp('Khung avatar', FRAMES)}
                          {grp('Linh thú', PETS)}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {showAddStudent && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => setShowAddStudent(false)}>
                  <div className="card" style={{ width: 560, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto' }} onClick={(e: any) => e.stopPropagation()}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                      <h3 style={{ margin: 0, fontSize: 16 }}>{editStId ? t('stu_edit_title') : t('stu_add_title')}</h3>
                      <button onClick={() => setShowAddStudent(false)} style={{ background: 'transparent', color: C.err, fontSize: 22, padding: 0 }}><Ico name="x" size={20} /></button>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                      <div><label style={{ fontSize: 10.5, fontWeight: 600, color: C.sub }}>{t('stu_fullname')}</label><input value={newSt.name} onChange={(e: any) => setNewSt({ ...newSt, name: e.target.value })} /></div>
                      <div><label style={{ fontSize: 10.5, fontWeight: 600, color: C.sub }}>{t('stu_login_email')}</label><input value={newSt.email} onChange={(e: any) => setNewSt({ ...newSt, email: e.target.value })} placeholder="hs@gmail.com" /></div>
                      <div><label style={{ fontSize: 10.5, fontWeight: 600, color: C.sub }}>{t('stu_dob')}</label><input type="date" value={newSt.dob || ""} onChange={(e: any) => setNewSt({ ...newSt, dob: e.target.value })} /></div>
                      <div><label style={{ fontSize: 10.5, fontWeight: 600, color: C.sub }}>{t('stu_rate')}</label><input type="number" value={newSt.rate} onChange={(e: any) => setNewSt({ ...newSt, rate: Number(e.target.value) })} /></div>
                      <div><label style={{ fontSize: 10.5, fontWeight: 600, color: C.sub }}>{t('stu_cefr_now')}</label><input value={newSt.cefr} onChange={(e: any) => setNewSt({ ...newSt, cefr: e.target.value })} /></div>
                      <div><label style={{ fontSize: 10.5, fontWeight: 600, color: C.sub }}>{t('stu_target_band')}</label><input value={newSt.target} onChange={(e: any) => setNewSt({ ...newSt, target: e.target.value })} /></div>
                      {editStId && (<div><label style={{ fontSize: 10.5, fontWeight: 600, color: C.warn }}>{t('stu_os_coins')}</label><input type="number" value={newSt.coins || 0} onChange={(e: any) => setNewSt({ ...newSt, coins: Number(e.target.value) })} style={{ borderColor: C.warn }} placeholder={t('stu_coins_ph')} /></div>)}
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                      <button onClick={() => { handleStudentAction(); setShowAddStudent(false); }} style={{ flex: 1, background: C.accent, color: "#fff", padding: "11px" }}>{editStId ? t('stu_update') : t('stu_add_new')}</button>
                      <button onClick={() => { setEditStId(null); setShowAddStudent(false); setNewSt({ name: "", rate: 300000, target: "6.5", cefr: "B2", email: "", privateMessage: "", dob: "" }); }} style={{ background: C.bg, color: C.text, padding: "11px 20px" }}>{t('common_cancel')}</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })()}
        {activeTab === "FINANCE" && (
          <div style={{ display: "grid", gap: 24 }}>
            <div className="card" style={{padding: 30}}>
               <h3 style={{marginTop: 0, textAlign: 'center'}}><Ico name="barChart" size={14} style={{verticalAlign:'-2px',margin:'0 6px 0 0',display:'inline-block'}} />{t('fin_overview')}</h3>
               <div style={{display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20}}>
                   <div>
                       <div style={{fontSize: 11, fontWeight: 800, color: C.succ, marginBottom: 5}}>{t('fin_total_in')}: {fmtMoney(totalRev)}</div>
                       <div style={{height: 12, background: `${C.succ}20`, borderRadius: 6, overflow: 'hidden'}}>
                           <div style={{width: `${revPct}%`, height: '100%', background: C.succ}} />
                       </div>
                   </div>
                   <div>
                       <div style={{fontSize: 11, fontWeight: 800, color: C.err, marginBottom: 5}}>{t('fin_total_out')}: {fmtMoney(totalExp)}</div>
                       <div style={{height: 12, background: `${C.err}20`, borderRadius: 6, overflow: 'hidden'}}>
                           <div style={{width: `${100 - revPct}%`, height: '100%', background: C.err}} />
                       </div>
                   </div>
               </div>
               <div style={{textAlign: 'center', fontSize: 18, borderTop: `1px solid ${C.border}`, paddingTop: 15}}>{t('fin_net')}: <span style={{color: C.accent, fontWeight: 900, fontSize: 28}}>{fmtMoney(stats.net)}</span></div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: window.innerWidth > 768 ? "1fr 1fr" : "1fr", gap: 24 }}>
                <div className="card">
                <h3>{t('fin_income_report')}</h3>
                <div style={{marginBottom: 20}}>
                    {TEACHERS.map(tn => (
                        <div key={tn} style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", borderBottom: `1px solid ${C.border}` }}>
                        <div><div style={{fontWeight:700, fontSize:14}}>{tn}</div><div style={{fontSize:11, color:C.sub}}>{(history.filter(h=>h && h.teacher===tn).reduce((s,h)=>s+((h && h.duration)||0),0)/3600).toFixed(1)}h {t('fin_teaching')}</div></div>
                        <div style={{fontWeight:900, color:C.accent}}>{fmtMoney(history.filter(h=>h && h.teacher===tn).reduce((s,h)=>s+((h && h.earnings)||0),0))}</div>
                        </div>
                    ))}
                </div>

                <div style={{marginTop: 30, marginBottom: 10, fontWeight: 900}}>{t('fin_extra_income')}</div>
                <div style={{ display: "flex", flexWrap: 'wrap', gap: 10, marginBottom: 20 }}>
                    <input placeholder={t('fin_reason_in')} value={newTrans.title} onChange={(e: any)=>setNewTrans({...newTrans, title:e.target.value})} style={{flex: '1 1 150px'}} />
                    <input type="number" placeholder={t('fin_amount')} value={newTrans.amount || ""} onChange={(e: any)=>setNewTrans({...newTrans, amount:Number(e.target.value)})} style={{flex: '1 1 100px'}} />
                    <button onClick={() => handleAddTransaction("INCOME")} style={{ background: C.succ, color: "#fff", padding: "10px 20px" }}>{t('common_save')}</button>
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
                    <span style={{fontWeight:900}}>{t('fin_total_in')}:</span><span style={{ color: C.succ, fontSize:24, fontWeight:900 }}>{fmtMoney(stats.totalRev)}</span>
                </div>
                </div>
                
                <div className="card">
                <h3>{t('fin_expense_report')}</h3>
                <div style={{ display: "flex", flexWrap: 'wrap', gap: 10, marginBottom: 20 }}>
                    <input placeholder={t('fin_reason_out')} value={newTrans.title} onChange={(e: any)=>setNewTrans({...newTrans, title:e.target.value})} style={{flex: '1 1 150px'}} />
                    <input type="number" placeholder={t('fin_amount')} value={newTrans.amount || ""} onChange={(e: any)=>setNewTrans({...newTrans, amount:Number(e.target.value)})} style={{flex: '1 1 100px'}} />
                    <button onClick={() => handleAddTransaction("EXPENSE")} style={{ background: C.err, color: "#fff", padding: "10px 20px" }}>{t('common_save')}</button>
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
        {/* Tab HISTORY đã được gộp vào hub "Học viên" (STUDENTS) — tab con "Buổi học" trong hồ sơ. */}
        {activeTab === "DRIVE" && (
          <div style={{ display: "grid", gap: 24 }}>
            <div className="card">
              <h2 style={{ marginTop: 0, fontSize: 18 }}><Ico name="cloud" size={14} style={{verticalAlign:'-2px',margin:'0 6px 0 0',display:'inline-block'}} />{t('drv_upload_title')}</h2>
              <div style={{ display: "grid", gridTemplateColumns: window.innerWidth > 600 ? "1fr 1fr 1fr" : "1fr", gap: 15, marginBottom: 20 }}>
                <div>
                  <label style={{fontSize: 10, fontWeight: 800, color: C.sub}}>{t('drv_doc_name')}</label>
                  <input placeholder={t('drv_doc_name_ph')} value={newLink.title} onChange={(e: any)=>setNewLink({...newLink, title:e.target.value})} />
                </div>
                <div>
                  <label style={{fontSize: 10, fontWeight: 800, color: C.sub}}>{t('drv_link_label')}</label>
                  <input placeholder="https://..." value={newLink.url} onChange={(e: any)=>setNewLink({...newLink, url:e.target.value})} />
                </div>
                <div>
                  <label style={{fontSize: 10, fontWeight: 800, color: C.sub}}>{t('drv_audience')}</label>
                  <select value={linkAudience} onChange={(e: any)=>setLinkAudience(e.target.value as any)}>
                    <option value="ALL_STUDENTS">{t('drv_aud_all')}</option>
                    <option value="TEACHERS">{t('drv_aud_teachers')}</option>
                    <option value="SPECIFIC_STUDENT">{t('drv_aud_specific')}</option>
                  </select>
                </div>
              </div>

              {linkAudience === "SPECIFIC_STUDENT" && (
                <div style={{marginBottom: 20}}>
                  <label style={{fontSize: 10, fontWeight: 800, color: C.sub}}>{t('drv_pick_student')}</label>
                  <select value={linkTargetId} onChange={(e: any)=>setLinkTargetId(e.target.value)} style={{maxWidth: 400}}>
                    <option value="">{t('drv_pick_student_opt')}</option>
                    {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              )}

              <button onClick={handleAddLink} style={{ background: C.accent, color: "#fff", padding: "12px 24px" }}>{t('drv_save_doc')}</button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: window.innerWidth > 800 ? "1fr 1fr 1fr" : "1fr", gap: 20 }}>
               <div className="card" style={{background: C.bg, border: `1px solid ${C.border}`}}>
                 <h3 style={{marginTop: 0, fontSize: 14, color: C.err, borderBottom: `2px solid ${C.err}`, paddingBottom: 10}}><Ico name="lock" size={14} style={{verticalAlign:'-2px',margin:'0 6px 0 0',display:'inline-block'}} />{t('drv_internal')}</h3>
                 <div style={{display: 'grid', gap: 10}}>
                   {sharedLinks.filter(l => l && l.audience === "TEACHERS").map(l => (
                     <div key={l.id} style={{background: C.card, padding: 15, borderRadius: 8, border: `1px solid ${C.border}`}}>
                       <div style={{fontWeight: 800, fontSize: 13, marginBottom: 8}}>{getFileIcon(l.url)} {l.title}</div>
                       <div style={{display: 'flex', gap: 5}}>
                         <a href={l.url} target="_blank" rel="noreferrer" style={{fontSize: 11, background: C.accent, color: '#fff', padding: '4px 8px', borderRadius: 4, textDecoration: 'none'}}>{t('drv_open')}</a>
                         <button onClick={()=>copyToClipboard(l.url)} style={{fontSize: 11, background: C.bg, border: `1px solid ${C.border}`, padding: '4px 8px', cursor: 'pointer', color: C.text}}>Copy</button>
                         <button onClick={()=>{ const nx=sharedLinks.filter(x=>x && x.id!==l.id); setSharedLinks(nx as SharedLink[]); syncData({sharedLinks:nx}); }} style={{fontSize: 11, background: `${C.err}15`, color: C.err, padding: '4px 8px', marginLeft: 'auto'}}>{t('common_delete')}</button>
                       </div>
                     </div>
                   ))}
                 </div>
               </div>

               <div className="card" style={{background: C.bg, border: `1px solid ${C.border}`}}>
                 <h3 style={{marginTop: 0, fontSize: 14, color: C.succ, borderBottom: `2px solid ${C.succ}`, paddingBottom: 10}}><Ico name="pin" size={14} style={{verticalAlign:'-2px',margin:'0 6px 0 0',display:'inline-block'}} />{t('drv_common')}</h3>
                 <div style={{display: 'grid', gap: 10}}>
                   {sharedLinks.filter(l => l && l.audience === "ALL_STUDENTS").map(l => (
                     <div key={l.id} style={{background: C.card, padding: 15, borderRadius: 8, border: `1px solid ${C.border}`}}>
                       <div style={{fontWeight: 800, fontSize: 13, marginBottom: 8}}>{getFileIcon(l.url)} {l.title}</div>
                       <div style={{display: 'flex', gap: 5}}>
                         <a href={l.url} target="_blank" rel="noreferrer" style={{fontSize: 11, background: C.accent, color: '#fff', padding: '4px 8px', borderRadius: 4, textDecoration: 'none'}}>{t('drv_open')}</a>
                         <button onClick={()=>copyToClipboard(l.url)} style={{fontSize: 11, background: C.bg, border: `1px solid ${C.border}`, padding: '4px 8px', cursor: 'pointer', color: C.text}}>Copy</button>
                         <button onClick={()=>{ const nx=sharedLinks.filter(x=>x && x.id!==l.id); setSharedLinks(nx as SharedLink[]); syncData({sharedLinks:nx}); }} style={{fontSize: 11, background: `${C.err}15`, color: C.err, padding: '4px 8px', marginLeft: 'auto'}}>{t('common_delete')}</button>
                       </div>
                     </div>
                   ))}
                 </div>
               </div>

               <div className="card" style={{background: C.bg, border: `1px solid ${C.border}`}}>
                 <h3 style={{marginTop: 0, fontSize: 14, color: C.warn, borderBottom: `2px solid ${C.warn}`, paddingBottom: 10}}><Ico name="user" size={14} style={{verticalAlign:'-2px',margin:'0 6px 0 0',display:'inline-block'}} />{t('drv_personal')}</h3>
                 <div style={{display: 'grid', gap: 10}}>
                   {sharedLinks.filter(l => l && l.audience === "SPECIFIC_STUDENT").map(l => (
                     <div key={l.id} style={{background: C.card, padding: 15, borderRadius: 8, border: `1px solid ${C.border}`}}>
                       <div style={{fontSize: 10, color: C.warn, fontWeight: 800, marginBottom: 4}}>{t('drv_assigned_to')} {l.targetStudentName}</div>
                       <div style={{fontWeight: 800, fontSize: 13, marginBottom: 8}}>{getFileIcon(l.url)} {l.title}</div>
                       <div style={{display: 'flex', gap: 5}}>
                         <a href={l.url} target="_blank" rel="noreferrer" style={{fontSize: 11, background: C.accent, color: '#fff', padding: '4px 8px', borderRadius: 4, textDecoration: 'none'}}>{t('drv_open')}</a>
                         <button onClick={()=>copyToClipboard(l.url)} style={{fontSize: 11, background: C.bg, border: `1px solid ${C.border}`, padding: '4px 8px', cursor: 'pointer', color: C.text}}>Copy</button>
                         <button onClick={()=>{ const nx=sharedLinks.filter(x=>x && x.id!==l.id); setSharedLinks(nx as SharedLink[]); syncData({sharedLinks:nx}); }} style={{fontSize: 11, background: `${C.err}15`, color: C.err, padding: '4px 8px', marginLeft: 'auto'}}>{t('common_delete')}</button>
                       </div>
                     </div>
                   ))}
                 </div>
               </div>
            </div>
          </div>
        )}

      </main>
      
      {!activeExam && !isMobile && (
          <button onClick={scrollToTop} style={{position: 'fixed', bottom: 20, right: 20, background: C.accent, color: '#fff', width: 45, height: 45, borderRadius: '50%', fontSize: 20, boxShadow: '0 4px 10px rgba(0,0,0,0.3)', zIndex: 999, border: 'none', cursor: 'pointer'}}><Ico name="arrowUp" size={20} /></button>
      )}

      {/* NÚT CHUYỂN ĐỔI NGÔN NGỮ NHANH */}
      {!activeExam && !isMobile && (
          <button 
              onClick={() => i18n.changeLanguage(i18n.language === 'en' ? 'vi' : 'en')} 
              style={{position: 'fixed', bottom: 20, left: 20, background: C.card, color: C.text, border: `2px solid ${C.border}`, padding: '10px 15px', borderRadius: 30, fontSize: 14, fontWeight: 900, boxShadow: '0 4px 10px rgba(0,0,0,0.1)', zIndex: 999, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8}}
          >
              {i18n.language === 'en' ? 'Tiếng Việt' : 'English'}
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
}
