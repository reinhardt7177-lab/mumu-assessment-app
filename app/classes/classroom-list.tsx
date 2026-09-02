"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ClassroomRecord } from "../../db/classroom-repository";
import type { SchoolRecord } from "../../db/growth-repository";
import { requestJson } from "../../lib/client-api";

export default function ClassroomList({ initialClasses, schools }: { initialClasses: ClassroomRecord[]; schools: SchoolRecord[] }) {
  const [classes, setClasses] = useState(initialClasses);
  const [creating, setCreating] = useState(false);
  const students = classes.reduce((sum, item) => sum + item.studentCount, 0);
  return <div className="teacher-surface">
    <section className="section-title-row">
      <div><p className="kicker">CLASSROOM HUB</p><h1>학급과 학생 명렬</h1><p>학급별 명렬이 평가 배포와 결과 수합의 기준입니다. 학생 실명 대신 학교에서 정한 번호·별칭을 사용하세요.</p></div>
      <button className="primary-button" type="button" onClick={() => setCreating(true)}>＋ 새 학급 등록</button>
    </section>
    <section className="teacher-metric-grid compact-grid">
      <article><span className="metric-icon">학</span><div><small>활성 학급</small><strong>{classes.filter(item => item.status === "active").length}</strong><p>내 계정 소유</p></div></article>
      <article><span className="metric-icon teal">명</span><div><small>등록 학생</small><strong>{students}</strong><p>번호·별칭 기반</p></div></article>
      <article><span className="metric-icon violet">배</span><div><small>진행 중 배포</small><strong>{classes.reduce((sum, item) => sum + item.openDistributionCount, 0)}</strong><p>학급별 시험지</p></div></article>
    </section>
    <section className="teacher-panel classroom-panel">
      <header><div><p className="kicker">MY CLASSES</p><h2>운영 학급</h2></div><span className="privacy-chip">교사 계정별 분리 저장</span></header>
      {classes.length === 0 ? <div className="teacher-empty"><strong>아직 등록한 학급이 없습니다.</strong><p>학년도·학년·반을 먼저 정한 뒤 학생 명렬을 붙여 넣어 주세요.</p><button className="primary-button" type="button" onClick={() => setCreating(true)}>첫 학급 만들기</button></div> :
        <div className="classroom-card-grid">{classes.map(item => <Link className="classroom-card" href={`/classes/${item.id}`} key={item.id}>
          <div className="classroom-card-top"><span>{item.grade}</span><b>{item.status === "active" ? "운영 중" : "보관"}</b></div>
          <small>{item.schoolYear}학년도 · {item.schoolName ?? "학교 미지정"}</small>
          <h2>{item.grade}학년 {item.name}</h2>
          <div className="classroom-card-stats"><strong>{item.studentCount}<small>학생</small></strong><strong>{item.termCount}<small>교육과정</small></strong><strong>{item.openDistributionCount}<small>진행 평가</small></strong></div>
          <p>학급 운영실 열기 <b>→</b></p>
        </Link>)}</div>}
    </section>
    {creating ? <ClassroomCreator schools={schools} onClose={() => setCreating(false)} onCreated={item => { setClasses(current => [item, ...current]); setCreating(false); }} /> : null}
  </div>;
}

function ClassroomCreator({ schools, onClose, onCreated }: { schools: SchoolRecord[]; onClose: () => void; onCreated: (item: ClassroomRecord) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [schoolId, setSchoolId] = useState(schools[0]?.id ?? "");
  const [schoolYear, setSchoolYear] = useState(new Date().getFullYear());
  const [grade, setGrade] = useState(6);
  const [name, setName] = useState("1반");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { dialog.current?.showModal(); }, []);
  const save = async () => {
    setBusy(true); setError("");
    try {
      const data = await requestJson<{ classroom: ClassroomRecord }>("/api/teacher/classes", {
        method: "POST",
        body: JSON.stringify({ schoolId: schoolId || null, schoolYear, grade, name }),
      });
      onCreated(data.classroom);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "학급을 저장하지 못했습니다."); }
    finally { setBusy(false); }
  };
  return <dialog ref={dialog} className="create-modal real-dialog classroom-dialog" aria-labelledby="classroom-creator-title" onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <div className="modal-heading"><div><p className="kicker">평가 운영의 시작점</p><h2 id="classroom-creator-title">새 학급 등록</h2></div><button type="button" aria-label="닫기" disabled={busy} onClick={onClose}>×</button></div>
    <div className="wizard-body">
      <p className="wizard-guide">학급을 만든 뒤 학생 명렬을 등록하고, 공개된 평가를 이 학급 전용 QR로 배포할 수 있습니다.</p>
      <div className="classroom-form-grid">
        <label>학교<select value={schoolId} onChange={event => setSchoolId(event.target.value)}><option value="">학교 미지정</option>{schools.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
        <label>학년도<input type="number" min={2022} max={2100} value={schoolYear} onChange={event => setSchoolYear(Number(event.target.value))} /></label>
        <label>학년<select value={grade} onChange={event => setGrade(Number(event.target.value))}>{[1,2,3,4,5,6].map(value => <option value={value} key={value}>{value}학년</option>)}</select></label>
        <label>반 이름<input maxLength={50} value={name} onChange={event => setName(event.target.value)} placeholder="예: 1반" /></label>
      </div>
      {schools.length === 0 ? <p className="lock-note">학교 교육과정 계획을 아직 등록하지 않았다면 ‘학교 미지정’으로 시작해도 됩니다.</p> : null}
      {error ? <p className="ai-generation-error" role="alert">{error}</p> : null}
    </div>
    <div className="modal-actions"><button className="outline-button" type="button" disabled={busy} onClick={onClose}>취소</button><button className="primary-button" type="button" disabled={busy || !name.trim()} onClick={() => void save()}>{busy ? "저장 중…" : "학급 저장하고 계속"}</button></div>
  </dialog>;
}
