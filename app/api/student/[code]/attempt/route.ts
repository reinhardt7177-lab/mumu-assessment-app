import { cookies } from "next/headers";
import { z } from "zod";
import { getRepository } from "../../../../../db/connection";
import { AppError } from "../../../../../lib/assessment-domain";
import { apiError, privateJson, readMutation, validateCode } from "../../../../../lib/http";

export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const code = validateCode((await params).code);
    const input = z.object({ studentLabel: z.string().trim().min(1).max(40) }).safeParse(await readMutation(request, 2000));
    if (!input.success) throw new AppError(400, "번호 또는 별칭을 입력해 주세요.");
    const jar = await cookies();
    const existingToken = jar.get(`mumu_attempt_${code}`)?.value;
    const repo = getRepository();
    if (existingToken) return privateJson({ attempt: await repo.getAttempt(code, existingToken) });
    const { attempt, token } = await repo.startAttempt(code, input.data.studentLabel);
    jar.set(`mumu_attempt_${code}`, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: `/api/student/${code}`, maxAge: 60 * 60 * 24 * 30 });
    return privateJson({ attempt }, 201);
  } catch (error) { return apiError(error); }
}

export async function PUT(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const code = validateCode((await params).code);
    const input = z.object({ answers: z.unknown(), revision: z.number().int().min(0), timeSpentSeconds: z.number().int().min(0).max(86400), submit: z.boolean().optional() }).safeParse(await readMutation(request, 700000));
    if (!input.success) throw new AppError(400, "답안 저장 정보를 확인해 주세요.");
    const token = (await cookies()).get(`mumu_attempt_${code}`)?.value;
    if (!token) throw new AppError(401, "먼저 번호 또는 별칭으로 참여해 주세요.");
    return privateJson({ attempt: await getRepository().saveAttempt(code, token, input.data) });
  } catch (error) { return apiError(error); }
}
