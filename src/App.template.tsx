import React, { useState, useEffect, useRef, useMemo } from "react";
import * as THREE from "three";
import DOMPurify from "dompurify";
import { initializeApp } from "firebase/app";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, onSnapshot, runTransaction, setDoc } from "firebase/firestore";
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
  }, [currentUser]);

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
// permanents là APPEND-ONLY. onSnapshot có thể trả snapshot CŨ từ cache (persistentMultipleTabManager)
// hoặc server chưa kịp có quà (write đang chờ/lỗi) -> quà biến mất trước mắt. Khắc phục: permanents của
// CHÍNH user hiện tại = hợp(snapshot ∪ state local trước đó ∪ backup localStorage). Backup sống qua reload;
// lần ghi kế tiếp (union trong syncData) sẽ đẩy ngược lên server -> tự lành cả khi write gacha từng lỗi.
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
    return incoming.map((s: any) => {
      if (String(s?.email || "").toLowerCase() !== email) return s;
      const inPerms = Array.isArray(s?.inventory?.permanents) ? s.inventory.permanents : [];
      const union = Array.from(new Set([...(Array.isArray(backup) ? backup : []), ...prevPerms, ...inPerms]));
      try { localStorage.setItem(bkKey, JSON.stringify(union)); } catch (e) {}
      return { ...s, inventory: { consumables: {}, ...(s.inventory || {}), permanents: union } };
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
    setQuizzes(clean(d.quizzes));
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
    writeInFlightRef.current++;
    try {
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
                    const _svNb = Array.isArray(serverItem.vocabNotebook) ? serverItem.vocabNotebook : [];
                    const _lcNb = Array.isArray(myLocalInfo.vocabNotebook) ? myLocalInfo.vocabNotebook : [];
                    const _tomb: string[] = _uniq(serverItem.vocabTombstones, myLocalInfo.vocabTombstones).slice(-800);
                    const _nbMap = new Map<string, any>();
                    _svNb.forEach((c: any) => { if (c && c.id) _nbMap.set(c.id, c); });
                    _lcNb.forEach((c: any) => { if (c && c.id) _nbMap.set(c.id, { ..._nbMap.get(c.id), ...c }); });
                    const mergedNotebook = Array.from(_nbMap.values()).filter((c: any) => !_tomb.includes(c.id));
                    return {
                      ...serverItem,
                      ...myLocalInfo,
                      // exp/level chỉ tăng -> MAX chống mất XP kể cả khi state HV bị cũ (đa thiết bị / suppress window).
                      exp: Math.max(Number(serverItem.exp) || 0, Number(myLocalInfo.exp) || 0),
                      level: Math.max(Number(serverItem.level) || 1, Number(myLocalInfo.level) || 1),
                      vocabNotebook: mergedNotebook,
                      vocabTombstones: _tomb,
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

        const cleanUpdate = JSON.parse(JSON.stringify(finalUpdate));
        transaction.update(DB_DOC_REF, cleanUpdate);
      });
    } catch (error: any) {
      console.error("Critical Sync Blocked:", error);
      if (typeof logErrorToSystem === "function") {
        logErrorToSystem("CRITICAL_SYNC_FAIL", error.message || String(error), { user: currentUser?.email });
      }
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
      const secs = (fullQuiz as any)?.sections;
      if (Array.isArray(secs) && secs.length) {
        let si = (typeof (q as any).passageIndex === 'number') ? (q as any).passageIndex : -1;
        if (si < 0 || si >= secs.length) si = secs.findIndex((sec: any) => (sec?.questions || []).some((qq: any) => qq && qq.id === q.id));
        if (si >= 0 && secs[si]) qPassage = secs[si].passage || qPassage;
      }
      const ctxParts = [stripTags(q.groupContext), stripTags(qPassage), stripTags(fullQuiz?.transcript)].filter(Boolean);
      const context = ctxParts.join("\n").trim().slice(0, 24000);
      const API_BASE = getApiBase();
      const resp = await fetch(`${API_BASE}/api/ai_explain`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang: i18n.language === "vi" ? "vi" : "en", question: stripTags(q.text), options: optStr, correct: correctStr, studentAnswer: stuStr, context, isListening: String(fullQuiz?.type || quiz?.type || "").toLowerCase().includes("listen") })
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
      let source = (transcripts + " " + passages + " " + qtext).replace(/\s+/g, " ").trim().slice(0, 30000);
      wrongCtx = wrongCtx.replace(/\s+/g, " ").trim().slice(0, 2000);
      const existing = new Set((me.vocabNotebook || []).map(c => (c.word || "").toLowerCase()));
      const excludeWords = Array.from(existing).slice(0, 600);
      const API_BASE = getApiBase();
      const resp = await fetch(`${API_BASE}/api/ai_vocab`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang: i18n.language === "vi" ? "vi" : "en", minCount: Math.max(5, Math.min(40, vocabCount || 15)), target: me.target || "", source, wrongContext: wrongCtx, exclude: excludeWords, kinds: (vocabKinds && vocabKinds.length ? vocabKinds : ["word", "phrasal_verb", "idiom", "collocation", "grammar"]) })
      });
      const data = await resp.json();
      if (!data.success || !Array.isArray(data.items)) { alert("" + (data.error || "Lỗi tạo từ vựng")); return; }
      const now = getTrueTime();
      const newCards: VocabCard[] = data.items
        .filter((it: any) => it && it.word && !existing.has(String(it.word).toLowerCase()))
        .map((it: any, i: number) => ({
          id: (now + i).toString(), word: String(it.word), phonetic: it.phonetic || "", pos: it.pos || "",
          meaning: it.meaning_en || it.meaning_vi || it.meaning || "", example: it.example || "", cefr: it.cefr || "",
          category: String(it.category || "word"), evidence: it.source_sentence || it.evidence || "",
          box: 1, due: now, createdAt: now,
        }));
      if (newCards.length === 0) { alert("Không có từ mới (có thể đã có sẵn trong sổ)."); return; }
      const nxNotebook = [...newCards, ...(me.vocabNotebook || [])];
      const nx = students.map(s => s.id === me.id ? { ...s, vocabNotebook: nxNotebook } : s);
      setStudents(nx); syncData({ students: nx });
      setVocabView("study"); setStudyFlipped(false);
      const droppedN = Number(data.dropped) || 0;
      alert(`Đã thêm ${newCards.length} mục vào sổ tay!` + (droppedN > 0 ? `\n AI đã tự loại ${droppedN} mục không khớp nguyên văn trong đề (chống bịa).` : ""));
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
    const nx = students.map(s => s.id === me.id ? { ...s, vocabNotebook: nxNotebook } : s);
    setStudents(nx); syncData({ students: nx });
  };

  const deleteVocabCard = (cardId: string) => {
    const me = findMe();
    if (!me) return;
    const nxNotebook = (me.vocabNotebook || []).filter(c => c.id !== cardId);
    // Ghi "bia mộ" để merge chống-mất-từ không hồi sinh thẻ đã chủ động xóa
    const nxTomb = Array.from(new Set([...(me.vocabTombstones || []), cardId])).slice(-800);
    const nx = students.map(s => s.id === me.id ? { ...s, vocabNotebook: nxNotebook, vocabTombstones: nxTomb } : s);
    setStudents(nx); syncData({ students: nx });
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
      setQuizzes(nx); syncData({quizzes: nx}); setSelectedQuizzes([]);
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

/*INSERT_REVIEW_QUIZ*/

/*INSERT_SEB_GUIDE*/
/*INSERT_PENDING_EXAM*/

/*INSERT_ACTIVE_EXAM*/

      // ==========================================
      // VIEW: STUDENT DASHBOARD
      // ==========================================
/*INSERT_STUDENT_PORTAL*/

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
/*INSERT_DASHBOARD*/
/*INSERT_CLASSROOM*/
/*INSERT_EXAM_BUILDER*/
/*INSERT_LIVE_ARENA*/
/*INSERT_ACADEMICS*/
/*INSERT_STUDENTS*/
/*INSERT_FINANCE*/
/*INSERT_HISTORY*/
/*INSERT_DRIVE*/

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
