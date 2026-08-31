import { test } from "node:test";
import assert from "node:assert/strict";
import { readMutation, privateJson, validateCode, validateId } from "../lib/http";
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
test("개인 데이터 캐시 금지", () => assert.equal(privateJson({}).headers.get("cache-control"), "private, no-store"));
test("경로·ID 검증", () => { assert.throws(() => validateCode("../../teacher"), status(404)); assert.throws(() => validateId("' OR 1=1 --"), status(404)); });
