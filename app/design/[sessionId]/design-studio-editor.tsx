"use client";

import Link from "next/link";
import { useState } from "react";
import type { AlignmentCandidate, CompetencyUnpack, DesignSessionRecord, QuestionDraft, RubricDraftItem } from "../../../lib/design-studio-domain";
import { requestFormData } from "../../../lib/client-api";

const steps = [
  ["자료 입력", "수업 맥락"], ["성취기준", "공식 기준 정렬"], ["성공 기준", "관찰할 수행"],
  ["루브릭", "상·중·하 기준"], ["평가 문항", "증거 수합"], ["타당도", "품질 점검"], ["교사 승인", "평가 초안 생성"],
] as const;

async function callApi<T>(url: string, init: RequestInit = {}) {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(60000), ...init, headers: { "Content-Type": "application/json", ...init.headers } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || "요청을 처리하지 못했습니다.");
  return payload as T;
}

const lines = (value: string) => value.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
const joined = (value: string[]) => value.join("\n");

export default function DesignStudioEditor({ initialSession }: { initialSession: DesignSessionRecord }) {
  const [session, setSession] = useState(initialSession);
  const [activeStep, setActiveStep] = useState(Math.min(7, Math.max(1, initialSession.currentStep)));
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const locked = session.status === "approved";
  const selectedStandards = session.standards.filter(item => item.state === "selected");
  const progress = Math.round((session.status === "approved" ? 7 : Math.max(activeStep, session.currentStep)) / 7 * 100);
  const readiness = {
    source: Boolean(session.source?.text.trim()), standards: selectedStandards.length > 0,
    competency: Boolean(session.competency?.successCriteria.length), rubric: Boolean(session.blueprint?.rubric.length),
    questions: Boolean(session.blueprint?.questions.length), validity: Boolean(session.validity),
  };

  const run = async (label: string, work: () => Promise<void>) => {
    setBusy(label); setError(""); setNotice("");
    try { await work(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "작업을 완료하지 못했습니다."); }
    finally { setBusy(""); }
  };
  const update = (patch: Partial<DesignSessionRecord>) => setSession(current => ({ ...current, ...patch }));
  const save = async (body: unknown, next?: number) => {
    const result = await callApi<{ session: DesignSessionRecord }>(`/api/teacher/design-sessions/${session.id}`, { method: "PATCH", body: JSON.stringify(body) });
    setSession(result.session);
    if (next) setActiveStep(next);
    setNotice("수정 내용이 안전하게 저장되었습니다.");
  };
  const generate = async (path: string, next?: number) => {
    const result = await callApi<{ session: DesignSessionRecord; generation?: { fallback?: boolean; warning?: string } }>(`/api/teacher/design-sessions/${session.id}/${path}`, { method: "POST", body: "{}" });
    setSession(result.session);
    if (next) setActiveStep(next);
    setNotice(result.generation?.fallback ? `기본 초안을 만들었습니다. ${result.generation.warning ?? "AI 연결을 확인해 주세요."}` : "AI 초안을 생성하고 이력까지 저장했습니다.");
  };

  const setStandards = (standards: AlignmentCandidate[]) => update({ standards });
  const setCompetency = (competency: CompetencyUnpack) => update({ competency });
  const setRubric = (rubric: RubricDraftItem[]) => update({ blueprint: { rubric, questions: session.blueprint?.questions ?? [], methods: ["text"], grading: session.blueprint?.grading ?? { upperThreshold: 80, middleThreshold: 50 } } });
  const setQuestions = (questions: QuestionDraft[]) => update({ blueprint: { rubric: session.blueprint?.rubric ?? [], questions, methods: ["text"], grading: session.blueprint?.grading ?? { upperThreshold: 80, middleThreshold: 50 } } });

  return <div className="design-editor-shell">
    <aside className="design-editor-rail">
      <Link href="/design" className="design-back-link">← 설계 목록</Link>
      <div className="design-rail-title"><span>{session.grade}</span><div><small>{session.grade}학년 {session.subject}</small><strong>{session.title}</strong></div></div>
      <div className="design-progress-copy"><span>설계 완성도</span><strong>{progress}%</strong></div><div className="design-progress-bar"><i style={{ width: `${progress}%` }} /></div>
      <nav aria-label="평가 설계 단계">{steps.map(([title, caption], index) => {
        const number = index + 1;
        const done = number < activeStep && number <= session.currentStep;
        return <button key={title} type="button" className={activeStep === number ? "active" : done ? "done" : ""} onClick={() => setActiveStep(number)}><b>{done ? "✓" : number}</b><span><strong>{title}</strong><small>{caption}</small></span></button>;
      })}</nav>
      <div className="design-rail-note"><b>교사 최종 판단 원칙</b><p>AI는 초안을 제안합니다. 성취기준 선택, 루브릭 문구, 공개 여부는 선생님이 결정합니다.</p></div>
    </aside>

    <section className="design-editor-main">
      <header className="design-editor-heading"><div><p className="kicker">STEP {activeStep} · {steps[activeStep - 1][1]}</p><h1>{steps[activeStep - 1][0]}</h1><p>{stepDescription(activeStep)}</p></div><span className={`design-status ${session.status}`}>{locked ? "승인 완료" : session.status === "ready" ? "승인 가능" : "자동 저장형 초안"}</span></header>
      {error && <p className="design-error" role="alert">{error}</p>}
      {notice && <p className="design-notice" role="status">{notice}</p>}

      <div className="design-work-card">
        {activeStep === 1 && <SourceStep session={session} locked={locked} onChange={update} onUpload={file => run("upload", async () => {
          const form = new FormData(); form.append("file", file);
          const result = await requestFormData<{ source: NonNullable<DesignSessionRecord["source"]> }>(`/api/teacher/design-sessions/${session.id}/sources/preview`, form);
          update({ source: { ...result.source, id: session.source?.id ?? "preview" } });
          setNotice("문서에서 글자를 추출했습니다. 내용을 확인한 뒤 저장하세요.");
        })} />}
        {activeStep === 2 && <StandardsStep standards={session.standards} locked={locked} onChange={setStandards} />}
        {activeStep === 3 && <CompetencyStep competency={session.competency} locked={locked} onChange={setCompetency} standards={selectedStandards} />}
        {activeStep === 4 && <RubricStep rubric={session.blueprint?.rubric ?? []} locked={locked} onChange={setRubric} />}
        {activeStep === 5 && <QuestionsStep questions={session.blueprint?.questions ?? []} rubric={session.blueprint?.rubric ?? []} standards={selectedStandards} locked={locked} onChange={setQuestions} />}
        {activeStep === 6 && <ValidityStep validity={session.validity} />}
        {activeStep === 7 && <ApprovalStep session={session} readiness={readiness} />}
      </div>

      <footer className="design-editor-actions">
        <button className="outline-button" type="button" disabled={activeStep === 1 || Boolean(busy)} onClick={() => setActiveStep(step => Math.max(1, step - 1))}>이전</button>
        <div>{stepAction(activeStep, { session, locked, busy, readiness, run, save, generate, setActiveStep, setSession, setNotice })}</div>
      </footer>
    </section>
  </div>;
}

