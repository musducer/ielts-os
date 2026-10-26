import React, { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import type * as Three from "three";
import DOMPurify from "dompurify";
import { annotationHTML, applySelectionAnnotation, renderAnnotationLayers, removeAnnotation, topHighlight } from './annotationLayers';
import { startAnswerDrag, endAnswerDrag, validAnswerTarget, answerBankAt, feedbackAnswerDrag, observeSentenceEnding } from './answerDrag';
import './answerDrag.css';
import { initializeApp } from "firebase/app";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, deleteDoc, doc, getDocFromServer, getDocsFromServer, onSnapshot, runTransaction, setDoc, writeBatch } from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, type User } from "firebase/auth";
import { getStorage, ref as storageRef, uploadBytesResumable } from "firebase/storage";
import {
  deriveQuestProgress,
  emptyQuestProgress,
  evaluateQuestRewards,
  getLatestQuestAttempt,
  getQuestNodeState,
  mergeQuestProgressCollections,
  parseQuestCoinReward,
} from "./quest";
import type {
  QuestAttempt,
  QuestLaunchContext,
  QuestNodeConfig,
  StudentQuestProgress,
  TopicAssignment,
} from "./quest";
import WritingFeedback from "./WritingFeedback";
import {
  DEFAULT_GIFT_CATALOG,
  DEFAULT_REWARD_MECHANISMS,
  coinsForRewardEvent,
  countWritingWords,
  isWritingQuiz,
  normalizeGiftCatalog,
  normalizeRewardMechanisms,
  normalizeWritingTasks,
  resultSubmittedAt,
  writingDraftKey,
  writingQuestions,
} from "./publicRelease";
import {
  getDeliveryMode,
  getDeliveryPolicy,
  isQuizPublishable,
  isReadyForPublish,
  withDeliveryMode,
  type DeliveryMode,
  type StoredExamPolicy,
} from "./deliveryPolicy";
import type { GiftDefinition, RewardMechanism, WritingTaskDefinition } from "./publicRelease";
import {
  CANONICAL_TAXONOMY,
  TAXONOMY_BY_ID,
  getQuizCategoryBreakdown,
  inferQuestionCategory,
  quizTaxonomySkill,
  toErrorDnaBucket,
  type TaxonomySkill,
} from "./questionTaxonomy";
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
const isTeacherEmail = (email: string | null | undefined) => String(email || "").trim().toLowerCase().endsWith("@ielts.os");
const getAuthHeaders = async (extra: Record<string, string> = {}): Promise<Record<string, string>> => {
  try {
    const token = auth.currentUser ? await auth.currentUser.getIdToken() : "";
    return token ? { ...extra, Authorization: `Bearer ${token}` } : { ...extra };
  } catch {
    return { ...extra };
  }
};
const DB_DOC_REF = doc(db, "ielts_workspace", "trung_linh_data");
const LIVE_DOC_REF = doc(db, "ielts_workspace", "live_arena");
// A full exam can exceed Firestore's 1 MiB document limit. Keep every exam in its
// own document so a successful local edit is always deliverable to every device.
const QUIZZES_COLLECTION_REF = collection(DB_DOC_REF, "quizzes");
const WRITING_DRAFTS_COLLECTION_REF = collection(DB_DOC_REF, "writingDrafts");
const VOCAB_ROOT_COLLECTION = "ielts_vocab";
const vocabStudentKey = (email: string) => encodeURIComponent(String(email || "").trim().toLowerCase());
const vocabCardsRef = (email: string) => collection(db, VOCAB_ROOT_COLLECTION, vocabStudentKey(email), "cards");
const vocabCreatedAt = (card: any) => {
  const explicit = Number(card?.createdAt);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const match = String(card?.id || "").match(/^vocab_(\d{10,})/);
  return match ? Number(match[1]) : 0;
};
const newestVocabFirst = (cards: VocabCard[]) => [...cards].sort((a, b) =>
  vocabCreatedAt(b) - vocabCreatedAt(a) || String(b.id).localeCompare(String(a.id))
);
const vocabCardSignature = (card: any) => JSON.stringify([
  String(card?.id || ""), String(card?.word || ""), String(card?.phonetic || ""),
  String(card?.pos || ""), String(card?.meaning || ""), String(card?.example || ""),
  String(card?.cefr || ""), String(card?.category || ""), String(card?.evidence || ""),
  Number(card?.box || 1), Number(card?.due || 0), Number(card?.createdAt || 0),
]);
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

const readVocabCardsFromServer = async (email: string) => {
  const snap = await getDocsFromServer(vocabCardsRef(email));
  const notebook: VocabCard[] = [];
  const tombstones: string[] = [];
  snap.docs.forEach(cardSnap => {
    const value: any = cardSnap.data() || {};
    const id = String(value.id || cardSnap.id);
    if (value.deleted) tombstones.push(id);
    else notebook.push({ ...value, id } as VocabCard);
  });
  return { notebook: newestVocabFirst(notebook), tombstones };
};

// ==========================================
// HÀNG ĐỢI NỘP BÀI OFFLINE (lưu nhiều kết quả, đồng bộ khi có mạng)
// ==========================================
const offlineQueueKey = (email?: string | null) => `ielts_offline_queue_${email || "anon"}`;
const stableOfflineIdentity = (identity?: string | null) =>
  String(identity || "anon").trim().toLowerCase() || "anon";
const readOfflineQueue = (email?: string | null): any[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(offlineQueueKey(email)) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
};
const writeOfflineQueue = (email: string | null | undefined, q: any[]) => {
  try { localStorage.setItem(offlineQueueKey(email), JSON.stringify(q)); } catch {}
};
const pushOfflineResult = (email: string | null | undefined, result: any) => {
  const q = readOfflineQueue(email);
  const resultId = String(result?.id || "");
  writeOfflineQueue(email, resultId ? [...q.filter((item: any) => String(item?.id || "") !== resultId), result] : [...q, result]);
};
const removeOfflineResult = (email: string | null | undefined, resultId?: string | null) => {
  if (!resultId) return;
  writeOfflineQueue(email, readOfflineQueue(email).filter((item: any) => String(item?.id || "") !== String(resultId)));
};

// Quest submissions are a compound write: the score, the append-only route progress,
// and a possible reward ledger operation must reach Firestore together. Keep a durable
// write-ahead journal until the server transaction confirms it, even when navigator.onLine
// is stale while Wi-Fi is dropping.
const pendingQuestSubmissionsKey = (identity?: string | null) =>
  `ielts_pending_quest_submissions_${stableOfflineIdentity(identity)}`;
const legacyPendingQuestKeys = (identity?: string | null) => Array.from(new Set([
  `ielts_pending_quest_${identity || "anon"}`,
  `ielts_pending_quest_${stableOfflineIdentity(identity)}`,
]));
const parsePendingQuestSubmissions = (raw: string | null): any[] => {
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) return parsed.filter((entry: any) => entry?.result?.id);
    return parsed?.result?.id ? [parsed] : [];
  } catch {
    return [];
  }
};
const dedupePendingQuestSubmissions = (entries: any[]) => {
  const byResultId = new Map<string, any>();
  entries.forEach((entry: any) => {
    const resultId = String(entry?.result?.id || "");
    if (!resultId) return;
    const existing = byResultId.get(resultId);
    // Prefer the new journal record, but retain any field that an older legacy record has.
    byResultId.set(resultId, existing ? { ...existing, ...entry } : entry);
  });
  return Array.from(byResultId.values()).sort((a: any, b: any) => Number(a?.createdAt || 0) - Number(b?.createdAt || 0));
};
const readPendingQuestSubmissions = (identity?: string | null): any[] => {
  try {
    const records = parsePendingQuestSubmissions(localStorage.getItem(pendingQuestSubmissionsKey(identity)));
    legacyPendingQuestKeys(identity).forEach((key) => {
      records.push(...parsePendingQuestSubmissions(localStorage.getItem(key)));
    });
    return dedupePendingQuestSubmissions(records);
  } catch {
    return [];
  }
};
const writePendingQuestSubmissions = (identity: string | null | undefined, entries: any[]) => {
  try {
    const next = dedupePendingQuestSubmissions(entries);
    if (next.length) localStorage.setItem(pendingQuestSubmissionsKey(identity), JSON.stringify(next));
    else localStorage.removeItem(pendingQuestSubmissionsKey(identity));
    return true;
  } catch {
    return false;
  }
};
const enqueuePendingQuestSubmission = (identity: string | null | undefined, entry: any) => {
  const resultId = String(entry?.result?.id || "");
  if (!resultId) return false;
  const current = readPendingQuestSubmissions(identity).filter((item: any) => String(item?.result?.id || "") !== resultId);
  return writePendingQuestSubmissions(identity, [...current, entry]);
};
const clearPendingQuestSubmission = (identity: string | null | undefined, resultId?: string | null) => {
  if (!resultId) return;
  const target = String(resultId);
  writePendingQuestSubmissions(identity, readPendingQuestSubmissions(identity).filter((entry: any) => String(entry?.result?.id || "") !== target));
  legacyPendingQuestKeys(identity).forEach((key) => {
    try {
      const remaining = parsePendingQuestSubmissions(localStorage.getItem(key))
        .filter((entry: any) => String(entry?.result?.id || "") !== target);
      if (!remaining.length) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(remaining));
    } catch {}
  });
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

// Serverless gateways may return a plain-text/HTML error page on a function timeout.
// Never feed that directly to response.json(), or students see a meaningless JSON parser error.
const readApiJson = async (response: Response) => {
    const raw = await response.text();
    let data: any = null;
    const isVi = typeof localStorage !== 'undefined' && (localStorage.getItem('i18nextLng') || '').toLowerCase().startsWith('vi');
    try {
        data = raw ? JSON.parse(raw) : {};
    } catch {
        const isServerFailure = response.status >= 500 || /an error occurred|function invocation|timeout/i.test(raw);
        throw new Error(isServerFailure
            ? (isVi ? "Máy chủ AI mất quá lâu khi xử lý yêu cầu. Vui lòng thử lại sau ít phút." : "AI server timed out while processing your request. Please try again in a few moments.")
            : (isVi ? `Máy chủ AI trả về phản hồi không hợp lệ (HTTP ${response.status || "unknown"}).` : `AI server returned an invalid response (HTTP ${response.status || "unknown"}).`));
    }
    if (!response.ok) {
        throw new Error(String(data?.detail || data?.error || (isVi ? `Máy chủ AI báo lỗi (HTTP ${response.status}).` : `AI server reported an error (HTTP ${response.status}).`)));
    }
    return data;
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

// CHUẨN HÓA MỐC THỜI GIAN KẾT QUẢ THI: Sắp xếp theo đúng thứ tự thời gian thực (Chronological sorting)
export const parseQuizResultDateMs = (rawDate: any, fallbackTimestamp?: any): number => {
    if (typeof fallbackTimestamp === 'number' && Number.isFinite(fallbackTimestamp) && fallbackTimestamp > 0) {
        return fallbackTimestamp;
    }
    if (typeof rawDate === 'number' && Number.isFinite(rawDate) && rawDate > 0) {
        return rawDate;
    }
    const str = String(rawDate || '').trim();
    if (str) {
        // Định dạng phổ biến: "21:37:19 3/7/2026", "3/7/2026", "03/07/2026 21:37:19", "3/7/2026, 21:37:19"
        const dateMatch = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (dateMatch) {
            const day = parseInt(dateMatch[1], 10);
            const month = parseInt(dateMatch[2], 10) - 1;
            const year = parseInt(dateMatch[3], 10);
            const timeMatch = str.match(/(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
            const hours = timeMatch ? parseInt(timeMatch[1], 10) : 0;
            const minutes = timeMatch ? parseInt(timeMatch[2], 10) : 0;
            const seconds = timeMatch && timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
            const dt = new Date(year, month, day, hours, minutes, seconds);
            const t = dt.getTime();
            if (!isNaN(t)) return t;
        }
        const parsed = Date.parse(str);
        if (!isNaN(parsed)) return parsed;
    }
    const fbNum = Number(fallbackTimestamp);
    return Number.isFinite(fbNum) && fbNum > 0 ? fbNum : 0;
};

export const normalizeFolderPath = (rawPath: any): string => {
    if (!rawPath || typeof rawPath !== "string") return "Root";
    const cleaned = rawPath
        .trim()
        .replace(/\\+/g, "/")
        .replace(/\/+/g, "/")
        .replace(/^\/+|\/+$/g, "");
    if (!cleaned || cleaned.toLowerCase() === "root") return "Root";
    if (cleaned.startsWith("Root/")) return cleaned;
    return `Root/${cleaned}`;
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
      eb_cancel_audio_upload: "Cancel upload",
      eb_audio_ready: "Hosted on your site",
      eb_audio_upload_failed: "Audio upload failed",
      eb_audio_hosted_hint: "Upload MP3/M4A/WAV/OGG/FLAC; long audio is transcribed in safe chunks.",
      eb_audio_mode: "AUDIO MODE",
      eb_test_mode: "TEST MODE",
      eb_mode_strict: "Exam (anti-cheat on)",
      eb_mode_practice: "Practice (relaxed)",
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
      eb_cancel_audio_upload: "Hủy tải lên",
      eb_audio_ready: "Đã lưu trên web của bạn",
      eb_audio_upload_failed: "Tải audio lỗi",
      eb_audio_hosted_hint: "Tải MP3/M4A/WAV/OGG/FLAC; audio dài sẽ được tách đoạn an toàn khi tạo transcript.",
      eb_audio_mode: "CHẾ ĐỘ AUDIO",
      eb_test_mode: "CHẾ ĐỘ LÀM BÀI",
      eb_mode_strict: "Thi thật (bật chống gian lận)",
      eb_mode_practice: "Luyện tập (thoải mái)",
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
type TabType = "DASHBOARD" | "CLASSROOM" | "STUDENTS" | "DRIVE" | "EXAM_BUILDER" | "TOPIC_ASSIGNMENTS" | "LIVE_ARENA" | "ACADEMICS" | "FINANCE" | "HISTORY";

const TEACHERS = ["Trương Thanh Trung", "Vi Thị Khánh Linh"];
const SKILLS = ["Reading", "Listening", "Speaking", "Writing", "Grammar & Vocab", "Mock Test"];
const QUICK_NOTES = ["Well done", "Improve pronunciation", "Homework incomplete", "Great reflexes", "Expand vocabulary", "Grammar needs work", "Significant progress"];

// One source of truth for every item that can enter a student's bag. Quest rewards,
// manual teacher grants, and Gacha must all use these exact inventory names.
const CONSUMABLE_GIFT_CATALOG = DEFAULT_GIFT_CATALOG.filter(item => item.kind === "consumable");
const PERMANENT_GIFT_CATALOG = DEFAULT_GIFT_CATALOG.filter(item => item.kind === "permanent");

const isConsumableGiftName = (value: unknown) => CONSUMABLE_GIFT_CATALOG.some(item => item.name === String(value || "").trim());
const isPermanentGiftName = (value: unknown) => PERMANENT_GIFT_CATALOG.some(item => item.name === String(value || "").trim());
const getQuestRewardQuantity = (reward: any) => reward?.rewardType === "permanent_gift"
  ? 1
  : Math.max(1, Math.floor(Number(reward?.rewardQuantity) || 1));
const formatQuestReward = (reward: any) => {
  const type = String(reward?.rewardType || "");
  if (type === "coins") return `${parseQuestCoinReward(reward?.rewardValue)} OS Coins`;
  if (type === "consumable_gift") return `${getQuestRewardQuantity(reward)} × ${String(reward?.rewardValue || "").trim()}`;
  return String(reward?.rewardValue || reward?.description || type).trim();
};

export interface ErrorDnaProfile {
  signature: string;
  updatedAt: number;
  totalAnalyzedAttempts: number;
  totalQuestionsAnalyzed: number;
  typeAccuracy: Array<{ label: string; correct: number; total: number; accuracy: number }>;
  categoryBreakdown: { lexicalGap: number; distractorTrap: number; scopeMisread: number };
  recurringTraps: Array<{ titleVi: string; titleEn: string; detailVi: string; detailEn: string; severity: "high" | "medium" }>;
  actionPlanVi: string[];
  actionPlanEn: string[];
}

interface VocabCard { id: string; word: string; phonetic?: string; pos?: string; meaning?: string; example?: string; cefr?: string; category?: string; evidence?: string; box: number; due: number; createdAt: number; }
interface Student { id: string; name: string; phone: string; rate: number; target: string; cefr: string; exp: number; level: number; email?: string; savedVocabs?: string[]; vocabNotebook?: VocabCard[]; vocabTombstones?: string[]; isPinned?: boolean; privateMessage?: string; dob?: string; coins?: number; myRewards?: string[]; inventory?: { consumables: Record<string, number>; permanents: string[]; revokedPermanents?: string[]; equippedTitle?: string; equippedTheme?: string; equippedFrame?: string; equippedPet?: string; reviewedQuizzes?: string[]; }; lastLoginDate?: string; currentStreak?: number; currentSessionId?: string; sessionClaimedAt?: number; activeExamId?: string; debtMessage?: string; pendingNotifications?: {id: string, title: string, body: string}[]; errorDna?: ErrorDnaProfile; }
interface Rubric { vocab: string; grammar: string; fluency: string; task: string; }
interface Session { id: string | number; studentId: string; studentName: string; teacher: string; skills: string[]; date: string; duration: number; rate: number; earnings: number; notes: string; rubric: Rubric; isPaid: boolean; }
interface ScheduleMaterial { id: string; url: string; label?: string; }
interface Schedule { id: string; date: string; time: string; teacher: string; studentId: string; studentName: string; subject: string; location: string; duration?: number; status?: "PENDING" | "DONE" | "ABSENT"; billed?: boolean; lessonContent?: string; materials?: ScheduleMaterial[]; }
interface SharedLink { id: string; title: string; url: string; date: string; audience: "TEACHERS" | "ALL_STUDENTS" | "SPECIFIC_STUDENT"; targetStudentId: string; targetStudentName: string; }
interface Transaction { id: string; title: string; amount: number; date: string; type: "INCOME" | "EXPENSE"; }
interface SystemLog { id: string; errorType: string; message: string; context?: string; timestamp: string; email?: string; }
interface RewardCode { code: string; studentId: string; studentName: string; item: string; createdAt: number; redeemed: boolean; redeemedAt?: number; redeemedBy?: string; }
interface CoinOperation {
  id: string;
  studentId: string;
  delta: number;
  kind: string;
  createdAt: number;
  consumableName?: string;
  consumableQuantity?: number;
  permanentName?: string;
  inventoryGrants?: { consumables?: Record<string, number>; permanents?: string[] };
  revokedConsumables?: Record<string, number>;
  revokedPermanents?: string[];
  revokedRewards?: string[];
  clearAllInventory?: boolean;
  reviewedQuizId?: string;
  giftSnapshot?: { id?: string; name: string; price: number; details?: string; kind?: "consumable" | "permanent" };
}

const applyCoinOperation = (students: any[], operation: CoinOperation) => {
  if (!Array.isArray(students) || !operation?.studentId) return students;
  return students.map(student => {
    if (String(student?.id || "") !== String(operation.studentId)) return student;
    const inventory = student.inventory || {};
    let consumables: Record<string, number> = { ...(inventory.consumables || {}) };
    let permanents: string[] = Array.isArray(inventory.permanents) ? [...inventory.permanents] : [];
    const revokedPermSet = new Set<string>(Array.isArray(inventory.revokedPermanents) ? inventory.revokedPermanents.map((x: any) => String(x || "").trim()).filter(Boolean) : []);
    let myRewards: string[] = Array.isArray(student.myRewards) ? [...student.myRewards] : [];
    let equippedTitle = inventory.equippedTitle;
    let equippedTheme = inventory.equippedTheme;
    let equippedFrame = inventory.equippedFrame;
    let equippedPet = inventory.equippedPet;

    if (operation.clearAllInventory) {
      permanents.forEach(p => { if (p) revokedPermSet.add(p); });
      consumables = {};
      permanents = [];
      myRewards = [];
      equippedTitle = "";
      equippedTheme = "";
      equippedFrame = "";
      equippedPet = "";
    }

    const consumableGrants: Record<string, number> = { ...(operation.inventoryGrants?.consumables || {}) };
    if (operation.consumableName) {
      consumableGrants[operation.consumableName] = (Number(consumableGrants[operation.consumableName]) || 0)
        + Math.max(1, Math.floor(Number(operation.consumableQuantity) || 1));
    }
    Object.entries(consumableGrants).forEach(([name, quantity]) => {
      const count = Math.max(0, Math.floor(Number(quantity) || 0));
      if (name && count) consumables[name] = (Number(consumables[name]) || 0) + count;
    });

    if (operation.revokedConsumables) {
      Object.entries(operation.revokedConsumables).forEach(([name, count]) => {
        const deduct = Math.max(0, Math.floor(Number(count) || 0));
        if (!name || !deduct) return;
        const nextVal = (Number(consumables[name]) || 0) - deduct;
        if (nextVal <= 0) delete consumables[name];
        else consumables[name] = nextVal;
      });
    }

    const permanentGrants = Array.from(new Set([
      ...(Array.isArray(operation.inventoryGrants?.permanents) ? operation.inventoryGrants!.permanents : []),
      ...(operation.permanentName ? [operation.permanentName] : []),
    ].map(name => String(name || "").trim()).filter(Boolean)));
    permanentGrants.forEach(name => {
      revokedPermSet.delete(name);
      if (!permanents.includes(name)) permanents.push(name);
    });

    if (Array.isArray(operation.revokedPermanents) && operation.revokedPermanents.length > 0) {
      const toRevoke = new Set(operation.revokedPermanents.map(x => String(x || "").trim()).filter(Boolean));
      toRevoke.forEach(item => revokedPermSet.add(item));
      permanents = permanents.filter(item => !toRevoke.has(String(item || "").trim()));
      toRevoke.forEach(item => {
        const strippedTitle = item.replace(/^Danh hiệu:\s*/i, "").trim();
        if (equippedTitle && (equippedTitle === item || equippedTitle === strippedTitle)) equippedTitle = "";
        if (equippedTheme && equippedTheme === item) equippedTheme = "";
        if (equippedFrame && equippedFrame === item) equippedFrame = "";
        if (equippedPet && equippedPet === item) equippedPet = "";
      });
    }

    if (Array.isArray(operation.revokedRewards) && operation.revokedRewards.length > 0) {
      const idxToRemove = new Set<number>();
      const valToRemove = new Set<string>();
      operation.revokedRewards.forEach(r => {
        const s = String(r || "");
        if (s.startsWith("__INDEX__:")) {
          const idx = Number(s.slice("__INDEX__:".length));
          if (Number.isInteger(idx) && idx >= 0) idxToRemove.add(idx);
        } else if (s) {
          valToRemove.add(s);
        }
      });
      myRewards = myRewards.filter((item, idx) => !idxToRemove.has(idx) && !valToRemove.has(String(item || "")));
    }

    const reviewedQuizzes = Array.isArray(inventory.reviewedQuizzes) ? [...inventory.reviewedQuizzes] : [];
    if (operation.reviewedQuizId && !reviewedQuizzes.includes(operation.reviewedQuizId)) reviewedQuizzes.push(operation.reviewedQuizId);
    return {
      ...student,
      coins: Math.max(0, (Number(student.coins) || 0) + Number(operation.delta || 0)),
      myRewards,
      inventory: {
        ...inventory,
        consumables,
        permanents,
        revokedPermanents: Array.from(revokedPermSet),
        equippedTitle,
        equippedTheme,
        equippedFrame,
        equippedPet,
        reviewedQuizzes,
      },
    };
  });
};

type QuestionType = "CHOICE" | "BLANK" | "CHOICE_MULTIPLE" | "MATCHING" | "DRAG_DROP" | "DRAG_DROP_HEADING" | "SHORT_ANSWER" | "MAP_DRAG" | "DIAGRAM_LABEL" | "WRITING";
interface MapDragSlot { questionNumber: number; x: number; y: number; width?: number; height?: number; }
interface DiagramLabelBox extends MapDragSlot { targetX?: number; targetY?: number; html?: string; }
interface ManualExplanationTimestamp { startTime: number; endTime?: number; label: string; }
interface ManualExplanation { rawText: string; parsedQuotes: string[]; parsedTimestamps: ManualExplanationTimestamp[]; }
interface DiagramTextBox {
  id: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  targetX?: number;
  targetY?: number;
  text: string;
  anchor?: "top-left" | "center";
}
interface RealExamPackage { id: string; title: string; active: boolean; mode: "LR" | "LRW"; quizIds: string[]; passcode?: string; audience?: "ALL" | "SPECIFIC"; targetStudentIds?: string[]; scheduledStart?: string; scheduledEnd?: string; maxAttempts?: number; createdAt?: number; updatedAt?: number; }
interface RealExamContext { packageId: string; packageTitle: string; packageQuizIds: string[]; packageAttemptId: string; testTakerId: string; orderIndex: number; total: number; isFinal: boolean; }
interface RealExamSession { packageId: string; packageAttemptId: string; testTakerId: string; completedQuizIds: string[]; startedAt: number; }
interface RealExamInstructionGate { packageId: string; quizId: string; skill: "Listening" | "Reading" | "Writing"; videoUrl: string; ready: boolean; nonce: number; currentTime?: number; duration?: number; }
interface QuizQuestion { id: string; questionNumber?: number; type: QuestionType; subType?: string; categoryId?: string; instruction?: string; groupContext?: string; leftTitle?: string; rightTitle?: string; text: string; options?: string[]; correctAnswer: string | number | number[]; passageIndex?: number; mapImageUrl?: string; mapSlots?: Record<string, MapDragSlot>; diagramImageUrl?: string; diagramImageMode?: "BOXES" | "OVERLAY" | "TEXT_BOXES"; diagramImageAspectRatio?: string; diagramMaxWidth?: string | number; diagramImageBounds?: { x?: number; y?: number; width?: number; height?: number }; diagramBoxes?: Record<string, DiagramLabelBox>; diagramTextBoxes?: DiagramTextBox[]; manualExplanation?: ManualExplanation; aiExplanation?: string; }
interface QuizSection { passage: string; questions: QuizQuestion[]; }
interface Quiz { _activePassageTab?: number; _showSettings?: boolean; updatedAt?: number; revision?: number; id: string; title: string; type: "Reading" | "Listening" | "Writing" | "Integrated" | string; timeLimit: number; maxAttempts: number; questions: QuizQuestion[]; sections?: QuizSection[]; writingTasks?: WritingTaskDefinition[]; active: boolean; passage?: string; transcript?: string; images?: string[]; audioUrl?: string; audioMode?: 'strict' | 'practice'; practiceMode?: boolean; deliveryMode?: DeliveryMode; examPolicy?: StoredExamPolicy; pipelineValidation?: { state?: string; status?: string; jobId?: string; roundTripState?: string }; audience?: "ALL" | "SPECIFIC"; targetStudentIds?: string[]; scheduledStart?: string; scheduledEnd?: string; passcode?: string; internalNote?: string; tag?: string; isSEBRequired?: boolean; folder?: string; questContext?: QuestLaunchContext; realExamContext?: RealExamContext; allowWritingSandbox?: boolean; }
interface ExamDocxBatchItem { id: string; file: File; targetFolder: string; status: "parsing" | "ready" | "error"; quiz?: Quiz; catalogQuiz?: Quiz; error?: string; }
interface AiGenerationBatchState {
  batch_id: string;
  status: string;
  upload_kind?: "DIRECT";
  updatedAt?: number;
  delivery_mode: DeliveryMode;
  publication_policy: "draft" | "publish_when_ready";
  totalCount?: number;
  completedCount?: number;
  current_pipeline_version?: string;
  results: Array<{
    index?: number;
    row_id?: string;
    original_filename: string;
    status: string;
    detected_skill?: string;
    question_count?: number;
    solved_count?: number;
    explanation_count?: number;
    validation_state?: string;
    repair_count?: number;
    round_trip_state?: string;
    media_count?: number;
    media_round_trip_state?: string;
    docx_job_id?: string;
    error?: string;
    publish_error?: string;
    can_retry?: boolean;
    can_reprocess?: boolean;
    reclaimable?: boolean;
    pipeline_version?: string;
    structure_state?: string;
    source_coverage?: { state?: string; total?: number; by_state?: Record<string, number>; percentage?: number };
    diagnostics?: Array<{ severity?: string; code?: string; stage?: string; question_number?: number; block_id?: string; block_ids?: string[]; group_id?: string; scope?: string; occurrence_id?: string; message?: string; details?: string; retryable?: boolean; recovery_attempted?: boolean | string[]; remaining_reason?: string }>;
    progress?: { stage?: string; scope?: string; group_id?: string; block_id?: string; question_total?: number; question_completed?: number; question_failed?: number; question_number?: number; repair_attempt?: number; retryCount?: number; updatedAt?: number };
  }>;
}

const manualTimestampToSeconds = (value: any) => {
  const units = String(value || "").match(/\d{1,2}:\d{2}(?::\d{2})?/)?.[0]?.split(":").map(Number) || [];
  return units.length === 3 ? units[0] * 3600 + units[1] * 60 + units[2] : units.length === 2 ? units[0] * 60 + units[1] : 0;
};

const TIMESTAMP_TOKEN_RE = /\[(\d{1,2}:\d{2}(?::\d{2})?)(?:\s*(?:[-–—−~]|to)\s*(\d{1,2}:\d{2}(?::\d{2})?))?\]/gi;

const parseManualExplanation = (value: any): ManualExplanation | undefined => {
  const rawSource = typeof value === "object" && value ? value.rawText : value;
  const rawClean = String(rawSource || "")
    .replace(/^\s*\[EXPLANATION\]\s*/i, "")
    .replace(/^\s*\d+(?:\s*(?:[-–—]|,)\s*\d+)*\s*[:.)-]\s*/, "");
  // Normalize horizontal whitespace [ \t]+ to single space, normalize newlines, preserve \n\n
  const rawText = rawClean
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map(line => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
  if (!rawText) return undefined;
  const parsedQuotes = Array.from(new Set(Array.from(rawText.matchAll(/"([^"]+)"/g))
    .map(match => match[1].replace(/\s+/g, " ").trim())
    .filter(Boolean)));
  const freshTimestamps: ManualExplanationTimestamp[] = Array.from(rawText.matchAll(TIMESTAMP_TOKEN_RE))
    .map(match => {
      const startTime = manualTimestampToSeconds(match[1]);
      const endTime = match[2] ? manualTimestampToSeconds(match[2]) : undefined;
      const label = match[2] ? `${match[1]} - ${match[2]}` : match[1];
      return endTime === undefined ? { startTime, label } : { startTime, endTime, label };
    });
  const existingTimestamps: ManualExplanationTimestamp[] = (typeof value === "object" && value && Array.isArray(value.parsedTimestamps))
    ? value.parsedTimestamps
        .filter((ts: any) => ts && typeof ts.startTime === "number" && !isNaN(ts.startTime))
        .map((ts: any) => ({
          startTime: ts.startTime,
          ...(ts.endTime !== undefined && !isNaN(ts.endTime) ? { endTime: ts.endTime } : {}),
          label: String(ts.label || (ts.endTime !== undefined ? `${ts.startTime} - ${ts.endTime}` : `${ts.startTime}`)),
        }))
    : [];
  const combined = [...freshTimestamps, ...existingTimestamps];
  const parsedTimestamps = combined.filter((item, index, all) =>
    all.findIndex(other => other.startTime === item.startTime && other.endTime === item.endTime) === index
  );
  return { rawText, parsedQuotes, parsedTimestamps };
};

const normalizeQuestionManualExplanation = (question: any) => {
  if (!question) return question;
  const next = { ...question };
  const manual = parseManualExplanation(next.manualExplanation);
  if (manual) next.manualExplanation = manual;
  else delete next.manualExplanation;
  return next;
};

const normalizeQuizManualExplanations = (quiz: any) => {
  if (!quiz) return quiz;
  const questions = Array.isArray(quiz.questions) ? quiz.questions.map(normalizeQuestionManualExplanation) : [];
  const byId = new Map(questions.map((question: any) => [String(question.id), question]));
  const sections = Array.isArray(quiz.sections)
    ? quiz.sections.map((section: any) => ({
        ...section,
        questions: Array.isArray(section.questions)
          ? section.questions.map((question: any) => byId.get(String(question.id)) || normalizeQuestionManualExplanation(question))
          : [],
      }))
    : quiz.sections;
  return { ...quiz, questions, sections };
};

const stripQuestionExplanationFields = (question: any) => {
  if (!question) return question;
  const { manualExplanation, aiExplanation, ...safeQuestion } = question;
  return safeQuestion;
};

const stripExamExplanations = (quiz: any): Quiz => {
  if (!quiz) return quiz;
  return {
    ...quiz,
    questions: Array.isArray(quiz.questions) ? quiz.questions.map(stripQuestionExplanationFields) : [],
    sections: Array.isArray(quiz.sections)
      ? quiz.sections.map((section: any) => ({
          ...section,
          questions: Array.isArray(section.questions) ? section.questions.map(stripQuestionExplanationFields) : [],
        }))
      : quiz.sections,
  };
};

const restoreReviewExplanations = (runtimeQuiz: any, sourceQuiz: any): Quiz => {
  if (!runtimeQuiz) return runtimeQuiz;
  const normalizedSource = normalizeQuizManualExplanations(sourceQuiz || runtimeQuiz);
  const byId = new Map<string, any>((normalizedSource.questions || []).map((question: any) => [String(question.id), question]));
  const restoreQuestion = (question: any) => {
    if (!question) return question;
    const source = byId.get(String(question.id));
    if (!source) return normalizeQuestionManualExplanation(question);
    const next = normalizeQuestionManualExplanation({ ...question, manualExplanation: source.manualExplanation });
    if (source.aiExplanation) next.aiExplanation = source.aiExplanation;
    return next;
  };
  return {
    ...runtimeQuiz,
    questions: Array.isArray(runtimeQuiz.questions) ? runtimeQuiz.questions.map(restoreQuestion) : [],
    sections: Array.isArray(runtimeQuiz.sections)
      ? runtimeQuiz.sections.map((section: any) => ({
          ...section,
          questions: Array.isArray(section.questions) ? section.questions.map(restoreQuestion) : [],
        }))
      : runtimeQuiz.sections,
  };
};

const quizSectionsForPatch = (quiz: any) => {
  if (Array.isArray(quiz?.sections) && quiz.sections.length) {
    return quiz.sections.map((section: any) => ({
      ...section,
      passage: section?.passage || "",
      questions: Array.isArray(section?.questions) ? section.questions.map((question: any) => ({ ...question })) : [],
    }));
  }
  return [{
    passage: quiz?.passage || "",
    questions: Array.isArray(quiz?.questions) ? quiz.questions.map((question: any) => ({ ...question, passageIndex: 0 })) : [],
  }];
};

const rebuildQuizFromSections = (quiz: any, sections: any[]) => {
  const normalizedSections = sections.map((section: any, sectionIndex: number) => ({
    ...section,
    passage: section?.passage || "",
    questions: (Array.isArray(section?.questions) ? section.questions : []).map((question: any) =>
      normalizeQuestionManualExplanation({ ...question, passageIndex: sectionIndex })
    ),
  }));
  return normalizeQuizManualExplanations({
    ...quiz,
    passage: normalizedSections[0]?.passage || "",
    sections: normalizedSections,
    questions: normalizedSections.flatMap((section: any) => section.questions || []),
  });
};

const mergeQuizSectionsFromSupplement = (baseQuiz: any, supplementQuiz: any, startSectionIndex = 0) => {
  const baseSections = quizSectionsForPatch(baseQuiz);
  const patchSections = quizSectionsForPatch(supplementQuiz).filter((section: any) =>
    String(section?.passage || "").trim() || (Array.isArray(section?.questions) && section.questions.length)
  );
  if (!patchSections.length) return { quiz: baseQuiz, replaced: 0 };
  const start = Math.max(0, Math.min(Number(startSectionIndex) || 0, Math.max(0, baseSections.length - 1)));
  patchSections.forEach((section: any, offset: number) => {
    const targetIndex = start + offset;
    while (baseSections.length <= targetIndex) baseSections.push({ passage: "", questions: [] });
    baseSections[targetIndex] = {
      ...section,
      passage: section?.passage || "",
      questions: (section?.questions || []).map((question: any) => ({
        ...question,
        id: question.id || `q_${Date.now()}_${targetIndex}_${offset}_${Math.random().toString(36).slice(2)}`,
        passageIndex: targetIndex,
      })),
    };
  });
  return { quiz: rebuildQuizFromSections(baseQuiz, baseSections), replaced: patchSections.length };
};

const manualExplanationMapFromSupplement = (payload: any) => {
  const map = new Map<string, ManualExplanation>();
  Object.entries(payload?.explanations || {}).forEach(([number, value]) => {
    const manual = parseManualExplanation(value);
    if (manual) map.set(String(number), manual);
  });
  const questions = Array.isArray(payload?.quiz?.questions)
    ? payload.quiz.questions
    : (Array.isArray(payload?.questions) ? payload.questions : []);
  questions.forEach((question: any, index: number) => {
    const manual = parseManualExplanation(question?.manualExplanation);
    const number = String(question?.questionNumber || index + 1);
    if (manual) map.set(number, manual);
  });
  return map;
};

const mergeQuizManualExplanationsFromSupplement = (baseQuiz: any, supplementPayload: any) => {
  const explanationByNumber = manualExplanationMapFromSupplement(supplementPayload);
  if (!explanationByNumber.size) return { quiz: baseQuiz, imported: 0 };
  const normalized = normalizeQuizManualExplanations(JSON.parse(JSON.stringify(baseQuiz)));
  let imported = 0;
  const questions = (normalized.questions || []).map((question: any, index: number) => {
    const number = String(question?.questionNumber || index + 1);
    const manual = explanationByNumber.get(number);
    if (!manual) return question;
    imported += 1;
    return { ...question, manualExplanation: manual };
  });
  const byId = new Map<string, any>(questions.map((question: any) => [String(question.id), question]));
  const sections = Array.isArray(normalized.sections)
    ? normalized.sections.map((section: any) => ({
        ...section,
        questions: (section.questions || []).map((question: any) => byId.get(String(question.id)) || question),
      }))
    : normalized.sections;
  return { quiz: normalizeQuizManualExplanations({ ...normalized, questions, sections }), imported };
};

const isPracticeQuiz = (quiz: Pick<Quiz, 'type' | 'audioMode' | 'practiceMode' | 'deliveryMode' | 'examPolicy' | 'maxAttempts' | 'isSEBRequired'> | null | undefined) =>
  getDeliveryMode(quiz) === 'practice';
const shouldDelayListeningExamTimer = (quiz: Pick<Quiz, 'type' | 'audioUrl' | 'audioMode' | 'practiceMode' | 'deliveryMode' | 'examPolicy' | 'maxAttempts' | 'isSEBRequired'> | null | undefined, isPreviewMode = false) =>
  !!quiz?.audioUrl
  && !isPreviewMode
  && !isPracticeQuiz(quiz)
  && String(quiz.type || "").toLowerCase().includes("listen");
interface WritingCriterionScore { taskAchievement?: number; coherence?: number; lexical?: number; grammar?: number; overall?: number; }
interface WritingComment {
  id: string; taskId: string; anchorQuote?: string; comment: string; createdAt: number;
  startOffset?: number; endOffset?: number;
  criterion?: 'TA_TR' | 'CC' | 'LR' | 'GRA';
  category?: 'error' | 'awkward' | 'upgrade' | 'praise';
  replacement?: string;
  highBandRewrite?: string;
  tags?: string[];
}
interface WritingGrading {
  status: "awaiting_grading" | "draft" | "published";
  taskScores: Record<string, WritingCriterionScore>;
  correctedAnswers: Record<string, string>;
  comments: WritingComment[];
  finalBand?: number;
  updatedAt?: number;
  publishedAt?: number;
  publishedBy?: string;
  sampleAnswers?: Record<string, string>;
  sampleEssay?: string;
  taskBottlenecks?: Record<string, string[]>;
  taskStrengths?: Record<string, string[]>;
  criteriaNotes?: Record<string, Record<string, string>>;
  generalFeedback?: string;
  task1Band?: number;
  task2Band?: number;
  overallBand?: number;
  bottlenecks?: string[];
  strengths?: string[];
}
interface QuizResult { id: string; quizId: string; quizTitle: string; studentId: string; studentName: string; date: string; score: number; total: number; band: number | string; cheatCount: number; submittedAt?: number; submissionId?: string; startTime?: string; endTime?: string; durationSeconds?: number; deviceInfo?: string; ipAddress?: string; teacherFeedback?: string; writingScores?: Record<string, string | number>; writingGrading?: WritingGrading; answers: Record<string, any>; scratchpad?: string; flaggedQuestions?: string[]; isRead?: boolean; topicAssignmentId?: string; topicNodeId?: string; questPassed?: boolean; questQuestionIds?: string[]; hiddenFromStudent?: boolean; realExamPackageId?: string; realExamPackageTitle?: string; realExamAttemptId?: string; realExamOrderIndex?: number; testTakerId?: string; }
interface QuestStatusNotice { kind: "passed" | "failed" | "changed"; score?: number; total?: number; percentage?: number; threshold?: number; rewards?: string[]; pendingSync?: boolean; }

const normalizeChoiceMultipleIndexes = (value: any): number[] => {
  const raw = Array.isArray(value) ? value : (value === undefined || value === null || value === "" ? [] : [value]);
  return Array.from(new Set(raw.map(Number).filter(Number.isInteger)));
};

// A "choose TWO/THREE" item is sometimes stored as consecutive CHOICE_MULTIPLE
// records with one shared option bank. They are one response set, not independent
// questions whose answers should be paired in click order.
const getQuizScoringGroups = (questions: any[] = []) => {
  const groups: { questions: any[]; isChoiceMultiple: boolean }[] = [];
  for (let index = 0; index < questions.length; index++) {
    const question = questions[index];
    if (question?.type !== "CHOICE_MULTIPLE") {
      groups.push({ questions: [question], isChoiceMultiple: false });
      continue;
    }
    const grouped = [question];
    let cursor = index + 1;
    const optionKey = JSON.stringify(question.options || []);
    const passageKey = question.passageIndex ?? null;
    while (
      cursor < questions.length
      && questions[cursor]?.type === "CHOICE_MULTIPLE"
      && JSON.stringify(questions[cursor].options || []) === optionKey
      && (questions[cursor].passageIndex ?? null) === passageKey
    ) {
      grouped.push(questions[cursor]);
      cursor++;
    }
    groups.push({ questions: grouped, isChoiceMultiple: true });
    index = cursor - 1;
  }
  return groups;
};

const getChoiceMultipleOutcome = (questions: any[], answers: Record<string, any> = {}) => {
  const correct = Array.from(new Set(questions.flatMap(question => normalizeChoiceMultipleIndexes(question?.correctAnswer))));
  const selected = Array.from(new Set(questions.flatMap(question => normalizeChoiceMultipleIndexes(answers?.[question?.id]))));
  const total = Math.max(1, correct.length);
  const selectedCorrectly = selected.filter(index => correct.includes(index));
  const selectedIncorrectly = selected.filter(index => !correct.includes(index));
  const missing = correct.filter(index => !selected.includes(index));
  // The exam UI caps selections at the requested number. Treat tampered/legacy
  // over-selections as invalid rather than allowing a learner to tick every option.
  const score = selected.length > total ? 0 : selectedCorrectly.length;
  return {
    correct,
    selected,
    selectedCorrectly,
    selectedIncorrectly,
    missing,
    total,
    score,
    skipped: Math.max(0, total - selected.length),
    isFullyCorrect: score === total && selectedIncorrectly.length === 0,
  };
};

const normalizeAnswerSpacing = (value: any) => String(value ?? "")
  .replace(/<[^>]+>/g, " ")
  .replace(/&(?:nbsp|ensp|emsp|thinsp);/gi, " ")
  .replace(/&#(?:160|8194|8195|8201|8239);/g, " ")
  .replace(/[\u200B-\u200D\uFEFF\u2060]/g, "")
  .replace(/[\u00A0\u1680\u180E\u2000-\u200A\u202F\u205F\u3000]/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const cleanOptionAnswerText = (value: any) => normalizeAnswerSpacing(value)
  .replace(/^\s*[A-Ka-k][.)]\s*(?=\S)/, "")
  .replace(/^\s*[A-Ka-k]\s+(?=\S)/, "")
  .trim()
  || normalizeAnswerSpacing(value).replace(/[.)]$/, "").trim();

const normalizeComparableAnswer = (value: any) => cleanOptionAnswerText(value).toLocaleLowerCase();

const matchingOptionLabel = (option: any, index: number) => {
  const raw = String(option ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
  const explicit = raw.match(/^\s*([A-Ka-k])(?:[.)]\s*|\s+|$)/)?.[1];
  return (explicit || String.fromCharCode(65 + index)).toUpperCase();
};

const isMatchingInfoOptionSet = (options: any[] = []) =>
  options.length > 0 && options.every(option => /^[A-Ka-k][.)]?$/.test(String(option ?? "").trim()));

const matchingOptionValue = (option: any, index: number, infoGrid = false) => {
  const label = matchingOptionLabel(option, index);
  const text = cleanOptionAnswerText(option);
  return infoGrid ? label : (text || label);
};

const resolveOptionAnswerText = (question: any, value: any) => {
  const raw = String(value ?? "").trim();
  const options = Array.isArray(question?.options) ? question.options : [];
  if (!raw) return raw;
  const numeric = /^\d+$/.test(raw) ? Number(raw) : -1;
  if (options.length && numeric >= 0 && numeric < options.length) return cleanOptionAnswerText(options[numeric]);
  if (/^[A-Z]$/i.test(raw)) {
    const index = raw.toUpperCase().charCodeAt(0) - 65;
    if (options.length && index >= 0 && index < options.length) return cleanOptionAnswerText(options[index]);
  }
  const cleaned = cleanOptionAnswerText(raw);
  const match = options
    .map((option: any) => cleanOptionAnswerText(option))
    .find((optionText: string) => normalizeComparableAnswer(optionText) === normalizeComparableAnswer(cleaned));
  return match || cleaned;
};

const resolveDragAnswerText = (question: any, value: any) => {
  const raw = String(value ?? "").trim();
  const options = Array.isArray(question?.options) ? question.options : [];
  if (!raw || !options.length) return cleanOptionAnswerText(raw);
  return resolveOptionAnswerText(question, value);
};

const resolveMatchingAnswerText = (question: any, value: any) => {
  return resolveOptionAnswerText(question, value);
};

const isSingleQuestionCorrect = (question: any, answer: any) => {
  if (question?.type === "CHOICE") return answer === question.correctAnswer;
  if (question?.type === "MATCHING") {
    return normalizeComparableAnswer(resolveMatchingAnswerText(question, answer)) === normalizeComparableAnswer(resolveMatchingAnswerText(question, question.correctAnswer));
  }
  if (question?.type === "DRAG_DROP_HEADING") {
    const submittedId = normalizeHeadingId(answer);
    const expectedId = normalizeHeadingId(question.correctAnswer);
    const idMatches = Boolean(submittedId && expectedId && submittedId === expectedId);
    const submittedText = resolveHeadingAnswerText(question, answer);
    const expectedText = resolveHeadingAnswerText(question, question.correctAnswer);
    return idMatches || (Boolean(submittedText) && normalizeComparableAnswer(submittedText) === normalizeComparableAnswer(expectedText));
  }
  const isDrag = /^(?:DRAG_DROP|MAP_DRAG|FLOW_DRAG)$/i.test(String(question?.type || ""));
  const submitted = isDrag ? resolveDragAnswerText(question, answer) : String(answer ?? "");
  return String(question?.correctAnswer).split("/").map(value => {
    const candidate = isDrag ? resolveDragAnswerText(question, value) : value;
    return String(candidate).trim().toLowerCase();
  }).includes(String(submitted).trim().toLowerCase());
};

const getQuizScoreSummary = (quizOrQuestions: any, answers: Record<string, any> = {}) => {
  const questions = (Array.isArray(quizOrQuestions) ? quizOrQuestions : (quizOrQuestions?.questions || []))
    .filter((question: any) => String(question?.type || "").toUpperCase() !== "WRITING");
  let score = 0;
  let total = 0;
  let skipped = 0;
  const groups = getQuizScoringGroups(questions).map(group => {
    if (group.isChoiceMultiple) {
      const multiple = getChoiceMultipleOutcome(group.questions, answers);
      score += multiple.score;
      total += multiple.total;
      skipped += multiple.skipped;
      return { ...group, score: multiple.score, total: multiple.total, skipped: multiple.skipped, isFullyCorrect: multiple.isFullyCorrect, multiple };
    }
    const question = group.questions[0];
    const answer = answers?.[question?.id];
    const hasAnswer = !(answer === undefined || answer === null || answer === "" || (Array.isArray(answer) && answer.length === 0));
    const isCorrect = hasAnswer && isSingleQuestionCorrect(question, answer);
    score += isCorrect ? 1 : 0;
    total += 1;
    skipped += hasAnswer ? 0 : 1;
    return { ...group, score: isCorrect ? 1 : 0, total: 1, skipped: hasAnswer ? 0 : 1, isFullyCorrect: isCorrect, multiple: null };
  });
  return { score, total, skipped, incorrect: Math.max(0, total - score - skipped), groups };
};

const getQuestionPointCount = (q: any) =>
  q?.type === "CHOICE_MULTIPLE" && Array.isArray(q.correctAnswer)
    ? Math.max(1, q.correctAnswer.length)
    : 1;

const getQuizPointTotal = (quiz: any) =>
  getQuizScoreSummary(quiz, {}).total;

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

const toRomanNumeral = (value: number) => {
  let number = Math.max(1, Math.floor(Number(value) || 1));
  const lookup: Array<[number, string]> = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
  let result = "";
  lookup.forEach(([unit, roman]) => {
    while (number >= unit) { result += roman; number -= unit; }
  });
  return result;
};

const normalizeHeadingId = (value: any) => String(value ?? "")
  .trim()
  .replace(/^\s*([ivxlcdm]+)[.)]?(?:\s+.*)?$/i, "$1")
  .toLowerCase();

const headingPlainText = (value: any) => String(value ?? "")
  .replace(/<[^>]*>/g, " ")
  .replace(/&nbsp;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/\s+/g, " ")
  .trim();

const getHeadingOptionMeta = (option: any, index: number) => {
  // Heading imports have evolved through several schemas. Keep the identifier
  // separate from the human label so `{ id: 0, text: 'i', label: '...' }`
  // cannot degrade to just `i` once it is placed in a passage slot.
  const fields = typeof option === "string"
    ? [option]
    : [
      option?.label, option?.heading, option?.title, option?.content,
      option?.description, option?.name, option?.value, option?.text,
      option?.headingText, option?.displayText, option?.labelText, option?.answerText,
      option?.roman, option?.key, option?.code,
    ];
  const candidates = fields
    .filter((value) => value !== null && value !== undefined)
    .map(headingPlainText)
    .filter(Boolean);
  const codedCandidate = candidates.find((candidate) => /^\s*[ivxlcdm]+(?:[.)]\s*|\s+)/i.test(candidate));
  const codeMatch = codedCandidate?.match(/^\s*([ivxlcdm]+)(?:[.)]\s*|\s+)(.*)$/i);
  const explicitId = [option?.roman, option?.key, option?.code, option?.id]
    .map((value) => String(value ?? "").trim())
    .find((value) => /^[ivxlcdm]+$/i.test(value));
  const label = candidates
    .map((candidate) => candidate.replace(/^\s*[ivxlcdm]+(?:[.)]\s*|\s+)/i, "").trim())
    .filter((candidate) => candidate && !/^[ivxlcdm]+$/i.test(candidate))
    .reduce((best, candidate) => candidate.length > best.length ? candidate : best, "");
  return {
    id: normalizeHeadingId(codeMatch?.[1] || explicitId || toRomanNumeral(index + 1)),
    text: label || codeMatch?.[2] || "",
  };
};

const getHeadingCatalog = (questions: any[] = []) => {
  const catalog = new Map<string, { id: string; text: string }>();
  questions.forEach((question: any) => {
    const optionLists = [
      question?.options, question?.headingOptions, question?.headings,
      question?.metadata?.headingOptions, question?.metadata?.headings,
      question?.headingMap && Object.entries(question.headingMap).map(([id, text]) => ({ id, text })),
      question?.metadata?.headingMap && Object.entries(question.metadata.headingMap).map(([id, text]) => ({ id, text })),
    ];
    optionLists.forEach((options: any) => {
      if (!Array.isArray(options)) return;
      options.forEach((option: any, index: number) => {
        const meta = getHeadingOptionMeta(option, index);
        const prior = catalog.get(meta.id);
        if (!prior || meta.text.length > prior.text.length) catalog.set(meta.id, meta);
      });
    });
  });
  return catalog;
};

const stripHeadingPrefix = (value: any) => headingPlainText(value)
  .replace(/^\s*[ivxlcdm]+[.)]?\s*/i, "")
  .trim();

const resolveHeadingAnswerMeta = (question: any, value: any) => {
  const raw = headingPlainText(value);
  const catalog = getHeadingCatalog([question]);
  const id = normalizeHeadingId(raw);
  const byId = catalog.get(id);
  if (byId) return byId;
  const plain = stripHeadingPrefix(raw);
  const byText = Array.from(catalog.values()).find(heading =>
    normalizeComparableAnswer(stripHeadingPrefix(heading.text)) === normalizeComparableAnswer(plain)
  );
  if (byText) return byText;
  return { id: /^[ivxlcdm]+$/i.test(id) ? id : "", text: plain || raw };
};

const resolveHeadingAnswerText = (question: any, value: any) =>
  resolveHeadingAnswerMeta(question, value).text || stripHeadingPrefix(value);

const getDiagramQuestionNumber = (question: any, index: number, allQuestions: any[] = []) =>
  String(question?.text || "").match(/\[(\d+)\]/)?.[1]
  || String(getQuizQuestionNumber(allQuestions, question?.id) || index + 1);

const getDiagramTextBoxes = (questions: any[] = [], allQuestions: any[] = []): DiagramTextBox[] => {
  const source = questions[0] || {};
  if (Array.isArray(source.diagramTextBoxes) && source.diagramTextBoxes.length) {
    return source.diagramTextBoxes.map((box: any, index: number) => ({
      id: String(box?.id || `diagram-box-${index + 1}`),
      x: Number(box?.x) || 0,
      y: Number(box?.y) || 0,
      width: Number(box?.width) || 26,
      height: Number(box?.height) || 16,
      targetX: Number.isFinite(Number(box?.targetX)) ? Number(box.targetX) : undefined,
      targetY: Number.isFinite(Number(box?.targetY)) ? Number(box.targetY) : undefined,
      text: String(box?.text ?? box?.html ?? ""),
      anchor: box?.anchor === "center" ? "center" : "top-left",
    }));
  }
  const legacy = source.diagramBoxes || {};
  return Object.entries(legacy).map(([number, rawBox]: [string, any], index: number) => {
    const question = questions.find((item: any, itemIndex: number) => getDiagramQuestionNumber(item, itemIndex, allQuestions) === number);
    return {
      id: `diagram-box-${number || index + 1}`,
      x: Number(rawBox?.x) || 0,
      y: Number(rawBox?.y) || 0,
      width: Number(rawBox?.width) || 27,
      height: Number(rawBox?.height) || 16,
      targetX: Number.isFinite(Number(rawBox?.targetX)) ? Number(rawBox.targetX) : undefined,
      targetY: Number.isFinite(Number(rawBox?.targetY)) ? Number(rawBox.targetY) : undefined,
      text: String(rawBox?.html || question?.text || `[${number}]`),
      anchor: "center",
    };
  });
};

const getDiagramGapWidth = (question: any) => {
  const variants = Array.isArray(question?.correctAnswer)
    ? question.correctAnswer
    : String(question?.correctAnswer ?? "").split("/");
  const maxLength = variants.reduce((max: number, answer: any) => Math.max(max, String(answer || "").trim().length), 0);
  return `${Math.min(28, Math.max(8, maxLength + 3))}ch`;
};

const getChoiceMultipleScore = (q: any, studentAns: any) => {
  return getChoiceMultipleOutcome([q], { [q.id]: studentAns }).score;
};
interface LiveSession { id: string; studentId: string; studentName: string; quizId: string; quizTitle: string; answeredCount: number; totalQ: number; lastUpdate: number; isCheating: boolean; progressPct: number; }

// ==========================================
// UTILS
// ==========================================
const safeString = (val: any) => (val !== null && val !== undefined) ? String(val) : "";
const supportedImagePathRe = /\.(png|jpe?g|webp|gif|svg)$/i;
const escapeHtmlAttribute = (value: any) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
const normalizeImageUrl = (rawUrl: string): string => {
    let u = String(rawUrl || "").trim();
    // Convert Google Drive view/share links into direct image streams
    const gDriveMatch = u.match(/drive\.google\.com\/(?:file\/d\/|open\?id=)([a-zA-Z0-9_-]+)/i);
    if (gDriveMatch) {
        return `https://drive.google.com/uc?export=view&id=${gDriveMatch[1]}`;
    }
    return u;
};
const normalizeExternalMediaUrl = (rawUrl: any): string => {
  let s = String(rawUrl || "").trim();
  if (!s) return "";
  // Strip accidental prefixes like "IMAGE:", "[IMAGE]", "Link ảnh:"
  s = s.replace(/^(?:\[IMAGE\]|IMAGE\s*:|Link\s*ảnh\s*:)\s*/i, "").trim();
  // Extract from <img src="..."> if HTML was passed
  const imgMatch = s.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i);
  if (imgMatch?.[1]) s = imgMatch[1].trim();
  else {
    const urlMatch = s.match(/https?:\/\/[^\s<>"']+/i);
    if (urlMatch?.[0]) s = urlMatch[0].trim();
  }
  // Unescape HTML entities (&amp; -> &) critical for Firebase ?alt=media&token=...
  s = s.replace(/&amp;/gi, "&");
  // Encode raw spaces if present in URL
  s = s.replace(/\s+/g, "%20");
  return normalizeImageUrl(s);
};

const resolveQuestionMapUrl = (question: any): string => {
  if (!question) return "";
  const direct = normalizeExternalMediaUrl(
    question.mapImageUrl || question.groupImageUrl || question.diagramImageUrl || ""
  );
  if (direct) return direct;
  const fromContext = normalizeExternalMediaUrl(question.groupContext || "");
  if (fromContext.startsWith("http")) return fromContext;
  const fromInstruction = normalizeExternalMediaUrl(question.instruction || "");
  if (fromInstruction.startsWith("http")) return fromInstruction;
  return "";
};
const isSupportedRemoteImageUrl = (value: any) => {
    const url = String(value || "").trim();
    if (!/^https?:\/\//i.test(url)) return false;
    if (/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?)/i.test(url)) return true;
    if (/\/o\/[^\s<"']+\?alt=media/i.test(url)) return true;
    try {
        return supportedImagePathRe.test(new URL(url).pathname);
    } catch {
        return false;
    }
};
const renderRemoteImageHtml = (url: string, alt = "Visual Content") => {
    const cleanUrl = normalizeExternalMediaUrl(url);
    return `<img src="${escapeHtmlAttribute(cleanUrl)}" referrerpolicy="no-referrer" loading="lazy" style="max-width: 100%; border-radius: 8px; display: block; margin: 15px auto;" alt="${escapeHtmlAttribute(alt)}" />`;
};
const sanitizeRichHtml = (html: string) => annotationHTML(DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
        "a", "abbr", "b", "blockquote", "br", "caption", "code", "col", "colgroup", "del", "div", "em", "figcaption", "figure",
        "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "li", "mark", "ol", "p", "pre", "s", "small", "span",
        "strong", "sub", "sup", "table", "tbody", "td", "th", "thead", "tr", "u", "ul"
    ],
    ALLOWED_ATTR: [
        "align", "alt", "class", "colspan", "data-field", "data-note", "data-note-id", "data-optindex", "data-qid", "dir", "height", "href", "lang",
        "loading", "referrerpolicy", "rel", "rowspan", "src", "style", "target", "title", "width"
    ],
    ALLOW_DATA_ATTR: true,
}));
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
    
    // Match image URLs preserving query strings (?alt=media&token=..., ?w=..., etc.) and handle IMAGE: / Url: prefixes
    res = res.replace(/\[IMAGE\]\s*(https?:\/\/[^\s<"']+)/gi, (_match, p1) => {
        const cleanUrl = normalizeExternalMediaUrl(p1);
        return `<img src="${cleanUrl}" referrerpolicy="no-referrer" loading="lazy" style="max-width: 100%; border-radius: 8px; display: block; margin: 15px auto;" alt="Visual Content" />`;
    });
    res = res.replace(/(src=["'])?(?:(?:IMAGE|Url)\s*:\s*|<p>(?:IMAGE|Url)\s*:\s*)?(https?:\/\/[^\s<"']+(?:\.(?:jpg|jpeg|png|gif|webp|svg)(?:\?[^\s<"']*)?|\/o\/[^\s<"']+\?alt=media[^\s<"']*)|https?:\/\/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?)[^\s<"']+)(?:<\/p>)?/gi, (_match, p1, p2) => {
        if (p1) return _match; // Already inside src="", skip
        const cleanUrl = normalizeExternalMediaUrl(p2);
        return `<img src="${cleanUrl}" referrerpolicy="no-referrer" loading="lazy" style="max-width: 100%; border-radius: 8px; display: block; margin: 15px auto;" alt="Visual Content" />`;
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

    // Flow-chart arrows from Word may arrive as plain `->`, HTML-escaped text, or
    // a standalone nested div. Normalize them here because this formatter powers
    // both the active exam and the review renderer.
    const flowArrowHtml = '<img class="idp-flow-arrow" src="/flowchart-arrow-down.png" alt="" aria-hidden="true" />';
    const flowArrowToken = '(?:\\u2193|\\u2B07|\\u25BC|\\u21E9|\\|\\s*v|->|-&gt;|\\u2192|&rarr;|&darr;)';
    res = res.replace(new RegExp('>\\s*' + flowArrowToken + '\\s*<', 'gi'), '>' + flowArrowHtml + '<');
    res = res.replace(new RegExp('(?:^|<br\\s*\\/?>|\\n)\\s*' + flowArrowToken + '\\s*(?=<br\\s*\\/?>|\\n|<|$)', 'gi'), flowArrowHtml);

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
    clone.querySelectorAll('.idp-diagram-input').forEach((el) => {
        const num = el.getAttribute('data-diagram-number');
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
    renderAnnotationLayers(clone);
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
            questions: (sec.questions || []).map(qst => {
                const safeQst = stripQuestionExplanationFields(qst);
                return {
                    ...safeQst,
                    text: obfuscateHTML(qst.text),
                    instruction: obfuscateHTML(qst.instruction || ""),
                    groupContext: obfuscateHTML(qst.groupContext || ""),
                    options: qst.options?.map(opt => obfuscateHTML(opt)),
                };
            })
        })),
        questions: q.questions.map(qst => {
            const safeQst = stripQuestionExplanationFields(qst);
            return {
                ...safeQst,
                text: obfuscateHTML(qst.text),
                instruction: obfuscateHTML(qst.instruction || ""),
                groupContext: obfuscateHTML(qst.groupContext || ""),
                options: qst.options?.map(opt => obfuscateHTML(opt)),
                correctAnswer: (qst.type === "CHOICE" ? 0 : "███") as any
            };
        })
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
// Helper: định dạng tên dạng câu hỏi thân thiện (thay thế raw enum như MAP_DRAG)
const formatQuestionTypeLabel = (rawType: string): string => {
    if (!rawType) return "General";
    const cleanKey = String(rawType).trim().toUpperCase();
    const map: Record<string, string> = {
        MAP_DRAG: "Map Labelling (Drag)",
        FLOWCHART_DRAG: "Flow-chart (Drag)",
        SUMMARY_DRAG: "Summary Completion (Drag)",
        COLUMN_DRAG: "Matching Features",
        DIAGRAM_LABEL: "Diagram Labelling",
        MAP_LABELLING: "Map Labelling",
        NOTES: "Note Completion",
        SENTENCE: "Sentence Completion",
        SUMMARY: "Summary Completion",
        TABLE: "Table Completion",
        FLOWCHART: "Flow-chart Completion",
        HEADINGS: "Matching Headings",
        FEATURES: "Matching Features",
        INFORMATION: "Matching Information",
        CHOICE: "Multiple Choice",
        MULTIPLE_CHOICE: "Multiple Choice",
        CHOICE_MULTIPLE: "Multi-select",
        MATCHING: "Matching",
        BLANK: "Completion",
        SHORT_ANSWER: "Short Answer",
        TRUE_FALSE_NOT_GIVEN: "True/False/Not Given",
        YES_NO_NOT_GIVEN: "Yes/No/Not Given"
    };
    return map[cleanKey] || rawType;
};

// ==========================================
// COMPONENT: BIỂU ĐỒ TIẾN BỘ BAND (SVG thuần, chuẩn Manuscript / Editorial)
// ==========================================
interface BandPoint {
    label: string;
    band: number;
    title?: string;
    fullDate?: string;
}

const BandTrendChart = ({ data, color = "#5B3DF5", height = 185 }: { data: BandPoint[]; color?: string; height?: number }) => {
    const { i18n } = useTranslation();
    const isVi = String(i18n?.language || '').toLowerCase().startsWith('vi');
    const [showAll, setShowAll] = useState(false);
    const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

    const validPts = useMemo(() => {
        return (data || [])
            .map(d => ({
                label: d.label,
                band: Math.max(0, Math.min(9, Number(d.band))),
                title: d.title || "",
                fullDate: d.fullDate || d.label
            }))
            .filter(d => !isNaN(d.band) && d.band >= 1.0);
    }, [data]);

    if (validPts.length === 0) {
        return <div style={{ textAlign: "center", color: "#8E8B99", padding: "30px 16px", fontSize: 13, fontStyle: "italic" }}>— {isVi ? "Chưa có dữ liệu điểm band hợp lệ" : "No valid band score data yet"} —</div>;
    }

    const hasMany = validPts.length > 15;
    const pts = hasMany && !showAll ? validPts.slice(-15) : validPts;

    const W = 460, H = height, padL = 36, padR = 36, padT = 18, padB = 28;
    const plotW = W - padL - padR, plotH = H - padT - padB;

    const minBand = Math.min(...pts.map(p => p.band));
    const maxBand = Math.max(...pts.map(p => p.band));

    const x = (i: number) => pts.length === 1 ? padL + plotW / 2 : padL + plotW * (i / (pts.length - 1));
    const yMin = Math.min(4.0, Math.floor(minBand));
    const yMax = 9.0;
    const yRange = yMax - yMin || 5.0;
    const y = (b: number) => padT + plotH * (1 - (Math.max(yMin, b) - yMin) / yRange);

    const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.band).toFixed(1)}`).join(" ");
    const areaPath = `${linePath} L${x(pts.length - 1).toFixed(1)},${(padT + plotH).toFixed(1)} L${x(0).toFixed(1)},${(padT + plotH).toFixed(1)} Z`;

    const gridBands = [9, 8, 7, 6, 5, 4].filter(b => b >= yMin);

    const isPeak = (i: number) => pts[i].band === minBand || pts[i].band === maxBand;
    const showBandLabel = (i: number) => pts.length <= 12 || i === 0 || i === pts.length - 1 || isPeak(i) || hoveredIdx === i;

    const activePoint = hoveredIdx !== null && pts[hoveredIdx] ? pts[hoveredIdx] : pts[pts.length - 1];

    return (
        <div style={{ width: "100%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, minHeight: 20 }}>
                    <span style={{ fontFamily: "var(--mono)", fontSize: 13, fontWeight: 700, color: color }}>
                        Band {activePoint.band.toFixed(1)}
                    </span>
                    <span style={{ fontSize: 12, color: "#6B6875", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 260 }}>
                        {activePoint.title ? `${activePoint.title} · ` : ""}{activePoint.fullDate}
                    </span>
                </div>
                {hasMany && (
                    <div style={{ display: "inline-flex", background: "rgba(26,23,38,0.05)", borderRadius: 6, padding: 2, gap: 2 }}>
                        <button
                            type="button"
                            onClick={() => setShowAll(false)}
                            style={{
                                padding: "2px 8px",
                                fontSize: 11,
                                fontWeight: 700,
                                fontFamily: "var(--heading)",
                                borderRadius: 4,
                                border: "none",
                                background: !showAll ? "#fff" : "transparent",
                                color: !showAll ? color : "#6B6875",
                                boxShadow: !showAll ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                                cursor: "pointer"
                            }}
                        >
                            {isVi ? "15 bài gần nhất" : "Recent 15"}
                        </button>
                        <button
                            type="button"
                            onClick={() => setShowAll(true)}
                            style={{
                                padding: "2px 8px",
                                fontSize: 11,
                                fontWeight: 700,
                                fontFamily: "var(--heading)",
                                borderRadius: 4,
                                border: "none",
                                background: showAll ? "#fff" : "transparent",
                                color: showAll ? color : "#6B6875",
                                boxShadow: showAll ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                                cursor: "pointer"
                            }}
                        >
                            {isVi ? `Tất cả (${validPts.length})` : `All (${validPts.length})`}
                        </button>
                    </div>
                )}
            </div>

            <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} preserveAspectRatio="xMidYMid meet">
                <defs>
                    <linearGradient id="bandgrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={color} stopOpacity="0.18" />
                        <stop offset="100%" stopColor={color} stopOpacity="0.01" />
                    </linearGradient>
                </defs>

                {gridBands.map(b => (
                    <g key={b}>
                        <line x1={padL} y1={y(b)} x2={W - padR} y2={y(b)} stroke="rgba(26,23,38,0.08)" strokeWidth="1" strokeDasharray="3 3" />
                        <text x={padL - 6} y={y(b) + 3} textAnchor="end" fontSize="9" fill="#8E8B99" fontFamily="var(--mono)" fontWeight="600">{b}.0</text>
                    </g>
                ))}

                {pts.length > 1 && <path d={areaPath} fill="url(#bandgrad)" />}
                <path d={linePath} fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />

                {pts.map((p, i) => {
                    const cx = x(i);
                    const cy = y(p.band);
                    const isHovered = hoveredIdx === i;
                    const isFirst = i === 0;
                    const isLast = i === pts.length - 1;
                    const showDate = isFirst || isLast || (pts.length <= 8) || (pts.length <= 15 && i === Math.floor(pts.length / 2));
                    const textAnchor = isFirst ? "start" : isLast ? "end" : "middle";

                    return (
                        <g key={i} style={{ cursor: "pointer" }} onMouseEnter={() => setHoveredIdx(i)} onMouseLeave={() => setHoveredIdx(null)}>
                            <circle cx={cx} cy={cy} r="14" fill="transparent" />
                            <circle
                                cx={cx}
                                cy={cy}
                                r={isHovered ? 5 : 3.5}
                                fill="#fff"
                                stroke={color}
                                strokeWidth={isHovered ? 2.5 : 2}
                            />
                            {showBandLabel(i) && (
                                <text
                                    x={cx}
                                    y={cy - (isHovered ? 8 : 6)}
                                    textAnchor="middle"
                                    fontSize="9.5"
                                    fontFamily="var(--mono)"
                                    fontWeight="700"
                                    fill={isHovered ? color : "#1A1726"}
                                >
                                    {p.band.toFixed(1)}
                                </text>
                            )}
                            {showDate && (
                                <text
                                    x={isFirst ? padL : isLast ? W - padR : cx}
                                    y={H - 6}
                                    textAnchor={textAnchor}
                                    fontSize="8.5"
                                    fontFamily="var(--mono)"
                                    fill="#8E8B99"
                                >
                                    {p.label}
                                </text>
                            )}
                        </g>
                    );
                })}
            </svg>
        </div>
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

const RealExamBottomBrand = ({ className = "" }: { className?: string }) => (
    <div className={`real-exam-bottom-brand ${className}`.trim()} aria-label="IELTS OS">
        <BrandLogo size={20} stops={["#202020", "#4b4b4b", "#747474"]} />
        <BrandWordmark size={12} color="#222" osColor="#222" />
    </div>
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
        chevLeft: <><path d="m15 18-6-6 6-6"/></>,
        chevRight: <><path d="m9 18 6-6-6-6"/></>,
        chevronLeft: <><path d="m15 18-6-6 6-6"/></>,
        chevronRight: <><path d="m9 18 6-6-6-6"/></>,
        ext: <><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></>,
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
        scan: <><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="7" y1="12" x2="17" y2="12"/></>,
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
        let disposed = false;
        let cleanup: (() => void) | undefined;
        void import("three").then((THREE) => {
        if (disposed) return;
        const mount = mountRef.current; if (!mount) return;
        let W = mount.clientWidth || 360, H = mount.clientHeight || 320;
        let renderer: Three.WebGLRenderer;
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
        const bolts: any[] = []; const _tmpPts: Three.Vector3[] = [];
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

        cleanup = () => {
            cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener('visibilitychange', onVis);
            beams.forEach((b: any) => { scene.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose(); });
            heartTex.dispose();
            scene.traverse((o: any) => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: any) => m.dispose()); });
            renderer.dispose(); if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
        };
        }).catch(() => {});
        return () => { disposed = true; cleanup?.(); };
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
const RichTextEditor = React.memo(({ value, onChange, placeholder }: { value: string, onChange: (v: string) => void, placeholder?: string }) => {
    const editorRef = useRef<HTMLDivElement>(null);
    const debounceTimerRef = useRef<any>(null);

    useEffect(() => {
        return () => {
            if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        };
    }, []);

    useEffect(() => {
        // MAGIC FIX: Chỉ đồng bộ dữ liệu từ cha xuống con nếu ô Editor đang KHÔNG ĐƯỢC FOCUS
        if (editorRef.current && value !== editorRef.current.innerHTML && document.activeElement !== editorRef.current) {
            editorRef.current.innerHTML = value;
        }
    }, [value]);

    const flushChange = () => {
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = null;
        }
        if (editorRef.current && editorRef.current.innerHTML !== value) {
            onChange(editorRef.current.innerHTML);
        }
    };

    const handleInput = () => {
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = setTimeout(() => {
            if (editorRef.current && editorRef.current.innerHTML !== value) {
                onChange(editorRef.current.innerHTML);
            }
        }, 250);
    };

    const triggerChange = () => {
        flushChange();
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
            <div ref={editorRef} contentEditable suppressContentEditableWarning onBlur={flushChange} onInput={handleInput} style={{ minHeight: 180, padding: 16, outline: 'none', whiteSpace: 'pre-wrap', color: '#000', background: '#fff', lineHeight: 1.6 }} data-placeholder={placeholder || "Paste or type content here..."} />
        </div>
    );
});

export default function IeltsSupremeOS() {
  const { t, i18n } = useTranslation();
  const isVi = String(i18n.language || '').toLowerCase().startsWith('vi');
  const tx = (vi: string, en: string) => (isVi ? vi : en);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userRole, setUserRole] = useState<"TEACHER" | "STUDENT" | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
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
  const [colorblind, setColorblind] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [studentIp, setStudentIp] = useState<string>("Loading...");
  const [isOffline, setIsOffline] = useState(() => typeof navigator !== "undefined" && !navigator.onLine);
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
  const vocabPendingRetryAttemptedRef = useRef<Record<string, boolean>>({});
  useEffect(() => { studentsRef.current = students; }, [students]);
  const [history, setHistory] = useState<Session[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [giftCatalog, setGiftCatalog] = useState<GiftDefinition[]>(() => normalizeGiftCatalog(null));
  const [rewardMechanisms, setRewardMechanisms] = useState<RewardMechanism[]>(() => normalizeRewardMechanisms(null));
  const [rewardConfigSaving, setRewardConfigSaving] = useState(false);
  const [rewardConfigError, setRewardConfigError] = useState("");
  const [rewardConfigOpen, setRewardConfigOpen] = useState(false);
  const [rewardConfigDirty, setRewardConfigDirty] = useState(false);
  const [giftDraft, setGiftDraft] = useState<Partial<GiftDefinition>>({ kind: "consumable", enabled: true, price: 0, name: "", details: "" });
  const [rewardDraft, setRewardDraft] = useState<Partial<RewardMechanism>>({ event: "", name: "", coins: 0, enabled: true });
  const [, setWritingCommentDraft] = useState({ taskId: "", anchorQuote: "", comment: "" });
  const consumableGiftCatalog = giftCatalog.filter(item => item.kind === "consumable");
  const permanentGiftCatalog = giftCatalog.filter(item => item.kind === "permanent");
  const configuredRewardCoins = (event: string, fallback = 0) => coinsForRewardEvent(rewardMechanisms, event, fallback);
  const lessonRewardForSeconds = (seconds: number) => {
    if (seconds >= 7200) return configuredRewardCoins("LESSON_LONG", 60);
    if (seconds >= 3600) return configuredRewardCoins("LESSON_STANDARD", 25);
    if (seconds >= 1800) return configuredRewardCoins("LESSON_SHORT", 10);
    return 0;
  };
  const [sharedLinks, setSharedLinks] = useState<SharedLink[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const quizzesRef = useRef<Quiz[]>([]);
  const [quizResults, setQuizResults] = useState<QuizResult[]>([]);
  // Topic assignments are teacher-owned. Quest progress is append-only student work and
  // is always merged by attempt ID inside syncData to survive a stale mobile snapshot.
  const [topicAssignments, setTopicAssignments] = useState<TopicAssignment[]>([]);
  const [questProgress, setQuestProgress] = useState<StudentQuestProgress[]>([]);
  const [topicAssignmentEditor, setTopicAssignmentEditor] = useState<TopicAssignment | null>(null);
  const [topicAssignmentProgressFor, setTopicAssignmentProgressFor] = useState<string | null>(null);
  const [realExamPackages, setRealExamPackages] = useState<RealExamPackage[]>([]);
  const [realExamPackageEditor, setRealExamPackageEditor] = useState<RealExamPackage | null>(null);
  const [realExamSession, setRealExamSession] = useState<RealExamSession | null>(null);
  const [realExamInstructionGate, setRealExamInstructionGate] = useState<RealExamInstructionGate | null>(null);
  const [realExamAudioMuted, setRealExamAudioMuted] = useState(false);
  const [realExamAudioVolume, setRealExamAudioVolume] = useState(80);
  const [realExamAudioMenuOpen, setRealExamAudioMenuOpen] = useState(false);
  const [realExamFullscreenBlocked, setRealExamFullscreenBlocked] = useState(false);
  const [examBuilderSaveState, setExamBuilderSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [examSkillTab, setExamSkillTab] = useState<"Listening" | "Reading" | "Writing">("Listening");
  const [studentExamSkillTab, setStudentExamSkillTab] = useState<TaxonomySkill>("Listening");
  const [studentSelectedVolBySkill, setStudentSelectedVolBySkill] = useState<Record<string, string>>({});
  const [examDocxBatch, setExamDocxBatch] = useState<ExamDocxBatchItem[]>([]);
  const [examDocxBatchBusy, setExamDocxBatchBusy] = useState(false);
  const [examDocxBatchCommitState, setExamDocxBatchCommitState] = useState<"idle" | "error">("idle");
  const [aiGenerationDeliveryMode, setAiGenerationDeliveryMode] = useState<DeliveryMode>("exam");
  const [aiGenerationPublicationPolicy, setAiGenerationPublicationPolicy] = useState<"draft" | "publish_when_ready">("draft");
  const [aiGenerationBatch, setAiGenerationBatch] = useState<AiGenerationBatchState | null>(null);
  const [aiGenerationBusy, setAiGenerationBusy] = useState(false);
  const [aiGenerationUploadProgress, setAiGenerationUploadProgress] = useState<Record<string, number>>({});
  const aiGenerationBatchRef = useRef<AiGenerationBatchState | null>(null);
  const aiGenerationDriverRef = useRef({ batchId: "", inFlight: false, stopped: false, epoch: 0 });
  const aiGenerationFinalizeRef = useRef(false);
  const aiGenerationPollTimerRef = useRef<number | null>(null);
  const [questDocxBatch, setQuestDocxBatch] = useState<Array<{ id: string; file: File; status: "pending" | "parsing" | "ready" | "error"; quiz?: Quiz; error?: string }>>([]);
  const [questDocxBatchBusy, setQuestDocxBatchBusy] = useState(false);
  const [bannedIps, setBannedIps] = useState<string[]>([]);
  const [liveSessions, setLiveSessions] = useState<LiveSession[]>([]);
  const [systemLogs, setSystemLogs] = useState<SystemLog[]>([]);
  const [rewardCodes, setRewardCodes] = useState<RewardCode[]>([]);
  const [verifyCodeInput, setVerifyCodeInput] = useState("");
  const [verifyResult, setVerifyResult] = useState<{ status: "NONE" | "VALID" | "USED" | "FAKE"; entry?: RewardCode } | null>(null);
  const [serverStatus, setServerStatus] = useState<"OK" | "DOWN">("OK");

  useEffect(() => { aiGenerationBatchRef.current = aiGenerationBatch; }, [aiGenerationBatch]);
  useEffect(() => () => {
    aiGenerationDriverRef.current.stopped = true;
    if (aiGenerationPollTimerRef.current !== null) window.clearTimeout(aiGenerationPollTimerRef.current);
  }, []);
  useEffect(() => {
    if (!currentUser?.uid || userRole !== "TEACHER") return;
    const key = aiGenerationStorageKey(currentUser.uid);
    const batchId = window.localStorage.getItem(key) || "";
    if (!/^[A-Za-z0-9_-]{12,160}$/.test(batchId) || aiGenerationBatchRef.current?.batch_id === batchId) return;
    if (aiGenerationPollTimerRef.current !== null) window.clearTimeout(aiGenerationPollTimerRef.current);
    aiGenerationDriverRef.current = {
      batchId,
      inFlight: false,
      stopped: false,
      epoch: aiGenerationDriverRef.current.epoch + 1,
    };
    void pollAiGenerationBatch(batchId);
    return () => {
      const driver = aiGenerationDriverRef.current;
      if (driver.batchId !== batchId) return;
      driver.stopped = true;
      driver.epoch += 1;
      if (aiGenerationPollTimerRef.current !== null) window.clearTimeout(aiGenerationPollTimerRef.current);
    };
  }, [currentUser?.uid, userRole]);
 
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
      const diagramTextMatch = /^diagramTextBoxes:([^:]+)(?::(\d+))?$/.exec(field);
      const diagramBoxId = diagramTextMatch?.[1] || '';
      const diagramSegmentIndex = diagramTextMatch?.[2] === undefined ? null : Number(diagramTextMatch[2]);
      const oldDiagramBoxes = targetQ?.diagramTextBoxes ? JSON.stringify(targetQ.diagramTextBoxes) : null;
      const oldDiagramImage = String(targetQ?.diagramImageUrl || '');
      const isSharedOptionsType = targetQ?.type === 'CHOICE_MULTIPLE' || targetQ?.type === 'MATCHING';

      const applyToQ = (qx: any) => {
          let updated: any = { ...qx };
          let modified = false;

          if (diagramBoxId) {
              if (qx.type === 'DIAGRAM_LABEL'
                  && String(qx.diagramImageUrl || '') === oldDiagramImage
                  && JSON.stringify(qx.diagramTextBoxes || null) === oldDiagramBoxes) {
                  const boxes = qx.diagramTextBoxes || [];
                  if (boxes.some((box: any) => String(box?.id || '') === diagramBoxId)) {
                      updated.diagramTextBoxes = boxes.map((box: any) => {
                          if (String(box?.id || '') !== diagramBoxId) return box;
                          if (diagramSegmentIndex === null) return { ...box, text: cleanHTML };
                          const parts = String(box?.text || '').split(/(\[\d+\])/g);
                          if (diagramSegmentIndex < 0 || diagramSegmentIndex >= parts.length) return box;
                          parts[diagramSegmentIndex] = cleanHTML;
                          return { ...box, text: parts.join('') };
                      });
                      modified = true;
                  }
              }
          } else if (field === 'options' && optIndex !== null && optIndex !== undefined) {
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
      const nWritingTasks = isWritingQuiz(prev) && field === 'text'
          ? normalizeWritingTasks(prev).map(task => task.id === qId ? { ...task, prompt: cleanHTML } : task)
          : prev.writingTasks;
      return { ...prev, questions: nQ, sections: nSecs, ...(nWritingTasks ? { writingTasks: nWritingTasks } : {}) };
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
  const [stuResSkillFilter, setStuResSkillFilter] = useState<"ALL" | "Listening" | "Reading" | "Writing">("ALL");
  const [stuResSearch, setStuResSearch] = useState("");
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
  const [schedForm, setSchedForm] = useState({ time: "08:00", location: "Online", studentId: "", duration: 90, lessonContent: "", materialsText: "" });
  const [aiLoadingId, setAiLoadingId] = useState<string | null>(null);
  const [explainMap, setExplainMap] = useState<Record<string, { loading: boolean; text: string; audioEvidence?: { timestamp: string; quote: string; segments?: Array<{ timestamp: string; endTimestamp?: string; formattedRange?: string; quote: string; focusCue?: string; role?: string }> }; audioEvidenceSegments?: Array<{ timestamp: string; endTimestamp?: string; formattedRange?: string; quote: string; focusCue?: string; role?: string }>; deconstruction?: { trapType?: string; whyStudentWrong?: string; paraphrasePairs?: Array<{ questionTerm?: string; questionPhrase?: string; passageTerm?: string; sourcePhrase?: string; explanation?: string; note?: string }>; distractorBreakdown?: Array<{ option: string; status?: string; verdict?: string; reason?: string; trapReason?: string }> }; structured?: { paraphrasePairs?: Array<{ questionTerm: string; passageTerm: string; note?: string }>; evidence?: { location?: string; quote?: string }; detailedExplanation?: string; trapAnalysis?: { trapTitle?: string; trapReason?: string } } }>>({});
  const [vocabGenLoading, setVocabGenLoading] = useState(false);
  const [transcribeLoading, setTranscribeLoading] = useState(false);
  const [transcribeMsg, setTranscribeMsg] = useState("");
  const [audioUploadProgress, setAudioUploadProgress] = useState<number | null>(null);
  const [audioUploadMsg, setAudioUploadMsg] = useState("");
  const audioUploadAbortRef = useRef<(() => void) | null>(null);
  const audioUploadCancelledRef = useRef(false);
  const [vocabView, setVocabView] = useState<"list" | "study" | "game">("study");
  const [vocabFilter, setVocabFilter] = useState<string>("all");
  const [vocabKinds, setVocabKinds] = useState<string[]>(["word", "phrasal_verb", "idiom", "collocation", "grammar"]);
  const [vocabCount, setVocabCount] = useState<number>(15); // số lượng từ HS muốn AI tạo mỗi lần
  const [showVocabKinds, setShowVocabKinds] = useState(false);
  const [studyFlipped, setStudyFlipped] = useState(false);

  const [editingQuiz, setEditingQuiz] = useState<Quiz | null>(null);
  const [mapDragEditorSelection, setMapDragEditorSelection] = useState<string>("");
  const [diagramEditorSelection, setDiagramEditorSelection] = useState<string>("");
  const editingQuizRef = useRef<Quiz | null>(null); // FIX: ref để tránh stale closure trong saveQuiz
  const [keyEditingQuiz, setKeyEditingQuiz] = useState<Quiz | null>(null);
  const [activeExam, setActiveExam] = useState<Quiz | null>(null);
  const [pendingExamState, setPendingExamState] = useState<{quiz: Quiz, isPreview: boolean, isStudentTestUI: boolean} | null>(null);
  const [lightboxImageUrl, setLightboxImageUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!lightboxImageUrl) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxImageUrl(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lightboxImageUrl]);

  // I18N: áp ngôn ngữ theo vai trò khi đăng nhập/đổi vai trò; LUÔN ép "en" khi đang trong phòng thi.
  useEffect(() => {
    if (activeExam) { i18n.changeLanguage("en"); }
    else if (userRole) { i18n.changeLanguage(getRoleLang(userRole)); }
  }, [userRole, activeExam]);
  const trueEndTimeRef = useRef<number>(0);
  const [examAnswers, setExamAnswers] = useState<Record<string, any>>({});
  const [writingSaveState, setWritingSaveState] = useState<"idle" | "saving" | "saved" | "offline" | "error">("idle");
  const writingAttemptIdRef = useRef("");
  const writingRevisionRef = useRef(0);
  const writingAutosaveTimerRef = useRef<number | null>(null);
  const writingSaveChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const writingSubmittingRef = useRef(false);
  const writingLastSectionRef = useRef(0);
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
  const [reviewSectionIdx, setReviewSectionIdx] = useState(-1);
  const [rvFilterWrongOnly, setRvFilterWrongOnly] = useState(false);
  const [rvRetryMode, setRvRetryMode] = useState(false);
  const [rvRetryAnswers, setRvRetryAnswers] = useState<Record<string, any>>({});
  const [rvOpenDrawers, setRvOpenDrawers] = useState<Record<string, "teacher" | "ai" | null>>({});
  const [rvFlashQuestionNum, setRvFlashQuestionNum] = useState<number | null>(null);
  const [reviewActiveQuestionId, setReviewActiveQuestionId] = useState<string | null>(null);
  const [manualExplanationQuestion, setManualExplanationQuestion] = useState<QuizQuestion | null>(null);
  const [showCelebration, setShowCelebration] = useState(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  // Thanh audio DÍNH TRÊN ở màn Review (sao chép layout phòng thi) — khỏi cuộn tìm player
  const [rvAudioCur, setRvAudioCur] = useState(0);
  const [rvAudioDur, setRvAudioDur] = useState(0);
  const [rvAudioPlaying, setRvAudioPlaying] = useState(false);
  const [pendingAudioResume, setPendingAudioResume] = useState<{time: number, status: string} | null>(null);
  const [gracePeriod, setGracePeriod] = useState<number | null>(null);

  // AI Pedagogical Features States & Refs
  const dnaInFlightRef = useRef<Set<string>>(new Set());
  const [showWritingSandbox, setShowWritingSandbox] = useState(false);
  const [writingSandboxTab, setWritingSandboxTab] = useState<"brainstorm" | "critique">("brainstorm");
  const [writingSandboxLoading, setWritingSandboxLoading] = useState(false);
  const [writingSandboxOutline, setWritingSandboxOutline] = useState("");
  const [writingSandboxBrainstormData, setWritingSandboxBrainstormData] = useState<any>(null);
  const [writingSandboxCritiqueData, setWritingSandboxCritiqueData] = useState<any>(null);

  const [copilotOpen, setCopilotOpen] = useState(false);
  const [copilotActiveQ, setCopilotActiveQ] = useState<any>(null);
  const [copilotMessages, setCopilotMessages] = useState<Array<{ role: "user" | "copilot"; text: string }>>([]);
  const [copilotInput, setCopilotInput] = useState("");
  const [copilotLoading, setCopilotLoading] = useState(false);
  const [copilotExpanded, setCopilotExpanded] = useState(false);
  const copilotChatBoxRef = useRef<HTMLDivElement | null>(null);
  const copilotMsgCountRef = useRef<number>(0);

  useEffect(() => {
    if (copilotChatBoxRef.current && (copilotOpen || copilotMessages.length > copilotMsgCountRef.current)) {
      copilotChatBoxRef.current.scrollTop = copilotChatBoxRef.current.scrollHeight;
    }
    copilotMsgCountRef.current = copilotMessages.length;
  }, [copilotOpen, copilotMessages.length, copilotLoading]);

  const handleWritingSandboxAction = async (task: any, mode: "brainstorm" | "critique_outline") => {
    if (writingSandboxLoading) return;
    setWritingSandboxLoading(true);
    try {
      const res = await fetch("/api/writing_sandbox_coach", {
        method: "POST",
        headers: await getAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          taskPrompt: task?.prompt || task?.instructions || "",
          taskType: task?.taskNumber === 1 ? "Task 1" : "Task 2",
          mode,
          lang: "en",
          outlineText: mode === "critique_outline" ? writingSandboxOutline : undefined
        })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (mode === "brainstorm") {
        setWritingSandboxBrainstormData(data);
      } else {
        setWritingSandboxCritiqueData(data);
      }
    } catch (err: any) {
      alert(tx("Lỗi hỗ trợ viết: ", "Writing coach error: ") + (err?.message || String(err)));
    } finally {
      setWritingSandboxLoading(false);
    }
  };

  const resolveReviewQuestionContext = (q: any, quiz: any, activeSectionIdx: number) => {
    const stripTagsLocal = (s: any) => String(s ?? "")
      .replace(/<(?:br)\s*\/?\s*>/gi, "\n")
      .replace(/<\/(?:p|div|h[1-6]|li|tr|blockquote)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/[^\S\r\n]+/g, " ")
      .replace(/\n{2,}/g, "\n")
      .trim();

    const fullQuiz = (quizzes || []).find((x: any) => x && x.id === quiz?.id) || quiz;
    const secs: any[] = Array.isArray(fullQuiz?.sections) ? fullQuiz.sections : (Array.isArray(quiz?.sections) ? quiz.sections : []);

    // 1. Reliable section index resolution
    let secIdx = typeof q?.passageIndex === "number" ? q.passageIndex : -1;
    if (secs.length > 0 && (secIdx < 0 || secIdx >= secs.length) && q) {
      secIdx = secs.findIndex((sec: any) => (sec?.questions || []).some((qq: any) => qq && String(qq.id) === String(q.id)));
    }
    const qNumMatch = String(q?.text || q?.id || "").match(/(\d+)/);
    const qNum = q?.questionNumber || (qNumMatch ? Number(qNumMatch[1]) : 0);
    if (secs.length > 0 && (secIdx < 0 || secIdx >= secs.length) && qNum > 0) {
      const byQNum = secs.findIndex((sec: any) => (sec?.questions || []).some((qq: any) => {
        const m = String(qq?.text || qq?.id || "").match(/(\d+)/);
        return (qq?.questionNumber || (m ? Number(m[1]) : -1)) === qNum;
      }));
      if (byQNum >= 0) secIdx = byQNum;
      else if (secs.length >= 4) secIdx = Math.min(secs.length - 1, Math.floor((qNum - 1) / 10));
    }
    if (secIdx < 0 || (secs.length > 0 && secIdx >= secs.length)) {
      secIdx = Math.max(0, activeSectionIdx);
    }

    // 2. 4-tier source text fallback
    const tier1 = secs[secIdx]?.transcript || secs[secIdx]?.passage || secs[secIdx]?.passageHtml || "";
    const passagesArr: any[] = Array.isArray((fullQuiz as any)?.passages) ? (fullQuiz as any).passages : (Array.isArray((fullQuiz as any)?.readingPassages) ? (fullQuiz as any).readingPassages : []);
    const tier2 = typeof passagesArr[secIdx] === "string"
      ? passagesArr[secIdx]
      : (passagesArr[secIdx]?.transcript || passagesArr[secIdx]?.content || passagesArr[secIdx]?.passage || "");
    const tier3 = fullQuiz?.transcript || fullQuiz?.passage || (fullQuiz as any)?.passageHtml || secs.map((s: any) => s?.transcript || s?.passage || s?.passageHtml || "").filter(Boolean).join("\n\n");
    const tier4 = typeof document !== "undefined"
      ? (document.getElementById("ielts-passage-content")?.innerText || (document.querySelector(".rv-transcript-panel") as HTMLElement)?.innerText || "")
      : "";

    const rawSourceHtml = tier1 || tier2 || tier3 || tier4 || "";
    const resolvedSourceText = stripTagsLocal(rawSourceHtml) || stripTagsLocal(tier3) || stripTagsLocal(tier4);

    // 3. Blank context extraction for [BLANK] questions where q.text is just "1." or "1"
    const rawQText = stripTagsLocal(q?.text || q?.question || "");
    let effectiveQuestionText = rawQText;
    if (q && (/^\d+\.?$/.test(rawQText.trim()) || rawQText.trim().length <= 4) && q.groupContext) {
      const groupLines = stripTagsLocal(q.groupContext).split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean);
      const targetNum = qNum || Number(rawQText.replace(/\D/g, "")) || 1;
      const lineIdx = groupLines.findIndex((l: string) =>
        l.includes(`[${targetNum}]`) ||
        new RegExp(`\\b${targetNum}\\s*[\\.\\)]\\s*_+|\\[\\s*${targetNum}\\s*\\]`).test(l)
      );
      if (lineIdx >= 0) {
        const snippet = groupLines.slice(Math.max(0, lineIdx - 1), Math.min(groupLines.length, lineIdx + 2)).join(" / ");
        effectiveQuestionText = `Blank [${targetNum}] in context: ${snippet}`;
      } else if (groupLines.length > 0) {
        effectiveQuestionText = `Blank [${targetNum}] in context: ${groupLines.slice(0, 6).join(" / ")}`;
      }
    }

    return {
      secIdx,
      rawSourceHtml,
      resolvedSourceText,
      effectiveQuestionText,
      fullQuiz,
      secs
    };
  };

  const handleSendCopilotMessage = async (customPrompt?: string) => {
    const textToSend = String(customPrompt || copilotInput || "").trim();
    if (!textToSend || copilotLoading) return;

    const newMessages = [...copilotMessages, { role: "user" as const, text: textToSend }];
    setCopilotMessages(newMessages);
    setCopilotInput("");
    setCopilotLoading(true);

    try {
      const rqQuiz = reviewQuiz?.quiz as any;
      const rqResult = reviewQuiz?.result as any;
      const isListening = Boolean(rqQuiz && (String(rqQuiz.type || "").toUpperCase().includes("LISTEN") || rqQuiz.skill === "Listening"));
      const resolved = resolveReviewQuestionContext(copilotActiveQ, rqQuiz, reviewSectionIdx);
      const allSecText = (resolved.secs || []).map((s: any, idx: number) => {
        const txt = String(s?.transcript || s?.passage || s?.passageHtml || "").replace(/<[^>]+>/g, " ").trim();
        return txt ? `[Part/Passage ${idx + 1}: ${s?.title || ""}]\n${txt}` : "";
      }).filter(Boolean).join("\n\n");
      const sourceText = allSecText || resolved.resolvedSourceText || "";

      const allQs: any[] = (resolved.secs && resolved.secs.length > 0)
        ? resolved.secs.flatMap((s: any) => s?.questions || [])
        : (Array.isArray(rqQuiz?.questions) ? rqQuiz.questions : []);
      const userAnswers = rqResult?.answers || {};
      const formatCopilotAns = (item: any, val: any): string => {
        if (val === undefined || val === null || val === "" || (Array.isArray(val) && val.length === 0)) return "(bỏ trống)";
        const strip = (s: any) => String(s ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        const cleanOpt = (raw: any) => strip(raw).replace(/^\s*\(?[A-Za-z0-9]+[\.\)\:]\s*/, "").trim();
        if (item?.type === "CHOICE") {
          const n = Number(val);
          if (!Number.isNaN(n) && Array.isArray(item.options) && item.options[n] !== undefined) {
            return `${String.fromCharCode(65 + n)}. ${cleanOpt(item.options[n])}`;
          }
        }
        if (item?.type === "MATCHING") {
          const resolvedTxt = strip(resolveMatchingAnswerText(item, val));
          const rawTrim = String(val).trim();
          if (/^[A-Za-z]$/.test(rawTrim)) {
            const letter = rawTrim.toUpperCase();
            return resolvedTxt && resolvedTxt.toUpperCase() !== letter ? `${letter}. ${cleanOpt(resolvedTxt)}` : letter;
          }
          const n = Number(rawTrim);
          if (!Number.isNaN(n) && Array.isArray(item.options) && item.options[n] !== undefined) {
            const letter = String.fromCharCode(65 + n);
            return `${letter}. ${cleanOpt(item.options[n])}`;
          }
          return resolvedTxt || rawTrim;
        }
        if (item?.type === "CHOICE_MULTIPLE") {
          const arr = Array.isArray(val) ? val : String(val).split(/[,\s/]+/).filter(Boolean);
          return arr.map((v: any) => {
            const n = Number(v);
            if (!Number.isNaN(n) && Array.isArray(item.options) && item.options[n] !== undefined) {
              return `${String.fromCharCode(65 + n)}. ${cleanOpt(item.options[n])}`;
            }
            return strip(v);
          }).join(" / ");
        }
        return strip(val);
      };
      const questionsSummary = allQs.map((item: any, idx: number) => {
        const ctx = resolveReviewQuestionContext(item, rqQuiz, idx);
        const given = userAnswers[item.id];
        const givenStr = formatCopilotAns(item, given);
        const corrStr = formatCopilotAns(item, item.correctAnswer ?? item.correct ?? "");
        return `Câu ${idx + 1}: ${ctx.effectiveQuestionText} | Học viên chọn: ${givenStr} | Đáp án đúng: ${corrStr}`;
      }).join("\n");

      const API_BASE = getApiBase();
      const res = await fetch(`${API_BASE}/api/ai_review_chat`, {
        method: "POST",
        headers: await getAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          lang: i18n.language === "vi" ? "vi" : "en",
          message: textToSend,
          history: newMessages.slice(0, -1).map(m => ({ role: m.role === "user" ? "user" : "assistant", text: m.text })),
          quizTitle: rqQuiz?.title || "IELTS Practice Test",
          quizType: isListening ? "Listening" : "Reading",
          sourceText,
          questionsSummary
        })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.reply) {
        setCopilotMessages([...newMessages, { role: "copilot", text: data.reply }]);
      }
    } catch (err: any) {
      setCopilotMessages([...newMessages, { role: "copilot", text: tx("Đã xảy ra lỗi khi kết nối Trợ lý AI. Vui lòng thử lại sau.", "An error occurred connecting to AI Assistant. Please try again.") }]);
    } finally {
      setCopilotLoading(false);
    }
  };

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
  // Native HTML5 drop events are unreliable inside some Safe Exam Browser builds.
  // This also supports an accessible click-source, click-destination fallback.
  const [selectedDragAnswer, setSelectedDragAnswer] = useState<string>("");
  // Matching Headings carries a canonical Roman answer plus its human-readable
  // label. Keep it out of the generic drag state used by maps/flows/matching.
  const [selectedHeadingDrag, setSelectedHeadingDrag] = useState<{ id: string; text: string; sourceQid: string } | null>(null);
  const [headingLabelByQuestion, setHeadingLabelByQuestion] = useState<Record<string, { id: string; text: string }>>({});
  const [meetAudioIssue, setMeetAudioIssue] = useState(false);
  const [audioDiagLog, setAudioDiagLog] = useState<string[]>([]);
  const [audioDiagText, setAudioDiagText] = useState("");
  const [_hideTimer, _setHideTimer] = useState(false);
  const [timeAlert, setTimeAlert] = useState<{ message: string; urgency: "notice" | "urgent" } | null>(null);
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
  useEffect(() => {
      endAnswerDrag();
      return endAnswerDrag;
  }, [activeExam?.id, currentSectionIndex]);
        const [examCurrentQId, setExamCurrentQId] = useState<string>("");
        const [selectionMenu, setSelectionMenu] = useState<{x: number, y: number, range: Range, container: HTMLElement} | null>(null);
  const [noteInputMenu, setNoteInputMenu] = useState<{x: number, y: number, range?: Range, container: HTMLElement, existingNode?: HTMLElement, text: string} | null>(null);
  const [highlightDeleteMenu, setHighlightDeleteMenu] = useState<{x: number, y: number, node: HTMLElement, container: HTMLElement} | null>(null);
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
  const [securityNotice, setSecurityNotice] = useState<string | null>(null);
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

  // Answer blanks must be typed by the candidate. Disable browser writing assistance
  // and reject the special insertion event used when a suggestion is accepted.
  useEffect(() => {
    if (!activeExam) return;

    const answerInputSelector = 'input[data-answer-input="true"], input.inline-blank-input';
    const hardenAnswerInput = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLInputElement) || !target.matches(answerInputSelector)) return false;
      target.autocomplete = 'off';
      target.spellcheck = false;
      target.writingSuggestions = 'false';
      target.setAttribute('autocorrect', 'off');
      target.setAttribute('autocapitalize', 'off');
      target.setAttribute('writingsuggestions', 'false');
      target.setAttribute('aria-autocomplete', 'none');
      target.setAttribute('data-ms-editor', 'false');
      target.setAttribute('data-gramm', 'false');
      target.setAttribute('data-gramm_editor', 'false');
      return true;
    };

    const hardenAllAnswerInputs = () => {
      document.querySelectorAll<HTMLInputElement>(answerInputSelector).forEach(input => hardenAnswerInput(input));
    };
    const handleFocusIn = (event: FocusEvent) => { hardenAnswerInput(event.target); };
    const blockAcceptedSuggestion = (event: InputEvent) => {
      // Keep ordinary typing, IME composition and paste intact. Browsers normally use
      // insertReplacementText for accepted suggestions; the multi-character fallback
      // covers Edge/Windows builds that report the same action as insertText.
      const isSuggestionInsertion = event.inputType === 'insertReplacementText'
        || (!event.isComposing && event.inputType === 'insertText' && (event.data || '').length > 1);
      if (isSuggestionInsertion && hardenAnswerInput(event.target)) {
        event.preventDefault();
      }
    };

    hardenAllAnswerInputs();
    document.addEventListener('focusin', handleFocusIn, true);
    document.addEventListener('beforeinput', blockAcceptedSuggestion, true);
    return () => {
      document.removeEventListener('focusin', handleFocusIn, true);
      document.removeEventListener('beforeinput', blockAcceptedSuggestion, true);
    };
  }, [activeExam?.id]);

  const openHighlightDeleteMenu = (event: any, node: HTMLElement) => {
      if (document.querySelector('.idp-temp-selection') || window.getSelection()?.isCollapsed === false) return;
      const container = node.closest('.highlightable-content') as HTMLElement | null;
      if (!container) return;
      const highlightNode = topHighlight(node, container);
      if (!highlightNode) return;
      const rect = highlightNode.getBoundingClientRect();
      setSelectionMenu(null);
      setNoteInputMenu(null);
      setHighlightDeleteMenu({
          x: rect.left + rect.width / 2,
          y: rect.bottom + 10,
          node: highlightNode,
          container,
      });
      event?.preventDefault?.();
      event?.stopPropagation?.();
  };

  const deleteSelectedHighlight = () => {
      const menu = highlightDeleteMenu;
      if (!menu?.node || !menu.container) return;
      const node = menu.node;
      const parent = node.parentNode;
      if (!parent) { setHighlightDeleteMenu(null); return; }
      removeAnnotation(menu.container, node);
      const field = menu.container.getAttribute('data-field');
      const qId = menu.container.getAttribute('data-qid');
      const optIndex = menu.container.getAttribute('data-optindex');
      if (field) {
          const cleanHTML = serializeHighlightHTML(menu.container);
          setActiveExam(prev => syncHighlightState(prev, field, qId || "", cleanHTML, optIndex));
      }
      setHighlightDeleteMenu(null);
  };

  // =========================================================
  // BẢN VÁ: DOM-SAFE HIGHLIGHT REMOVAL & SỬA GHI CHÚ NOTE
  // =========================================================
  useEffect(() => {
      const handleSafeHighlightRemoval = (e: MouseEvent) => {
          const target = e.target as HTMLElement;
          // Mouseup creates the annotation selection before the subsequent click.
          // Do not replace its menu with Delete/Notes when selecting an existing layer.
          if (document.querySelector('.idp-temp-selection') || window.getSelection()?.isCollapsed === false) return;

          // CHẶN MENU CHUỘT PHẢI / LONG PRESS CỦA TRÌNH DUYỆT VÀ HỆ ĐIỀU HÀNH
          if (e.type === 'contextmenu' && target.closest('.exam-content-block')) {
              e.preventDefault();
          }

          // Click vào Note: KHÔNG mở hộp thoại tại chỗ nữa (chuẩn Inspera) — mở PANEL Notes bên phải.
          if (target?.closest?.('.student-note-hl') && !target?.closest?.('.student-highlight, mark.idp-highlight')) {
              e.preventDefault();
              e.stopPropagation();
              setShowNotesPanel(true);
              setNotesTick(t => t + 1);
              setSelectionMenu(null);
              return;
          }
          
          const highlightNode = target?.closest?.('.student-highlight, mark.idp-highlight') as HTMLElement | null;
          if (highlightNode) {
              openHighlightDeleteMenu(e, target);
          }
      };

      document.addEventListener('click', handleSafeHighlightRemoval, true);
      document.addEventListener('contextmenu', handleSafeHighlightRemoval, true);
      return () => {
          document.removeEventListener('click', handleSafeHighlightRemoval, true);
          document.removeEventListener('contextmenu', handleSafeHighlightRemoval, true);
      };
  }, [highlightDeleteMenu]);
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
        if (dz.closest('.idp-heading-slot-render') || dz.classList.contains('idp-summary-dropzone')) return;
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
  const [invPermCategory, setInvPermCategory] = useState<"ALL" | "FRAME" | "TITLE" | "PET" | "THEME" | "OTHER">("ALL");
  // Portal học viên chia tab để hết cuộn dài: Tổng quan / Phòng thi / Từ vựng / Tiến độ / Phần thưởng
  const [portalTab, setPortalTab] = useState<"home"|"exams"|"quests"|"vocab"|"progress"|"rewards">("home");
  const [selectedQuestAssignmentId, setSelectedQuestAssignmentId] = useState<string | null>(null);
  const [questSearchFilter, setQuestSearchFilter] = useState("");
  const [questStateFilter, setQuestStateFilter] = useState<"ALL" | "IN_PROGRESS" | "COMPLETED">("ALL");
  const [selectedQuestNode, setSelectedQuestNode] = useState<{ assignmentId: string; nodeId: string } | null>(null);
  const [questLaunchLoading, setQuestLaunchLoading] = useState<string | null>(null);
  const [questStatusNotice, setQuestStatusNotice] = useState<QuestStatusNotice | null>(null);
  const [giftModalTab, setGiftModalTab] = useState<"GRANT" | "CONFISCATE">("GRANT");
  const [confiscateCoinAmount, setConfiscateCoinAmount] = useState<string>("100");
  const [uiSaveToast, setUiSaveToast] = useState<{ id: number; message: string; kind: "success" | "warning" | "error" } | null>(null);
  const uiSaveToastTimerRef = useRef<number | null>(null);
  const showSaveToast = (message: string, kind: "success" | "warning" | "error" = "success") => {
    if (uiSaveToastTimerRef.current) window.clearTimeout(uiSaveToastTimerRef.current);
    const id = Date.now();
    setUiSaveToast({ id, message, kind });
    uiSaveToastTimerRef.current = window.setTimeout(() => {
      setUiSaveToast(prev => (prev?.id === id ? null : prev));
    }, 3600);
  };
  const [studentFormSaving, setStudentFormSaving] = useState(false);
  const [questEditorSaving, setQuestEditorSaving] = useState(false);
  const [realExamPkgSaving, setRealExamPkgSaving] = useState(false);
  const [keyEditorSaving, setKeyEditorSaving] = useState(false);

  // Dirty-state tracking for unsaved changes warnings across all editors
  const editingQuizBaselineRef = useRef<{ id: string; json: string } | null>(null);
  const keyEditingQuizBaselineRef = useRef<{ id: string; json: string } | null>(null);
  const realExamPkgBaselineRef = useRef<{ id: string; json: string } | null>(null);
  const topicEditorBaselineRef = useRef<{ id: string; json: string } | null>(null);
  const [examEditorDirty, setExamEditorDirty] = useState(false);
  const [keyEditorDirty, setKeyEditorDirty] = useState(false);
  const [realExamPkgDirty, setRealExamPkgDirty] = useState(false);
  const [topicEditorDirty, setTopicEditorDirty] = useState(false);

  useEffect(() => {
    if (!editingQuiz) {
      editingQuizBaselineRef.current = null;
      setExamEditorDirty(false);
      return;
    }
    const { _activePassageTab, ...comparable } = editingQuiz as any;
    const json = JSON.stringify(comparable);
    if (!editingQuizBaselineRef.current || editingQuizBaselineRef.current.id !== editingQuiz.id) {
      editingQuizBaselineRef.current = { id: editingQuiz.id, json };
      setExamEditorDirty(false);
    } else {
      setExamEditorDirty(editingQuizBaselineRef.current.json !== json);
    }
  }, [editingQuiz]);

  useEffect(() => {
    if (!keyEditingQuiz) {
      keyEditingQuizBaselineRef.current = null;
      setKeyEditorDirty(false);
      return;
    }
    const json = JSON.stringify(keyEditingQuiz);
    if (!keyEditingQuizBaselineRef.current || keyEditingQuizBaselineRef.current.id !== keyEditingQuiz.id) {
      keyEditingQuizBaselineRef.current = { id: keyEditingQuiz.id, json };
      setKeyEditorDirty(false);
    } else {
      setKeyEditorDirty(keyEditingQuizBaselineRef.current.json !== json);
    }
  }, [keyEditingQuiz]);

  useEffect(() => {
    if (!realExamPackageEditor) {
      realExamPkgBaselineRef.current = null;
      setRealExamPkgDirty(false);
      return;
    }
    const { updatedAt, ...comparable } = realExamPackageEditor as any;
    const json = JSON.stringify(comparable);
    if (!realExamPkgBaselineRef.current || realExamPkgBaselineRef.current.id !== realExamPackageEditor.id) {
      realExamPkgBaselineRef.current = { id: realExamPackageEditor.id, json };
      setRealExamPkgDirty(false);
    } else {
      setRealExamPkgDirty(realExamPkgBaselineRef.current.json !== json);
    }
  }, [realExamPackageEditor]);

  useEffect(() => {
    if (!topicAssignmentEditor) {
      topicEditorBaselineRef.current = null;
      setTopicEditorDirty(false);
      return;
    }
    const { updatedAt, ...comparable } = topicAssignmentEditor as any;
    const json = JSON.stringify(comparable);
    if (!topicEditorBaselineRef.current || topicEditorBaselineRef.current.id !== topicAssignmentEditor.id) {
      topicEditorBaselineRef.current = { id: topicAssignmentEditor.id, json };
      setTopicEditorDirty(false);
    } else {
      setTopicEditorDirty(topicEditorBaselineRef.current.json !== json);
    }
  }, [topicAssignmentEditor]);

  const hasAnyUnsavedTeacherChanges = examEditorDirty || keyEditorDirty || realExamPkgDirty || topicEditorDirty || rewardConfigDirty;

  useEffect(() => {
    if (!hasAnyUnsavedTeacherChanges) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasAnyUnsavedTeacherChanges]);

  const confirmDiscardUnsavedChanges = (customMsg?: string): boolean => {
    if (!hasAnyUnsavedTeacherChanges) return true;
    return window.confirm(
      customMsg ||
      tx(
        "Bạn có thay đổi chưa được lưu! Nếu thoát ngay bây giờ, các thay đổi sẽ bị mất.\n\nBạn có chắc chắn muốn thoát mà không lưu không?",
        "You have unsaved changes! If you leave now, your changes will be lost.\n\nAre you sure you want to leave without saving?"
      )
    );
  };

  const handleTeacherTabChange = (nextTab: TabType) => {
    if (nextTab === activeTab) return;
    if (!confirmDiscardUnsavedChanges()) return;
    setActiveTab(nextTab);
  };

  const formatCosmeticDisplayName = (rawName: string) => {
    const p = String(rawName || "");
    if (isVi) return p;
    const enMap: Record<string, string> = {
      "Giao diện: Hoàng Kim": "Theme: Golden Sovereign",
      "Giao diện: Nửa Đêm": "Theme: Midnight Navy",
      "Giao diện: Anh Đào": "Theme: Sakura Bloom",
      "Giao diện: Rừng Sâu": "Theme: Emerald Forest",
      "Khung avatar: Vương Miện": "Avatar Frame: Crown of Sol",
      "Khung avatar: Rồng Lửa": "Avatar Frame: Infernal Dragon",
      "Khung avatar: Băng Giá": "Avatar Frame: Frostbite Sigil",
      "Khung avatar: Cầu Vồng": "Avatar Frame: Prismatic Aurora",
      "Khung avatar: Sao Băng": "Avatar Frame: Shooting Star",
      "Linh thú: Cú Mèo": "Companion: Celestial Owl",
      "Linh thú: Mèo Thần Tài": "Companion: Fortune Cat",
      "Linh thú: Rồng Con": "Companion: Baby Drake",
      "Linh thú: Cáo Lửa": "Companion: Flame Fox",
      "Linh thú: Chim Cánh Cụt": "Companion: Frost Penguin",
      "Linh thú: Gấu Trúc": "Companion: Zen Panda",
    };
    if (enMap[p]) return enMap[p];
    if (p.startsWith("Danh hiệu: ")) return "Title: " + p.slice(11);
    if (p.startsWith("Giao diện: ")) return "Theme: " + p.slice(11);
    if (p.startsWith("Khung avatar: ")) return "Avatar Frame: " + p.slice(14);
    if (p.startsWith("Linh thú: ")) return "Companion: " + p.slice(10);
    return p;
  };

  const getPermanentItemCategory = (rawName: string): "FRAME" | "TITLE" | "PET" | "THEME" | "OTHER" => {
    const p = String(rawName || "").trim();
    const lower = p.toLowerCase();
    if (p.startsWith("Khung avatar:") || lower.includes("khung") || lower.includes("frame")) return "FRAME";
    if (p.startsWith("Danh hiệu:") || lower.includes("danh hiệu") || lower.includes("title")) return "TITLE";
    if (p.startsWith("Linh thú:") || lower.includes("linh thú") || lower.includes("pet") || lower.includes("companion")) return "PET";
    if (p.startsWith("Giao diện:") || lower.includes("giao diện") || lower.includes("theme")) return "THEME";
    return "OTHER";
  };

  const renderGiftStoreIcon = (rawName: string, size = 24, accentColor = "#0D9488") => {
    const lower = String(rawName || "").toLowerCase();
    const baseProps = {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      strokeLinecap: "round" as const,
      strokeLinejoin: "round" as const,
      style: { display: "block", flexShrink: 0 },
    };
    if (lower.includes("deadline") || lower.includes("dời") || lower.includes("hoãn") || lower.includes("gia hạn")) {
      return (
        <svg {...baseProps} stroke="#D97706" strokeWidth="2">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill="#FEF3C7" />
          <circle cx="12" cy="12" r="4.5" stroke="#B45309" strokeWidth="1.8" fill="#FFFBEB" />
          <path d="M12 9.8v2.4l1.6 1" stroke="#B45309" strokeWidth="1.8" />
        </svg>
      );
    }
    if (lower.includes("milo") || lower.includes("sữa") || lower.includes("milk") || lower.includes("cacao")) {
      return (
        <svg {...baseProps} stroke="#15803D" strokeWidth="2">
          <path d="M14 2l3 2v3" stroke="#166534" />
          <rect x="6" y="6" width="12" height="15" rx="2.5" fill="#DCFCE7" stroke="#15803D" />
          <path d="M6 10h12" stroke="#15803D" />
          <path d="M9.5 14.5l1.8 1.8 3.2-3.2" stroke="#15803D" strokeWidth="2.2" />
        </svg>
      );
    }
    if (lower.includes("trà sữa") || lower.includes("viên viên") || lower.includes("boba") || lower.includes("trân châu")) {
      return (
        <svg {...baseProps} stroke="#9333EA" strokeWidth="2">
          <path d="M15 2l-2 6" stroke="#7E22CE" strokeWidth="2.3" />
          <path d="M6 8h12l-1.4 12a2 2 0 0 1-2 1.8H9.4a2 2 0 0 1-2-1.8L6 8z" fill="#F3E8FF" />
          <path d="M5 8h14" stroke="#7E22CE" strokeWidth="2.2" />
          <circle cx="9.5" cy="18.5" r="1" fill="#6B21A8" stroke="none" />
          <circle cx="12" cy="19" r="1" fill="#6B21A8" stroke="none" />
          <circle cx="14.5" cy="18.5" r="1" fill="#6B21A8" stroke="none" />
          <circle cx="11" cy="16.5" r="1" fill="#6B21A8" stroke="none" />
          <circle cx="13.5" cy="16.5" r="1" fill="#6B21A8" stroke="none" />
        </svg>
      );
    }
    if (lower.includes("trái chò") || lower.includes("trà") || lower.includes("nước") || lower.includes("ly") || lower.includes("cà phê") || lower.includes("coffee") || lower.includes("matcha") || lower.includes("juice")) {
      return (
        <svg {...baseProps} stroke="#0284C7" strokeWidth="2">
          <path d="M14 2l2 6" stroke="#0369A1" strokeWidth="2.2" />
          <path d="M6.5 8h11l-1.3 11.8a2 2 0 0 1-2 1.8H9.8a2 2 0 0 1-2-1.8L6.5 8z" fill="#E0F2FE" />
          <path d="M5.5 8h13" stroke="#0284C7" strokeWidth="2.2" />
          <path d="M8.5 13.5c1.2-1 2.5 1 3.7 0s2.3 1 3.3 0" stroke="#0284C7" strokeWidth="1.7" />
        </svg>
      );
    }
    if (lower.startsWith("khung avatar:") || lower.includes("khung") || lower.includes("frame")) {
      return (
        <svg {...baseProps} stroke="#E11D48" strokeWidth="2">
          <rect x="4" y="4" width="16" height="16" rx="5" fill="#FFE4E6" />
          <circle cx="12" cy="12" r="4.2" fill="#FFF1F2" stroke="#BE123C" strokeWidth="1.8" />
          <path d="M12 2v2M12 20v2M2 12h2M20 12h2" stroke="#E11D48" strokeWidth="2" />
        </svg>
      );
    }
    if (lower.startsWith("danh hiệu:") || lower.includes("danh hiệu") || lower.includes("title") || lower.includes("cúp") || lower.includes("huy hiệu")) {
      return (
        <svg {...baseProps} stroke="#D97706" strokeWidth="2">
          <path d="M8 21h8M12 17v4" />
          <path d="M7 4h10v5a5 5 0 0 1-10 0V4z" fill="#FEF3C7" />
          <path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3" />
        </svg>
      );
    }
    if (lower.startsWith("linh thú:") || lower.includes("linh thú") || lower.includes("pet") || lower.includes("mèo") || lower.includes("cún") || lower.includes("rồng")) {
      return (
        <svg {...baseProps} stroke="#EA580C" strokeWidth="2">
          <circle cx="7" cy="9.5" r="2" fill="#FFEDD5" />
          <circle cx="12" cy="7" r="2" fill="#FFEDD5" />
          <circle cx="17" cy="9.5" r="2" fill="#FFEDD5" />
          <path d="M8.5 14.5c0-2 1.6-3.5 3.5-3.5s3.5 1.5 3.5 3.5c0 2.2-1.8 4.5-3.5 4.5s-3.5-2.3-3.5-4.5z" fill="#FFEDD5" />
        </svg>
      );
    }
    if (lower.startsWith("giao diện:") || lower.includes("giao diện") || lower.includes("theme") || lower.includes("màu")) {
      return (
        <svg {...baseProps} stroke="#4F46E5" strokeWidth="2">
          <path d="M12 2a10 10 0 0 0 0 20 2.5 2.5 0 0 0 2.5-2.5c0-.6-.2-1.2-.6-1.6-.4-.4-.6-1-.6-1.6A2.5 2.5 0 0 1 15.8 14H17a5 5 0 0 0 5-5c0-3.9-4.5-7-10-7z" fill="#EEF2FF" />
          <circle cx="7.5" cy="10.5" r="1.2" fill="#4F46E5" stroke="none" />
          <circle cx="11" cy="7.5" r="1.2" fill="#EC4899" stroke="none" />
          <circle cx="15.5" cy="8.5" r="1.2" fill="#F59E0B" stroke="none" />
        </svg>
      );
    }
    if (lower.includes("voucher") || lower.includes("thẻ") || lower.includes("vé") || lower.includes("ticket") || lower.includes("coupon")) {
      return (
        <svg {...baseProps} stroke="#0D9488" strokeWidth="2">
          <path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v1.5a1.5 1.5 0 0 0 0 3V15a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1.5a1.5 1.5 0 0 0 0-3V9z" fill="#CCFBF1" />
          <path d="M9 7v10" strokeDasharray="2 2" />
        </svg>
      );
    }
    if (lower.includes("sách") || lower.includes("tài liệu") || lower.includes("vở") || lower.includes("bút") || lower.includes("book")) {
      return (
        <svg {...baseProps} stroke="#2563EB" strokeWidth="2">
          <path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2V4z" fill="#DBEAFE" />
          <path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7V4z" fill="#EFF6FF" />
        </svg>
      );
    }
    if (lower.includes("bánh") || lower.includes("kẹo") || lower.includes("snack") || lower.includes("pizza") || lower.includes("ăn")) {
      return (
        <svg {...baseProps} stroke="#E11D48" strokeWidth="2">
          <path d="M4 13h16v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6z" fill="#FFE4E6" />
          <path d="M4 13c0-3 3.5-5 8-5s8 2 8 5" fill="#FECDD3" />
          <path d="M12 4v4" stroke="#E11D48" strokeWidth="2.2" />
        </svg>
      );
    }
    return (
      <svg {...baseProps} stroke={accentColor} strokeWidth="2">
        <rect x="3" y="8" width="18" height="4" rx="1" fill={`${accentColor}22`} />
        <path d="M12 8v13" />
        <path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" fill={`${accentColor}12`} />
        <path d="M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5" />
      </svg>
    );
  };
  // Sub-tab trong Phòng thi HS (hết cuộn): đề khả dụng / kết quả & review
  const [examRoomTab, setExamRoomTab] = useState<"available"|"results">("available");
  // Sub-tab trong hồ sơ HS phía giáo viên: kết quả thi / buổi học / thống kê
  const [stuProfileTab, setStuProfileTab] = useState<"results"|"sessions"|"stats">("results");
  // Hàng kết quả thi / buổi học (GV) bung chi tiết theo id
  const [expandedResultId, setExpandedResultId] = useState<string|number|null>(null);
  const [expandedSessionId, setExpandedSessionId] = useState<string|number|null>(null);
  const [useCodeObj, setUseCodeObj] = useState<{name: string, code: string}|null>(null);
  const [dismissedPmId, setDismissedPmId] = useState<string | null>(null);
  const [progressSkillFilter, setProgressSkillFilter] = useState<"All"|TaxonomySkill>("All");
  const [progressSubTab, setProgressSubTab] = useState<"analytics"|"resources">("analytics");
  const [dailyExpSavedFeedback, setDailyExpSavedFeedback] = useState(false);

  const [unlockKey, setUnlockKey] = useState("");
  const [showDebtWarning, setShowDebtWarning] = useState(false);
  const [debtConfirmCountdown, setDebtConfirmCountdown] = useState(5);
  const [hasClaimedDaily, setHasClaimedDaily] = useState(false);

  // ============================================================================
  // HIERARCHICAL URL ROUTING ENGINE (Bidirectional URL <-> App State Sync)
  // ============================================================================
  const isRoutingPopStateRef = useRef(false);
  const initialRouteAppliedRef = useRef(false);

  // Computes the canonical hierarchical path for the current UI state
  const computeCurrentPath = (): string => {
    if (!currentUser) return "/login";
    if (sebGuideQuiz) return "/seb-guide";
    if (activeExam) {
      if (activeExam.realExamContext) return `/exam/${encodeURIComponent(activeExam.id)}/real-mock`;
      return `/exam/${encodeURIComponent(activeExam.id)}`;
    }
    if (reviewQuiz) {
      const resId = reviewQuiz.result?.id || "latest";
      if (isWritingQuiz(reviewQuiz.quiz)) {
        return userRole === "TEACHER"
          ? `/teacher/grading/${encodeURIComponent(resId)}`
          : `/exam/writing-feedback/${encodeURIComponent(resId)}`;
      }
      return `/exam/review/${encodeURIComponent(resId)}`;
    }

    if (userRole === "STUDENT") {
      if (portalTab === "exams") return "/student/exams";
      if (portalTab === "quests") return "/student/quests";
      if (portalTab === "vocab") return "/student/vocab";
      if (portalTab === "rewards") return "/student/rewards";
      if (portalTab === "progress") return "/student/progress";
      return "/student/dashboard";
    }

    if (userRole === "TEACHER") {
      if (activeTab === "STUDENTS") {
        return profileId ? `/teacher/students/${encodeURIComponent(profileId)}` : "/teacher/students";
      }
      if (activeTab === "EXAM_BUILDER") {
        return editingQuiz?.id ? `/teacher/exams/${encodeURIComponent(editingQuiz.id)}` : "/teacher/exams";
      }
      if (activeTab === "CLASSROOM") return "/teacher/classes";
      if (activeTab === "LIVE_ARENA") return "/teacher/arena";
      if (activeTab === "FINANCE") return "/teacher/finances";
      if (activeTab === "DRIVE") return "/teacher/drive";
      if (activeTab === "TOPIC_ASSIGNMENTS") return "/teacher/quests";
      if (activeTab === "ACADEMICS") return "/teacher/academics";
      if (activeTab === "HISTORY") return "/teacher/history";
      return "/teacher/dashboard";
    }

    return "/";
  };

  // Parses a pathname and updates application state accordingly
  const applyRouteFromPath = (pathname: string) => {
    if (!pathname || pathname === "/" || pathname === "/login") {
      if (!currentUser) return;
      if (userRole === "TEACHER") {
        setActiveTab("DASHBOARD");
      } else if (userRole === "STUDENT") {
        setPortalTab("home");
      }
      return;
    }

    // 1. /seb-guide
    if (pathname === "/seb-guide") {
      if (quizzes.length > 0 && !sebGuideQuiz) {
        setSebGuideQuiz(quizzes[0]);
      }
      return;
    }

    // 2. /exam/:quizId or /exam/:quizId/real-mock
    const examMatch = pathname.match(/^\/exam\/([^/]+)(\/real-mock)?$/);
    if (examMatch) {
      const qId = decodeURIComponent(examMatch[1]);
      const targetQuiz = quizzes.find(q => q.id === qId);
      if (targetQuiz) {
        if (examMatch[2] && !targetQuiz.realExamContext) {
          targetQuiz.realExamContext = {
            packageId: 'standalone',
            packageTitle: targetQuiz.title,
            packageQuizIds: [targetQuiz.id],
            packageAttemptId: 'attempt_' + Date.now(),
            testTakerId: 'CANDIDATE',
            orderIndex: 1,
            total: 1,
            isFinal: true,
          };
        }
        setActiveExam(targetQuiz);
        return;
      }
    }

    // 3. /exam/review/:resultId or /exam/writing-feedback/:resultId or /teacher/grading/:resultId
    const reviewMatch = pathname.match(/^\/(?:exam\/review|exam\/writing-feedback|teacher\/grading)\/([^/]+)$/);
    if (reviewMatch) {
      const rId = decodeURIComponent(reviewMatch[1]);
      const targetResult = quizResults.find(r => r.id === rId);
      if (targetResult) {
        const targetQuiz = quizzes.find(q => q.id === targetResult.quizId);
        if (targetQuiz) {
          setReviewSectionIdx(-1);
          setReviewQuiz({ quiz: targetQuiz, result: targetResult });
          return;
        }
      }
    }

    // 4. Student routes: /student/*
    if (pathname.startsWith("/student")) {
      // Guard: Teacher accessing student route redirects to teacher dashboard
      if (userRole === "TEACHER") {
        setActiveTab("DASHBOARD");
        window.history.replaceState({ path: "/teacher/dashboard" }, "", "/teacher/dashboard");
        return;
      }
      if (pathname === "/student/exams") setPortalTab("exams");
      else if (pathname === "/student/quests" || pathname === "/student/assignments") setPortalTab("quests");
      else if (pathname === "/student/vocab") setPortalTab("vocab");
      else if (pathname === "/student/rewards") setPortalTab("rewards");
      else if (pathname === "/student/progress") setPortalTab("progress");
      else setPortalTab("home");

      if (activeExam) setActiveExam(null);
      if (reviewQuiz) setReviewQuiz(null);
      if (sebGuideQuiz) setSebGuideQuiz(null);
      return;
    }

    // 5. Teacher routes: /teacher/*
    if (pathname.startsWith("/teacher")) {
      // Guard: Student accessing teacher route redirects to student dashboard
      if (userRole === "STUDENT") {
        setPortalTab("home");
        window.history.replaceState({ path: "/student/dashboard" }, "", "/student/dashboard");
        return;
      }

      const studentDetailMatch = pathname.match(/^\/teacher\/students\/([^/]+)$/);
      if (studentDetailMatch) {
        setActiveTab("STUDENTS");
        setProfileId(decodeURIComponent(studentDetailMatch[1]));
      } else if (pathname === "/teacher/students") {
        setActiveTab("STUDENTS");
        setProfileId(null);
      } else if (pathname.startsWith("/teacher/exams")) {
        setActiveTab("EXAM_BUILDER");
        const quizEditMatch = pathname.match(/^\/teacher\/exams\/([^/]+)$/);
        if (quizEditMatch) {
          const editId = decodeURIComponent(quizEditMatch[1]);
          const found = quizzes.find(q => q.id === editId);
          if (found) setEditingQuiz(found);
        }
      } else if (pathname === "/teacher/classes" || pathname === "/teacher/classroom") {
        setActiveTab("CLASSROOM");
      } else if (pathname === "/teacher/arena") {
        setActiveTab("LIVE_ARENA");
      } else if (pathname === "/teacher/finances" || pathname === "/teacher/finance") {
        setActiveTab("FINANCE");
      } else if (pathname === "/teacher/drive") {
        setActiveTab("DRIVE");
      } else if (pathname === "/teacher/quests" || pathname === "/teacher/assignments") {
        setActiveTab("TOPIC_ASSIGNMENTS");
      } else if (pathname === "/teacher/academics") {
        setActiveTab("ACADEMICS");
      } else if (pathname === "/teacher/history") {
        setActiveTab("HISTORY");
      } else {
        setActiveTab("DASHBOARD");
      }

      if (activeExam) setActiveExam(null);
      if (reviewQuiz) setReviewQuiz(null);
      if (sebGuideQuiz) setSebGuideQuiz(null);
      return;
    }
  };

  // Synchronize State -> Browser URL
  useEffect(() => {
    if (authChecking) return;
    if (isRoutingPopStateRef.current) {
      isRoutingPopStateRef.current = false;
      return;
    }
    if (typeof window === "undefined") return;
    const targetPath = computeCurrentPath();
    if (window.location.pathname !== targetPath) {
      window.history.pushState({ path: targetPath }, "", targetPath);
    }
  }, [
    authChecking,
    currentUser,
    userRole,
    activeExam?.id,
    activeExam?.realExamContext,
    reviewQuiz?.result?.id,
    sebGuideQuiz?.id,
    editingQuiz?.id,
    portalTab,
    activeTab,
    profileId,
  ]);

  // Handle Browser Back / Forward Button (popstate event)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPopState = () => {
      // If student is currently taking an exam, confirm exit to prevent accidental loss of work
      if (activeExam) {
        const confirmMsg = i18n.language === "vi"
          ? "Bạn có chắc chắn muốn rời khỏi phòng thi? Bài làm chưa nộp sẽ không được lưu điểm."
          : "Are you sure you want to leave the exam? Unsubmitted progress will not be graded.";
        if (!window.confirm(confirmMsg)) {
          window.history.pushState({ path: `/exam/${activeExam.id}` }, "", `/exam/${activeExam.id}`);
          return;
        }
      }
      isRoutingPopStateRef.current = true;
      applyRouteFromPath(window.location.pathname);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [quizzes, quizResults, currentUser, userRole, activeExam]);

  // Initial Route Hydration (apply route on initial page load once data is ready)
  useEffect(() => {
    if (!loaded || !currentUser || authChecking) return;
    if (!initialRouteAppliedRef.current) {
      initialRouteAppliedRef.current = true;
      applyRouteFromPath(window.location.pathname);
    }
  }, [loaded, currentUser, authChecking, quizzes.length, quizResults.length]);
  
  const [pushTitle, setPushTitle] = useState("");
  const [pushBody, setPushBody] = useState("");
  const [pushTarget, setPushTarget] = useState<"ALL" | string>("ALL");

  const handleSendPush = () => {
      if (!pushTitle || !pushBody) { alert(tx("Vui lòng nhập đủ tiêu đề và nội dung!", "Please enter both title and body!")); return; }
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
      alert(tx("Đã gửi Push Notification thành công!", "Push notification sent successfully!"));
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
  const lastLocalMutationAtRef = useRef(0);
  const inFlightMutationIdsRef = useRef(new Set<string>());
  const latestOptimisticWorkspaceRef = useRef<{
    timestamp: number;
    students?: Student[];
    history?: Session[];
    schedules?: Schedule[];
    transactions?: Transaction[];
    examFolders?: string[];
    topicAssignments?: TopicAssignment[];
    realExamPackages?: RealExamPackage[];
  }>({ timestamp: 0 });
  // A failed Firestore write must never recursively invoke syncData through error logging.
  const syncFailureLogRef = useRef(false);
  // Phones commonly freeze a background tab and leave its Firestore listener stale until
  // the next network heartbeat. Coalesce lifecycle-triggered server refreshes on resume.
  const cloudRefreshInFlightRef = useRef(false);
  const lastCloudRefreshAtRef = useRef(0);
  // Firestore transactions need a live server. Keep every workspace mutation in a
  // durable, ordered journal so a brief mobile/weak-network outage never requires
  // a refresh or silently drops an action that is not covered by a specialised queue.
  const workspaceSyncChainRef = useRef<Promise<unknown>>(Promise.resolve());
  // The old workspace blob remains readable during migration only. Once the
  // dedicated collection is confirmed, it is the sole quiz source on all devices.
  const legacyQuizzesRef = useRef<Quiz[]>([]);
  const quizCatalogReadyRef = useRef(false);
  const quizCatalogMigratedRef = useRef(false);
  const quizCatalogMigrationInFlightRef = useRef(false);

  useEffect(() => { quizzesRef.current = quizzes; }, [quizzes]);

  // Keep an on-device retry record until Firestore confirms a quiz transaction.
  const pendingQuizWriteKey = () => `ielts_pending_quiz_write_${String(currentUser?.email || "teacher").toLowerCase()}`;
  const readPendingQuizWrite = () => {
    try {
      const raw = localStorage.getItem(pendingQuizWriteKey());
      const parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || !Array.isArray(parsed.quizzes)) return null;
      if (parsed.savedAt && Date.now() - parsed.savedAt > 24 * 60 * 60 * 1000) {
        localStorage.removeItem(pendingQuizWriteKey());
        return null;
      }
      return parsed;
    } catch (e) { return null; }
  };
  const writePendingQuizWrite = (quizzesToSave: any[], deletedIds: string[] = []) => {
    try {
      const rawQuizzes = Array.isArray(quizzesToSave) ? quizzesToSave : [];
      const payload = { quizzes: rawQuizzes, deletedIds, savedAt: Date.now() };
      const serialized = JSON.stringify(payload);
      if (serialized.length > 250 * 1024 || rawQuizzes.length > 3) {
        const lightweight = rawQuizzes.map(q => ({
          id: q.id,
          folder: q.folder,
          title: q.title,
          updatedAt: q.updatedAt,
          revision: q.revision,
          isPatch: true,
        }));
        localStorage.setItem(pendingQuizWriteKey(), JSON.stringify({ quizzes: lightweight, deletedIds, savedAt: Date.now() }));
      } else {
        localStorage.setItem(pendingQuizWriteKey(), serialized);
      }
    } catch (e) {
      console.warn("Unable to persist pending quiz write to localStorage:", e);
    }
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
  const pendingCoinOperationKey = () => `ielts_pending_coin_operation_${String(currentUser?.email || "user").toLowerCase()}`;
  const readPendingCoinOperation = (): CoinOperation | null => {
    try {
      const raw = localStorage.getItem(pendingCoinOperationKey());
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed?.id && parsed?.studentId ? parsed as CoinOperation : null;
    } catch (e) { return null; }
  };
  const writePendingCoinOperation = (operation: CoinOperation) => {
    try { localStorage.setItem(pendingCoinOperationKey(), JSON.stringify(operation)); } catch (e) {}
  };
  const clearPendingCoinOperation = () => {
    try { localStorage.removeItem(pendingCoinOperationKey()); } catch (e) {}
  };
  const readLocalDeletedPackageIds = (): string[] => {
    try { return JSON.parse(localStorage.getItem('ielts_deleted_real_exam_packages') || '[]'); } catch { return []; }
  };
  const addLocalDeletedPackageIds = (ids: string[]) => {
    try {
      const current = new Set(readLocalDeletedPackageIds());
      ids.forEach(id => current.add(String(id)));
      localStorage.setItem('ielts_deleted_real_exam_packages', JSON.stringify(Array.from(current).slice(-200)));
    } catch { }
  };
  const pendingWorkspaceMutationsKey = () => `ielts_pending_workspace_mutations_${String(currentUser?.email || "user").toLowerCase()}`;
  const readPendingWorkspaceMutations = (): { id: string; payload: any; createdAt: number; retryCount?: number }[] => {
    try {
      const raw = localStorage.getItem(pendingWorkspaceMutationsKey());
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      const now = Date.now();
      const valid = parsed.filter((entry: any) =>
        entry?.id &&
        entry?.payload &&
        typeof entry.payload === "object" &&
        (!entry.createdAt || now - entry.createdAt < 24 * 60 * 60 * 1000) &&
        (entry.retryCount || 0) < 3
      );
      if (valid.length !== parsed.length) {
        if (valid.length) localStorage.setItem(pendingWorkspaceMutationsKey(), JSON.stringify(valid));
        else localStorage.removeItem(pendingWorkspaceMutationsKey());
      }
      return valid;
    } catch { return []; }
  };
  const writePendingWorkspaceMutations = (entries: { id: string; payload: any; createdAt: number; retryCount?: number }[]) => {
    try {
      if (entries.length) localStorage.setItem(pendingWorkspaceMutationsKey(), JSON.stringify(entries));
      else localStorage.removeItem(pendingWorkspaceMutationsKey());
    } catch (error) {
      // IndexedDB still protects Firestore writes when available; never make a UI
      // action fail merely because a browser has disabled localStorage.
      console.warn("Unable to persist workspace sync journal:", error);
    }
  };
  const makeCoinOperation = (studentId: string, delta: number, kind: string, extra: Partial<CoinOperation> = {}): CoinOperation => ({
    id: `coin_${studentId}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    studentId, delta, kind, createdAt: Date.now(), ...extra,
  });
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
    return {
      notebook: newestVocabFirst(Array.from(cards.values()).filter((card: any) => !tombstones.includes(String(card.id)))),
      tombstones,
    };
  };
  const mergeQuizCatalog = (serverQuizzes: any[], localQuizzes: any[], deletedIds: string[] = []) => {
    const deleted = new Set((deletedIds || []).map(String));
    const map = new Map<string, any>();
    (Array.isArray(serverQuizzes) ? serverQuizzes : []).forEach((q: any) => {
      if (q && q.id && !deleted.has(String(q.id))) {
        map.set(String(q.id), q);
      }
    });
    (Array.isArray(localQuizzes) ? localQuizzes : []).forEach((q: any) => {
      if (q && q.id && !deleted.has(String(q.id))) {
        const existing = map.get(String(q.id));
        if (!existing) {
          map.set(String(q.id), q);
        } else {
          const localRev = Number(q.revision) || 0;
          const serverRev = Number(existing.revision) || 0;
          const localTime = Number(q.updatedAt) || 0;
          const serverTime = Number(existing.updatedAt) || 0;
          if (localRev > serverRev || (localRev === serverRev && localTime >= serverTime) || q.isPatch) {
            map.set(String(q.id), { ...existing, ...q });
          } else {
            map.set(String(q.id), { ...q, ...existing });
          }
        }
      }
    });
    return Array.from(map.values());
  };
  const setQuizCatalogState = (catalog: Quiz[]) => {
    const cleanCatalog = (Array.isArray(catalog) ? catalog : []).filter((quiz: any) => quiz && quiz.id) as Quiz[];
    quizzesRef.current = cleanCatalog;
    setQuizzes(cleanCatalog);
  };
  const quizForStorage = (quiz: any) => {
    const { _activePassageTab, _showSettings, ...persisted } = quiz || {};
    return JSON.parse(JSON.stringify({ ...persisted, updatedAt: Date.now() }));
  };
  const persistQuizCatalog = async (catalog: Quiz[], deletedIds: string[] = []) => {
    const writes = (Array.isArray(catalog) ? catalog : []).filter((quiz: any) => quiz?.id);
    const deletes = Array.from(new Set((deletedIds || []).map(String)));
    const operations = [
      ...writes.map((quiz: any) => ({ kind: "set" as const, id: String(quiz.id), quiz })),
      ...deletes.map(id => ({ kind: "delete" as const, id })),
    ];
    for (let offset = 0; offset < operations.length; offset += 400) {
      const batch = writeBatch(db);
      operations.slice(offset, offset + 400).forEach((operation) => {
        const target = doc(QUIZZES_COLLECTION_REF, operation.id);
        if (operation.kind === "delete") batch.delete(target);
        else batch.set(target, quizForStorage(operation.quiz));
      });
      await batch.commit();
    }
  };
  const applyQuizCatalogSnapshot = (snap: any) => {
    // Cache-only empty snapshots are common on resumed phones. They must never erase
    // the visible catalog before Firestore has returned the server copy.
    const remoteQuizzes = snap.docs
      .map((item: any) => ({ ...item.data(), id: String(item.id) }))
      .filter((quiz: any) => quiz && quiz.id) as Quiz[];
    if (snap.metadata?.fromCache && remoteQuizzes.length === 0 && quizzesRef.current.length > 0) return;
    // Do NOT return early on snap.metadata?.hasPendingWrites — indexedDB holds pending writes
    // on refresh, and returning early permanently leaves the catalog empty.

    quizCatalogReadyRef.current = remoteQuizzes.length > 0 || !snap.metadata?.fromCache;
    const hasDedicatedCatalog = quizCatalogMigratedRef.current || remoteQuizzes.length > 0;
    const baseCatalog = hasDedicatedCatalog
      ? remoteQuizzes
      : mergeQuizCatalog(legacyQuizzesRef.current, remoteQuizzes);
    const pending = userRole === "TEACHER" ? readPendingQuizWrite() : null;
    const recoveredCatalog = pending
      ? mergeQuizCatalog(baseCatalog, pending.quizzes, pending.deletedIds || [])
      : baseCatalog;
    setQuizCatalogState(recoveredCatalog);
  };
  const migrateLegacyQuizCatalog = async (legacyCatalog: Quiz[]) => {
    if (userRole !== "TEACHER" || quizCatalogMigratedRef.current || quizCatalogMigrationInFlightRef.current) return;
    quizCatalogMigrationInFlightRef.current = true;
    try {
      if (legacyCatalog.length) await persistQuizCatalog(legacyCatalog);
      await setDoc(DB_DOC_REF, { quizCatalogMigrated: true, quizzes: [] }, { merge: true });
      quizCatalogMigratedRef.current = true;
    } catch (error) {
      console.error("Quiz catalog migration failed:", error);
    } finally {
      quizCatalogMigrationInFlightRef.current = false;
    }
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
      let dailyCoinOperation: CoinOperation | null = null;

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
          const dailyCoins = configuredRewardCoins("DAILY_ATTENDANCE", 20);
          let bonusCoins = dailyCoins;
          let msg = `DAILY ATTENDANCE: +${dailyCoins} Coins\n Current streak: ${newStreak} days.`;
          if (newStreak > 0 && newStreak % 7 === 0) {
              const streakCoins = configuredRewardCoins("WEEKLY_STREAK", 300);
              bonusCoins += streakCoins;
              msg += `\n 7-DAY STREAK BONUS: +${streakCoins} Coins!`;
          }
          newCoins += bonusCoins;
          dailyCoinOperation = makeCoinOperation(meLocal.id, bonusCoins, "DAILY_ATTENDANCE");
          alert(msg);
      }

      if (shouldUpdate) {
          const nx = students.map(s => s.id === meLocal.id ? { ...s, coins: newCoins, lastLoginDate: today, currentStreak: newStreak, currentSessionId: localSessionId || undefined, sessionClaimedAt: newSessionClaimedAt, activeExamId: newActiveExamId } : s);
          syncData({ students: nx, ...(dailyCoinOperation ? { __coinOperation: dailyCoinOperation } : {}) });
          setStudents(nx);
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
  // Bộ lọc dạng bài (taxonomy) trong Phòng thi học sinh — reset khi đổi kỹ năng.
  const [stSelectedCategories, setStSelectedCategories] = useState<string[]>([]);
  const [stFilterPopoverOpen, setStFilterPopoverOpen] = useState<boolean>(false);
  const [stCategoryMatchMode, setStCategoryMatchMode] = useState<"ANY" | "ALL">("ANY");
  useEffect(() => { setStSelectedCategories([]); setStFilterPopoverOpen(false); }, [studentExamSkillTab]);
    const [, _setSortQuiz] = useState<"NEW"|"OLD"|"AZ">("NEW");
  const [builderFolder, setBuilderFolder] = useState("Root");
  const [examFolders, setExamFolders] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem("ielts_exam_folders");
      return raw ? JSON.parse(raw) : [];
    } catch (_) {
      return [];
    }
  });
  const [builderSkillFilter, setBuilderSkillFilter] = useState<"ALL" | "Listening" | "Reading" | "Writing" | "Integrated">("ALL");
  const [builderSort, setBuilderSort] = useState<"TITLE_ASC" | "NEWEST" | "QUESTIONS">("TITLE_ASC");
  const [folderModal, setFolderModal] = useState<null | { mode: "CREATE" | "RENAME" | "MOVE_QUIZZES" | "MOVE_FOLDER"; targetFolder?: string; inputValue: string; selectedDest: string }>(null);
  const [dragOverFolderTarget, setDragOverFolderTarget] = useState<string | null>(null);
  const [aiBatchCollapsed, setAiBatchCollapsed] = useState(false);
  const [builderSearch, setBuilderSearch] = useState("");
  const [builderSectionIndex, setBuilderSectionIndex] = useState(0);   
  const [, _setScrollPct] = useState(0);
  const [_showQuestionNotes, _setShowQuestionNotes] = useState<Record<string, boolean>>({});
  const [_showQuestionMap, _setShowQuestionMap] = useState(false);
  const [enableTimerBeep, _setEnableTimerBeep] = useState(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isAudioReadyToPlay, setIsAudioReadyToPlay] = useState(false);

  const preloadOrActiveAudioUrl = (() => {
    if (activeExam) {
      const isListening = String(activeExam.type).toLowerCase().includes("listen") || activeExam.type === "Integrated";
      if (isListening && activeExam.audioUrl) return activeExam.audioUrl.trim();
    }
    if (pendingExamState?.quiz) {
      const q = pendingExamState.quiz;
      const isListening = String(q.type).toLowerCase().includes("listen") || q.type === "Integrated";
      if (isListening && q.audioUrl) return q.audioUrl.trim();
    }
    if (realExamInstructionGate) {
      const gateQuiz = (quizzesRef.current || quizzes || []).find(q => q.id === realExamInstructionGate.quizId);
      const isListening = realExamInstructionGate.skill === "Listening" || (gateQuiz && (String(gateQuiz.type).toLowerCase().includes("listen") || gateQuiz.type === "Integrated"));
      if (isListening && gateQuiz?.audioUrl) return gateQuiz.audioUrl.trim();
    }
    if (userRole === "STUDENT" && realExamSession) {
      const pkg = realExamPackages.find(item => item.id === realExamSession.packageId);
      if (pkg) {
        const completed = new Set(realExamSession.completedQuizIds || []);
        const nextQuizId = pkg.quizIds?.find(id => !completed.has(id));
        if (nextQuizId) {
          const nextQuiz = (quizzesRef.current || quizzes || []).find(q => q.id === nextQuizId);
          const isListening = nextQuiz && (String(nextQuiz.type).toLowerCase().includes("listen") || nextQuiz.type === "Integrated" || (nextQuiz as any).skill === "Listening");
          if (isListening && nextQuiz?.audioUrl) return nextQuiz.audioUrl.trim();
        }
      }
    }
    return "";
  })();

  const checkAndSetAudioReady = (audio: HTMLAudioElement | null) => {
    if (!audio) return;
    try {
      const hasEnoughBuffered = audio.buffered && audio.buffered.length > 0 && audio.buffered.end(0) >= Math.min(5, audio.duration || 5);
      if (audio.readyState >= 3 || hasEnoughBuffered) {
        setIsAudioReadyToPlay(true);
      }
    } catch {
      setIsAudioReadyToPlay(true);
    }
  };

  // Some Chromium/SEB builds strip custom DataTransfer MIME types at drop time.
  // Keep the source slot locally so an already-placed card can still be moved.
  const dragSourceQuestionRef = useRef<string>("");
  const audioPlayRequestRef = useRef(false);
  const examAudioShouldPlayRef = useRef(false);
  const examAudioResumeTimerRef = useRef<number | null>(null);
  const examAudioRecoveryAttemptsRef = useRef(0);
  const externalPauseTimesRef = useRef<number[]>([]);
  const meetAudioIssueRef = useRef(false);
  const androidAudioCtxRef = useRef<AudioContext | null>(null);
  const audioProgressPaintRef = useRef({ exam: 0, review: 0 });
  const audioReloadAttemptsRef = useRef(0);
  const audioPrewarmUrlsRef = useRef<Set<string>>(new Set());
  const examTimerRef = useRef<number | null>(null);
  const timeAlertDismissRef = useRef<number | null>(null);
  const timeAlertMilestonesRef = useRef<Set<number>>(new Set());
  const forceSubmitExamRef = useRef<(() => void) | null>(null);
  const securityIncidentRef = useRef(0);
  const latestExamState = useRef({ activeExam, examAnswers, flaggedQuestions, examCheatCount, qNotes, scratchpadText, isPreview, examStartTime, crossedOptions, currentUser, students, enableTimerBeep }); 

  useEffect(() => {
    audioProgressPaintRef.current = { exam: 0, review: 0 };
    audioReloadAttemptsRef.current = 0;
  }, [activeExam?.audioUrl, reviewQuiz?.quiz?.audioUrl]);

  const dismissExamTimeAlert = () => {
    if (timeAlertDismissRef.current !== null) {
      window.clearTimeout(timeAlertDismissRef.current);
      timeAlertDismissRef.current = null;
    }
    setTimeAlert(null);
  };

  const showExamTimeAlert = (message: string, urgency: "notice" | "urgent") => {
    if (timeAlertDismissRef.current !== null) window.clearTimeout(timeAlertDismissRef.current);
    setTimeAlert({ message, urgency });
    timeAlertDismissRef.current = window.setTimeout(() => {
      timeAlertDismissRef.current = null;
      setTimeAlert(null);
    }, urgency === "urgent" ? 5200 : 4600);
  };

  useEffect(() => {
    timeAlertMilestonesRef.current.clear();
    dismissExamTimeAlert();
    return () => {
      if (timeAlertDismissRef.current !== null) {
        window.clearTimeout(timeAlertDismissRef.current);
        timeAlertDismissRef.current = null;
      }
    };
  }, [activeExam?.id]);

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
    return isListeningExamAudio() && !isPracticeQuiz(activeExam) && (activeExam as any)?.audioMode !== "practice";
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
  const persistQuizWithRevision = async (quiz: Quiz): Promise<Quiz> => {
    const target = doc(QUIZZES_COLLECTION_REF, String(quiz.id));
    const expectedRevision = Math.max(0, Number(quiz.revision) || 0);
    let persisted: Quiz | null = null;
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(target);
      const current = snapshot.exists() ? (snapshot.data() || {}) : {};
      const currentRevision = Math.max(0, Number(current.revision) || 0);
      if (snapshot.exists() && currentRevision !== expectedRevision) {
        throw new Error("QUIZ_REVISION_CONFLICT");
      }
      persisted = {
        ...quiz,
        revision: currentRevision + 1,
        updatedAt: getTrueTime(),
      } as Quiz;
      transaction.set(target, quizForStorage(persisted));
    });
    if (!persisted) throw new Error("QUIZ_SAVE_EMPTY");
    return persisted;
  };

  // Updating the complete exam application four times per second makes lower-end
  // laptops stutter exactly when an audio buffer needs CPU time. Keep the native
  // audio clock authoritative and paint the UI at a calm, predictable cadence.
  const publishAudioProgress = (audio: HTMLAudioElement, review = false) => {
    const channel: "exam" | "review" = review ? "review" : "exam";
    const now = performance.now();
    const current = Math.max(0, audio.currentTime || 0);
    const dur = Number(audio.duration || 0);
    if (!review && dur > 0 && Math.abs(audioDur - dur) > 0.5) {
      setAudioDur(dur);
    }
    if (now - audioProgressPaintRef.current[channel] < 450) {
      updateExamMediaSessionPosition(audio);
      return;
    }
    audioProgressPaintRef.current[channel] = now;
    if (review) setRvAudioCur(current);
    else if (isPracticeQuiz(activeExam) || (activeExam as any)?.audioMode === "practice") {
      setAudioCur(current);
      if (dur > 0 && audioDur <= 0) setAudioDur(dur);
    }
    updateExamMediaSessionPosition(audio);
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
    // A prior browser/media-session interaction can leave a reused element muted
    // while its timeline continues. Every explicit Play restores audible output.
    audio.muted = false;
    audio.defaultMuted = false;
    audio.volume = Math.max(0, Math.min(1, _audioVolume));
    audio.playbackRate = rate;
    // Do not download an 80 MB recording during initial render. The explicit user
    // gesture upgrades buffering, which preserves autoplay permission and lets the
    // browser's native range loader maintain a healthy playback buffer.
    audio.preload = "auto";
    if (audio.readyState === 0 && (audio.networkState === HTMLMediaElement.NETWORK_EMPTY || audio.networkState === HTMLMediaElement.NETWORK_NO_SOURCE)) {
      audio.load();
    }
    setManagedAudioLoading();
    if (isTouchAudioHost() && !androidAudioCtxRef.current) {
      void warmAndroidAudioPath();
    }
    try {
      recordAudioDiagnostic("user-play-attempt", audio);
      await audio.play();
      if (!isListeningReviewAudio()) {
        setAudioStatus("PLAYING");
      }
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
    audioReloadAttemptsRef.current = 0;
    const curAudioDur = Number(audioRef.current?.duration || 0);
    if (curAudioDur > 0 && Math.abs(audioDur - curAudioDur) > 0.5) {
      setAudioDur(curAudioDur);
    }
    if (activeExam && shouldDelayListeningExamTimer(activeExam, isPreview) && !examStartTime) {
      const startedAt = getRealTime();
      setExamStartTime(startedAt);
      setExamTimeLeft(activeExam.timeLimit * 60);
      trueEndTimeRef.current = startedAt + activeExam.timeLimit * 60000;
      latestExamState.current = { ...latestExamState.current, examStartTime: startedAt };
    }
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
    const audio = audioRef.current;
    if (examAudioShouldPlayRef.current && audio && !audio.ended
        && (error?.code === MediaError.MEDIA_ERR_ABORTED || error?.code === MediaError.MEDIA_ERR_NETWORK || error?.code === MediaError.MEDIA_ERR_DECODE)
        && audioReloadAttemptsRef.current < 3) {
      const resumeAt = audio.currentTime || 0;
      audioReloadAttemptsRef.current += 1;
      // A transient Range/proxy failure must not leave the first Play button dead.
      // Reloading the same native element retains the browser's autoplay grant.
      window.setTimeout(() => {
        if (audioRef.current !== audio || !examAudioShouldPlayRef.current) return;
        audio.preload = "auto";
        audio.load();
        const restoreAndResume = () => {
          audio.removeEventListener("canplay", restoreAndResume);
          if (resumeAt > 0 && Number.isFinite(audio.duration)) audio.currentTime = Math.min(resumeAt, Math.max(0, audio.duration - 0.1));
          recoverInterruptedExamAudio(audio);
        };
        audio.addEventListener("canplay", restoreAndResume, { once: true });
      }, 250 * audioReloadAttemptsRef.current);
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
      // The live clock only exists on the teacher shell. Updating the root component
      // every second for every student unnecessarily steals time from the exam UI.
      if (userRole !== "TEACHER") return;
      const updateClock = () => setLiveTime(new Date(getRealTime()).toLocaleTimeString('vi-VN'));
      updateClock();
      const clockInt = window.setInterval(updateClock, 1000);
      return () => window.clearInterval(clockInt);
  }, [userRole]);

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
    // Replay ordinary teacher/student actions first. Quiz/vocab/result journals below
    // remain specialised because they have stronger item-level acknowledgement rules.
    await flushPendingWorkspaceMutations();
    // A quest submission carries both a normal result and append-only unlock state.
    // Replay the durable journal first. Each entry is removed only after its Firestore
    // transaction succeeds, so a false-positive navigator.onLine can never erase a pass.
    const pendingQuestSubmissions = readPendingQuestSubmissions(email);
    for (const pendingQuest of pendingQuestSubmissions) {
      const pendingResult = pendingQuest?.result;
      if (pendingResult?.id) {
        setQuizResults(prev => {
          const ids = new Set(prev.map(item => String(item?.id || "")));
          return ids.has(String(pendingResult.id)) ? prev : [pendingResult, ...prev];
        });
      }
      if (Array.isArray(pendingQuest?.questProgress)) {
        setQuestProgress(prev => mergeQuestProgressCollections(
          prev,
          pendingQuest.questProgress,
          topicAssignments
        ));
      }
      try {
        const synced = await syncData({
          quizResults: pendingResult ? [pendingResult] : [],
          questProgress: Array.isArray(pendingQuest.questProgress) ? pendingQuest.questProgress : [],
          ...(Array.isArray(pendingQuest.students) ? { students: pendingQuest.students } : {}),
          ...(pendingQuest.coinOperation ? { __coinOperation: pendingQuest.coinOperation } : {}),
        });
        if (!synced) {
          console.warn("Pending quest sync was not acknowledged; preserving the local journal.");
          return;
        }
        clearPendingQuestSubmission(email, pendingResult?.id);
        removeOfflineResult(email, pendingResult?.id);
      } catch (e) {
        console.warn("Pending quest sync failed, preserving the local journal:", e);
        return;
      }
    }
    // Tương thích ngược: gộp key cũ (1 kết quả) vào hàng đợi
    const legacy = localStorage.getItem(`ielts_offline_result_${email}`);
    let q = readOfflineQueue(email);
    if (legacy) {
      try {
        const legacyResult = JSON.parse(legacy);
        q = legacyResult?.id && !q.some((item: any) => String(item?.id || "") === String(legacyResult.id))
          ? [legacyResult, ...q]
          : q;
      } catch {}
    }
    if (!q.length) return;
    try {
      setQuizResults(prev => {
        const ids = new Set(prev.map(r => String(r?.id || "")));
        return [...q.filter((r: any) => !ids.has(String(r?.id || ""))), ...prev];
      });
      const pendingCoinOperation = readPendingCoinOperation();
      const synced = await syncData({ quizResults: q, ...(pendingCoinOperation ? { __coinOperation: pendingCoinOperation } : {}) });
      if (!synced) {
        console.warn("Offline result sync was not acknowledged; preserving the local queue.");
        return;
      }
      writeOfflineQueue(email, []);
      if (legacy) localStorage.removeItem(`ielts_offline_result_${email}`);
      alert(tx(`Đã đồng bộ ${q.length} bài thi offline lên máy chủ thành công!`, `Successfully synced ${q.length} offline exam results to server!`));
    } catch (e) {
      console.warn("Flush offline queue failed, preserving the local queue:", e);
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
          setUserRole(isTeacherEmail(user.email) ? "TEACHER" : "STUDENT");
          localStorage.setItem('ielts_last_login', new Date(getRealTime()).toLocaleString('vi-VN'));
          setLoginLoading(false);
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
// permanents và vocabNotebook đều là dữ liệu do học sinh tạo. Với vocab, collection riêng là
// nguồn chuẩn; document tổng chỉ giữ bản legacy. Tuyệt đối không render retry buffer từ document tổng.
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
      const revokedSet = new Set<string>(
        Array.isArray(s?.inventory?.revokedPermanents)
          ? s.inventory.revokedPermanents.map((x: any) => String(x || "").trim()).filter(Boolean)
          : []
      );
      const union = Array.from(new Set([...(Array.isArray(backup) ? backup : []), ...prevPerms, ...inPerms]))
        .filter((item: any) => !revokedSet.has(String(item || "").trim()));
      const dedicatedReady = vocabStoreReadyRef.current[email];
      const mergedVocab = dedicatedReady
        ? {
            notebook: Array.isArray(prevMe?.vocabNotebook) ? prevMe.vocabNotebook : [],
            tombstones: Array.isArray(prevMe?.vocabTombstones) ? prevMe.vocabTombstones : [],
          }
        : mergeVocabNotebook(
            s.vocabNotebook,
            Array.isArray(prevMe?.vocabNotebook) ? prevMe.vocabNotebook : [],
            s.vocabTombstones,
            Array.isArray(prevMe?.vocabTombstones) ? prevMe.vocabTombstones : []
          );
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

const applyWorkspaceSnapshot = (snap: any) => {
  // Ignore Firestore's local/cache echoes or stale server reads while our mutation is in flight
  // or within the post-write settling window.
  const isUnconfirmedEcho = snap.metadata?.hasPendingWrites || snap.metadata?.fromCache;
  if (writeInFlightRef.current > 0 || Date.now() < suppressSnapshotUntilRef.current) return;
  if (isUnconfirmedEcho && (Date.now() - lastLocalMutationAtRef.current < 2000)) return;
  if (snap.exists()) {
    const d = snap.data();
    const pendingCoinOperation = readPendingCoinOperation();
    const serverCoinTransactions = Array.isArray(d.coinTransactions) ? d.coinTransactions : [];
    const pendingCoinConfirmed = !!pendingCoinOperation && serverCoinTransactions.some(
      (entry: any) => String(entry?.id || "") === String(pendingCoinOperation.id)
    );
    if (pendingCoinConfirmed) clearPendingCoinOperation();
    // Bọc toàn bộ dữ liệu qua hàm clean() để triệt tiêu null/undefined
    const myEmailLower = String(currentUser?.email || "").trim().toLowerCase();
    const rawStudents = clean(d.students);
    const incomingStudents = (userRole === "STUDENT" && Array.isArray(rawStudents))
      ? rawStudents.map((s: any) => {
          if (!s || String(s.email || "").trim().toLowerCase() === myEmailLower) return s;
          const { phone, dob, rate, customRate, debtMessage, vocabNotebook, vocabTombstones, errorDna, ...publicStudent } = s;
          return publicStudent;
        })
      : rawStudents;
    if (pendingCoinOperation && !pendingCoinConfirmed && Array.isArray(incomingStudents)) {
      // A delayed/mobile snapshot may still be the pre-purchase balance. Project the
      // pending operation onto that snapshot, while retaining the already optimistic
      // local balance if the snapshot was actually committed but its ledger is late.
      const projectedStudents = applyCoinOperation(incomingStudents, pendingCoinOperation);
      setStudents((prev: any[]) => {
        const previousStudent = prev.find((student: any) => String(student?.id || "") === String(pendingCoinOperation.studentId));
        const projectedStudent = projectedStudents.find((student: any) => String(student?.id || "") === String(pendingCoinOperation.studentId));
        if (!previousStudent || !projectedStudent || Number(previousStudent.coins) === Number(projectedStudent.coins)) {
          return mergeMyPermanents(prev, projectedStudents);
        }
        const preservedStudents = projectedStudents.map((student: any) =>
          String(student?.id || "") === String(pendingCoinOperation.studentId)
            ? { ...student, coins: previousStudent.coins, inventory: previousStudent.inventory || student.inventory }
            : student
        );
        return mergeMyPermanents(prev, preservedStudents);
      });
    } else {
      setStudents((prev: any) => mergeMyPermanents(prev, incomingStudents));
    }
    const historyTombstones = new Set((Array.isArray(d.deletedHistoryIds) ? d.deletedHistoryIds : []).map(String));
    const cleanHistory = (clean(d.history) as Session[]).filter(h => h && h.id && !historyTombstones.has(String(h.id)));
    setHistory(cleanHistory);

    const transactionTombstones = new Set((Array.isArray(d.deletedTransactionIds) ? d.deletedTransactionIds : []).map(String));
    const cleanTransactions = (clean(d.transactions) as Transaction[]).filter(t => t && t.id && !transactionTombstones.has(String(t.id)));
    setTransactions(userRole === "TEACHER" ? cleanTransactions : []); 

    const scheduleTombstones = new Set((Array.isArray(d.deletedScheduleIds) ? d.deletedScheduleIds : []).map(String));
    const cleanSchedules = (clean(d.schedules) as Schedule[]).filter(s => s && s.id && !scheduleTombstones.has(String(s.id)));
    setSchedules(cleanSchedules);
    setGiftCatalog(normalizeGiftCatalog(d.giftCatalog));
    setRewardMechanisms(normalizeRewardMechanisms(d.rewardMechanisms));
    setSharedLinks(clean(d.sharedLinks)); 
    const serverQuizzes = clean(d.quizzes) as Quiz[];
    legacyQuizzesRef.current = serverQuizzes;
    quizCatalogMigratedRef.current = d.quizCatalogMigrated === true;
    const pendingQuizWrite = userRole === "TEACHER" ? readPendingQuizWrite() : null;
    // Until the one-time migration has completed, retain legacy exams as a read-only
    // fallback. Once the collection is confirmed, never let this old blob overwrite it.
    if (!quizCatalogMigratedRef.current && serverQuizzes.length > 0 && !quizCatalogReadyRef.current && quizzesRef.current.length === 0) {
      const recoveredQuizzes = pendingQuizWrite
        ? mergeQuizCatalog(serverQuizzes, pendingQuizWrite.quizzes, pendingQuizWrite.deletedIds)
        : serverQuizzes;
      setQuizCatalogState(recoveredQuizzes);
    }
    if (pendingQuizWrite && !pendingQuizWrite.quizzes.some((q: any) => q.isPatch)) {
      // The prior browser session ended before Firestore acknowledged its write. Retry
      // after this snapshot has settled; syncData clears the record only on success.
      window.setTimeout(() => { void syncData({ __quizUpserts: pendingQuizWrite.quizzes, __quizDeletedIds: pendingQuizWrite.deletedIds || [] }); }, 0);
    }
    if (!quizCatalogMigratedRef.current && userRole === "TEACHER") {
      void migrateLegacyQuizCatalog(serverQuizzes);
    }
    if (pendingCoinOperation) {
      // Retry a purchase/award that may have been interrupted by a backgrounded tab.
      // The transaction ledger makes this safe even if the server already applied it.
      window.setTimeout(() => { void syncData({ __coinOperation: pendingCoinOperation }); }, 0);
    }
    const serverQuizResults = clean(d.quizResults) as QuizResult[];
    const pendingQuestSubmissions = userRole === "STUDENT" && currentUser?.email
      ? readPendingQuestSubmissions(currentUser.email)
      : [];
    // A cached/local Firestore echo is not an acknowledgement. Keep the on-device
    // journal until a server-confirmed snapshot includes the result ID.
    const snapshotIsServerConfirmed = !snap.metadata?.hasPendingWrites && snap.metadata?.fromCache !== true;
    const serverResultIds = new Set(serverQuizResults.map(result => String(result?.id || "")));
    const unconfirmedQuestSubmissions = pendingQuestSubmissions.filter((entry: any) => {
      const resultId = String(entry?.result?.id || "");
      const acknowledged = snapshotIsServerConfirmed && !!resultId && serverResultIds.has(resultId);
      if (acknowledged) clearPendingQuestSubmission(currentUser?.email, resultId);
      return !acknowledged;
    });
    const recoveredQuizResults = new Map<string, QuizResult>();
    unconfirmedQuestSubmissions.forEach((entry: any) => {
      if (entry?.result?.id) recoveredQuizResults.set(String(entry.result.id), entry.result as QuizResult);
    });
    serverQuizResults.forEach(result => {
      if (result?.id) recoveredQuizResults.set(String(result.id), result);
    });
    setQuizResults(Array.from(recoveredQuizResults.values()));
    const incomingTopicAssignments = clean(d.topicAssignments) as TopicAssignment[];
    setTopicAssignments(incomingTopicAssignments);
    const localDeletedPkgIds = new Set(readLocalDeletedPackageIds());
    const remotePkgTombstones = new Set((Array.isArray(d.realExamPackageTombstones) ? d.realExamPackageTombstones : []).map(String));
    const incomingPackages = (clean(d.realExamPackages) || []).filter((p: any) => p && p.id && !localDeletedPkgIds.has(String(p.id)) && !remotePkgTombstones.has(String(p.id)));
    setRealExamPackages(incomingPackages);
    if (Array.isArray(d.examFolders)) {
      const folderTombstones = new Set(
        (Array.isArray(d.examFolderTombstones) ? d.examFolderTombstones : [])
          .map(normalizeFolderPath)
      );
      const cleanedFolders: string[] = Array.from(new Set<string>(
        (d.examFolders as any[])
          .map(normalizeFolderPath)
          .filter(f => f && f !== "Root" && !folderTombstones.has(f))
      )).sort();
      setExamFolders(cleanedFolders);
      try { localStorage.setItem("ielts_exam_folders", JSON.stringify(cleanedFolders)); } catch (_) {}
    }
    const recoveredQuestProgress = unconfirmedQuestSubmissions.flatMap((entry: any) =>
      Array.isArray(entry?.questProgress) ? entry.questProgress : []
    );
    setQuestProgress(prev => mergeQuestProgressCollections(
      clean(d.questProgress),
      [...prev, ...recoveredQuestProgress],
      incomingTopicAssignments.length ? incomingTopicAssignments : topicAssignments
    ));
    setBannedIps(clean(d.bannedIps));
    setAnnouncement(d.announcement || "");
    setSystemLogs(clean(d.systemLogs));
    setRewardCodes(clean(d.rewardCodes));
  }
  setLoaded(true);
};

    let disposed = false;
    const refreshCloudAfterForeground = async () => {
      if (disposed || !currentUser || !navigator.onLine || document.visibilityState === "hidden") return;
      if (writeInFlightRef.current > 0 || Date.now() - lastLocalMutationAtRef.current < 2500) return;
      const now = Date.now();
      if (cloudRefreshInFlightRef.current || now - lastCloudRefreshAtRef.current < 650) return;

      cloudRefreshInFlightRef.current = true;
      lastCloudRefreshAtRef.current = now;
      try {
        // A server-only read wakes Firestore immediately after iOS/Android has frozen a tab.
        // The normal listeners remain the long-lived sync mechanism; this is a resume nudge.
        const [workspaceResult, liveResult, quizCatalogResult] = await Promise.allSettled([
          getDocFromServer(DB_DOC_REF),
          getDocFromServer(LIVE_DOC_REF),
          getDocsFromServer(QUIZZES_COLLECTION_REF),
        ]);
        if (disposed) return;
        if (workspaceResult.status === "fulfilled") applyWorkspaceSnapshot(workspaceResult.value);
        else console.debug("Foreground workspace refresh deferred:", workspaceResult.reason);
        if (liveResult.status === "fulfilled" && liveResult.value.exists()) {
          setLiveSessions(liveResult.value.data().sessions || []);
        }
        if (quizCatalogResult.status === "fulfilled") applyQuizCatalogSnapshot(quizCatalogResult.value);
        else console.debug("Foreground quiz catalog refresh deferred:", quizCatalogResult.reason);
      } finally {
        cloudRefreshInFlightRef.current = false;
      }
    };
    const handleForeground = () => {
      if (writeInFlightRef.current > 0 || Date.now() - lastLocalMutationAtRef.current < 2500) return;
      void refreshCloudAfterForeground();
      void flushOfflineQueue();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") handleForeground();
    };

    const unsub = onSnapshot(DB_DOC_REF, applyWorkspaceSnapshot);

    const unsubQuizzes = onSnapshot(QUIZZES_COLLECTION_REF, applyQuizCatalogSnapshot);

    const unsubLive = onSnapshot(LIVE_DOC_REF, (snap) => {
        if (snap.exists()) {
            const d = snap.data();
            setLiveSessions(d.sessions || []);
        }
    });

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pageshow", handleForeground);
    window.addEventListener("focus", handleForeground);
    window.addEventListener("online", handleForeground);
    void refreshCloudAfterForeground();
    // Mobile browsers can leave a Firestore stream visually alive but stale after a
    // radio hand-off. This light server nudge only runs in a visible tab.
    const foregroundHeartbeat = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) void refreshCloudAfterForeground();
    }, 45000);

    return () => {
      disposed = true;
      unsub();
      unsubQuizzes();
      unsubLive();
      clearInterval(timeSyncInterval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pageshow", handleForeground);
      window.removeEventListener("focus", handleForeground);
      window.removeEventListener("online", handleForeground);
      window.clearInterval(foregroundHeartbeat);
    };
  }, [currentUser, userRole]);

  useEffect(() => {
    if (!loaded || userRole !== "STUDENT" || !currentUser?.email) return;
    const vocabEmail = String(currentUser.email).trim().toLowerCase();
    const unsubVocab = onSnapshot(vocabCardsRef(vocabEmail), (snap) => {
      // A local Firestore echo is not a durable write. Do not let it alter the visible
      // notebook or clear the retry record; wait for the server-confirmed snapshot.
      if (snap.metadata.hasPendingWrites) return;
      const snapshotNotebook: VocabCard[] = [];
      const snapshotTombstones: string[] = [];
      snap.docs.forEach(cardSnap => {
        const value: any = cardSnap.data() || {};
        const id = String(value.id || cardSnap.id);
        if (value.deleted) snapshotTombstones.push(id);
        else snapshotNotebook.push({ ...value, id } as VocabCard);
      });
      snapshotNotebook.sort((a, b) =>
        vocabCreatedAt(b) - vocabCreatedAt(a) || String(b.id).localeCompare(String(a.id))
      );

      const pending = readPendingVocabWrite();
      const me = studentsRef.current.find(s => String(s.email || "").trim().toLowerCase() === vocabEmail);
      const legacyNotebook = Array.isArray(me?.vocabNotebook) ? me.vocabNotebook : [];
      const legacyTombstones = Array.isArray(me?.vocabTombstones) ? me.vocabTombstones : [];
      let notebook = snapshotNotebook;
      let tombstones = snapshotTombstones;
      const shouldMigrateLegacy = snap.empty && !vocabMigrationAttemptedRef.current[vocabEmail]
        && (legacyNotebook.length > 0 || legacyTombstones.length > 0);

      if (shouldMigrateLegacy) vocabMigrationAttemptedRef.current[vocabEmail] = true;
      if (shouldMigrateLegacy) {
        const merged = mergeVocabNotebook(
          snapshotNotebook,
          legacyNotebook,
          snapshotTombstones,
          legacyTombstones
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
        const serverCards = new Map(snapshotNotebook.map(card => [String(card.id), card]));
        const serverTombs = new Set(snapshotTombstones.map(String));
        const confirmedCards = pending.notebook.every((card: any) => {
          if (!card?.id) return true;
          const serverCard = serverCards.get(String(card.id));
          return serverCard && vocabCardSignature(serverCard) === vocabCardSignature(card);
        });
        const confirmedDeletes = (pending.tombstones || []).every((id: any) => serverTombs.has(String(id)));
        if (confirmedCards && confirmedDeletes) {
          clearPendingVocabWrite();
          vocabPendingRetryAttemptedRef.current[vocabEmail] = false;
        } else if (!vocabPersistInFlightRef.current[vocabEmail]
                   && !vocabPendingRetryAttemptedRef.current[vocabEmail]) {
          // A prior tab may have closed before Firestore acknowledged its write. Retry once,
          // but keep the server-confirmed list visible until this retry is actually confirmed.
          vocabPendingRetryAttemptedRef.current[vocabEmail] = true;
          vocabPersistInFlightRef.current[vocabEmail] = true;
          void persistVocabCards(vocabEmail, pending.notebook, pending.tombstones || [])
            .catch(error => console.error("Dedicated vocab retry failed:", error))
            .finally(() => { vocabPersistInFlightRef.current[vocabEmail] = false; });
        }
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

  useEffect(() => {
    if (userRole !== "STUDENT" || !loaded || !currentUser?.email || activeExam || realExamSession) return;
    try {
      const saved = JSON.parse(localStorage.getItem(realExamSessionKey()) || "null");
      if (!saved?.packageId || !saved?.packageAttemptId || !saved?.testTakerId) return;
      const pkg = realExamPackages.find(item => item.id === saved.packageId);
      const completedQuizIds = Array.isArray(saved.completedQuizIds) ? saved.completedQuizIds : [];
      const finished = pkg?.quizIds?.length && pkg.quizIds.every(id => completedQuizIds.includes(id));
      if (!pkg || !pkg.active || finished) {
        persistRealExamSession(null);
        return;
      }
      setRealExamSession({ ...saved, completedQuizIds, startedAt: Number(saved.startedAt) || Date.now() });
    } catch (error) {}
  }, [userRole, loaded, currentUser?.email, activeExam, realExamSession, realExamPackages]);

  useEffect(() => {
    if (!realExamInstructionGate) return;
    const video = document.getElementById("real-exam-instruction-video") as HTMLVideoElement | null;
    if (!video) return;
    let maxSeen = 0;
    const syncProgress = () => {
      const duration = Number(video.duration) || 0;
      const current = Number(video.currentTime) || 0;
      maxSeen = Math.max(maxSeen, current);
      setRealExamInstructionGate(gate => gate ? { ...gate, currentTime: maxSeen, duration: duration || gate.duration || 0 } : gate);
    };
    const preventRewind = () => {
      if (video.currentTime + 0.35 < maxSeen) video.currentTime = maxSeen;
    };
    const keepPlaying = () => {
      if (!video.ended) void video.play().catch(() => {});
    };
    const complete = () => setRealExamInstructionGate(gate => gate ? { ...gate, ready: true, currentTime: Number(video.duration) || gate.currentTime, duration: Number(video.duration) || gate.duration } : gate);
    video.controls = false;
    video.disablePictureInPicture = true;
    video.volume = Math.max(0, Math.min(1, realExamAudioVolume / 100));
    video.muted = realExamAudioMuted || realExamAudioVolume <= 0;
    video.addEventListener("loadedmetadata", syncProgress);
    video.addEventListener("timeupdate", syncProgress);
    video.addEventListener("seeking", preventRewind);
    video.addEventListener("pause", keepPlaying);
    video.addEventListener("ended", complete);
    keepPlaying();
    return () => {
      video.removeEventListener("loadedmetadata", syncProgress);
      video.removeEventListener("timeupdate", syncProgress);
      video.removeEventListener("seeking", preventRewind);
      video.removeEventListener("pause", keepPlaying);
      video.removeEventListener("ended", complete);
      video.pause();
    };
  }, [realExamInstructionGate?.nonce, realExamInstructionGate?.videoUrl]);

  useEffect(() => {
    if (!realExamInstructionGate) return;
    const video = document.getElementById("real-exam-instruction-video") as HTMLVideoElement | null;
    if (!video) return;
    video.volume = Math.max(0, Math.min(1, realExamAudioVolume / 100));
    video.muted = realExamAudioMuted || realExamAudioVolume <= 0;
    if (!video.ended) void video.play().catch(() => {});
  }, [realExamAudioMuted, realExamAudioVolume, realExamInstructionGate?.nonce]);

  useEffect(() => {
    if (userRole !== "STUDENT" || !realExamSession) {
      setRealExamFullscreenBlocked(false);
      return;
    }
    const hasNativeExamFullscreen = () => {
      if (!document.fullscreenElement) return false;
      const screenHeight = Number(window.screen?.height) || 0;
      const viewportHeight = Math.max(Number(window.innerHeight) || 0, Number(window.visualViewport?.height) || 0);
      return !screenHeight || screenHeight - viewportHeight <= 8;
    };
    const syncFullscreenGate = () => setRealExamFullscreenBlocked(!hasNativeExamFullscreen());
    requestRealExamFullscreen();
    const initialTimer = window.setTimeout(syncFullscreenGate, 180);
    const watchdog = window.setInterval(syncFullscreenGate, 900);
    document.addEventListener("fullscreenchange", syncFullscreenGate);
    window.addEventListener("focus", syncFullscreenGate);
    window.addEventListener("resize", syncFullscreenGate);
    window.visualViewport?.addEventListener("resize", syncFullscreenGate);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(watchdog);
      document.removeEventListener("fullscreenchange", syncFullscreenGate);
      window.removeEventListener("focus", syncFullscreenGate);
      window.removeEventListener("resize", syncFullscreenGate);
      window.visualViewport?.removeEventListener("resize", syncFullscreenGate);
    };
  }, [userRole, realExamSession?.packageAttemptId]);

  // Client-side deterrence for student accounts. It deliberately does not use a
  // debugger loop: that pattern freezes legitimate devices and is trivially bypassed.
  useEffect(() => {
    if (userRole !== "STUDENT") return;
    const blockContextMenu = (event: MouseEvent) => event.preventDefault();
    const blockShortcut = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const blocked = event.key === "F12"
        || ((event.ctrlKey || event.metaKey) && ["u", "s"].includes(key))
        || ((event.ctrlKey || event.metaKey) && event.shiftKey && ["i", "j", "c"].includes(key));
      if (!blocked) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("contextmenu", blockContextMenu, true);
    window.addEventListener("keydown", blockShortcut, true);
    return () => {
      window.removeEventListener("contextmenu", blockContextMenu, true);
      window.removeEventListener("keydown", blockShortcut, true);
    };
  }, [userRole]);

  useEffect(() => {
    const isProtectedExam = userRole === "STUDENT" && !!activeExam && !isPreview && !isPracticeQuiz(activeExam);
    if (!isProtectedExam) return;
    let consecutiveDimensionSignals = 0;
    const recordDevToolsIncident = () => {
      const now = Date.now();
      if (now - securityIncidentRef.current < 12000) return;
      securityIncidentRef.current = now;
      setSecurityNotice("A security tool was detected. Your test has been paused and this event was recorded.");
      setHardLocked(true);
      setExamCheatCount(count => count + 1);
      setSystemLogs(prev => [{
        id: `security_${now}`,
        errorType: "DEVTOOLS_OPENED",
        message: "Student security guard detected a developer-tools signal during an exam.",
        context: JSON.stringify({ quizId: activeExam.id, email: currentUser?.email || "Unknown" }),
        timestamp: new Date().toLocaleString("vi-VN"),
        email: currentUser?.email || "Unknown"
      }, ...prev].slice(0, 50));
    };
    const inspectDimensions = () => {
      const widthGap = Math.max(0, window.outerWidth - window.innerWidth);
      const heightGap = Math.max(0, window.outerHeight - window.innerHeight);
      if (widthGap > 180 || heightGap > 180) consecutiveDimensionSignals += 1;
      else consecutiveDimensionSignals = 0;
      if (consecutiveDimensionSignals >= 2) recordDevToolsIncident();
    };
    const timer = window.setInterval(inspectDimensions, 2000);
    window.addEventListener("resize", inspectDimensions);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", inspectDimensions);
    };
  }, [activeExam?.id, currentUser?.email, isPreview, userRole]);

  // FIX: Sync editingQuizRef với editingQuiz state
  useEffect(() => {
      editingQuizRef.current = editingQuiz;
      if (editingQuiz && examBuilderSaveState === "saved") setExamBuilderSaveState("idle");
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
                      if (!isPracticeQuiz(saved.quiz) && saved.quiz.isSEBRequired && !navigator.userAgent.includes("SEB")) {
                          setSebGuideQuiz(saved.quiz);
                          return;
                      }

                      // Practice survives a refresh/resume without a proctoring penalty.
                      let restoredCheatCount = isPracticeQuiz(saved.quiz) ? (saved.cheatCount || 0) : (saved.cheatCount || 0) + 1;
                      setExamCheatCount(restoredCheatCount);
                      if (!isPracticeQuiz(saved.quiz) && restoredCheatCount >= 3) {
                          setGracePeriod(0); // Cưỡng chế nộp bài ngay lập tức nếu quá 3 lần
                      } else if (!isPracticeQuiz(saved.quiz)) {
                          setHardLocked(true); // Khóa màn hình bắt gõ chữ RETURN
                      }

                      setActiveExam(saved.quiz); 
                      if (saved.quiz?.realExamContext) {
                          const ctx = saved.quiz.realExamContext;
                          let savedRealSession: any = null;
                          try { savedRealSession = JSON.parse(localStorage.getItem(realExamSessionKey()) || "null"); } catch (error) {}
                          const restoredSession: RealExamSession = {
                            packageId: ctx.packageId,
                            packageAttemptId: ctx.packageAttemptId,
                            testTakerId: ctx.testTakerId,
                            completedQuizIds: savedRealSession?.packageAttemptId === ctx.packageAttemptId && Array.isArray(savedRealSession.completedQuizIds) ? savedRealSession.completedQuizIds : [],
                            startedAt: Date.now(),
                          };
                          setRealExamSession(restoredSession);
                          persistRealExamSession(restoredSession);
                      }
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
    if (activeExam && userRole === "STUDENT" && !isPreview && !isPracticeQuiz(activeExam) && gracePeriod === null && !hardLocked) {
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
    if (!activeExam || userRole !== "STUDENT" || isPracticeQuiz(activeExam)) return;

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

        if (state.activeExam && shouldDelayListeningExamTimer(state.activeExam, state.isPreview) && !state.examStartTime) {
            setExamTimeLeft(state.activeExam.timeLimit * 60);
            return;
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
            const warningMilestones = [
                { seconds: 600, urgency: "notice" as const, vi: "Còn 10 phút làm bài. Hãy rà soát lại các câu hỏi.", en: "10 minutes remaining. Review your answers.", beep: 200 },
                { seconds: 300, urgency: "notice" as const, vi: "Còn 5 phút làm bài. Hãy rà soát lại các câu hỏi.", en: "5 minutes remaining. Review your answers.", beep: 300 },
                { seconds: 60, urgency: "urgent" as const, vi: "Còn 1 phút làm bài. Hãy hoàn tất kiểm tra cuối cùng.", en: "1 minute remaining. Finish your final checks.", beep: 500 },
            ];
            const nextWarning = warningMilestones.find(warning =>
                exactTimeLeft <= warning.seconds && exactTimeLeft > warning.seconds - 10 && !timeAlertMilestonesRef.current.has(warning.seconds)
            );
            if (nextWarning) {
                timeAlertMilestonesRef.current.add(nextWarning.seconds);
                showExamTimeAlert(i18n.language === "vi" ? nextWarning.vi : nextWarning.en, nextWarning.urgency);
                if (state.enableTimerBeep) playBeep(nextWarning.urgency === "urgent" ? 1000 : 880, nextWarning.beep);
            }
            if (!nextWarning && exactTimeLeft <= 60 && exactTimeLeft % 10 === 0) { if (state.enableTimerBeep) playBeep(1000, 500); }
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
        const timeout = setTimeout(() => {
            try {
                localStorage.setItem('ielts_exam_draft', JSON.stringify(editingQuiz));
            } catch (err: any) {
                try {
                    // Quota exceeded: strip large base64 data URLs before caching draft
                    const sanitized = JSON.parse(JSON.stringify(editingQuiz, (key, value) => {
                        if (typeof value === 'string' && value.startsWith('data:image/') && value.length > 1000) {
                            return '';
                        }
                        return value;
                    }));
                    localStorage.setItem('ielts_exam_draft', JSON.stringify(sanitized));
                } catch {
                    // Gracefully ignore local draft caching if still over quota
                }
            }
        }, 4000);
        const handleSaveShortcut = (e: KeyboardEvent) => {
            if (e.ctrlKey && e.key.toLowerCase() === 's') {
                e.preventDefault();
            }
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
    if (!preloadOrActiveAudioUrl) {
      setIsAudioReadyToPlay(true);
      return;
    }
    setIsAudioReadyToPlay(false);

    const audio = audioRef.current;
    if (audio) {
      audio.preload = "auto";
      if (audio.readyState === 0 && (audio.networkState === HTMLMediaElement.NETWORK_EMPTY || audio.networkState === HTMLMediaElement.NETWORK_NO_SOURCE)) {
        try { audio.load(); } catch { }
      }
      checkAndSetAudioReady(audio);
    }

    const fallbackTimer = window.setTimeout(() => {
      setIsAudioReadyToPlay(true);
    }, 6000);

    return () => {
      window.clearTimeout(fallbackTimer);
    };
  }, [preloadOrActiveAudioUrl]);

  useEffect(() => {
    if (!preloadOrActiveAudioUrl) return;
    try {
      const u = new URL(preloadOrActiveAudioUrl, window.location.href);
      const origin = u.origin;
      if (!origin || origin === window.location.origin) return;

      let preconnect = document.querySelector(`link[rel="preconnect"][href="${origin}"]`) as HTMLLinkElement | null;
      let dnsPrefetch = document.querySelector(`link[rel="dns-prefetch"][href="${origin}"]`) as HTMLLinkElement | null;
      let createdPreconnect = false;
      let createdDnsPrefetch = false;

      if (!preconnect) {
        preconnect = document.createElement("link");
        preconnect.rel = "preconnect";
        preconnect.href = origin;
        preconnect.crossOrigin = "anonymous";
        document.head.appendChild(preconnect);
        createdPreconnect = true;
      }
      if (!dnsPrefetch) {
        dnsPrefetch = document.createElement("link");
        dnsPrefetch.rel = "dns-prefetch";
        dnsPrefetch.href = origin;
        document.head.appendChild(dnsPrefetch);
        createdDnsPrefetch = true;
      }

      return () => {
        if (createdPreconnect && preconnect?.parentNode) preconnect.parentNode.removeChild(preconnect);
        if (createdDnsPrefetch && dnsPrefetch?.parentNode) dnsPrefetch.parentNode.removeChild(dnsPrefetch);
      };
    } catch { }
  }, [preloadOrActiveAudioUrl]);

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
              if (!isListeningReviewAudio() && !isPracticeQuiz(activeExam) && (activeExam as any)?.audioMode !== "practice") return;
              const audio = audioRef.current;
              if (!audio) return;
              audio.currentTime = Math.max(0, audio.currentTime - (details.seekOffset || 10));
              if (isListeningReviewAudio()) setRvAudioCur(audio.currentTime || 0);
              else setAudioCur(audio.currentTime || 0);
              updateExamMediaSessionPosition(audio);
          });
          navigator.mediaSession.setActionHandler("seekforward", (details: MediaSessionActionDetails) => {
              if (!isListeningReviewAudio() && !isPracticeQuiz(activeExam) && (activeExam as any)?.audioMode !== "practice") return;
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
      if (!activeExam && !pendingExamState && !realExamInstructionGate) {
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
          setSelectedDragAnswer("");
          setSaveStatus("Saved");
      }
  }, [activeExam, pendingExamState, realExamInstructionGate]);

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

  const performSyncData = async (newData: any) => {
    // CHỐNG "GIẬT" KHI XÓA & ĐỒNG BỘ ĐA THIẾT BỊ:
    lastLocalMutationAtRef.current = Date.now();
    const quizDeleteIds = Array.isArray(newData.__quizDeletedIds) ? newData.__quizDeletedIds.map(String) : [];
    const deletedHistoryIds = Array.isArray(newData.__deletedHistoryIds) ? newData.__deletedHistoryIds.map(String) : [];
    const deletedScheduleIds = Array.isArray(newData.__deletedScheduleIds) ? newData.__deletedScheduleIds.map(String) : [];
    const deletedTransactionIds = Array.isArray(newData.__deletedTransactionIds) ? newData.__deletedTransactionIds.map(String) : [];
    const examFolderTombstones = Array.isArray(newData.__examFolderTombstones) ? newData.__examFolderTombstones.map(normalizeFolderPath) : [];
    const realExamPackageDeletedIds = Array.isArray(newData.__realExamPackageDeletedIds) ? newData.__realExamPackageDeletedIds.map(String) : [];
    const coinOperation = newData.__coinOperation?.id && newData.__coinOperation?.studentId
      ? newData.__coinOperation as CoinOperation : null;
    const pendingVocab = newData.__vocabPending && Array.isArray(newData.__vocabPending.notebook)
      ? newData.__vocabPending : null;
    const quizUpserts = Array.isArray(newData.__quizUpserts)
      ? newData.__quizUpserts
      : (Array.isArray(newData.quizzes) ? newData.quizzes : []);
    const hasQuizCatalogWrite = quizUpserts.length > 0 && userRole === "TEACHER";
    const questAssignmentsForMerge = Array.isArray(newData.topicAssignments)
      ? newData.topicAssignments as TopicAssignment[]
      : topicAssignments;
    if (hasQuizCatalogWrite) {
      writePendingQuizWrite(quizUpserts, quizDeleteIds);
    }
    if (pendingVocab && userRole === "STUDENT") {
      writePendingVocabWrite(pendingVocab.notebook, pendingVocab.tombstones || []);
    }
    if (coinOperation) writePendingCoinOperation(coinOperation);
    writeInFlightRef.current++;
    try {
      if (hasQuizCatalogWrite) {
        // Exams are deliberately written outside the workspace document. A large DOCX
        // import must not be rejected because unrelated workspace data fills that blob.
        await persistQuizCatalog(quizUpserts, quizDeleteIds);
        clearPendingQuizWrite();
      }
      // Do not mirror the catalog back into the old single Firestore document.
      newData = { ...newData };
      delete newData.quizzes;
      delete newData.__quizUpserts;
      if (!Object.keys(newData).some(key => !["__quizDeletedIds", "__quizUpserts", "__vocabPending", "__coinOperation", "__deletedHistoryIds", "__deletedScheduleIds", "__deletedTransactionIds", "__examFolderTombstones", "__realExamPackageDeletedIds"].includes(key))
          && !coinOperation && !pendingVocab) return true;
      await runTransaction(db, async (transaction) => {
        const sfDoc = await transaction.get(DB_DOC_REF);
        if (!sfDoc.exists()) {
          const initialData = { ...newData };
          delete initialData.__quizDeletedIds;
          delete initialData.__quizUpserts;
          delete initialData.__vocabPending;
          delete initialData.__coinOperation;
          delete initialData.__deletedHistoryIds;
          delete initialData.__deletedScheduleIds;
          delete initialData.__deletedTransactionIds;
          delete initialData.__examFolderTombstones;
          delete initialData.__realExamPackageDeletedIds;
          if (Array.isArray(initialData.quizzes) && quizDeleteIds.length) {
            initialData.quizzes = mergeQuizCatalog([], initialData.quizzes, quizDeleteIds);
            initialData.quizTombstones = quizDeleteIds.slice(-1000);
          }
          if (coinOperation) {
            // Most optimistic writes already carry the updated balance. A retry-only
            // operation has no students payload and must be applied here once.
            if (!Array.isArray(newData.students)) {
              initialData.students = applyCoinOperation(Array.isArray(initialData.students) ? initialData.students : [], coinOperation);
            }
            initialData.coinTransactions = [coinOperation];
          }
          transaction.set(DB_DOC_REF, JSON.parse(JSON.stringify(initialData)));
          return;
        }
        
        const serverData = sfDoc.data() || {};
        const finalUpdate: any = {};
        const serverCoinTransactions = Array.isArray(serverData.coinTransactions) ? serverData.coinTransactions : [];
        const coinAlreadyApplied = !!coinOperation && serverCoinTransactions.some((entry: any) => String(entry?.id || "") === String(coinOperation.id));
        const reviewAlreadyClaimed = !!coinOperation && coinOperation.kind === "REVIEW_REWARD" && !!coinOperation.reviewedQuizId
          && (Array.isArray(serverData.students) ? serverData.students : []).some((student: any) =>
            String(student?.id || "") === String(coinOperation.studentId || "")
            && Array.isArray(student?.inventory?.reviewedQuizzes)
            && student.inventory.reviewedQuizzes.includes(coinOperation.reviewedQuizId)
          );
        const shouldApplyCoinOperation = !!coinOperation && !coinAlreadyApplied && !reviewAlreadyClaimed;
        const serverStudents = shouldApplyCoinOperation
          ? applyCoinOperation(Array.isArray(serverData.students) ? serverData.students : [], coinOperation)
          : (Array.isArray(serverData.students) ? serverData.students : []);
        const coinLedger = shouldApplyCoinOperation
          ? [...serverCoinTransactions, coinOperation]
          : serverCoinTransactions;
        const hasCoinLedgerFor = (studentId: string) => coinLedger.some((entry: any) => String(entry?.studentId || "") === String(studentId));

        const mergedHistoryTombstones = Array.from(new Set([
          ...(Array.isArray(serverData.deletedHistoryIds) ? serverData.deletedHistoryIds : []),
          ...deletedHistoryIds,
        ].map(String))).slice(-1000);

        const mergedScheduleTombstones = Array.from(new Set([
          ...(Array.isArray(serverData.deletedScheduleIds) ? serverData.deletedScheduleIds : []),
          ...deletedScheduleIds,
        ].map(String))).slice(-1000);

        const mergedTransactionTombstones = Array.from(new Set([
          ...(Array.isArray(serverData.deletedTransactionIds) ? serverData.deletedTransactionIds : []),
          ...deletedTransactionIds,
        ].map(String))).slice(-1000);

        const mergedFolderTombstones = Array.from(new Set([
          ...(Array.isArray(serverData.examFolderTombstones) ? serverData.examFolderTombstones : []),
          ...examFolderTombstones,
        ].map(normalizeFolderPath))).slice(-500);

        const localDeletedPkgIds = readLocalDeletedPackageIds();
        const mergedRealExamPackageTombstones = Array.from(new Set([
          ...(Array.isArray(serverData.realExamPackageTombstones) ? serverData.realExamPackageTombstones : []),
          ...realExamPackageDeletedIds,
          ...localDeletedPkgIds,
        ].map(String))).slice(-1000);

        if (mergedHistoryTombstones.length) finalUpdate.deletedHistoryIds = mergedHistoryTombstones;
        if (mergedScheduleTombstones.length) finalUpdate.deletedScheduleIds = mergedScheduleTombstones;
        if (mergedTransactionTombstones.length) finalUpdate.deletedTransactionIds = mergedTransactionTombstones;
        if (mergedFolderTombstones.length) finalUpdate.examFolderTombstones = mergedFolderTombstones;
        if (mergedRealExamPackageTombstones.length) finalUpdate.realExamPackageTombstones = mergedRealExamPackageTombstones;

        const mergeEntityArray = (serverArr: any[], localArr: any[], tombstoneSet: Set<string>) => {
          const map = new Map<string, any>();
          (Array.isArray(serverArr) ? serverArr : []).forEach(item => {
            const id = String(item?.id ?? "");
            if (id && !tombstoneSet.has(id)) map.set(id, item);
          });
          (Array.isArray(localArr) ? localArr : []).forEach(item => {
            const id = String(item?.id ?? "");
            if (id && !tombstoneSet.has(id)) {
              const existing = map.get(id);
              if (!existing) {
                map.set(id, item);
              } else {
                const localRev = Number(item.revision) || 0;
                const serverRev = Number(existing.revision) || 0;
                const localTime = Number(item.updatedAt || item.timestamp || 0);
                const serverTime = Number(existing.updatedAt || existing.timestamp || 0);
                if (localRev > serverRev || (localRev === serverRev && localTime >= serverTime)) {
                  map.set(id, { ...existing, ...item });
                } else {
                  map.set(id, { ...item, ...existing });
                }
              }
            }
          });
          return Array.from(map.values());
        };

        Object.keys(newData).forEach((key) => {
          if (key === "__quizDeletedIds") return;
          if (key === "__quizUpserts") return;
          if (key === "__vocabPending") return;
          if (key === "__coinOperation") return;
          if (key === "__deletedHistoryIds") return;
          if (key === "__deletedScheduleIds") return;
          if (key === "__deletedTransactionIds") return;
          if (key === "__examFolderTombstones") return;
          if (key === "__realExamPackageDeletedIds") return;
          const localVal = newData[key];
          const serverVal = key === "students" ? serverStudents : serverData[key];

          if (!Array.isArray(localVal)) {
            finalUpdate[key] = localVal;
            return;
          }

          const serverArr = Array.isArray(serverVal) ? serverVal : [];

          // Quest attempts are student-owned, append-only records. Never replace this
          // array with an older browser snapshot: merge each node by immutable attempt ID.
          if (key === "questProgress") {
            finalUpdate.questProgress = mergeQuestProgressCollections(serverArr, localVal, questAssignmentsForMerge);
            return;
          }

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
            if (key === "history") {
              finalUpdate.history = mergeEntityArray(serverArr, localVal, new Set(mergedHistoryTombstones));
            } else if (key === "schedules") {
              finalUpdate.schedules = mergeEntityArray(serverArr, localVal, new Set(mergedScheduleTombstones));
            } else if (key === "transactions") {
              finalUpdate.transactions = mergeEntityArray(serverArr, localVal, new Set(mergedTransactionTombstones));
            } else if (key === "examFolders") {
              const serverFolders = Array.isArray(serverVal) ? serverVal.map(normalizeFolderPath).filter(Boolean) : [];
              const localFolders = Array.isArray(localVal) ? localVal.map(normalizeFolderPath).filter(Boolean) : [];
              const tombSet = new Set(mergedFolderTombstones.map(normalizeFolderPath));
              const union = Array.from(new Set([...serverFolders, ...localFolders])).filter(f => f && f !== "Root" && !tombSet.has(f)).sort();
              finalUpdate.examFolders = union;
            } else if (key === "topicAssignments") {
              finalUpdate.topicAssignments = mergeEntityArray(serverArr, localVal, new Set());
            } else if (key === "realExamPackages") {
              finalUpdate.realExamPackages = mergeEntityArray(serverArr, localVal, new Set(mergedRealExamPackageTombstones));
            } else if (key === "sharedLinks") {
              finalUpdate.sharedLinks = mergeEntityArray(serverArr, localVal, new Set());
            } else if (key === "students") {
              finalUpdate[key] = localVal.map((localItem: any) => {
                const serverItem = serverArr.find((s: any) => s.id === localItem.id);
                if (serverItem) {
                    // CHỐNG MẤT QUÀ (GV ghi cũng KHÔNG được làm bay inventory HV): permanents/reviewedQuizzes
                    // là APPEND-ONLY -> union; consumables giữ server làm chuẩn, trừ grant đi kèm
                    // ledger operation vừa được transaction áp chính xác vào serverStudents.
                  const _tsv = serverItem.inventory || {};
                  const _tlc = localItem.inventory || {};
                  const _tuniq = (a: any, b: any) => Array.from(new Set([
                    ...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])
                  ]));
                    const operationTargetsStudent = !!coinOperation
                      && String(coinOperation.studentId || "") === String(serverItem.id || "");
                    const effectiveRevokedPerms: string[] = operationTargetsStudent
                      ? (Array.isArray(_tsv.revokedPermanents) ? _tsv.revokedPermanents : [])
                      : _tuniq(_tsv.revokedPermanents, _tlc.revokedPermanents);
                    const revokedPermSet = new Set(effectiveRevokedPerms.map((x: any) => String(x || "").trim()).filter(Boolean));
                    const mergedPermanents = operationTargetsStudent && coinOperation?.clearAllInventory
                      ? []
                      : _tuniq(_tsv.permanents, _tlc.permanents).filter((p: any) => !revokedPermSet.has(String(p || "").trim()));
                    const mergedInv = {
                      ..._tlc, ..._tsv,
                      permanents: mergedPermanents,
                      revokedPermanents: effectiveRevokedPerms,
                      reviewedQuizzes: _tuniq(_tsv.reviewedQuizzes, _tlc.reviewedQuizzes),
                      consumables: operationTargetsStudent
                        ? { ...(_tsv.consumables || {}) }
                        : (_tsv.consumables || _tlc.consumables || {}),
                      ...(operationTargetsStudent && (coinOperation?.clearAllInventory || (coinOperation?.revokedPermanents && coinOperation.revokedPermanents.length > 0)) ? {
                        equippedTitle: _tsv.equippedTitle || "",
                        equippedTheme: _tsv.equippedTheme || "",
                        equippedFrame: _tsv.equippedFrame || "",
                        equippedPet: _tsv.equippedPet || "",
                      } : {}),
                    };
                    const mergedMyRewards = operationTargetsStudent && (coinOperation?.clearAllInventory || (coinOperation?.revokedRewards && coinOperation.revokedRewards.length > 0))
                      ? (Array.isArray(serverItem.myRewards) ? serverItem.myRewards : [])
                      : _tuniq(serverItem.myRewards, localItem.myRewards);
                  return {
                    ...serverItem,
                    ...localItem,
                    // CHỐNG MẤT XP/COINS: exp & level chỉ TĂNG (HV học/thi + GV log buổi đều CỘNG) -> lấy MAX,
                    // GV ghi bằng state cũ (thấp hơn) KHÔNG bao giờ kéo tụt XP. Cùng lớp bug với vocab/inventory.
                    exp: Math.max(Number(serverItem.exp) || 0, Number(localItem.exp) || 0),
                    level: Math.max(Number(serverItem.level) || 1, Number(localItem.level) || 1),
                    // A ledger-backed balance is authoritative. A stale teacher snapshot must
                    // never resurrect coins already spent by the student.
                    coins: hasCoinLedgerFor(String(serverItem.id || ""))
                      ? (Number(serverItem.coins) || 0)
                      : Math.max(Number(serverItem.coins) || 0, Number(localItem.coins) || 0),
                    // Coin ledger only changes the balance. Keep the append-only inventory
                    // merge here as well, otherwise a milestone that grants Coins + a
                    // permanent Quest gift in the same submission can lose the gift.
                    inventory: mergedInv,
                    myRewards: mergedMyRewards,
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
            } else if (key === "quizResults") {
              const mergedResults = [...serverArr];
              localVal.forEach((localResult: any) => {
                const index = mergedResults.findIndex((serverResult: any) => serverResult.id === localResult.id);
                if (index < 0) mergedResults.push(localResult);
                else mergedResults[index] = { ...mergedResults[index], ...localResult };
              });
              finalUpdate[key] = mergedResults;
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
                      coins: hasCoinLedgerFor(String(serverItem.id || ""))
                        ? (Number(serverItem.coins) || 0)
                        : Math.max(Number(serverItem.coins) || 0, Number(myLocalInfo.coins) || 0),
                      level: Math.max(Number(serverItem.level) || 1, Number(myLocalInfo.level) || 1),
                      vocabNotebook: mergedVocab.notebook,
                      vocabTombstones: mergedVocab.tombstones,
                      // Rewards are append-only student state. Do not let the coin-ledger
                      // fast path discard a permanent gift granted in the same Quest reward.
                      inventory: mergedInventory,
                      myRewards: _uniq(serverItem.myRewards, myLocalInfo.myRewards),
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
              const myEmail = (currentUser?.email || "").toLowerCase();
              const myServerStudent = Array.isArray(serverStudents)
                ? serverStudents.find((s: any) => (s?.email || "").toLowerCase() === myEmail)
                : null;
              const allowedLocalVal = (key === "quizResults" && myServerStudent?.id)
                ? localVal.filter((item: any) => !item?.studentId || String(item.studentId) === String(myServerStudent.id))
                : localVal;
              const mergedArr = [...serverArr];
              allowedLocalVal.forEach((localItem: any) => {
                const idx = mergedArr.findIndex((s: any) => s.id === localItem.id);
                if (idx === -1) {
                  mergedArr.push(localItem);
                } else if (key !== "quizResults" || !myServerStudent?.id || String(mergedArr[idx]?.studentId || "") === String(myServerStudent.id)) {
                  mergedArr[idx] = { ...mergedArr[idx], ...localItem };
                }
              });
              finalUpdate[key] = mergedArr;
            } else if (false) {
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
        if (shouldApplyCoinOperation) {
          finalUpdate.coinTransactions = coinLedger.slice(-2000);
        }
        if (!Object.keys(finalUpdate).length) return;
        const cleanUpdate = JSON.parse(JSON.stringify(finalUpdate));
        transaction.update(DB_DOC_REF, cleanUpdate);
      });
      // Keep the operation until an onSnapshot payload contains its ledger entry.
      // This closes the mobile/background race where a successful transaction is
      // followed by an older cached snapshot that still has the pre-purchase balance.
      // Không xóa retry record tại đây. onSnapshot chỉ xóa sau khi chính snapshot server
      // đã chứa đủ thẻ/tombstone, tránh snapshot cache cũ đè mất thẻ sau khoảng 1 giây.
      return true;
    } catch (error: any) {
      console.error("Critical Sync Blocked:", error);
      // Do not call logErrorToSystem here: it persists via syncData and used to turn one
      // Firestore outage into an unbounded chain of failing transactions.
      if (!syncFailureLogRef.current) {
        syncFailureLogRef.current = true;
        const localFailure: SystemLog = {
          id: `sync_fail_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          errorType: "CRITICAL_SYNC_FAIL",
          message: error.message || String(error),
          context: JSON.stringify({ user: currentUser?.email || "Unknown" }),
          timestamp: new Date().toLocaleString("vi-VN"),
          email: currentUser?.email || "Unknown",
        };
        setSystemLogs(prev => [localFailure, ...prev].slice(0, 50));
        window.setTimeout(() => { syncFailureLogRef.current = false; }, 5000);
      }
      return false;
    } finally {
      // Hết ghi: giữ thêm 1 khoảng ngắn để hứng nốt snapshot CŨ còn sót trên đường truyền,
      // tránh data vừa xóa nhấp nháy hiện lại. State local lúc này đã là nguồn đúng.
      writeInFlightRef.current = Math.max(0, writeInFlightRef.current - 1);
      if (writeInFlightRef.current === 0) {
        suppressSnapshotUntilRef.current = Date.now() + 1400;
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
    e.preventDefault();
    if (loginLoading) return;
    setLoginError("");
    setLoginLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (error) {
      setLoginError("Wrong email or password!");
      setLoginLoading(false);
    }
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
    const typeLabel = (q: QuizQuestion, quiz: Quiz) => inferQuestionCategory(q, quiz).label;
    const typeStats: Record<string, { correct: number; total: number }> = {};
    const studentStats: Record<string, { name: string; types: Record<string, { correct: number; total: number }> }> = {};
    (quizResults || []).forEach(r => {
      if (!r || !r.answers) return;
      const quiz = (quizzes || []).find(q => q && q.id === r.quizId);
      if (!quiz || !Array.isArray(quiz.questions)) return;
      const summary = getQuizScoreSummary(quiz, r.answers || {});
      summary.groups.forEach((group: any) => {
        const q = group.questions[0];
        if (!q) return;
        const label = typeLabel(q, quiz);
        if (!typeStats[label]) typeStats[label] = { correct: 0, total: 0 };
        typeStats[label].total += group.total; typeStats[label].correct += group.score;
        if (!studentStats[r.studentId]) {
          const matched = (students || []).find(s => s && s.id === r.studentId);
          studentStats[r.studentId] = { name: matched?.name || r.studentName || "Student", types: {} };
        }
        const stt = studentStats[r.studentId].types;
        if (!stt[label]) stt[label] = { correct: 0, total: 0 };
        stt[label].total += group.total; stt[label].correct += group.score;
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
  }, [quizResults, quizzes, students]);

  // Tiện ích cho biểu đồ band: rút gọn ngày + tạo chuỗi điểm theo thời gian (sắp theo id = mốc thời gian)
  const shortDate = (s: string) => { const m = String(s || "").match(/\d{1,2}\/\d{1,2}(?:\/\d{2,4})?/); return m ? m[0] : ""; };
  const bandSeries = (results: QuizResult[]) => [...(results || [])]
    .sort((a, b) => parseQuizResultDateMs(a.date, a.submittedAt || a.id) - parseQuizResultDateMs(b.date, b.submittedAt || b.id))
    .map(r => ({
      label: shortDate(r.date),
      band: Number(r.band),
      title: r.quizTitle || "Test",
      fullDate: r.date || ""
    }))
    .filter(d => !isNaN(d.band) && d.band >= 1.0);

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
        const stripTags = (s: any) => String(s ?? "").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
        const g: Record<string, { c: number; t: number }> = {};
        const wrongLines: string[] = [];
        const summary = getQuizScoreSummary(quiz, r.answers || {});
        summary.groups.forEach((group: any) => {
          const q = group.questions[0];
          const label = inferQuestionCategory(q, quiz).label;
          if (!g[label]) g[label] = { c: 0, t: 0 };
          g[label].t += group.total;
          g[label].c += group.score;
          if (group.isFullyCorrect) return;
          wrongCount += group.total - group.score;
          let stu = "", cor = "";
          if (group.isChoiceMultiple) {
            stu = group.multiple.selected.length ? group.multiple.selected.map((idx: any) => stripTags(q.options?.[Number(idx)] ?? idx)).join(" / ") : "(trống)";
            cor = group.multiple.correct.map((idx: any) => stripTags(q.options?.[Number(idx)] ?? idx)).join(" / ");
          } else {
            const sAns = r.answers?.[q.id];
            if (q.type === 'CHOICE') {
            stu = (sAns === undefined || sAns === "") ? "(trống)" : stripTags(q.options?.[Number(sAns)] ?? sAns);
            cor = stripTags(q.options?.[Number(q.correctAnswer)] ?? q.correctAnswer);
            } else if (q.type === 'MATCHING') {
            stu = (sAns === undefined || sAns === "") ? "(trống)" : stripTags(resolveMatchingAnswerText(q, sAns));
            cor = stripTags(resolveMatchingAnswerText(q, q.correctAnswer));
            } else {
              stu = (sAns === undefined || sAns === "") ? "(trống)" : stripTags(sAns);
              cor = stripTags(q.correctAnswer);
            }
          }
          if (wrongLines.length < 30)
            wrongLines.push(`#${getQuizQuestionLabel(quiz.questions, q)} [${label}] HV: "${stu.slice(0, 70)}" | Đúng: "${cor.slice(0, 70)}"`);
        });
        weak = Object.entries(g).map(([k, v]) => `${k}: ${v.c}/${v.t}`).join(", ");
        details = wrongLines.join("\n");
      }
      const API_BASE = getApiBase();
      const resp = await fetch(`${API_BASE}/api/ai_feedback`, {
        method: "POST", headers: await getAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ lang: i18n.language === "vi" ? "vi" : "en", studentName: r.studentName, quizTitle: r.quizTitle, type: quiz?.type || "", score: r.score, total: r.total, band: r.band, weakness: weak, wrongCount, details })
      });
      const data = await readApiJson(resp);
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
      // Keep paragraph boundaries for reading evidence. Removing tags without a
      // separator makes two separate paragraphs look like one AI quotation.
      const stripTags = (s: any) => String(s ?? "")
        .replace(/<(?:br)\s*\/?\s*>/gi, "\n")
        .replace(/<\/(?:p|div|h[1-6]|li|tr|blockquote)>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/[^\S\r\n]+/g, " ")
        .replace(/\n{2,}/g, "\n")
        .trim();
      const cleanOptText = (raw: any): string => {
        let s = stripTags(raw);
        while (/^\s*\(?[A-Za-z0-9]+[\.\)\:]\s*/.test(s)) {
          s = s.replace(/^\s*\(?[A-Za-z0-9]+[\.\)\:]\s*/, "").trim();
        }
        return s;
      };
      const optStr = q.type === 'MATCHING'
        ? (q.options || []).map((o) => stripTags(cleanOptionAnswerText(o))).join(" | ")
        : (q.options || []).map((o, idx) => `${String.fromCharCode(65 + idx)}. ${cleanOptText(o)}`).join(" | ");
      let correctStr = "", stuStr = "";
      const blank = studentAnsRaw === undefined || studentAnsRaw === "" || studentAnsRaw === null || (Array.isArray(studentAnsRaw) && studentAnsRaw.length === 0);
      if (q.type === 'DRAG_DROP_HEADING') {
        const headingCatalog = getHeadingCatalog([
          q,
          quiz,
          ...((quiz as any)?.questions || []),
          ...(((quiz as any)?.sections || []).flatMap((section: any) => [section, ...(section?.questions || [])])),
        ]);
        const headingFor = (value: any) => headingCatalog.get(normalizeHeadingId(value));
        const headingLabel = (value: any) => {
          const heading = headingFor(value);
          const id = heading?.id || normalizeHeadingId(value);
          return heading?.text ? `${id}. ${headingPlainText(heading.text)}` : String(value ?? "");
        };
        correctStr = headingLabel(q.correctAnswer);
        stuStr = blank ? "(trống)" : headingLabel(studentAnsRaw);
      } else if (q.type === 'CHOICE') {
        const cNum = Number(q.correctAnswer);
        const cRaw = (!isNaN(cNum) && q.options?.[cNum]) ? q.options[cNum] : q.correctAnswer;
        const cLetter = !isNaN(cNum) ? `${String.fromCharCode(65 + cNum)}. ` : (/^[A-Za-z]$/.test(String(q.correctAnswer).trim()) ? `${String(q.correctAnswer).trim().toUpperCase()}. ` : "");
        correctStr = `${cLetter}${cleanOptText(cRaw)}`;

        const sNum = Number(studentAnsRaw);
        const sRaw = (!isNaN(sNum) && q.options?.[sNum]) ? q.options[sNum] : studentAnsRaw;
        const sLetter = !isNaN(sNum) ? `${String.fromCharCode(65 + sNum)}. ` : (/^[A-Za-z]$/.test(String(studentAnsRaw).trim()) ? `${String(studentAnsRaw).trim().toUpperCase()}. ` : "");
        stuStr = blank ? "(trống)" : `${sLetter}${cleanOptText(sRaw)}`;
      } else if (q.type === 'MATCHING') {
        correctStr = stripTags(resolveMatchingAnswerText(q, q.correctAnswer));
        stuStr = blank ? "(trống)" : stripTags(resolveMatchingAnswerText(q, studentAnsRaw));
      } else if (q.type === 'CHOICE_MULTIPLE') {
        const arr = Array.isArray(q.correctAnswer) ? q.correctAnswer : [q.correctAnswer];
        correctStr = arr.map((idx: any) => stripTags(q.options?.[Number(idx)] ?? idx)).join(" / ");
        const selected = normalizeChoiceMultipleIndexes(studentAnsRaw);
        stuStr = blank ? "(trống)" : selected.map(index => stripTags(q.options?.[index] ?? index)).join(" / ");
      } else {
        correctStr = stripTags(q.correctAnswer);
        stuStr = blank ? "(trống)" : stripTags(studentAnsRaw);
      }
      const resolvedCtx = resolveReviewQuestionContext(q, quiz, reviewSectionIdx);
      const fullQuiz = resolvedCtx.fullQuiz;
      const secs = resolvedCtx.secs;
      const qSectionIndex = resolvedCtx.secIdx;
      const quizTypeLower = String(fullQuiz?.type || quiz?.type || "").toLowerCase();
      const isListeningQuestion = quizTypeLower.includes("listen") || (quizTypeLower.includes("integrated") && qSectionIndex === 0);

      // Robust passage resolution with fallback chain
      let qPassage: string = resolvedCtx.rawSourceHtml
        || (qSectionIndex >= 0 && secs?.[qSectionIndex]?.passage)
        || (qSectionIndex >= 0 && secs?.[qSectionIndex]?.passageHtml)
        || fullQuiz?.passage
        || (fullQuiz as any)?.passageHtml
        || "";

      // Robust transcript resolution with fallback chain
      const fullTranscript = stripTags(
        (qSectionIndex >= 0 && secs?.[qSectionIndex]?.transcript) ||
        fullQuiz?.transcript ||
        (fullQuiz as any)?.transcriptHtml ||
        (isListeningQuestion ? (
          resolvedCtx.resolvedSourceText ||
          (qSectionIndex >= 0 && secs?.[qSectionIndex]?.passage) ||
          secs?.[0]?.passage ||
          secs?.[0]?.passageHtml ||
          fullQuiz?.passage ||
          (fullQuiz as any)?.passageHtml ||
          (Array.isArray(secs) ? secs.find((s: any) => s?.passage && stripTags(s.passage).length > 20)?.passage : "")
        ) : "")
      );
      const matchingKind = (() => {
        if (q.type === 'DRAG_DROP_HEADING') return 'headings';
        if (q.type !== 'MATCHING') return '';
        const optionsAreParagraphLabels = (q.options || []).length > 0 && (q.options || []).every((opt: any) => /^[A-Z](?:[.)])?$/i.test(stripTags(opt).trim()));
        return optionsAreParagraphLabels ? 'paragraph_information' : 'features';
      })();
      const matchingTargetLabel = matchingKind === 'paragraph_information' ? correctStr.trim().toUpperCase().replace(/[.)]$/, '') : '';
      const matchingTargetText = (() => {
        if (!matchingTargetLabel || !/^[A-Z]$/.test(matchingTargetLabel)) return '';
        const doc = new DOMParser().parseFromString(qPassage || '', 'text/html');
        const paragraphs = Array.from(doc.body.children)
          .filter((el) => !el.querySelector('h1,h2,h3,h4,h5,h6'))
          .map((el) => stripTags(el.innerHTML))
          .filter((text) => text.length >= 30);
        return paragraphs[matchingTargetLabel.charCodeAt(0) - 65] || '';
      })();
      const timestampQuestions = isListeningQuestion
        ? (Array.isArray(secs) && qSectionIndex >= 0 ? (secs[qSectionIndex]?.questions || []) : (fullQuiz?.questions || []))
        : [];
      const questionFingerprint = (question: any) => `${stripTags(question?.text).toLowerCase()}|${stripTags(question?.correctAnswer).toLowerCase()}`;
      let timestampQuestionIndex = isListeningQuestion
        ? timestampQuestions.findIndex((question: any) => String(question?.id || "") === String(q.id || ""))
        : -1;
      // Review data can be an older snapshot whose question IDs differ from the current
      // catalog. Match the actual item before falling back to audio order.
      if (isListeningQuestion && timestampQuestionIndex < 0) {
        const fingerprint = questionFingerprint(q);
        timestampQuestionIndex = timestampQuestions.findIndex((question: any) => questionFingerprint(question) === fingerprint);
      }
      if (isListeningQuestion && timestampQuestionIndex < 0) {
        const qNumber = Number((String(q.id || "").match(/\d+(?!.*\d)/) || [])[0]);
        const sectionNumbers = timestampQuestions.map((question: any) => Number((String(question?.id || "").match(/\d+(?!.*\d)/) || [])[0]));
        if (Number.isFinite(qNumber) && sectionNumbers.some(Number.isFinite)) {
          timestampQuestionIndex = sectionNumbers.findIndex((number: number) => number === qNumber);
        }
      }
      // A full 30-minute transcript can exceed the model context. Keep the slice
      // belonging to this part/question, rather than always truncating at Part 1.
      const transcriptForQuestion = (() => {
        const limit = 23000;
        if (!isListeningQuestion || fullTranscript.length <= limit) return fullTranscript;
        const partCount = Array.isArray(secs) && secs.length ? secs.length : 1;
        const partIndex = qSectionIndex >= 0 ? qSectionIndex : 0;
        const withinPart = timestampQuestionIndex >= 0 && timestampQuestions.length
          ? (timestampQuestionIndex + 0.5) / timestampQuestions.length
          : 0.5;
        const center = Math.round(((partIndex + withinPart) / partCount) * fullTranscript.length);
        let start = Math.max(0, Math.min(fullTranscript.length - limit, center - Math.floor(limit / 2)));
        if (start > 0) {
          const markerStart = fullTranscript.indexOf('(', start);
          if (markerStart >= 0 && markerStart < start + 500) start = markerStart;
        }
        return fullTranscript.slice(start, start + limit);
      })();
      // Listening transcript first so its answer-bearing timestamp markers survive the API context limit.
      const ctxParts = isListeningQuestion
        ? [transcriptForQuestion, stripTags(qPassage), stripTags(q.groupContext)].filter(Boolean)
        : [stripTags(q.groupContext), stripTags(qPassage), stripTags(fullQuiz?.transcript)].filter(Boolean);
      const seenCtx = new Set<string>();
      const uniqueCtxParts = ctxParts.filter((part) => {
        const trimmed = part.trim();
        if (!trimmed || seenCtx.has(trimmed)) return false;
        seenCtx.add(trimmed);
        return true;
      });
      const context = uniqueCtxParts.join("\n\n").trim().slice(0, 24000);
      const answerTextForTimestamp = (question: any) => {
        if (!question) return "";
        if (question.type === "CHOICE") {
          return stripTags(question.options?.[Number(question.correctAnswer)] ?? question.correctAnswer);
        }
        if (question.type === "MATCHING") {
          return stripTags(resolveMatchingAnswerText(question, question.correctAnswer));
        }
        if (question.type === "CHOICE_MULTIPLE") {
          const answers = Array.isArray(question.correctAnswer) ? question.correctAnswer : [question.correctAnswer];
          return answers.map((idx: any) => stripTags(question.options?.[Number(idx)] ?? idx)).join(" / ");
        }
        return stripTags(question.correctAnswer);
      };
      const answerSequence = isListeningQuestion
        ? timestampQuestions.map(answerTextForTimestamp)
        : undefined;
      const API_BASE = getApiBase();
      const resp = await fetch(`${API_BASE}/api/ai_explain`, {
        method: "POST", headers: await getAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          lang: i18n.language === "vi" ? "vi" : "en",
          question: resolvedCtx.effectiveQuestionText || stripTags(q.text),
          options: optStr,
          correct: correctStr,
          studentAnswer: stuStr,
          context,
          readingPassage: isListeningQuestion ? "" : stripTags(qPassage).slice(0, 24000),
          isListening: isListeningQuestion,
          questionType: q.type,
          questionSubType: q.subType || "",
          matchingKind,
          matchingTargetLabel,
          matchingTargetText,
          integratedPart: quizTypeLower.includes("integrated") && qSectionIndex >= 0 ? qSectionIndex + 1 : 0,
          isVietnameseHighSchoolIntegrated: quizTypeLower.includes("integrated") && qSectionIndex >= 1 && qSectionIndex <= 6,
          answerSequence,
          questionIndex: timestampQuestionIndex >= 0 ? timestampQuestionIndex : undefined,
          questionCount: timestampQuestions.length || undefined,
          // The backend scores these against real transcript blocks and requires
          // more than one specific clue before it may expose a seek control.
          timestampHints: isListeningQuestion ? [stripTags(q.text), correctStr, optStr].filter(Boolean).join("\n") : "",
        })
      });
      const data = await resp.json();
      if (data.success && (data.explanation || data.structured)) {
        const audioEvidenceSegments = Array.isArray(data.audioEvidenceSegments)
          ? data.audioEvidenceSegments.filter((item: any) => item && typeof item.timestamp === 'string' && typeof item.quote === 'string').slice(0, 1)
          : undefined;
        setExplainMap(prev => ({ ...prev, [q.id]: {
          loading: false,
          text: data.explanation || "",
          audioEvidence: data.audioEvidence && typeof data.audioEvidence.timestamp === 'string' && typeof data.audioEvidence.quote === 'string'
            ? { ...data.audioEvidence, segments: audioEvidenceSegments }
            : undefined,
          audioEvidenceSegments,
          deconstruction: data.deconstruction || undefined,
          structured: data.structured || undefined,
        } }));
      }
      else {
        const message = "" + (data.error || "Could not generate explanation. Please try again.");
        setExplainMap(prev => {
          const next = { ...prev };
          delete next[q.id];
          return next;
        });
        alert(message);
      }
    } catch (e: any) {
      const message = "" + (e?.message || String(e));
      setExplainMap(prev => {
        const next = { ...prev };
        delete next[q.id];
        return next;
      });
      alert(message);
    }
  };

  // Listening: AI nghe audio (1 file lớn) -> upload 1 lần + chép lời theo từng cửa sổ 8 phút rồi ghép -> lưu vào đề
  const makeAudioSafeName = (name: string) => {
    const ext = (name.match(/\.[a-z0-9]+$/i)?.[0] || ".mp3").toLowerCase();
    const base = name.replace(/\.[a-z0-9]+$/i, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "audio";
    return `${base}${ext}`;
  };

  const handleAudioFileUpload = async (file: File) => {
    const quiz = editingQuizRef.current || editingQuiz;
    if (!quiz) return;
    if (!file.type.startsWith("audio/") && !/\.(mp3|m4a|wav|ogg|oga|aac|webm|flac)$/i.test(file.name)) {
      alert("File này không phải audio hợp lệ.");
      return;
    }
    audioUploadCancelledRef.current = false;
    setAudioUploadProgress(0);
    setAudioUploadMsg(t("eb_audio_uploading"));
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Please sign in again before uploading audio.");
      const safeName = makeAudioSafeName(file.name);
      const quizId = String(quiz.id || getTrueTime()).replace(/[^a-zA-Z0-9_-]/g, "");
      const apiBase = getApiBase();
      const token = await user.getIdToken();
      const initController = new AbortController();
      audioUploadAbortRef.current = () => {
        audioUploadCancelledRef.current = true;
        initController.abort();
      };
      const initResponse = await fetch(`${apiBase}/api/exam-audio/uploads`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        signal: initController.signal,
        body: JSON.stringify({
          quizId,
          fileName: safeName,
          contentType: file.type || "audio/mpeg",
          sizeBytes: file.size,
        }),
      });
      const initData = await initResponse.json().catch(() => ({}));
      if (!initResponse.ok || !initData?.uploadUrl || !initData?.uploadId) {
        throw new Error(String(initData?.detail || initData?.error || "Could not prepare the audio upload."));
      }
      const uploadContentType = initData.contentType || initData.requiredHeaders?.["Content-Type"] || file.type || "audio/mpeg";
      let directPutFailed = false;
      let directPutError: any = null;

      try {
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open(String(initData.method || "PUT"), String(initData.uploadUrl), true);
          // Send ONLY the Content-Type header to avoid triggering extra CORS preflight checks
          xhr.setRequestHeader("Content-Type", uploadContentType);
          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable && event.total > 0) {
              setAudioUploadProgress(Math.max(1, Math.round((event.loaded / event.total) * 100)));
            }
          };
          audioUploadAbortRef.current = () => {
            audioUploadCancelledRef.current = true;
            xhr.abort();
          };
          xhr.onerror = () => {
            audioUploadAbortRef.current = null;
            const err: any = new Error("The browser could not reach secure audio storage. Please try again.");
            err.status = xhr.status;
            reject(err);
          };
          xhr.onabort = () => {
            audioUploadAbortRef.current = null;
            reject(new Error("Audio upload was cancelled."));
          };
          xhr.onload = () => {
            audioUploadAbortRef.current = null;
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve();
            } else {
              const err: any = new Error(`Secure audio storage rejected the upload (HTTP ${xhr.status}).`);
              err.status = xhr.status;
              reject(err);
            }
          };
          xhr.send(file);
        });
      } catch (putErr: any) {
        if (audioUploadCancelledRef.current || putErr?.name === "AbortError" || String(putErr?.message || "").includes("cancelled")) {
          throw putErr;
        }
        // If direct PUT encounters network/CORS error (xhr.status === 0), fall back to Firebase Client SDK
        if (putErr?.status === 0 || String(putErr?.message || "").includes("could not reach secure audio storage")) {
          directPutFailed = true;
          directPutError = putErr;
        } else {
          throw putErr;
        }
      }

      if (directPutFailed) {
        console.warn("Direct Storage PUT failed due to CORS/network, falling back to Firebase Client SDK uploadBytesResumable...", directPutError);
        const storagePath = initData.storagePath || `exam-audio/${user.uid}/${initData.uploadId}/${safeName}`;
        const fileRef = storageRef(storage, storagePath);
        const uploadTask = uploadBytesResumable(fileRef, file, { contentType: uploadContentType });
        audioUploadAbortRef.current = () => {
          audioUploadCancelledRef.current = true;
          uploadTask.cancel();
        };
        await new Promise<void>((resolve, reject) => {
          uploadTask.on(
            "state_changed",
            (snapshot) => {
              if (snapshot.totalBytes > 0) {
                setAudioUploadProgress(Math.max(1, Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)));
              }
            },
            (err) => {
              audioUploadAbortRef.current = null;
              reject(err);
            },
            () => {
              audioUploadAbortRef.current = null;
              resolve();
            }
          );
        });
      }
      const completeController = new AbortController();
      audioUploadAbortRef.current = () => {
        audioUploadCancelledRef.current = true;
        completeController.abort();
      };
      const completeResponse = await fetch(`${apiBase}/api/exam-audio/uploads/${encodeURIComponent(String(initData.uploadId))}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` },
        signal: completeController.signal,
        body: "{}",
      });
      const completeData = await completeResponse.json().catch(() => ({}));
      if (!completeResponse.ok || !completeData?.audioUrl) {
        throw new Error(String(completeData?.detail || completeData?.error || "Audio upload finished but could not be finalized."));
      }
      const managedPath = String(completeData.audioUrl);
      const hostedUrl = managedPath.startsWith("/") ? `${apiBase}${managedPath}` : managedPath;
      setEditingQuiz((prev: any) => prev ? { ...prev, audioUrl: hostedUrl } : prev);
      setAudioUploadMsg(t("eb_audio_ready"));
    } catch (e: any) {
      if (audioUploadCancelledRef.current || e?.name === "AbortError") {
        setAudioUploadMsg("");
        return;
      }
      console.error("Audio upload failed:", e);
      setAudioUploadMsg(t("eb_audio_upload_failed"));
      alert(e?.message || String(e));
    } finally {
      audioUploadAbortRef.current = null;
      audioUploadCancelledRef.current = false;
      setTimeout(() => setAudioUploadProgress(null), 1600);
    }
  };

  const cancelAudioFileUpload = () => {
    audioUploadAbortRef.current?.();
  };

  const handleTranscribe = async () => {
    const quiz = editingQuiz;
    if (!quiz || transcribeLoading) return;
    if (!quiz.audioUrl) { alert("Đề này chưa có audio. Hãy dùng nút Upload audio trước khi tạo transcript."); return; }
    if (quiz.transcript && !confirm("Đề đã có transcript. Tạo lại sẽ ghi đè bản cũ. Tiếp tục?")) return;
    const lang = i18n.language === "vi" ? "vi" : "en";
    const API_BASE = getApiBase();
    setTranscribeLoading(true);
    setTranscribeMsg(t('eb_transcribing'));
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Please sign in again before creating a transcript.");
      const resp = await fetch(`${API_BASE}/api/ai_transcribe`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` },
        body: JSON.stringify({ lang, audioUrl: quiz.audioUrl })
      });
      const data = await resp.json();
      if (data.success && data.transcript) {
        const transcript = data.transcript;
        setEditingQuiz((prev: any) => prev ? { ...prev, transcript } : prev);
        const updatedQuiz = { ...quiz, transcript, updatedAt: getTrueTime() };
        const nx = quizzes.map(q => q.id === quiz.id ? updatedQuiz : q);
        setQuizzes(nx); syncData({ __quizUpserts: [updatedQuiz] });
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
  const saveMyVocabNotebook = async (notebook: VocabCard[], tombstones: string[] = []) => {
    const me = findMe();
    if (!me) return false;
    const email = String(currentUser?.email || "").trim().toLowerCase();
    if (!email) return false;
    // Do not raise the visible count optimistically. The collection is the canonical source;
    // the retry record survives a closed tab, but a card appears only after a server read-back.
    writePendingVocabWrite(notebook, tombstones);
    vocabPersistInFlightRef.current[email] = true;
    try {
      const previousCards = new Map((me.vocabNotebook || []).map(card => [String(card.id), card]));
      const previousTombstones = new Set((me.vocabTombstones || []).map(String));
      const mustSeedCollection = !vocabStoreReadyRef.current[email];
      const changedCards = mustSeedCollection
        ? notebook
        : notebook.filter(card => {
            const previous = previousCards.get(String(card.id));
            return !previous || vocabCardSignature(previous) !== vocabCardSignature(card);
          });
      const changedTombstones = mustSeedCollection
        ? tombstones
        : tombstones.filter(id => !previousTombstones.has(String(id)));
      await persistVocabCards(email, changedCards, changedTombstones);
      const confirmed = await readVocabCardsFromServer(email);
      const confirmedCards = new Map(confirmed.notebook.map(card => [String(card.id), card]));
      const confirmedTombstones = new Set(confirmed.tombstones.map(String));
      const missingCard = notebook.some(card => {
        if (!card?.id) return false;
        const serverCard = confirmedCards.get(String(card.id));
        return !serverCard || vocabCardSignature(serverCard) !== vocabCardSignature(card);
      });
      const missingTombstone = tombstones.some(id => !confirmedTombstones.has(String(id)));
      if (missingCard || missingTombstone) {
        throw new Error("Vocabulary write was not confirmed by Firestore.");
      }
      vocabStoreReadyRef.current[email] = true;
      clearPendingVocabWrite();
      vocabPendingRetryAttemptedRef.current[email] = false;
      setStudents(prev => prev.map(student => student.id === me.id
        ? { ...student, vocabNotebook: confirmed.notebook, vocabTombstones: confirmed.tombstones }
        : student
      ));
      return true;
    } catch (error) {
      // Never fall back to the old workspace document after this collection exists: the two
      // stores race and were the source of the phantom "added" count. Pending data is retained
      // for one controlled retry by the listener, while the UI remains on confirmed cards.
      console.error("Vocabulary write was not confirmed; retry record retained:", error);
      return false;
    } finally {
      vocabPersistInFlightRef.current[email] = false;
    }
  };

  const handleGenerateVocab = async () => {
    const me = findMe();
    if (!me || vocabGenLoading) return;
    const stripTags = (s: any) => String(s ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
    const myRes = quizResults.filter(r => r.studentId === me.id && !r.hiddenFromStudent);
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
        const wrongQuestionIds = new Set(
          getQuizScoreSummary(quiz, r.answers || {}).groups
            .filter((group: any) => !group.isFullyCorrect)
            .flatMap((group: any) => group.questions.map((question: any) => question.id))
        );
        (quiz.questions || []).forEach(q => {
          qtext += " " + stripTags(q.text) + " " + stripTags(q.groupContext);
          if (wrongQuestionIds.has(q.id)) wrongCtx += " " + stripTags(q.text) + " " + stripTags(q.groupContext);
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
        method: "POST", headers: await getAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ lang: i18n.language === "vi" ? "vi" : "en", count: requestedCount, minCount: requestedCount, target: me.target || "", source, wrongContext: wrongCtx, exclude: excludeWords, kinds: (vocabKinds && vocabKinds.length ? vocabKinds : ["word", "phrasal_verb", "idiom", "collocation", "grammar"]) })
      });
      const data = await readApiJson(resp);
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
      const saved = await saveMyVocabNotebook(nxNotebook, me.vocabTombstones || []);
      if (!saved) {
        alert("Chưa thể lưu các mục mới vào sổ. Hệ thống đã giữ bản chờ để tự thử lại, nhưng chưa tính là thêm thành công.");
        return;
      }
      // Show the confirmed additions immediately. Firestore's default document order puts
      // newer timestamp IDs at the bottom, which previously made the list look unchanged.
      setVocabFilter("all"); setVocabView("list"); setStudyFlipped(false);
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
                      if (parent && !parent.classList?.contains('idp-temp-selection')) {
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
          if (!target.closest('.idp-popup-menu') && !target.closest('.idp-note-input-modal') && !target.closest('.idp-highlight-delete-menu') && !target.classList.contains('student-note-hl')) {
              setSelectionMenu(null);
              setNoteInputMenu(null);
              setHighlightDeleteMenu(null);
              clearTempSelection();
          }
      };

      // The highlighter replaces the browser selection with .idp-temp-selection
      // so the annotation menu can remain stable. Preserve normal Ctrl/Cmd+C by
      // copying that temporary selection when the browser no longer has a range.
      const handleExamCopy = (e: ClipboardEvent) => {
          const nativeText = window.getSelection()?.toString().trim() || '';
          const temporaryText = Array.from(document.querySelectorAll<HTMLElement>(
              '.highlightable-content .idp-temp-selection'
          )).map(node => node.innerText || node.textContent || '').join('\n').trim();
          const text = nativeText || temporaryText;
          if (!text || !e.clipboardData) return;
          e.clipboardData.setData('text/plain', text);
          e.preventDefault();
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
      document.addEventListener('copy', handleExamCopy, true);

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
          document.removeEventListener('copy', handleExamCopy, true);
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
              if (container) removeAnnotation(container, node);
          } else {
              const id = node.getAttribute('data-note-id');
              (container ? Array.from(container.querySelectorAll<HTMLElement>('.student-note-hl')) : [node])
                  .filter(el => el === node || (!!id && el.getAttribute('data-note-id') === id))
                  .forEach(el => el.setAttribute('data-note', noteText));
          }
          
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
          applySelectionAnnotation(container, type, noteText ?? '');

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
    const earnedCoinsByTime = lessonRewardForSeconds(totalSecs);

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
    const coinOperation = earnedCoinsByTime > 0 ? makeCoinOperation(st.id, earnedCoinsByTime, "MANUAL_LESSON") : null;
    syncData({ students: nxStudents, history: nxHistory, ...(coinOperation ? { __coinOperation: coinOperation } : {}) });

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
    const earnedCoinsByTime = lessonRewardForSeconds(elapsed);

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
    
    const coinOperation = earnedCoinsByTime > 0 ? makeCoinOperation(st.id, earnedCoinsByTime, "TIMED_LESSON") : null;
    syncData({ students: nxStudents, history: nxHistory, ...(coinOperation ? { __coinOperation: coinOperation } : {}) });
    resetTimer(); 
    setSelSkills([]);
    alert("Live lesson session and feedback synchronized successfully!");
  };

  const handleStudentAction = async () => {
    if (!newSt.name || studentFormSaving) return;
    const nameCap = newSt.name.trim().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    let nx: Student[];
    let coinOperation: CoinOperation | null = null;
    if (editStId) {
      const existing = students.find(s => s.id === editStId);
      nx = students.map(s => s.id === editStId ? { ...s, ...newSt, name: nameCap } as Student : s);
      if (existing && newSt.coins !== undefined && Number(newSt.coins) !== Number(existing.coins || 0)) {
        coinOperation = makeCoinOperation(editStId, Number(newSt.coins) - Number(existing.coins || 0), "TEACHER_ADJUST");
      }
      setEditStId(null);
    }
    else { nx = [{ id: getTrueTime().toString(), name: nameCap, phone: "", rate: newSt.rate || 300000, target: newSt.target || "6.5", cefr: newSt.cefr || "B2", exp: 0, level: 1, email: newSt.email, dob: newSt.dob, isPinned: false, privateMessage: "" }, ...students]; }
    setStudentFormSaving(true);
    try {
      setStudents(nx);
      const saved = await syncData({ students: nx, ...(coinOperation ? { __coinOperation: coinOperation } : {}) });
      setNewSt({ name: "", rate: 300000, target: "6.5", cefr: "B2", email: "", dob: "", privateMessage: "" });
      setShowAddStudent(false);
      showSaveToast(
        saved
          ? tx(`Đã lưu thông tin học viên "${nameCap}" thành công!`, `Student "${nameCap}" saved successfully!`)
          : tx(`Đã lưu tạm "${nameCap}" trên thiết bị, chờ đồng bộ mạng.`, `Saved "${nameCap}" locally, waiting for network sync.`),
        saved ? "success" : "warning"
      );
    } finally {
      setStudentFormSaving(false);
    }
  };

  const teacherConfiscateCoins = async (studentId: string, amountOrAll: number | "ALL") => {
    const st = students.find(s => s.id === studentId);
    if (!st) return;
    const currentCoins = Math.max(0, Number(st.coins) || 0);
    if (currentCoins <= 0) {
      showSaveToast(tx("Học viên này hiện không còn xu nào để tịch thu.", "This student currently has 0 coins."), "warning");
      return;
    }
    const deduct = amountOrAll === "ALL" ? currentCoins : Math.min(currentCoins, Math.max(1, Math.floor(Number(amountOrAll) || 0)));
    if (!deduct) return;
    if (!window.confirm(tx(`Xác nhận tịch thu ${deduct} OS Coins của học viên ${st.name}?`, `Confirm confiscating ${deduct} OS Coins from ${st.name}?`))) return;
    const op = makeCoinOperation(st.id, -deduct, "TEACHER_CONFISCATE_COINS");
    const nx = applyCoinOperation(students, op);
    setStudents(nx);
    const saved = await syncData({ students: nx, __coinOperation: op });
    showSaveToast(
      saved
        ? tx(`Đã tịch thu ${deduct} Xu của ${st.name}!`, `Confiscated ${deduct} Coins from ${st.name}!`)
        : tx(`Đã ghi nhận tịch thu ${deduct} Xu (đang chờ đồng bộ).`, `Recorded confiscation of ${deduct} Coins (sync pending).`),
      saved ? "success" : "warning"
    );
  };

  const teacherConfiscateConsumable = async (studentId: string, itemName: string, countOrAll: number | "ALL") => {
    const st = students.find(s => s.id === studentId);
    if (!st || !itemName) return;
    const currentCount = Number(st.inventory?.consumables?.[itemName]) || 0;
    if (currentCount <= 0) return;
    const deduct = countOrAll === "ALL" ? currentCount : Math.min(currentCount, Math.max(1, Math.floor(Number(countOrAll) || 1)));
    if (!window.confirm(tx(`Xác nhận tịch thu ${deduct}x "${itemName}" của học viên ${st.name}?`, `Confirm confiscating ${deduct}x "${itemName}" from ${st.name}?`))) return;
    const op = makeCoinOperation(st.id, 0, "TEACHER_CONFISCATE_CONSUMABLE", {
      revokedConsumables: { [itemName]: deduct },
    });
    const nx = applyCoinOperation(students, op);
    setStudents(nx);
    const saved = await syncData({ students: nx, __coinOperation: op });
    showSaveToast(
      saved
        ? tx(`Đã tịch thu ${deduct}x "${itemName}" của ${st.name}!`, `Confiscated ${deduct}x "${itemName}" from ${st.name}!`)
        : tx(`Đã tịch thu "${itemName}" (chờ đồng bộ).`, `Confiscated "${itemName}" (sync pending).`),
      saved ? "success" : "warning"
    );
  };

  const teacherConfiscatePermanent = async (studentId: string, itemName: string) => {
    const st = students.find(s => s.id === studentId);
    if (!st || !itemName) return;
    if (!window.confirm(tx(`Xác nhận tịch thu vật phẩm vĩnh viễn "${itemName}" của học viên ${st.name}?\n(Nếu học viên đang trang bị món này, hệ thống sẽ tự động gỡ bỏ).`, `Confirm confiscating permanent item "${itemName}" from ${st.name}?\n(If currently equipped, it will be automatically unequipped).`))) return;
    const op = makeCoinOperation(st.id, 0, "TEACHER_CONFISCATE_PERMANENT", {
      revokedPermanents: [itemName],
    });
    const nx = applyCoinOperation(students, op);
    setStudents(nx);
    const saved = await syncData({ students: nx, __coinOperation: op });
    showSaveToast(
      saved
        ? tx(`Đã tịch thu vật phẩm vĩnh viễn "${itemName}" của ${st.name}!`, `Confiscated permanent item "${itemName}" from ${st.name}!`)
        : tx(`Đã tịch thu "${itemName}" (chờ đồng bộ).`, `Confiscated "${itemName}" (sync pending).`),
      saved ? "success" : "warning"
    );
  };

  const teacherConfiscateMyReward = async (studentId: string, rewardText: string, index?: number) => {
    const st = students.find(s => s.id === studentId);
    if (!st) return;
    if (!window.confirm(tx(`Xác nhận tịch thu / hủy phần quà "${rewardText}" của học viên ${st.name}?`, `Confirm revoking reward "${rewardText}" from ${st.name}?`))) return;
    const token = typeof index === "number" && index >= 0 ? `__INDEX__:${index}` : rewardText;
    const op = makeCoinOperation(st.id, 0, "TEACHER_CONFISCATE_REWARD", {
      revokedRewards: [token, rewardText],
    });
    const nx = applyCoinOperation(students, op);
    // Also mark any matching rewardCode as redeemed/revoked if present in rewardText
    const nextCodes = rewardCodes.filter(rc => !(rc.studentId === st.id && rewardText.includes(rc.code)));
    if (nextCodes.length !== rewardCodes.length) setRewardCodes(nextCodes);
    setStudents(nx);
    const saved = await syncData({
      students: nx,
      __coinOperation: op,
      ...(nextCodes.length !== rewardCodes.length ? { rewardCodes: nextCodes } : {}),
    });
    showSaveToast(
      saved
        ? tx(`Đã thu hồi phần quà "${rewardText}" của ${st.name}!`, `Revoked reward "${rewardText}" from ${st.name}!`)
        : tx(`Đã thu hồi phần quà (chờ đồng bộ).`, `Reward revoked (sync pending).`),
      saved ? "success" : "warning"
    );
  };

  const teacherConfiscateAllStudentAssets = async (studentId: string, includeCoins = false) => {
    const st = students.find(s => s.id === studentId);
    if (!st) return;
    const currentCoins = Math.max(0, Number(st.coins) || 0);
    const msg = includeCoins
      ? tx(`CẢNH BÁO: Bạn có chắc chắn muốn TỊCH THU TOÀN BỘ XU (${currentCoins} Xu) VÀ TẤT CẢ MỌI LOẠI QUÀ (Tiêu hao, Vĩnh viễn, Quà đổi thưởng) của học viên ${st.name} không?`, `WARNING: Are you sure you want to CONFISCATE ALL COINS (${currentCoins} Coins) AND ALL GIFTS/ITEMS from ${st.name}?`)
      : tx(`CẢNH BÁO: Bạn có chắc chắn muốn TỊCH THU TẤT CẢ MỌI LOẠI QUÀ (Tiêu hao, Vĩnh viễn, Quà đổi thưởng) trong kho đồ của học viên ${st.name} không?`, `WARNING: Are you sure you want to CONFISCATE ALL GIFTS/ITEMS (Consumables, Permanents, Redeemed Rewards) from ${st.name}?`);
    if (!window.confirm(msg)) return;
    const op = makeCoinOperation(st.id, includeCoins ? -currentCoins : 0, "TEACHER_CONFISCATE_ALL", {
      clearAllInventory: true,
    });
    const nx = applyCoinOperation(students, op);
    const nextCodes = rewardCodes.filter(rc => rc.studentId !== st.id);
    if (nextCodes.length !== rewardCodes.length) setRewardCodes(nextCodes);
    setStudents(nx);
    const saved = await syncData({
      students: nx,
      __coinOperation: op,
      ...(nextCodes.length !== rewardCodes.length ? { rewardCodes: nextCodes } : {}),
    });
    showSaveToast(
      saved
        ? tx(`Đã tịch thu toàn bộ ${includeCoins ? "xu và " : ""}kho quà của ${st.name}!`, `Confiscated all ${includeCoins ? "coins and " : ""}items from ${st.name}!`)
        : tx(`Đã tịch thu toàn bộ kho quà (chờ đồng bộ).`, `Confiscated all items (sync pending).`),
      saved ? "success" : "warning"
    );
  };

  const handleAddSchedule = () => {
    if (!schedForm.studentId) { alert("Please select a student!"); return; }
    const st = students.find(x => x.id === schedForm.studentId);
    if (!st) return;
    const materials: ScheduleMaterial[] = [];
    for (const rawLine of String(schedForm.materialsText || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean)) {
      const [possibleLabel, possibleUrl] = rawLine.includes("|") ? rawLine.split(/\|(.+)/, 2) : ["", rawLine];
      const url = String(possibleUrl || "").trim();
      try {
        const parsed = new URL(url);
        if (!["https:", "http:"].includes(parsed.protocol)) throw new Error("protocol");
        materials.push({ id: `material_${getTrueTime()}_${materials.length}`, url: parsed.toString(), label: String(possibleLabel || "").trim() || undefined });
      } catch {
        alert(`Liên kết tài liệu không hợp lệ: ${rawLine}`);
        return;
      }
    }
    const schedule: Schedule = {
      id: getTrueTime().toString(), date: viewDate, time: schedForm.time, location: schedForm.location,
      teacher: myTeacherName, studentId: schedForm.studentId, studentName: st.name, subject: "IELTS Core",
      duration: Number(schedForm.duration) || 90, status: "PENDING", billed: false,
      lessonContent: String(schedForm.lessonContent || "").trim() || undefined,
      materials,
    };
    const nx = [schedule, ...schedules];
    setSchedules(nx); syncData({ schedules: nx }); setShowSchedForm(false);
    setSchedForm({ time: "08:00", location: "Online", studentId: "", duration: 90, lessonContent: "", materialsText: "" });
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
    const earnedCoins = lessonRewardForSeconds(secs);
    const nxStudents = students.map(s => s.id === st.id ? { ...s, exp: newExp, level: newLevel, coins: (s.coins || 0) + earnedCoins, debtMessage: s.debtMessage || "" } : s);
    const nxHistory = [session, ...history];
    const nxSched = schedules.map(x => x.id === sched.id ? { ...x, status: "DONE" as const, billed: true } : x);
    setStudents(nxStudents); setHistory(nxHistory); setSchedules(nxSched);
    const coinOperation = earnedCoins > 0 ? makeCoinOperation(st.id, earnedCoins, "ATTENDANCE_REWARD") : null;
    syncData({ students: nxStudents, history: nxHistory, schedules: nxSched, ...(coinOperation ? { __coinOperation: coinOperation } : {}) });
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

  const exportMyVocabXlsx = async () => {
    if (userRole !== "STUDENT" || !currentUser?.email) return;
    const me = students.find(student => String(student.email || "").toLowerCase() === currentUser.email!.toLowerCase());
    const cards = newestVocabFirst(Array.isArray(me?.vocabNotebook) ? me!.vocabNotebook! : []);
    if (!cards.length) {
      alert("Chưa có từ vựng để xuất.");
      return;
    }
    try {
      await downloadXLSX(
        `IELTS_OS_Vocabulary_${new Date().toISOString().slice(0, 10)}.xlsx`,
        "Vocabulary",
        [
          { header: "No.", width: 8 },
          { header: "Word / Vocabulary", width: 26 },
          { header: "IPA", width: 19 },
          { header: "English Definition", width: 44 },
          { header: "Example", width: 54 },
        ],
        cards.map((card, index) => [index + 1, card.word || "", card.phonetic || "", card.meaning || "", card.example || ""]),
        "IELTS OS Vocabulary"
      );
    } catch (error) {
      console.error("Vocabulary XLSX export failed:", error);
      alert("Không thể tạo file Excel. Vui lòng thử lại.");
    }
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
      const strip = (t: any) => normalizeAnswerSpacing(t);
      const scoreSummary = getQuizScoreSummary(qz, r.answers || {});
      const optionText = (question: any, indexes: number[]) => indexes
        .map(index => strip(question.options?.[index] ?? index))
        .join(' / ');
      const rows: (string|number)[][] = scoreSummary.groups.map((group: any) => {
          const question = group.questions[0];
          const lastQuestion = group.questions[group.questions.length - 1];
          const start = getQuizQuestionNumber(qz.questions, question.id);
          const end = getQuizQuestionNumber(qz.questions, lastQuestion.id) + getQuestionPointCount(lastQuestion) - 1;
          const questionLabel = end > start ? `${start}-${end}` : start;
          if (group.isChoiceMultiple) {
              const outcome = group.multiple;
              const result = outcome.isFullyCorrect
                ? 'Đúng'
                : outcome.score > 0
                  ? `Đúng một phần (${outcome.score}/${outcome.total})`
                  : 'Sai';
              return [
                questionLabel,
                group.questions.map((item: any) => strip(item.text)).filter(Boolean).join(' / '),
                optionText(question, outcome.correct),
                optionText(question, outcome.selected),
                result,
              ];
          }
          const answer = r.answers?.[question.id];
          const options = question.options || [];
          const correctDisplay = question.type === 'CHOICE'
            ? options[question.correctAnswer as number] || question.correctAnswer
            : question.type === 'MATCHING'
              ? resolveMatchingAnswerText(question, question.correctAnswer)
              : question.correctAnswer;
          const studentDisplay = question.type === 'CHOICE'
            ? (answer !== undefined ? options[answer as number] || answer : '')
            : question.type === 'MATCHING'
              ? (answer !== undefined ? resolveMatchingAnswerText(question, answer) : '')
              : answer ?? '';
          return [questionLabel, strip(question.text), strip(correctDisplay), strip(studentDisplay), group.isFullyCorrect ? 'Đúng' : 'Sai'];
      });
      const cols = [{header:'Câu', width:6},{header:'Nội dung câu hỏi', width:50},{header:'Đáp án đúng', width:22},{header:'Học viên trả lời', width:22},{header:'Kết quả', width:10}];
      const liveBand = getIeltsBand(scoreSummary.score, scoreSummary.total, qz.type);
      downloadXLSX(`CHITIET_${r.studentName}_${r.quizTitle}.xlsx`, 'Chi tiết', cols, rows, `${r.studentName} — ${r.quizTitle} (${scoreSummary.score}/${scoreSummary.total}, Band ${liveBand})`);
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
          if (q.type === "MATCHING") ans = resolveMatchingAnswerText(q, q.correctAnswer);
          content += `Question ${i+1}: ${ans}\n`;
      });
      const blob = new Blob(["\uFEFF" + content], { type: 'text/plain;charset=utf-8;' });
      const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `KEY_${quiz.title}.txt`; link.click();
  }

  const makeDocxImportId = (prefix: string) => {
    const uuid = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : "";
    return uuid ? `${prefix}_${uuid}` : `${prefix}_${getTrueTime()}_${Math.random().toString(36).slice(2, 10)}`;
  };

  const prepareExamDocxBatchQuiz = (item: ExamDocxBatchItem): Quiz => {
    if (item.catalogQuiz) return item.catalogQuiz;
    const imported = normalizeQuizManualExplanations(JSON.parse(JSON.stringify(item.quiz || {})));
    const quizId = makeDocxImportId("docx");
    const base: any = {
      ...imported,
      id: quizId,
      title: String(imported.title || item.file.name.replace(/\.docx$/i, "")).trim() || "Untitled DOCX exam",
      active: false,
      audience: "ALL",
      targetStudentIds: [],
      maxAttempts: Math.max(1, Number(imported.maxAttempts) || 1),
      folder: item.targetFolder || "Root",
      updatedAt: getTrueTime(),
    };
    if (isWritingQuiz(base)) {
      const writingTasks = normalizeWritingTasks(base).map((task: WritingTaskDefinition, index: number) => ({
        ...task,
        id: `writing_${quizId}_${Number(task.taskNumber) || index + 1}`,
      }));
      return normalizeQuizManualExplanations({ ...base, writingTasks, questions: writingQuestions({ ...base, writingTasks }) }) as Quiz;
    }

    const originalIds = new Map<string, string>();
    const questions: QuizQuestion[] = [];
    const rekeyQuestion = (question: any, fallback: string): QuizQuestion => {
      const originalId = String(question?.id || fallback);
      const id = originalIds.get(originalId) || `q_${quizId}_${originalIds.size + 1}`;
      if (!originalIds.has(originalId)) {
        originalIds.set(originalId, id);
        questions.push({ ...question, id });
      }
      return questions.find(candidate => candidate.id === id)!;
    };
    (Array.isArray(base.questions) ? base.questions : []).forEach((question: any, index: number) => rekeyQuestion(question, `question_${index + 1}`));
    const sections = Array.isArray(base.sections)
      ? base.sections.map((section: any, sectionIndex: number) => ({
          ...section,
          questions: (Array.isArray(section.questions) ? section.questions : []).map((question: any, questionIndex: number) => rekeyQuestion(question, `section_${sectionIndex + 1}_${questionIndex + 1}`)),
        }))
      : base.sections;
    return normalizeQuizManualExplanations({ ...base, questions, sections }) as Quiz;
  };

  const aiGenerationIsActive = (batch: AiGenerationBatchState | null | undefined) => Boolean(batch && ['STAGING', 'QUEUED', 'PROCESSING', 'RETRYING'].includes(String(batch.status || '').toUpperCase()));
  const aiGenerationProcessingCount = (batch: AiGenerationBatchState | null | undefined) => (batch?.results || []).filter(item => String(item.status || '').toUpperCase() === 'PROCESSING' && item.reclaimable !== true).length;
  // Lease expiry is evaluated by the server, never by the browser's clock.
  const aiGenerationRunnableCount = (batch: AiGenerationBatchState | null | undefined) => (batch?.results || []).filter(item => String(item.status || '').toUpperCase() === 'QUEUED' || item.reclaimable === true).length;
  const aiGenerationCanRetry = (batch: AiGenerationBatchState | null | undefined) => (batch?.results || []).some(item => item.can_retry === true);
  const aiGenerationCanReprocess = (batch: AiGenerationBatchState | null | undefined) => (batch?.results || []).some(item => item.can_reprocess === true);
  const aiGenerationStorageKey = (uid: string) => `ielts-os:ai-generation-batch:${uid}`;

  const acceptAiGenerationBatch = (batchId: string, next: AiGenerationBatchState) => {
    const driver = aiGenerationDriverRef.current;
    const current = aiGenerationBatchRef.current;
    if (!next?.batch_id || next.batch_id !== batchId || driver.batchId !== batchId || driver.stopped) return false;
    if (current?.batch_id === batchId && Number(next.updatedAt || 0) < Number(current.updatedAt || 0)) return false;
    aiGenerationBatchRef.current = next;
    setAiGenerationBatch(next);
    if (currentUser?.uid) {
      const key = aiGenerationStorageKey(currentUser.uid);
      // Keep the last completed batch reachable after a deployment so old failures
      // can be explicitly reprocessed without re-uploading their source files.
      window.localStorage.setItem(key, batchId);
    }
    return true;
  };

  const scheduleAiGenerationPoll = (batchId: string, delay = 2500) => {
    const driver = aiGenerationDriverRef.current;
    if (driver.batchId !== batchId || driver.stopped) return;
    if (aiGenerationPollTimerRef.current !== null) window.clearTimeout(aiGenerationPollTimerRef.current);
    const epoch = driver.epoch;
    aiGenerationPollTimerRef.current = window.setTimeout(() => {
      aiGenerationPollTimerRef.current = null;
      const activeDriver = aiGenerationDriverRef.current;
      if (activeDriver.batchId === batchId && activeDriver.epoch === epoch && !activeDriver.stopped) void pollAiGenerationBatch(batchId);
    }, delay);
  };

  const driveAiGenerationBatch = async (batchId: string) => {
    if (!currentUser) return;
    const driver = aiGenerationDriverRef.current;
    if (driver.batchId !== batchId) {
      driver.batchId = batchId;
      driver.inFlight = false;
      driver.stopped = false;
      driver.epoch += 1;
    }
    const snapshot = aiGenerationBatchRef.current;
    if (driver.inFlight || driver.stopped || !aiGenerationIsActive(snapshot) || snapshot?.batch_id !== batchId || aiGenerationRunnableCount(snapshot) < 1 || aiGenerationProcessingCount(snapshot) >= 2) return;
    const epoch = driver.epoch;
    driver.inFlight = true;
    try {
      const token = await currentUser.getIdToken();
      const response = await fetch(`${getApiBase()}/api/exam-generation/batches/${encodeURIComponent(batchId)}/advance`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await readApiJson(response);
      if (!response.ok) throw new Error(String(payload?.detail || payload?.error || 'Could not advance the AI batch.'));
      const batch = payload?.batch as AiGenerationBatchState;
      if (batch?.batch_id) acceptAiGenerationBatch(batchId, batch);
      if (payload?.claimed && aiGenerationIsActive(aiGenerationBatchRef.current)) scheduleAiGenerationPoll(batchId, 150);
      else if (aiGenerationIsActive(aiGenerationBatchRef.current)) scheduleAiGenerationPoll(batchId, 2500);
    } catch (error) {
      // A persisted lease may outlive a transient response failure; the one poll
      // scheduler safely re-checks state without creating retry storms.
      console.warn('AI batch worker retry is safe:', error);
      if (aiGenerationDriverRef.current.batchId === batchId && aiGenerationDriverRef.current.epoch === epoch && !aiGenerationDriverRef.current.stopped) scheduleAiGenerationPoll(batchId, 4000);
    } finally {
      if (aiGenerationDriverRef.current.batchId === batchId && aiGenerationDriverRef.current.epoch === epoch) aiGenerationDriverRef.current.inFlight = false;
    }
  };

  const finalizeAiDirectBatchUpload = async (batch: AiGenerationBatchState, suppliedToken = "") => {
    if (!currentUser || batch.upload_kind !== 'DIRECT') return batch;
    const rowIds = [...(batch.results || [])]
      .sort((left, right) => Number(left.index || 0) - Number(right.index || 0))
      .map(item => String(item.row_id || ''));
    if (!rowIds.length || rowIds.some(rowId => !rowId)) throw new Error('The direct-upload batch has invalid row identifiers.');
    let lastError: any = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const token = suppliedToken || await currentUser.getIdToken(attempt > 0);
        const response = await fetch(`${getApiBase()}/api/exam-generation/batches/${encodeURIComponent(batch.batch_id)}/finalize-upload`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ row_ids: rowIds }),
        });
        const payload = await readApiJson(response);
        if (!response.ok || !payload?.batch?.batch_id) {
          const error: any = new Error(String(payload?.detail || payload?.error || 'Could not verify the uploaded DOCX files.'));
          error.status = response.status;
          throw error;
        }
        return payload.batch as AiGenerationBatchState;
      } catch (error: any) {
        lastError = error;
        if ((Number(error?.status) > 0 && Number(error.status) < 500) || attempt >= 2) break;
        await new Promise(resolve => window.setTimeout(resolve, 600 * (attempt + 1)));
      }
    }
    throw lastError || new Error('Could not verify the uploaded DOCX files.');
  };

  const resumeAiDirectFinalize = async (batch: AiGenerationBatchState) => {
    if (!currentUser || batch.upload_kind !== 'DIRECT' || aiGenerationFinalizeRef.current) return;
    aiGenerationFinalizeRef.current = true;
    try {
      const finalized = await finalizeAiDirectBatchUpload(batch);
      acceptAiGenerationBatch(batch.batch_id, finalized);
      if (aiGenerationIsActive(finalized)) {
        if (aiGenerationRunnableCount(finalized) > 0) void driveAiGenerationBatch(batch.batch_id);
        scheduleAiGenerationPoll(batch.batch_id, 2500);
      }
    } catch (error) {
      console.warn('Could not finalize the recovered direct upload:', error);
      alert(error instanceof Error ? error.message : 'Could not verify the interrupted DOCX upload.');
    } finally {
      aiGenerationFinalizeRef.current = false;
    }
  };

  const pollAiGenerationBatch = async (batchId: string) => {
    if (!currentUser) return;
    try {
      const token = await currentUser.getIdToken();
      const response = await fetch(`${getApiBase()}/api/exam-generation/batches/${encodeURIComponent(batchId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await readApiJson(response);
      if (!response.ok) throw new Error(String(payload?.detail || payload?.error || 'Could not refresh the AI batch.'));
      const batch = payload?.batch as AiGenerationBatchState;
      if (!batch?.batch_id) return;
      if (!acceptAiGenerationBatch(batchId, batch)) return;
      if (batch.upload_kind === 'DIRECT' && (batch.results || []).some(item => String(item.status || '').toUpperCase() === 'STAGING')) {
        // A recovered tab must not mark another tab's in-flight upload missing.
        // The batch panel exposes an explicit verification action instead.
        return;
      }
      if (aiGenerationIsActive(aiGenerationBatchRef.current)) {
        if (aiGenerationRunnableCount(aiGenerationBatchRef.current) > 0) void driveAiGenerationBatch(batchId);
        scheduleAiGenerationPoll(batchId);
      } else if (aiGenerationPollTimerRef.current !== null) {
        window.clearTimeout(aiGenerationPollTimerRef.current);
        aiGenerationPollTimerRef.current = null;
      }
    } catch (error) {
      console.warn('Could not refresh the AI batch:', error);
      const driver = aiGenerationDriverRef.current;
      if (driver.batchId === batchId && !driver.stopped) scheduleAiGenerationPoll(batchId, 4000);
    }
  };

  const downloadAiGeneratedDocx = async (jobId: string) => {
    if (!currentUser || !/^[a-f0-9]{32}$/i.test(jobId)) return;
    try {
      const token = await currentUser.getIdToken();
      const response = await fetch(`${getApiBase()}/api/exam-generation/jobs/${encodeURIComponent(jobId)}/docx`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const payload = await readApiJson(response);
        throw new Error(String(payload?.detail || payload?.error || 'Could not download the generated DOCX.'));
      }
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = `${jobId}-IELTS-OS.docx`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch (error: any) {
      alert(error?.message || 'Could not download the generated DOCX.');
    }
  };

  const recoverAiGenerationBatch = async (action: 'retry' | 'reprocess') => {
    const batchId = String(aiGenerationBatchRef.current?.batch_id || '');
    if (!currentUser || !/^[A-Za-z0-9_-]{12,160}$/.test(batchId) || aiGenerationBusy) return;
    setAiGenerationBusy(true);
    try {
      const token = await currentUser.getIdToken();
      const response = await fetch(`${getApiBase()}/api/exam-generation/batches/${encodeURIComponent(batchId)}/${action}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await readApiJson(response);
      if (!response.ok || !payload?.batch?.batch_id) throw new Error(String(payload?.detail || payload?.error || 'Could not resume the AI DOCX batch.'));
      const batch = payload.batch as AiGenerationBatchState;
      if (aiGenerationPollTimerRef.current !== null) window.clearTimeout(aiGenerationPollTimerRef.current);
      aiGenerationDriverRef.current = { batchId, inFlight: false, stopped: false, epoch: aiGenerationDriverRef.current.epoch + 1 };
      aiGenerationBatchRef.current = batch;
      setAiGenerationBatch(batch);
      if (currentUser.uid) window.localStorage.setItem(aiGenerationStorageKey(currentUser.uid), batchId);
      void pollAiGenerationBatch(batchId);
      if (!Number(payload?.[action === 'retry' ? 'retried' : 'reprocessed'] || 0) && !aiGenerationIsActive(batch)) {
        alert(action === 'retry' ? 'No transient failures are eligible for retry.' : 'No failed files from an older pipeline version need reprocessing.');
      }
    } catch (error: any) {
      alert(error?.message || 'Could not resume the AI DOCX batch.');
    } finally {
      setAiGenerationBusy(false);
    }
  };

  const retryAiGenerationBatch = () => recoverAiGenerationBatch('retry');
  const reprocessAiGenerationBatch = () => recoverAiGenerationBatch('reprocess');
  const verifyPendingAiDirectUpload = async () => {
    const batch = aiGenerationBatchRef.current;
    if (!batch || batch.upload_kind !== 'DIRECT' || aiGenerationBusy) return;
    setAiGenerationBusy(true);
    try {
      await resumeAiDirectFinalize(batch);
    } finally {
      setAiGenerationBusy(false);
    }
  };

  const uploadAiRawDocxDirect = (
    file: File,
    upload: { row_id?: string; upload_url?: string; method?: string; headers?: Record<string, string> },
  ) => new Promise<void>((resolve, reject) => {
    const rowId = String(upload.row_id || '');
    const uploadUrl = String(upload.upload_url || '');
    if (!rowId || !uploadUrl.startsWith('https://')) {
      reject(new Error('Storage did not provide a valid direct-upload session.'));
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open(String(upload.method || 'PUT'), uploadUrl, true);
    xhr.timeout = 10 * 60 * 1000;
    Object.entries(upload.headers || {}).forEach(([name, value]) => xhr.setRequestHeader(name, String(value)));
    xhr.upload.onprogress = event => {
      if (!event.lengthComputable || !event.total) return;
      const percent = Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100)));
      setAiGenerationUploadProgress(previous => ({ ...previous, [rowId]: percent }));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        setAiGenerationUploadProgress(previous => ({ ...previous, [rowId]: 100 }));
        resolve();
      } else {
        reject(new Error(`Storage rejected ${file.name} (HTTP ${xhr.status || 0}).`));
      }
    };
    xhr.onerror = () => reject(new Error(`Network upload failed for ${file.name}.`));
    xhr.ontimeout = () => reject(new Error(`Upload timed out for ${file.name}.`));
    xhr.onabort = () => reject(new Error(`Upload was cancelled for ${file.name}.`));
    xhr.send(file);
  });

  const handleAiRawDocxBatchUpload = async (event: any) => {
    const files = Array.from(event?.target?.files || []).filter((file: any): file is File => file instanceof File && /\.docx$/i.test(file.name));
    event.target.value = '';
    if (!files.length || aiGenerationBusy) return;
    if (!currentUser || userRole !== 'TEACHER') {
      alert('Teacher sign-in is required to start an AI batch.');
      return;
    }
    if (files.length > 20) {
      alert('An AI batch accepts at most 20 DOCX files.');
      return;
    }
    const oversized = files.find(file => file.size <= 0 || file.size > 20 * 1024 * 1024);
    if (oversized) {
      alert(`${oversized.name} must be between 1 byte and 20 MB.`);
      return;
    }
    setAiGenerationBusy(true);
    setAiGenerationUploadProgress({});
    try {
      const idempotencyKey = makeDocxImportId('ai_batch');
      const token = await currentUser.getIdToken();
      let payload: any = null;
      let startError: any = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await fetch(`${getApiBase()}/api/exam-generation/batches/direct`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              files: files.map(file => ({ name: file.name, size: file.size, content_type: file.type || '' })),
              delivery_mode: aiGenerationDeliveryMode,
              publication_policy: aiGenerationPublicationPolicy,
              idempotency_key: idempotencyKey,
            }),
          });
          payload = await readApiJson(response);
          if (!response.ok || !payload?.batch?.batch_id) {
            const error: any = new Error(String(payload?.detail || payload?.error || 'Could not reserve the AI DOCX upload.'));
            error.status = response.status;
            throw error;
          }
          startError = null;
          break;
        } catch (error: any) {
          startError = error;
          if ((Number(error?.status) > 0 && Number(error.status) < 500) || attempt >= 1) break;
          await new Promise(resolve => window.setTimeout(resolve, 700));
        }
      }
      if (startError || !payload?.batch?.batch_id) throw startError || new Error('Could not reserve the AI DOCX upload.');
      const batch = payload.batch as AiGenerationBatchState;
      if (aiGenerationPollTimerRef.current !== null) window.clearTimeout(aiGenerationPollTimerRef.current);
      aiGenerationDriverRef.current = { batchId: batch.batch_id, inFlight: false, stopped: false, epoch: aiGenerationDriverRef.current.epoch + 1 };
      aiGenerationBatchRef.current = batch;
      setAiGenerationBatch(batch);
      if (currentUser.uid) {
        const key = aiGenerationStorageKey(currentUser.uid);
        window.localStorage.setItem(key, batch.batch_id);
      }
      const uploads = Array.isArray(payload.uploads) ? payload.uploads : [];
      const readyUploads = uploads.filter((upload: any) => String(upload?.state || '').toUpperCase() === 'READY');
      let cursor = 0;
      const uploadFailures: Error[] = [];
      const uploadWorker = async () => {
        while (cursor < readyUploads.length) {
          const upload = readyUploads[cursor++];
          const index = Number(upload?.index);
          const file = files[index];
          const batchRow = (batch.results || []).find(item => Number(item.index) === index);
          if (!file || !batchRow || String(batchRow.row_id || '') !== String(upload?.row_id || '')) {
            uploadFailures.push(new Error('The upload manifest does not match the selected file order.'));
            continue;
          }
          try {
            await uploadAiRawDocxDirect(file, upload);
          } catch (error: any) {
            uploadFailures.push(error instanceof Error ? error : new Error(String(error || 'Direct upload failed.')));
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, Math.max(1, readyUploads.length)) }, () => uploadWorker()));
      const finalized = await finalizeAiDirectBatchUpload(batch, token);
      aiGenerationBatchRef.current = finalized;
      setAiGenerationBatch(finalized);
      setAiGenerationUploadProgress({});
      if (uploadFailures.length) console.warn('Some direct DOCX uploads did not complete:', uploadFailures);
      if (aiGenerationIsActive(finalized)) {
        if (aiGenerationRunnableCount(finalized) > 0) void driveAiGenerationBatch(batch.batch_id);
        scheduleAiGenerationPoll(batch.batch_id, 2500);
      }
    } catch (error: any) {
      alert(error?.message || 'Could not start the AI DOCX batch.');
    } finally {
      setAiGenerationBusy(false);
    }
  };

  const handleFileUpload = async (e: any) => {
    const files = Array.from(e.target.files || []).filter((file: any): file is File => file instanceof File && /\.docx$/i.test(file.name));
    e.target.value = "";
    if (!files.length) return;
    if (examDocxBatchBusy || examDocxBatch.length) {
      alert("Hoàn tất hoặc bỏ batch DOCX hiện tại trước khi chọn batch mới.");
      return;
    }
    if (files.length > 20) {
      alert("Mỗi lần chỉ có thể phân tích tối đa 20 file DOCX.");
      return;
    }
    const targetFolder = builderFolder || "Root";
    const staged: ExamDocxBatchItem[] = files.map((file, index) => ({
      id: makeDocxImportId(`docx_row_${index + 1}`),
      file,
      targetFolder,
      status: "parsing",
    }));
    setExamDocxBatch(staged);
    setExamDocxBatchCommitState("idle");
    setExamDocxBatchBusy(true);
    try {
      const formData = new FormData();
      staged.forEach(item => formData.append("files", item.file));
      const response = await fetch(`${getApiBase()}/api/upload_docx_batch`, { method: "POST", headers: await getAuthHeaders(), body: formData });
      const data = await readApiJson(response);
      if (!response.ok && !Array.isArray(data?.results)) throw new Error(data?.error || "Không thể phân tích batch DOCX.");
      const results = Array.isArray(data?.results) ? data.results : [];
      setExamDocxBatch(staged.map((item, index) => {
        const result = results.find((entry: any) => Number(entry?.index) === index);
        return result?.success && result?.quiz
          ? { ...item, status: "ready", quiz: result.quiz as Quiz }
          : { ...item, status: "error", error: String(result?.error || "Không thể phân tích file này.") };
      }));
    } catch (error: any) {
      const message = error?.message || "Không thể phân tích batch DOCX.";
      logErrorToSystem("UPLOAD_DOCX_BATCH_FAIL", message, { files: staged.map(item => item.file.name) });
      setExamDocxBatch(staged.map(item => ({ ...item, status: "error", error: message })));
    } finally {
      setExamDocxBatchBusy(false);
    }
  };

  const removeExamDocxBatchItem = (id: string) => {
    if (examDocxBatchBusy) return;
    setExamDocxBatch(previous => previous.filter(item => item.id !== id));
    setExamDocxBatchCommitState("idle");
  };

  const cancelExamDocxBatch = () => {
    if (examDocxBatchBusy) return;
    setExamDocxBatch([]);
    setExamDocxBatchCommitState("idle");
  };

  const confirmExamDocxBatch = async () => {
    if (userRole !== "TEACHER" || examDocxBatchBusy) return;
    const validItems = examDocxBatch.filter(item => item.status === "ready" && item.quiz);
    if (!validItems.length) {
      alert("Batch này chưa có file DOCX hợp lệ để thêm.");
      return;
    }
    const prepared = validItems.map(prepareExamDocxBatchQuiz);
    const preparedByRow = new Map(validItems.map((item, index) => [item.id, prepared[index]]));
    const importedIds = new Set(prepared.map(quiz => quiz.id));
    setExamDocxBatch(previous => previous.map(item => preparedByRow.has(item.id) ? { ...item, catalogQuiz: preparedByRow.get(item.id) } : item));
    setQuizCatalogState([...prepared, ...quizzesRef.current.filter(quiz => !importedIds.has(quiz.id))]);
    setExamDocxBatchBusy(true);
    try {
      const saved = await syncData({ __quizUpserts: prepared });
      if (!saved) {
        setExamDocxBatchCommitState("error");
        alert("Chưa thể đồng bộ batch lên máy chủ. Các đề vẫn được giữ trên thiết bị này; bạn có thể thử đồng bộ lại.");
        return;
      }
      setExamDocxBatch([]);
      setExamDocxBatchCommitState("idle");
    } catch (error: any) {
      const message = error?.message || "Không thể đồng bộ batch DOCX.";
      logErrorToSystem("UPLOAD_DOCX_BATCH_SAVE_FAIL", message, { files: validItems.map(item => item.file.name) });
      setExamDocxBatchCommitState("error");
      alert(message);
    } finally {
      setExamDocxBatchBusy(false);
    }
  };

  const setQuestDocxFiles = async (incoming: FileList | File[]) => {
    const files = Array.from(incoming || []).filter(file => /\.docx$/i.test(file.name));
    if (!files.length) return;
    if (files.length > 20) {
      alert("Mỗi lần chỉ có thể xử lý tối đa 20 file DOCX.");
      return;
    }
    const staged = files.map((file, index) => ({
      id: `quest_docx_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 7)}`,
      file,
      status: "parsing" as const,
    }));
    setQuestDocxBatch(staged);
    setQuestDocxBatchBusy(true);
    try {
      const formData = new FormData();
      staged.forEach(item => formData.append("files", item.file));
      const response = await fetch(`${getApiBase()}/api/upload_docx_batch`, { method: "POST", headers: await getAuthHeaders(), body: formData });
      const data = await readApiJson(response);
      if (!response.ok && !Array.isArray(data?.results)) throw new Error(data?.error || tx("Không thể phân tích batch DOCX.", "Unable to parse DOCX batch."));
      const results = Array.isArray(data?.results) ? data.results : [];
      setQuestDocxBatch(staged.map((item, index) => {
        const result = results.find((entry: any) => Number(entry?.index) === index);
        return result?.success && result?.quiz
          ? { ...item, status: "ready" as const, quiz: result.quiz as Quiz }
          : { ...item, status: "error" as const, error: String(result?.error || tx("Không thể phân tích file này.", "Unable to parse this file.")) };
      }));
    } catch (error: any) {
      const message = error?.message || tx("Không thể phân tích batch DOCX.", "Unable to parse DOCX batch.");
      setQuestDocxBatch(staged.map(item => ({ ...item, status: "error" as const, error: message })));
    } finally {
      setQuestDocxBatchBusy(false);
    }
  };

  const moveQuestDocxFile = (index: number, direction: -1 | 1) => {
    setQuestDocxBatch(previous => {
      const target = index + direction;
      if (target < 0 || target >= previous.length) return previous;
      const next = [...previous];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const confirmQuestDocxBatch = async () => {
    if (userRole !== "TEACHER" || questDocxBatchBusy || !questDocxBatch.length) return;
    if (questDocxBatch.some(item => item.status !== "ready" || !item.quiz)) {
      alert(tx("Sửa hoặc bỏ các file lỗi trước khi tạo chuyên đề.", "Fix or remove invalid files before creating the topic assignment."));
      return;
    }
    const createdAt = getTrueTime();
    const preparedQuizzes = questDocxBatch.map((item, index) => ({
      ...(item.quiz as Quiz),
      id: `quest_import_${createdAt}_${index}_${Math.random().toString(36).slice(2, 7)}`,
      title: String(item.quiz?.title || item.file.name.replace(/\.docx$/i, "")).trim(),
      active: false,
      audience: "ALL" as const,
      targetStudentIds: [],
      maxAttempts: Math.max(1, Number(item.quiz?.maxAttempts) || 1),
      folder: "Quest imports",
      updatedAt: createdAt,
    }));
    const assignment: TopicAssignment = {
      id: `topic_${createdAt}_${Math.random().toString(36).slice(2, 7)}`,
      title: `Quest: ${preparedQuizzes[0]?.title || "DOCX import"}`,
      topicCategory: "DOCX import",
      description: tx("Các bài được tạo theo thứ tự file DOCX đã xác nhận.", "Tests created in the order of confirmed DOCX files."),
      audience: "ALL",
      targetStudentIds: [],
      nodes: preparedQuizzes.map((quiz, index) => ({
        id: `node_${createdAt}_${index}_${Math.random().toString(36).slice(2, 6)}`,
        testId: quiz.id,
        title: quiz.title,
        description: "",
        passingThresholdPercent: 0,
        mode: "practice" as const,
        timeLimitMinutes: quiz.timeLimit,
        questionCount: quiz.questions.length,
      })),
      rewards: [],
      createdBy: currentUser?.email || "",
      createdAt,
      updatedAt: createdAt,
    };

    setQuestDocxBatchBusy(true);
    try {
      await runTransaction(db, async transaction => {
        const workspace = await transaction.get(DB_DOC_REF);
        if (!workspace.exists()) throw new Error(tx("Không tìm thấy workspace để tạo chuyên đề.", "Workspace not found for creating topic assignment."));
        const storedAssignments = workspace.data()?.topicAssignments;
        const existingAssignments = (Array.isArray(storedAssignments) ? storedAssignments : []) as TopicAssignment[];
        preparedQuizzes.forEach(quiz => transaction.set(doc(QUIZZES_COLLECTION_REF, quiz.id), JSON.parse(JSON.stringify(quiz))));
        transaction.update(DB_DOC_REF, { topicAssignments: [...existingAssignments, assignment] });
      });
      setQuizzes(previous => [...preparedQuizzes, ...previous.filter(quiz => !preparedQuizzes.some(item => item.id === quiz.id))]);
      setTopicAssignments(previous => [...previous, assignment]);
      setQuestDocxBatch([]);
      setTopicAssignmentEditor(assignment);
      alert(tx("Đã tạo chuyên đề theo đúng thứ tự batch. Kiểm tra chặng và bấm lưu nếu cần chỉnh thêm.", "Topic assignment created from batch in order. Check steps and click save if further adjustments are needed."));
    } catch (error: any) {
      console.error("Quest DOCX batch confirmation failed:", error);
      alert(error?.message || tx("Không thể tạo chuyên đề từ batch DOCX.", "Failed to create topic assignment from DOCX batch."));
    } finally {
      setQuestDocxBatchBusy(false);
    }
  };

  const parseSupplementDocxFile = async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch(`${getApiBase()}/api/upload_docx_supplement`, { headers: await getAuthHeaders(),
      method: "POST",
      body: formData,
    });
    const data = await readApiJson(response);
    if (!data.success) throw new Error(data.error || "Backend unknown error");
    return data;
  };

  const handleSupplementDocxUpload = async (e: any, mode: "replace_sections" | "explanations") => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const currentQuiz = editingQuizRef.current;
    if (!currentQuiz) {
      alert(tx("Hãy mở đề cần chỉnh trước.", "Please open an exam to edit first."));
      return;
    }
    try {
      const data = await parseSupplementDocxFile(file);
      if (mode === "replace_sections") {
        const patchQuiz = data.quiz;
        if (!patchQuiz?.questions?.length) {
          alert(tx("File bổ sung chưa có câu hỏi/passage hợp lệ để thay.", "The supplement file has no valid questions/passages to replace."));
          return;
        }
        const activeSection = Number(currentQuiz._activePassageTab || 0);
        const merged = mergeQuizSectionsFromSupplement(currentQuiz, patchQuiz, activeSection);
        if (!merged.replaced) {
          alert(tx("Không tìm thấy passage/section hợp lệ trong file bổ sung.", "No valid passage/section found in the supplement file."));
          return;
        }
        editingQuizRef.current = merged.quiz;
        setEditingQuiz(merged.quiz);
        alert(tx(`Đã thay ${merged.replaced} passage/section bắt đầu từ tab ${activeSection + 1}. Bấm Save để đồng bộ.`, `Replaced ${merged.replaced} passage/section starting from tab ${activeSection + 1}. Click Save to sync.`));
        return;
      }
      const merged = mergeQuizManualExplanationsFromSupplement(currentQuiz, data);
      if (!merged.imported) {
        alert(tx("Không tìm thấy [EXPLANATION] khớp số câu trong đề hiện tại.", "No [EXPLANATION] matching question numbers found in the current exam."));
        return;
      }
      editingQuizRef.current = merged.quiz;
      setEditingQuiz(merged.quiz);
      alert(tx(`Đã import explanation cho ${merged.imported} câu. Bấm Save để đồng bộ.`, `Imported explanations for ${merged.imported} questions. Click Save to sync.`));
    } catch (error: any) {
      logErrorToSystem("UPLOAD_DOCX_SUPPLEMENT_FAIL", error?.message || String(error), { fileName: file.name, mode });
      alert(tx("Không xử lý được file bổ sung: ", "Failed to process supplement file: ") + (error?.message || String(error)));
    }
  };

  const [scanExamBusy, setScanExamBusy] = useState(false);

  const handleScanExamUpload = async (e: any) => {
    const rawFiles = Array.from(e.target.files || []);
    e.target.value = "";
    if (!rawFiles.length) return;
    if (rawFiles.length > 5) {
      alert(tx("Chỉ chọn tối đa 5 file ảnh hoặc PDF mỗi lần quét.", "Select at most 5 image or PDF files per scan."));
      return;
    }
    const validFiles = rawFiles.filter((f: any) => {
      const n = (f.name || "").toLowerCase();
      const t = (f.type || "").toLowerCase();
      return n.endsWith(".pdf") || n.endsWith(".png") || n.endsWith(".jpg") || n.endsWith(".jpeg") || n.endsWith(".webp")
        || t.includes("pdf") || t.startsWith("image/");
    });
    if (!validFiles.length) {
      alert(tx("Vui lòng chọn file hình ảnh (PNG, JPG, WEBP) hoặc PDF.", "Please select image files (PNG, JPG, WEBP) or PDF."));
      return;
    }

    setScanExamBusy(true);
    try {
      const formData = new FormData();
      validFiles.forEach((file: any) => formData.append("files", file));
      const response = await fetch(`${getApiBase()}/api/scan_exam_page`, { headers: await getAuthHeaders(),
        method: "POST",
        body: formData,
      });
      const data = await readApiJson(response);
      if (!response.ok || !data.success || !data.quiz) {
        throw new Error(data?.error || data?.detail || tx("Không thể quét hoặc phân tích trang đề.", "Could not scan or parse exam page."));
      }

      const scannedQuiz = data.quiz;
      const currentQuiz = editingQuizRef.current;
      if (currentQuiz) {
        const activeSection = Number(currentQuiz._activePassageTab || 0);
        const nextSecs = [...(currentQuiz.sections || [])];
        while (nextSecs.length <= activeSection) nextSecs.push({ passage: "", questions: [] });
        const scannedPassage = (scannedQuiz.sections?.[0]?.passage) || scannedQuiz.passage || "";
        const scannedQuestions = (scannedQuiz.sections?.[0]?.questions?.length ? scannedQuiz.sections[0].questions : scannedQuiz.questions) || [];

        if (scannedPassage) {
          nextSecs[activeSection].passage = nextSecs[activeSection].passage
            ? `${nextSecs[activeSection].passage}\n\n${scannedPassage}`
            : scannedPassage;
          if (activeSection === 0 && !currentQuiz.passage) {
            currentQuiz.passage = scannedPassage;
          }
        }
        nextSecs[activeSection].questions = [...(nextSecs[activeSection].questions || []), ...scannedQuestions];
        const mergedQuestions = [...(currentQuiz.questions || []), ...scannedQuestions];
        const updated = {
          ...currentQuiz,
          sections: nextSecs,
          questions: mergedQuestions,
        };
        editingQuizRef.current = updated;
        setEditingQuiz(updated);
        alert(tx(
          `Đã quét thành công! Thêm ${scannedQuestions.length} câu hỏi vào phần thi hiện tại. Bấm Lưu để hoàn tất.`,
          `Scan successful! Added ${scannedQuestions.length} questions to the current section. Click Save to finalize.`
        ));
      } else {
        const newQuiz = {
          ...scannedQuiz,
          id: getTrueTime().toString(),
          folder: builderFolder || "Root",
          active: false,
          audience: "ALL",
          targetStudentIds: [],
        };
        editingQuizRef.current = newQuiz;
        setEditingQuiz(newQuiz);
        alert(tx(
          `Đã quét và tạo đề thi mới với ${scannedQuiz.questions?.length || 0} câu hỏi! Bấm Lưu để lưu vào kho.`,
          `Scanned and created new exam with ${scannedQuiz.questions?.length || 0} questions! Click Save to persist.`
        ));
      }
    } catch (err: any) {
      logErrorToSystem("SCAN_EXAM_PAGE_FAIL", err?.message || String(err));
      alert(tx("Lỗi khi quét đề thi: ", "Error scanning exam: ") + (err?.message || String(err)));
    } finally {
      setScanExamBusy(false);
    }
  };

  const CANONICAL_IELTS_TYPES = [
    { key: "multiple_choice", labelVi: "Trắc nghiệm (Multiple Choice)", labelEn: "Multiple Choice" },
    { key: "tfng_ynng", labelVi: "T/F/NG & Y/N/NG", labelEn: "True/False/Not Given & Yes/No/Not Given" },
    { key: "matching_headings", labelVi: "Nối tiêu đề (Headings)", labelEn: "Matching Headings" },
    { key: "matching_info_features", labelVi: "Nối thông tin / Đặc điểm", labelEn: "Matching Information / Features" },
    { key: "completion_notes_summary", labelVi: "Điền từ (Notes/Summary/Sentence)", labelEn: "Fill in Blanks (Notes/Summary/Sentence)" },
    { key: "diagram_flowchart_map", labelVi: "Sơ đồ / Bản đồ / Flowchart", labelEn: "Diagram / Map / Flowchart Labelling" },
    { key: "short_answer", labelVi: "Câu hỏi ngắn (Short Answer)", labelEn: "Short Answer Questions" },
    { key: "other", labelVi: "Dạng câu hỏi khác", labelEn: "Other Question Types" }
  ];

  const categorizeIeltsQuestionType = (q: any, quiz?: any): { key: string; labelVi: string; labelEn: string } => {
    // Dùng taxonomy chuẩn (inferQuestionCategory) rồi gom về 8 nhóm Error DNA cũ để giữ tương thích cache errorDna.
    const bucket = toErrorDnaBucket(inferQuestionCategory(q, quiz).id);
    return CANONICAL_IELTS_TYPES.find(t => t.key === bucket) || CANONICAL_IELTS_TYPES[7];
  };

  const triggerErrorDnaAnalysis = async (targetStudent: Student, force = false) => {
    if (!targetStudent?.id) return;
    const sid = targetStudent.id;
    if (dnaInFlightRef.current.has(sid)) return;

    const studentResults = (quizResults || []).filter(r => r && r.studentId === sid).sort((a, b) => safeString(b.date).localeCompare(safeString(a.date)));
    if (studentResults.length === 0) return;

    const typeMap: Record<string, { key: string; labelVi: string; labelEn: string; correct: number; total: number }> = {};
    CANONICAL_IELTS_TYPES.forEach(t => {
      typeMap[t.key] = { ...t, correct: 0, total: 0 };
    });

    const recentMistakes: Array<{ quizTitle: string; skill: string; questionType: string; subType: string; questionText: string; studentAnswer: string; correctAnswer: string }> = [];
    let totalQuestionsAnalyzed = 0;

    studentResults.forEach(r => {
      if (!r || !r.answers) return;
      const quiz = (quizzes || []).find(q => q && q.id === r.quizId);
      if (!quiz || !Array.isArray(quiz.questions)) return;
      const summary = getQuizScoreSummary(quiz, r.answers || {});
      summary.groups.forEach((group: any) => {
        const q = group.questions[0];
        if (!q) return;
        const cat = categorizeIeltsQuestionType(q, quiz);
        const fineCategory = inferQuestionCategory(q, quiz);
        totalQuestionsAnalyzed += group.total;
        typeMap[cat.key].total += group.total;
        typeMap[cat.key].correct += group.score;

        if (group.score < group.total && recentMistakes.length < 15) {
          const studentAns = r.answers[q.id];
          const studentAnsStr = Array.isArray(studentAns) ? studentAns.join(", ") : String(studentAns ?? "(skipped)");
          const correctStr = String(q.correctAnswer ?? q.correct ?? (Array.isArray(q.answers) ? q.answers.join(" / ") : "N/A"));
          recentMistakes.push({
            quizTitle: quiz.title || r.quizTitle || "Exam",
            skill: quizTaxonomySkill(quiz),
            questionType: fineCategory.label,
            subType: q.subType || q.type || "",
            questionText: String(q.question || q.text || q.prompt || "").slice(0, 160),
            studentAnswer: studentAnsStr.slice(0, 100),
            correctAnswer: correctStr.slice(0, 100)
          });
        }
      });
    });

    if (totalQuestionsAnalyzed === 0) return;

    const typeAccuracy = CANONICAL_IELTS_TYPES.map(t => {
      const data = typeMap[t.key];
      const acc = data.total > 0 ? Math.round((data.correct / data.total) * 100) : 0;
      return {
        key: t.key,
        label: tx(t.labelVi, t.labelEn),
        correct: data.correct,
        total: data.total,
        accuracy: acc
      };
    }).filter(item => item.total > 0);

    const signature = `${studentResults.length}_${studentResults[0]?.date || ""}_${totalQuestionsAnalyzed}`;

    if (!force && targetStudent.errorDna && targetStudent.errorDna.signature === signature && targetStudent.errorDna.categoryBreakdown) {
      return;
    }

    dnaInFlightRef.current.add(sid);

    try {
      const res = await fetch("/api/analyze_error_dna", {
        method: "POST",
        headers: await getAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          studentName: targetStudent.name || "Student",
          targetBand: targetStudent.target || "7.0",
          typeAccuracy,
          recentMistakes
        })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.success) {
        const updatedDna: ErrorDnaProfile = {
          signature,
          updatedAt: Date.now(),
          totalAnalyzedAttempts: studentResults.length,
          totalQuestionsAnalyzed,
          typeAccuracy,
          categoryBreakdown: data.categoryBreakdown || { lexicalGap: 34, distractorTrap: 33, scopeMisread: 33 },
          recurringTraps: data.recurringTraps || [],
          actionPlanVi: data.actionPlanVi || [],
          actionPlanEn: data.actionPlanEn || []
        };

        setStudents(prev => {
          const next = prev.map(s => s.id === sid ? { ...s, errorDna: updatedDna } : s);
          void syncData({ students: next });
          return next;
        });
      }
    } catch (err) {
      console.warn("Error DNA diagnosis deferred:", err);
    } finally {
      dnaInFlightRef.current.delete(sid);
    }
  };

  useEffect(() => {
    if (!students || !students.length || !quizResults || !quizResults.length) return;
    const currentSt = students.find(s => s.email && currentUser?.email && s.email.toLowerCase() === currentUser.email.toLowerCase());
    if (currentSt && (!currentSt.errorDna || !currentSt.errorDna.categoryBreakdown)) {
      void triggerErrorDnaAnalysis(currentSt);
    }
  }, [students, quizResults, currentUser]);

  const saveQuiz = async (quizToSave?: any): Promise<boolean> => {
      const isEvent = quizToSave && typeof quizToSave.preventDefault === 'function';
      const targetQuiz = isEvent ? undefined : quizToSave;

      if (targetQuiz) {
          // Branch A: gọi với quiz object trực tiếp (duplicateQuiz, handleFileUpload)
          const qz = withDeliveryMode(normalizeQuizManualExplanations(JSON.parse(JSON.stringify({
              ...targetQuiz,
              id: targetQuiz.id || getTrueTime().toString()
          }))), getDeliveryMode(targetQuiz));
          setExamBuilderSaveState("saving");
          try {
          const persisted = await persistQuizWithRevision(qz as Quiz);
          const existingIndex = quizzesRef.current.findIndex(q => q.id === persisted.id);
          const updated = [...quizzesRef.current];
          if (existingIndex !== -1) updated[existingIndex] = persisted;
          else updated.unshift(persisted);
          setQuizCatalogState(updated);
          setExamBuilderSaveState("saved");
          showSaveToast(tx(`Đã lưu và đồng bộ đề "${qz.title}" thành công!`, `Exam "${qz.title}" saved and synced successfully!`), "success");
          return true;
          } catch (error: any) {
          setExamBuilderSaveState("error");
          if (String(error?.message || error).includes('QUIZ_REVISION_CONFLICT')) {
              showSaveToast(tx('Đề này vừa được thay đổi ở nơi khác. Hãy tải lại trước khi lưu.', 'This exam was modified elsewhere. Please reload before saving.'), "error");
              alert(tx('Đề này vừa được thay đổi ở nơi khác. Hãy tải lại danh sách trước khi lưu để tránh ghi đè chế độ hoặc trạng thái publish mới hơn.', 'This exam was modified elsewhere. Please reload the list before saving to avoid overwriting newer changes.'));
          } else {
              showSaveToast(tx(`Chưa thể đồng bộ đề "${qz.title}" lên máy chủ.`, `Could not sync exam "${qz.title}" to server.`), "error");
              alert(tx(`Chưa thể đồng bộ đề "${qz.title}" lên máy chủ.`, `Could not sync exam "${qz.title}" to server.`));
          }
          return false;
          }
      } else {
          // Branch B: gọi từ nút "LƯU ĐỀ THI" (không có argument)
          // FIX ROOT CAUSE: Lấy snapshot qua ref thay vì updater lồng nhau.
          // Gọi setQuizzes lồng trong setEditingQuiz updater khiến React batch
          // dùng snapshot quizzes cũ từ closure  quiz mới không được commit.
          const currentSnapshot = editingQuizRef.current;
          if (!currentSnapshot) return false;
          if (!currentSnapshot.title) {
              alert(tx("Vui lòng nhập tên đề thi!", "Please enter the exam title!"));
              return false;
          }

          const qz = withDeliveryMode(normalizeQuizManualExplanations(JSON.parse(JSON.stringify({
              ...currentSnapshot,
              id: currentSnapshot.id || getTrueTime().toString()
          }))), getDeliveryMode(currentSnapshot));

          setExamBuilderSaveState("saving");
          try {
          const persisted = await persistQuizWithRevision(qz as Quiz);
          const existingIndex = quizzesRef.current.findIndex(q => q.id === persisted.id);
          const updated = [...quizzesRef.current];
          if (existingIndex !== -1) updated[existingIndex] = persisted;
          else updated.unshift(persisted);
          setQuizCatalogState(updated);
          editingQuizBaselineRef.current = null;
          setExamEditorDirty(false);
          setExamBuilderSaveState("saved");
          setEditingQuiz(null);
          localStorage.removeItem('ielts_exam_draft');
          showSaveToast(tx(`Đã lưu và đồng bộ đề "${qz.title}" thành công!`, `Exam "${qz.title}" saved and synced successfully!`), "success");
          return true;
          } catch (error: any) {
          setExamBuilderSaveState("error");
          if (String(error?.message || error).includes('QUIZ_REVISION_CONFLICT')) {
              showSaveToast(tx('Đề này vừa được thay đổi ở nơi khác. Hãy tải lại trước khi lưu.', 'This exam was modified elsewhere. Please reload before saving.'), "error");
              alert(tx('Đề này vừa được thay đổi ở nơi khác. Hãy tải lại danh sách trước khi lưu để tránh ghi đè chế độ hoặc trạng thái publish mới hơn.', 'This exam was modified elsewhere. Please reload the list before saving to avoid overwriting newer changes.'));
          } else {
              showSaveToast(tx(`Chưa thể đồng bộ đề "${qz.title}" lên máy chủ.`, `Could not sync exam "${qz.title}" to server.`), "error");
              alert(tx(`Chưa thể đồng bộ đề "${qz.title}" lên máy chủ.`, `Could not sync exam "${qz.title}" to server.`));
          }
          return false;
          }
      }
  };
  
  const duplicateQuiz = (q: Quiz) => {
      const newQuiz = normalizeQuizManualExplanations(JSON.parse(JSON.stringify({
          ...q,
          id: typeof crypto !== "undefined" && crypto.randomUUID
              ? `quiz_${crypto.randomUUID()}`
              : `quiz_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          title: q.title + " (Copy)",
          active: false
      })));
      setQuizzes(prev => [newQuiz, ...prev.filter(x => x.id !== newQuiz.id)]);
      void syncData({ __quizUpserts: [newQuiz] }).then(saved => {
          alert(saved ? tx("Đã nhân bản đề thi thành công!", "Exam duplicated successfully!") : tx("Bản sao được lưu trên thiết bị này và sẽ tự thử lại khi có kết nối.", "The copy is saved on this device and will retry automatically when the connection returns."));
      });
  };



  const persistBulkQuizUpdates = async (updates: Quiz[], action: string) => {
      if (!updates.length) return;
      const byId = new Map<string, Quiz>(updates.map(quiz => [quiz.id, quiz]));
      setQuizCatalogState(quizzesRef.current.map(quiz => byId.get(quiz.id) || quiz));
      const saved = await syncData({ __quizUpserts: updates });
      if (!saved) {
          alert(tx(`${action}: chưa đồng bộ được. Các thay đổi vẫn được giữ an toàn trên thiết bị và sẽ tự thử lại.`, `${action}: sync failed. Changes are kept safely on this device and will retry automatically.`));
      }
  };

  const bulkIdempotencyKey = (action: string, ids: string[]) => {
      const stableIds = [...ids].map(String).sort().join('_');
      return `bulk_${action}_${stableIds}_${getTrueTime()}_${Math.random().toString(36).slice(2, 10)}`.slice(0, 150);
  };

  const tryServerBulkAction = async (path: string, body: Record<string, any>): Promise<any | null> => {
      if (!currentUser) return null;
      try {
          const token = await currentUser.getIdToken();
          const response = await fetch(`${getApiBase()}${path}`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
          });
          if (response.status === 404 || response.status === 503) return null;
          const payload = await readApiJson(response);
          if (!response.ok) throw new Error(String(payload?.detail || payload?.error || 'Bulk operation failed.'));
          const changed = Array.isArray(payload?.results) ? payload.results.filter((item: any) => item?.success && item?.quiz).map((item: any) => item.quiz as Quiz) : [];
          if (changed.length) {
              const byId = new Map<string, Quiz>(changed.map((quiz: Quiz) => [quiz.id, quiz]));
              setQuizCatalogState(quizzesRef.current.map(quiz => byId.get(quiz.id) || quiz));
          }
          return payload;
      } catch (error: any) {
          alert(error?.message || 'Could not complete the bulk operation.');
          return { failed: true };
      }
  };

  const handleBulkDeliveryMode = async (mode: DeliveryMode) => {
      const targets = quizzesRef.current.filter(quiz => selectedQuizzes.includes(quiz.id));
      if (!targets.length) return;
      const label = mode === 'practice' ? 'Practice' : 'Exam';
      const message = mode === 'practice'
        ? `Convert ${targets.length} assessments to Practice?\n\nThis allows unlimited attempts and disables integrity checks. It does not change questions, answers, or previous results.`
        : `Convert ${targets.length} assessments to Exam?\n\nThe remembered Exam restrictions will be restored. Content and previous results are unchanged.`;
      if (!confirm(message)) return;
      const server = await tryServerBulkAction('/api/exams/bulk/mode', {
          exam_ids: targets.map(quiz => quiz.id), delivery_mode: mode,
          idempotency_key: bulkIdempotencyKey(`mode_${mode}`, targets.map(quiz => quiz.id)),
      });
      if (server) {
          setSelectedQuizzes([]);
          if (!server.failed) alert(`${server.succeeded || 0} converted to ${label}${server.failed ? `; ${server.failed} failed.` : ''}`);
          return;
      }
      const updates = targets.map(quiz => ({ ...withDeliveryMode(quiz, mode), updatedAt: getTrueTime() } as Quiz));
      await persistBulkQuizUpdates(updates, `Converted to ${label}`);
      setSelectedQuizzes([]);
  };

  const handleBulkPublish = async (active: boolean, onlyReady = false) => {
      const targets = quizzesRef.current.filter(quiz => selectedQuizzes.includes(quiz.id));
      const candidates = onlyReady ? targets.filter(isReadyForPublish) : targets;
      if (!candidates.length) {
          alert(onlyReady ? 'No selected assessments are READY to publish.' : 'No assessments selected.');
          return;
      }
      if (!confirm(`${active ? 'Publish' : 'Unpublish'} ${candidates.length} assessment${candidates.length === 1 ? '' : 's'}?`)) return;
      const server = await tryServerBulkAction('/api/exams/bulk/publish', {
          exam_ids: candidates.map(quiz => quiz.id), publish: active,
          idempotency_key: bulkIdempotencyKey(active ? 'publish' : 'unpublish', candidates.map(quiz => quiz.id)),
      });
      if (server) {
          setSelectedQuizzes([]);
          if (!server.failed) alert(`${server.succeeded || 0} ${active ? 'published' : 'unpublished'}.`);
          return;
      }
      const updates: Quiz[] = [];
      const skipped: string[] = [];
      candidates.forEach(quiz => {
          const publishability = isQuizPublishable(quiz);
          if (active && !publishability.ok) {
              skipped.push(`${quiz.title}: ${publishability.reason || 'not publishable'}`);
              return;
          }
          updates.push({ ...quiz, active, updatedAt: getTrueTime() });
      });
      await persistBulkQuizUpdates(updates, active ? 'Publish' : 'Unpublish');
      setSelectedQuizzes([]);
      alert(`${updates.length} ${active ? 'published' : 'unpublished'}${skipped.length ? `\n\nSkipped:\n${skipped.join('\n')}` : ''}`);
  };

  const handlePublishAllReady = async () => {
      const scope = selectedQuizzes.length
        ? quizzesRef.current.filter(quiz => selectedQuizzes.includes(quiz.id))
        : quizzesRef.current.filter(quiz => String(quiz.folder || 'Root') === String(builderFolder || 'Root'));
      const readyIds = scope.filter(isReadyForPublish).map(quiz => quiz.id);
      if (!readyIds.length) {
          alert('No READY assessments found in the current selection or folder.');
          return;
      }
      setSelectedQuizzes(readyIds);
      const candidates = scope.filter(quiz => readyIds.includes(quiz.id));
      if (!confirm(`Publish all ${candidates.length} READY assessment${candidates.length === 1 ? '' : 's'}?`)) return;
      const updates = candidates.map(quiz => ({ ...quiz, active: true, updatedAt: getTrueTime() }));
      await persistBulkQuizUpdates(updates, 'Publish all ready');
      setSelectedQuizzes([]);
      alert(`${updates.length} published.`);
  };

  const realExamSessionKey = (email = currentUser?.email || "") => `ielts_os_real_exam_session_${String(email || "").trim().toLowerCase()}`;
  const makeRealExamId = () => `realpkg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const makeRealExamAttemptId = () => `realattempt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const makeTestTakerId = () => String(Math.floor(100000 + Math.random() * 900000));
  const quizSkillRank = (quiz: any) => {
    const type = String(quiz?.type || "").toLowerCase();
    if (type.includes("listen")) return 0;
    if (type.includes("read")) return 1;
    if (type.includes("writ")) return 2;
    return 99;
  };
  const packageQuizzes = (pkg: RealExamPackage | null | undefined) =>
    (pkg?.quizIds || []).map(id => quizzesRef.current.find(quiz => quiz.id === id)).filter(Boolean) as Quiz[];
  const isPackageVisibleToStudent = (pkg: RealExamPackage, student: Student | undefined) => {
    if (!pkg?.active || !student) return false;
    if (pkg.audience === "SPECIFIC" && !(pkg.targetStudentIds || []).includes(student.id)) return false;
    const now = getRealTime();
    if (pkg.scheduledStart && now < parseVNTime(pkg.scheduledStart)) return false;
    if (pkg.scheduledEnd && now > parseVNTime(pkg.scheduledEnd)) return false;
    return packageQuizzes(pkg).length === (pkg.quizIds || []).length && (pkg.quizIds || []).length >= 2;
  };
  const persistRealExamSession = (session: RealExamSession | null) => {
    if (!currentUser?.email) return;
    try {
      if (session) localStorage.setItem(realExamSessionKey(), JSON.stringify(session));
      else localStorage.removeItem(realExamSessionKey());
    } catch (error) {}
  };
  const saveRealExamPackage = async (pkg: RealExamPackage) => {
    if (realExamPkgSaving) return false;
    setRealExamPkgSaving(true);
    try {
      const nextPkg: RealExamPackage = {
        ...pkg,
        id: pkg.id || makeRealExamId(),
        title: String(pkg.title || "Real exam package").trim(),
        quizIds: (pkg.quizIds || []).filter(Boolean),
        mode: (pkg.quizIds || []).length >= 3 ? "LRW" : "LR",
        maxAttempts: Math.max(1, Number(pkg.maxAttempts) || 1),
        updatedAt: Date.now(),
        createdAt: pkg.createdAt || Date.now(),
      };
      const nx = [nextPkg, ...realExamPackages.filter(item => item.id !== nextPkg.id)];
      setRealExamPackages(nx);
      const saved = await syncData({ realExamPackages: nx });
      realExamPkgBaselineRef.current = null;
      setRealExamPkgDirty(false);
      showSaveToast(
        saved
          ? tx(`Đã lưu gói thi thật "${nextPkg.title}" thành công!`, `Real exam package "${nextPkg.title}" saved successfully!`)
          : tx("Chưa đồng bộ được gói bài thi thật lên máy chủ. Dữ liệu vẫn giữ trên thiết bị này.", "Failed to sync real exam package. Data is safely stored on this device."),
        saved ? "success" : "warning"
      );
      return saved;
    } finally {
      setRealExamPkgSaving(false);
    }
  };
  const createRealExamPackageFromSelection = async () => {
    const selected = selectedQuizzes.map(id => quizzesRef.current.find(quiz => quiz.id === id)).filter(Boolean) as Quiz[];
    if (selected.length !== 2 && selected.length !== 3) {
      alert(tx("Chọn đúng 2 đề (Listening + Reading) hoặc 3 đề (Listening + Reading + Writing).", "Select exactly 2 exams (Listening + Reading) or 3 exams (Listening + Reading + Writing)."));
      return;
    }
    const ordered = [...selected].sort((a, b) => quizSkillRank(a) - quizSkillRank(b));
    const ranks = ordered.map(quizSkillRank);
    const valid = ranks[0] === 0 && ranks[1] === 1 && (ordered.length === 2 || ranks[2] === 2);
    if (!valid) {
      alert(tx("Gói thi thật phải theo thứ tự Listening - Reading hoặc Listening - Reading - Writing.", "Real exam package must follow the order: Listening - Reading or Listening - Reading - Writing."));
      return;
    }
    const pkg: RealExamPackage = {
      id: makeRealExamId(),
      title: `Real Exam Package ${new Date().toLocaleDateString(isVi ? "vi-VN" : "en-US")}`,
      active: false,
      mode: ordered.length === 3 ? "LRW" : "LR",
      quizIds: ordered.map(quiz => quiz.id),
      passcode: "",
      audience: "ALL",
      targetStudentIds: [],
      maxAttempts: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setRealExamPackageEditor(pkg);
  };
  const deleteRealExamPackage = async (pkgId: string) => {
    if (!confirm(tx("Xóa gói bài thi thật này?", "Delete this real exam package?"))) return;
    addLocalDeletedPackageIds([pkgId]);
    const nx = (realExamPackages || []).filter(pkg => pkg.id !== pkgId);
    setRealExamPackages(nx);
    await syncData({ realExamPackages: nx, __realExamPackageDeletedIds: [pkgId] });
  };
  const updateRealExamPackage = async (pkg: RealExamPackage, patch: Partial<RealExamPackage>) => {
    const nx = realExamPackages.map(item => item.id === pkg.id ? { ...item, ...patch, updatedAt: Date.now() } : item);
    setRealExamPackages(nx);
    await syncData({ realExamPackages: nx });
  };

  const dismissAiGenerationBatch = () => {
    setAiGenerationBatch(null);
    aiGenerationBatchRef.current = null;
    if (currentUser?.uid) {
      try { window.localStorage.removeItem(aiGenerationStorageKey(currentUser.uid)); } catch (_) {}
    }
    aiGenerationDriverRef.current = { batchId: "", inFlight: false, stopped: true, epoch: aiGenerationDriverRef.current.epoch + 1 };
  };

  const allKnownFolders = useMemo(() => {
    const set = new Set<string>(["Root"]);
    (examFolders || []).forEach(f => {
      const norm = normalizeFolderPath(f);
      if (norm && norm !== "Root") {
        set.add(norm);
        let p = norm;
        while (p.includes("/") && p !== "Root") {
          set.add(p);
          p = p.slice(0, p.lastIndexOf("/"));
        }
      }
    });
    (quizzes || []).forEach(q => {
      const norm = normalizeFolderPath(q.folder);
      if (norm && norm !== "Root") {
        set.add(norm);
        let p = norm;
        while (p.includes("/") && p !== "Root") {
          set.add(p);
          p = p.slice(0, p.lastIndexOf("/"));
        }
      }
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [examFolders, quizzes]);

  const handleCreateFolder = async (folderName: string, parentPath = builderFolder) => {
    const trimmed = folderName.trim().replace(/^\/+|\/+$/g, "");
    if (!trimmed) return;
    const parent = normalizeFolderPath(parentPath);
    const fullPath = parent === "Root" ? `Root/${trimmed}` : `${parent}/${trimmed}`;
    if (allKnownFolders.map(normalizeFolderPath).includes(fullPath)) {
      alert(tx("Thư mục đã tồn tại.", "Folder already exists."));
      return;
    }
    const nextFolders = Array.from(new Set([...examFolders.map(normalizeFolderPath), fullPath])).filter(f => f && f !== "Root").sort();
    setExamFolders(nextFolders);
    try { localStorage.setItem("ielts_exam_folders", JSON.stringify(nextFolders)); } catch (_) {}
    await syncData({ examFolders: nextFolders });
  };

  const handleMoveOrRenameFolder = async (rawOldPath: string, rawNewPath: string) => {
    const oldPath = normalizeFolderPath(rawOldPath);
    const newPath = normalizeFolderPath(rawNewPath);
    if (oldPath === "Root" || !oldPath || !newPath) return;
    if (newPath === oldPath) return;
    if (newPath.startsWith(oldPath + "/")) {
      alert(tx("Không thể chuyển thư mục vào bên trong chính nó hoặc thư mục con.", "Cannot move a folder into itself or a subfolder."));
      return;
    }

    const allFoldersSet = new Set<string>();
    (examFolders || []).forEach(f => allFoldersSet.add(normalizeFolderPath(f)));
    quizzesRef.current.forEach(q => {
      const qf = normalizeFolderPath(q.folder);
      if (qf && qf !== "Root") allFoldersSet.add(qf);
    });
    allFoldersSet.add(oldPath);

    const retiredFolders: string[] = [];
    const nextFoldersSet = new Set<string>();

    allFoldersSet.forEach(f => {
      if (f === oldPath || f.startsWith(oldPath + "/")) {
        retiredFolders.push(f);
        const mapped = newPath + f.slice(oldPath.length);
        nextFoldersSet.add(mapped);
        let p = mapped;
        while (p.includes("/") && p !== "Root") {
          nextFoldersSet.add(p);
          p = p.slice(0, p.lastIndexOf("/"));
        }
      } else if (f !== "Root") {
        nextFoldersSet.add(f);
      }
    });
    nextFoldersSet.add(newPath);
    let p = newPath;
    while (p.includes("/") && p !== "Root") {
      nextFoldersSet.add(p);
      p = p.slice(0, p.lastIndexOf("/"));
    }

    const nextFolders = Array.from(nextFoldersSet).filter(f => f && f !== "Root").sort();

    const now = getTrueTime();
    const updatedQuizzes: Quiz[] = [];
    const nextQuizzes = quizzesRef.current.map(q => {
      const qf = normalizeFolderPath(q.folder);
      if (qf === oldPath || qf.startsWith(oldPath + "/")) {
        const nextFolder = qf === oldPath ? newPath : (newPath + qf.slice(oldPath.length));
        const updated = {
          ...q,
          folder: nextFolder,
          updatedAt: now,
          revision: (Number((q as any).revision) || 0) + 1,
        };
        updatedQuizzes.push(updated);
        return updated;
      }
      return q;
    });

    setQuizCatalogState(nextQuizzes);
    setExamFolders(nextFolders);
    try { localStorage.setItem("ielts_exam_folders", JSON.stringify(nextFolders)); } catch (_) {}
    if (builderFolder === oldPath || builderFolder.startsWith(oldPath + "/")) {
      setBuilderFolder(builderFolder === oldPath ? newPath : (newPath + builderFolder.slice(oldPath.length)));
    }
    await syncData({
      examFolders: nextFolders,
      __examFolderTombstones: retiredFolders,
      __quizUpserts: updatedQuizzes,
    });
  };

  const handleRenameFolder = async (rawOldPath: string, newName: string) => {
    const oldPath = normalizeFolderPath(rawOldPath);
    if (oldPath === "Root") {
      alert(tx("Không thể đổi tên thư mục Root.", "Cannot rename Root folder."));
      return;
    }
    const trimmed = newName.trim().replace(/^\/+|\/+$/g, "");
    if (!trimmed) return;
    const parent = oldPath.includes("/") ? oldPath.slice(0, oldPath.lastIndexOf("/")) : "Root";
    const newPath = parent === "Root" ? `Root/${trimmed}` : `${parent}/${trimmed}`;
    if (newPath === oldPath) return;
    if (allKnownFolders.map(normalizeFolderPath).includes(newPath)) {
      alert(tx("Thư mục với tên này đã tồn tại ở vị trí hiện tại.", "A folder with this name already exists in the current location."));
      return;
    }
    await handleMoveOrRenameFolder(oldPath, newPath);
  };

  const handleDeleteFolder = async (rawTargetPath: string) => {
    const targetPath = normalizeFolderPath(rawTargetPath);
    if (targetPath === "Root") {
      alert(tx("Không thể xóa thư mục Root.", "Cannot delete Root folder."));
      return;
    }
    const containedQuizzes = quizzesRef.current.filter(q => {
      const f = normalizeFolderPath(q.folder);
      return f === targetPath || f.startsWith(targetPath + "/");
    });
    const containedSubfolders = allKnownFolders.filter(f => {
      const nf = normalizeFolderPath(f);
      return nf.startsWith(targetPath + "/");
    });

    const confirmMsg = containedQuizzes.length > 0 || containedSubfolders.length > 0
      ? tx(`Thư mục "${targetPath}" chứa ${containedQuizzes.length} đề thi và ${containedSubfolders.length} thư mục con.\n\nBạn có chắc muốn xóa? Toàn bộ đề thi bên trong sẽ được chuyển về thư mục cha.`, `Folder "${targetPath}" contains ${containedQuizzes.length} exams and ${containedSubfolders.length} subfolders.\n\nAre you sure you want to delete it? All contained exams will be moved to the parent folder.`)
      : tx(`Bạn có chắc muốn xóa thư mục trống "${targetPath}"?`, `Are you sure you want to delete the empty folder "${targetPath}"?`);

    if (!confirm(confirmMsg)) return;

    const parentPath = targetPath.includes("/") ? targetPath.slice(0, targetPath.lastIndexOf("/")) : "Root";
    const retiredFolders = [targetPath, ...containedSubfolders.map(normalizeFolderPath)];
    const retiredSet = new Set(retiredFolders);
    const nextFolders = examFolders
      .map(normalizeFolderPath)
      .filter(f => f && f !== "Root" && !retiredSet.has(f));

    const now = getTrueTime();
    const updatedQuizzes: Quiz[] = [];
    const nextQuizzes = quizzesRef.current.map(q => {
      const qf = normalizeFolderPath(q.folder);
      if (qf === targetPath || qf.startsWith(targetPath + "/")) {
        const updated = { ...q, folder: parentPath, updatedAt: now, revision: (Number((q as any).revision) || 0) + 1 };
        updatedQuizzes.push(updated);
        return updated;
      }
      return q;
    });

    setQuizCatalogState(nextQuizzes);
    setExamFolders(nextFolders);
    try { localStorage.setItem("ielts_exam_folders", JSON.stringify(nextFolders)); } catch (_) {}
    if (builderFolder === targetPath || builderFolder.startsWith(targetPath + "/")) {
      setBuilderFolder(parentPath);
    }
    await syncData({
      examFolders: nextFolders,
      __examFolderTombstones: retiredFolders,
      __quizUpserts: updatedQuizzes,
    });
  };

  const handleMoveQuizzes = async (quizIds: string[], rawDestFolder: string) => {
    if (!quizIds.length) return;
    const dest = normalizeFolderPath(rawDestFolder);
    const now = getTrueTime();
    const updatedQuizzes: Quiz[] = [];
    const nextQuizzes = quizzesRef.current.map(q => {
      if (quizIds.includes(q.id)) {
        if (normalizeFolderPath(q.folder) !== dest) {
          const updated = { ...q, folder: dest, updatedAt: now, revision: (Number((q as any).revision) || 0) + 1 };
          updatedQuizzes.push(updated);
          return updated;
        }
      }
      return q;
    });

    if (updatedQuizzes.length === 0) return;

    let nextFolders = examFolders.map(normalizeFolderPath);
    if (dest !== "Root" && !nextFolders.includes(dest)) {
      nextFolders = Array.from(new Set([...nextFolders, dest])).filter(f => f && f !== "Root").sort();
      setExamFolders(nextFolders);
      try { localStorage.setItem("ielts_exam_folders", JSON.stringify(nextFolders)); } catch (_) {}
    }

    setQuizCatalogState(nextQuizzes);
    setSelectedQuizzes(prev => prev.filter(id => !quizIds.includes(id)));
    await syncData({ __quizUpserts: updatedQuizzes, examFolders: nextFolders });
  };

  const handleDropOnFolder = async (e: React.DragEvent, destFolder: string) => {
    e.preventDefault();
    setDragOverFolderTarget(null);
    const raw = e.dataTransfer.getData("application/json");
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      const normDest = normalizeFolderPath(destFolder);
      if (data.type === "QUIZ" && data.quizId) {
        const movingIds = selectedQuizzes.includes(data.quizId) ? selectedQuizzes : [data.quizId];
        await handleMoveQuizzes(movingIds, normDest);
      } else if (data.type === "FOLDER" && data.folderPath) {
        const oldPath = normalizeFolderPath(data.folderPath);
        if (oldPath === normDest || normDest.startsWith(oldPath + "/")) return;
        const fName = oldPath.split("/").pop()!;
        const newPath = normDest === "Root" ? `Root/${fName}` : `${normDest}/${fName}`;
        await handleMoveOrRenameFolder(oldPath, newPath);
      }
    } catch (_) {}
  };
  const requestRealExamFullscreen = (refresh = false) => {
    const root = document.documentElement as any;
    if (!root.requestFullscreen) return;
    const viewportHeight = Math.max(Number(window.innerHeight) || 0, Number(window.visualViewport?.height) || 0);
    const screenHeight = Number(window.screen?.height) || 0;
    const fillsScreen = !screenHeight || screenHeight - viewportHeight <= 8;
    const enter = () => root.requestFullscreen({ navigationUI: "hide" }).catch(() => root.requestFullscreen().catch(() => {}));
    if (!document.fullscreenElement) { enter(); return; }
    if (refresh && !fillsScreen) document.exitFullscreen().catch(() => {}).finally(enter);
  };
  const startRealExamPackage = (pkg: RealExamPackage) => {
    const me = students.find(s => s.email?.toLowerCase() === currentUser?.email?.toLowerCase());
    if (!me || !pkg.active) return;
    const now = getRealTime();
    if (pkg.scheduledStart && now < parseVNTime(pkg.scheduledStart)) { alert("This exam package has not opened yet."); return; }
    if (pkg.scheduledEnd && now > parseVNTime(pkg.scheduledEnd)) { alert("This exam package is closed."); return; }
    if (!isPackageVisibleToStudent(pkg, me)) return;
    if (pkg.passcode) {
      const pass = prompt("Enter package passcode:");
      if (pass !== pkg.passcode) { alert("Passcode is not correct."); return; }
    }
    let session: RealExamSession | null = realExamSession?.packageId === pkg.id ? realExamSession : null;
    if (!session) {
      try {
        const saved = JSON.parse(localStorage.getItem(realExamSessionKey()) || "null");
        if (saved?.packageId === pkg.id) session = saved;
      } catch (error) {}
    }
    if (!session) {
      const previousAttempts = new Set(
        quizResults
          .filter(result => result.studentId === me.id && result.realExamPackageId === pkg.id)
          .map(result => result.realExamAttemptId)
          .filter(Boolean)
      );
      if (previousAttempts.size >= Math.max(1, Number(pkg.maxAttempts) || 1)) {
        alert(`You have used all ${Math.max(1, Number(pkg.maxAttempts) || 1)} attempt(s) for this exam package.`);
        return;
      }
    }
    session = session || {
      packageId: pkg.id,
      packageAttemptId: makeRealExamAttemptId(),
      testTakerId: makeTestTakerId(),
      completedQuizIds: [],
      startedAt: Date.now(),
    };
    setRealExamSession(session);
    persistRealExamSession(session);
    setPortalTab("exams");
    requestRealExamFullscreen();
  };
  const realExamSkillLabel = (quiz: Quiz | undefined | null) => {
    const type = String(quiz?.type || "").toLowerCase();
    if (type.includes("listen")) return "Listening";
    if (type.includes("read")) return "Reading";
    if (type.includes("writ")) return "Writing";
    return String(quiz?.type || "Exam");
  };
  const officialInstructionVideoUrl = (skill: string) => {
    if (skill === "Listening") return "/instruction-videos/listening-tutorial-v2.mp4";
    if (skill === "Reading") return "/instruction-videos/reading-tutorial-v2.mp4";
    if (skill === "Writing") return "/instruction-videos/writing-tutorial-v1.mp4";
    return "";
  };
  const launchRealExamPackageQuiz = (pkg: RealExamPackage, quizId: string) => {
    if (!realExamSession || realExamSession.packageId !== pkg.id) return startRealExamPackage(pkg);
    const nextQuizId = (pkg.quizIds || []).find(id => !realExamSession.completedQuizIds.includes(id));
    if (quizId !== nextQuizId) {
      alert("Please wait for the invigilator's instruction and take the tests in order.");
      return;
    }
    const source = quizzesRef.current.find(quiz => quiz.id === quizId);
    if (!source) { alert("This test is no longer available."); return; }
    _setAudioVolume((realExamAudioMuted ? 0 : realExamAudioVolume) / 100);
    const orderIndex = (pkg.quizIds || []).indexOf(quizId);
    const launchQuiz: Quiz = {
      ...source,
      active: true,
      maxAttempts: Number.MAX_SAFE_INTEGER,
      scheduledStart: undefined,
      scheduledEnd: undefined,
      passcode: undefined,
      practiceMode: false,
      audioMode: String(source.type || "").toLowerCase().includes("listen") ? "strict" : source.audioMode,
      realExamContext: {
        packageId: pkg.id,
        packageTitle: pkg.title,
        packageQuizIds: pkg.quizIds,
        packageAttemptId: realExamSession.packageAttemptId,
        testTakerId: realExamSession.testTakerId,
        orderIndex,
        total: pkg.quizIds.length,
        isFinal: orderIndex === pkg.quizIds.length - 1,
      },
    };
    startExam(launchQuiz, false, false);
  };
  const startRealExamPackageQuiz = (pkg: RealExamPackage, quizId: string) => {
    const source = quizzesRef.current.find(quiz => quiz.id === quizId);
    const skill = realExamSkillLabel(source);
    const videoUrl = officialInstructionVideoUrl(skill);
    if (videoUrl && realExamSession?.packageId === pkg.id) {
      setRealExamInstructionGate({
        packageId: pkg.id,
        quizId,
        skill: skill as "Listening" | "Reading" | "Writing",
        videoUrl,
        ready: false,
        nonce: Date.now(),
      });
      requestRealExamFullscreen();
      return;
    }
    launchRealExamPackageQuiz(pkg, quizId);
  };
  const confirmRealExamInstructionGate = () => {
    const gate = realExamInstructionGate;
    if (!gate?.ready) return;
    if (isTouchAudioHost()) void warmAndroidAudioPath();
    const a = audioRef.current;
    if (a && a.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
      a.preload = "auto";
      if (a.networkState === HTMLMediaElement.NETWORK_EMPTY) a.load();
    }
    const pkg = realExamPackages.find(item => item.id === gate.packageId);
    const quizId = gate.quizId;
    setRealExamInstructionGate(null);
    if (pkg) window.setTimeout(() => launchRealExamPackageQuiz(pkg, quizId), 0);
  };

  const writingLocalDraftKey = (quiz: Quiz, attemptId: string) =>
    `ielts_writing_draft_${writingDraftKey(currentUser?.email || "anonymous", quiz.id, attemptId)}`;

  const queueWritingDraftSave = (quiz: Quiz, answers: Record<string, any>, immediate = false) => {
    if (!isWritingQuiz(quiz) || isPreview || !currentUser?.email || !writingAttemptIdRef.current) return Promise.resolve(true);
    const revision = ++writingRevisionRef.current;
    const payload = {
      quizId: quiz.id,
      attemptId: writingAttemptIdRef.current,
      ownerEmail: currentUser.email.toLowerCase(),
      answers,
      revision,
      updatedAt: Date.now(),
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      submitted: false,
    };
    try { localStorage.setItem(writingLocalDraftKey(quiz, writingAttemptIdRef.current), JSON.stringify(payload)); } catch {}
    if (writingAutosaveTimerRef.current) window.clearTimeout(writingAutosaveTimerRef.current);
    const persist = async () => {
      if (!navigator.onLine) { setWritingSaveState("offline"); return false; }
      setWritingSaveState("saving");
      try {
        await setDoc(doc(WRITING_DRAFTS_COLLECTION_REF, writingDraftKey(currentUser.email!, quiz.id, payload.attemptId)), payload, { merge: true });
        if (writingRevisionRef.current === revision) setWritingSaveState("saved");
        return true;
      } catch (error) {
        console.error("Writing autosave failed:", error);
        setWritingSaveState(navigator.onLine ? "error" : "offline");
        return false;
      }
    };
    if (immediate) {
      const task = writingSaveChainRef.current.then(persist, persist);
      writingSaveChainRef.current = task.then(() => undefined, () => undefined);
      return task;
    }
    writingAutosaveTimerRef.current = window.setTimeout(() => {
      const task = writingSaveChainRef.current.then(persist, persist);
      writingSaveChainRef.current = task.then(() => undefined, () => undefined);
    }, 900);
    return Promise.resolve(true);
  };

  const restoreWritingDraft = async (quiz: Quiz, attemptId: string) => {
    const localKey = writingLocalDraftKey(quiz, attemptId);
    let localDraft: any = null;
    try { localDraft = JSON.parse(localStorage.getItem(localKey) || "null"); } catch {}
    let remoteDraft: any = null;
    if (currentUser?.email && navigator.onLine) {
      try {
        const snapshot = await getDocFromServer(doc(WRITING_DRAFTS_COLLECTION_REF, writingDraftKey(currentUser.email, quiz.id, attemptId)));
        if (snapshot.exists()) remoteDraft = snapshot.data();
      } catch (error) {
        console.warn("Writing draft restore deferred:", error);
      }
    }
    const newest = [localDraft, remoteDraft]
      .filter(item => item && item.submitted !== true && item.attemptId === attemptId)
      .sort((a, b) => Number(b.revision || b.updatedAt || 0) - Number(a.revision || a.updatedAt || 0))[0];
    if (!newest || writingAttemptIdRef.current !== attemptId) return;
    writingRevisionRef.current = Math.max(writingRevisionRef.current, Number(newest.revision) || 0);
    setExamAnswers((previous) => Object.keys(previous).length ? previous : { ...(newest.answers || {}) });
    setWritingSaveState(remoteDraft && newest === remoteDraft ? "saved" : navigator.onLine ? "idle" : "offline");
  };

  useEffect(() => {
    if (!activeExam || !isWritingQuiz(activeExam) || isPreview) return;
    void queueWritingDraftSave(activeExam, examAnswers);
  }, [activeExam?.id, examAnswers, isPreview]);

  useEffect(() => {
    if (!activeExam || !isWritingQuiz(activeExam) || isPreview) return;
    if (writingLastSectionRef.current !== currentSectionIndex) {
      writingLastSectionRef.current = currentSectionIndex;
      void queueWritingDraftSave(activeExam, latestExamState.current.examAnswers, true);
    }
  }, [currentSectionIndex, activeExam?.id, isPreview]);

  const handleAnswerChange = (questionId: string, answer: any, _type?: string) => {
    // FIX: Sử dụng Functional Update để đảm bảo State mới nhất không bị ghi đè khi gõ nhanh
    const question =
      activeExam?.questions?.find((item: any) => String(item?.id || "") === String(questionId))
      || activeExam?.sections?.flatMap((section: any) => section?.questions || []).find((item: any) => String(item?.id || "") === String(questionId));
    const nextAnswer = question?.type === "MATCHING" ? resolveMatchingAnswerText(question, answer) : answer;
    setExamAnswers(prev => ({...prev, [questionId]: nextAnswer}));
    if (!activeExam || !isWritingQuiz(activeExam)) {
      setSaveStatus("Saving...");
      setTimeout(() => setSaveStatus("Saved"), 500);
    }
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
      const isQuestLaunch = Boolean(quiz.questContext);
      const isRealExamLaunch = Boolean(quiz.realExamContext);
      const deliveryPolicy = getDeliveryPolicy(quiz);
      
      if (!isTeacherPreview && !isStudentTestUI) {
          const now = getRealTime();
          if (!isQuestLaunch && !isRealExamLaunch && quiz.scheduledStart && now < parseVNTime(quiz.scheduledStart)) { alert(tx("Bài thi này chưa tới giờ mở!", "This exam has not started yet!")); return; }
          if (!isQuestLaunch && !isRealExamLaunch && quiz.scheduledEnd && now > parseVNTime(quiz.scheduledEnd)) { alert(tx("Bài thi này đã quá hạn và bị đóng!", "This exam has expired and is now closed!")); return; }
          
          if (!deliveryPolicy.isPractice && deliveryPolicy.isSEBRequired) {
              const isSEB = navigator.userAgent.includes("SEB");
              if (!isSEB) {
                  // Hiển thị màn hình hướng dẫn thay vì dùng alert()
                  setSebGuideQuiz(quiz);
                  return;
              }
          }
          
          if (!isQuestLaunch && !isRealExamLaunch && quiz.passcode) {
              const pass = prompt(tx("Nhập mã bảo vệ phòng thi (Nếu không có, cứ để trống và bấm OK):", "Enter test room passcode (If none, leave blank and click OK):"));
              if (pass !== quiz.passcode) { alert(tx("Mã bảo vệ không đúng!", "Incorrect passcode!")); return; }
          }

          if (currentUser && !isQuestLaunch && !isRealExamLaunch) {
              const myHistory = quizResults.filter(r => r.quizId === quiz.id && r.studentId === students.find(s => s.email?.toLowerCase() === currentUser.email?.toLowerCase())?.id);
              if (!deliveryPolicy.isPractice && myHistory.length >= deliveryPolicy.maxAttempts) {
                  alert(tx(`Bạn đã hết số lần làm bài! (Tối đa ${deliveryPolicy.maxAttempts} lần)`, `You have used all available attempts! (Maximum ${deliveryPolicy.maxAttempts} attempts)`));
                  return;
              }
          }
      }

      // Khôi phục lại màn hình chờ (Instructions)
      setPendingExamState({ quiz: stripExamExplanations(normalizeExamSections(quiz)), isPreview: isTeacherPreview, isStudentTestUI });
  };

  const startTopicQuestNode = (assignment: TopicAssignment, node: QuestNodeConfig) => {
      const questTx = (vi: string, en: string) => i18n.language === 'vi' ? vi : en;
      const me = students.find(student => student.email?.toLowerCase() === currentUser?.email?.toLowerCase());
      const nodeIndex = assignment.nodes.findIndex(item => item.id === node.id);
      if (!me || nodeIndex < 0) return;
      if (isOffline || !navigator.onLine) {
          alert(questTx('Bài tập chuyên đề cần có kết nối để lưu tiến độ và mở khóa chính xác.', 'Topic-based assignments need a connection to save progress and unlock steps accurately.'));
          return;
      }
      const progress = questProgress.find(item => item.studentId === me.id && item.topicAssignmentId === assignment.id);
      const state = getQuestNodeState(assignment, progress, nodeIndex, getRealTime());
      if (state !== "available" && state !== "retry") {
          alert(state === "locked"
            ? questTx('Hãy hoàn thành chặng trước trước khi mở bài này.', 'Complete the previous step before opening this test.')
            : questTx('Chặng này hiện chưa mở hoặc đã đóng.', 'This step is not open or has already closed.'));
          return;
      }
      const sourceQuiz = quizzes.find(quiz => quiz.id === node.testId);
      if (!sourceQuiz || !Array.isArray(sourceQuiz.questions) || !sourceQuiz.questions.length) {
          alert(questTx('Đề gốc của chặng này không còn khả dụng. Hãy báo giáo viên.', 'The source test for this step is unavailable. Please contact your teacher.'));
          return;
      }
      const requestedCount = Math.max(1, Math.min(Number(node.questionCount) || sourceQuiz.questions.length, sourceQuiz.questions.length));
      const selectedQuestions = sourceQuiz.questions.slice(0, requestedCount);
      const questQuiz: Quiz = {
          ...sourceQuiz,
          title: node.title || sourceQuiz.title,
          questions: selectedQuestions,
          timeLimit: Math.max(1, Number(node.timeLimitMinutes) || Number(sourceQuiz.timeLimit) || 1),
          maxAttempts: Number.MAX_SAFE_INTEGER,
          active: true,
          practiceMode: node.mode === "practice",
          audioMode: node.mode === "practice" ? "practice" : sourceQuiz.audioMode,
          isSEBRequired: node.mode === "practice" ? false : sourceQuiz.isSEBRequired,
          scheduledStart: undefined,
          scheduledEnd: undefined,
          passcode: undefined,
          questContext: { topicAssignmentId: assignment.id, nodeId: node.id },
      };
      setQuestLaunchLoading(node.id);
      window.setTimeout(() => {
          setQuestLaunchLoading(null);
          startExam(questQuiz, false, false);
      }, 180);
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
      if (isTouchAudioHost()) void warmAndroidAudioPath();
      const a = audioRef.current;
      if (a && a.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
          a.preload = "auto";
          if (a.networkState === HTMLMediaElement.NETWORK_EMPTY) a.load();
      }
      // isStudentTestUI: dùng đề mã hóa + đánh dấu isPreview để KHÔNG lưu kết quả thật
      const sourceQuiz = isStudentTestUI ? createTestUIQuiz(quiz) : quiz;
      const writingTasks = normalizeWritingTasks(sourceQuiz);
      const quizWithWriting = isWritingQuiz(sourceQuiz)
        ? { ...sourceQuiz, writingTasks, questions: writingQuestions({ ...sourceQuiz, writingTasks }) }
        : sourceQuiz;
      const quizToLoad = stripExamExplanations(normalizeExamSections(quizWithWriting));
      const isPreviewMode = isTeacherPreview || isStudentTestUI;
      const now = getRealTime();
      const delayTimerUntilAudioPlay = shouldDelayListeningExamTimer(quizToLoad, isPreviewMode);

      setExamAnswers({});
      if (isWritingQuiz(quizToLoad)) {
          const sessionKey = `ielts_writing_active_${String(currentUser?.email || "preview").toLowerCase()}_${quizToLoad.id}`;
          let attemptId = "";
          try { attemptId = String(JSON.parse(localStorage.getItem(sessionKey) || "null")?.attemptId || ""); } catch {}
          if (!attemptId || isPreviewMode) attemptId = `writing_${quizToLoad.id}_${getTrueTime()}_${Math.random().toString(36).slice(2, 8)}`;
          writingAttemptIdRef.current = attemptId;
          writingRevisionRef.current = 0;
          setWritingSaveState("idle");
          if (!isPreviewMode) {
              try { localStorage.setItem(sessionKey, JSON.stringify({ attemptId, startedAt: now })); } catch {}
              void restoreWritingDraft(quizToLoad, attemptId);
          }
      } else {
          writingAttemptIdRef.current = "";
      }
      setExamTimeLeft(quizToLoad.timeLimit * 60);
      setExamStartTime(delayTimerUntilAudioPlay ? 0 : now);
      trueEndTimeRef.current = delayTimerUntilAudioPlay ? 0 : now + quizToLoad.timeLimit * 60000;
      timeAlertMilestonesRef.current = new Set();
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
      setSelectedDragAnswer("");
      setPendingAudioResume(null);
      audioPlayRequestRef.current = false;
      
      setActiveExam(quizToLoad);
      setCurrentSectionIndex(0); // Reset Tab khi mở đề mới
      
      if (document.documentElement.requestFullscreen && !isPreviewMode && !isPracticeQuiz(quizToLoad)) {
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
          const summary = getQuizScoreSummary(qz, r.answers || {});
          return {...r, score: summary.score, total: summary.total, band: getIeltsBand(summary.score, summary.total, qz.type)};
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
      const writingExam = isWritingQuiz(state.activeExam);
      if (writingExam && writingSubmittingRef.current) return;
      if (writingExam) {
          writingSubmittingRef.current = true;
          void queueWritingDraftSave(state.activeExam, state.examAnswers, true);
      }

      const scoreSummary = getQuizScoreSummary(state.activeExam, state.examAnswers);
      const score = scoreSummary.score;
      const totalQ = scoreSummary.total;

      const band = writingExam ? "Pending" : getIeltsBand(score, totalQ, state.activeExam.type);

     if (state.isPreview) {
            alert(writingExam ? "WRITING PREVIEW COMPLETE." : `PREVIEW COMPLETE! Score: ${score}/${totalQ}. Band: ${band}.`);
            setActiveExam(null); 
            setIsPreview(false); 
            if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
            writingSubmittingRef.current = false;
            return;
        }

      const me = students.find(s => s.email?.toLowerCase() === currentUser?.email?.toLowerCase());
      if (!me) { writingSubmittingRef.current = false; return; }

      const endTime = getRealTime();
      const effectiveStartTime = examStartTime || endTime;
      const durationSecs = Math.max(0, Math.floor((endTime - effectiveStartTime) / 1000));

      const questContext = state.activeExam.questContext;
      const realExamContext = state.activeExam.realExamContext;
      const assignment = questContext
        ? topicAssignments.find(item => item.id === questContext.topicAssignmentId)
        : undefined;
      const node = assignment && questContext
        ? assignment.nodes.find(item => item.id === questContext.nodeId)
        : undefined;
      const percentage = totalQ > 0 ? Number(((score / totalQ) * 100).toFixed(2)) : 0;
      const questPassed = Boolean(node && percentage >= Math.max(0, Math.min(100, Number(node.passingThresholdPercent) || 0)));
      const resultId = writingExam && writingAttemptIdRef.current
        ? writingAttemptIdRef.current
        : `${getTrueTime()}_${Math.random().toString(36).slice(2, 7)}`;
      const result: QuizResult = {
          id: resultId, quizId: state.activeExam.id, quizTitle: state.activeExam.title, studentId: me.id, studentName: me.name,
          date: new Date().toLocaleString("vi-VN"), score, total: totalQ, band, cheatCount: state.examCheatCount, submittedAt: endTime,
          ...(writingExam ? { submissionId: resultId, writingGrading: { status: "awaiting_grading" as const, taskScores: {}, correctedAnswers: {}, comments: [] } } : {}),
          startTime: new Date(effectiveStartTime).toLocaleString("vi-VN"), endTime: new Date(endTime).toLocaleString("vi-VN"),
          durationSeconds: durationSecs, deviceInfo: navigator.userAgent, ipAddress: studentIp, answers: state.examAnswers,
          scratchpad: state.scratchpadText, flaggedQuestions: state.flaggedQuestions, isRead: false,
          ...(questContext ? {
            topicAssignmentId: questContext.topicAssignmentId,
            topicNodeId: questContext.nodeId,
            questPassed,
            questQuestionIds: state.activeExam.questions.map(question => question.id),
          } : {}),
          ...(realExamContext ? {
            hiddenFromStudent: true,
            realExamPackageId: realExamContext.packageId,
            realExamPackageTitle: realExamContext.packageTitle,
            realExamAttemptId: realExamContext.packageAttemptId,
            realExamOrderIndex: realExamContext.orderIndex,
            testTakerId: realExamContext.testTakerId,
          } : {}),
      };

      const nextResults = [result, ...quizResults];
      let nextStudents = students;
      let nextQuestProgress = questProgress;
      let coinOperation: CoinOperation | null = null;
      let submissionMessage = writingExam ? "WRITING SUBMITTED. Both tasks are saved in one attempt." : `EXAM SUBMITTED! Score: ${score}/${totalQ}. Band: ${band}.`;
      let questNotice: QuestStatusNotice | null = null;
      const questTx = (vi: string, en: string) => i18n.language === 'vi' ? vi : en;

      if (questContext) {
          if (!assignment || !node) {
            submissionMessage = questTx(
              'Bài đã nộp, nhưng chuyên đề này đã bị giáo viên thay đổi. Kết quả chưa thể mở khóa chặng tiếp theo.',
              'Your test was submitted, but this quest has since been changed by your teacher. Its result cannot unlock the next step.'
            );
            questNotice = { kind: 'changed' };
          } else {
            const existingProgress = questProgress.find(item =>
              item.studentId === me.id && item.topicAssignmentId === assignment.id
            ) || emptyQuestProgress(me.id, assignment.id);
            const normalizedProgress = deriveQuestProgress(existingProgress, assignment);
            const previousAttempts = normalizedProgress.attempts[node.id] || [];
            const questAttempt: QuestAttempt = {
              id: resultId,
              resultId,
              score,
              totalQuestions: totalQ,
              percentage,
              passed: questPassed,
              submittedAt: endTime,
              attemptCount: previousAttempts.length + 1,
            };
            const progressAfterAttempt = deriveQuestProgress({
              ...normalizedProgress,
              studentId: me.id,
              topicAssignmentId: assignment.id,
              attempts: { ...normalizedProgress.attempts, [node.id]: [...previousAttempts, questAttempt] },
              updatedAt: endTime,
            }, assignment);
            const newlyUnlocked = evaluateQuestRewards(assignment, progressAfterAttempt)
              .filter(reward => !progressAfterAttempt.unlockedRewards.includes(reward.id));
            const progressAfterRewards = deriveQuestProgress({
              ...progressAfterAttempt,
              unlockedRewards: [...progressAfterAttempt.unlockedRewards, ...newlyUnlocked.map(reward => reward.id)],
              updatedAt: endTime,
            }, assignment);
            nextQuestProgress = [
              ...questProgress.filter(item => !(item.studentId === me.id && item.topicAssignmentId === assignment.id)),
              progressAfterRewards,
            ];

            const earnedQuestCoins = newlyUnlocked
              .filter(reward => reward.rewardType === "coins")
              .reduce((sum, reward) => sum + parseQuestCoinReward(reward.rewardValue), 0);
            const permanentGifts = newlyUnlocked
              .filter(reward => reward.rewardType === "permanent_gift")
              .map(reward => String(reward.rewardValue || "").trim())
              .filter(name => permanentGiftCatalog.some(item => item.enabled && item.name === name));
            const consumableGifts = newlyUnlocked
              .filter(reward => reward.rewardType === "consumable_gift")
              .reduce<Record<string, number>>((grants, reward) => {
                const name = String(reward.rewardValue || "").trim();
                if (consumableGiftCatalog.some(item => item.enabled && item.name === name)) grants[name] = (grants[name] || 0) + getQuestRewardQuantity(reward);
                return grants;
              }, {});
            const hasConsumableGifts = Object.keys(consumableGifts).length > 0;
            if (earnedQuestCoins || permanentGifts.length || hasConsumableGifts) {
              nextStudents = students.map(student => {
                if (student.id !== me.id) return student;
                const inventory = student.inventory || { consumables: {}, permanents: [] };
                const nextConsumables = { ...(inventory.consumables || {}) };
                Object.entries(consumableGifts).forEach(([name, quantity]) => {
                  nextConsumables[name] = (Number(nextConsumables[name]) || 0) + quantity;
                });
                return {
                  ...student,
                  coins: (Number(student.coins) || 0) + earnedQuestCoins,
                  inventory: {
                    ...inventory,
                    consumables: nextConsumables,
                    permanents: Array.from(new Set([...(inventory.permanents || []), ...permanentGifts])),
                  },
                };
              });
              coinOperation = makeCoinOperation(me.id, earnedQuestCoins, "QUEST_REWARD", {
                id: `quest_reward_${me.id}_${assignment.id}_${newlyUnlocked.map(reward => reward.id).sort().join("_")}`,
                inventoryGrants: { consumables: consumableGifts, permanents: permanentGifts },
              });
            }
            const threshold = Math.max(0, Math.min(100, Number(node.passingThresholdPercent) || 0));
            const rewardSummary = newlyUnlocked.length
              ? questTx(
                ` Phần thưởng đã mở khóa: ${newlyUnlocked.map(formatQuestReward).filter(Boolean).join(', ')}.`,
                ` Unlocked reward${newlyUnlocked.length > 1 ? 's' : ''}: ${newlyUnlocked.map(formatQuestReward).filter(Boolean).join(', ')}.`
              )
              : "";
            submissionMessage = questPassed
              ? questTx(`CHẶNG HOÀN THÀNH: ${score}/${totalQ} (${percentage}%) đạt ngưỡng ${threshold}%.${rewardSummary}`, `STEP COMPLETED: ${score}/${totalQ} (${percentage}%) meets the ${threshold}% threshold.${rewardSummary}`)
              : questTx(`CHƯA ĐẠT: ${score}/${totalQ} (${percentage}%). Cần ${threshold}% để mở chặng tiếp theo; hãy làm lại chặng này.`, `NOT PASSED: ${score}/${totalQ} (${percentage}%). You need ${threshold}% to unlock the next step; try this step again.`);
            questNotice = {
              kind: questPassed ? 'passed' : 'failed',
              score,
              total: totalQ,
              percentage,
              threshold,
              rewards: newlyUnlocked.map(formatQuestReward).filter(Boolean),
            };
          }

          // Write-ahead journal first. navigator.onLine may stay true for several
          // seconds after Wi-Fi fails, so waiting for an "offline" event here can
          // lose a completed quest on refresh.
          const questSubmission = {
            result,
            questProgress: nextQuestProgress,
            ...(nextStudents !== students ? { students: nextStudents } : {}),
            ...(coinOperation ? { coinOperation } : {}),
            createdAt: Date.now(),
          };
          const questJournalSaved = enqueuePendingQuestSubmission(currentUser?.email || me.id, questSubmission);
          if (coinOperation) writePendingCoinOperation(coinOperation);
          if (!questJournalSaved) {
            // This only runs when browser storage is unavailable/full. Preserve the
            // score through the existing result queue as a degraded fallback.
            pushOfflineResult(currentUser?.email, result);
            console.error("Unable to persist the quest submission journal.");
          }

          setQuestProgress(nextQuestProgress);
          if (nextStudents !== students) setStudents(nextStudents);
          setQuizResults(nextResults);
          if (isOffline || !navigator.onLine) {
            if (questNotice) questNotice = { ...questNotice, pendingSync: true };
            submissionMessage += questTx(' Máy chủ chưa nhận được bài do kết nối bị gián đoạn; bản lưu trên thiết bị sẽ tự đồng bộ khi mạng ổn định.', ' The server has not acknowledged this submission because the connection is unstable; the on-device copy will sync automatically when the network is stable.');
          } else {
            const savedQuestNotice = questNotice;
            const failedSyncNotice: QuestStatusNotice = savedQuestNotice || { kind: questPassed ? "passed" : "failed" };
            void syncData({
              quizResults: [result],
              questProgress: nextQuestProgress,
              ...(nextStudents !== students ? { students: nextStudents } : {}),
              ...(coinOperation ? { __coinOperation: coinOperation } : {}),
            }).then((synced) => {
              if (synced) {
                clearPendingQuestSubmission(currentUser?.email || me.id, result.id);
                removeOfflineResult(currentUser?.email, result.id);
                return;
              }
              // A connection can fail while the browser still reports online. The
              // journal is already on disk; now make that state visible to the student.
              setQuestStatusNotice(current => ({ ...(current || failedSyncNotice), pendingSync: true }));
              window.setTimeout(() => alert(questTx(
                'Kết quả chuyên đề đã được lưu trên thiết bị, nhưng máy chủ chưa xác nhận do kết nối bị gián đoạn. Hệ thống sẽ tự đồng bộ lại khi mạng ổn định.',
                'Your quest result has been saved on this device, but the server has not acknowledged it because the connection was interrupted. It will sync automatically when the network is stable.'
              )), 0);
            });
          }
      } else if (realExamContext) {
          submissionMessage = `Test completed. Please wait for the invigilator's instruction.`;
          setQuizResults(nextResults);
          if (isOffline || !navigator.onLine) {
              pushOfflineResult(currentUser?.email, result);
              submissionMessage += " The result is saved on this device and will sync when the connection returns.";
          } else {
              void syncData({ quizResults: [result] });
          }
      } else {
          let earnedCoins = configuredRewardCoins("EXAM_COMPLETE", 50);
          if (state.activeExam.scheduledEnd) {
              const endMs = parseVNTime(state.activeExam.scheduledEnd);
              const diffHour = (endMs - endTime) / (1000 * 3600);
              if (diffHour >= 24) earnedCoins += configuredRewardCoins("EXAM_EARLY_HIGH", 150);
              else if (diffHour >= 12) earnedCoins += configuredRewardCoins("EXAM_EARLY", 100);
          }
          nextStudents = students.map(s => s.id === me.id ? { ...s, coins: (s.coins || 0) + earnedCoins } : s);
          coinOperation = makeCoinOperation(me.id, earnedCoins, "EXAM_COMPLETION");
          setStudents(nextStudents);
          if (isOffline || !navigator.onLine) {
              pushOfflineResult(currentUser?.email, result);
              writePendingCoinOperation(coinOperation);
              setQuizResults(prev => [result, ...prev]);
              alert("NETWORK ERROR! The exam has been saved locally and queued. Please do not clear your browser cache; it will auto-sync when the connection is restored.");
          } else {
              setQuizResults(nextResults);
              void syncData({ quizResults: nextResults, students: nextStudents, __coinOperation: coinOperation });
          }
      }

      if (me) {
          void triggerErrorDnaAnalysis(me, true);
      }

      if (!state.isPreview) {
          setLiveSessions(prev => {
              const nx = prev.filter(x => x.id !== (currentUser?.email || "unknown"));
              syncLiveArena(nx);
              return nx;
          });
      }

      localStorage.removeItem(`ielts_os_exam_state_${currentUser?.email}`);
      if (writingExam && writingAttemptIdRef.current) {
          const attemptId = writingAttemptIdRef.current;
          try {
              localStorage.removeItem(writingLocalDraftKey(state.activeExam, attemptId));
              localStorage.removeItem(`ielts_writing_active_${String(currentUser?.email || "").toLowerCase()}_${state.activeExam.id}`);
          } catch {}
          if (currentUser?.email && navigator.onLine) {
              void deleteDoc(doc(WRITING_DRAFTS_COLLECTION_REF, writingDraftKey(currentUser.email, state.activeExam.id, attemptId))).catch(error => console.warn("Writing draft cleanup deferred:", error));
          }
          writingAttemptIdRef.current = "";
      }
      writingSubmittingRef.current = false;
      _setAudioTested(false);
      if (!realExamContext && Number(band) >= 7.0) { setShowCelebration(true); setTimeout(() => setShowCelebration(false), 8000); }
        if (realExamContext) {
          const baseSession = realExamSession && realExamSession.packageAttemptId === realExamContext.packageAttemptId
            ? realExamSession
            : {
              packageId: realExamContext.packageId,
              packageAttemptId: realExamContext.packageAttemptId,
              testTakerId: realExamContext.testTakerId,
              completedQuizIds: [],
              startedAt: Date.now(),
            };
          const completedQuizIds = Array.from(new Set([...baseSession.completedQuizIds, state.activeExam.id]));
          const isPackageDone = realExamContext.packageQuizIds.every(id => completedQuizIds.includes(id));
          setActiveExam(null); setGracePeriod(null); setHardLocked(false);
          setManualExplanationQuestion(null);
          setReviewQuiz(null);
          setReviewSectionIdx(-1);
          setReviewActiveQuestionId(null);
          if (isPackageDone) {
            setRealExamSession(null);
            persistRealExamSession(null);
            setPortalTab("home");
            if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
            alert("Real exam package completed. Returning to dashboard.");
          } else {
            const nextSession = { ...baseSession, completedQuizIds };
            setRealExamSession(nextSession);
            persistRealExamSession(nextSession);
            setPortalTab("exams");
            requestRealExamFullscreen();
            alert(submissionMessage);
          }
          return;
        }
        alert(submissionMessage);
        setActiveExam(null); setGracePeriod(null); setHardLocked(false);
        setReviewSectionIdx(-1);
        setReviewActiveQuestionId(null);
        if (questContext) {
          setManualExplanationQuestion(null);
          setReviewQuiz(null);
          setPortalTab("quests");
          setSelectedQuestNode({ assignmentId: questContext.topicAssignmentId, nodeId: questContext.nodeId });
          setQuestStatusNotice(questNotice);
        } else {
          const sourceQuiz = quizzesRef.current.find((quiz: any) => quiz.id === state.activeExam?.id);
          const reviewReadyQuiz = normalizeExamSections(restoreReviewExplanations(state.activeExam, sourceQuiz));
          setReviewQuiz({ quiz: reviewReadyQuiz, result });
        }
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    }
  forceSubmitExamRef.current = forceSubmitExam;
  const submitExam = (isTimeUp = false) => {
    if (!activeExam) return;
    if (!isTimeUp && activeExam.realExamContext) return;
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

  const exitPracticeExamWithoutSaving = () => {
    const state = latestExamState.current;
    const exam = state.activeExam || activeExam;
    if (!exam) return;
    const confirmed = window.confirm(
      tx(
        "Bạn có chắc chắn muốn thoát khỏi bài luyện tập này không?\nTiến độ và kết quả hiện tại sẽ KHÔNG được lưu.",
        "Are you sure you want to exit this practice test?\nYour current progress and results will NOT be saved."
      )
    );
    if (!confirmed) return;
    if (examTimerRef.current) window.clearInterval(examTimerRef.current);
    if (writingAutosaveTimerRef.current) window.clearTimeout(writingAutosaveTimerRef.current);
    pauseExamAudioPlayback();
    const questContext = exam.questContext;
    const writingExam = isWritingQuiz(exam);
    localStorage.removeItem(`ielts_os_exam_state_${currentUser?.email}`);
    if (writingExam && writingAttemptIdRef.current) {
      const attemptId = writingAttemptIdRef.current;
      try {
        localStorage.removeItem(writingLocalDraftKey(exam, attemptId));
        localStorage.removeItem(`ielts_writing_active_${String(currentUser?.email || "").toLowerCase()}_${exam.id}`);
      } catch {}
      if (currentUser?.email && navigator.onLine) {
        void deleteDoc(doc(WRITING_DRAFTS_COLLECTION_REF, writingDraftKey(currentUser.email, exam.id, attemptId))).catch(() => {});
      }
      writingAttemptIdRef.current = "";
    }
    writingSubmittingRef.current = false;
    if (!state.isPreview) {
      setLiveSessions(prev => {
        const nx = prev.filter(x => x.id !== (currentUser?.email || "unknown"));
        syncLiveArena(nx);
        return nx;
      });
    }
    _setAudioTested(false);
    setActiveExam(null);
    setGracePeriod(null);
    setHardLocked(false);
    setExamAnswers({});
    setFlaggedQuestions([]);
    setScratchpadText("");
    setQNotes({});
    if (questContext) {
      setPortalTab("quests");
      setSelectedQuestAssignmentId(questContext.topicAssignmentId);
      setSelectedQuestNode({ assignmentId: questContext.topicAssignmentId, nodeId: questContext.nodeId });
    }
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  };

  const handleBulkDeleteHistory = () => {
      if(!confirm(`Delete ${selectedSessions.length} selected sessions?`)) return;
      const nx = history.filter(h => !selectedSessions.includes(h.id.toString()));
      setHistory(nx); syncData({ history: nx, __deletedHistoryIds: selectedSessions.map(String) }); setSelectedSessions([]);
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

  const syncData = async (newData: any) => {
    const now = Date.now();
    lastLocalMutationAtRef.current = now;
    latestOptimisticWorkspaceRef.current = {
      timestamp: now,
      ...(Array.isArray(newData.students) ? { students: newData.students } : {}),
      ...(Array.isArray(newData.history) ? { history: newData.history } : {}),
      ...(Array.isArray(newData.schedules) ? { schedules: newData.schedules } : {}),
      ...(Array.isArray(newData.transactions) ? { transactions: newData.transactions } : {}),
      ...(Array.isArray(newData.examFolders) ? { examFolders: newData.examFolders } : {}),
      ...(Array.isArray(newData.topicAssignments) ? { topicAssignments: newData.topicAssignments } : {}),
      ...(Array.isArray(newData.realExamPackages) ? { realExamPackages: newData.realExamPackages } : {}),
    };
    const entry = {
      id: `workspace_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      payload: newData,
      createdAt: Date.now(),
      retryCount: 0,
    };
    writePendingWorkspaceMutations([...readPendingWorkspaceMutations(), entry]);
    inFlightMutationIdsRef.current.add(entry.id);

    const run = async () => {
      try {
        const synced = await performSyncData(newData);
        if (synced) {
          writePendingWorkspaceMutations(readPendingWorkspaceMutations().filter(item => item.id !== entry.id));
        }
        return synced;
      } finally {
        inFlightMutationIdsRef.current.delete(entry.id);
      }
    };
    const task = workspaceSyncChainRef.current.then(run, run) as Promise<boolean>;
    workspaceSyncChainRef.current = task.then(() => undefined, () => undefined);
    return task;
  };

  const stageGiftCatalog = (next: GiftDefinition[]) => {
    setGiftCatalog(normalizeGiftCatalog(next));
    setRewardConfigDirty(true);
    setRewardConfigError("");
  };
  const stageRewardMechanisms = (next: RewardMechanism[]) => {
    setRewardMechanisms(normalizeRewardMechanisms(next));
    setRewardConfigDirty(true);
    setRewardConfigError("");
  };
  const saveReleaseConfiguration = async () => {
    if (userRole !== "TEACHER" || rewardConfigSaving) return;
    const nextGifts = normalizeGiftCatalog(giftCatalog);
    const nextRewards = normalizeRewardMechanisms(rewardMechanisms);
    const duplicateGiftName = nextGifts.some((gift, index) => nextGifts.some((other, otherIndex) =>
      otherIndex !== index && other.name.trim().toLocaleLowerCase() === gift.name.trim().toLocaleLowerCase()
    ));
    const duplicateEvent = nextRewards.some((rule, index) => nextRewards.some((other, otherIndex) =>
      otherIndex !== index && other.event === rule.event
    ));
    if (duplicateGiftName || duplicateEvent) {
      setRewardConfigError(duplicateGiftName ? tx("Tên quà không được trùng.", "Gift names cannot be duplicated.") : tx("Mỗi sự kiện thưởng chỉ được có một quy tắc.", "Each reward event can only have one rule."));
      return;
    }
    setRewardConfigSaving(true);
    setRewardConfigError("");
    try {
      const saved = await syncData({ giftCatalog: nextGifts, rewardMechanisms: nextRewards });
      if (!saved) {
        setRewardConfigError(tx("Chưa lưu được. Bản chỉnh sửa vẫn ở thiết bị này và sẽ tự thử lại khi có mạng.", "Could not save. Changes remain on this device and will retry when online."));
        showSaveToast(tx("Chưa đồng bộ được cấu hình quà lên máy chủ. Bản lưu vẫn giữ trên thiết bị.", "Could not sync reward config to server. Kept locally."), "warning");
        return;
      }
      setGiftCatalog(nextGifts);
      setRewardMechanisms(nextRewards);
      setRewardConfigDirty(false);
      showSaveToast(tx("Đã lưu cấu hình Quà tặng & Cơ chế thưởng thành công!", "Gift catalog & reward rules saved successfully!"), "success");
    } finally {
      setRewardConfigSaving(false);
    }
  };

  const flushPendingWorkspaceMutations = async () => {
    if (!navigator.onLine) return;
    const run = async () => {
      const pending = readPendingWorkspaceMutations();
      if (!pending.length) return;

      // Circuit breaker: discard poison pills exceeding 5 retries or legacy oversized quizzes arrays
      const validPending = pending.filter(entry => {
        if ((entry.retryCount || 0) >= 5) {
          console.warn("Discarding poison pill workspace mutation exceeding retry limit:", entry.id);
          return false;
        }
        if (entry.payload && Array.isArray(entry.payload.quizzes) && entry.payload.quizzes.length > 50) {
          console.warn("Discarding oversized legacy quizzes payload in workspace queue:", entry.id);
          return false;
        }
        return true;
      });

      if (validPending.length !== pending.length) {
        writePendingWorkspaceMutations(validPending);
      }

      for (const entry of validPending) {
        if (inFlightMutationIdsRef.current.has(entry.id)) continue;
        inFlightMutationIdsRef.current.add(entry.id);
        try {
          const synced = await performSyncData(entry.payload);
          if (synced) {
            writePendingWorkspaceMutations(readPendingWorkspaceMutations().filter(item => item.id !== entry.id));
          } else {
            const current = readPendingWorkspaceMutations();
            const updated = current.map(item => item.id === entry.id ? { ...item, retryCount: (item.retryCount || 0) + 1 } : item);
            writePendingWorkspaceMutations(updated.filter(item => (item.retryCount || 0) < 5));
          }
        } catch (err) {
          console.warn("Pending workspace mutation failed:", err);
          const current = readPendingWorkspaceMutations();
          const updated = current.map(item => item.id === entry.id ? { ...item, retryCount: (item.retryCount || 0) + 1 } : item);
          writePendingWorkspaceMutations(updated.filter(item => (item.retryCount || 0) < 5));
        } finally {
          inFlightMutationIdsRef.current.delete(entry.id);
        }
      }
    };
    const task = workspaceSyncChainRef.current.then(run, run);
    workspaceSyncChainRef.current = task.then(() => undefined, () => undefined);
    await task;
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

      const renderErrorDnaSection = (student: Student | null | undefined, isAnalyzing = false, onRefresh?: () => void) => {
        if (!student) return null;
        const dna = student.errorDna;
        const studentResults = (quizResults || []).filter(r => r && r.studentId === student.id);
        const hasTests = studentResults.length > 0;

        return (
          <div className="card" style={{ padding: "18px 22px", border: `1px solid ${C.border}`, borderRadius: 14, background: C.card, marginTop: 14, marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ display: 'inline-flex', padding: 6, borderRadius: 8, background: `${C.accent}14`, color: C.accent }}>
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="m10 15 5-3-5-3v6z"/></svg>
                  </span>
                  <h3 style={{ margin: 0, fontFamily: 'var(--display)', fontSize: 17, fontWeight: 700, color: C.text }}>
                    {tx("Nhận diện điểm yếu & Bẫy đề", "Weakness & Trap Analysis")}
                  </h3>
                </div>
                <p style={{ margin: '4px 0 0 0', fontSize: 12.5, color: C.sub }}>
                  {tx("Thống kê từ lịch sử làm bài để chỉ ra dạng bài và bẫy đề bạn hay mất điểm nhất.", "Identified from your test history to highlight question types and traps where you lose points.")}
                </p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {dna && (
                  <>
                    <span style={{ fontSize: 11, fontWeight: 700, background: C.bg, border: `1px solid ${C.border}`, padding: '3px 9px', borderRadius: 20, color: C.sub }}>
                      {dna.totalAnalyzedAttempts} {tx("bài thi", "tests")} ({dna.totalQuestionsAnalyzed} {tx("câu", "qs")})
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 700, background: isAnalyzing ? `${C.warn}15` : `${C.succ}15`, border: `1px solid ${isAnalyzing ? C.warn : C.succ}35`, color: isAnalyzing ? C.warn : C.succ, padding: '3px 9px', borderRadius: 20, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      {isAnalyzing && <Ico name="refresh" size={11} />}
                      {isAnalyzing ? tx("Đang phân tích...", "Analyzing...") : tx("AI đã phân tích", "AI Diagnosed")}
                    </span>
                  </>
                )}
                {hasTests && (
                  <button
                    type="button"
                    disabled={isAnalyzing}
                    onClick={() => {
                      if (onRefresh) onRefresh();
                      else void triggerErrorDnaAnalysis(student, true);
                    }}
                    style={{ background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 8, padding: '4px 9px', fontSize: 11, fontWeight: 600, color: C.sub, cursor: isAnalyzing ? 'default' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                    title={tx("Phân tích lại điểm yếu", "Re-diagnose weaknesses")}
                  >
                    <Ico name="refresh" size={11} />
                    <span>{tx("Chẩn đoán lại", "Re-diagnose")}</span>
                  </button>
                )}
              </div>
            </div>

            {!hasTests ? (
              <div style={{ textAlign: 'center', padding: '20px 16px', color: C.sub, fontSize: 12.5, background: C.bg, borderRadius: 10, border: `1px dashed ${C.border}` }}>
                {tx("Chưa có kết quả bài thi Reading/Listening nào để chẩn đoán. Hãy hoàn thành ít nhất 1 bài thi.", "No Reading or Listening exam results yet. Complete at least 1 test to generate your weakness profile.")}
              </div>
            ) : !dna ? (
              <div style={{ textAlign: 'center', padding: '24px 16px', color: C.sub, fontSize: 12.5, background: C.bg, borderRadius: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <Ico name="refresh" size={18} color={C.accent} />
                <div>{tx("Đang tự động tính toán dữ liệu và phân tích điểm yếu...", "Automatically calculating mistake patterns and analyzing weaknesses...")}</div>
              </div>
            ) : (() => {
              const lex = dna.categoryBreakdown?.lexicalGap ?? 0;
              const dis = dna.categoryBreakdown?.distractorTrap ?? 0;
              const sco = dna.categoryBreakdown?.scopeMisread ?? 0;
              const sortedAccuracy = [...(dna.typeAccuracy || [])].sort((a, b) => a.accuracy - b.accuracy);
              const actionPlanList = (i18n.language === "vi" ? (dna.actionPlanVi || dna.actionPlanEn || []) : (dna.actionPlanEn || dna.actionPlanVi || []));

              return (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, alignItems: 'start' }}>
                  {/* CỘT TRÁI: CĂN NGUYÊN LỖI & BẪY ĐỀ */}
                  <div style={{ display: 'grid', gap: 14 }}>
                    {/* 1. TỶ LỆ CĂN NGUYÊN LỖI SAI */}
                    <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px' }}>
                      <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.7, color: C.sub, marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                        <span>{tx("1. Căn nguyên lỗi sai (Tỷ lệ %)", "1. Root Cause Breakdown (%)")}</span>
                      </div>

                      {/* Segmented bar 3 màu */}
                      <div style={{ height: 8, borderRadius: 4, overflow: 'hidden', display: 'flex', background: 'rgba(0,0,0,0.06)', marginBottom: 10 }}>
                        {lex > 0 && <div title={`${tx("Từ vựng", "Lexical")}: ${lex}%`} style={{ width: `${lex}%`, background: '#4338ca', transition: 'width 0.3s' }} />}
                        {dis > 0 && <div title={`${tx("Bẫy đề", "Distractor")}: ${dis}%`} style={{ width: `${dis}%`, background: '#d97706', transition: 'width 0.3s' }} />}
                        {sco > 0 && <div title={`${tx("Phạm vi", "Scope")}: ${sco}%`} style={{ width: `${sco}%`, background: '#e11d48', transition: 'width 0.3s' }} />}
                      </div>

                      {/* 3 dòng chi tiết */}
                      <div style={{ display: 'grid', gap: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11.5 }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: C.text, fontWeight: 600 }}>
                            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#4338ca', flexShrink: 0 }} />
                            <span>{tx("Lỗ hổng Từ vựng / Paraphrase", "Lexical & Paraphrase Gap")}</span>
                          </span>
                          <span style={{ fontFamily: 'var(--mono)', fontWeight: 800, color: '#4338ca' }}>{lex}%</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11.5 }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: C.text, fontWeight: 600 }}>
                            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#d97706', flexShrink: 0 }} />
                            <span>{tx("Bẫy Nhiễu & Phủ định Ngầm", "Distractor & Negative Trap")}</span>
                          </span>
                          <span style={{ fontFamily: 'var(--mono)', fontWeight: 800, color: '#d97706' }}>{dis}%</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11.5 }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: C.text, fontWeight: 600 }}>
                            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#e11d48', flexShrink: 0 }} />
                            <span>{tx("Đọc sai Phạm vi & Chi tiết", "Scope Misread & Extrapolation")}</span>
                          </span>
                          <span style={{ fontFamily: 'var(--mono)', fontWeight: 800, color: '#e11d48' }}>{sco}%</span>
                        </div>
                      </div>
                    </div>

                    {/* 2. BẪY ĐỀ THƯỜNG MẮC */}
                    {dna.recurringTraps && dna.recurringTraps.length > 0 && (
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.7, color: C.sub, marginBottom: 8 }}>
                          {tx("Bẫy đề học viên thường mắc", "Recurring Traps Identified")}
                        </div>
                        <div style={{ display: 'grid', gap: 8 }}>
                          {dna.recurringTraps.slice(0, 3).map((trap: any, index: number) => {
                            const isHigh = trap.severity === "high";
                            return (
                              <div key={index} style={{ padding: '9px 12px', borderRadius: 8, background: isHigh ? '#fff5f5' : '#fffbeb', border: `1px solid ${isHigh ? '#fed7d7' : '#fef08a'}`, display: 'flex', flexDirection: 'column', gap: 3 }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                  <span style={{ fontSize: 12, fontWeight: 700, color: isHigh ? '#9b2c2c' : '#854d0e' }}>
                                    {tx(trap.titleVi, trap.titleEn)}
                                  </span>
                                  <span style={{ fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, padding: '2px 6px', borderRadius: 4, background: isHigh ? '#fed7d7' : '#fef08a', color: isHigh ? '#9b2c2c' : '#854d0e' }}>
                                    {isHigh ? tx("Tần suất cao", "High") : tx("Thường gặp", "Moderate")}
                                  </span>
                                </div>
                                <div style={{ fontSize: 11, color: '#4b5563', lineHeight: 1.4 }}>
                                  {tx(trap.detailVi, trap.detailEn)}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* CỘT PHẢI: DẠNG BÀI CẦN CẢI THIỆN & KẾ HOẠCH HÀNH ĐỘNG */}
                  <div style={{ display: 'grid', gap: 14 }}>
                    {/* DẠNG BÀI ƯU TIÊN CẢI THIỆN (SẮP XẾP TỪ YẾU NHẤT) */}
                    {sortedAccuracy.length > 0 && (
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.7, color: C.sub, marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                          <span>{tx("2. Dạng câu hỏi cần cải thiện gấp", "2. Priority Question Types")}</span>
                          <span style={{ fontSize: 10, fontWeight: 600, color: C.sub }}>{tx("(Ưu tiên dạng % thấp)", "(Lowest accuracy first)")}</span>
                        </div>
                        <div style={{ display: 'grid', gap: 6 }}>
                          {sortedAccuracy.slice(0, 5).map((ct: any) => {
                            const barColor = ct.accuracy >= 70 ? C.succ : ct.accuracy >= 50 ? C.warn : C.err;
                            return (
                              <div key={ct.key || ct.label} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 7, padding: '7px 10px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11.5, fontWeight: 600, marginBottom: 4 }}>
                                  <span style={{ color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '72%' }} title={ct.label}>{ct.label}</span>
                                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: barColor, fontWeight: 800 }}>
                                    {ct.accuracy}% <span style={{ color: C.sub, fontWeight: 400, fontSize: 10 }}>({ct.correct}/{ct.total})</span>
                                  </span>
                                </div>
                                <div style={{ height: 4, background: 'rgba(0,0,0,0.06)', borderRadius: 2, overflow: 'hidden' }}>
                                  <div style={{ height: '100%', width: `${Math.min(100, Math.max(0, ct.accuracy))}%`, background: barColor, borderRadius: 2, transition: 'width 0.3s ease' }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* 4. KẾ HOẠCH HÀNH ĐỘNG 7 NGÀY (COLLAPSIBLE ACCORDION) */}
                    {actionPlanList.length > 0 && (
                      <details style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 12px' }}>
                        <summary style={{ cursor: 'pointer', fontSize: 11.5, fontWeight: 700, color: C.accent, display: 'flex', alignItems: 'center', gap: 6, userSelect: 'none' }}>
                          <Ico name="calendar" size={13} color={C.accent} />
                          <span>{tx("Xem lộ trình cải thiện 7 ngày từ AI", "View 7-Day AI Action Plan")}</span>
                        </summary>
                        <div style={{ display: 'grid', gap: 6, marginTop: 8, paddingTop: 6, borderTop: `1px dashed ${C.border}` }}>
                          {actionPlanList.map((step: string, index: number) => (
                            <div key={index} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 11.5, color: C.text, lineHeight: 1.4 }}>
                              <span style={{ display: 'inline-flex', width: 17, height: 17, borderRadius: '50%', background: `${C.accent}20`, color: C.accent, fontSize: 10, fontWeight: 800, alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                                {index + 1}
                              </span>
                              <span>{step}</span>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        );
      };

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
          .ios-tabs-container { display: inline-flex; background: rgba(118, 118, 128, 0.12); padding: 3px; border-radius: 11px; gap: 2px; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; -ms-overflow-style: none; }
          .ios-tabs-container::-webkit-scrollbar { display: none; }
          .ios-tabs-container::-webkit-scrollbar-track { background: transparent; }
          .ios-tabs-container::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.25); border-radius: 10px; }
          .ios-tabs-container::-webkit-scrollbar-thumb:hover { background: rgba(0,0,0,0.4); }
          .tab-btn { padding: 6px 12px; background: transparent; color: ${C.text}; font-size: 13px; font-weight: 600; border-radius: 8px; transition: all 0.2s ease; white-space: nowrap; box-shadow: none; opacity: 0.7; }
          .tab-btn:hover { opacity: 1; }
          .tab-btn.active { color: #000; background: #FFF; box-shadow: 0 3px 8px rgba(0, 0, 0, 0.12), 0 1px 1px rgba(0,0,0,0.04); opacity: 1; }
          
          /* ANIMATED GRADIENTS (LÀM MỊN) */
          @keyframes mesh { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
          .mesh-bg { background: linear-gradient(-45deg, #e5e5ea, #f5f5f7, #ffffff, #e5e5ea); background-size: 400% 400%; animation: mesh 20s ease infinite; }
          
          /* CÁC THÀNH PHẦN KHÁC */
          .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; margin-top: 10px; }
          .cal-day { aspect-ratio: auto; height: 34px; display: grid; place-items: center; font-family: var(--mono); font-size: 12px; border-radius: 6px; cursor: pointer; border: 1px solid transparent; color: ${C.text}; font-weight: 500; transition: 0.2s; }
          .cal-day:hover { background: rgba(0,0,0,0.05); }
          .cal-day.empty { cursor: default; border: none; background: transparent; }
          .cal-day.empty:hover { background: transparent; }
          .cal-day.has-sched { background: ${C.accent}15; color: ${C.accent}; font-weight: 700; border-color: ${C.accent}30; }
          .cal-day.selected { background: ${C.accent} !important; color: #fff !important; font-weight: 700; }
          .timer-num { font-family: var(--mono), 'SFMono-Regular', Consolas, monospace; font-weight: 700; letter-spacing: -1px; font-variant-numeric: tabular-nums; }
          @keyframes pulseFast { 0%, 100% { opacity: 1; color: ${C.err}; } 50% { opacity: 0.7; color: #ff0000; } }
          .pulse-fast { animation: pulseFast 1s infinite; }
          .booting-screen { min-height: 100svh; width: 100%; display: grid; place-items: center; background: ${C.bg}; color: ${C.text}; font-family: var(--sans), system-ui, sans-serif; padding: 24px; box-sizing: border-box; }
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
      .idp-draggable { display: inline-block; border: 1px solid #333; padding: 6px 12px; margin: 4px; background: #fff; cursor: default; border-radius: 2px; font-weight: bold; }
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
      .idp-flow-arrow { display: block !important; width: 28px !important; height: 36px !important; max-width: none !important; object-fit: contain; margin: 10px auto !important; }
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
      return (raw.includes('student-highlight') || raw.includes('student-note-hl')) ? annotationHTML(raw) : formatContent(raw);
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
                          : `<input type="text" class="idp-inline-input inline-blank-input" data-qid="${gq.id}" data-answer-input="true" placeholder="${qIndexGlobal}" autocomplete="off" spellcheck="false" autocorrect="off" autocapitalize="off" inputmode="text" aria-autocomplete="none" writingsuggestions="false" data-ms-editor="false" style="width:${_inW}px" />`;
                      
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
                      : `<input type="text" class="idp-inline-input inline-blank-input" data-qid="${gq.id}" data-answer-input="true" placeholder="${qIndexGlobal}" autocomplete="off" spellcheck="false" autocorrect="off" autocapitalize="off" inputmode="text" aria-autocomplete="none" writingsuggestions="false" data-ms-editor="false" style="width:${_inW}px" />`;
                  
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
  const renderBootScreen = (step: 'auth' | 'sync') => (
    <div className="booting-screen" style={{ background: C.bg, color: C.text }}>
      {globalStyles}
      <div className="booting-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <BrandLogo size={38} />
          <BrandWordmark size={20} color={C.text} />
        </div>
        <div style={{ fontFamily: 'var(--heading)', fontSize: 10.5, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.sub, marginTop: 6 }}>
          Academic Workspace
        </div>
        <div className="booting-bar">
          <div className="booting-bar-fill" style={{ background: C.accent }} />
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', color: C.sub }}>
          {step === 'auth'
            ? (i18n.language === 'vi' ? '01 / 02 · ĐANG XÁC THỰC PHIÊN' : '01 / 02 · VERIFYING SESSION')
            : (i18n.language === 'vi' ? '02 / 02 · ĐANG ĐỒNG BỘ DỮ LIỆU' : '02 / 02 · SYNCING WORKSPACE')}
        </div>
      </div>
    </div>
  );

  if (authChecking) return renderBootScreen('auth');

  if (!currentUser) {
    // ==========================================
    // ĐĂNG NHẬP — "LIVE EXAM WORKBENCH" (Chuẩn EdTech Thực Chiến)
    // Cột trái: Mockup trực quan hóa bài thi thật + Dẫn chứng AI + 3 điểm cốt lõi.
    // Cột phải: Form đăng nhập tinh gọn tuyệt đối, không khẩu hiệu sáo rỗng.
    // ==========================================
    const lxYear = new Date().getFullYear();

    return (
      <div style={{
        minHeight: "100dvh",
        display: "flex",
        position: "relative",
        background: "#F8FAFC",
        color: "#0F172A",
        fontFamily: "var(--sans, system-ui, -apple-system, sans-serif)",
        overflow: "hidden",
      }}>
        {globalStyles}
        <style>{`
          @media (max-width: 980px){
            .ac-hero { display: none !important; }
            .ac-form-col { flex: 1 1 100% !important; padding: 28px 18px !important; }
            .ac-mhero { display: flex !important; }
          }
          @keyframes acFadeIn {
            from { opacity: 0; transform: translateY(12px); }
            to { opacity: 1; transform: translateY(0); }
          }
          @keyframes acSpin {
            to { transform: rotate(360deg); }
          }
          .ac-rise {
            opacity: 0;
            animation: acFadeIn 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          }
          .ac-input {
            width: 100%;
            height: 46px;
            padding: 0 14px;
            font-size: 14.5px;
            border: 1.5px solid #CBD5E1;
            border-radius: 10px;
            background: #F8FAFC;
            outline: none;
            color: #0F172A;
            transition: all 0.18s ease;
            box-sizing: border-box;
          }
          .ac-input:focus {
            border-color: #2563EB;
            background: #FFFFFF;
            box-shadow: 0 0 0 3.5px rgba(37, 99, 235, 0.12);
          }
          .ac-submit {
            width: 100%;
            height: 48px;
            border-radius: 10px;
            border: none;
            background: #0F172A;
            color: #FFFFFF;
            font-size: 14.5px;
            font-weight: 700;
            cursor: pointer;
            box-shadow: 0 4px 14px rgba(15, 23, 42, 0.18);
            transition: all 0.18s ease;
            letter-spacing: 0.3px;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .ac-submit:hover:not(:disabled) {
            background: #1E293B;
            transform: translateY(-1px);
            box-shadow: 0 8px 20px rgba(15, 23, 42, 0.25);
          }
          .ac-submit:disabled {
            cursor: wait;
            opacity: 0.75;
          }
        `}</style>

        {loginLoading && (
          <div role="status" aria-live="assertive" aria-label={tx("Đang xác thực thông tin đăng nhập", "Verifying login credentials")} style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "rgba(248, 250, 252, 0.85)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}>
            <div style={{ width: "min(360px, 100%)", textAlign: "center", background: "#FFFFFF", padding: "36px 28px", borderRadius: 20, border: "1px solid #E2E8F0", boxShadow: "0 24px 60px rgba(15, 23, 42, 0.12)" }}>
              <div style={{ width: 64, height: 64, margin: "0 auto 18px", display: "grid", placeItems: "center", background: "#EFF6FF", border: "1px solid #DBEAFE", borderRadius: "50%" }}>
                <BrandLogo size={34} stops={["#3B82F6", "#2563EB", "#1D4ED8"]} mark="#FFFFFF" />
              </div>
              <div style={{ width: 30, height: 30, margin: "0 auto 16px", border: "3px solid #DBEAFE", borderTopColor: "#2563EB", borderRadius: "50%", animation: "acSpin .8s linear infinite" }} />
              <div style={{ fontSize: 17, fontWeight: 800, color: "#0F172A", marginBottom: 6 }}>{tx("Đang xác thực đăng nhập", "Authenticating")}</div>
              <div style={{ color: "#64748B", fontSize: 13, lineHeight: 1.5 }}>{tx("Vui lòng chờ trong giây lát...", "Please wait a moment...")}</div>
            </div>
          </div>
        )}

        {/* CỘT TRÁI — MÔ PHỎNG WORKBENCH THỰC CHIẾN */}
        <div className="ac-hero" style={{ flex: "1.15 1 0", position: "relative", zIndex: 2, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "48px 4vw 40px 6vw" }}>
          <div className="ac-rise" style={{ display: "flex", alignItems: "center", gap: 12, animationDelay: ".05s" }}>
            <BrandLogo size={40} stops={["#3B82F6", "#2563EB", "#1D4ED8"]} mark="#FFFFFF" />
            <BrandWordmark size={19} color="#0F172A" osColor="#2563EB" />
          </div>

          <div style={{ maxWidth: 520, margin: "24px 0" }}>
            <h1 className="ac-rise" style={{ fontSize: "clamp(30px, 3.6vw, 44px)", lineHeight: 1.18, fontWeight: 800, margin: "0 0 14px", letterSpacing: "-0.6px", color: "#0F172A", animationDelay: ".15s" }}>
              {tx("Luyện thi trên máy tính,", "Computer-delivered IELTS,")}<br/>
              <span style={{ color: "#2563EB" }}>{tx("chuẩn xác như thi thật.", "built for real test reflexes.")}</span>
            </h1>

            {/* Simulated IELTS Exam & AI Evidence Workbench */}
            <div className="ac-rise" style={{ background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 14, overflow: "hidden", boxShadow: "0 10px 30px -8px rgba(15, 23, 42, 0.07)", margin: "22px 0 24px", animationDelay: ".25s" }}>
              {/* Window Header */}
              <div style={{ background: "#F8FAFC", borderBottom: "1px solid #E2E8F0", padding: "9px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#CBD5E1" }} />
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#E2E8F0" }} />
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#E2E8F0" }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#475569", marginLeft: 8 }}>
                    Reading Passage 2 · Climate Economics
                  </span>
                </div>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "#EFF6FF", border: "1px solid #DBEAFE", padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 700, color: "#2563EB" }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  <span>42:15</span>
                </div>
              </div>

              {/* Passage & Highlight Area */}
              <div style={{ padding: "14px 16px" }}>
                <div style={{ fontSize: 13, lineHeight: 1.65, color: "#334155" }}>
                  "...the report indicated that{" "}
                  <mark style={{ background: "rgba(254, 240, 138, 0.65)", color: "#0F172A", padding: "2px 5px", borderRadius: 4, borderBottom: "2px solid #EAB308", fontWeight: 600 }}>
                    adoption costs fell by 40% across urban areas
                  </mark>{" "}
                  over the last decade, primarily driven by localized supply chain innovations..."
                </div>

                {/* AI Explanation / Evidence Callout */}
                <div style={{ marginTop: 12, background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 8, padding: "10px 12px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>
                      <span style={{ fontSize: 11.5, fontWeight: 800, color: "#166534" }}>AI GIẢI THÍCH CHI TIẾT · CÂU 16: TRUE</span>
                    </div>
                    <span style={{ fontSize: 10.5, fontWeight: 700, background: "#DCFCE7", color: "#15803D", padding: "1px 6px", borderRadius: 4 }}>Dạng True/False/Not Given</span>
                  </div>
                  <div style={{ fontSize: 11.5, lineHeight: 1.55, color: "#14532D" }}>
                    • <strong>Dẫn chứng:</strong> Cụm <em>"fell by 40%"</em> khớp trực tiếp với <em>"sharp decrease"</em> trong đề.<br/>
                    • <strong>Bản chất:</strong> Thông tin khẳng định rõ ràng, không có yếu tố mâu thuẫn hay suy đoán.
                  </div>
                </div>
              </div>
            </div>

            {/* 3 Core Points Finalized by User */}
            <div className="ac-rise" style={{ display: "grid", gap: 9, animationDelay: ".35s" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <span style={{ width: 20, height: 20, borderRadius: "50%", background: "#EFF6FF", border: "1px solid #DBEAFE", display: "grid", placeItems: "center", flexShrink: 0, color: "#2563EB" }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </span>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: "#1E293B" }}>
                  {tx("Phòng thi máy tính chuẩn xác", "Accurate computer-based exam room")}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <span style={{ width: 20, height: 20, borderRadius: "50%", background: "#EFF6FF", border: "1px solid #DBEAFE", display: "grid", placeItems: "center", flexShrink: 0, color: "#2563EB" }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </span>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: "#1E293B" }}>
                  {tx("Hệ thống AI giải thích lỗi sai cặn kẽ, chi tiết", "Comprehensive AI explanations for every mistake")}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <span style={{ width: 20, height: 20, borderRadius: "50%", background: "#EFF6FF", border: "1px solid #DBEAFE", display: "grid", placeItems: "center", flexShrink: 0, color: "#2563EB" }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </span>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: "#1E293B" }}>
                  {tx("Kho đề Actual Tests phong phú, cập nhật liên tục", "Rich Actual Tests library continuously updated")}
                </span>
              </div>
            </div>
          </div>

          <div className="ac-rise" style={{ fontSize: 12, color: "#94A3B8", animationDelay: ".45s" }}>
            © {lxYear} IELTS OS — Computer-based Testing Platform
          </div>
        </div>

        {/* CỘT PHẢI — THẺ ĐĂNG NHẬP TINH GỌN */}
        <div className="ac-form-col" style={{ flex: "0.85 1 0", position: "relative", zIndex: 2, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 5vw" }}>
          {/* Mobile Hero Header */}
          <div className="ac-mhero ac-rise" style={{ display: "none", flexDirection: "column", width: "100%", maxWidth: 390, marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <BrandLogo size={34} stops={["#3B82F6", "#2563EB", "#1D4ED8"]} mark="#FFFFFF" />
              <BrandWordmark size={17} color="#0F172A" osColor="#2563EB" />
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: "#0F172A", letterSpacing: -0.5 }}>
              {tx("Luyện thi trên máy tính", "Computer-delivered IELTS")}
            </h1>
          </div>

          {/* Login Card */}
          <div className="ac-rise" style={{ width: 390, maxWidth: "100%", animationDelay: ".15s" }}>
            <div style={{ background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 18, padding: "36px 32px", boxShadow: "0 18px 40px -12px rgba(15, 23, 42, 0.08)" }}>
              <form onSubmit={handleLogin}>
                <h2 style={{ fontSize: 26, fontWeight: 800, color: "#0F172A", margin: "0 0 24px", letterSpacing: -0.6 }}>
                  {t('login_heading')}
                </h2>

                {loginError && (
                  <div style={{ background: "#FEF2F2", color: "#991B1B", border: "1px solid #FCA5A5", padding: "10px 14px", borderRadius: 10, fontSize: 13, marginBottom: 18, fontWeight: 600, textAlign: "center" }}>
                    {loginError}
                  </div>
                )}

                <div style={{ display: "grid", gap: 16 }}>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.8, color: "#475569", textTransform: "uppercase", marginBottom: 7, display: "block" }}>
                      {t('email_label')}
                    </label>
                    <input
                      className="ac-input"
                      type="email"
                      value={email}
                      onChange={(e: any) => setEmail(e.target.value)}
                      disabled={loginLoading}
                      required
                      placeholder="name@example.com"
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.8, color: "#475569", textTransform: "uppercase", marginBottom: 7, display: "block" }}>
                      {t('pwd_label')}
                    </label>
                    <div style={{ position: "relative" }}>
                      <input
                        className="ac-input"
                        type={showPwd ? "text" : "password"}
                        value={password}
                        onChange={(e: any) => setPassword(e.target.value)}
                        disabled={loginLoading}
                        required
                        placeholder="••••••••"
                        style={{ paddingRight: 44 }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPwd(!showPwd)}
                        disabled={loginLoading}
                        style={{
                          position: "absolute",
                          right: 10,
                          top: "50%",
                          transform: "translateY(-50%)",
                          background: "none",
                          border: "none",
                          cursor: loginLoading ? "wait" : "pointer",
                          padding: 6,
                          color: "#94A3B8",
                          display: "flex",
                          transition: "color .15s",
                        }}
                        title={t('show_hide_pwd')}
                      >
                        {showPwd
                          ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                          : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        }
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="ac-submit"
                    disabled={loginLoading}
                  >
                    <span>{loginLoading ? tx("Đang xác thực...", "VERIFYING...") : t('login_btn')}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    );
  }

      if (!loaded) return renderBootScreen('sync');

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

  const saveToastOverlay = (uiSaveToast && typeof document !== "undefined") ? createPortal(
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        top: 18,
        right: 18,
        zIndex: 2147483001,
        maxWidth: "min(420px, calc(100vw - 36px))",
        background: uiSaveToast.kind === "error" ? "#FEF2F2" : uiSaveToast.kind === "warning" ? "#FFFBEB" : "#ECFDF5",
        color: uiSaveToast.kind === "error" ? "#991B1B" : uiSaveToast.kind === "warning" ? "#92400E" : "#065F46",
        border: `1.5px solid ${uiSaveToast.kind === "error" ? "#FCA5A5" : uiSaveToast.kind === "warning" ? "#FCD34D" : "#6EE7B7"}`,
        borderRadius: 14,
        padding: "12px 16px",
        boxShadow: "0 16px 36px -8px rgba(15, 23, 42, 0.22)",
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontFamily: "var(--sans), system-ui, sans-serif",
        fontSize: 13.5,
        fontWeight: 700,
      }}
    >
      <span style={{ display: "inline-flex", flexShrink: 0 }}>
        {uiSaveToast.kind === "error" ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        ) : uiSaveToast.kind === "warning" ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        )}
      </span>
      <span style={{ flex: 1, lineHeight: 1.4 }}>{uiSaveToast.message}</span>
      <button
        type="button"
        onClick={() => setUiSaveToast(null)}
        style={{ background: "transparent", border: "none", color: "inherit", opacity: 0.7, padding: 4, cursor: "pointer", fontSize: 16, lineHeight: 1 }}
        aria-label={tx("Đóng thông báo", "Dismiss")}
      >
        ✕
      </button>
    </div>,
    document.body
  ) : null;

  const persistentAudioNode = (!reviewQuiz && preloadOrActiveAudioUrl && typeof document !== "undefined") ? (
    createPortal(
      <audio
        key={preloadOrActiveAudioUrl}
        ref={audioRef}
        preload="auto"
        playsInline
        src={preloadOrActiveAudioUrl}
        controlsList="nodownload noremoteplayback"
        onContextMenu={(event: any) => event.preventDefault()}
        onDragStart={(event: any) => event.preventDefault()}
        onEnded={handleExamAudioEnded}
        onPlay={(e: any) => recordAudioDiagnostic("play", e.currentTarget as HTMLAudioElement)}
        onPlaying={handleExamAudioPlaying}
        onPause={(e: any) => handleExamAudioPause(e.currentTarget as HTMLAudioElement)}
        onError={(e: any) => handleExamAudioError(e.currentTarget.error)}
        onCanPlay={(e: any) => {
          const audio = e.currentTarget as HTMLAudioElement;
          recordAudioDiagnostic("canplay", audio);
          checkAndSetAudioReady(audio);
          if (examAudioShouldPlayRef.current && audio.paused) recoverInterruptedExamAudio(audio);
        }}
        onCanPlayThrough={(e: any) => {
          const audio = e.currentTarget as HTMLAudioElement;
          recordAudioDiagnostic("canplaythrough", audio);
          checkAndSetAudioReady(audio);
        }}
        onProgress={(e: any) => {
          const audio = e.currentTarget as HTMLAudioElement;
          checkAndSetAudioReady(audio);
        }}
        onLoadedData={(e: any) => {
          const audio = e.currentTarget as HTMLAudioElement;
          recordAudioDiagnostic("loadeddata", audio);
          checkAndSetAudioReady(audio);
        }}
        onWaiting={(e: any) => recordAudioDiagnostic("waiting", e.currentTarget as HTMLAudioElement)}
        onStalled={(e: any) => recordAudioDiagnostic("stalled", e.currentTarget as HTMLAudioElement)}
        onSuspend={(e: any) => recordAudioDiagnostic("suspend", e.currentTarget as HTMLAudioElement)}
        onAbort={(e: any) => recordAudioDiagnostic("abort", e.currentTarget as HTMLAudioElement)}
        onEmptied={(e: any) => recordAudioDiagnostic("emptied", e.currentTarget as HTMLAudioElement)}
        onLoadedMetadata={(e: any) => {
          const audio = e.currentTarget as HTMLAudioElement;
          audio.muted = false;
          audio.defaultMuted = false;
          audio.volume = Math.max(0, Math.min(1, _audioVolume));
          setAudioDur(audio.duration || 0);
          updateExamMediaSessionPosition(audio);
          checkAndSetAudioReady(audio);
          if (pendingAudioResume && Number.isFinite(pendingAudioResume.time) && pendingAudioResume.time > 0) {
            audio.currentTime = Math.min(pendingAudioResume.time, Math.max(0, (audio.duration || pendingAudioResume.time) - 0.1));
            setAudioCur(audio.currentTime);
            updateExamMediaSessionPosition(audio);
            setPendingAudioResume(null);
          }
        }}
        onDurationChange={(e: any) => {
          const audio = e.currentTarget as HTMLAudioElement;
          setAudioDur(Number.isFinite(audio.duration) ? audio.duration : 0);
        }}
        onTimeUpdate={(e: any) => {
          const audio = e.currentTarget as HTMLAudioElement;
          publishAudioProgress(audio);
          checkAndSetAudioReady(audio);
        }}
        style={{ position: 'fixed', top: 0, left: 0, width: 1, height: 1, opacity: 0, pointerEvents: 'none', zIndex: -1 }}
      />,
      document.body
    )
  ) : null;

/*INSERT_REVIEW_QUIZ*/

/*INSERT_SEB_GUIDE*/
/*INSERT_PENDING_EXAM*/

/*INSERT_ACTIVE_EXAM*/

  if (userRole === "STUDENT" && realExamSession && !activeExam && !pendingExamState && !reviewQuiz) {
    const pkg = realExamPackages.find(item => item.id === realExamSession.packageId);
    const exams = packageQuizzes(pkg);
    const completed = new Set(realExamSession.completedQuizIds || []);
    const nextQuizId = pkg?.quizIds?.find(id => !completed.has(id));
    const nextQuiz = exams.find(quiz => quiz.id === nextQuizId);
    const nextInstructionVideoUrl = officialInstructionVideoUrl(realExamSkillLabel(nextQuiz));
    const doneCount = (pkg?.quizIds || []).filter(id => completed.has(id)).length;
    const formatRealExamTiming = (minutes: number) => minutes >= 60 && minutes % 60 === 0
      ? `${minutes / 60} hour${minutes === 60 ? "" : "s"}`
      : `${minutes} minutes`;
    const finishAndLeave = () => {
      setRealExamSession(null);
      persistRealExamSession(null);
      setPortalTab("home");
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
    const renderRealExamIcon = (name: "wifi" | "bell" | "menu" | "battery" | "volume" | "muted" | "check" | "chevron" | "arrow", size = 24) => {
      const base = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.1, strokeLinecap: "round", strokeLinejoin: "round", className: "real-exam-ico", "aria-hidden": true } as any;
      if (name === "wifi") return <svg {...base}><path d="M5 12.5a10 10 0 0 1 14 0"/><path d="M8.5 16a5.1 5.1 0 0 1 7 0"/><path d="M12 19.5h.01"/></svg>;
      if (name === "bell") return <svg {...base}><path d="M18 8.5a6 6 0 0 0-12 0c0 5.2-2 6.7-2 6.7h16s-2-1.5-2-6.7"/><path d="M10 19a2.2 2.2 0 0 0 4 0"/></svg>;
      if (name === "menu") return <svg {...base}><path d="M5 7h14"/><path d="M5 12h14"/><path d="M5 17h14"/></svg>;
      if (name === "battery") return <svg {...base}><rect x="3" y="8" width="16" height="9" rx="1"/><path d="M21 11v3"/><path d="M6 10.5h8v4H6z" fill="currentColor" stroke="none"/></svg>;
      if (name === "muted") return <svg {...base}><path d="M11 5 6.5 9H3v6h3.5l4.5 4V5z"/><path d="m18 10-4 4"/><path d="m14 10 4 4"/></svg>;
      if (name === "volume") return <svg {...base}><path d="M11 5 6.5 9H3v6h3.5l4.5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>;
      if (name === "check") return <svg {...base} stroke="#0b7f22" strokeWidth={2.4}><path d="m5 12.5 4.1 4.1L19 6.8"/></svg>;
      if (name === "chevron") return <svg {...base} width={14} height={14} viewBox="0 0 14 14" strokeWidth={2}><path d="m3 5 4 4 4-4"/></svg>;
      return <svg {...base} width={16} height={16} viewBox="0 0 16 16" strokeWidth={2.2}><path d="M3 8h9"/><path d="m8 4 4 4-4 4"/></svg>;
    };
    const setRealExamVolume = (value: number) => {
      const next = Math.max(0, Math.min(100, Math.round(value || 0)));
      setRealExamAudioVolume(next);
      setRealExamAudioMuted(next <= 0);
      _setAudioVolume(next / 100);
      try { if (audioRef.current) audioRef.current.volume = next / 100; } catch (error) {}
      try {
        const video = document.getElementById("real-exam-instruction-video") as HTMLVideoElement | null;
        if (video) { video.volume = next / 100; video.muted = next <= 0; }
      } catch (error) {}
    };
    const renderRealExamTopBar = () => (
      <header className="real-exam-top">
        <div className="real-exam-brand">
          <img src="https://d2snzxottmona5.cloudfront.net/releases/3.60.0/images/logo/ielts.svg" alt="IELTS" />
          <span>{realExamSession.testTakerId}</span>
        </div>
        <div className="real-exam-icons" aria-hidden="true">
          {renderRealExamIcon("wifi", 24)}
          {renderRealExamIcon("bell", 24)}
          {renderRealExamIcon("menu", 26)}
        </div>
      </header>
    );
    const renderRealExamBottomBar = (showBranding = false) => (
      <footer className="real-exam-bottom">
        {showBranding ? <RealExamBottomBrand /> : <span className="real-exam-assessment"></span>}
        <div className="real-exam-bottom-icons">
          <b>{new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</b>
          {renderRealExamIcon("battery", 25)}
          {renderRealExamIcon("wifi", 19)}
          <div className="real-exam-volume">
            <button type="button" className={`real-exam-audio ${realExamAudioMuted ? "is-muted" : ""}`} onClick={() => setRealExamAudioMenuOpen(open => !open)} title="Audio volume" aria-expanded={realExamAudioMenuOpen}>
              {renderRealExamIcon(realExamAudioMuted || realExamAudioVolume <= 0 ? "muted" : "volume", 18)}
            </button>
            {realExamAudioMenuOpen && <div className="real-exam-volume-popover"><input aria-label="Audio volume" type="range" min={0} max={100} value={realExamAudioMuted ? 0 : realExamAudioVolume} onChange={(event: any) => setRealExamVolume(Number(event.target.value))} style={{ background: `linear-gradient(90deg, #1673cc 0%, #1673cc ${realExamAudioMuted ? 0 : realExamAudioVolume}%, #d1d1d1 ${realExamAudioMuted ? 0 : realExamAudioVolume}%, #d1d1d1 100%)` }} /></div>}
          </div>
        </div>
      </footer>
    );
    if (realExamInstructionGate && pkg && realExamInstructionGate.packageId === pkg.id) {
      return (
        <>
          {persistentAudioNode}
          <div className="real-exam-shell">
          <style>{`
            .real-exam-shell{min-height:100dvh;background:#fff;color:#111;font-family:Arial,Helvetica,sans-serif;display:flex;flex-direction:column}
            .real-exam-top{height:48px;flex:none;border-bottom:1px solid #c9c9c9;display:flex;align-items:center;justify-content:space-between;padding:0 16px 0 12px;box-sizing:border-box;background:#fff}
            .real-exam-brand{display:flex;align-items:center;gap:28px;font-weight:800;font-size:14px}
            .real-exam-brand img{height:26px;display:block}
            .real-exam-icons{display:flex;align-items:center;gap:22px;color:#111}
            .real-exam-ico{display:block;flex:0 0 auto}
            .real-exam-wifi{width:21px;height:15px;display:inline-block;position:relative;border-top:4px solid currentColor;border-radius:50% 50% 0 0}
            .real-exam-wifi:before{content:"";position:absolute;left:4px;right:4px;top:2px;border-top:3px solid currentColor;border-radius:50% 50% 0 0}
            .real-exam-wifi span{position:absolute;left:9px;top:9px;width:4px;height:4px;background:currentColor;border-radius:50%}
            .real-exam-wifi.small{transform:scale(.74);transform-origin:center}
            .real-exam-bell{width:17px;height:19px;border:2px solid currentColor;border-bottom:0;border-radius:10px 10px 4px 4px;position:relative;display:inline-block}
            .real-exam-bell:after{content:"";position:absolute;left:4px;right:4px;bottom:-5px;border-bottom:2px solid currentColor}
            .real-exam-menu{width:20px;height:14px;border-top:3px solid currentColor;border-bottom:3px solid currentColor;display:inline-block;position:relative}
            .real-exam-menu:before{content:"";position:absolute;left:0;right:0;top:4px;border-top:3px solid currentColor}
            .real-exam-main{flex:1;overflow:hidden;padding:24px 18px 52px;display:grid;place-items:center;background:#fff;box-sizing:border-box}
            .real-exam-card{width:min(655px,calc(100vw - 36px));margin:0 auto 14px;border:1px solid #b8b8b8;border-radius:4px;background:#fff;box-sizing:border-box}
            .real-exam-card-head{display:flex;align-items:center;justify-content:space-between;padding:21px 20px;font-size:20px;font-weight:800}
            .real-exam-check{display:inline-flex;color:#0b7f22}
            .real-exam-video-wrap{width:min(960px,calc(100vw - 36px));margin:0 auto;box-sizing:border-box}
            .real-exam-video-frame{position:relative;width:100%;aspect-ratio:16/9;background:#000;overflow:hidden;isolation:isolate}
            .real-exam-video-frame video{position:absolute;inset:0;width:100%;height:100%;border:0;object-fit:contain;background:#000}
            .real-exam-video-duration{height:5px;width:100%;background:#dedede;overflow:hidden}
            .real-exam-video-duration>span{display:block;height:100%;background:#111;transition:width .45s linear}
            .real-exam-start{display:inline-flex;align-items:center;gap:8px;background:#111;color:#fff;border:0;border-radius:2px;padding:10px 16px;font-size:14px;font-weight:800;cursor:pointer}
            .real-exam-start:disabled{background:#d7d7d7;color:#888;cursor:not-allowed}
            .real-exam-bottom{position:fixed;left:0;right:0;bottom:0;height:52px;background:#e7e7e7;border-top:1px solid #d0d0d0;display:flex;align-items:center;justify-content:space-between;padding:0 18px;box-sizing:border-box}
            .real-exam-bottom-icons{display:flex;align-items:center;gap:18px}
            .real-exam-bottom-icons b{font-size:16px;letter-spacing:1px}
            .real-exam-battery{width:23px;height:14px;border:2px solid #111;display:inline-block;position:relative}
            .real-exam-battery:after{content:"";position:absolute;right:-5px;top:3px;width:3px;height:6px;background:#111}
            .real-exam-audio{width:34px;height:34px;border:1px solid #c4c4c4;background:#f8f8f8;color:#111;display:grid;place-items:center;cursor:pointer}
            .real-exam-audio.is-muted{background:#fff;color:#333}
            .real-exam-volume{position:relative;display:flex;align-items:center}
            .real-exam-volume-popover{position:absolute;right:-2px;bottom:40px;width:202px;height:38px;padding:0 12px;display:flex;align-items:center;border:1px solid #bdbdbd;background:rgba(245,245,245,.98);box-shadow:0 3px 10px rgba(0,0,0,.18);box-sizing:border-box}
            .real-exam-volume input{display:block;box-sizing:border-box;-webkit-appearance:none;appearance:none;width:178px;height:5px;margin:0;border:0;border-radius:0;cursor:pointer;outline:0}
            .real-exam-volume input::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:20px;height:20px;border-radius:50%;background:#e7e7e7;border:1px solid #b9b9b9;box-shadow:0 1px 2px rgba(0,0,0,.18);cursor:pointer}
            .real-exam-volume input::-moz-range-thumb{width:20px;height:20px;border-radius:50%;background:#e7e7e7;border:1px solid #b9b9b9;box-shadow:0 1px 2px rgba(0,0,0,.18);cursor:pointer}
            .real-exam-volume input::-moz-range-track{height:5px;background:#d1d1d1;border:0}
            .real-exam-volume input::-moz-range-progress{height:5px;background:#1673cc}
            .real-exam-fullscreen-gate{position:fixed;inset:0;z-index:1200;display:grid;place-items:center;background:rgba(20,20,20,.82);color:#fff;text-align:center}
            .real-exam-fullscreen-gate>div{width:min(360px,calc(100vw - 48px));padding:28px 24px;background:#252525;border:1px solid rgba(255,255,255,.22);box-shadow:0 18px 50px rgba(0,0,0,.34)}
            .real-exam-fullscreen-gate svg{margin:0 auto 12px}.real-exam-fullscreen-gate h2{margin:0;font-size:20px}.real-exam-fullscreen-gate p{margin:9px 0 20px;color:#e7e7e7;font-size:13px;line-height:1.45}
            .real-exam-assessment{width:120px;height:12px;background:linear-gradient(90deg,#777 0 8px,transparent 8px 12px,#777 12px 100%);opacity:.55}
          `}</style>
          <main className="real-exam-main">
            <section className="real-exam-video-wrap">
              <div className="real-exam-video-frame"><video id="real-exam-instruction-video" src={realExamInstructionGate.videoUrl} autoPlay playsInline preload="auto" controls={false} controlsList="nodownload noplaybackrate nofullscreen" disablePictureInPicture onContextMenu={(event) => event.preventDefault()} /></div>
              <div className="real-exam-video-duration" aria-label="Video progress"><span style={{width: `${Math.min(100, Math.max(0, (Number(realExamInstructionGate.currentTime) || 0) / Math.max(1, Number(realExamInstructionGate.duration) || 1) * 100))}%`}} /></div>
              {realExamInstructionGate.ready && <div style={{textAlign:'center',paddingTop:18}}><button type="button" className="real-exam-start" onClick={confirmRealExamInstructionGate}>Confirm and start {realExamInstructionGate.skill}</button></div>}
            </section>
          </main>
          {realExamFullscreenBlocked && <div className="real-exam-fullscreen-gate"><div><Ico name="expand" size={28} /><h2>Return to full screen</h2><p>The exam package is paused while full screen is off.</p><button type="button" className="real-exam-start" onClick={() => { requestRealExamFullscreen(true); window.setTimeout(() => { const viewH = Math.max(Number(window.innerHeight) || 0, Number(window.visualViewport?.height) || 0); setRealExamFullscreenBlocked(!document.fullscreenElement || ((Number(window.screen?.height) || 0) - viewH > 8)); }, 600); }}>Return to full screen</button></div></div>}
        </div>
      </>
    );
  }
  return (
    <>
      {persistentAudioNode}
      <div className="real-exam-shell">
        <style>{`
          .real-exam-shell{min-height:100dvh;background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif;display:flex;flex-direction:column}
          .real-exam-top{height:48px;flex:none;border-bottom:1px solid #c9c9c9;display:flex;align-items:center;justify-content:space-between;padding:0 16px 0 12px;box-sizing:border-box;background:#fff}
          .real-exam-brand{display:flex;align-items:center;gap:28px;font-weight:800;font-size:14px}
          .real-exam-brand img{height:26px;display:block}
          .real-exam-icons{display:flex;align-items:center;gap:22px;color:#111}
          .real-exam-ico{display:block;flex:0 0 auto}
          .real-exam-wifi{width:21px;height:15px;display:inline-block;position:relative;border-top:4px solid currentColor;border-radius:50% 50% 0 0}
          .real-exam-wifi:before{content:"";position:absolute;left:4px;right:4px;top:2px;border-top:3px solid currentColor;border-radius:50% 50% 0 0}
          .real-exam-wifi span{position:absolute;left:9px;top:9px;width:4px;height:4px;background:currentColor;border-radius:50%}
          .real-exam-wifi.small{transform:scale(.74);transform-origin:center}
          .real-exam-bell{width:17px;height:19px;border:2px solid currentColor;border-bottom:0;border-radius:10px 10px 4px 4px;position:relative;display:inline-block}
          .real-exam-bell:after{content:"";position:absolute;left:4px;right:4px;bottom:-5px;border-bottom:2px solid currentColor}
          .real-exam-menu{width:20px;height:14px;border-top:3px solid currentColor;border-bottom:3px solid currentColor;display:inline-block;position:relative}
          .real-exam-menu:before{content:"";position:absolute;left:0;right:0;top:4px;border-top:3px solid currentColor}
          .real-exam-main{flex:1;overflow:auto;padding:18px 18px 78px}
          .real-exam-card{width:min(655px,calc(100vw - 36px));margin:0 auto 14px;border:1px solid #b8b8b8;border-radius:4px;background:#fff;box-sizing:border-box}
          .real-exam-card-head{display:flex;align-items:center;justify-content:space-between;padding:21px 20px;font-size:20px;font-weight:800}
          .real-exam-check{display:inline-flex;color:#0b7f22}
          .real-exam-test{padding:18px 20px 20px}
          .real-exam-test h2{margin:0 0 18px;font-size:22px;line-height:1.15}
          .real-exam-status{margin:0 0 20px;font-size:14px;font-weight:800;color:#b00020}
          .real-exam-status.done{color:#0b7f22}
          .real-exam-timing{margin:0 0 20px;font-size:14px}
          .real-exam-info{height:52px;border:1px solid #c6c6c6;border-radius:2px;display:flex;align-items:center;padding:0 14px;margin:0 0 14px;gap:12px;box-sizing:border-box;font-size:14px}
          .real-exam-info b{font-size:20px;line-height:1}
          .real-exam-info-caret{display:inline-flex;align-items:center;justify-content:center;width:14px;color:#111}
          .real-exam-info span:last-child{color:#0b7f22;margin-left:4px}
          .real-exam-start{display:inline-flex;align-items:center;gap:8px;background:#111;color:#fff;border:0;border-radius:2px;padding:10px 16px;font-size:14px;font-weight:800;cursor:pointer}
          .real-exam-start:disabled{background:#d7d7d7;color:#888;cursor:not-allowed}
          .real-exam-bottom{position:fixed;left:0;right:0;bottom:0;height:52px;background:#e7e7e7;border-top:1px solid #d0d0d0;display:flex;align-items:center;justify-content:space-between;padding:0 18px;box-sizing:border-box}
          .real-exam-bottom-brand{height:100%;display:flex;align-items:center;gap:7px;white-space:nowrap}
          .real-exam-bottom-icons{display:flex;align-items:center;gap:18px}
          .real-exam-bottom-icons b{font-size:16px;letter-spacing:1px}
          .real-exam-battery{width:23px;height:14px;border:2px solid #111;display:inline-block;position:relative}
          .real-exam-battery:after{content:"";position:absolute;right:-5px;top:3px;width:3px;height:6px;background:#111}
          .real-exam-audio{width:34px;height:34px;border:1px solid #c4c4c4;background:#f8f8f8;color:#111;display:grid;place-items:center;cursor:pointer}
          .real-exam-audio.is-muted{background:#fff;color:#333}
          .real-exam-volume{position:relative;display:flex;align-items:center}
          .real-exam-volume-popover{position:absolute;right:-2px;bottom:40px;width:202px;height:38px;padding:0 12px;display:flex;align-items:center;border:1px solid #bdbdbd;background:rgba(245,245,245,.98);box-shadow:0 3px 10px rgba(0,0,0,.18);box-sizing:border-box}
          .real-exam-volume input{display:block;box-sizing:border-box;-webkit-appearance:none;appearance:none;width:178px;height:5px;margin:0;border:0;border-radius:0;cursor:pointer;outline:0}
          .real-exam-volume input::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:20px;height:20px;border-radius:50%;background:#e7e7e7;border:1px solid #b9b9b9;box-shadow:0 1px 2px rgba(0,0,0,.18);cursor:pointer}
          .real-exam-volume input::-moz-range-thumb{width:20px;height:20px;border-radius:50%;background:#e7e7e7;border:1px solid #b9b9b9;box-shadow:0 1px 2px rgba(0,0,0,.18);cursor:pointer}
          .real-exam-volume input::-moz-range-track{height:5px;background:#d1d1d1;border:0}
          .real-exam-volume input::-moz-range-progress{height:5px;background:#1673cc}
          .real-exam-fullscreen-gate{position:fixed;inset:0;z-index:1200;display:grid;place-items:center;background:rgba(20,20,20,.82);color:#fff;text-align:center}
          .real-exam-fullscreen-gate>div{width:min(360px,calc(100vw - 48px));padding:28px 24px;background:#252525;border:1px solid rgba(255,255,255,.22);box-shadow:0 18px 50px rgba(0,0,0,.34)}
          .real-exam-fullscreen-gate svg{margin:0 auto 12px}.real-exam-fullscreen-gate h2{margin:0;font-size:20px}.real-exam-fullscreen-gate p{margin:9px 0 20px;color:#e7e7e7;font-size:13px;line-height:1.45}
          .real-exam-assessment{width:120px;height:12px;background:linear-gradient(90deg,#777 0 8px,transparent 8px 12px,#777 12px 100%);opacity:.55}
        `}</style>
        {globalStyles}
        {renderRealExamTopBar()}
        <main className="real-exam-main">
          {nextInstructionVideoUrl && (
            <video
              id="real-exam-instruction-preloader"
              src={nextInstructionVideoUrl}
              preload="auto"
              muted
              playsInline
              aria-hidden="true"
              tabIndex={-1}
              style={{ position: "fixed", left: -2, bottom: -2, width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
            />
          )}
          {!pkg ? (
            <section className="real-exam-card" style={{ padding: 24 }}>
              <h1 style={{ margin: "0 0 10px", fontSize: 24 }}>Package unavailable</h1>
              <p style={{ margin: "0 0 18px", color: "#4b5563" }}>This real exam package is no longer available.</p>
              <button onClick={finishAndLeave} style={{ border: "1px solid #111827", background: "#111827", color: "#fff", padding: "10px 18px", fontWeight: 800, cursor: "pointer" }}>Return to dashboard</button>
            </section>
          ) : (
            <>
              <section className="real-exam-card">
                <div className="real-exam-card-head">
                  <span>Pre-test checks</span>
                  <span className="real-exam-check">{renderRealExamIcon("check", 25)}</span>
                </div>
              </section>
              {exams.map((quiz) => {
                  const quizDone = completed.has(quiz.id);
                  const isNext = quiz.id === nextQuizId;
                  const skill = realExamSkillLabel(quiz);
                  return (
                    <section key={quiz.id} className="real-exam-card real-exam-test">
                      <h2>{skill}</h2>
                      <p className={`real-exam-status ${quizDone ? "done" : ""}`}>{quizDone ? "Completed" : "Not completed"}</p>
                      <p className="real-exam-timing">Timing: {formatRealExamTiming(Number(quiz.timeLimit) || 0)}</p>
                      {isNext && !quizDone && <div className="real-exam-info"><span className="real-exam-info-caret">{renderRealExamIcon("chevron", 14)}</span><span>Test information.</span><span>Confirmed</span></div>}
                      <button className="real-exam-start" disabled={!isNext || quizDone} onClick={() => startRealExamPackageQuiz(pkg, quiz.id)}>
                        {renderRealExamIcon("arrow", 16)} Start {skill}
                      </button>
                    </section>
                  );
                })}
            </>
          )}
        </main>
        {renderRealExamBottomBar(true)}
        {realExamFullscreenBlocked && <div className="real-exam-fullscreen-gate"><div><Ico name="expand" size={28} /><h2>Return to full screen</h2><p>The exam package is paused while full screen is off.</p><button type="button" className="real-exam-start" onClick={() => { requestRealExamFullscreen(true); window.setTimeout(() => { const viewH = Math.max(Number(window.innerHeight) || 0, Number(window.visualViewport?.height) || 0); setRealExamFullscreenBlocked(!document.fullscreenElement || ((Number(window.screen?.height) || 0) - viewH > 8)); }, 600); }}>Return to full screen</button></div></div>}
      </div>
    </>
  );
}

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
      {saveToastOverlay}
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
              {(["DASHBOARD", "CLASSROOM", "EXAM_BUILDER", "TOPIC_ASSIGNMENTS", "LIVE_ARENA", "STUDENTS", "FINANCE", "DRIVE"] as TabType[]).map(tabKey => (
                <button key={tabKey} onClick={() => handleTeacherTabChange(tabKey)} className={`tab-btn ${activeTab === tabKey ? 'active' : ''}`}>{tabKey === "TOPIC_ASSIGNMENTS" ? (i18n.language === "vi" ? "Chuyên đề" : "Quests") : t('tab_' + tabKey)}</button>
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
/*INSERT_TOPIC_ASSIGNMENTS*/
/*INSERT_LIVE_ARENA*/
/*INSERT_ACADEMICS*/
/*INSERT_STUDENTS*/
/*INSERT_FINANCE*/
/*INSERT_HISTORY*/
/*INSERT_DRIVE*/

      </main>
      
      {!activeExam && !isMobile && (
          <button onClick={scrollToTop} style={{position: 'fixed', bottom: 20, right: 20, width: 38, height: 38, borderRadius: 10, background: C.card, color: C.text, border: '1px solid ' + C.border, boxShadow: '0 4px 12px rgba(26,23,38,0.08)', zIndex: 999, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'}} title="Scroll to top"><Ico name="arrowUp" size={18} /></button>
      )}


      {isMobile && !activeExam && (
        <>
          <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 1000, background: 'rgba(255,255,255,0.93)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderTop: `1px solid ${C.border}`, display: 'flex', paddingBottom: 'env(safe-area-inset-bottom)' }}>
            {([{ key: 'DASHBOARD', icon: 'home' }, { key: 'STUDENTS', icon: 'users' }, { key: 'EXAM_BUILDER', icon: 'fileText' }, { key: 'FINANCE', icon: 'wallet' }] as {key: TabType, icon: string}[]).map(it => {
              const on = activeTab === it.key;
              return (
                <button key={it.key} onClick={() => { handleTeacherTabChange(it.key); setMobileMoreOpen(false); }} style={{ flex: 1, background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '8px 0', color: on ? C.accent : C.sub }}>
                  <Ico name={it.icon} size={21} />
                  <span style={{ fontSize: 10, fontWeight: on ? 800 : 600 }}>{t('tab_' + it.key)}</span>
                </button>
              );
            })}
            <button onClick={() => setMobileMoreOpen(v => !v)} style={{ flex: 1, background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '8px 0', color: (mobileMoreOpen || ['CLASSROOM','TOPIC_ASSIGNMENTS','LIVE_ARENA','DRIVE','ACADEMICS','HISTORY'].includes(activeTab)) ? C.accent : C.sub }}>
              <Ico name="list" size={21} />
              <span style={{ fontSize: 10, fontWeight: 600 }}>{i18n.language === 'vi' ? 'Thêm' : 'More'}</span>
            </button>
          </div>

          {mobileMoreOpen && (
            <div onClick={() => setMobileMoreOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1001, display: 'flex', alignItems: 'flex-end' }}>
              <div onClick={e => e.stopPropagation()} style={{ width: '100%', background: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: '10px 14px calc(20px + env(safe-area-inset-bottom))', borderTop: `1px solid ${C.border}` }}>
                <div style={{ width: 38, height: 4, borderRadius: 2, background: C.border, margin: '6px auto 14px' }} />
                {([{ key: 'CLASSROOM', icon: 'clock' }, { key: 'TOPIC_ASSIGNMENTS', icon: 'target' }, { key: 'LIVE_ARENA', icon: 'monitor' }, { key: 'DRIVE', icon: 'cloud' }] as {key: TabType, icon: string}[]).map(it => (
                  <button key={it.key} onClick={() => { handleTeacherTabChange(it.key); setMobileMoreOpen(false); }} style={{ width: '100%', textAlign: 'left', background: activeTab === it.key ? `${C.accent}12` : 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 12px', borderRadius: 12, color: C.text, fontSize: 15, fontWeight: 700 }}>
                    <Ico name={it.icon} size={20} color={activeTab === it.key ? C.accent : C.sub} /> {it.key === 'TOPIC_ASSIGNMENTS' ? (i18n.language === 'vi' ? 'Bài tập chuyên đề' : 'Quest assignments') : t('tab_' + it.key)}
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

      {/* Lightbox Modal for Diagrams & Visuals */}
      {lightboxImageUrl && typeof document !== 'undefined' && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label={tx("Phóng to hình ảnh", "Image zoom")}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 999999,
            background: 'rgba(15, 23, 42, 0.78)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            animation: 'fadeIn 0.15s ease-out',
          }}
          onClick={() => setLightboxImageUrl(null)}
        >
          <div
            style={{
              position: 'relative',
              maxWidth: 'min(92vw, 1100px)',
              maxHeight: '90vh',
              background: '#ffffff',
              borderRadius: 12,
              padding: 16,
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.15)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, paddingBottom: 8, borderBottom: '1px solid #e2e8f0' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#334155', display: 'flex', alignItems: 'center', gap: 6 }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
                {tx("Hình ảnh phóng to", "Enlarged Image")}
              </span>
              <button
                type="button"
                onClick={() => setLightboxImageUrl(null)}
                title={tx("Đóng (Esc)", "Close (Esc)")}
                aria-label={tx("Đóng", "Close")}
                style={{
                  background: '#f1f5f9',
                  border: 'none',
                  borderRadius: 6,
                  padding: '5px 8px',
                  cursor: 'pointer',
                  color: '#475569',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 12,
                  fontWeight: 600,
                  transition: 'background 0.15s',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                <span>{tx("Đóng", "Close")}</span>
              </button>
            </div>
            <div style={{ flex: 1, overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
              <img
                src={lightboxImageUrl}
                alt="Enlarged visual"
                style={{
                  maxWidth: '100%',
                  maxHeight: 'calc(90vh - 80px)',
                  objectFit: 'contain',
                  display: 'block',
                  borderRadius: 6,
                }}
              />
            </div>
          </div>
        </div>,
        document.body
      )}
      {persistentAudioNode}
    </div>
  );
}
