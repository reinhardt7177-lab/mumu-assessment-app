import { z } from "zod";
import curriculum from "../data/achievement-standards.2022.json";
import { AppError } from "./assessment-domain";

export const curriculumLevelSchema = z.enum(["상", "중", "하", "판단 보류"]);
export type CurriculumLevel = z.infer<typeof curriculumLevelSchema>;

const subjectSchema = z.enum(["국어", "사회", "수학", "과학", "도덕", "영어"]);
const uuid = z.string().uuid();
const shortText = z.string().trim().min(1).max(80);
const description = z.string().trim().min(5).max(3000);

export const termInputSchema = z.object({
  classId: uuid.nullable().optional(),
  schoolYear: z.number().int().min(2022).max(2100),
  semester: z.union([z.literal(1), z.literal(2)]),
  grade: z.number().int().min(1).max(6),
  className: z.string().trim().min(1).max(50),
  subject: subjectSchema,
});
export type TermInput = z.infer<typeof termInputSchema>;

export const unitInputSchema = z.object({
  orderIndex: z.number().int().min(1).max(99),
  title: z.string().trim().min(2).max(120),
  standardCodes: z.array(z.string().trim().min(4).max(30)).min(1).max(10),
});
export type UnitInput = z.infer<typeof unitInputSchema>;

const rubricCriterionSchema = z.object({
  key: z.string().trim().min(1).max(64).regex(/^[a-z0-9][a-z0-9_-]*$/),
  name: shortText,
  description: z.string().trim().min(5).max(1000),
  high: z.string().trim().min(5).max(1000),
  middle: z.string().trim().min(5).max(1000),
  low: z.string().trim().min(5).max(1000),
});
export const rubricInputSchema = z.object({
  criteria: z.array(rubricCriterionSchema).min(1).max(10),
});
export type RubricInput = z.infer<typeof rubricInputSchema>;

export const studentInputSchema = z.object({
  studentRef: z.string().trim().min(1).max(80),
  displayName: z.string().trim().min(1).max(40),
});

export const assessmentEventInputSchema = z.object({
  assessmentId: uuid.optional(),
  eventType: z.enum(["initial", "formative", "reassessment", "observation", "conversation"]),
  title: z.string().trim().min(2).max(160),
  context: description,
  occurredAt: z.string().datetime({ offset: true }),
});

export const evidenceInputSchema = z.object({
  studentId: uuid,
  eventId: uuid,
  attemptId: uuid.optional(),
  modality: z.enum(["text", "photo", "speech", "observation", "chat", "multimodal"]),
  sourceKind: z.enum(["student_response", "handwritten_work", "recording", "teacher_observation", "chatbot_transcript", "mixed_response"]),
  assistanceLevel: z.enum(["independent", "teacher_prompt", "step_hint", "example", "scaffolded"]),
  originalText: z.string().trim().min(1).max(250000).optional(),
  sourceRef: z.string().trim().min(1).max(1000).optional(),
  transformedText: z.string().trim().min(1).max(50000).optional(),
  transformationStatus: z.enum(["original", "automated", "teacher_verified"]).default("original"),
  teacherVerified: z.boolean().default(false),
  collectedAt: z.string().datetime({ offset: true }),
  supersedesId: uuid.optional(),
}).superRefine((value, context) => {
  if (!value.originalText && !value.sourceRef) context.addIssue({ code: "custom", message: "원본 내용 또는 비공개 원본 참조가 필요합니다." });
  if (value.modality === "text" && !value.originalText) context.addIssue({ code: "custom", message: "글 응답은 원문을 저장해야 합니다." });
  if (value.teacherVerified !== (value.transformationStatus === "teacher_verified")) context.addIssue({ code: "custom", message: "교사 확인 상태가 일치하지 않습니다." });
});

export const judgementInputSchema = z.object({
  rubricCriterionId: uuid,
  level: curriculumLevelSchema,
  evidenceExcerpt: z.string().trim().min(1).max(3000),
  rationale: z.string().trim().min(5).max(5000),
  state: z.enum(["draft", "final"]),
});

export const aiSuggestionCompletionSchema = z.object({
  suggestedLevel: curriculumLevelSchema,
  confidence: z.number().min(0).max(1),
  evidenceExcerpt: z.string().trim().min(1).max(3000),
  rationale: z.string().trim().min(5).max(5000),
  uncertainty: z.string().trim().min(1).max(3000),
  missingEvidence: z.string().trim().min(1).max(3000),
  constructCaution: z.string().trim().min(1).max(3000),
  usage: z.object({
    inputTokens: z.number().int().min(0).optional(),
    outputTokens: z.number().int().min(0).optional(),
    totalTokens: z.number().int().min(0).optional(),
  }),
  latencyMs: z.number().int().min(0),
  providerMetadata: z.record(z.string(), z.unknown()).default({}),
});

