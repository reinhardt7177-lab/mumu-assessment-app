import "server-only";
import { neon } from "@neondatabase/serverless";
import { AppError } from "../lib/assessment-domain";
import { createAssessmentRepository, type Query } from "./repository";

export function databaseConfigured() { return Boolean(process.env.DATABASE_URL); }

let repository: ReturnType<typeof createAssessmentRepository> | undefined;
export function getRepository() {
  if (!repository) {
    if (!process.env.DATABASE_URL) throw new AppError(503, "저장소 연결 준비 중입니다. 아직 실제 평가를 제출할 수 없습니다.");
    const sql = neon(process.env.DATABASE_URL);
    const query: Query = async (text, parameters = []) => await sql.query(text, parameters) as never;
    repository = createAssessmentRepository(query);
  }
  return repository;
}
