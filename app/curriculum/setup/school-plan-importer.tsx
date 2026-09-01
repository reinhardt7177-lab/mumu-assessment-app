"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { CurriculumTermRecord, SchoolCurriculumPlanRecord, SchoolRecord } from "../../../db/growth-repository";
import type { GradePlanTemplate, GradePlanUnit, SchoolBasics, SourceDocument } from "../../../lib/school-curriculum-domain";
import { requestFormData, requestJson } from "../../../lib/client-api";

const subjects = ["국어", "사회", "수학", "과학", "도덕", "영어"] as const;
const assessmentMethods = [
  ["text", "글쓰기·선다형"],
  ["photo", "손글씨 사진"],
  ["speech", "말하기"],
  ["chat", "챗봇 대화"],
  ["observation", "관찰 기록"],
] as const;
type Subject = (typeof subjects)[number];
type ImportPreview = {
  sourceDocument: SourceDocument;
  schoolBasics: SchoolBasics;
  gradeTemplates: GradePlanTemplate[];
  matchedStandards: { code: string; content: string; domain: string }[];
  warnings: string[];
  extraction: { characterCount: number; rowCount: number };
};
type Draft = {
  schoolBasics: SchoolBasics;
  gradeTemplates: GradePlanTemplate[];
  sourceDocuments: SourceDocument[];
  warnings: string[];
  extraction: ImportPreview["extraction"];
  matchedStandards: ImportPreview["matchedStandards"];
};

const scopeKey = (template: Pick<GradePlanTemplate, "grade" | "semester" | "subject">) => `${template.grade}:${template.semester}:${template.subject}`;
const mergeTemplates = (previous: GradePlanTemplate[], incoming: GradePlanTemplate[]) => {
  const next = new Map(previous.map(item => [scopeKey(item), item]));
  incoming.forEach(item => next.set(scopeKey(item), item));
  return [...next.values()].toSorted((a, b) => a.grade - b.grade || a.semester - b.semester || a.subject.localeCompare(b.subject, "ko"));
};
const usefulBasics = (incoming: SchoolBasics, previous?: SchoolBasics): SchoolBasics => ({
  vision: incoming.vision || previous?.vision || "",
  focusAreas: incoming.focusAreas.length ? incoming.focusAreas : previous?.focusAreas ?? [],
  assessmentPolicy: incoming.assessmentPolicy || previous?.assessmentPolicy || "",
  schoolEvents: incoming.schoolEvents.length ? incoming.schoolEvents : previous?.schoolEvents ?? [],
});