function stepDescription(step: number) {
  return ["수업안·교육과정·차시 맥락을 평가 설계의 근거로 저장합니다.", "공식 2022 개정 초등 교육과정에서 실제로 평가할 기준을 고릅니다.", "성취기준을 학생 답안에서 관찰할 수 있는 작은 성공 기준으로 풉니다.", "점수표가 아니라 수행의 질적 차이가 드러나는 상·중·하 기준을 만듭니다.", "각 문항이 어떤 성취기준과 루브릭 증거를 수합하는지 연결합니다.", "구인 타당도·채점 신뢰도·공정성 위협을 배포 전에 점검합니다.", "전체 연결을 확인하고 기존 평가 보관함에 승인된 초안을 만듭니다."][step - 1];
}

type ActionContext = {
  session: DesignSessionRecord; locked: boolean; busy: string; readiness: Record<string, boolean>;
  run: (label: string, work: () => Promise<void>) => Promise<void>;
  save: (body: unknown, next?: number) => Promise<void>;
  generate: (path: string, next?: number) => Promise<void>;
  setActiveStep: (step: number) => void;
  setSession: (session: DesignSessionRecord) => void;
  setNotice: (notice: string) => void;
};

function stepAction(step: number, context: ActionContext) {
  const { session, locked, busy, readiness, run, save, generate, setSession, setNotice } = context;
  if (locked) return session.approvedAssessmentId ? <Link className="primary-button button-link design-action-link" href={`/assessments/${session.approvedAssessmentId}`}>생성된 평가 열기 →</Link> : null;
  if (step === 1) return <button className="primary-button" disabled={Boolean(busy) || !readiness.source} onClick={() => run("save-source", () => save({ title: session.title, learningGoal: session.learningGoal, source: session.source ? { kind: session.source.kind, fileName: session.source.fileName, mimeType: session.source.mimeType, sha256: session.source.sha256, text: session.source.text } : undefined, currentStep: 2 }, 2))}>{busy ? "처리 중…" : "자료 저장하고 다음 →"}</button>;
  if (step === 2) return <div className="design-dual-actions"><button className="outline-button" disabled={Boolean(busy)} onClick={() => run("suggest", () => generate("standards/suggest"))}>성취기준 추천</button><button className="primary-button" disabled={Boolean(busy) || !readiness.standards} onClick={() => run("save-standards", () => save({ standards: session.standards, currentStep: 3 }, 3))}>선택 저장하고 다음 →</button></div>;
  if (step === 3) return <div className="design-dual-actions"><button className="outline-button" disabled={Boolean(busy) || !readiness.standards} onClick={() => run("competency", () => generate("competency/unpack"))}>AI 성공 기준 초안</button><button className="primary-button" disabled={Boolean(busy) || !session.competency} onClick={() => run("save-competency", () => save({ competency: session.competency, currentStep: 4 }, 4))}>수정본 저장하고 다음 →</button></div>;
  if (step === 4) return <div className="design-dual-actions"><button className="outline-button" disabled={Boolean(busy) || !readiness.competency} onClick={() => run("rubric", () => generate("rubric/generate"))}>AI 루브릭 초안</button><button className="primary-button" disabled={Boolean(busy) || !readiness.rubric} onClick={() => run("save-rubric", () => save({ rubric: session.blueprint?.rubric, currentStep: 5 }, 5))}>루브릭 저장하고 다음 →</button></div>;
  if (step === 5) return <div className="design-dual-actions"><button className="outline-button" disabled={Boolean(busy) || !readiness.rubric} onClick={() => run("questions", () => generate("assessment/generate"))}>AI 평가 문항 초안</button><button className="primary-button" disabled={Boolean(busy) || !readiness.questions} onClick={() => run("save-questions", () => save({ questions: session.blueprint?.questions, currentStep: 6 }, 6))}>문항 저장하고 점검 →</button></div>;
  if (step === 6) return <div className="design-dual-actions"><button className="outline-button" disabled={Boolean(busy) || !readiness.questions} onClick={() => run("audit", () => generate("validity/audit"))}>타당도 다시 점검</button><button className="primary-button" disabled={Boolean(busy) || !session.validity || session.validity.blocked} onClick={() => context.setActiveStep(7)}>승인 단계로 →</button></div>;
  return <button className="primary-button design-approve-button" disabled={Boolean(busy) || !session.validity || session.validity.blocked} onClick={() => run("approve", async () => {
    const result = await callApi<{ session: DesignSessionRecord }>(`/api/teacher/design-sessions/${session.id}/approve`, { method: "POST", body: "{}" });
    setSession(result.session); setNotice("교사 승인본이 평가 보관함에 생성되었습니다. 이제 학급에 배포할 수 있습니다.");
  })}>{busy ? "승인본 생성 중…" : "✓ 교사 승인하고 평가 만들기"}</button>;
}

