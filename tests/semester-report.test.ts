import { test } from "node:test";
import assert from "node:assert/strict";
import { confirmedGrowthCodes, finalSemesterJudgements } from "../lib/semester-report";
import type { CurriculumWorkflowRecord, WorkflowEvidenceRecord, WorkflowFeedbackRecord } from "../db/growth-repository";

test("학기말 보고서는 최신 초안과 다른 학생 판단을 확정 결과로 사용하지 않는다", () => {
  const workflow = { semesterJudgements: [
    { studentId: "a", standardCode: "s1", state: "draft", level: "상" },
    { studentId: "a", standardCode: "s2", state: "final", level: "중" },
    { studentId: "b", standardCode: "s1", state: "final", level: "상" },
  ] } as Pick<CurriculumWorkflowRecord, "semesterJudgements">;
  assert.deepEqual(finalSemesterJudgements(workflow, "a").map(item => item.standardCode), ["s2"]);
});

test("재평가 참석·동일 수준·미확정·다른 기준·미확인 전사를 향상으로 계산하지 않는다", () => {
  const judgement = { id: "j1", rubricCriterionId: "c1", standardCode: "s1", state: "final", level: "중" };
  const prior = { id: "p", studentId: "a", collectedAt: "2026-04-01", transformationStatus: "original", teacherVerified: false, judgements: [judgement] } as WorkflowEvidenceRecord;
  const next = { ...prior, id: "n", collectedAt: "2026-05-01", assistanceLevel: "independent", eventType: "reassessment", judgements: [{ ...judgement, id: "j2", level: "상" }] } as WorkflowEvidenceRecord;
  const cycle = { studentId: "a", standardCode: "s1", status: "completed", basisJudgementIds: ["j1"], reassessments: [{ priorEvidenceId: "p", newEvidenceId: "n", independent: true }] } as WorkflowFeedbackRecord;
  const growth = (value: WorkflowEvidenceRecord) => [...confirmedGrowthCodes([prior, value], [cycle])];
  assert.deepEqual(growth(next), ["s1"]);
  assert.deepEqual(growth({ ...next, judgements: [] }), []);
  assert.deepEqual(growth({ ...next, judgements: [{ ...next.judgements[0], level: "중" }] }), []);
  assert.deepEqual(growth({ ...next, judgements: [{ ...next.judgements[0], state: "draft" }] }), []);
  assert.deepEqual(growth({ ...next, judgements: [{ ...next.judgements[0], rubricCriterionId: "different-version" }] }), []);
  assert.deepEqual(growth({ ...next, transformationStatus: "automated", teacherVerified: false }), []);
  assert.deepEqual(growth({ ...next, assistanceLevel: "step_hint" }), []);
  assert.deepEqual(growth({ ...next, collectedAt: "2026-03-01" }), []);
});
