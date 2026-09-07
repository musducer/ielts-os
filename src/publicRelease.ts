export type WritingTaskNumber = 1 | 2;

export interface WritingTaskDefinition {
  id: string;
  taskNumber: WritingTaskNumber;
  title: string;
  instructions: string;
  prompt: string;
  mediaUrl?: string;
  minimumWords: number;
  recommendedMinutes: number;
  order: number;
}

export interface GiftDefinition {
  id: string;
  name: string;
  details?: string;
  kind: "consumable" | "permanent";
  group?: string;
  price: number;
  enabled: boolean;
  updatedAt?: number;
}

export interface RewardMechanism {
  id: string;
  name: string;
  event: string;
  coins: number;
  enabled: boolean;
  updatedAt?: number;
}

export const DEFAULT_GIFT_CATALOG: GiftDefinition[] = [
  { id: "deadline-24h", name: "Thẻ dời deadline (24h)", kind: "consumable", price: 1000, enabled: true },
  { id: "milo", name: "1 Hộp Milo", kind: "consumable", price: 500, enabled: true },
  { id: "trai-cho", name: "1 Ly Trái Chò", kind: "consumable", price: 1000, enabled: true },
  { id: "tra-sua", name: "1 Trà sữa Viên Viên", kind: "consumable", price: 1000, enabled: true },
  ...[
    ["title-warrior", "titles", "Danh hiệu: Chiến Thần IELTS"],
    ["title-destroyer", "titles", "Danh hiệu: Kẻ Hủy Diệt Đề"],
    ["title-scholar", "titles", "Danh hiệu: Học Bá Thượng Đẳng"],
    ["title-reading", "titles", "Danh hiệu: Cao Thủ Reading"],
    ["title-vocab", "titles", "Danh hiệu: Bậc Thầy Từ Vựng"],
    ["title-speed", "titles", "Danh hiệu: Vua Tốc Độ"],
    ["title-legend", "titles", "Danh hiệu: Huyền Thoại 8.0+"],
    ["title-bookworm", "titles", "Danh hiệu: Mọt Sách Bất Bại"],
    ["title-band", "titles", "Danh hiệu: Thợ Săn Band Điểm"],
    ["title-exam", "titles", "Danh hiệu: Ninja Phòng Thi"],
    ["theme-gold", "themes", "Giao diện: Hoàng Kim"],
    ["theme-midnight", "themes", "Giao diện: Nửa Đêm"],
    ["theme-cherry", "themes", "Giao diện: Anh Đào"],
    ["theme-forest", "themes", "Giao diện: Rừng Sâu"],
    ["frame-crown", "frames", "Khung avatar: Vương Miện"],
    ["frame-dragon", "frames", "Khung avatar: Rồng Lửa"],
    ["frame-ice", "frames", "Khung avatar: Băng Giá"],
    ["frame-rainbow", "frames", "Khung avatar: Cầu Vồng"],
    ["frame-meteor", "frames", "Khung avatar: Sao Băng"],
    ["pet-owl", "pets", "Linh thú: Cú Mèo"],
    ["pet-cat", "pets", "Linh thú: Mèo Thần Tài"],
    ["pet-dragon", "pets", "Linh thú: Rồng Con"],
    ["pet-fox", "pets", "Linh thú: Cáo Lửa"],
    ["pet-penguin", "pets", "Linh thú: Chim Cánh Cụt"],
    ["pet-panda", "pets", "Linh thú: Gấu Trúc"],
  ].map(([id, group, name]) => ({ id, group, name, kind: "permanent" as const, price: 0, enabled: true })),
];

export const DEFAULT_REWARD_MECHANISMS: RewardMechanism[] = [
  { id: "daily-attendance", name: "Daily attendance", event: "DAILY_ATTENDANCE", coins: 20, enabled: true },
  { id: "weekly-streak", name: "Seven-day streak", event: "WEEKLY_STREAK", coins: 300, enabled: true },
  { id: "review", name: "Review completed", event: "REVIEW_REWARD", coins: 20, enabled: true },
  { id: "exam-complete", name: "Exam completed", event: "EXAM_COMPLETE", coins: 50, enabled: true },
  { id: "exam-early-high", name: "Early submission bonus", event: "EXAM_EARLY_HIGH", coins: 150, enabled: true },
  { id: "exam-early", name: "Small early submission bonus", event: "EXAM_EARLY", coins: 100, enabled: true },
  { id: "lesson-short", name: "Short lesson", event: "LESSON_SHORT", coins: 10, enabled: true },
  { id: "lesson-standard", name: "Standard lesson", event: "LESSON_STANDARD", coins: 25, enabled: true },
  { id: "lesson-long", name: "Long lesson", event: "LESSON_LONG", coins: 60, enabled: true },
  { id: "gacha-spin", name: "Gacha spin cost", event: "GACHA_SPIN_COST", coins: 500, enabled: true },
  { id: "gacha-refund", name: "Duplicate permanent refund", event: "GACHA_DUPLICATE_REFUND", coins: 200, enabled: true },
];

const positiveInteger = (value: unknown, fallback: number) => {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number >= 0 ? number : fallback;
};

