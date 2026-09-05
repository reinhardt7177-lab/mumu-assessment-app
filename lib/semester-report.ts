import type { CurriculumWorkflowRecord, WorkflowEvidenceRecord, WorkflowFeedbackRecord } from "../db/growth-repository";

export function finalSemesterJudgements(workflow: Pick<CurriculumWorkflowRecord, "semesterJudgements">, studentId: string) {
  // Workflow contains the latest revision. A new draft must never masquerade as a final judgement.
  return workflow.semesterJudgements.filter(item => item.studentId === studentId && item.state === "final");
}

const rank = { "하": 1, "중": 2, "상": 3 };
export function confirmedGrowthCodes(evidence: WorkflowEvidenceRecord[], feedback: WorkflowFeedbackRecord[]) {
  const byId = new Map(evidence.map(item => [item.id, item]));
  const codes = new Set<string>();
  for (const cycle of feedback) {
    for (const link of cycle.reassessments) {
      const prior = byId.get(link.priorEvidenceId);
      const next = byId.get(link.newEvidenceId);
      if (!link.independent || !prior || !next || next.assistanceLevel !== "independent"
        || prior.studentId !== cycle.studentId || next.studentId !== cycle.studentId
        || next.eventType !== "reassessment" || next.collectedAt <= prior.collectedAt
        || [prior, next].some(item => item.transformationStatus === "automated" && !item.teacherVerified)) continue;
      const baseline = prior.judgements.filter(j => j.standardCode === cycle.standardCode && j.state === "final" && cycle.basisJudgementIds.includes(j.id));
      if (!baseline.length || baseline.some(j => j.level === "판단 보류")) continue;
      const pairs = baseline.map(before => ({ before, after: next.judgements.find(j => j.rubricCriterionId === before.rubricCriterionId && j.standardCode === cycle.standardCode && j.state === "final") }));
      // Compare the same rubric version and all baseline elements; attendance alone is not growth.
      if (pairs.some(({ after }) => !after || after.level === "판단 보류")) continue;
      const differences = pairs.map(({ before, after }) => rank[after!.level as keyof typeof rank] - rank[before.level as keyof typeof rank]);
      if (differences.every(value => value >= 0) && differences.some(value => value > 0)) codes.add(cycle.standardCode);
    }
  }
  return codes;
}
