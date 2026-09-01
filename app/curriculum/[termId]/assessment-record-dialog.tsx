"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AssessmentEventRecord,
  CurriculumDashboardRecord,
  CurriculumWorkflowRecord,
  EvidenceRecord,
  WorkflowEvidenceRecord,
  WorkflowRubricRecord,
} from "../../../db/growth-repository";
import { requestJson } from "../../../lib/client-api";

const localDateTime = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const modalityLabel = { text: "글쓰기", photo: "손글씨 사진", speech: "말하기 녹음", observation: "교사 관찰", chat: "챗봇 대화" };
const eventLabel = { initial: "최초 수행", formative: "형성 확인", reassessment: "재평가", observation: "관찰", conversation: "대화" };
const assistanceLabel = { independent: "도움 없는 독립 수행", teacher_prompt: "교사 질문", step_hint: "단계 힌트", example: "예시 제공", scaffolded: "문장 틀·구조화 지원" };
const sourceKind = { text: "student_response", photo: "handwritten_work", speech: "recording", observation: "teacher_observation", chat: "chatbot_transcript" } as const;
type Modality = keyof typeof modalityLabel;
type EventType = keyof typeof eventLabel;
type Assistance = keyof typeof assistanceLabel;
type Level = "상" | "중" | "하" | "판단 보류";
type Draft = { criterionId: string; level: Level; excerpt: string; rationale: string };

const evidenceTextOf = (evidence?: WorkflowEvidenceRecord | null) => evidence?.originalText ?? evidence?.transformedText ?? "";
const initialRubric = (workflow: CurriculumWorkflowRecord, evidence?: WorkflowEvidenceRecord | null) => {
  const existingStandard = evidence?.judgements[0]?.unitStandardId;
  return workflow.rubrics.find(rubric => rubric.state === "locked" && rubric.unitId === evidence?.unitId && rubric.unitStandardId === existingStandard)
    ?? workflow.rubrics.find(rubric => rubric.state === "locked" && rubric.unitId === evidence?.unitId)
    ?? workflow.rubrics.find(rubric => rubric.state === "locked")
    ?? null;
};
const draftsFor = (rubric: WorkflowRubricRecord | null, evidence?: WorkflowEvidenceRecord | null): Draft[] => (rubric?.criteria ?? []).map(criterion => {
  const current = evidence?.judgements.find(item => item.rubricCriterionId === criterion.id);
  return {
    criterionId: criterion.id,
    level: current?.level ?? "판단 보류",
    excerpt: current?.evidenceExcerpt ?? evidenceTextOf(evidence).slice(0, 500),
    rationale: current?.rationale ?? "",
  };
});

