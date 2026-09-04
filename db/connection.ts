import "server-only";
import { neon } from "@neondatabase/serverless";
import { AppError } from "../lib/assessment-domain";
import { createClassroomRepository } from "./classroom-repository";
import { createDesignStudioRepository } from "./design-studio-repository";
import { createGrowthRepository } from "./growth-repository";
import { createAssessmentRepository, type Query } from "./repository";

export function databaseConfigured() { return Boolean(process.env.DATABASE_URL); }

let repository: ReturnType<typeof createAssessmentRepository> | undefined;
let growthRepository: ReturnType<typeof createGrowthRepository> | undefined;
let classroomRepository: ReturnType<typeof createClassroomRepository> | undefined;
let designStudioRepository: ReturnType<typeof createDesignStudioRepository> | undefined;
let sharedQuery: Query | undefined;

function getQuery() {
  if (!sharedQuery) {
    if (!process.env.DATABASE_URL) throw new AppError(503, "저장소 연결 준비 중입니다. 아직 실제 평가를 제출할 수 없습니다.");
    const sql = neon(process.env.DATABASE_URL);
    sharedQuery = async (text, parameters = []) => await sql.query(text, parameters) as never;
  }
  return sharedQuery;
}

export function getRepository() {
  if (!repository) {
    repository = createAssessmentRepository(getQuery());
  }
  return repository;
}

export function getGrowthRepository() {
  if (!growthRepository) growthRepository = createGrowthRepository(getQuery());
  return growthRepository;
}

export function getClassroomRepository() {
  if (!classroomRepository) classroomRepository = createClassroomRepository(getQuery());
  return classroomRepository;
}

export function getDesignStudioRepository() {
  if (!designStudioRepository) designStudioRepository = createDesignStudioRepository(getQuery());
  return designStudioRepository;
}
