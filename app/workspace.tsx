"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AssessmentRecord } from "../lib/assessment-domain";
import { requestJson } from "../lib/client-api";
import AssessmentCreator from "./assessment-creator";

const statusLabels = { draft: "초안", published: "진행 중", closed: "마감" };
export default function Workspace({ initialAssessments }: { initialAssessments: AssessmentRecord[] }) {
  const router = useRouter();
  const [assessments, setAssessments] = useState(initialAssessments);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const refresh = async () => {
    setBusy(true); setError("");
    try { setAssessments((await requestJson<{ assessments: AssessmentRecord[] }>("/api/teacher/assessments")).assessments); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "목록을 불러오지 못했습니다."); }
    finally { setBusy(false); }
  };
  return <div className="assessment-home">
    <section className="home-hero"><div><p className="kicker">평가 문항·루브릭 보관함</p><h1>성취기준에서 시작하는<br />단원 평가를 설계하세요.</h1><p>문항과 상·중·하 루브릭을 완성해 공개한 뒤, 학급 상세 화면에서 QR이나 링크로 배포합니다.</p><Link className="curriculum-bridge-link" href="/classes">학급을 선택해 평가 배포하기 →</Link></div><button type="button" className="create-button" onClick={() => setCreating(true)}>＋ 새 평가 만들기</button></section>
    <section className="home-metrics"><article><small>저장된 평가</small><strong>{assessments.length}</strong><span>내 계정에 연결</span></article><article><small>진행 중 평가</small><strong>{assessments.filter(a => a.status === "published").length}</strong><span>학생 참여 가능</span></article><article><small>실제 제출 답안</small><strong>{assessments.reduce((n, a) => n + a.submittedCount, 0)}</strong><span>서버 저장 확인</span></article><article><small>교사 검토 대기</small><strong>{assessments.reduce((n, a) => n + a.pendingCount, 0)}</strong><span>확정 전 답안</span></article></section>
    <section className="assessment-section"><div className="assessment-list-heading"><div><p className="kicker">MY ASSESSMENTS</p><h2>나의 평가</h2></div><div className="workspace-controls"><select aria-label="평가 상태 필터" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">전체</option><option value="draft">초안</option><option value="published">진행 중</option><option value="closed">마감</option></select><button className="outline-button" onClick={refresh} disabled={busy}>{busy ? "조회 중…" : "새로고침"}</button></div></div>{error && <p className="ai-generation-error" role="alert">{error}</p>}
      {assessments.length === 0 && <div className="empty-workspace"><h2>첫 평가를 만들어 볼까요?</h2><p>성취기준 → 문항 → 루브릭을 정하고 저장한 뒤, 공개한 평가를 원하는 학급에 배포할 수 있습니다.</p><button className="primary-button" onClick={() => setCreating(true)}>평가 만들기</button></div>}
      <div className="assessment-cards">{assessments.filter(a => filter === "all" || a.status === filter).map(a => <article className="assessment-card" key={a.id}><span className="status-label">{statusLabels[a.status]}</span><p>{a.definition.subject} · {a.definition.type}</p><h3>{a.definition.title}</h3>{a.curriculumLink ? <span className="assessment-curriculum-chip">{a.curriculumLink.unitTitle} · 성장 기록 연결</span> : null}<div className="progress-copy"><span>{a.definition.questions.length}문항 · 제출 {a.submittedCount}명</span><strong>검토 대기 {a.pendingCount}</strong></div><div className="assessment-card-bottom"><small>{new Date(a.createdAt).toLocaleDateString("ko-KR")}</small><Link href={`/assessments/${a.id}`}>평가·학생 결과 열기 →</Link></div></article>)}</div>
    </section>
    {creating && <AssessmentCreator onClose={() => setCreating(false)} onCreated={a => { setCreating(false); router.push(`/assessments/${a.id}`); }} />}
  </div>;
}