function SourceStep({ session, locked, onChange, onUpload }: { session: DesignSessionRecord; locked: boolean; onChange: (patch: Partial<DesignSessionRecord>) => void; onUpload: (file: File) => void }) {
  return <div className="design-form-stack">
    <div className="design-two-fields"><label><span>평가 이름</span><input disabled={locked} value={session.title} onChange={event => onChange({ title: event.target.value })} /></label><label><span>학년·교과</span><input disabled value={`${session.grade}학년 ${session.subject}`} /></label></div>
    <label><span>학습 목표</span><textarea className="short" disabled={locked} value={session.learningGoal} onChange={event => onChange({ learningGoal: event.target.value })} /></label>
    <label><span>수업안·교육과정 원문</span><textarea className="source" disabled={locked} value={session.source?.text ?? ""} onChange={event => onChange({ source: { id: session.source?.id ?? "draft", kind: session.source?.kind ?? "direct_text", fileName: session.source?.fileName ?? null, mimeType: session.source?.mimeType ?? null, sha256: session.source?.sha256 ?? null, text: event.target.value } })} /></label>
    {!locked && <div className="design-upload-row"><label className="design-file-button">PDF·TXT·XLSX·CSV 불러오기<input type="file" accept=".pdf,.txt,.xlsx,.csv" onChange={event => { const file = event.target.files?.[0]; if (file) onUpload(file); }} /></label><small>{session.source?.fileName ? `${session.source.fileName}에서 추출한 글을 확인 중입니다.` : "HWP는 PDF로 저장한 뒤 올려 주세요. 원문 파일 자체는 저장하지 않습니다."}</small></div>}
  </div>;
}

