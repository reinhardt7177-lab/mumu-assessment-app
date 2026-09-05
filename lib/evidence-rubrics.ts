import type { WorkflowEvidenceRecord, WorkflowRubricRecord } from "../db/growth-repository";

export function evidenceRubrics(rubrics: WorkflowRubricRecord[], evidence?: WorkflowEvidenceRecord | null) {
  const candidates = rubrics.filter(rubric => rubric.state === "locked" && (!evidence || rubric.unitId === evidence.unitId));
  if (!evidence?.originalText) return candidates;
  try {
    const source = JSON.parse(evidence.originalText);
    if (!["mumu.text.answers.v1", "mumu.multimodal.answers.v2"].includes(source.format) || !Array.isArray(source.answers)) return candidates;
    const ids = new Set(source.answers.map((answer: { rubricCriterionId?: string }) => answer.rubricCriterionId).filter(Boolean));
    if (!ids.size) return candidates; // Older/manual evidence has no assessment snapshot.
    return candidates.map(rubric => ({ ...rubric, criteria: rubric.criteria.filter(criterion => ids.has(criterion.id)) })).filter(rubric => rubric.criteria.length > 0);
  } catch { return candidates; }
}
