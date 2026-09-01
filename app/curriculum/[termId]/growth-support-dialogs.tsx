"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CurriculumDashboardRecord,
  CurriculumWorkflowRecord,
  WorkflowEvidenceRecord,
  WorkflowFeedbackRecord,
} from "../../../db/growth-repository";
import { requestJson } from "../../../lib/client-api";

const localDateTime = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const gapLabel = { conceptual: "개념 격차", procedural: "절차·전략 격차", communication: "표현·소통 격차" };
const supportLabel = { teacher_prompt: "교사 질문", step_hint: "단계 힌트", example: "예시 제공", scaffolded: "구조화 지원" };
type Gap = keyof typeof gapLabel;
type Support = keyof typeof supportLabel;

export function FeedbackDialog({
  dashboard,
  workflow,
  seed,
  onClose,
  onSaved,
}: {
  dashboard: CurriculumDashboardRecord;
  workflow: CurriculumWorkflowRecord;
  seed: WorkflowEvidenceRecord;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const firstFinal = seed.judgements.find(item => item.state === "final");
  const [studentId, setStudentId] = useState(seed.studentId);
  const [unitStandardId, setUnitStandardId] = useState(firstFinal?.unitStandardId ?? "");
  const [basisIds, setBasisIds] = useState<string[]>(seed.judgements.filter(item => item.state === "final" && item.unitStandardId === firstFinal?.unitStandardId).map(item => item.id));
  const [strength, setStrength] = useState("");
  const [gapType, setGapType] = useState<Gap>("conceptual");
  const [gapDescription, setGapDescription] = useState("");
  const [nextLearning, setNextLearning] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const standards = useMemo(() => {
    const seen = new Set<string>();
    return workflow.rubrics.filter(item => item.state === "locked" && !seen.has(item.unitStandardId) && seen.add(item.unitStandardId));
  }, [workflow.rubrics]);
  const candidates = useMemo(() => workflow.evidence.flatMap(evidence => evidence.judgements
    .filter(judgement => judgement.state === "final" && evidence.studentId === studentId && judgement.unitStandardId === unitStandardId)
    .map(judgement => ({ evidence, judgement }))), [workflow.evidence, studentId, unitStandardId]);
  useEffect(() => { dialog.current?.showModal(); }, []);

  const resetBasis = (nextStudentId: string, nextStandardId: string) => {
    setBasisIds(workflow.evidence.flatMap(item => item.judgements.filter(judgement => item.studentId === nextStudentId && judgement.unitStandardId === nextStandardId && judgement.state === "final").map(judgement => judgement.id)));
  };
  const chooseStudent = (next: string) => { setStudentId(next); resetBasis(next, unitStandardId); };
  const chooseStandard = (next: string) => { setUnitStandardId(next); resetBasis(studentId, next); };
  const toggleBasis = (id: string) => setBasisIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  const valid = Boolean(studentId && unitStandardId && basisIds.length && strength.trim().length >= 5 && gapDescription.trim().length >= 5 && nextLearning.trim().length >= 5);
  const save = async () => {
    setBusy(true); setError("");
    try {
      await requestJson("/api/teacher/curriculum/feedback", { method: "POST", body: JSON.stringify({ studentId, unitStandardId, basisJudgementIds: basisIds, strength, gapType, gapDescription, nextLearning }) });
      await onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "피드백을 저장하지 못했습니다."); }
    finally { setBusy(false); }
  };

  return <dialog ref={dialog} className="create-modal real-dialog curriculum-dialog wide operation-dialog" aria-labelledby="feedback-dialog-title" onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <div className="modal-heading"><div><p className="kicker">최종 판단 근거 → 격차 진단 → 다음 수업</p><h2 id="feedback-dialog-title">성장 피드백 설계</h2></div><button type="button" aria-label="닫기" disabled={busy} onClick={onClose}>×</button></div>
    <div className="wizard-body operation-form-body">
      <section className="operation-form-section"><span className="form-step">1</span><div><h3>학생과 성취기준</h3><div className="field-row"><label>학생<select value={studentId} onChange={event => chooseStudent(event.target.value)}>{dashboard.students.map(student => <option key={student.id} value={student.id}>{student.displayName}</option>)}</select></label><label>성취기준<select value={unitStandardId} onChange={event => chooseStandard(event.target.value)}><option value="">선택해 주세요</option>{standards.map(item => <option key={item.unitStandardId} value={item.unitStandardId}>{item.standardCode} · {item.unitTitle}</option>)}</select></label></div></div></section>
      <section className="operation-form-section"><span className="form-step">2</span><div><h3>피드백의 근거가 되는 최종 교사 판단</h3>{candidates.length ? <div className="feedback-basis-list">{candidates.map(({ evidence, judgement }) => <label key={judgement.id} htmlFor={`basis-${judgement.id}`}><input id={`basis-${judgement.id}`} type="checkbox" aria-label={`${judgement.criterionName} ${judgement.level} 판단을 피드백 근거로 선택`} checked={basisIds.includes(judgement.id)} onChange={() => toggleBasis(judgement.id)} /><span><strong>{judgement.criterionName} · {judgement.level}</strong><small>{evidence.eventTitle} · {evidence.assistanceLevel === "independent" ? "독립 수행" : "지원받은 수행"}</small><q>{judgement.evidenceExcerpt}</q></span></label>)}</div> : <div className="lock-note danger">선택한 학생·성취기준에 교사가 최종 확정한 판단이 없습니다.</div>}</div></section>
      <section className="operation-form-section"><span className="form-step">3</span><div><h3>강점과 격차를 분리해 기록</h3><label>현재 확인된 강점<textarea value={strength} maxLength={3000} placeholder="학생이 이미 독립적으로 또는 지원을 받아 해낸 부분" onChange={event => setStrength(event.target.value)} /></label><div className="field-row"><label>핵심 격차 유형<select value={gapType} onChange={event => setGapType(event.target.value as Gap)}>{Object.entries(gapLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>다음 학습의 초점<input value={nextLearning} maxLength={3000} placeholder="예: 새로운 사례에서 원인과 결과를 화살표로 연결하기" onChange={event => setNextLearning(event.target.value)} /></label></div><label>구체적인 격차 설명<textarea value={gapDescription} maxLength={3000} placeholder="루브릭 기술문과 학생 증거 사이에 아직 드러나지 않은 연결" onChange={event => setGapDescription(event.target.value)} /></label></div></section>
      <div className="lock-note">피드백은 점수 통지가 아니라 다음 학습을 설계하는 기록입니다. 추가 학습과 재평가는 이 피드백에 이어서 누적됩니다.</div>
      {error ? <p className="ai-generation-error" role="alert">{error}</p> : null}
    </div>
    <div className="modal-actions"><button type="button" className="outline-button" disabled={busy} onClick={onClose}>취소</button><button type="button" className="primary-button" disabled={busy || !valid} onClick={() => void save()}>{busy ? "저장 중…" : "피드백·다음 학습 저장"}</button></div>
  </dialog>;
}

export function InterventionDialog({ cycle, onClose, onSaved }: { cycle: WorkflowFeedbackRecord; onClose: () => void; onSaved: () => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [activity, setActivity] = useState(cycle.nextLearning);
  const [supportLevel, setSupportLevel] = useState<Support>("step_hint");
  const [teacherNote, setTeacherNote] = useState("");
  const [occurredAt, setOccurredAt] = useState(localDateTime());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { dialog.current?.showModal(); }, []);
  const valid = activity.trim().length >= 5 && teacherNote.trim() && occurredAt;
  const save = async () => {
    setBusy(true); setError("");
    try {
      await requestJson(`/api/teacher/curriculum/feedback/${cycle.id}/interventions`, { method: "POST", body: JSON.stringify({ activity, supportLevel, teacherNote, occurredAt: new Date(occurredAt).toISOString() }) });
      await onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "추가 학습을 기록하지 못했습니다."); }
    finally { setBusy(false); }
  };
  return <dialog ref={dialog} className="create-modal real-dialog curriculum-dialog operation-dialog" aria-labelledby="intervention-title" onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <div className="modal-heading"><div><p className="kicker">{cycle.studentName} · {cycle.standardCode}</p><h2 id="intervention-title">추가 학습 기록</h2></div><button type="button" aria-label="닫기" disabled={busy} onClick={onClose}>×</button></div>
    <div className="wizard-body"><p className="wizard-guide"><strong>격차:</strong> {cycle.gapDescription}</p><label>실시한 추가 학습<textarea value={activity} maxLength={3000} onChange={event => setActivity(event.target.value)} /></label><div className="field-row"><label>지원 수준<select value={supportLevel} onChange={event => setSupportLevel(event.target.value as Support)}>{Object.entries(supportLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>실시 일시<input type="datetime-local" value={occurredAt} onChange={event => setOccurredAt(event.target.value)} /></label></div><label>교사 관찰 기록<textarea value={teacherNote} maxLength={3000} placeholder="어떤 지원에서 어떤 변화가 나타났는지 기록합니다." onChange={event => setTeacherNote(event.target.value)} /></label>{error ? <p className="ai-generation-error" role="alert">{error}</p> : null}</div>
    <div className="modal-actions"><button type="button" className="outline-button" disabled={busy} onClick={onClose}>취소</button><button type="button" className="primary-button" disabled={busy || !valid} onClick={() => void save()}>{busy ? "저장 중…" : "추가 학습 저장"}</button></div>
  </dialog>;
}

export function ReassessmentDialog({ cycle, workflow, onClose, onSaved }: { cycle: WorkflowFeedbackRecord; workflow: CurriculumWorkflowRecord; onClose: () => void; onSaved: () => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const basisEvidenceIds = useMemo(() => new Set(workflow.evidence.flatMap(evidence => evidence.judgements.filter(judgement => cycle.basisJudgementIds.includes(judgement.id)).map(() => evidence.id))), [cycle.basisJudgementIds, workflow.evidence]);
  const priorOptions = workflow.evidence.filter(item => basisEvidenceIds.has(item.id));
  const newOptions = workflow.evidence.filter(item => item.studentId === cycle.studentId && item.unitId === cycle.unitId && item.eventType === "reassessment" && !basisEvidenceIds.has(item.id));
  const [priorEvidenceId, setPriorEvidenceId] = useState(priorOptions[0]?.id ?? "");
  const [newEvidenceId, setNewEvidenceId] = useState(newOptions[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selected = newOptions.find(item => item.id === newEvidenceId);
  const independent = selected?.assistanceLevel === "independent";
  useEffect(() => { dialog.current?.showModal(); }, []);
  const save = async () => {
    setBusy(true); setError("");
    try {
      await requestJson(`/api/teacher/curriculum/feedback/${cycle.id}/reassessment`, { method: "POST", body: JSON.stringify({ priorEvidenceId, newEvidenceId, independent }) });
      await onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "재평가 증거를 연결하지 못했습니다."); }
    finally { setBusy(false); }
  };
  return <dialog ref={dialog} className="create-modal real-dialog curriculum-dialog operation-dialog" aria-labelledby="reassessment-title" onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <div className="modal-heading"><div><p className="kicker">{cycle.studentName} · 성장 확인</p><h2 id="reassessment-title">이전 수행과 재평가 연결</h2></div><button type="button" aria-label="닫기" disabled={busy} onClick={onClose}>×</button></div>
    <div className="wizard-body"><p className="wizard-guide">같은 문제를 외워 다시 푸는 방식이 아니라, 새로운 맥락에서 수행한 증거를 연결합니다.</p><label>피드백의 출발 증거<select value={priorEvidenceId} onChange={event => setPriorEvidenceId(event.target.value)}><option value="">선택해 주세요</option>{priorOptions.map(item => <option key={item.id} value={item.id}>{item.eventTitle} · {item.originalText?.slice(0, 35) ?? item.transformedText?.slice(0, 35)}</option>)}</select></label><label>새로운 재평가 증거<select value={newEvidenceId} onChange={event => setNewEvidenceId(event.target.value)}><option value="">선택해 주세요</option>{newOptions.map(item => <option key={item.id} value={item.id}>{item.eventTitle} · {item.assistanceLevel === "independent" ? "독립 수행" : "지원받은 수행"}</option>)}</select></label>{newOptions.length === 0 ? <div className="lock-note danger">먼저 ‘평가·수행 증거 기록’에서 구분을 ‘재평가’로 선택해 새 증거를 저장해 주세요.</div> : <div className={`independence-check ${independent ? "passed" : "pending"}`}><strong>{independent ? "독립 수행 확인" : "추가 독립 재평가 필요"}</strong><p>{independent ? "도움 없이 수행한 새 증거이므로 완료 성장으로 연결할 수 있습니다." : "지원받은 수행은 중간 성장으로 기록되며 사이클을 완료하지 않습니다."}</p></div>}{error ? <p className="ai-generation-error" role="alert">{error}</p> : null}</div>
    <div className="modal-actions"><button type="button" className="outline-button" disabled={busy} onClick={onClose}>취소</button><button type="button" className="primary-button" disabled={busy || !priorEvidenceId || !newEvidenceId} onClick={() => void save()}>{busy ? "연결 중…" : "재평가 성장 이력 연결"}</button></div>
  </dialog>;
}
