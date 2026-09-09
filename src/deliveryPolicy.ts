export type DeliveryMode = "exam" | "practice";

export interface StoredExamPolicy {
  maxAttempts?: number;
  isSEBRequired?: boolean;
  audioMode?: "strict" | "practice";
}

export interface DeliveryModeSource {
  type?: string;
  deliveryMode?: DeliveryMode;
  /** Legacy import spelling is accepted on read only. */
  delivery_mode?: DeliveryMode;
  practiceMode?: boolean;
  audioMode?: "strict" | "practice";
  maxAttempts?: number;
  isSEBRequired?: boolean;
  examPolicy?: StoredExamPolicy;
}

export interface DeliveryPolicy {
  mode: DeliveryMode;
  isPractice: boolean;
  maxAttempts: number;
  isSEBRequired: boolean;
  audioMode?: "strict" | "practice";
}

const isListening = (value: DeliveryModeSource) => /listen|integrated/i.test(String(value?.type || ""));

/**
 * Existing records without a mode keep their historical restrictions unless
 * they explicitly opted into the old Practice behaviour. This is deliberately
 * conservative: an ambiguous legacy assessment is always an Exam.
 */
export const getDeliveryMode = (exam: DeliveryModeSource | null | undefined): DeliveryMode => {
  if (!exam) return "exam";
  if (exam.deliveryMode === "practice" || exam.delivery_mode === "practice") return "practice";
  if (exam.deliveryMode === "exam" || exam.delivery_mode === "exam") return "exam";
  if (exam.practiceMode === true) return "practice";
  if (isListening(exam) && exam.audioMode === "practice") return "practice";
  return "exam";
};

export const getRememberedExamPolicy = (exam: DeliveryModeSource): StoredExamPolicy => ({
  maxAttempts: Math.max(1, Number(exam.examPolicy?.maxAttempts ?? exam.maxAttempts) || 1),
  isSEBRequired: Boolean(exam.examPolicy?.isSEBRequired ?? exam.isSEBRequired),
  audioMode: exam.examPolicy?.audioMode || (isListening(exam) ? (exam.audioMode === "practice" ? "strict" : exam.audioMode || "strict") : undefined),
});

export const getDeliveryPolicy = (exam: DeliveryModeSource | null | undefined): DeliveryPolicy => {
  const source = exam || {};
  const mode = getDeliveryMode(source);
  const remembered = getRememberedExamPolicy(source);
  if (mode === "practice") {
    return {
      mode,
      isPractice: true,
      maxAttempts: Number.MAX_SAFE_INTEGER,
      isSEBRequired: false,
      audioMode: isListening(source) ? "practice" : remembered.audioMode,
    };
  }
  return {
    mode,
    isPractice: false,
    maxAttempts: remembered.maxAttempts || 1,
    isSEBRequired: Boolean(remembered.isSEBRequired),
    audioMode: remembered.audioMode,
  };
};

/** Switches delivery only. Content, history and the remembered Exam policy survive. */
export const withDeliveryMode = <T extends DeliveryModeSource>(exam: T, mode: DeliveryMode): T & {
  deliveryMode: DeliveryMode;
  practiceMode: boolean;
  examPolicy: StoredExamPolicy;
  maxAttempts: number;
  isSEBRequired: boolean;
  audioMode?: "strict" | "practice";
} => {
  const remembered = getRememberedExamPolicy(exam);
  const next = getDeliveryPolicy({ ...exam, deliveryMode: mode, examPolicy: remembered });
  return {
    ...exam,
    deliveryMode: mode,
    practiceMode: mode === "practice",
    examPolicy: remembered,
    maxAttempts: next.maxAttempts,
    isSEBRequired: next.isSEBRequired,
    ...(next.audioMode ? { audioMode: next.audioMode } : {}),
  };
};

export const isQuizPublishable = (exam: any): { ok: boolean; reason?: string } => {
  if (!exam || !String(exam.title || "").trim()) return { ok: false, reason: "Missing exam title." };
  const validation = exam.pipelineValidation || exam.generation?.validation;
  if (validation && !["PASS", "READY", "READY_FOR_REVIEW", "PUBLISHED"].includes(String(validation.state || validation.status || validation))) {
    return { ok: false, reason: "Pipeline validation is not ready." };
  }
  if (/writing/i.test(String(exam.type || ""))) {
    const tasks = Array.isArray(exam.writingTasks) ? exam.writingTasks : [];
    if (tasks.length !== 2 || tasks.some((task: any) => !String(task?.prompt || "").trim())) return { ok: false, reason: "Writing requires both task prompts." };
    return { ok: true };
  }
  const questions = Array.isArray(exam.questions) ? exam.questions : [];
  if (!questions.length) return { ok: false, reason: "No questions were found." };
  const missingAnswer = questions.find((question: any) => question?.correctAnswer === undefined || question?.correctAnswer === null || question?.correctAnswer === "");
  return missingAnswer ? { ok: false, reason: `Question ${missingAnswer.questionNumber || "?"} has no answer.` } : { ok: true };
};

export const isReadyForPublish = (exam: any) => {
  const validation = exam?.pipelineValidation || exam?.generation?.validation;
  return ["READY", "READY_FOR_REVIEW", "PASS"].includes(String(validation?.state || validation?.status || validation || ""))
    && isQuizPublishable(exam).ok;
};
