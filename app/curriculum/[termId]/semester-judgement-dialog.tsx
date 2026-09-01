"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CurriculumDashboardRecord, CurriculumWorkflowRecord, SemesterJudgementRecord } from "../../../db/growth-repository";
import { requestJson } from "../../../lib/client-api";

type Level = "상" | "중" | "하" | "판단 보류";
type State = "draft" | "final";
type EvidenceRole = "supporting" | "conflicting" | "";

export default function SemesterJudgementDialog({
  dashboard,
  workflow,
  initialStudentId,
  initialStandardCode,
  onClose,
  onSaved,
}: {
  dashboard: CurriculumDashboardRecord;
  workflow: CurriculumWorkflowRecord;
  initialStudentId?: string;
  initialStandardCode?: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const standards = useMemo(() => {
    const seen = new Set<string>();
    return dashboard.units.flatMap(unit => unit.standards.map(standard => ({ ...standard, unitTitle: unit.title }))).filter(item => !seen.has(item.code) && seen.add(item.code));
  }, [dashboard.units]);
  const defaultStudentId = initialStudentId ?? dashboard.students[0]?.id ?? "";
  const defaultStandardCode = initialStandardCode ?? standards[0]?.code ?? "";
  const initialExisting = workflow.semesterJudgements.find(item => item.studentId === defaultStudentId && item.standardCode === defaultStandardCode);
  const [studentId, setStudentId] = useState(defaultStudentId);
  const [standardCode, setStandardCode] = useState(defaultStandardCode);
  const [level, setLevel] = useState<Level>(initialExisting?.level ?? "판단 보류");
  const [rationale, setRationale] = useState(initialExisting?.rationale ?? "");
  const [state, setState] = useState<State>(initialExisting?.state ?? "draft");
  const [roles, setRoles] = useState<Record<string, EvidenceRole>>(Object.fromEntries((initialExisting?.evidence ?? []).map(item => [item.id, item.role])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const evidence = useMemo(() => workflow.evidence.filter(item => item.studentId === studentId && item.judgements.some(judgement => judgement.standardCode === standardCode && judgement.state === "final")), [workflow.evidence, studentId, standardCode]);
  const supporting = evidence.filter(item => roles[item.id] === "supporting");
  const conflicting = evidence.filter(item => roles[item.id] === "conflicting");
  const independentCount = supporting.filter(item => item.assistanceLevel === "independent").length;
  const finalReady = level === "판단 보류" || (supporting.length >= 2 && independentCount >= 1);
  const valid = Boolean(studentId && standardCode && rationale.trim().length >= 5 && (state === "draft" || finalReady));
  useEffect(() => { dialog.current?.showModal(); }, []);

  const existingFor = (nextStudentId: string, nextStandardCode: string) => workflow.semesterJudgements.find(item => item.studentId === nextStudentId && item.standardCode === nextStandardCode);
  const loadExisting = (nextStudentId: string, nextStandardCode: string) => {
    const existing = existingFor(nextStudentId, nextStandardCode);
    setLevel(existing?.level ?? "판단 보류");
    setRationale(existing?.rationale ?? "");
    setState(existing?.state ?? "draft");
    setRoles(Object.fromEntries((existing?.evidence ?? []).map(item => [item.id, item.role])));
  };
  const chooseStudent = (next: string) => { setStudentId(next); loadExisting(next, standardCode); };
  const chooseStandard = (next: string) => { setStandardCode(next); loadExisting(studentId, next); };
  const setEvidenceRole = (id: string, role: EvidenceRole) => setRoles(current => ({ ...current, [id]: role }));
  const save = async () => {
    setBusy(true); setError("");
    try {
      await requestJson(`/api/teacher/curriculum/terms/${dashboard.term.id}/semester-judgements`, {
        method: "POST",
        body: JSON.stringify({
          studentId,
          standardCode,
          level,
          rationale,
          state,
          evidenceIds: supporting.map(item => item.id),
          conflictingEvidenceIds: conflicting.map(item => item.id),
        }),
      });
      await onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "학기말 종합 판단을 저장하지 못했습니다."); }
    finally { setBusy(false); }
  };
  const existing = existingFor(studentId, standardCode) as (SemesterJudgementRecord & { studentName: string }) | undefined;

  return <dialog ref={dialog} className="create-modal real-dialog curriculum-dialog wide operation-dialog" aria-labelledby="semester-judgement-title" onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <div className="modal-heading"><div><p className="kicker">최근성 · 반복성 · 독립성 · 상충 증거 검토</p><h2 id="semester-judgement-title">학기말 성취기준별 종합 판단</h2></div><button type="button" aria-label="닫기" disabled={busy} onClick={onClose}>×</button></div>
    <div className="wizard-body operation-form-body">
      <section className="operation-form-section"><span className="form-step">1</span><div><h3>학생과 성취기준 선택</h3><div className="field-row"><label>학생<select value={studentId} onChange={event => chooseStudent(event.target.value)}>{dashboard.students.map(student => <option key={student.id} value={student.id}>{student.displayName} · {student.studentRef}</option>)}</select></label><label>성취기준<select value={standardCode} onChange={event => chooseStandard(event.target.value)}>{standards.map(item => <option key={item.id} value={item.code}>{item.code} · {item.unitTitle}</option>)}</select></label></div>{existing ? <p className="existing-revision">현재 저장: {existing.level} · {existing.state === "final" ? "교사 확정" : "초안"} · 개정 {existing.revision}판</p> : null}</div></section>
      <section className="operation-form-section"><span className="form-step">2</span><div><h3>최종 판단이 있는 수행 증거 분류</h3><p className="wizard-guide">수준을 뒷받침하는 증거와, 현재 판단에 맞지 않는 상충 증거를 모두 보존합니다.</p>{evidence.length ? <div className="semester-evidence-list">{evidence.map(item => { const levels = item.judgements.filter(judgement => judgement.standardCode === standardCode && judgement.state === "final").map(judgement => `${judgement.criterionName} ${judgement.level}`).join(" · "); return <article key={item.id}><header><div><strong>{item.eventTitle}</strong><small>{new Date(item.collectedAt).toLocaleDateString("ko-KR")} · {item.assistanceLevel === "independent" ? "독립 수행" : "지원받은 수행"}</small></div><span>{levels}</span></header><blockquote>{item.originalText ?? item.transformedText}</blockquote><fieldset><legend>종합 판단에서의 역할</legend><label><input type="radio" name={`role-${item.id}`} checked={!roles[item.id]} onChange={() => setEvidenceRole(item.id, "")} />제외</label><label><input type="radio" name={`role-${item.id}`} checked={roles[item.id] === "supporting"} onChange={() => setEvidenceRole(item.id, "supporting")} />뒷받침 근거</label><label><input type="radio" name={`role-${item.id}`} checked={roles[item.id] === "conflicting"} onChange={() => setEvidenceRole(item.id, "conflicting")} />상충 근거</label></fieldset></article>; })}</div> : <div className="lock-note danger">이 학생·성취기준에 최종 확정된 수행 증거가 없습니다. 먼저 기준별 루브릭 판단을 완료해 주세요.</div>}</div></section>
      <section className="operation-form-section"><span className="form-step">3</span><div><h3>교사의 종합 수준과 서술</h3><div className="field-row"><label>종합 수준<select value={level} onChange={event => setLevel(event.target.value as Level)}><option>상</option><option>중</option><option>하</option><option>판단 보류</option></select></label><label>저장 상태<select value={state} onChange={event => setState(event.target.value as State)}><option value="draft">교사 검토 초안</option><option value="final">교사 최종 확정</option></select></label></div><label>증거 기반 종합 서술<textarea value={rationale} maxLength={5000} placeholder="최초 수행, 추가 학습, 최근 독립 수행에서 무엇이 어떻게 달라졌는지 설명합니다." onChange={event => setRationale(event.target.value)} /></label><div className={`semester-readiness ${finalReady ? "passed" : "pending"}`}><strong>{state === "draft" ? "초안 저장 가능" : finalReady ? "최종 확정 조건 충족" : "최종 확정 조건 미충족"}</strong><p>뒷받침 증거 {supporting.length}개 · 독립 수행 {independentCount}개 · 상충 증거 {conflicting.length}개</p>{state === "final" && level !== "판단 보류" && !finalReady ? <small>서로 다른 최종 수행 증거 2개 이상과 도움 없는 독립 수행 1개 이상이 필요합니다.</small> : null}</div></div></section>
      <div className="lock-note">AI는 증거 정리와 문장 초안을 제안할 수 있지만, 종합 수준과 서술의 최종 확정자는 교사입니다.</div>
      {error ? <p className="ai-generation-error" role="alert">{error}</p> : null}
    </div>
    <div className="modal-actions"><button type="button" className="outline-button" disabled={busy} onClick={onClose}>취소</button><button type="button" className="primary-button" disabled={busy || !valid} onClick={() => void save()}>{busy ? "개정 이력 저장 중…" : state === "final" ? "학기말 판단 최종 확정" : "학기말 판단 초안 저장"}</button></div>
  </dialog>;
}
