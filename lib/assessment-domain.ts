import { z } from "zod";
import curriculum from "../data/achievement-standards.2022.json";

export class AppError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const questionSchema = z.object({
  id: z.string().min(1).max(64).regex(/^[\w-]+$/),
  prompt: z.string().trim().min(5).max(2000),
  kind: z.enum(["서술형", "선택형", "말하기"]),
  standardCode: z.string().min(4).max(30),
  criterion: z.string().trim().min(1).max(80),
  rubricCriterionId: z.string().uuid().optional(),
  points: z.number().int().min(1).max(100),
});

export const assessmentSchema = z.object({
  title: z.string().trim().min(2).max(120),
  subject: z.string().regex(/^[1-6]학년 (국어|사회|수학|과학|도덕|영어)$/),
  learningGoal: z.string().trim().min(5).max(1000),
  type: z.enum(["독립 수행평가", "지원형 형성평가"]),
  standardCodes: z.array(z.string()).min(1).max(5),
  questions: z.array(questionSchema).min(1).max(20),
  methods: z.array(z.enum(["text", "photo", "speech", "chat"])).min(1).max(4),
  rubric: z.array(z.object({
    name: z.string().trim().min(1).max(80),
    standardCode: z.string().min(4).max(30).optional(),
    rubricCriterionId: z.string().uuid().optional(),
    high: z.string().trim().min(5).max(500),
    middle: z.string().trim().min(5).max(500),
    low: z.string().trim().min(5).max(500),
  })).min(1).max(10),
  grading: z.object({
    upperThreshold: z.number().int().min(2).max(100),
    middleThreshold: z.number().int().min(1).max(99),
  }).refine(value => value.upperThreshold > value.middleThreshold),
});

export type AssessmentDefinition = z.infer<typeof assessmentSchema>;
export const curriculumAssessmentLinkSchema = z.object({
  unitId: z.string().uuid(),
  eventType: z.enum(["initial", "formative", "reassessment"]),
  context: z.string().trim().min(5).max(3000),
  occurredAt: z.string().datetime(),
});
export type CurriculumAssessmentLinkInput = z.infer<typeof curriculumAssessmentLinkSchema>;
export type AssessmentCreateInput = { definition: AssessmentDefinition; curriculumLink: CurriculumAssessmentLinkInput | null };
export type AssessmentQuestion = z.infer<typeof questionSchema>;
export type AssessmentRecord = {
  id: string; ownerId: string; shareCode: string; status: "draft" | "published" | "closed";
  definition: AssessmentDefinition; version: number; createdAt: string;
  curriculumLink: { eventId: string; termId: string; unitId: string; unitTitle: string } | null;
  distribution: null | {
    id: string; classId: string; className: string; schoolYear: number; grade: number;
    instructions: string; closesAt: string | null; totalStudents: number;
  };
  submittedCount: number; pendingCount: number;
};
export type Answers = Record<string, string>;
export type AttemptRecord = {
  id: string; assessmentId: string; studentLabel: string; answers: Answers;
  revision: number; status: "in_progress" | "submitted"; timeSpentSeconds: number;
  curriculumStudentId: string | null;
  distributionId: string | null; classStudentId: string | null;
  savedAt: string; submittedAt: string | null;
};
export type ReviewRecord = {
  attemptId: string; questionScores: { questionId: string; points: number; reason: string }[];
  feedback: string; total: number; maxTotal: number; level: "상" | "중" | "하";
  state: "draft" | "final" | "published"; updatedAt: string;
};