function StandardsStep({ standards, locked, onChange }: { standards: AlignmentCandidate[]; locked: boolean; onChange: (value: AlignmentCandidate[]) => void }) {
  if (!standards.length) return <div className="design-empty-stage"><span>02</span><h2>아직 성취기준 후보가 없습니다.</h2><p>아래의 ‘성취기준 추천’을 누르면 학년·교과와 수업자료에 맞는 공식 기준을 찾아옵니다.</p></div>;
  return <div className="design-standard-list">{standards.map((standard, index) => <label className={standard.state === "selected" ? "selected" : ""} key={standard.code}>
    <input type="checkbox" disabled={locked} checked={standard.state === "selected"} onChange={event => onChange(standards.map((item, itemIndex) => itemIndex === index ? { ...item, state: event.target.checked ? "selected" : "suggested" } : item))} />
    <span><b>{standard.code}</b><small>{standard.domain}</small></span><div><strong>{standard.content}</strong><p>{standard.rationale}</p></div><em>{Math.round(standard.confidence * 100)}%</em>
  </label>)}</div>;
}

function CompetencyStep({ competency, standards, locked, onChange }: { competency: CompetencyUnpack | null; standards: AlignmentCandidate[]; locked: boolean; onChange: (value: CompetencyUnpack) => void }) {
  if (!competency) return <div className="design-empty-stage"><span>03</span><h2>성취기준을 관찰 가능한 수행으로 풉니다.</h2><p>AI 초안을 만든 뒤 선생님의 수업 의도와 학생 수준에 맞게 고쳐 주세요.</p></div>;
  return <div className="design-form-stack"><label><span>핵심 아이디어</span><textarea className="short" disabled={locked} value={competency.bigIdea} onChange={event => onChange({ ...competency, bigIdea: event.target.value })} /></label>
    <div className="design-two-fields"><label><span>관찰 가능한 행동 · 한 줄에 하나</span><textarea disabled={locked} value={joined(competency.observableIndicators)} onChange={event => onChange({ ...competency, observableIndicators: lines(event.target.value) })} /></label><label><span>자주 나타나는 오개념 · 한 줄에 하나</span><textarea disabled={locked} value={joined(competency.misconceptions)} onChange={event => onChange({ ...competency, misconceptions: lines(event.target.value) })} /></label></div>
    <div className="design-section-label"><span>성공 기준</span><small>학생 답안에서 무엇을 보면 도달했다고 판단할지 씁니다.</small></div>
    <div className="design-criterion-list">{competency.successCriteria.map((criterion, index) => <article key={criterion.id}><b>{index + 1}</b><div><input disabled={locked} aria-label={`${index + 1}번 성공 기준 이름`} value={criterion.name} onChange={event => onChange({ ...competency, successCriteria: competency.successCriteria.map((item, i) => i === index ? { ...item, name: event.target.value } : item) })} /><textarea disabled={locked} aria-label={`${index + 1}번 성공 기준 증거`} value={criterion.evidence} onChange={event => onChange({ ...competency, successCriteria: competency.successCriteria.map((item, i) => i === index ? { ...item, evidence: event.target.value } : item) })} /><select disabled={locked} value={criterion.standardCode} onChange={event => onChange({ ...competency, successCriteria: competency.successCriteria.map((item, i) => i === index ? { ...item, standardCode: event.target.value } : item) })}>{standards.map(item => <option key={item.code}>{item.code}</option>)}</select></div></article>)}</div>
  </div>;
}