export default function AssessmentRecordDialog({
  dashboard,
  workflow,
  evidence,
  onClose,
  onSaved,
}: {
  dashboard: CurriculumDashboardRecord;
  workflow: CurriculumWorkflowRecord;
  evidence?: WorkflowEvidenceRecord;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const firstRubric = useMemo(() => initialRubric(workflow, evidence), [workflow, evidence]);
  const [rubricId, setRubricId] = useState(firstRubric?.id ?? "");
  const [studentId, setStudentId] = useState(evidence?.studentId ?? dashboard.students[0]?.id ?? "");
  const [eventType, setEventType] = useState<EventType>(evidence?.eventType ?? "initial");
  const [eventTitle, setEventTitle] = useState(evidence?.eventTitle ?? "");
  const [eventContext, setEventContext] = useState(evidence?.eventContext ?? "");
  const [occurredAt, setOccurredAt] = useState(localDateTime());
  const [modality, setModality] = useState<Modality>(evidence?.modality ?? "text");
  const [assistanceLevel, setAssistanceLevel] = useState<Assistance>(evidence?.assistanceLevel ?? "independent");
  const [sourceRef, setSourceRef] = useState(evidence?.sourceRef ?? "");
  const [evidenceText, setEvidenceText] = useState(evidenceTextOf(evidence));
  const [drafts, setDrafts] = useState<Draft[]>(draftsFor(firstRubric, evidence));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const rubric = workflow.rubrics.find(item => item.id === rubricId) ?? null;
  const lockedRubrics = workflow.rubrics.filter(item => item.state === "locked" && (!evidence || item.unitId === evidence.unitId));
  const mediaEvidence = modality === "photo" || modality === "speech";
  useEffect(() => { dialog.current?.showModal(); }, []);

  const changeRubric = (nextId: string) => {
    const next = workflow.rubrics.find(item => item.id === nextId) ?? null;
    setRubricId(nextId);
    setDrafts(draftsFor(next, evidence));
  };
  const updateDraft = (criterionId: string, patch: Partial<Draft>) => setDrafts(current => current.map(item => item.criterionId === criterionId ? { ...item, ...patch } : item));
  const valid = Boolean(rubric && studentId && evidenceText.trim() && drafts.length && drafts.every(item => item.rationale.trim().length >= 5))
    && (evidence ? true : eventTitle.trim().length >= 2 && eventContext.trim().length >= 5 && occurredAt && (!mediaEvidence || sourceRef.trim()));

  const save = async () => {
    if (!rubric || !valid) return;
    setBusy(true); setError("");
    try {
      let targetEvidenceId = evidence?.id;
      if (!targetEvidenceId) {
        const event = await requestJson<{ event: AssessmentEventRecord }>(`/api/teacher/curriculum/units/${rubric.unitId}/events`, {
          method: "POST",
          body: JSON.stringify({ eventType, title: eventTitle, context: eventContext, occurredAt: new Date(occurredAt).toISOString() }),
        });
        const payload = mediaEvidence ? {
          studentId, eventId: event.event.id, modality, sourceKind: sourceKind[modality], assistanceLevel,
          sourceRef, transformedText: evidenceText, transformationStatus: "teacher_verified", teacherVerified: true,
          collectedAt: new Date(occurredAt).toISOString(),
        } : {
          studentId, eventId: event.event.id, modality, sourceKind: sourceKind[modality], assistanceLevel,
          originalText: evidenceText, transformationStatus: "original", teacherVerified: false,
          collectedAt: new Date(occurredAt).toISOString(),
        };
        const saved = await requestJson<{ evidence: EvidenceRecord }>("/api/teacher/curriculum/evidence", { method: "POST", body: JSON.stringify(payload) });
        targetEvidenceId = saved.evidence.id;
      }
      for (const item of drafts) {
        await requestJson(`/api/teacher/curriculum/evidence/${targetEvidenceId}/judgements`, {
          method: "POST",
          body: JSON.stringify({
            rubricCriterionId: item.criterionId,
            level: item.level,
            evidenceExcerpt: item.excerpt.trim() || evidenceText.slice(0, 500),
            rationale: item.rationale,
            state: "final",
          }),
        });
      }
      await onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "수행 증거와 교사 판단을 저장하지 못했습니다.");
    } finally { setBusy(false); }
  };

  return <dialog ref={dialog} className="create-modal real-dialog curriculum-dialog wide operation-dialog" aria-labelledby="assessment-record-title" onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <div className="modal-heading"><div><p className="kicker">{evidence ? "불변 원본을 유지한 판단 개정" : "평가 맥락 → 수행 증거 → 루브릭 판단"}</p><h2 id="assessment-record-title">{evidence ? `${evidence.studentName} · 교사 판단 보완` : "단원 평가와 수행 증거 기록"}</h2></div><button type="button" aria-label="닫기" disabled={busy} onClick={onClose}>×</button></div>
    <div className="wizard-body operation-form-body">
      {lockedRubrics.length === 0 ? <div className="lock-note danger">먼저 단원의 성취기준 루브릭을 설계하고 ‘검토 완료·잠금’해 주세요.</div> : null}
      <section className="operation-form-section"><span className="form-step">1</span><div><h3>성취기준과 학생</h3><div className="field-row"><label>잠긴 루브릭<select value={rubricId} onChange={event => changeRubric(event.target.value)}><option value="">선택해 주세요</option>{lockedRubrics.map(item => <option key={item.id} value={item.id}>{item.unitTitle} · {item.standardCode} · v{item.version}</option>)}</select></label><label>학생<select disabled={Boolean(evidence)} value={studentId} onChange={event => setStudentId(event.target.value)}><option value="">선택해 주세요</option>{dashboard.students.map(student => <option key={student.id} value={student.id}>{student.displayName} · {student.studentRef}</option>)}</select></label></div>{rubric ? <p className="selected-standard"><strong>{rubric.standardCode}</strong> {rubric.standardContent}</p> : null}</div></section>

      {!evidence ? <section className="operation-form-section"><span className="form-step">2</span><div><h3>평가 시점과 맥락</h3><div className="field-row three"><label>구분<select value={eventType} onChange={event => setEventType(event.target.value as EventType)}>{Object.entries(eventLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>실시 일시<input type="datetime-local" value={occurredAt} onChange={event => setOccurredAt(event.target.value)} /></label><label>도움 수준<select value={assistanceLevel} onChange={event => setAssistanceLevel(event.target.value as Assistance)}>{Object.entries(assistanceLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div><label>평가 제목<input value={eventTitle} maxLength={160} placeholder="예: 선거와 시민 주권 첫 수행" onChange={event => setEventTitle(event.target.value)} /></label><label>새로운 수행 맥락<textarea value={eventContext} maxLength={3000} placeholder="학생이 무엇을, 어떤 자료와 조건에서 수행했는지 기록합니다." onChange={event => setEventContext(event.target.value)} /></label></div></section> : null}

      <section className="operation-form-section"><span className="form-step">{evidence ? "2" : "3"}</span><div><h3>원본 수행 증거</h3>{!evidence ? <div className="field-row"><label>증거 방식<select value={modality} onChange={event => setModality(event.target.value as Modality)}>{Object.entries(modalityLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{mediaEvidence ? <label>비공개 원본 참조<input value={sourceRef} maxLength={1000} placeholder="예: private://class/6-1/audio-01" onChange={event => setSourceRef(event.target.value)} /></label> : <label className="read-only-field">보존 방식<input readOnly value="학생·교사 원문 그대로 보존" /></label>}</div> : null}<label>{mediaEvidence ? "교사가 확인한 OCR·전사 내용" : "학생 수행 원문·교사 관찰 원문"}<textarea value={evidenceText} readOnly={Boolean(evidence)} maxLength={50000} placeholder="해석이나 점수보다 먼저 관찰된 원문을 기록합니다." onChange={event => setEvidenceText(event.target.value)} /></label>{evidence ? <p className="immutable-note">원본 증거는 수정하지 않습니다. 잘못 기록한 경우 새 증거가 이전 기록을 대체하도록 추가합니다.</p> : null}</div></section>

      <section className="operation-form-section"><span className="form-step">{evidence ? "3" : "4"}</span><div><h3>기준별 상·중·하 교사 판단</h3><p className="wizard-guide">총점 하나가 아니라 각 평가 요소에서 관찰된 근거와 판단 이유를 따로 남깁니다.</p><div className="criterion-judgement-editors">{rubric?.criteria.map(criterion => { const draft = drafts.find(item => item.criterionId === criterion.id); const suggestion = evidence?.aiSuggestions.find(item => item.rubricCriterionId === criterion.id); if (!draft) return null; return <article key={criterion.id}><header><div><small>{criterion.key}</small><h4>{criterion.name}</h4></div><select aria-label={`${criterion.name} 수준`} value={draft.level} onChange={event => updateDraft(criterion.id, { level: event.target.value as Level })}><option>상</option><option>중</option><option>하</option><option>판단 보류</option></select></header>{suggestion ? <aside className="ai-suggestion-detail"><div><strong>AI 추천 {suggestion.suggestedLevel}</strong><span>확신 {Math.round(suggestion.confidence * 100)}%</span></div><p>{suggestion.rationale}</p><small>불확실성: {suggestion.uncertainty}</small><small>추가 증거: {suggestion.missingEvidence}</small><em>추천은 자동 적용되지 않습니다. 교사가 원문과 기술문을 직접 검토합니다.</em></aside> : null}<details><summary>상·중·하 수행 기술문 비교</summary><p><strong>상</strong>{criterion.high}</p><p><strong>중</strong>{criterion.middle}</p><p><strong>하</strong>{criterion.low}</p></details><label>학생 증거 인용<textarea value={draft.excerpt} maxLength={3000} placeholder="원문에서 판단 근거가 되는 부분" onChange={event => updateDraft(criterion.id, { excerpt: event.target.value })} /></label><label>교사 판단 이유<textarea value={draft.rationale} maxLength={5000} placeholder="어떤 기술문과 어떻게 일치하는지 5자 이상 기록합니다." onChange={event => updateDraft(criterion.id, { rationale: event.target.value })} /></label></article>; })}</div></div></section>
      {error ? <p className="ai-generation-error" role="alert">{error}</p> : null}
    </div>
    <div className="modal-actions"><button type="button" className="outline-button" disabled={busy} onClick={onClose}>취소</button><button type="button" className="primary-button" disabled={busy || !valid} onClick={() => void save()}>{busy ? "원본과 판단 저장 중…" : evidence ? "교사 판단 새 개정으로 확정" : "평가·증거·판단 저장"}</button></div>
  </dialog>;
}
