import { test } from "node:test";
import assert from "node:assert/strict";
import { readFormDataMutation, readMutation, privateJson, validateCode, validateId } from "../lib/http";
import { AppError } from "../lib/assessment-domain";
const req = (body: string, origin: string | null = "https://mumu.test") => new Request("https://mumu.test/api/test", { method: "POST", body, headers: { "Content-Type": "application/json", ...(origin ? { origin } : {}) } });
const status = (code: number) => (error: unknown) => error instanceof AppError && error.status === code;
test("같은 출처의 JSON만 허용", async () => {
  assert.deepEqual(await readMutation(req('{"answer":"학생 답안"}')), { answer: "학생 답안" });
  await assert.rejects(readMutation(req("{}", "https://other.test")), status(403));
  await assert.rejects(readMutation(req("{}", null)), status(403));
  await assert.rejects(readMutation(req("{bad")), status(400));
});
test("Content-Length 없이도 실제 바이트 제한", async () => { await assert.rejects(readMutation(req(JSON.stringify({ answer: "가".repeat(100) })), 50), status(413)); });
test("문서 업로드도 같은 출처와 실제 multipart 바이트 제한을 적용", async () => {
  const body = new FormData();
  body.set("file", new File(["학교교육과정"], "plan.txt", { type: "text/plain" }));
  const valid = new Request("https://mumu.test/api/import", { method: "POST", body, headers: { origin: "https://mumu.test" } });
  const parsed = await readFormDataMutation(valid, 10_000);
  assert.equal((parsed.get("file") as File).name, "plan.txt");
  const oversized = new FormData();
  oversized.set("file", new File(["가".repeat(500)], "large.txt", { type: "text/plain" }));
  await assert.rejects(readFormDataMutation(new Request("https://mumu.test/api/import", { method: "POST", body: oversized, headers: { origin: "https://mumu.test" } }), 100), status(413));
  const foreign = new FormData();
  foreign.set("file", new File(["내용"], "plan.txt", { type: "text/plain" }));
  await assert.rejects(readFormDataMutation(new Request("https://mumu.test/api/import", { method: "POST", body: foreign, headers: { origin: "https://other.test" } })), status(403));
});
test("개인 데이터 캐시 금지", () => assert.equal(privateJson({}).headers.get("cache-control"), "private, no-store"));
test("경로·ID 검증", () => { assert.throws(() => validateCode("../../teacher"), status(404)); assert.throws(() => validateId("' OR 1=1 --"), status(404)); });
