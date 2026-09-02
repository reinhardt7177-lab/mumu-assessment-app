"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { AssessmentRecord, AttemptRecord, ReviewRecord } from "../lib/assessment-domain";
import type { DistributionRecord } from "../db/classroom-repository";
import { requestJson } from "../lib/client-api";

type Submission = AttemptRecord & { review: ReviewRecord | null };
const reviewState = { draft: "검토 중", final: "교사 확정", published: "학생 공개" };

export default function AssessmentDetail({ initialAssessment, initialSubmissions, initialDistribution }: { initialAssessment: AssessmentRecord; initialSubmissions: Submission[]; initialDistribution: DistributionRecord | null }) {
  const [assessment, setAssessment] = useState(initialAssessment);
  const [submissions, setSubmissions] = useState(initialSubmissions);
  const [distribution, setDistribution] = useState(initialDistribution);
  const [selected, setSelected] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => { const frame = requestAnimationFrame(() => setOrigin(window.location.origin)); return () => cancelAnimationFrame(frame); }, []);
  const joinUrl = `${origin}/join/${distribution?.shareCode ?? assessment.shareCode}`;
  const refresh = async () => {
    setBusy(true); setError("");
    try {
      const query = distribution ? `?distribution=${distribution.id}` : "";
      const data = await requestJson<{ assessment: AssessmentRecord; submissions: Submission[]; distribution: DistributionRecord | null }>(`/api/teacher/assessments/${assessment.id}${query}`);
      setAssessment(data.assessment); setSubmissions(data.submissions); setDistribution(data.distribution);
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : "결과를 불러오지 못했습니다."); }
    finally { setBusy(false); }
  };
  const changeStatus = async (status: "published" | "closed") => {
    if (status === "closed" && !window.confirm("평가를 마감하면 새 참여와 미제출 답안의 저장이 중단됩니다. 마감할까요?")) return;
    setBusy(true); setError("");
    try {
      const data = await requestJson<{ assessment: AssessmentRecord }>(`/api/teacher/assessments/${assessment.id}/status`, { method: "POST", body: JSON.stringify({ status }) });
      setAssessment(data.assessment); setNotice(status === "published" ? "평가를 공개했습니다. QR과 링크를 배포할 수 있습니다." : "평가를 마감했습니다. 제출된 답안은 그대로 보존됩니다.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "상태를 바꾸지 못했습니다."); }
    finally { setBusy(false); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(joinUrl); setNotice("학생 시험지 링크를 복사했습니다."); } catch { setError("자동 복사에 실패했습니다. 아래 링크를 직접 선택해 복사해 주세요."); } };
  const exportCsv = () => {
    const cell = (value: unknown) => { const s = String(value ?? ""); return `"${(/^[=+@\-\t\r]/.test(s) ? "'" + s : s).replaceAll('"', '""')}"`; };
    const rows = [["학생 번호·별칭", "제출 시각", "상태", "점수", "만점", "시험 결과 수준", "피드백"], ...submissions.map(s => [s.studentLabel, s.submittedAt, s.review ? reviewState[s.review.state] : "미검토", s.review?.total ?? "", s.review?.maxTotal ?? "", s.review?.level ?? "", s.review?.feedback ?? ""])];
    const url = URL.createObjectURL(new Blob(["\uFEFF" + rows.map(row => row.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `평가결과-${assessment.id}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const active = submissions.find(s => s.id === selected);
  return <div className="assessment-home">
    <section className="detail-heading"><div><p className="kicker">{assessment.definition.subject} · 루브릭 v{assessment.version}</p><h1>{assessment.definition.title}</h1><p>{assessment.definition.learningGoal}</p></div><span className="status-label">{distribution ? `${distribution.grade}학년 ${distribution.className} · ${distribution.status === "open" ? "진행 중" : "마감"}` : assessment.status === "draft" ? "서버에 저장된 초안" : assessment.status === "published" ? "공개됨" : "마감"}</span></section>
    {distribution ? <section className="class-result-banner"><div><span>학급별 결과만 보는 중</span><strong>{distribution.schoolYear}학년도 · {distribution.grade}학년 {distribution.className}</strong><p>이 학급의 제출 답안과 검토 결과만 표시됩니다. 다른 학급의 결과와 섞이지 않습니다.</p></div><Link className="outline-button button-link" href={`/classes/${distribution.classId}`}>학급 운영실로 돌아가기 →</Link></section> : null}
    {assessment.curriculumLink ? <section className="curriculum-assessment-banner"><div><span>교육과정 성장평가 연결됨</span><strong>{assessment.curriculumLink.unitTitle}</strong><p>등록 학생의 최종 제출은 원본 수행 증거로 자동 수합됩니다. 점수 결과와 성장 수준은 분리됩니다.</p></div><Link className="outline-button button-link" href={`/curriculum/${assessment.curriculumLink.termId}`}>성장 기록에서 루브릭 판단 →</Link></section> : null}
    {error && <p className="ai-generation-error" role="alert">{error}</p>}{notice && <p className="save-notice" role="status">{notice}</p>}
    <section className="detail-distribution response-card">{assessment.status === "published" && origin && (!distribution || distribution.status === "open") && <QRCodeSVG value={joinUrl} size={148} level="M" marginSize={2} title="이 평가의 학생 시험지 QR" />}<div><h2>{assessment.status === "draft" ? "검토를 마치고 평가를 공개하세요" : distribution ? `${distribution.grade}학년 ${distribution.className} 학생용 시험지` : "평가 문항이 공개되었습니다"}</h2><p>문항 {assessment.definition.questions.length}개 · {assessment.definition.questions.reduce((n, q) => n + q.points, 0)}점 · 학생용 시험 결과 상/중/하</p>{assessment.status === "draft" ? <><p>공개하면 문항·성취기준·루브릭이 잠깁니다. 공개 후 학급 운영실에서 대상 학급에 배포하세요.</p><button className="primary-button" disabled={busy} onClick={() => changeStatus("published")}>평가 문항 공개</button></> : distribution ? <><p>{distribution.instructions || "학생 안내 문구 없음"} · 대상 {distribution.totalStudents}명</p><label>이 학급의 학생 시험지 링크<input value={joinUrl} readOnly aria-label="학생 시험지 링크" /></label><div className="workspace-controls"><button className="outline-button" onClick={copy}>링크 복사</button><a className="outline-button button-link" href={joinUrl} target="_blank" rel="noreferrer">학생 시험지 열기</a></div></> : <><p>학급 운영실에서 공개된 평가를 선택하면 학급 명렬 전용 QR과 링크가 만들어집니다.</p><div className="workspace-controls"><Link className="primary-button button-link" href="/classes">학급을 선택해 배포</Link><button className="outline-button" disabled={busy} onClick={() => changeStatus("closed")}>평가 문항 마감</button></div></>}</div></section>
    <details className="response-card"><summary>문항·성취기준·루브릭 확인</summary>{assessment.definition.questions.map((q, i) => <article className="definition-question" key={q.id}><strong>{i + 1}. {q.prompt}</strong><p>{q.standardCode} · {q.criterion} · {q.points}점</p></article>)}{assessment.definition.rubric.map(r => <article className="definition-question" key={r.rubricCriterionId ?? `${r.standardCode ?? "all"}-${r.name}`}><strong>{r.standardCode ? `${r.standardCode} · ` : ""}{r.name}</strong><p>상: {r.high}</p><p>중: {r.middle}</p><p>하: {r.low}</p></article>)}<p>교사 설정 기준: 상 {assessment.definition.grading.upperThreshold}% 이상 · 중 {assessment.definition.grading.middleThreshold}% 이상 · 그 외 하. 이는 학생용 시험 결과이며 교육과정 성장 수준을 자동 확정하지 않습니다.</p></details>
    <section className="assessment-section"><div className="assessment-list-heading"><div><p className="kicker">{distribution ? `${distribution.grade}학년 ${distribution.className} · 실제 제출 답안` : "실제 제출된 답안"}</p><h2>학생별 결과 · {submissions.length}명</h2></div><div className="workspace-controls"><button className="outline-button" disabled={busy} onClick={refresh}>새로고침</button><button className="outline-button" disabled={!submissions.length} onClick={exportCsv}>결과 CSV</button></div></div>{!submissions.length && <div className="empty-workspace"><h3>아직 제출된 답안이 없습니다.</h3><p>학생의 최종 제출이 서버에 저장되면 여기에 표시됩니다.</p></div>}<div className="submission-grid">{submissions.map(s => <button className={`submission-card ${s.id === selected ? "selected" : ""}`} key={s.id} onClick={() => setSelected(s.id)}><strong>{s.studentLabel}</strong><small>{new Date(s.submittedAt!).toLocaleString("ko-KR")}</small><span>{s.review ? `${reviewState[s.review.state]} · ${s.review.total}점 · ${s.review.level}` : "교사 검토 대기"}</span></button>)}</div></section>
    {active && <ReviewEditor key={active.id} assessment={assessment} submission={active} onSaved={review => setSubmissions(current => current.map(s => s.id === active.id ? { ...s, review } : s))} />}
  </div>;
}

function ReviewEditor({ assessment, submission, onSaved }: { assessment: AssessmentRecord; submission: Submission; onSaved: (review: ReviewRecord) => void }) {
  const [scores, setScores] = useState(submission.review?.questionScores ?? assessment.definition.questions.map(q => ({ questionId: q.id, points: 0, reason: "" })));
  const [feedback, setFeedback] = useState(submission.review?.feedback ?? "");
  const [saved, setSaved] = useState(submission.review);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const dirty = JSON.stringify(scores) !== JSON.stringify(saved?.questionScores) || feedback !== saved?.feedback;
  const complete = feedback.trim() && scores.every(s => s.reason.trim() && s.points >= 0 && s.points <= assessment.definition.questions.find(q => q.id === s.questionId)!.points);
  const published = saved?.state === "published";
  const save = async (state: ReviewRecord["state"]) => {
    setBusy(true); setError("");
    try {
      const data = await requestJson<{ review: ReviewRecord }>(`/api/teacher/assessments/${assessment.id}/reviews/${submission.id}`, { method: "PUT", body: JSON.stringify({ questionScores: scores, feedback, state }) });
      setSaved(data.review); onSaved(data.review); setNotice(state === "published" ? "학생이 자신의 시험지에서 결과를 확인할 수 있습니다." : state === "final" ? "교사 확정을 저장했습니다. 아직 학생에게 공개되지 않았습니다." : "검토 중인 결과를 서버에 저장했습니다.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "채점 결과를 저장하지 못했습니다."); }
    finally { setBusy(false); }
  };
  return <section className="response-card review-editor"><p className="kicker">학생 원문과 판단 근거</p><h2>{submission.studentLabel}의 답안 검토</h2><p className="wizard-guide">AI 채점은 아직 연결 중입니다. 지금은 교사가 원문과 루브릭을 확인해 직접 판단합니다. 기록된 화면 체류 시간 {Math.floor(submission.timeSpentSeconds / 60)}분은 점수에 반영하지 않습니다.</p>{assessment.definition.questions.map((q, index) => { const score = scores.find(s => s.questionId === q.id)!; const rubric = assessment.definition.rubric.find(r => q.rubricCriterionId ? r.rubricCriterionId === q.rubricCriterionId : r.name === q.criterion)!; return <article className="review-question" key={q.id}><h3>{index + 1}. {q.prompt}</h3><blockquote>{submission.answers[q.id]}</blockquote><details><summary>{q.criterion} 루브릭 보기</summary><p>상: {rubric.high}</p><p>중: {rubric.middle}</p><p>하: {rubric.low}</p></details><div className="question-meta"><label>점수 / {q.points}점<input type="number" min={0} max={q.points} step={0.5} disabled={busy || published} value={score.points} onChange={e => setScores(current => current.map(s => s.questionId === q.id ? { ...s, points: Number(e.target.value) } : s))} /></label><label className="score-reason">학생 답안에서 확인한 판단 근거<textarea disabled={busy || published} value={score.reason} maxLength={1000} onChange={e => setScores(current => current.map(s => s.questionId === q.id ? { ...s, reason: e.target.value } : s))} /></label></div></article>; })}<label className="feedback-field">학생에게 전할 피드백<textarea disabled={busy || published} maxLength={3000} value={feedback} onChange={e => setFeedback(e.target.value)} placeholder="잘한 점과 다음 학습에서 시도할 점을 적어주세요." /></label>{error && <p className="ai-generation-error" role="alert">{error}</p>}{notice && <p className="save-notice" role="status">{notice}</p>}<div className="review-actions"><strong>합계 {scores.reduce((n, s) => n + s.points, 0)}점</strong>{published ? <span className="success-pill">학생에게 공개됨</span> : <><button className="outline-button" disabled={busy || !complete} onClick={() => save("draft")}>검토 내용 저장</button><button className="primary-button" disabled={busy || !complete} onClick={() => save("final")}>교사 최종 확정</button><button className="primary-button" disabled={busy || dirty || saved?.state !== "final"} onClick={() => save("published")}>확정 결과 공개</button></>}</div></section>;
}