export const aiSuggestionFailureSchema = z.object({
  errorCode: z.string().trim().min(1).max(80),
  errorMessage: z.string().trim().min(1).max(500),
  latencyMs: z.number().int().min(0),
});

export const feedbackInputSchema = z.object({
  studentId: uuid,
  unitStandardId: uuid,
  basisJudgementIds: z.array(uuid).min(1).max(30),
  strength: description,
  gapType: z.enum(["conceptual", "procedural", "communication"]),
  gapDescription: description,
  nextLearning: description,
});

export const interventionInputSchema = z.object({
  activity: description,
  supportLevel: z.enum(["teacher_prompt", "step_hint", "example", "scaffolded"]),
  teacherNote: z.string().trim().min(1).max(3000),
  occurredAt: z.string().datetime({ offset: true }),
});

export const reassessmentInputSchema = z.object({
  priorEvidenceId: uuid,
  newEvidenceId: uuid,
  independent: z.boolean(),
});

export const semesterJudgementInputSchema = z.object({
  studentId: uuid,
  standardCode: z.string().trim().min(4).max(30),
  level: curriculumLevelSchema,
  rationale: z.string().trim().min(5).max(5000),
  state: z.enum(["draft", "final"]),
  evidenceIds: z.array(uuid).max(50),
  conflictingEvidenceIds: z.array(uuid).max(20).default([]),
}).superRefine((value, context) => {
  const all = [...value.evidenceIds, ...value.conflictingEvidenceIds];
  if (new Set(all).size !== all.length) context.addIssue({ code: "custom", message: "같은 수행 증거를 중복 선택할 수 없습니다." });
  if (value.level !== "판단 보류" && value.state === "final" && value.evidenceIds.length < 2) {
    context.addIssue({ code: "custom", message: "학기말 최종 판단에는 서로 다른 수행 증거가 2개 이상 필요합니다." });
  }
});

export function parseInput<T>(schema: z.ZodType<T>, input: unknown, message: string): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new AppError(400, message);
  return parsed.data;
}

export function validateTerm(input: unknown) {
  const value = parseInput(termInputSchema, input, "학년도·학기·학년·학급·교과를 확인해 주세요.");
  const allowed = value.grade < 3 ? ["국어", "수학"] : ["국어", "사회", "수학", "과학", "도덕", "영어"];
  if (!allowed.includes(value.subject)) throw new AppError(400, "선택한 초등 학년에 편성되는 교과인지 확인해 주세요.");
  return value;
}

export function validateUnit(input: unknown, term: Pick<TermInput, "grade" | "subject">) {
  const value = parseInput(unitInputSchema, input, "단원명·순서·성취기준을 확인해 주세요.");
  if (new Set(value.standardCodes).size !== value.standardCodes.length) throw new AppError(400, "성취기준이 중복되었습니다.");
  const band = term.grade <= 2 ? "1~2학년" : term.grade <= 4 ? "3~4학년" : "5~6학년";
  const standards = curriculum.standards.filter(item => item.subject === term.subject && item.gradeBand === band && value.standardCodes.includes(item.code));
  if (standards.length !== value.standardCodes.length) throw new AppError(400, "학년군과 교과에 맞는 초등 성취기준을 선택해 주세요.");
  const byCode = new Map(standards.map(item => [item.code, item]));
  return { ...value, standards: value.standardCodes.map(code => byCode.get(code)!) };
}

export function validateRubric(input: unknown) {
  const value = parseInput(rubricInputSchema, input, "평가 요소와 상·중·하 수행 기술문을 확인해 주세요.");
  if (new Set(value.criteria.map(item => item.key)).size !== value.criteria.length || new Set(value.criteria.map(item => item.name)).size !== value.criteria.length) {
    throw new AppError(400, "루브릭 평가 요소의 이름과 키는 중복할 수 없습니다.");
  }
  const vague = /^(잘함|보통|부족함?|미흡|못함|우수|양호)[.!]?$/;
  if (value.criteria.some(item => new Set([item.high, item.middle, item.low]).size !== 3 || [item.high, item.middle, item.low].some(text => vague.test(text)))) {
    throw new AppError(400, "수준은 ‘잘함/보통/부족’이 아니라 결과물에서 관찰되는 질적 차이로 작성해 주세요.");
  }
  return value;
}
