"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Answers, AssessmentDefinition, AttemptRecord, ReviewRecord } from "../lib/assessment-domain";
import { requestJson, RequestError } from "../lib/client-api";

type Exam = { id: string; status: "published" | "closed"; definition: AssessmentDefinition; rosterRequired: boolean };
type ExamPayload = { assessment: Exam; attempt: AttemptRecord | null; result: ReviewRecord | null };

export default function StudentExam({ code }: { code: string }) {
  const [exam, setExam] = useState<Exam | null>(null);
  const [attempt, setAttempt] = useState<AttemptRecord | null>(null);
  const [result, setResult] = useState<ReviewRecord | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [conflicted, setConflicted] = useState(false);
  const attemptRef = useRef<AttemptRecord | null>(null);
  const answersRef = useRef<Answers>({});
  const flight = useRef<Promise<void> | null>(null);
  const conflict = useRef(false);
  const started = useRef(0);
  const baseSeconds = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    requestJson<ExamPayload>(`/api/student/${code}`, { signal: controller.signal }).then(data => {
      setExam(data.assessment); setAttempt(data.attempt); attemptRef.current = data.attempt;
      setAnswers(data.attempt?.answers ?? {}); answersRef.current = data.attempt?.answers ?? {};
      setResult(data.result); setLabel(data.attempt?.studentLabel ?? "");
      baseSeconds.current = data.attempt?.timeSpentSeconds ?? 0; started.current = Date.now();
      if (data.attempt) setNotice(data.attempt.status === "submitted" ? "서버에 제출된 답안을 불러왔어요." : "서버에 저장된 답안을 불러왔어요.");
    }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [code]);

  const save = useCallback(async (submit = false) => {
    while (flight.current) await flight.current;
    const current = attemptRef.current;
    if (!current || current.status === "submitted" || conflict.current) return;
    const snapshot = { ...answersRef.current };
    setNotice(submit ? "서버에 제출하는 중…" : "서버에 저장하는 중…");
    setError("");
    const operation = (async () => {
      try {
        const data = await requestJson<{ attempt: AttemptRecord }>(`/api/student/${code}/attempt`, {
          method: "PUT", body: JSON.stringify({ answers: snapshot, revision: current.revision, timeSpentSeconds: Math.min(86400, baseSeconds.current + Math.floor((Date.now() - started.current) / 1000)), submit }),
        });
        attemptRef.current = data.attempt; setAttempt(data.attempt);
        if (JSON.stringify(snapshot) === JSON.stringify(answersRef.current)) {
          setDirty(false); setNotice(submit ? "제출 완료 · 서버 저장이 확인됐어요." : `서버 저장 완료 · ${new Date(data.attempt.savedAt).toLocaleTimeString("ko-KR")}`);
        } else setNotice("새로 쓴 내용은 저장 대기 중이에요.");
      } catch (reason) {
        if (reason instanceof RequestError && reason.status === 409) { conflict.current = true; setConflicted(true); }
        setError(reason instanceof Error ? reason.message : "저장에 실패했어요. 화면을 닫지 마세요.");
        setNotice("아직 서버에 저장되지 않은 내용이 있어요.");
      }
    })();
    flight.current = operation;
    await operation;
    if (flight.current === operation) flight.current = null;
  }, [code]);

  useEffect(() => {
    if (!dirty || !attempt || attempt.status === "submitted" || busy) return;
    const timer = window.setTimeout(() => void save(), 1200);
    return () => window.clearTimeout(timer);
  }, [answers, dirty, attempt, busy, save]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const start = async () => {
    setBusy(true); setError("");
    try {
      const data = await requestJson<{ attempt: AttemptRecord }>(`/api/student/${code}/attempt`, { method: "POST", body: JSON.stringify({ studentLabel: label }) });
      attemptRef.current = data.attempt; setAttempt(data.attempt);
      answersRef.current = data.attempt.answers; setAnswers(data.attempt.answers);
      baseSeconds.current = data.attempt.timeSpentSeconds; started.current = Date.now();
      setNotice("참여 정보가 서버에 저장됐어요. 이제 답을 써보세요.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "참여하지 못했어요."); }
    finally { setBusy(false); }
  };
  const submit = async () => { setBusy(true); await save(true); setBusy(false); };
  const refreshResult = async () => {
    setBusy(true); setError("");
    try { const data = await requestJson<ExamPayload>(`/api/student/${code}`); setResult(data.result); if (!data.result) setNotice("선생님이 아직 결과를 공개하지 않았어요."); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "결과를 불러오지 못했어요."); }
    finally { setBusy(false); }
  };
  const submitted = attempt?.status === "submitted";
  const completed = exam?.definition.questions.filter(q => answers[q.id]?.trim()).length ?? 0;

  return <main className="exam-shell real-exam">
    <header className="exam-header"><div className="exam-brand"><span>M</span><strong>Mumu 평가</strong></div><span>학생 시험지</span></header>
    <div className="student-page standalone-student-page">
      {loading && <p role="status">평가를 불러오는 중이에요…</p>}
      {error && <div className="ai-generation-error" role="alert">{error}</div>}
      {exam && <>
        <section className="exam-title-card"><div><p className="kicker">{exam.definition.subject} · {exam.definition.type}</p><h1>{exam.definition.title}</h1><p>{exam.definition.learningGoal}</p></div><strong>{completed} / {exam.definition.questions.length}문항</strong></section>
        {!attempt && exam.status === "published" && <section className="response-card student-identification"><h2>누구의 답안인가요?</h2><p>{exam.rosterRequired ? "선생님이 학기 명부에 등록한 학생 참조 번호를 정확히 입력해 주세요." : "선생님이 알려준 번호 또는 별칭만 써주세요."} 이 화면에는 교사용 메뉴가 없어요.</p><label htmlFor="student-label">{exam.rosterRequired ? "학생 참조 번호" : "번호 또는 별칭"}</label><input id="student-label" maxLength={40} value={label} onChange={event => setLabel(event.target.value)} placeholder={exam.rosterRequired ? "예: 6-1-01" : "예: 3반 12번"} autoComplete="off" /><button className="primary-button" onClick={start} disabled={busy || !label.trim()}>{busy ? "참여하는 중…" : "평가 시작하기"}</button></section>}
        {exam.status === "closed" && <p className="wizard-guide">이 평가는 마감되었어요. 저장된 답안과 공개된 결과는 확인할 수 있어요.</p>}
        {notice && <p className="save-notice" role="status">{notice}</p>}
        {exam.definition.questions.map((question, index) => <section className="response-card real-question" key={question.id}>
          <div className="question-editor-head"><p className="kicker">문항 {index + 1}</p><span>{question.points}점 · {question.criterion}</span></div>
          <h2 style={{ whiteSpace: "pre-wrap" }}>{question.prompt}</h2>
          <label className="sr-only" htmlFor={`answer-${question.id}`}>문항 {index + 1} 답안</label>
          <textarea id={`answer-${question.id}`} value={answers[question.id] ?? ""} maxLength={10000} disabled={!attempt || submitted || busy || exam.status === "closed"} onChange={event => { const next = { ...answersRef.current, [question.id]: event.target.value }; answersRef.current = next; setAnswers(next); setDirty(true); setNotice("변경 내용 저장 대기 중…"); }} placeholder={attempt ? "나의 생각과 근거를 써주세요." : "위에서 번호 또는 별칭을 입력하고 시작해 주세요."} />
          <small>{(answers[question.id] ?? "").length} / 10,000자</small>
        </section>)}
        {attempt && !submitted && exam.status === "published" && <div className="student-actions"><button className="outline-button" disabled={busy || conflicted} onClick={() => void save()}>지금 저장</button><button className="primary-button" disabled={busy || completed !== exam.definition.questions.length || conflicted} onClick={submit}>{busy ? "저장하는 중…" : "답안 최종 제출"}</button></div>}
        {submitted && <section className="response-card result-card"><p className="kicker">{label}의 평가 결과</p>{result ? <><h2>시험 결과 {result.level} · {result.total} / {result.maxTotal}점</h2><p className="student-feedback">{result.feedback}</p>{result.questionScores.map(score => <p key={score.questionId}>{exam.definition.questions.findIndex(q => q.id === score.questionId) + 1}번 · {score.points}점 — {score.reason}</p>)}{exam.rosterRequired ? <p className="growth-result-note">교육과정 성장 수준은 선생님이 여러 수행 증거와 추가 학습을 함께 살펴 별도로 판단합니다.</p> : null}</> : <><h2>답안이 제출됐어요.</h2><p>{exam.rosterRequired ? "답안은 단원 성장 기록에 안전하게 수합됐어요. " : ""}선생님이 확인하고 공개하면 이 시험지에서 내 결과를 볼 수 있어요.</p></>}<button className="outline-button" disabled={busy} onClick={refreshResult}>결과 다시 확인</button></section>}
        <p className="exam-footer-note">답안은 서버에 저장됩니다. 결과 확인에는 지금 기기의 참여 정보가 필요해요. 공용 기기를 다른 친구에게 넘기기 전 선생님께 알려주세요.</p>
      </>}
      {!loading && !exam && <p className="exam-footer-note">제출된 것으로 표시하지 않았습니다. 선생님께 올바른 링크인지 확인해 주세요.</p>}
    </div>
  </main>;
}