export function validateAssessment(input: unknown): AssessmentDefinition {
  const parsed = assessmentSchema.safeParse(input);
  if (!parsed.success) throw new AppError(400, "평가 제목·문항·성취기준·수준별 루브릭을 모두 확인해 주세요.");
  const value = parsed.data;
  const [gradeLabel, subject] = value.subject.split(" ");
  const grade = Number(gradeLabel[0]);
  const band = grade <= 2 ? "1~2학년" : grade <= 4 ? "3~4학년" : "5~6학년";
  const valid = new Set(curriculum.standards.filter(s => s.subject === subject && s.gradeBand === band).map(s => s.code));
  if (new Set(value.standardCodes).size !== value.standardCodes.length || value.standardCodes.some(code => !valid.has(code))) {
    throw new AppError(400, "선택한 초등 학년군·교과에 맞는 성취기준을 선택해 주세요.");
  }
  if (new Set(value.questions.map(q => q.id)).size !== value.questions.length) throw new AppError(400, "문항 번호가 중복되었습니다.");
  const rubricKeys = value.rubric.map(r => r.rubricCriterionId ?? `${r.standardCode ?? "*"}:${r.name}`);
  if (new Set(rubricKeys).size !== rubricKeys.length) throw new AppError(400, "루브릭 기준 연결이 중복되었습니다.");
  if (value.rubric.some(r => r.standardCode && !value.standardCodes.includes(r.standardCode))) throw new AppError(400, "루브릭의 성취기준 연결을 확인해 주세요.");
  if (value.questions.some(q => !value.standardCodes.includes(q.standardCode) || !value.rubric.some(r =>
    q.rubricCriterionId ? r.rubricCriterionId === q.rubricCriterionId && (!r.standardCode || r.standardCode === q.standardCode) : r.name === q.criterion && (!r.standardCode || r.standardCode === q.standardCode)))) {
    throw new AppError(400, "모든 문항에 성취기준과 루브릭 기준을 연결해 주세요.");
  }
  return value;
}

export function validateAssessmentCreate(input: unknown): AssessmentCreateInput {
  if (input && typeof input === "object" && "definition" in input) {
    const parsed = z.object({ definition: z.unknown(), curriculumLink: curriculumAssessmentLinkSchema.nullable().optional() }).strict().safeParse(input);
    if (!parsed.success) throw new AppError(400, "평가와 단원 연결 정보를 확인해 주세요.");
    return { definition: validateAssessment(parsed.data.definition), curriculumLink: parsed.data.curriculumLink ?? null };
  }
  return { definition: validateAssessment(input), curriculumLink: null };
}

export function validateAnswers(input: unknown, definition: AssessmentDefinition, complete = false): Answers {
  const parsed = z.record(z.string(), z.string().max(10000)).safeParse(input);
  if (!parsed.success) throw new AppError(400, "답안 형식을 확인해 주세요. 문항당 최대 10,000자입니다.");
  const questionIds = new Set(definition.questions.map(q => q.id));
  if (Object.keys(parsed.data).some(id => !questionIds.has(id))) throw new AppError(400, "이 평가에 없는 문항입니다.");
  if (complete && definition.questions.some(q => !parsed.data[q.id]?.trim())) throw new AppError(400, "모든 문항에 답한 뒤 제출해 주세요.");
  return parsed.data;
}

export const reviewInputSchema = z.object({
  questionScores: z.array(z.object({ questionId: z.string(), points: z.number().min(0), reason: z.string().trim().min(1).max(1000) })).min(1).max(20),
  feedback: z.string().trim().min(1).max(3000),
  state: z.enum(["draft", "final", "published"]),
});

export function validateReview(input: unknown, definition: AssessmentDefinition) {
  const parsed = reviewInputSchema.safeParse(input);
  if (!parsed.success) throw new AppError(400, "문항별 점수·판단 근거·피드백을 입력해 주세요.");
  const { questionScores } = parsed.data;
  if (questionScores.length !== definition.questions.length || new Set(questionScores.map(s => s.questionId)).size !== questionScores.length || questionScores.some(s => {
    const q = definition.questions.find(q => q.id === s.questionId);
    return !q || s.points > q.points;
  })) throw new AppError(400, "모든 문항의 배점 범위 안에서 한 번씩 평가해 주세요.");
  const total = Math.round(questionScores.reduce((sum, s) => sum + s.points, 0) * 10) / 10;
  const maxTotal = definition.questions.reduce((sum, q) => sum + q.points, 0);
  const percentage = total / maxTotal * 100;
  const level: ReviewRecord["level"] = percentage >= definition.grading.upperThreshold ? "상" : percentage >= definition.grading.middleThreshold ? "중" : "하";
  return { ...parsed.data, total, maxTotal, level };
}
