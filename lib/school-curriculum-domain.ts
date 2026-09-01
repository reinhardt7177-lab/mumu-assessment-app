import { z } from "zod";
import curriculum from "../data/achievement-standards.2022.json";
import { AppError } from "./assessment-domain";

const subjectSchema = z.enum(["국어", "사회", "수학", "과학", "도덕", "영어"]);
const uuid = z.string().uuid();

export const schoolInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  region: z.string().trim().max(120).default(""),
  schoolCode: z.string().trim().min(1).max(40).optional(),
}).strict();

export const sourceDocumentSchema = z.object({
  name: z.string().trim().min(1).max(200),
  mimeType: z.string().trim().min(1).max(150),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  documentKind: z.enum(["school", "grade"]),
  extractedAt: z.string().datetime(),
  detectedStandardCount: z.number().int().min(0).max(1000),
});

const schoolEventSchema = z.object({
  name: z.string().trim().min(1).max(160),
  note: z.string().trim().max(500).default(""),
});

export const schoolBasicsSchema = z.object({
  vision: z.string().trim().max(3000).default(""),
  focusAreas: z.array(z.string().trim().min(1).max(300)).max(30).default([]),
  assessmentPolicy: z.string().trim().max(5000).default(""),
  schoolEvents: z.array(schoolEventSchema).max(100).default([]),
});

export const gradePlanUnitSchema = z.object({
  key: uuid,
  orderIndex: z.number().int().min(1).max(99),
  title: z.string().trim().min(2).max(120),
  standardCodes: z.array(z.string().trim().min(4).max(30)).max(20),
  plannedPeriod: z.string().trim().max(120).default(""),
  teachingHours: z.number().int().min(0).max(300).nullable().default(null),
  assessmentTiming: z.string().trim().max(160).default(""),
  assessmentMethods: z.array(z.enum(["text", "photo", "speech", "chat", "observation"])).max(5).default(["text"]),
  assessmentFocus: z.string().trim().max(2000).default(""),
});

export const gradePlanTemplateSchema = z.object({
  key: uuid,
  grade: z.number().int().min(1).max(6),
  semester: z.union([z.literal(1), z.literal(2)]),
  subject: subjectSchema,
  notes: z.string().trim().max(3000).default(""),
  units: z.array(gradePlanUnitSchema).max(99),
});

export const schoolPlanInputSchema = z.object({
  schoolId: uuid,
  schoolYear: z.number().int().min(2022).max(2100),
  state: z.enum(["draft", "approved"]),
  schoolBasics: schoolBasicsSchema,
  gradeTemplates: z.array(gradePlanTemplateSchema).max(100),
  sourceDocuments: z.array(sourceDocumentSchema).max(100),
}).strict().superRefine((value, context) => {
  const templateKeys = value.gradeTemplates.map(item => item.key);
  if (new Set(templateKeys).size !== templateKeys.length) context.addIssue({ code: "custom", message: "학년 계획 키가 중복되었습니다." });
  const templateScopes = value.gradeTemplates.map(item => `${item.grade}:${item.semester}:${item.subject}`);
  if (new Set(templateScopes).size !== templateScopes.length) context.addIssue({ code: "custom", message: "같은 학년·학기·교과 계획이 중복되었습니다." });
  for (const template of value.gradeTemplates) {
    const allowed = template.grade < 3 ? ["국어", "수학"] : ["국어", "사회", "수학", "과학", "도덕", "영어"];
    if (!allowed.includes(template.subject)) context.addIssue({ code: "custom", message: `${template.grade}학년에 편성되지 않는 교과가 포함되었습니다.` });
    const unitOrders = template.units.map(unit => unit.orderIndex);
    const unitTitles = template.units.map(unit => unit.title);
    if (new Set(unitOrders).size !== unitOrders.length || new Set(unitTitles).size !== unitTitles.length) {
      context.addIssue({ code: "custom", message: "같은 계획 안의 단원 순서와 이름은 중복할 수 없습니다." });
    }
    const band = template.grade <= 2 ? "1~2학년" : template.grade <= 4 ? "3~4학년" : "5~6학년";
    for (const unit of template.units) {
      if (new Set(unit.standardCodes).size !== unit.standardCodes.length) context.addIssue({ code: "custom", message: `${unit.title}의 성취기준이 중복되었습니다.` });
      const matched = curriculum.standards.filter(item => item.gradeBand === band && item.subject === template.subject && unit.standardCodes.includes(item.code));
      if (matched.length !== unit.standardCodes.length) context.addIssue({ code: "custom", message: `${unit.title}에 학년군·교과와 맞지 않는 성취기준이 있습니다.` });
      if (value.state === "approved" && unit.standardCodes.length === 0) context.addIssue({ code: "custom", message: `${unit.title}에 성취기준을 하나 이상 연결해 주세요.` });
    }
    if (value.state === "approved" && template.units.length === 0) context.addIssue({ code: "custom", message: `${template.grade}학년 ${template.subject} 계획에 단원을 하나 이상 넣어 주세요.` });
  }
  if (value.state === "approved" && value.gradeTemplates.length === 0) context.addIssue({ code: "custom", message: "확정할 학년·교과 계획이 필요합니다." });
});

export const curriculumImportContextSchema = z.object({
  documentKind: z.enum(["school", "grade"]),
  schoolYear: z.coerce.number().int().min(2022).max(2100),
  grade: z.coerce.number().int().min(1).max(6),
  semester: z.coerce.number().int().min(1).max(2).transform(value => value as 1 | 2),
  subject: subjectSchema,
}).strict();

export const applySchoolPlanSchema = z.object({
  templateKey: uuid,
  className: z.string().trim().min(1).max(50),
}).strict();

export type SchoolInput = z.infer<typeof schoolInputSchema>;
export type SchoolBasics = z.infer<typeof schoolBasicsSchema>;
export type SourceDocument = z.infer<typeof sourceDocumentSchema>;
export type GradePlanUnit = z.infer<typeof gradePlanUnitSchema>;
export type GradePlanTemplate = z.infer<typeof gradePlanTemplateSchema>;
export type SchoolPlanInput = z.infer<typeof schoolPlanInputSchema>;
export type CurriculumImportContext = z.infer<typeof curriculumImportContextSchema>;

export function validateSchool(input: unknown) {
  const parsed = schoolInputSchema.safeParse(input);
  if (!parsed.success) throw new AppError(400, "학교명·지역·학교 코드를 확인해 주세요.");
  return parsed.data;
}

export function validateSchoolPlan(input: unknown) {
  const parsed = schoolPlanInputSchema.safeParse(input);
  if (!parsed.success) throw new AppError(400, parsed.error.issues[0]?.message || "학교 교육과정 계획을 확인해 주세요.");
  return parsed.data;
}

export function validateImportContext(input: unknown) {
  const parsed = curriculumImportContextSchema.safeParse(input);
  if (!parsed.success) throw new AppError(400, "문서 종류와 학년도·학년·학기·교과를 확인해 주세요.");
  return parsed.data;
}

export function validateApplySchoolPlan(input: unknown) {
  const parsed = applySchoolPlanSchema.safeParse(input);
  if (!parsed.success) throw new AppError(400, "적용할 학년 계획과 학급명을 확인해 주세요.");
  return parsed.data;
}
