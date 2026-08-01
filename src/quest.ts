export type QuestRewardTrigger = "milestone" | "total_score" | "streak";
export type QuestRewardType = "coins" | "permanent_gift" | "voucher" | "custom";
export type QuestNodeMode = "practice" | "exam";

export interface RewardRule {
  id: string;
  type: QuestRewardTrigger;
  targetValue: number;
  rewardType: QuestRewardType;
  rewardValue: string;
  description?: string;
}

export interface QuestNodeConfig {
  id: string;
  testId: string;
  title: string;
  description?: string;
  openDate?: string;
  closeDate?: string;
  passingThresholdPercent: number;
  mode: QuestNodeMode;
  timeLimitMinutes?: number;
  questionCount: number;
}

export interface TopicAssignment {
  id: string;
  title: string;
  topicCategory: string;
  description?: string;
  openDate?: string;
  closeDate?: string;
  audience?: "ALL" | "SPECIFIC";
  targetStudentIds?: string[];
  nodes: QuestNodeConfig[];
  rewards: RewardRule[];
  createdBy: string;
  createdAt: number;
  updatedAt?: number;
}

export interface QuestAttempt {
  id: string;
  resultId: string;
  score: number;
  totalQuestions: number;
  percentage: number;
  passed: boolean;
  submittedAt: number;
  attemptCount: number;
}

export interface StudentQuestProgress {
  studentId: string;
  topicAssignmentId: string;
  completedNodeIds: string[];
  currentNodeIndex: number;
  attempts: Record<string, QuestAttempt[]>;
  totalAccumulatedScore: number;
  currentStreak: number;
  unlockedRewards: string[];
  updatedAt?: number;
}

export interface QuestLaunchContext {
  topicAssignmentId: string;
  nodeId: string;
}

export type QuestNodeState = "locked" | "scheduled" | "closed" | "available" | "retry" | "completed";

const uniqueStrings = (values: unknown): string[] => Array.from(new Set(
  (Array.isArray(values) ? values : []).map(value => String(value || "").trim()).filter(Boolean)
));

const validNumber = (value: unknown, fallback = 0): number => {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
};

const attemptIdentity = (attempt: Partial<QuestAttempt>, nodeId: string, index: number): string =>
  String(attempt.id || attempt.resultId || `${nodeId}_${attempt.submittedAt || "unknown"}_${attempt.score || 0}_${index}`);

const normaliseAttempts = (raw: unknown, nodeId: string): QuestAttempt[] => {
  const values = Array.isArray(raw) ? raw : [];
  const byId = new Map<string, QuestAttempt>();
  values.forEach((value: any, index) => {
    if (!value || typeof value !== "object") return;
    const id = attemptIdentity(value, nodeId, index);
    const total = Math.max(0, validNumber(value.totalQuestions));
    const score = Math.max(0, validNumber(value.score));
    const percentage = Math.max(0, Math.min(100, validNumber(
      value.percentage,
      total > 0 ? Number(((score / total) * 100).toFixed(2)) : 0
    )));
    const current: QuestAttempt = {
      id,
      resultId: String(value.resultId || value.id || id),
      score,
      totalQuestions: total,
      percentage,
      passed: value.passed === true,
      submittedAt: validNumber(value.submittedAt, 0),
      attemptCount: Math.max(1, Math.floor(validNumber(value.attemptCount, index + 1))),
    };
    const previous = byId.get(id);
    byId.set(id, previous ? { ...previous, ...current, passed: previous.passed || current.passed } : current);
  });
  return Array.from(byId.values()).sort((a, b) =>
    a.submittedAt - b.submittedAt || a.attemptCount - b.attemptCount || a.id.localeCompare(b.id)
  );
};

export const emptyQuestProgress = (studentId: string, topicAssignmentId: string): StudentQuestProgress => ({
  studentId,
  topicAssignmentId,
  completedNodeIds: [],
  currentNodeIndex: 0,
  attempts: {},
  totalAccumulatedScore: 0,
  currentStreak: 0,
  unlockedRewards: [],
});

export const getQuestProgressKey = (studentId: string, assignmentId: string) =>
  `${String(studentId || "").trim()}::${String(assignmentId || "").trim()}`;

export const deriveQuestProgress = (
  raw: Partial<StudentQuestProgress> | null | undefined,
  assignment?: TopicAssignment | null,
): StudentQuestProgress => {
  const base = emptyQuestProgress(String(raw?.studentId || ""), String(raw?.topicAssignmentId || ""));
  const attempts: Record<string, QuestAttempt[]> = {};
  Object.entries(raw?.attempts || {}).forEach(([nodeId, nodeAttempts]) => {
    attempts[String(nodeId)] = normaliseAttempts(nodeAttempts, String(nodeId));
  });

  const completed = new Set(uniqueStrings(raw?.completedNodeIds));
  Object.entries(attempts).forEach(([nodeId, nodeAttempts]) => {
    if (nodeAttempts.some(attempt => attempt.passed)) completed.add(nodeId);
  });

  const nodeOrder = assignment?.nodes?.map(node => String(node.id)) || Object.keys(attempts);
  const orderedKnownNodes = nodeOrder.length ? nodeOrder : Array.from(completed);
  const totalAccumulatedScore = orderedKnownNodes.reduce((total, nodeId) => {
    const nodeAttempts = attempts[nodeId] || [];
    const best = nodeAttempts.reduce((highest, attempt) => Math.max(highest, attempt.score), 0);
    return total + best;
  }, 0);

  let currentNodeIndex = orderedKnownNodes.findIndex(nodeId => !completed.has(nodeId));
  if (currentNodeIndex < 0) currentNodeIndex = orderedKnownNodes.length;

  let currentStreak = 0;
  for (const nodeId of orderedKnownNodes) {
    const firstAttempt = (attempts[nodeId] || [])[0];
    if (!firstAttempt || !firstAttempt.passed) break;
    currentStreak += 1;
  }

  return {
    ...base,
    ...raw,
    completedNodeIds: orderedKnownNodes.filter(nodeId => completed.has(nodeId)).concat(
      Array.from(completed).filter(nodeId => !orderedKnownNodes.includes(nodeId))
    ),
    attempts,
    currentNodeIndex,
    totalAccumulatedScore,
    currentStreak,
    unlockedRewards: uniqueStrings(raw?.unlockedRewards),
    updatedAt: validNumber(raw?.updatedAt, 0) || undefined,
  };
};

