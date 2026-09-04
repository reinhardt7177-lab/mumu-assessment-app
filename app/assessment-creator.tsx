"use client";

import { useEffect, useRef, useState } from "react";
import AchievementStandardPicker, { type AchievementStandard } from "./achievement-standard-picker";
import type { AssessmentDefinition, AssessmentMethod, AssessmentQuestion, AssessmentRecord } from "../lib/assessment-domain";
import { requestJson } from "../lib/client-api";

const steps = ["기본 정보", "성취기준", "평가 문항", "응답 방법", "루브릭", "저장·배포"];
const subjects = Array.from({ length: 6 }, (_, i) => i + 1).flatMap(grade => (grade < 3 ? ["국어", "수학"] : ["국어", "사회", "수학", "과학", "도덕", "영어"]).map(subject => `${grade}학년 ${subject}`));
const responseMethods: Array<{ id: AssessmentMethod; title: string; description: string }> = [
  { id: "text", title: "온라인 답안", description: "화면에서 직접 작성·제출" },
  { id: "photo", title: "종이 시험지·OCR", description: "손글씨 사진을 글자로 변환" },
  { id: "speech", title: "오럴 테스트", description: "녹음 후 전사 내용 확인" },
  { id: "chat", title: "평가 챗봇", description: "대화·시간·도움 수준 분석" },
  { id: "screen", title: "화면 녹화", description: "디지털 수행 과정 30초 수합" },
];
const initialRubric: AssessmentDefinition["rubric"] = ["개념 이해", "근거 제시", "논리적 설명"].map(name => ({ name, high: "핵심 내용을 정확하고 구체적으로 설명한다.", middle: "핵심 내용을 설명하나 일부 보완이 필요하다.", low: "핵심 내용을 설명하는 데 안내와 도움이 필요하다." }));
const historyDateFormat = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" });
export type CurriculumAssessmentContext = {
  termId: string;
  unitId: string;
  unitTitle: string;
  subject: string;
  standards: AchievementStandard[];
  rubric: AssessmentDefinition["rubric"];
};
type QuestionGenerationHistory = {
  id: string;
  title: string;
  subject: string;
  learningGoal: string;
  requestedCount: number;
  output: { questions: Omit<AssessmentQuestion, "id">[] };
  createdAt: string;
};