export default function SchoolPlanImporter({ initialSchools, initialPlans, defaultSchoolYear }: { initialSchools: SchoolRecord[]; initialPlans: SchoolCurriculumPlanRecord[]; defaultSchoolYear: number }) {
  const router = useRouter();
  const [schools, setSchools] = useState(initialSchools);
  const [plans, setPlans] = useState(initialPlans);
  const [schoolId, setSchoolId] = useState(initialSchools[0]?.id ?? "");
  const [schoolYear, setSchoolYear] = useState(defaultSchoolYear);
  const [documentKind, setDocumentKind] = useState<"school" | "grade">("grade");
  const [grade, setGrade] = useState(6);
  const [semester, setSemester] = useState<1 | 2>(1);
  const [subject, setSubject] = useState<Subject>("사회");
  const [file, setFile] = useState<File | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [creatingSchool, setCreatingSchool] = useState(false);
  const [applyTarget, setApplyTarget] = useState<{ plan: SchoolCurriculumPlanRecord; template: GradePlanTemplate } | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const latest = plans.find(plan => plan.schoolId === schoolId && plan.schoolYear === schoolYear);
  const availableSubjects = grade < 3 ? subjects.filter(item => item === "국어" || item === "수학") : subjects;

  const changeGrade = (value: number) => {
    setGrade(value);
    if (value < 3 && subject !== "국어" && subject !== "수학") setSubject("국어");
  };
  const extract = async () => {
    if (!file || !schoolId) return;
    setBusy("extract"); setError("");
    try {
      const body = new FormData();
      body.set("file", file); body.set("documentKind", documentKind); body.set("schoolYear", String(schoolYear));
      body.set("grade", String(grade)); body.set("semester", String(semester)); body.set("subject", subject);
      const data = await requestFormData<{ preview: ImportPreview }>("/api/teacher/curriculum/imports/preview", body);
      const previous = plans.find(plan => plan.schoolId === schoolId && plan.schoolYear === schoolYear);
      setDraft({
        schoolBasics: usefulBasics(data.preview.schoolBasics, previous?.schoolBasics),
        gradeTemplates: mergeTemplates(previous?.gradeTemplates ?? [], data.preview.gradeTemplates),
        sourceDocuments: [...new Map([...(previous?.sourceDocuments ?? []), data.preview.sourceDocument].map(item => [item.sha256, item])).values()],
        warnings: data.preview.warnings, extraction: data.preview.extraction, matchedStandards: data.preview.matchedStandards,
      });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "문서를 분석하지 못했습니다."); }
    finally { setBusy(""); }
  };
  const save = async (state: "draft" | "approved") => {
    if (!draft) return;
    setBusy(state); setError("");
    try {
      const data = await requestJson<{ plan: SchoolCurriculumPlanRecord }>("/api/teacher/curriculum/plans", {
        method: "POST", body: JSON.stringify({ schoolId, schoolYear, state, schoolBasics: draft.schoolBasics, gradeTemplates: draft.gradeTemplates, sourceDocuments: draft.sourceDocuments }),
      });
      setPlans(current => [data.plan, ...current.map(item => item.schoolId === data.plan.schoolId && item.schoolYear === data.plan.schoolYear && item.state === "approved" && data.plan.state === "approved" ? { ...item, state: "retired" as const } : item)]);
      if (state === "approved") setDraft(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "학교 기본계획을 저장하지 못했습니다."); }
    finally { setBusy(""); }
  };
  const updateUnit = (templateKey: string, unitKey: string, patch: Partial<GradePlanUnit>) => setDraft(current => current ? {
    ...current, gradeTemplates: current.gradeTemplates.map(template => template.key === templateKey ? { ...template, units: template.units.map(unit => unit.key === unitKey ? { ...unit, ...patch } : unit) } : template),
  } : current);
  const addUnit = (templateKey: string) => setDraft(current => current ? {
    ...current, gradeTemplates: current.gradeTemplates.map(template => template.key === templateKey ? {
      ...template, units: [...template.units, { key: crypto.randomUUID(), orderIndex: template.units.length + 1, title: "새 단원", standardCodes: [], plannedPeriod: "", teachingHours: null, assessmentTiming: "", assessmentMethods: ["text"], assessmentFocus: "" }],
    } : template),
  } : current);
  const removeUnit = (templateKey: string, unitKey: string) => setDraft(current => current ? {
    ...current,
    gradeTemplates: current.gradeTemplates.map(template => template.key === templateKey
      ? { ...template, units: template.units.filter(unit => unit.key !== unitKey).map((unit, index) => ({ ...unit, orderIndex: index + 1 })) }
      : template),
  } : current);
  const removeTemplate = (templateKey: string) => setDraft(current => current ? {
    ...current,
    gradeTemplates: current.gradeTemplates.filter(template => template.key !== templateKey),
  } : current);

  return <div className="curriculum-real school-plan-workspace">
    <section className="school-plan-hero">
      <div><p className="kicker">SCHOOL CURRICULUM SETUP</p><h1>학교 교육과정을<br />학급 평가 계획으로.</h1><p>PDF·XLSX·CSV·TXT에서 학교 기본사항과 단원·성취기준을 읽고, 교사가 검토한 승인본만 학급에 적용합니다.</p></div>
      <Link className="outline-button button-link" href="/curriculum">← 학기 교육과정으로</Link>
    </section>

    <section className="school-plan-grid">
      <article className="school-setup-card">
        <header><div><p className="kicker">1 · SCHOOL</p><h2>학교 선택</h2></div><button type="button" className="outline-button" onClick={() => setCreatingSchool(true)}>＋ 학교 등록</button></header>
        {schools.length ? <label>학교<select value={schoolId} onChange={event => { setSchoolId(event.target.value); setDraft(null); }}>{schools.map(school => <option key={school.id} value={school.id}>{school.name}{school.region ? ` · ${school.region}` : ""}</option>)}</select></label> : <div className="empty-import-state"><strong>등록된 학교가 없습니다.</strong><span>먼저 학교를 등록해 주세요.</span></div>}
        {latest ? <p className="plan-version-note">최근 계획: {latest.schoolYear}학년도 v{latest.version} · {latest.state === "approved" ? "확정" : latest.state === "draft" ? "초안" : "이전 버전"}</p> : null}
      </article>

      <article className="school-setup-card">
        <header><div><p className="kicker">2 · IMPORT</p><h2>교육과정 문서 가져오기</h2></div><span className="privacy-chip">외부 AI 전송 없음</span></header>
        <div className="import-field-grid">
          <label>학년도<input type="number" min={2022} max={2100} value={schoolYear} onChange={event => { setSchoolYear(Number(event.target.value)); setDraft(null); }} /></label>
          <label>문서 종류<select value={documentKind} onChange={event => setDocumentKind(event.target.value as "school" | "grade")}><option value="school">학교교육과정</option><option value="grade">학년·교과 교육과정</option></select></label>
          {documentKind === "grade" ? <><label>학년<select value={grade} onChange={event => changeGrade(Number(event.target.value))}>{[1, 2, 3, 4, 5, 6].map(value => <option key={value} value={value}>{value}학년</option>)}</select></label><label>학기<select value={semester} onChange={event => setSemester(Number(event.target.value) as 1 | 2)}><option value={1}>1학기</option><option value={2}>2학기</option></select></label><label>교과<select value={subject} onChange={event => setSubject(event.target.value as Subject)}>{availableSubjects.map(value => <option key={value}>{value}</option>)}</select></label></> : null}
        </div>
        <label className="file-drop">PDF·XLSX·CSV·TXT<input type="file" accept=".pdf,.xlsx,.csv,.txt,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain" onChange={event => setFile(event.target.files?.[0] ?? null)} /><span>{file ? `${file.name} · ${Math.ceil(file.size / 1024)}KB` : "8MB 이하 파일을 선택하세요. HWP는 PDF 또는 XLSX로 변환합니다."}</span></label>
        <button type="button" className="primary-button" disabled={!schoolId || !file || Boolean(busy)} onClick={() => void extract()}>{busy === "extract" ? "문서를 읽는 중…" : "문서 분석·검토안 만들기"}</button>
      </article>
    </section>

    {error ? <p className="ai-generation-error" role="alert">{error}</p> : null}
    {draft ? <PlanReview draft={draft} setDraft={setDraft} updateUnit={updateUnit} addUnit={addUnit} removeUnit={removeUnit} removeTemplate={removeTemplate} busy={busy} onSave={save} /> : null}

    <section className="assessment-section school-plan-history">
      <div className="assessment-list-heading"><div><p className="kicker">APPROVED SCHOOL PLANS</p><h2>학교 기본계획 버전</h2></div><span>초안은 학급에 적용할 수 없습니다.</span></div>
      {plans.length === 0 ? <div className="empty-import-state"><strong>저장된 학교 계획이 없습니다.</strong><span>문서를 분석하고 교사 검토 후 확정해 주세요.</span></div> : <div className="school-plan-card-grid">{plans.map(plan => <article key={plan.id} className={`school-plan-card ${plan.state}`}><header><div><span>{plan.schoolName}</span><h3>{plan.schoolYear}학년도 · v{plan.version}</h3></div><em>{plan.state === "approved" ? "확정" : plan.state === "draft" ? "초안" : "이전"}</em></header><p>{plan.gradeTemplates.length}개 학년·교과 계획 · 출처 {plan.sourceDocuments.length}개</p><div>{plan.gradeTemplates.map(template => <button type="button" key={template.key} disabled={plan.state !== "approved"} onClick={() => setApplyTarget({ plan, template })}>{template.grade}학년 {template.semester}학기 {template.subject}<small>{template.units.length}단원 · 학급에 적용 →</small></button>)}</div></article>)}</div>}
    </section>

    {creatingSchool ? <SchoolCreator onClose={() => setCreatingSchool(false)} onCreated={school => { setSchools(current => [...current, school]); setSchoolId(school.id); setCreatingSchool(false); }} /> : null}
    {applyTarget ? <ApplyPlanDialog target={applyTarget} onClose={() => setApplyTarget(null)} onApplied={(term) => router.push(`/curriculum/${term.id}`)} /> : null}
  </div>;
}

