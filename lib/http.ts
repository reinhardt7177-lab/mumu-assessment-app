import { AppError } from "./assessment-domain";

export function privateJson(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}

export function apiError(error: unknown) {
  if (error instanceof AppError) return privateJson({ error: error.message }, error.status);
  // Never log database parameters, student work, cookies, or provider credentials.
  console.error("Assessment operation failed", { type: error instanceof Error ? error.name : "UnknownError" });
  return privateJson({ error: "서버에 저장하지 못했습니다. 내용을 유지한 채 잠시 뒤 다시 시도해 주세요." }, 500);
}

export async function readMutation(request: Request, maxBytes = 250_000): Promise<unknown> {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) throw new AppError(403, "허용되지 않은 요청입니다.");
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new AppError(415, "JSON 요청만 처리할 수 있습니다.");
  const reader = request.body?.getReader();
  if (!reader) throw new AppError(400, "요청 내용이 없습니다.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new AppError(413, "요청 내용이 너무 큽니다."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new AppError(400, "요청 내용을 읽을 수 없습니다."); }
}

export function validateId(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new AppError(404, "대상을 찾을 수 없습니다.");
  return id;
}

export function validateCode(code: string) {
  if (!/^[A-F0-9]{16}$/.test(code)) throw new AppError(404, "올바른 평가 링크인지 확인해 주세요.");
  return code;
}
