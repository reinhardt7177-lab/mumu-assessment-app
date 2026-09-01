export class RequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20000), ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new RequestError(payload?.error || "연결을 확인하고 다시 시도해 주세요.", response.status);
  if (!payload) throw new RequestError("서버 응답을 확인할 수 없습니다.", 502);
  return payload as T;
}

export async function requestFormData<T>(url: string, body: FormData): Promise<T> {
  const response = await fetch(url, { method: "POST", body, cache: "no-store", signal: AbortSignal.timeout(60000) });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new RequestError(payload?.error || "문서를 처리하지 못했습니다.", response.status);
  if (!payload) throw new RequestError("서버 응답을 확인할 수 없습니다.", 502);
  return payload as T;
}