function PlanReview({ draft, setDraft, updateUnit, addUnit, removeUnit, removeTemplate, busy, onSave }: {
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft | null>>;
  updateUnit: (templateKey: string, unitKey: string, patch: Partial<GradePlanUnit>) => void;
  addUnit: (templateKey: string) => void;
  removeUnit: (templateKey: string, unitKey: string) => void;
  removeTemplate: (templateKey: string) => void;
  busy: string;
  onSave: (state: "draft" | "approved") => Promise<void>;
}) {
  const updateBasics = (patch: Partial<SchoolBasics>) => setDraft(current => current ? {
    ...current,
    schoolBasics: { ...current.schoolBasics, ...patch },
  } : current);
  const toggleMethod = (templateKey: string, unit: GradePlanUnit, method: GradePlanUnit["assessmentMethods"][number]) => {
    const selected = unit.assessmentMethods.includes(method);
    const assessmentMethods = selected ? unit.assessmentMethods.filter(item => item !== method) : [...unit.assessmentMethods, method];
    updateUnit(templateKey, unit.key, { assessmentMethods });
  };
  return <section className="assessment-section plan-review-section">
    <div className="assessment-list-heading"><div><p className="kicker">3 · TEACHER REVIEW</p><h2>자동 추출 결과 검토</h2></div><span>{draft.extraction.characterCount.toLocaleString()}자 · {draft.extraction.rowCount.toLocaleString()}행 · 성취기준 {draft.matchedStandards.length}개</span></div>
    {draft.warnings.length ? <div className="import-warning-list">{draft.warnings.map(warning => <p key={warning}>주의 · {warning}</p>)}</div> : <p className="save-notice">문서 형식 검사를 통과했습니다. 내용의 교육적 정확성은 교사가 최종 확인해 주세요.</p>}
    <div className="school-basics-editor">
      <label>학교 교육 목표·비전<textarea value={draft.schoolBasics.vision} maxLength={3000} onChange={event => updateBasics({ vision: event.target.value })} /></label>
      <label>학교 평가 방침<textarea value={draft.schoolBasics.assessmentPolicy} maxLength={5000} onChange={event => updateBasics({ assessmentPolicy: event.target.value })} /></label>
      <label>중점·특색 과제<textarea value={draft.schoolBasics.focusAreas.join("\n")} onChange={event => updateBasics({ focusAreas: event.target.value.split("\n").map(item => item.trim()).filter(Boolean).slice(0, 30) })} /></label>
      <label>학교 행사·학사 일정<textarea value={draft.schoolBasics.schoolEvents.map(item => item.note ? `${item.name} | ${item.note}` : item.name).join("\n")} placeholder="한 줄에 하나씩, 예: 과학의 날 | 4월 3주" onChange={event => updateBasics({ schoolEvents: event.target.value.split("\n").map(item => item.trim()).filter(Boolean).slice(0, 100).map(item => { const [name, ...note] = item.split("|"); return { name: name.trim(), note: note.join("|").trim() }; }) })} /></label>
    </div>
    {draft.matchedStandards.length ? <details className="matched-standard-panel"><summary>문서에서 확인한 성취기준 {draft.matchedStandards.length}개 보기</summary><div>{draft.matchedStandards.map(standard => <p key={standard.code}><strong>{standard.code}</strong><span>{standard.domain}</span>{standard.content}</p>)}</div></details> : null}
    <div className="grade-template-list">
      {draft.gradeTemplates.map(template => <article key={template.key} className="grade-template-card"><header><div><span>{template.grade}학년 · {template.semester}학기</span><h3>{template.subject} 학습 및 평가 계획</h3></div><div className="template-card-tools"><strong>{template.units.length}단원</strong><button type="button" onClick={() => removeTemplate(template.key)} aria-label={`${template.grade}학년 ${template.subject} 계획 삭제`}>계획 삭제</button></div></header>
        <div className="template-unit-list">{template.units.map(unit => <div key={unit.key} className="template-unit-editor"><div className="template-unit-heading"><label>순서<input type="number" min={1} max={99} value={unit.orderIndex} onChange={event => updateUnit(template.key, unit.key, { orderIndex: Number(event.target.value) })} /></label><label>단원명<input value={unit.title} maxLength={120} onChange={event => updateUnit(template.key, unit.key, { title: event.target.value })} /></label><button type="button" className="remove-unit-button" onClick={() => removeUnit(template.key, unit.key)} aria-label={`${unit.title} 삭제`}>삭제</button></div><label>성취기준 코드<input value={unit.standardCodes.join(", ")} placeholder="예: 6사08-01, 6사08-02" onChange={event => updateUnit(template.key, unit.key, { standardCodes: event.target.value.split(/[\s,]+/).map(item => item.trim()).filter(Boolean) })} /></label><div className="template-unit-meta"><label>수업 시기<input value={unit.plannedPeriod} onChange={event => updateUnit(template.key, unit.key, { plannedPeriod: event.target.value })} /></label><label>시수<input type="number" min={0} max={300} value={unit.teachingHours ?? ""} onChange={event => updateUnit(template.key, unit.key, { teachingHours: event.target.value ? Number(event.target.value) : null })} /></label><label>평가 시기<input value={unit.assessmentTiming} onChange={event => updateUnit(template.key, unit.key, { assessmentTiming: event.target.value })} /></label><label>평가 중점<input value={unit.assessmentFocus} onChange={event => updateUnit(template.key, unit.key, { assessmentFocus: event.target.value })} /></label></div><fieldset className="assessment-method-picker"><legend>평가 방법</legend>{assessmentMethods.map(([value, label]) => <label key={value}><input type="checkbox" checked={unit.assessmentMethods.includes(value)} onChange={() => toggleMethod(template.key, unit, value)} />{label}</label>)}</fieldset></div>)}</div>
        <button type="button" className="add-question-button" onClick={() => addUnit(template.key)}>＋ 단원 추가</button>
      </article>)}
    </div>
    <div className="plan-review-actions"><p>초안은 계속 수정할 수 있습니다. 확정하면 같은 학교·학년도의 이전 승인본은 보존된 이전 버전으로 전환됩니다.</p><button type="button" className="outline-button" disabled={Boolean(busy)} onClick={() => void onSave("draft")}>{busy === "draft" ? "저장 중…" : "검토 초안 저장"}</button><button type="button" className="primary-button" disabled={Boolean(busy)} onClick={() => void onSave("approved")}>{busy === "approved" ? "확정 중…" : "검토 완료·기본계획 확정"}</button></div>
  </section>;
}