function RubricStep({ rubric, locked, onChange }: { rubric: RubricDraftItem[]; locked: boolean; onChange: (value: RubricDraftItem[]) => void }) {
  if (!rubric.length) return <div className="design-empty-stage"><span>04</span><h2>아직 루브릭 초안이 없습니다.</h2><p>성공 기준을 바탕으로 질적으로 구분되는 상·중·하 수행 서술을 만듭니다.</p></div>;
  const update = (index: number, patch: Partial<RubricDraftItem>) => onChange(rubric.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  return <div className="design-rubric-stack">{rubric.map((item, index) => <article key={item.id}><header><div><span>기준 {index + 1}</span><input disabled={locked} value={item.name} onChange={event => update(index, { name: event.target.value })} /></div><b>{item.standardCode}</b></header><textarea className="rubric-description" disabled={locked} value={item.description} onChange={event => update(index, { description: event.target.value })} /><div className="design-rubric-levels"><label className="high"><span>상 · 독립적 성취</span><textarea disabled={locked} value={item.high} onChange={event => update(index, { high: event.target.value })} /></label><label className="middle"><span>중 · 부분 성취</span><textarea disabled={locked} value={item.middle} onChange={event => update(index, { middle: event.target.value })} /></label><label className="low"><span>하 · 지원 필요</span><textarea disabled={locked} value={item.low} onChange={event => update(index, { low: event.target.value })} /></label></div></article>)}</div>;
}

function QuestionsStep({ questions, rubric, standards, locked, onChange }: { questions: QuestionDraft[]; rubric: RubricDraftItem[]; standards: AlignmentCandidate[]; locked: boolean; onChange: (value: QuestionDraft[]) => void }) {
  if (!questions.length) return <div className="design-empty-stage"><span>05</span><h2>평가 문항을 생성할 차례입니다.</h2><p>각 문항은 하나의 성취기준과 루브릭 기준에 연결되고, 학생이 보여야 할 증거까지 함께 저장됩니다.</p></div>;
  const update = (index: number, patch: Partial<QuestionDraft>) => onChange(questions.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  return <div className="design-question-stack">{questions.map((item, index) => <article key={item.id}><header><span>문항 {index + 1}</span><button type="button" disabled={locked || questions.length === 1} onClick={() => onChange(questions.filter((_, i) => i !== index))}>삭제</button></header><textarea className="question-prompt" disabled={locked} value={item.prompt} onChange={event => update(index, { prompt: event.target.value })} /><div className="design-question-meta"><label><span>성취기준</span><select disabled={locked} value={item.standardCode} onChange={event => { const nextCode = event.target.value; const nextCriterion = rubric.find(r => r.standardCode === nextCode)?.name ?? item.criterion; update(index, { standardCode: nextCode, criterion: nextCriterion }); }}>{standards.map(standard => <option key={standard.code}>{standard.code}</option>)}</select></label><label><span>루브릭 기준</span><select disabled={locked} value={item.criterion} onChange={event => update(index, { criterion: event.target.value })}>{rubric.filter(r => r.standardCode === item.standardCode).map(r => <option key={r.id}>{r.name}</option>)}</select></label><label><span>배점</span><input disabled={locked} type="number" min="1" max="100" value={item.points} onChange={event => update(index, { points: Number(event.target.value) })} /></label></div><label><span>기대 증거</span><textarea disabled={locked} value={item.evidenceExpected} onChange={event => update(index, { evidenceExpected: event.target.value })} /></label></article>)}</div>;
}

function ValidityStep({ validity }: { validity: DesignSessionRecord["validity"] }) {
  if (!validity) return <div className="design-empty-stage"><span>06</span><h2>배포 전 품질 점검이 필요합니다.</h2><p>문항이 실제 학습 목표를 측정하는지, 다른 능력 때문에 결과가 왜곡되지 않는지 확인합니다.</p></div>;
  return <div className="design-audit"><header className={validity.blocked ? "blocked" : "passed"}><span>{validity.blocked ? "!" : "✓"}</span><div><small>종합 판단</small><h2>{validity.overall}</h2><p>{validity.blocked ? "중대한 경고를 수정한 뒤 다시 점검해야 승인할 수 있습니다." : "교사 검토 후 승인 단계로 이동할 수 있습니다."}</p></div></header><div className="design-audit-grid"><article><span>구인 타당도</span><p>{validity.constructValidity}</p></article><article><span>채점 신뢰도</span><p>{validity.reliability}</p></article><article><span>결과 타당도</span><p>{validity.consequentialValidity}</p></article></div>{validity.threats.length > 0 && <div className="design-threat-list"><h3>확인할 위험 요소</h3>{validity.threats.map((threat, index) => <article key={`${threat.issue}-${index}`}><b className={threat.severity}>{threat.severity === "major" ? "중대" : threat.severity === "moderate" ? "보통" : "경미"}</b><div><strong>{threat.issue}</strong><p>{threat.recommendation}</p></div></article>)}</div>}</div>;
}

function ApprovalStep({ session, readiness }: { session: DesignSessionRecord; readiness: Record<string, boolean> }) {
  const checks = [["수업자료", readiness.source], ["성취기준", readiness.standards], ["성공 기준", readiness.competency], ["루브릭", readiness.rubric], ["평가 문항", readiness.questions], ["타당도 점검", readiness.validity && !session.validity?.blocked]] as const;
  return <div className="design-approval"><div className="design-approval-mark">{session.status === "approved" ? "✓" : "M"}</div><h2>{session.status === "approved" ? "평가 초안이 생성되었습니다." : "선생님의 최종 승인을 기다립니다."}</h2><p>승인하면 현재 설계가 기존 평가 보관함에 초안으로 생성됩니다. 이후 학급을 선택하고 QR·링크로 배포할 수 있습니다.</p><div className="design-approval-checks">{checks.map(([label, ready]) => <span className={ready ? "ready" : ""} key={label}><b>{ready ? "✓" : "·"}</b>{label}</span>)}</div><div className="design-approval-summary"><span>{session.grade}학년 {session.subject}</span><strong>{session.title}</strong><p>{session.learningGoal}</p><small>{selectedCount(session)}개 성취기준 · {session.blueprint?.rubric.length ?? 0}개 루브릭 기준 · {session.blueprint?.questions.length ?? 0}문항</small></div></div>;
}

const selectedCount = (session: DesignSessionRecord) => session.standards.filter(item => item.state === "selected").length;
