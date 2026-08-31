import "server-only";
import { auth } from "@clerk/nextjs/server";
import { AppError } from "./assessment-domain";

export function authConfigured() {
  return Boolean(process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
}

export async function requireTeacher() {
  if (!authConfigured()) throw new AppError(503, "교사 로그인 연결 준비 중입니다.");
  const { userId } = await auth();
  if (!userId) throw new AppError(401, "교사 로그인이 필요합니다.");
  const approved = (process.env.TEACHER_USER_IDS ?? "").split(",").map(value => value.trim()).filter(Boolean);
  if (!approved.includes(userId)) throw new AppError(403, "승인된 교사 계정만 사용할 수 있습니다. 운영자에게 계정 승인을 요청해 주세요.");
  return userId;
}