function SchoolCreator({ onClose, onCreated }: { onClose: () => void; onCreated: (school: SchoolRecord) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [region, setRegion] = useState("");
  const [schoolCode, setSchoolCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { dialog.current?.showModal(); }, []);
  const save = async () => {
    setBusy(true); setError("");
    try { onCreated((await requestJson<{ school: SchoolRecord }>("/api/teacher/curriculum/schools", { method: "POST", body: JSON.stringify({ name, region, schoolCode: schoolCode || undefined }) })).school); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "학교를 등록하지 못했습니다."); }
    finally { setBusy(false); }
  };
  return <dialog ref={dialog} className="create-modal real-dialog curriculum-dialog" aria-labelledby="school-creator-title" onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}><div className="modal-heading"><div><p className="kicker">학교별 기본계획</p><h2 id="school-creator-title">학교 등록</h2></div><button type="button" aria-label="닫기" disabled={busy} onClick={onClose}>×</button></div><div className="wizard-body"><label>학교명<input value={name} maxLength={120} onChange={event => setName(event.target.value)} placeholder="예: 무무초등학교" /></label><label>지역<input value={region} maxLength={120} onChange={event => setRegion(event.target.value)} placeholder="예: 전북특별자치도" /></label><label>학교 코드·내부 식별값(선택)<input value={schoolCode} maxLength={40} onChange={event => setSchoolCode(event.target.value)} /></label>{error ? <p className="ai-generation-error" role="alert">{error}</p> : null}</div><div className="modal-actions"><button type="button" className="outline-button" disabled={busy} onClick={onClose}>취소</button><button type="button" className="primary-button" disabled={busy || name.trim().length < 2} onClick={() => void save()}>{busy ? "등록 중…" : "학교 등록"}</button></div></dialog>;
}