export default function AssessmentCreator({ onClose, onCreated, curriculumContext }: { onClose: () => void; onCreated: (a: AssessmentRecord) => void; curriculumContext?: CurriculumAssessmentContext }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState(curriculumContext ? `${curriculumContext.unitTitle} 평가` : "");
  const [subject, setSubject] = useState(curriculumContext?.subject ?? "6학년 사회");
  const [type, setType] = useState<AssessmentDefinition["type"]>("독립 수행평가");
  const [goal, setGoal] = useState("");
  const [standards, setStandards] = useState<AchievementStandard[]>(curriculumContext?.standards ?? []);
  const [questions, setQuestions] = useState<AssessmentQuestion[]>([]);
  const [rubric, setRubric] = useState<AssessmentDefinition["rubric"]>(curriculumContext?.rubric ?? initialRubric);
  const [methods, setMethods] = useState<AssessmentMethod[]>(["text"]);
  const [grading, setGrading] = useState({ upperThreshold: 80, middleThreshold: 50 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [generated, setGenerated] = useState(false);
  const [generationNotice, setGenerationNotice] = useState<{ id: string; cached: boolean } | null>(null);
  const [generationHistory, setGenerationHistory] = useState<QuestionGenerationHistory[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [historyRefresh, setHistoryRefresh] = useState(0);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    if (step !== 2) return;
    let ignore = false;
    requestJson<{ generations: QuestionGenerationHistory[] }>("/api/teacher/ai/question-generations?limit=12")
      .then(data => { if (!ignore) { setGenerationHistory(data.generations); setHistoryError(""); } })
      .catch(reason => { if (!ignore) setHistoryError(reason instanceof Error ? reason.message : "저장된 문항 이력을 불러오지 못했습니다."); });
    return () => { ignore = true; };
  }, [step, historyRefresh]);
  const updateQuestion = (id: string, patch: Partial<AssessmentQuestion>) => setQuestions(current => current.map(q => q.id === id ? { ...q, ...patch } : q));
  const rubricFor = (standardCode: string) => rubric.filter(item => !item.standardCode || item.standardCode === standardCode);
  const firstRubricFor = (standardCode: string) => rubricFor(standardCode)[0] ?? rubric[0];
  const addQuestion = () => { const standardCode = standards[0]?.code ?? ""; const criterion = firstRubricFor(standardCode); setQuestions(current => [...current, { id: crypto.randomUUID(), prompt: "", kind: "서술형", standardCode, criterion: criterion.name, rubricCriterionId: criterion.rubricCriterionId, points: 10 }]); };
  const changeQuestionStandard = (id: string, standardCode: string) => { const criterion = firstRubricFor(standardCode); updateQuestion(id, { standardCode, criterion: criterion.name, rubricCriterionId: criterion.rubricCriterionId }); };
  const changeQuestionCriterion = (id: string, standardCode: string, name: string) => { const criterion = rubricFor(standardCode).find(item => item.name === name) ?? firstRubricFor(standardCode); updateQuestion(id, { criterion: criterion.name, rubricCriterionId: criterion.rubricCriterionId }); };
  const generate = async () => {
    if (questions.length > 0 && !window.confirm("새 문항 초안을 만들면 현재 작성한 문항이 교체됩니다. 계속할까요?")) return;
    setBusy(true); setError(""); setGenerated(false); setGenerationNotice(null);
    try {
      const data = await requestJson<{ generationId: string; cached: boolean; questions: Omit<AssessmentQuestion, "id">[] }>("/api/ai/questions", { method: "POST", body: JSON.stringify({ title, subject, learningGoal: goal, standards, count: 3 }), signal: AbortSignal.timeout(45000) });
      setQuestions(data.questions.map(q => { const criterion = rubricFor(q.standardCode).find(item => item.name === q.criterion) ?? firstRubricFor(q.standardCode); return { ...q, id: crypto.randomUUID(), criterion: criterion.name, rubricCriterionId: criterion.rubricCriterionId }; }));
      setGenerated(true);
      setGenerationNotice({ id: data.generationId, cached: data.cached });
      setHistoryRefresh(value => value + 1);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "문항 생성에 실패했습니다."); }
    finally { setBusy(false); }
  };
  const reuseGeneration = (generation: QuestionGenerationHistory) => {
    const savedQuestions = generation.output?.questions ?? [];
    const compatible = generation.subject === subject && savedQuestions.length > 0
      && savedQuestions.every(question => standards.some(standard => standard.code === question.standardCode));
    if (!compatible) {
      setHistoryError("현재 학년·교과와 선택한 성취기준에 맞는 초안만 불러올 수 있습니다.");
      return;
    }
    if (questions.length > 0 && !window.confirm("저장된 문항 초안을 불러오면 현재 작성한 문항이 교체됩니다. 계속할까요?")) return;
    setQuestions(savedQuestions.map(question => { const criterion = rubricFor(question.standardCode).find(item => item.name === question.criterion) ?? firstRubricFor(question.standardCode); return { ...question, id: crypto.randomUUID(), criterion: criterion.name, rubricCriterionId: criterion.rubricCriterionId }; }));
    setGenerated(true);
    setGenerationNotice({ id: generation.id, cached: true });
    setHistoryError("");
  };
  const save = async () => {
    setBusy(true); setError("");
    try {
      const definition: AssessmentDefinition = { title, subject, learningGoal: goal, type, standardCodes: standards.map(s => s.code), questions, methods, rubric, grading };
      const payload = curriculumContext ? { definition, curriculumLink: { unitId: curriculumContext.unitId, eventType: type === "독립 수행평가" ? "initial" : "formative", context: `${goal}\n\n학생 수행 과제: ${title}`, occurredAt: new Date().toISOString() } } : definition;
      const data = await requestJson<{ assessment: AssessmentRecord }>("/api/teacher/assessments", { method: "POST", body: JSON.stringify(payload) });
      onCreated(data.assessment);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "저장하지 못했습니다."); }
    finally { setBusy(false); }
  };
  const valid = step === 0 ? title.trim().length >= 2 && goal.trim().length >= 5 : step === 1 ? standards.length > 0 : step === 2 ? questions.length > 0 && questions.every(q => q.prompt.trim().length >= 5 && q.points >= 1 && standards.some(s => s.code === q.standardCode)) : step === 4 ? rubric.every(r => r.name.trim() && r.high.trim().length >= 5 && r.middle.trim().length >= 5 && r.low.trim().length >= 5) && grading.upperThreshold > grading.middleThreshold : true;
  const total = questions.reduce((sum, q) => sum + q.points, 0);

  return <dialog ref={dialog} className="create-modal real-dialog" aria-labelledby="creator-title" onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <div className="modal-heading"><div><p className="kicker">초등 평가 만들기 · {step + 1} / 6</p><h2 id="creator-title">{steps[step]}</h2></div><button disabled={busy} onClick={onClose} aria-label="평가 만들기 닫기">×</button></div>
    <ol className="real-steps">{steps.map((name, index) => <li key={name} aria-current={step === index ? "step" : undefined} className={step >= index ? "active" : ""}>{index + 1} {name}</li>)}</ol>
    {error && <p className="ai-generation-error" role="alert">{error}</p>}
    {step === 0 && <div className="wizard-body">{curriculumContext ? <div className="curriculum-assessment-link-note"><span>교육과정 연결</span><strong>{curriculumContext.unitTitle}</strong><small>제출 답안이 이 단원의 성장 증거로 자동 수합됩니다.</small></div> : null}<label>평가 이름<input maxLength={120} value={title} onChange={e => setTitle(e.target.value)} placeholder="예: 우리 지역의 변화 살펴보기" /></label><div className="field-row"><label>학년·교과<select value={subject} disabled={Boolean(curriculumContext)} onChange={e => { setSubject(e.target.value); setStandards([]); setQuestions([]); }}>{subjects.map(s => <option key={s}>{s}</option>)}</select></label><label>평가 유형<select value={type} onChange={e => setType(e.target.value as AssessmentDefinition["type"])}><option>독립 수행평가</option><option>지원형 형성평가</option></select></label></div><label>학습 목표<textarea maxLength={1000} value={goal} onChange={e => setGoal(e.target.value)} placeholder="학생이 어떤 내용을 설명하거나 수행할 수 있어야 하나요?" /></label></div>}
    {step === 1 && (curriculumContext ? <div className="wizard-body linked-standard-list"><p className="wizard-guide">이 단원에서 루브릭을 잠근 성취기준만 사용합니다. 단원 밖 기준은 섞이지 않습니다.</p>{standards.map(standard => <article key={standard.code}><strong>{standard.code}</strong><span>{standard.domain}</span><p>{standard.content}</p></article>)}</div> : <AchievementStandardPicker key={subject} subjectLabel={subject} selected={standards} onChange={setStandards} />)}
    {step === 2 && <div className="wizard-body question-builder">
      <div className="question-builder-heading"><div><p className="wizard-guide">성취기준 → 문항 → 판단 근거를 연결합니다. 총 {questions.length}문항 · {total}점</p><span>AI 생성 결과는 교사 계정에 저장되며, 최종 문항은 반드시 교사가 검토합니다.</span></div><button type="button" className="ai-question-button" disabled={busy} onClick={generate}>{busy ? "문항 초안 만드는 중…" : questions.length > 0 ? "✦ 문항 초안 다시 만들기" : "✦ 문항 초안 만들기"}</button></div>
      {questions.length > 0 && <small>문항 초안을 다시 만들면 확인 후 현재 문항을 새 초안으로 교체합니다.</small>}
      {generated && <p className="save-notice">AI 초안입니다. 내용·정답 가능성·발달 수준을 교사가 검토해 주세요.{generationNotice && <> · {generationNotice.cached ? "저장된 동일 초안 불러옴" : "새 생성 이력 저장 완료"} <code>{generationNotice.id.slice(0, 8)}</code></>}</p>}
      {historyError && <p className="ai-generation-error" role="alert">{historyError}</p>}
      {generationHistory.length > 0 && <details className="question-history">
        <summary>저장된 문항 초안 <strong>{generationHistory.length}</strong></summary>
        <div className="question-history-list">{generationHistory.map(generation => {
          const savedQuestions = generation.output?.questions ?? [];
          const compatible = generation.subject === subject && savedQuestions.length > 0 && savedQuestions.every(question => standards.some(standard => standard.code === question.standardCode));
          return <article key={generation.id}><div><strong>{generation.title || "이름 없는 평가"}</strong><span>{generation.subject} · {generation.requestedCount}문항 · <time dateTime={generation.createdAt}>{historyDateFormat.format(new Date(generation.createdAt))}</time></span><small>{generation.learningGoal}</small></div><button type="button" disabled={busy || !compatible} onClick={() => reuseGeneration(generation)}>{compatible ? "불러오기" : "현재 기준과 다름"}</button></article>;
        })}</div>
      </details>}
      <div className="question-list">{questions.map((q, index) => <article className="question-editor" key={q.id}><div className="question-editor-head"><strong>문항 {index + 1}</strong><button onClick={() => setQuestions(current => current.filter(item => item.id !== q.id))}>삭제</button></div><label>문항 내용<textarea value={q.prompt} maxLength={2000} onChange={e => updateQuestion(q.id, { prompt: e.target.value })} /></label><div className="question-meta"><label>성취기준<select value={q.standardCode} onChange={e => changeQuestionStandard(q.id, e.target.value)}>{standards.map(s => <option key={s.code}>{s.code}</option>)}</select></label><label>평가 기준<select value={q.criterion} onChange={e => changeQuestionCriterion(q.id, q.standardCode, e.target.value)}>{rubricFor(q.standardCode).map(r => <option key={r.rubricCriterionId ?? `${r.standardCode ?? "all"}-${r.name}`}>{r.name}</option>)}</select></label><label>배점<input type="number" min={1} max={100} value={q.points} onChange={e => updateQuestion(q.id, { points: Number(e.target.value) })} /></label></div></article>)}</div>
      <button className="add-question-button" disabled={questions.length >= 20 || busy} onClick={addQuestion}>＋ 문항 직접 추가</button>
    </div>}
    {step === 3 && <div className="wizard-body"><p className="wizard-guide">학생에게 보여 줄 응답 방식을 하나 이상 선택하세요. 선택한 방식만 QR 시험지에 표시됩니다.</p><div className="method-grid">{responseMethods.map(option => { const selected = methods.includes(option.id); return <button type="button" key={option.id} className={selected ? "selected" : ""} aria-pressed={selected} onClick={() => setMethods(current => selected ? current.length === 1 ? current : current.filter(item => item !== option.id) : responseMethods.map(item => item.id).filter(item => [...current, option.id].includes(item)))}><span>{selected ? "✓" : "＋"}</span><strong>{option.title}</strong><small>{option.description}</small></button>; })}</div><p>학생은 QR·링크로 시험지만 엽니다. 사진·음성·화면 녹화는 이름·번호를 제외하고 학교 승인 설정이 켜진 경우에만 저장됩니다.</p></div>}
    {step === 4 && <div className="wizard-body">{curriculumContext ? <><p className="wizard-guide">단원에서 검토 완료·잠금한 준거 루브릭입니다. 이 평가에서는 수정하지 않으며, 학생 결과물에 실제로 나타난 수행을 기준별로 따로 판단합니다.</p><div className="locked-rubric-list">{rubric.map(r => <article key={r.rubricCriterionId ?? `${r.standardCode}-${r.name}`}><header><span>{r.standardCode}</span><strong>{r.name}</strong><em>잠김</em></header><p><b>상</b>{r.high}</p><p><b>중</b>{r.middle}</p><p><b>하</b>{r.low}</p></article>)}</div></> : <><p className="wizard-guide">아래 문구는 편집 가능한 출발점입니다. 실제 문항에서 관찰할 수 있는 수행으로 구체화해 주세요.</p>{rubric.map((r, index) => <article className="question-editor" key={index}><label>평가 기준 이름<input value={r.name} maxLength={80} onChange={e => { const name = e.target.value; setRubric(current => current.map((item, i) => i === index ? { ...item, name } : item)); setQuestions(current => current.map(q => q.criterion === r.name ? { ...q, criterion: name } : q)); }} /></label>{(["high", "middle", "low"] as const).map((level, i) => <label key={level}>{["상", "중", "하"][i]} 수준의 관찰 가능한 수행<textarea value={r[level]} maxLength={500} onChange={e => setRubric(current => current.map((item, j) => j === index ? { ...item, [level]: e.target.value } : item))} /></label>)}</article>)}</>}<h3>학생용 점수 환산 기준</h3><p>학생 시험지에 공개할 보조 결과입니다. 교육과정 성장 수준과 학기말 판단은 이 점수로 자동 확정하지 않습니다.</p><div className="field-row"><label>상: 총점 대비 몇 % 이상<input type="number" min={2} max={100} value={grading.upperThreshold} onChange={e => setGrading({ ...grading, upperThreshold: Number(e.target.value) })} /></label><label>중: 총점 대비 몇 % 이상<input type="number" min={1} max={99} value={grading.middleThreshold} onChange={e => setGrading({ ...grading, middleThreshold: Number(e.target.value) })} /></label></div></div>}
    {step === 5 && <div className="wizard-body"><div className="wizard-guide"><p className="kicker">저장 내용 확인</p><h2>{title}</h2><p>{subject} · {standards.length}개 성취기준 · {questions.length}문항 · {total}점</p></div><p>먼저 서버에 초안으로 저장합니다. 저장이 확인되면 평가 상세 화면에서 공개하고 QR·링크를 배포할 수 있습니다.</p>{curriculumContext ? <div className="curriculum-assessment-link-note"><span>자동 성장 기록</span><strong>{curriculumContext.unitTitle}</strong><small>등록 학생의 최종 제출을 원본 수행 증거로 수합합니다.</small></div> : null}<div className="lock-note">공개 후에는 문항과 루브릭이 잠깁니다. 다른 버전이 필요하면 새 평가로 만들어 주세요.</div></div>}
    <div className="modal-actions"><button className="outline-button" disabled={busy} onClick={() => step === 0 ? onClose() : setStep(step - 1)}>{step === 0 ? "취소" : "이전"}</button><button className="primary-button" disabled={!valid || busy} onClick={() => step === 5 ? void save() : setStep(step + 1)}>{busy ? "처리 중…" : step === 5 ? "서버에 평가 저장" : "다음"}</button></div>
  </dialog>;
}
