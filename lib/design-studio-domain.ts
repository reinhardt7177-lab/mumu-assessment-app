import { z } from "zod";
import curriculum from "../data/achievement-standards.2022.json";
import { AppError, validateAssessment, type AssessmentDefinition } from "./assessment-domain";

export const elementarySubjectSchema = z.enum(["국어", "사회", "수학", "과학", "도덕", "영어"]);
export const designSourceSchema = z.object({
  kind: z.enum(["direct_text", "upload"]),
  fileName: z.string().trim().max(240).nullable().optional(),
  mimeType: z.string().trim().max(160).nullable().optional(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable().optional(),
  text: z.string().trim().min(5).max(50000),
});
export const designSessionCreateSchema = z.object({
  title: z.string().trim().min(2).max(120),
  grade: z.number().int().min(1).max(6),
  subject: elementarySubjectSchema,
  learningGoal: z.string().trim().min(5).max(1000),
  source: designSourceSchema,
});

export const alignmentCandidateSchema = z.object({
  code: z.string().trim().min(4).max(30),
  domain: z.string().trim().min(1).max(200),
  content: z.string().trim().min(5).max(2000),
  rationale: z.string().trim().min(5).max(1000),
  confidence: z.number().min(0).max(1),
  state: z.enum(["suggested", "selected", "rejected"]),
});

export const successCriterionSchema = z.object({
  id: z.string().trim().min(1).max(64).regex(/^[a-z0-9][a-z0-9_-]*$/),
  name: z.string().trim().min(1).max(80),
  evidence: z.string().trim().min(5).max(600),
  standardCode: z.string().trim().min(4).max(30),
});
export const competencyUnpackSchema = z.object({
  bigIdea: z.string().trim().min(5).max(1000),
  observableIndicators: z.array(z.string().trim().min(5).max(500)).min(1).max(10),
  prerequisites: z.array(z.string().trim().min(2).max(500)).max(10),
  misconceptions: z.array(z.string().trim().min(2).max(500)).max(10),
  successCriteria: z.array(successCriterionSchema).min(1).max(10),
});

export const rubricDraftItemSchema = z.object({
  id: z.string().trim().min(1).max(64).regex(/^[a-z0-9][a-z0-9_-]*$/),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(5).max(1000),
  standardCode: z.string().trim().min(4).max(30),
  high: z.string().trim().min(5).max(1000),
  middle: z.string().trim().min(5).max(1000),
  low: z.string().trim().min(5).max(1000),
});
export const rubricDraftSchema = z.object({ rubric: z.array(rubricDraftItemSchema).min(1).max(10) });

export const questionDraftSchema = z.object({
  id: z.string().trim().min(1).max(64).regex(/^[a-z0-9][a-z0-9_-]*$/),
  prompt: z.string().trim().min(5).max(2000),
  kind: z.enum(["서술형", "선택형"]),
  standardCode: z.string().trim().min(4).max(30),
  criterion: z.string().trim().min(1).max(80),
  points: z.number().int().min(1).max(100),
  evidenceExpected: z.string().trim().min(5).max(1000),
});
export const assessmentDraftSchema = z.object({ questions: z.array(questionDraftSchema).min(1).max(20) });

export const validityThreatSchema = z.object({
  severity: z.enum(["major", "moderate", "minor"]),
  issue: z.string().trim().min(5).max(1000),
  recommendation: z.string().trim().min(5).max(1000),
});
export const validityAuditSchema = z.object({
  overall: z.enum(["적합", "보완 후 적합", "재설계 필요"]),
  fitForPurpose: z.boolean(),
  blocked: z.boolean(),
  constructValidity: z.string().trim().min(5).max(2000),
  reliability: z.string().trim().min(5).max(2000),
  consequentialValidity: z.string().trim().min(5).max(2000),
  threats: z.array(validityThreatSchema).max(12),
  recommendations: z.array(z.string().trim().min(5).max(1000)).max(12),
});

export const designDraftPatchSchema = z.object({
  title: z.string().trim().min(2).max(120).optional(),
  learningGoal: z.string().trim().min(5).max(1000).optional(),
  currentStep: z.number().int().min(1).max(7).optional(),
  source: designSourceSchema.optional(),
  standards: z.array(alignmentCandidateSchema).min(1).max(8).optional(),
  competency: competencyUnpackSchema.optional(),
  rubric: z.array(rubricDraftItemSchema).min(1).max(10).optional(),
  questions: z.array(questionDraftSchema).min(1).max(20).optional(),
  validity: validityAuditSchema.optional(),
}).refine(value => Object.keys(value).length > 0);

export type AlignmentCandidate = z.infer<typeof alignmentCandidateSchema>;
export type CompetencyUnpack = z.infer<typeof competencyUnpackSchema>;
export type RubricDraftItem = z.infer<typeof rubricDraftItemSchema>;
export type QuestionDraft = z.infer<typeof questionDraftSchema>;
export type ValidityAudit = z.infer<typeof validityAuditSchema>;
export type DesignSessionCreate = z.infer<typeof designSessionCreateSchema>;
export type DraftSource = "ai" | "teacher" | "basic_draft";
export type DesignFeature = "competency_unpack" | "rubric_generation" | "assessment_generation" | "validity_audit";

export type DesignSessionRecord = {
  id: string;
  ownerId: string;
  title: string;
  grade: number;
  subject: z.infer<typeof elementarySubjectSchema>;
  learningGoal: string;
  status: "draft" | "ready" | "approved";
  currentStep: number;
  approvedAssessmentId: string | null;
  createdAt: string;
  updatedAt: string;
  source: null | { id: string; kind: "direct_text" | "upload"; fileName: string | null; mimeType: string | null; sha256: string | null; text: string };
  standards: AlignmentCandidate[];
  competency: CompetencyUnpack | null;
  blueprint: null | { rubric: RubricDraftItem[]; questions: QuestionDraft[]; methods: AssessmentDefinition["methods"]; grading: AssessmentDefinition["grading"] };
  validity: ValidityAudit | null;
};

const gradeBand = (grade: number) => grade <= 2 ? "1~2학년" : grade <= 4 ? "3~4학년" : "5~6학년";
const keywordTokens = (text: string) => [...new Set(text.toLowerCase().match(/[가-힣a-z0-9]{2,}/g) ?? [])];

export function suggestAlignedStandards(input: { grade: number; subject: string; learningGoal: string; sourceText: string }) {
  const tokens = keywordTokens(`${input.learningGoal} ${input.sourceText}`).filter(token => !/[0-9]+학년|학생|학습|수업|평가/.test(token));
  return curriculum.standards
    .filter(standard => standard.subject === input.subject && standard.gradeBand === gradeBand(input.grade))
    .map(standard => {
      const haystack = `${standard.domain} ${standard.content}`.toLowerCase();
      const matches = tokens.filter(token => haystack.includes(token));
      const exactCode = input.sourceText.includes(standard.code) ? 8 : 0;
      const score = exactCode + matches.length;
      return { standard, matches, score };
    })
    .sort((a, b) => b.score - a.score || a.standard.code.localeCompare(b.standard.code, "ko"))
    .slice(0, 6)
    .map(({ standard, matches, score }, index) => ({
      code: standard.code,
      domain: standard.domain,
      content: standard.content,
      rationale: score > 0 ? `자료의 핵심어 ${matches.slice(0, 3).join("·") || "성취기준 코드"}와 연결됩니다.` : "같은 학년군·교과의 성취기준 후보입니다. 교사가 적합성을 확인해 주세요.",
      confidence: Math.min(.96, Math.max(.35, .42 + score * .08 - index * .02)),
      state: index < 2 ? "selected" as const : "suggested" as const,
    }));
}

export function verifyAlignmentCandidates(grade: number, subject: string, candidates: AlignmentCandidate[]) {
  const available = new Map(curriculum.standards
    .filter(item => item.subject === subject && item.gradeBand === gradeBand(grade))
    .map(item => [item.code, item]));
  const parsed = alignmentCandidateSchema.array().min(1).max(8).parse(candidates);
  if (new Set(parsed.map(item => item.code)).size !== parsed.length || parsed.some(item => {
    const source = available.get(item.code);
    return !source || source.domain !== item.domain || source.content !== item.content;
  })) throw new AppError(400, "선택한 학년군·교과에 맞는 공식 성취기준인지 확인해 주세요.");
  if (!parsed.some(item => item.state === "selected")) throw new AppError(400, "평가할 성취기준을 한 개 이상 선택해 주세요.");
  if (parsed.filter(item => item.state === "selected").length > 5) throw new AppError(400, "한 평가에는 성취기준을 최대 5개까지 선택해 주세요.");
  return parsed;
}

export function basicCompetencyDraft(session: Pick<DesignSessionRecord, "learningGoal" | "standards">): CompetencyUnpack {
  const selected = session.standards.filter(item => item.state === "selected");
  const criterionNames = ["개념 이해", "근거 제시", "논리적 설명", "적용과 연결", "비교와 판단"];
  return {
    bigIdea: session.learningGoal,
    observableIndicators: selected.map(item => `${item.domain}의 핵심 내용을 자신의 말과 근거로 설명한다.`),
    prerequisites: ["문항의 핵심 낱말과 요구 행동을 확인한다.", "관련 개념을 구체적인 예와 연결한다."],
    misconceptions: ["관련 낱말을 나열하는 것을 충분한 설명으로 생각할 수 있다."],
    successCriteria: selected.slice(0, 5).map((item, index) => ({ id: `criterion-${index + 1}`, name: criterionNames[index], evidence: `${item.content}에 관한 이해가 학생의 설명과 근거에서 관찰된다.`, standardCode: item.code })),
  };
}

export function basicRubricDraft(competency: CompetencyUnpack): RubricDraftItem[] {
  return competency.successCriteria.map((criterion, index) => ({
    id: criterion.id || `criterion-${index + 1}`,
    name: criterion.name,
    description: criterion.evidence,
    standardCode: criterion.standardCode,
    high: `${criterion.name}을 정확한 개념과 구체적인 근거를 연결하여 스스로 설명한다.`,
    middle: `${criterion.name}의 핵심을 설명하고 근거를 제시하지만 일부 연결은 보완이 필요하다.`,
    low: `${criterion.name}과 관련된 내용을 부분적으로 표현하며 설명을 완성하려면 안내가 필요하다.`,
  }));
}

export function basicQuestionDraft(rubric: RubricDraftItem[]): QuestionDraft[] {
  return rubric.slice(0, 5).map((criterion, index) => ({
    id: `question-${index + 1}`,
    prompt: `${criterion.name}이 드러나도록 배운 내용을 구체적인 예나 근거와 함께 설명하세요.`,
    kind: "서술형",
    standardCode: criterion.standardCode,
    criterion: criterion.name,
    points: 10,
    evidenceExpected: criterion.description,
  }));
}

export function runDeterministicValidityAudit(input: Pick<DesignSessionRecord, "learningGoal" | "standards"> & { rubric: RubricDraftItem[]; questions: QuestionDraft[] }): ValidityAudit {
  const selectedCodes = new Set(input.standards.filter(item => item.state === "selected").map(item => item.code));
  const questionCodes = new Set(input.questions.map(item => item.standardCode));
  const criterionNames = new Set(input.rubric.map(item => item.name));
  const threats: ValidityAudit["threats"] = [];
  for (const code of selectedCodes) if (!questionCodes.has(code)) threats.push({ severity: "major", issue: `${code} 성취기준을 확인할 문항이 없습니다.`, recommendation: "해당 성취기준의 관찰 가능한 수행을 요구하는 문항을 추가하세요." });
  if (input.questions.some(item => !criterionNames.has(item.criterion))) threats.push({ severity: "major", issue: "일부 문항이 루브릭 기준과 연결되지 않았습니다.", recommendation: "각 문항에 하나의 명확한 루브릭 기준을 연결하세요." });
  if (input.rubric.some(item => new Set([item.high, item.middle, item.low]).size < 3)) threats.push({ severity: "major", issue: "수준별 루브릭 서술이 구분되지 않는 기준이 있습니다.", recommendation: "상·중·하를 양의 차이가 아니라 수행의 질적 차이로 다시 서술하세요." });
  if (input.questions.every(item => item.kind === "선택형")) threats.push({ severity: "moderate", issue: "선택형만으로는 학생의 설명 과정과 근거를 충분히 확인하기 어렵습니다.", recommendation: "서술형 문항을 포함해 생각의 과정과 근거를 직접 수합하세요." });
  if (input.questions.length < 2 && selectedCodes.size > 1) threats.push({ severity: "moderate", issue: "넓은 학습 목표에 비해 증거를 수합할 문항 수가 적습니다.", recommendation: "성취기준별로 독립적인 증거가 드러나도록 문항을 보완하세요." });
  const blocked = threats.some(item => item.severity === "major");
  return {
    overall: blocked ? "재설계 필요" : threats.length ? "보완 후 적합" : "적합",
    fitForPurpose: !blocked,
    blocked,
    constructValidity: blocked ? "학습 목표, 성취기준, 루브릭, 문항 사이의 연결에 중대한 누락이 있습니다." : "문항이 선택한 성취기준과 관찰 가능한 성공 기준에 연결되어 있습니다.",
    reliability: "상·중·하의 서술을 실제 학생 답안 예시와 함께 교사 간 사전 조율하면 판단 일관성을 높일 수 있습니다.",
    consequentialValidity: "점수만 제시하지 않고 강점·보완점·다음 학습을 함께 제공하는 형성평가 용도로 사용하는 것이 적절합니다.",
    threats,
    recommendations: threats.length ? threats.map(item => item.recommendation) : ["실제 학생 답안 2~3개로 루브릭을 사전 적용해 문구를 보정하세요."],
  };
}

export function toAssessmentDefinition(session: DesignSessionRecord): AssessmentDefinition {
  if (!session.blueprint) throw new AppError(409, "먼저 루브릭과 평가 문항을 완성해 주세요.");
  const selected = session.standards.filter(item => item.state === "selected");
  if (!selected.length) throw new AppError(409, "평가할 성취기준을 한 개 이상 선택해 주세요.");
  if (!session.validity || session.validity.blocked) throw new AppError(409, "중대한 타당도 경고를 해결한 뒤 다시 점검해 주세요.");
  return validateAssessment({
    title: session.title,
    subject: `${session.grade}학년 ${session.subject}`,
    learningGoal: session.learningGoal,
    type: "독립 수행평가",
    standardCodes: selected.map(item => item.code),
    methods: ["text"],
    grading: session.blueprint.grading,
    rubric: session.blueprint.rubric.map(item => ({ name: item.name, standardCode: item.standardCode, high: item.high, middle: item.middle, low: item.low })),
    questions: session.blueprint.questions.map(item => ({ id: item.id, prompt: item.prompt, kind: item.kind, standardCode: item.standardCode, criterion: item.criterion, points: item.points })),
  });
}