function ApplyPlanDialog({ target, onClose, onApplied }: { target: { plan: SchoolCurriculumPlanRecord; template: GradePlanTemplate }; onClose: () => void; onApplied: (term: CurriculumTermRecord) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [className, setClassName] = useState("1반");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { dialog.current?.showModal(); }, []);
  const apply = async () => {
    setBusy(true); setError("");
    try {
      const data = await requestJson<{ term: CurriculumTermRecord }>(`/api/teacher/curriculum/plans/${target.plan.id}/apply`, { method: "POST", body: JSON.stringify({ templateKey: target.template.key, className }) });
      onApplied(data.term);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "학급 계획을 만들지 못했습니다."); }
    finally { setBusy(false); }
  };
  return <dialog ref={dialog} className="create-modal real-dialog curriculum-dialog" aria-labelledby="apply-plan-title" onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}><div className="modal-heading"><div><p className="kicker">승인본에서 학급 계획 만들기</p><h2 id="apply-plan-title">{target.template.grade}학년 {target.template.semester}학기 {target.template.subject}</h2></div><button type="button" aria-label="닫기" disabled={busy} onClick={onClose}>×</button></div><div className="wizard-body"><p className="wizard-guide">{target.plan.schoolName} · {target.plan.schoolYear}학년도 v{target.plan.version}의 {target.template.units.length}개 단원과 성취기준을 복제합니다.</p><label>학급명<input value={className} maxLength={50} onChange={event => setClassName(event.target.value)} placeholder="예: 1반" /></label><div className="lock-note">학교 승인본은 바뀌지 않으며, 생성된 학급 계획은 이후 학급 상황에 맞게 운영합니다.</div>{error ? <p className="ai-generation-error" role="alert">{error}</p> : null}</div><div className="modal-actions"><button type="button" className="outline-button" disabled={busy} onClick={onClose}>취소</button><button type="button" className="primary-button" disabled={busy || !className.trim()} onClick={() => void apply()}>{busy ? "학급 계획 생성 중…" : "학급 교육과정 만들기"}</button></div></dialog>;
}