export const mergeQuestProgress = (
  serverRaw: Partial<StudentQuestProgress> | null | undefined,
  localRaw: Partial<StudentQuestProgress> | null | undefined,
  assignment?: TopicAssignment | null,
): StudentQuestProgress => {
  const server = deriveQuestProgress(serverRaw, assignment);
  const local = deriveQuestProgress(localRaw, assignment);
  const nodeIds = new Set([...Object.keys(server.attempts), ...Object.keys(local.attempts)]);
  const attempts: Record<string, QuestAttempt[]> = {};
  nodeIds.forEach(nodeId => {
    attempts[nodeId] = normaliseAttempts([...(server.attempts[nodeId] || []), ...(local.attempts[nodeId] || [])], nodeId);
  });
  return deriveQuestProgress({
    studentId: local.studentId || server.studentId,
    topicAssignmentId: local.topicAssignmentId || server.topicAssignmentId,
    completedNodeIds: [...server.completedNodeIds, ...local.completedNodeIds],
    attempts,
    unlockedRewards: [...server.unlockedRewards, ...local.unlockedRewards],
    updatedAt: Math.max(validNumber(server.updatedAt), validNumber(local.updatedAt)) || undefined,
  }, assignment);
};

export const mergeQuestProgressCollections = (
  serverValues: unknown,
  localValues: unknown,
  assignments: TopicAssignment[] = [],
): StudentQuestProgress[] => {
  const byKey = new Map<string, StudentQuestProgress>();
  const assignmentById = new Map((Array.isArray(assignments) ? assignments : []).map(item => [String(item.id), item]));
  [...(Array.isArray(serverValues) ? serverValues : []), ...(Array.isArray(localValues) ? localValues : [])]
    .forEach((raw: any) => {
      if (!raw?.studentId || !raw?.topicAssignmentId) return;
      const key = getQuestProgressKey(raw.studentId, raw.topicAssignmentId);
      const previous = byKey.get(key);
      const assignment = assignmentById.get(String(raw.topicAssignmentId));
      byKey.set(key, previous ? mergeQuestProgress(previous, raw, assignment) : deriveQuestProgress(raw, assignment));
    });
  return Array.from(byKey.values()).sort((a, b) =>
    String(a.studentId).localeCompare(String(b.studentId)) || String(a.topicAssignmentId).localeCompare(String(b.topicAssignmentId))
  );
};

const toMillis = (value?: string): number => {
  if (!value) return 0;
  const millis = new Date(value).getTime();
  return Number.isFinite(millis) ? millis : 0;
};

export const getQuestNodeState = (
  assignment: TopicAssignment,
  progressRaw: Partial<StudentQuestProgress> | null | undefined,
  nodeIndex: number,
  now = Date.now(),
): QuestNodeState => {
  const node = assignment.nodes[nodeIndex];
  if (!node) return "locked";
  const progress = deriveQuestProgress(progressRaw, assignment);
  const attempts = progress.attempts[node.id] || [];
  if (attempts.some(attempt => attempt.passed)) return "completed";

  const start = Math.max(toMillis(assignment.openDate), toMillis(node.openDate));
  const closes = [toMillis(assignment.closeDate), toMillis(node.closeDate)].filter(Boolean);
  const end = closes.length ? Math.min(...closes) : 0;
  if (start && now < start) return "scheduled";
  if (end && now > end) return "closed";

  if (nodeIndex > 0) {
    const priorNode = assignment.nodes[nodeIndex - 1];
    const priorAttempts = progress.attempts[priorNode.id] || [];
    if (!priorAttempts.some(attempt => attempt.passed)) return "locked";
  }
  return attempts.length ? "retry" : "available";
};

export const evaluateQuestRewards = (
  assignment: TopicAssignment,
  progressRaw: Partial<StudentQuestProgress> | null | undefined,
): RewardRule[] => {
  const progress = deriveQuestProgress(progressRaw, assignment);
  const completed = progress.completedNodeIds.filter(nodeId => assignment.nodes.some(node => node.id === nodeId)).length;
  return (assignment.rewards || []).filter(reward => {
    const target = Math.max(0, validNumber(reward.targetValue));
    if (reward.type === "milestone") return completed >= target;
    if (reward.type === "total_score") return progress.totalAccumulatedScore >= target;
    return progress.currentStreak >= target;
  });
};

export const getLatestQuestAttempt = (progressRaw: Partial<StudentQuestProgress> | null | undefined, nodeId: string): QuestAttempt | null => {
  const progress = deriveQuestProgress(progressRaw);
  const attempts = progress.attempts[String(nodeId)] || [];
  return attempts.length ? attempts[attempts.length - 1] : null;
};

export const parseQuestCoinReward = (value: unknown): number => {
  const match = String(value || "").replace(/[,\s]/g, "").match(/-?\d+(?:\.\d+)?/);
  return match ? Math.max(0, Math.floor(Number(match[0]) || 0)) : 0;
};