export const normalizeGiftCatalog = (value: unknown): GiftDefinition[] => {
  // An absent legacy field starts with the public defaults. An explicit empty array,
  // however, is a valid teacher configuration after removing every catalog item.
  if (!Array.isArray(value)) return DEFAULT_GIFT_CATALOG.map(item => ({ ...item }));
  return value.flatMap((item: any, index) => {
    const name = String(item?.name || "").trim();
    if (!name) return [];
    return [{
      id: String(item?.id || `gift-${index}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`),
      name,
      details: String(item?.details || "").trim(),
      kind: item?.kind === "permanent" ? "permanent" as const : "consumable" as const,
      group: String(item?.group || "").trim() || undefined,
      price: positiveInteger(item?.price, 0),
      enabled: item?.enabled !== false,
      updatedAt: Number(item?.updatedAt) || undefined,
    }];
  });
};

export const normalizeRewardMechanisms = (value: unknown): RewardMechanism[] => {
  if (!Array.isArray(value)) return DEFAULT_REWARD_MECHANISMS.map(item => ({ ...item }));
  const configured = value;
  const byEvent = new Map<string, RewardMechanism>();
  configured.forEach((item: any, index) => {
    const event = String(item?.event || "").trim().toUpperCase();
    if (!event) return;
    byEvent.set(event, {
      id: String(item?.id || `reward-${index}-${event.toLowerCase()}`),
      name: String(item?.name || event).trim(),
      event,
      coins: positiveInteger(item?.coins, 0),
      enabled: item?.enabled !== false,
      updatedAt: Number(item?.updatedAt) || undefined,
    });
  });
  return Array.from(byEvent.values());
};

export const coinsForRewardEvent = (mechanisms: RewardMechanism[], event: string, fallback = 0) => {
  const rule = mechanisms.find(item => item.event === String(event || "").trim().toUpperCase());
  // The published catalog is authoritative: deleting or disabling a rule stops
  // that reward/cost. Legacy workspaces are normalized to the default catalog.
  return rule?.enabled ? positiveInteger(rule.coins, fallback) : 0;
};

export const isWritingQuiz = (quiz: any) => String(quiz?.type || "").toLowerCase().includes("writ");

export const defaultWritingTasks = (): WritingTaskDefinition[] => ([
  {
    id: "writing_task_1",
    taskNumber: 1,
    title: "Writing Task 1",
    instructions: "You should spend about 20 minutes on this task. Write at least 150 words.",
    prompt: "",
    minimumWords: 150,
    recommendedMinutes: 20,
    order: 1,
  },
  {
    id: "writing_task_2",
    taskNumber: 2,
    title: "Writing Task 2",
    instructions: "You should spend about 40 minutes on this task. Write at least 250 words.",
    prompt: "",
    minimumWords: 250,
    recommendedMinutes: 40,
    order: 2,
  },
]);

export const normalizeWritingTasks = (quiz: any): WritingTaskDefinition[] => {
  if (!isWritingQuiz(quiz)) return [];
  const defaults = defaultWritingTasks();
  const source = Array.isArray(quiz?.writingTasks) && quiz.writingTasks.length
    ? quiz.writingTasks
    : (Array.isArray(quiz?.sections) && quiz.sections.length
      ? quiz.sections.slice(0, 2).map((section: any, index: number) => ({
          id: `writing_task_${index + 1}`,
          taskNumber: index + 1,
          prompt: section?.passage || "",
          instructions: section?.instruction || "",
          mediaUrl: section?.images?.[0],
        }))
      : []);
  return defaults.map((fallback, index) => {
    const task = source.find((item: any) => Number(item?.taskNumber) === fallback.taskNumber) || source[index] || {};
    return {
      ...fallback,
      ...task,
      id: String(task?.id || fallback.id),
      taskNumber: fallback.taskNumber,
      title: String(task?.title || fallback.title),
      instructions: String(task?.instructions || fallback.instructions),
      prompt: String(task?.prompt || ""),
      mediaUrl: String(task?.mediaUrl || "").trim() || undefined,
      minimumWords: positiveInteger(task?.minimumWords, fallback.minimumWords),
      recommendedMinutes: positiveInteger(task?.recommendedMinutes, fallback.recommendedMinutes),
      order: positiveInteger(task?.order, fallback.order),
    };
  }).sort((a, b) => a.order - b.order);
};

export const writingQuestions = (quiz: any) => normalizeWritingTasks(quiz).map(task => ({
  id: task.id,
  questionNumber: task.taskNumber,
  type: "WRITING",
  subType: `WRITING_TASK_${task.taskNumber}`,
  instruction: task.instructions,
  text: task.prompt,
  correctAnswer: "",
  passageIndex: task.taskNumber - 1,
}));

export const countWritingWords = (value: unknown) => {
  const text = String(value || "").trim();
  return text ? text.split(/\s+/u).filter(Boolean).length : 0;
};

export const writingDraftKey = (ownerEmail: string, quizId: string, attemptId: string) =>
  [ownerEmail, quizId, attemptId].map(value => encodeURIComponent(String(value || "").trim().toLowerCase())).join("__");

export const resultSubmittedAt = (result: any): number => {
  const direct = Number(result?.submittedAt);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const idTimestamp = Number(String(result?.id || "").match(/^(\d{10,})/)?.[1]);
  if (Number.isFinite(idTimestamp) && idTimestamp > 0) return idTimestamp;
  const parsed = Date.parse(String(result?.endTime || result?.date || ""));
  return Number.isFinite(parsed) ? parsed : 0;
};
