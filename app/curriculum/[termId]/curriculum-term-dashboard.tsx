"use client";

import { useEffect, useRef, useState } from "react";
import type { CurriculumDashboardRecord, RubricCriterionRecord } from "../../../db/growth-repository";
import { requestJson } from "../../../lib/client-api";
import AchievementStandardPicker, { type AchievementStandard } from "../../achievement-standard-picker";

const unitStatus = { planned: "수업 예정", teaching: "수업 중", assessing: "평가 중", feedback: "피드백", completed: "완료" };
const rubricStatus = { draft: "검토 중", locked: "평가 사용 가능", retired: "이전 버전" };

export default function CurriculumTermDashboard({ initialDashboard }: { initialDashboard: CurriculumDashboardRecord }) {
  const [dashboard, setDashboard] = useState(initialDashboard);
  const [creatingUnit, setCreatingUnit] = useState(false);
  const [creatingStudent, setCreatingStudent] = useState(false);
  const [rubricStandard, setRubricStandard] = useState<{ id: string; code: string; content: string } | null>(null);
  const [busyRubric, setBusyRubric] = useState("");
  const [error, setError] = useState("");
  const refresh = async () => {
    const data = await requestJson<{ dashboard: CurriculumDashboardRecord }>(`/api/teacher/curriculum/terms/${dashboard.term.id}`);
    setDashboard(data.dashboard);
  };
  const lockRubric = async (rubricId: string) => {
    setBusyRubric(rubricId); setError("");
    try {
      await requestJson(`/api/teacher/curriculum/rubrics/${rubricId}/lock`, { method: "POST", body: "{}" });
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "루브릭을 확정하지 못했습니다."); }
    finally { setBusyRubric(""); }
  };
  const term = dashboard.term;

  return <div className="curriculum-real curriculum-board">
    <section className="curriculum-board-heading">
      <div><p className="kicker">{term.schoolYear}학년도 · {term.semester}학기</p><h1>{term.grade}학년 {term.className} · {term.subject}</h1><p>단원별 성취기준과 학생의 성장 증거를 연결하는 실제 저장 공간입니다.</p></div>
      <div><button type="button" className="outline-button" onClick={() => setCreatingStudent(true)}>＋ 학생 등록</button><button type="button" className="primary-button" onClick={() => setCreatingUnit(true)}>＋ 단원 추가</button></div>
    </section>
    {error ? <p className="ai-generation-error" role="alert">{error}</p> : null}

    <section className="home-metrics curriculum-live-metrics" aria-label="현재 학기 성장 평가 현황">
      <article><small>단원</small><strong>{dashboard.units.length}</strong><span>성취기준 {dashboard.units.reduce((sum, unit) => sum + unit.standards.length, 0)}개</span></article>
      <article><small>등록 학생</small><strong>{dashboard.students.length}</strong><span>학기별 번호·별칭</span></article>
      <article><small>수행 증거</small><strong>{dashboard.activity.evidenceCount}</strong><span>글·사진·말·관찰·대화</span></article>
      <article><small>독립 수행 성장</small><strong>{dashboard.activity.independentGrowthCount}</strong><span>추가 학습 뒤 재평가</span></article>
    </section>

    <div className="curriculum-board-grid">
      <section className="master-section">
        <div className="master-section-heading"><div><p className="kicker">단원·성취기준 지도</p><h2>평가 계획과 루브릭 준비 상태</h2></div><span className="validity-chip">석차가 아닌 준거 평가</span></div>
        {dashboard.units.length === 0 ? <div className="curriculum-empty-panel"><h3>아직 단원이 없습니다.</h3><p>교육과정에서 이번 학기에 가르칠 성취기준을 선택해 첫 단원을 만드세요.</p><button type="button" className="primary-button" onClick={() => setCreatingUnit(true)}>첫 단원 추가</button></div> : <div className="curriculum-live-units">
          {dashboard.units.map(unit => <article key={unit.id}>
            <header><span>{unit.orderIndex}단원 · {unitStatus[unit.status]}</span><h3>{unit.title}</h3></header>
            <div className="unit-standard-live-list">
              {unit.standards.map(standard => <div key={standard.id}>
                <span>{standard.code}</span><p>{standard.content}</p>
                {standard.rubric ? <div className="rubric-live-state"><strong>루브릭 v{standard.rubric.version} · {rubricStatus[standard.rubric.state]}</strong><small>{standard.rubric.criterionCount}개 평가 요소</small>{standard.rubric.state === "draft" ? <button type="button" disabled={busyRubric === standard.rubric.id} onClick={() => void lockRubric(standard.rubric!.id)}>{busyRubric === standard.rubric.id ? "확정 중…" : "검토 완료·잠금"}</button> : null}</div> : <button type="button" className="rubric-design-button" onClick={() => setRubricStandard({ id: standard.id, code: standard.code, content: standard.content })}>＋ 준거 루브릭 설계</button>}
              </div>)}
            </div>
          </article>)}
        </div>}
      </section>

      <aside className="master-section curriculum-roster">
        <div className="master-section-heading"><div><p className="kicker">학생 성장 기록</p><h2>학급 현황</h2></div><button type="button" className="outline-button" onClick={() => setCreatingStudent(true)}>등록</button></div>
        {dashboard.students.length === 0 ? <div className="curriculum-empty-panel compact"><p>학생 번호·별칭을 등록하면 수행 증거와 성장 이력이 여기에 쌓입니다.</p></div> : <div className="curriculum-student-list">
          {dashboard.students.map(student => <article key={student.id}><span>{student.displayName.slice(0, 1)}</span><div><strong>{student.displayName}</strong><small>{student.studentRef}</small></div><em>증거 {student.evidenceCount}</em>{student.openFeedbackCount > 0 ? <b>추가 학습 {student.openFeedbackCount}</b> : student.independentGrowthCount > 0 ? <b className="growth-done">성장 확인 {student.independentGrowthCount}</b> : <b className="pending-level">평가 전</b>}</article>)}
        </div>}
        <div className="semester-rule curriculum-judgement-rule"><span>학기말 종합 판단</span><strong>점수 평균으로 자동 확정하지 않습니다</strong><p>최종 교사 판단 {dashboard.activity.finalStandardCount}개 · 미완료 피드백 {dashboard.activity.openFeedbackCount}개</p></div>
      </aside>
    </div>

    {creatingUnit ? <UnitCreator dashboard={dashboard} onClose={() => setCreatingUnit(false)} onSaved={async () => { setCreatingUnit(false); await refresh(); }} /> : null}
    {creatingStudent ? <StudentCreator termId={term.id} onClose={() => setCreatingStudent(false)} onSaved={async () => { setCreatingStudent(false); await refresh(); }} /> : null}
    {rubricStandard ? <RubricBuilder standard={rubricStandard} onClose={() => setRubricStandard(null)} onSaved={async () => { setRubricStandard(null); await refresh(); }} /> : null}
  </div>;
}

