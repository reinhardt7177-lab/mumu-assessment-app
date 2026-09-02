import { z } from "zod";
import { AppError } from "./assessment-domain";

const uuid = z.string().uuid();

export const classroomInputSchema = z.object({
  schoolId: uuid.nullable().optional(),
  schoolYear: z.number().int().min(2022).max(2100),
  grade: z.number().int().min(1).max(6),
  name: z.string().trim().min(1).max(50),
}).strict();

export const classStudentInputSchema = z.object({
  studentRef: z.string().trim().min(1).max(80),
  displayName: z.string().trim().min(1).max(40),
}).strict();

export const classRosterInputSchema = z.object({
  students: z.array(classStudentInputSchema).min(1).max(100),
}).strict().superRefine((value, context) => {
  const refs = value.students.map(student => student.studentRef);
  if (new Set(refs).size !== refs.length) context.addIssue({ code: "custom", message: "학생 참조 번호가 중복되었습니다." });
});

export const classStudentUpdateSchema = classStudentInputSchema.extend({
  active: z.boolean(),
}).strict();

export const distributionInputSchema = z.object({
  assessmentId: uuid,
  classId: uuid,
  instructions: z.string().trim().max(2000).default(""),
  closesAt: z.string().datetime({ offset: true }).nullable().optional(),
}).strict();

export type ClassroomInput = z.infer<typeof classroomInputSchema>;
export type ClassStudentInput = z.infer<typeof classStudentInputSchema>;
export type DistributionInput = z.infer<typeof distributionInputSchema>;

function parse<T>(schema: z.ZodType<T>, input: unknown, message: string) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new AppError(400, parsed.error.issues[0]?.message || message);
  return parsed.data;
}

export const validateClassroom = (input: unknown) => parse(classroomInputSchema, input, "학년도·학년·학급명을 확인해 주세요.");
export const validateClassRoster = (input: unknown) => parse(classRosterInputSchema, input, "학생 참조 번호와 표시 이름을 확인해 주세요.");
export const validateClassStudentUpdate = (input: unknown) => parse(classStudentUpdateSchema, input, "학생 정보를 확인해 주세요.");
export const validateDistribution = (input: unknown) => parse(distributionInputSchema, input, "평가·학급·마감 정보를 확인해 주세요.");
