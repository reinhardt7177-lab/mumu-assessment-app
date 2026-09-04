"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { requestJson } from "../../lib/client-api";
import type { DesignSessionRecord } from "../../lib/design-studio-domain";

type SessionSummary = {
  id: string; title: string; grade: number; subject: string; learningGoal: string;
  status: string; currentStep: number; approvedAssessmentId: string | null;
  selectedStandardCount: number; hasBlueprint: boolean; validityBlocked: boolean | null; updatedAt: string;
};

const subjects = ["국어", "사회", "수학", "과학", "도덕", "영어"];
const stepNames = ["자료", "성취기준", "성공 기준", "루브릭", "문항", "타당도", "승인"];

export default function DesignStudioHome({ initialSessions }: { initialSessions: SessionSummary[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(initialSessions.length === 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ title: "", grade: 6, subject: "사회", learningGoal: "", sourceText: "" });

  const create = async () => {
    setBusy(true); setError("");
    try {
      const result = await requestJson<{ session: DesignSessionRecord }>("/api/teacher/design-sessions", {
        method: "POST",
        body: JSON.stringify({ title: form.title, grade: form.grade, subject: form.subject, learningGoal: form.learningGoal, source: { kind: "direct_text", text: form.sourceText } }),
      });
      router.push(`/design/${result.session.id}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "평가 설계를 시작하지 못했습니다."); }
    finally { setBusy(false); }
  };

  return <div className="design-home teacher-surface">
    <section className="design-hero">
      <div><p className="kicker">ASSESSMENT DESIGN STUDIO</p><h1>수업자료가<br />근거 있는 평가로.</h1><p>수업안이나 교육과정을 넣으면 성취기준 정렬부터 성공 기준, 루브릭, 서술형 문항, 타당도 점검까지 한 흐름으로 설계합니다.</p></div>
      <div className="design-hero-flow"><span>수업자료</span><i>→</i><span>루브릭</span><i>→</i><span>평가 문항</span><i>→</i><span>교사 승인</span></div>
      <button className="design-light-button" type="button" onClick={() => setCreating(current => !current)}>{creating ? "작성 닫기" : "＋ 새 평가 설계"}</button>
    </section>

    {creating && <section className="design-create-card">
      <header><div><p className="kicker">새 설계</p><h2>오늘 평가할 수업을 알려 주세요</h2></div><span>약 5~8분</span></header>
      <div className="design-create-grid">
        <label className="wide"><span>평가 이름</span><input value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} placeholder="예: 민주주의의 발전 단원 서술형 평가" /></label>
        <label><span>학년</span><select value={form.grade} onChange={event => setForm({ ...form, grade: Number(event.target.value) })}>{[1,2,3,4,5,6].map(grade => <option key={grade} value={grade}>{grade}학년</option>)}</select></label>
        <label><span>교과</span><select value={form.subject} onChange={event => setForm({ ...form, subject: event.target.value })}>{subjects.map(subject => <option key={subject}>{subject}</option>)}</select></label>
        <label className="wide"><span>학습 목표</span><input value={form.learningGoal} onChange={event => setForm({ ...form, learningGoal: event.target.value })} placeholder="학생이 수업 후 무엇을 할 수 있어야 하나요?" /></label>
        <label className="full"><span>수업안·교육과정 내용</span><textarea value={form.sourceText} onChange={event => setForm({ ...form, sourceText: event.target.value })} placeholder="핵심 수업 내용, 활동, 평가 계획을 붙여 넣으세요. 설계를 시작한 뒤 PDF·TXT 파일로 바꿀 수도 있습니다." /></label>
      </div>
      {error && <p className="design-error" role="alert">{error}</p>}
      <footer><small>AI 초안은 반드시 선생님이 확인하고 수정한 뒤 승인합니다.</small><button className="primary-button" type="button" disabled={busy || form.title.trim().length < 2 || form.learningGoal.trim().length < 5 || form.sourceText.trim().length < 5} onClick={create}>{busy ? "설계 공간 준비 중…" : "설계 시작하기 →"}</button></footer>
    </section>}

    <section className="design-library teacher-panel">
      <header><div><p className="kicker">MY DESIGN WORK</p><h2>평가 설계 작업</h2></div><strong>{initialSessions.length}개</strong></header>
      {initialSessions.length === 0 ? <div className="teacher-empty compact"><strong>아직 저장된 설계가 없습니다.</strong><p>위 입력란에서 첫 수업자료를 평가로 바꿔 보세요.</p></div> : <div className="design-session-grid">{initialSessions.map(session => <Link href={`/design/${session.id}`} className="design-session-card" key={session.id}>
        <div className="design-session-top"><span className={`design-status ${session.status}`}>{session.status === "approved" ? "평가 생성 완료" : session.validityBlocked ? "보완 필요" : "설계 중"}</span><small>{new Date(session.updatedAt).toLocaleDateString("ko-KR")}</small></div>
        <p>{session.grade}학년 {session.subject}</p><h3>{session.title}</h3><p className="design-goal">{session.learningGoal}</p>
        <div className="design-card-progress"><i><b style={{ width: `${Math.round(session.currentStep / 7 * 100)}%` }} /></i><span>{stepNames[Math.min(6, Math.max(0, session.currentStep - 1))]}</span></div>
        <footer><span>성취기준 {session.selectedStandardCount}개</span><strong>{session.status === "approved" ? "평가 열기" : "계속 설계하기"} →</strong></footer>
      </Link>)}</div>}
    </section>
  </div>;
}