function UnitCreator({ dashboard, onClose, onSaved }: { dashboard: CurriculumDashboardRecord; onClose: () => void; onSaved: () => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState("");
  const [orderIndex, setOrderIndex] = useState(dashboard.units.length + 1);
  const [standards, setStandards] = useState<AchievementStandard[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { dialog.current?.showModal(); }, []);
  const save = async () => {
    setBusy(true); setError("");
    try {
      await requestJson(`/api/teacher/curriculum/terms/${dashboard.term.id}/units`, { method: "POST", body: JSON.stringify({ title, orderIndex, standardCodes: standards.map(standard => standard.code) }) });
      await onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "단원을 저장하지 못했습니다."); }
    finally { setBusy(false); }
  };
  return <dialog ref={dialog} className="create-modal real-dialog curriculum-dialog wide" aria-labelledby="unit-creator-title" onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <div className="modal-heading"><div><p className="kicker">단원과 교육과정 연결</p><h2 id="unit-creator-title">단원 추가</h2></div><button type="button" aria-label="닫기" disabled={busy} onClick={onClose}>×</button></div>
    <div className="wizard-body"><div className="field-row"><label>단원 순서<input type="number" min={1} max={99} value={orderIndex} onChange={event => setOrderIndex(Number(event.target.value))} /></label><label>단원명<input value={title} maxLength={120} placeholder="예: 민주주의와 시민 참여" onChange={event => setTitle(event.target.value)} /></label></div>
      <AchievementStandardPicker subjectLabel={`${dashboard.term.grade}학년 ${dashboard.term.subject}`} selected={standards} onChange={setStandards} />
      {error ? <p className="ai-generation-error" role="alert">{error}</p> : null}
    </div>
    <div className="modal-actions"><button type="button" className="outline-button" disabled={busy} onClick={onClose}>취소</button><button type="button" className="primary-button" disabled={busy || title.trim().length < 2 || standards.length === 0} onClick={() => void save()}>{busy ? "저장 중…" : "단원·성취기준 저장"}</button></div>
  </dialog>;
}

function StudentCreator({ termId, onClose, onSaved }: { termId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [studentRef, setStudentRef] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { dialog.current?.showModal(); }, []);
  const save = async () => {
    setBusy(true); setError("");
    try {
      await requestJson(`/api/teacher/curriculum/terms/${termId}/students`, { method: "POST", body: JSON.stringify({ studentRef, displayName }) });
      await onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "학생을 등록하지 못했습니다."); }
    finally { setBusy(false); }
  };
  return <dialog ref={dialog} className="create-modal real-dialog curriculum-dialog" aria-labelledby="student-creator-title" onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <div className="modal-heading"><div><p className="kicker">학기별 학생 연결</p><h2 id="student-creator-title">학생 등록</h2></div><button type="button" aria-label="닫기" disabled={busy} onClick={onClose}>×</button></div>
    <div className="wizard-body"><p className="wizard-guide">학교 명부의 직접 식별자 대신, 교사가 관리하는 번호·별칭을 권장합니다.</p><div className="field-row"><label>학생 참조 번호<input value={studentRef} maxLength={80} placeholder="예: 6-1-01" onChange={event => setStudentRef(event.target.value)} /></label><label>화면 표시 이름<input value={displayName} maxLength={40} placeholder="예: 1번 학생" onChange={event => setDisplayName(event.target.value)} /></label></div>{error ? <p className="ai-generation-error" role="alert">{error}</p> : null}</div>
    <div className="modal-actions"><button type="button" className="outline-button" disabled={busy} onClick={onClose}>취소</button><button type="button" className="primary-button" disabled={busy || !studentRef.trim() || !displayName.trim()} onClick={() => void save()}>{busy ? "등록 중…" : "학생 등록"}</button></div>
  </dialog>;
}

