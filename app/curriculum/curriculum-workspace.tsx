"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { CurriculumTermRecord } from "../../db/growth-repository";
import { requestJson } from "../../lib/client-api";

const subjects = ["국어", "사회", "수학", "과학", "도덕", "영어"] as const;

export default function CurriculumWorkspace({ initialTerms, defaultSchoolYear }: { initialTerms: CurriculumTermRecord[]; defaultSchoolYear: number }) {
  const [terms, setTerms] = useState(initialTerms);
  const [creating, setCreating] = useState(false);
  const totalEvidence = terms.reduce((sum, term) => sum + term.evidenceCount, 0);
  const totalStudents = terms.reduce((sum, term) => sum + term.studentCount, 0);

  return <div className="curriculum-real">
    <section className="curriculum-real-hero">
      <div><p className="kicker">교육과정에서 학기말 성장 기록까지</p><h1>수업과 평가를<br />하나의 성장 흐름으로.</h1><p>단원별 성취기준과 루브릭을 설계하고, 피드백·추가 학습·재평가 증거를 학기말 종합 판단까지 연결합니다.</p></div>
      <div className="curriculum-hero-actions"><Link className="school-plan-link" href="/curriculum/setup">학교·학년 계획 가져오기</Link><button type="button" className="create-button" onClick={() => setCreating(true)}>＋ 학기 교육과정 만들기</button></div>
    </section>

    <section className="home-metrics curriculum-live-metrics" aria-label="교육과정 성장 평가 현황">
      <article><small>학기 교육과정</small><strong>{terms.length}</strong><span>내 계정에 영구 저장</span></article>
      <article><small>설계된 단원</small><strong>{terms.reduce((sum, term) => sum + term.unitCount, 0)}</strong><span>성취기준과 연결</span></article>
      <article><small>등록 학생</small><strong>{totalStudents}</strong><span>학기별 가명·번호</span></article>
      <article><small>수집된 수행 증거</small><strong>{totalEvidence}</strong><span>원본 수정·삭제 차단</span></article>
    </section>

    <section className="assessment-section curriculum-term-section">
      <div className="assessment-list-heading"><div><p className="kicker">MY CURRICULUM</p><h2>학기 교육과정</h2></div><Link className="outline-button button-link" href="/">평가 문항·QR 관리</Link></div>
      {terms.length === 0 ? <div className="empty-workspace"><h2>첫 학기 교육과정을 만들어 볼까요?</h2><p>학년·학기·학급·교과를 정하면 단원과 성취기준, 학생 성장 기록을 한곳에 모을 수 있습니다.</p><button type="button" className="primary-button" onClick={() => setCreating(true)}>학기 교육과정 만들기</button></div> : null}
      <div className="curriculum-term-grid">
        {terms.map(term => <Link className="curriculum-term-card" href={`/curriculum/${term.id}`} key={term.id}>
          <span>{term.schoolYear}학년도 · {term.semester}학기</span>
          <h2>{term.grade}학년 {term.className} · {term.subject}</h2>
          <div><strong>{term.unitCount}<small>단원</small></strong><strong>{term.studentCount}<small>학생</small></strong><strong>{term.evidenceCount}<small>수행 증거</small></strong></div>
          <p>교육과정 성장 대시보드 열기 <b>→</b></p>
        </Link>)}
      </div>
    </section>

    {creating ? <TermCreator defaultSchoolYear={defaultSchoolYear} onClose={() => setCreating(false)} onCreated={term => { setTerms(current => [term, ...current]); setCreating(false); }} /> : null}
  </div>;
}

function TermCreator({ defaultSchoolYear, onClose, onCreated }: { defaultSchoolYear: number; onClose: () => void; onCreated: (term: CurriculumTermRecord) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [schoolYear, setSchoolYear] = useState(defaultSchoolYear);
  const [semester, setSemester] = useState<1 | 2>(1);
  const [grade, setGrade] = useState(6);
  const [className, setClassName] = useState("1반");
  const [subject, setSubject] = useState<(typeof subjects)[number]>("사회");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { dialog.current?.showModal(); }, []);
  const availableSubjects = grade < 3 ? subjects.filter(item => item === "국어" || item === "수학") : subjects;
  const changeGrade = (nextGrade: number) => {
    setGrade(nextGrade);
    if (nextGrade < 3 && subject !== "국어" && subject !== "수학") setSubject("국어");
  };
  const save = async () => {
    setBusy(true); setError("");
    try {
      const data = await requestJson<{ term: CurriculumTermRecord }>("/api/teacher/curriculum/terms", {
        method: "POST",
        body: JSON.stringify({ schoolYear, semester, grade, className, subject }),
      });
      onCreated(data.term);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "학기 교육과정을 저장하지 못했습니다."); }
    finally { setBusy(false); }
  };
  return <dialog ref={dialog} className="create-modal real-dialog curriculum-dialog" aria-labelledby="term-creator-title" onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <div className="modal-heading"><div><p className="kicker">교육과정 성장 평가 시작</p><h2 id="term-creator-title">학기 교육과정 만들기</h2></div><button type="button" aria-label="닫기" disabled={busy} onClick={onClose}>×</button></div>
    <div className="wizard-body"><p className="wizard-guide">이 정보가 단원·평가·수행 증거·학기말 판단의 가장 위 구조가 됩니다.</p>
      <div className="field-row curriculum-term-fields">
        <label>학년도<input type="number" min={2022} max={2100} value={schoolYear} onChange={event => setSchoolYear(Number(event.target.value))} /></label>
        <label>학기<select value={semester} onChange={event => setSemester(Number(event.target.value) as 1 | 2)}><option value={1}>1학기</option><option value={2}>2학기</option></select></label>
        <label>학년<select value={grade} onChange={event => changeGrade(Number(event.target.value))}>{[1, 2, 3, 4, 5, 6].map(value => <option value={value} key={value}>{value}학년</option>)}</select></label>
        <label>학급<input value={className} maxLength={50} onChange={event => setClassName(event.target.value)} /></label>
        <label>교과<select value={subject} onChange={event => setSubject(event.target.value as (typeof subjects)[number])}>{availableSubjects.map(value => <option key={value}>{value}</option>)}</select></label>
      </div>
      <div className="lock-note">학생 정보는 학기별 번호·별칭으로 등록합니다. 실제 운영 전 학교의 개인정보 처리 기준을 확인하세요.</div>
      {error ? <p className="ai-generation-error" role="alert">{error}</p> : null}
    </div>
    <div className="modal-actions"><button type="button" className="outline-button" disabled={busy} onClick={onClose}>취소</button><button type="button" className="primary-button" disabled={busy || !className.trim()} onClick={() => void save()}>{busy ? "저장 중…" : "서버에 학기 저장"}</button></div>
  </dialog>;
}