type EditableCriterion = Omit<RubricCriterionRecord, "id" | "position">;
const firstCriterion = (): EditableCriterion => ({
  key: "concept",
  name: "개념과 원리",
  description: "성취기준에서 요구하는 핵심 개념의 관계와 적용을 확인한다.",
  high: "핵심 개념 사이의 관계를 근거와 함께 설명하고 새로운 사례에 적용한다.",
  middle: "핵심 개념을 설명하고 관련 사례와 연결하지만 관계 설명은 부분적으로 드러난다.",
  low: "핵심 개념이나 사례를 제시하지만 둘 사이의 관계를 설명한 근거는 아직 드러나지 않는다.",
});

function RubricBuilder({ standard, onClose, onSaved }: { standard: { id: string; code: string; content: string }; onClose: () => void; onSaved: () => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [criteria, setCriteria] = useState<EditableCriterion[]>([firstCriterion()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { dialog.current?.showModal(); }, []);
  const updateCriterion = (index: number, patch: Partial<EditableCriterion>) => setCriteria(current => current.map((criterion, currentIndex) => currentIndex === index ? { ...criterion, ...patch } : criterion));
  const save = async () => {
    setBusy(true); setError("");
    try {
      await requestJson(`/api/teacher/curriculum/standards/${standard.id}/rubrics`, { method: "POST", body: JSON.stringify({ criteria }) });
      await onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "루브릭을 저장하지 못했습니다."); }
    finally { setBusy(false); }
  };
  const valid = criteria.length > 0 && criteria.every(criterion => criterion.key && criterion.name && criterion.description.length >= 5 && criterion.high.length >= 5 && criterion.middle.length >= 5 && criterion.low.length >= 5);
  return <dialog ref={dialog} className="create-modal real-dialog curriculum-dialog wide" aria-labelledby="rubric-builder-title" onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <div className="modal-heading"><div><p className="kicker">{standard.code} · 준거참조 평가</p><h2 id="rubric-builder-title">관찰 가능한 루브릭 설계</h2></div><button type="button" aria-label="닫기" disabled={busy} onClick={onClose}>×</button></div>
    <div className="wizard-body"><p className="master-standard">{standard.content}</p><p className="wizard-guide">수준 차이는 ‘잘함/보통/부족’이 아니라 학생 결과물에서 실제로 관찰되는 질적 차이로 작성합니다.</p>
      <div className="real-rubric-editors">{criteria.map((criterion, index) => <article className="question-editor" key={criterion.key}>
        <div className="question-number"><strong>평가 요소 {index + 1}</strong>{criteria.length > 1 ? <button type="button" onClick={() => setCriteria(current => current.filter((_, currentIndex) => currentIndex !== index))}>삭제</button> : null}</div>
        <div className="field-row"><label>기준 키<input value={criterion.key} maxLength={64} onChange={event => updateCriterion(index, { key: event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "") })} /></label><label>평가 요소 이름<input value={criterion.name} maxLength={80} onChange={event => updateCriterion(index, { name: event.target.value })} /></label></div>
        <label>무엇을 확인하나요?<textarea value={criterion.description} maxLength={1000} onChange={event => updateCriterion(index, { description: event.target.value })} /></label>
        <label>상 · 독립적 연결과 적용<textarea value={criterion.high} maxLength={1000} onChange={event => updateCriterion(index, { high: event.target.value })} /></label>
        <label>중 · 핵심 수행이 나타나지만 연결이 부분적<textarea value={criterion.middle} maxLength={1000} onChange={event => updateCriterion(index, { middle: event.target.value })} /></label>
        <label>하 · 현재 확인된 출발점과 필요한 연결<textarea value={criterion.low} maxLength={1000} onChange={event => updateCriterion(index, { low: event.target.value })} /></label>
      </article>)}</div>
      <button type="button" className="add-question-button" disabled={criteria.length >= 10} onClick={() => setCriteria(current => [...current, { ...firstCriterion(), key: `criterion-${current.length + 1}`, name: `평가 요소 ${current.length + 1}` }])}>＋ 평가 요소 추가</button>
      <div className="lock-note">먼저 초안으로 저장합니다. 단원 화면에서 검토 완료 후 잠그면 실제 판단에 사용할 수 있습니다.</div>
      {error ? <p className="ai-generation-error" role="alert">{error}</p> : null}
    </div>
    <div className="modal-actions"><button type="button" className="outline-button" disabled={busy} onClick={onClose}>취소</button><button type="button" className="primary-button" disabled={busy || !valid} onClick={() => void save()}>{busy ? "저장 중…" : "루브릭 초안 저장"}</button></div>
  </dialog>;
}
