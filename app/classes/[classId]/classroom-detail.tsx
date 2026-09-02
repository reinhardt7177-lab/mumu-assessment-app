"use client";

import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AssessmentRecord } from "../../../lib/assessment-domain";
import type { ClassStudentRecord, ClassroomDetailRecord, DistributionRecord } from "../../../db/classroom-repository";
import { requestJson } from "../../../lib/client-api";

const examGrade = (assessment: AssessmentRecord) => Number(assessment.definition.subject.match(/^(\d)학년/)?.[1] ?? 0);
const dateText = (value: string | null) => value ? new Date(value).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" }) : "교사가 직접 마감";

export default function ClassroomDetail({ initialDetail, assessments }: { initialDetail: ClassroomDetailRecord; assessments: AssessmentRecord[] }) {
  const [detail, setDetail] = useState(initialDetail);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [distributionOpen, setDistributionOpen] = useState(false);
  const [origin, setOrigin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const available = assessments.filter(item => item.status === "published" && examGrade(item) === detail.classroom.grade);
  const activeStudents = detail.students.filter(item => item.active);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setOrigin(window.location.origin));
    return () => cancelAnimationFrame(frame);
  }, []);

  const refresh = async () => {
    setBusy(true); setError("");
    try { setDetail((await requestJson<{ detail: ClassroomDetailRecord }>(`/api/teacher/classes/${detail.classroom.id}`)).detail); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "학급 정보를 불러오지 못했습니다."); }
    finally { setBusy(false); }
  };
  const updateStudent = async (student: ClassStudentRecord, active: boolean) => {
    if (!active && !window.confirm(`${student.displayName} 학생을 명렬에서 비활성화할까요? 기존 답안과 성장 기록은 보존됩니다.`)) return;
    setBusy(true); setError("");
    try {
      const data = await requestJson<{ student: ClassStudentRecord }>(`/api/teacher/classes/${detail.classroom.id}/students/${student.id}`, {
        method: "PUT", body: JSON.stringify({ studentRef: student.studentRef, displayName: student.displayName, active }),
      });
      setDetail(current => {
        const students = current.students.map(item => item.id === data.student.id ? data.student : item);
        return { ...current, students, classroom: { ...current.classroom, studentCount: students.filter(item => item.active).length } };
      });
      setNotice(active ? "학생을 다시 활성화했습니다." : "학생을 비활성화했습니다. 기존 기록은 그대로 보존됩니다.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "학생 상태를 바꾸지 못했습니다."); }
    finally { setBusy(false); }
  };
  const closeDistribution = async (item: DistributionRecord) => {
    if (!window.confirm("이 학급의 평가 배포를 마감할까요? 제출된 답안은 그대로 보존됩니다.")) return;
    setBusy(true); setError("");
    try {
      const data = await requestJson<{ distribution: DistributionRecord }>(`/api/teacher/distributions/${item.id}/status`, { method: "PUT", body: JSON.stringify({ status: "closed" }) });
      setDetail(current => ({ ...current, distributions: current.distributions.map(value => value.id === item.id ? data.distribution : value) }));
      setNotice("학급 평가를 마감했습니다.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "평가를 마감하지 못했습니다."); }
    finally { setBusy(false); }
  };
  const copy = async (code: string) => {
    try { await navigator.clipboard.writeText(`${origin}/join/${code}`); setNotice("학생용 시험지 링크를 복사했습니다."); }
    catch { setError("자동 복사에 실패했습니다. 시험지 열기에서 주소를 직접 복사해 주세요."); }
  };

  return <div className="teacher-surface">
    <section className="classroom-detail-hero">
      <div className="classroom-avatar">{detail.classroom.grade}</div>
      <div><p className="kicker">{detail.classroom.schoolYear}학년도 · {detail.classroom.schoolName ?? "학교 미지정"}</p><h1>{detail.classroom.grade}학년 {detail.classroom.name} 운영실</h1><p>명렬을 기준으로 평가를 배포하고, 학급별 제출·검토·성장 기록을 관리합니다.</p></div>
      <div className="classroom-hero-actions"><button className="primary-button" type="button" onClick={() => setDistributionOpen(true)}>＋ 평가 배포</button><button className="outline-button" type="button" onClick={() => setRosterOpen(true)}>학생 명렬 추가</button></div>
    </section>
    {error ? <p className="ai-generation-error" role="alert">{error}</p> : null}
    {notice ? <p className="save-notice" role="status">{notice}</p> : null}

    <section className="teacher-metric-grid compact-grid">
      <article><span className="metric-icon">명</span><div><small>활성 학생</small><strong>{activeStudents.length}</strong><p>번호·별칭 등록</p></div></article>
      <article><span className="metric-icon teal">평</span><div><small>진행 평가</small><strong>{detail.distributions.filter(item => item.status === "open").length}</strong><p>학급 전용 링크</p></div></article>
      <article><span className="metric-icon violet">답</span><div><small>제출 답안</small><strong>{detail.distributions.reduce((sum, item) => sum + item.submittedCount, 0)}</strong><p>교사 검토 연결</p></div></article>
      <article><span className="metric-icon amber">과</span><div><small>학기 교육과정</small><strong>{detail.terms.length}</strong><p>성장 기록 연결</p></div></article>
    </section>

    <div className="classroom-detail-grid">
      <section className="teacher-panel">
        <header><div><p className="kicker">ASSESSMENT DELIVERY</p><h2>학급 평가 배포</h2></div><div className="workspace-controls"><button className="outline-button" disabled={busy} onClick={() => void refresh()}>{busy ? "조회 중…" : "새로고침"}</button><button className="primary-button" onClick={() => setDistributionOpen(true)}>평가 배포</button></div></header>
        {detail.distributions.length === 0 ? <div className="teacher-empty compact"><strong>아직 이 학급에 배포한 평가가 없습니다.</strong><p>평가 보관함에서 문항·루브릭을 완성하고 공개한 뒤 여기에서 선택하세요.</p><Link className="outline-button button-link" href="/assessments">평가 문항 만들기</Link></div> :
          <div className="class-distribution-list">{detail.distributions.map(item => {
            const rate = item.totalStudents ? Math.round(item.submittedCount / item.totalStudents * 100) : 0;
            const url = `${origin}/join/${item.shareCode}`;
            return <article className={item.status === "open" ? "open" : "closed"} key={item.id}>
              <div className="distribution-qr">{origin ? <QRCodeSVG value={url} size={92} level="M" marginSize={1} title={`${item.assessmentTitle} 학생 시험지 QR`} /> : null}</div>
              <div className="distribution-copy"><span>{item.status === "open" ? "진행 중" : "마감"} · {item.subject}</span><h3>{item.assessmentTitle}</h3><p>{item.instructions || "안내 문구 없음"} · 마감 {dateText(item.closesAt)}</p>
                <div className="distribution-progress"><i><b style={{ width: `${rate}%` }} /></i><strong>제출 {item.submittedCount}/{item.totalStudents}명 · 검토 대기 {item.pendingReviewCount}명</strong></div>
              </div>
              <div className="distribution-actions"><Link className="primary-button button-link" href={`/assessments/${item.assessmentId}?distribution=${item.id}`}>결과 분석</Link><button className="outline-button" onClick={() => void copy(item.shareCode)}>링크 복사</button><a className="outline-button button-link" href={url} target="_blank" rel="noreferrer">시험지 열기</a>{item.status === "open" ? <button className="text-danger-button" disabled={busy} onClick={() => void closeDistribution(item)}>배포 마감</button> : null}</div>
            </article>;
          })}</div>}
      </section>

      <aside className="teacher-panel roster-panel">
        <header><div><p className="kicker">CLASS ROSTER</p><h2>학생 명렬 · {activeStudents.length}명</h2></div><button className="outline-button" onClick={() => setRosterOpen(true)}>＋ 추가</button></header>
        {detail.students.length === 0 ? <div className="teacher-empty compact"><strong>등록 학생이 없습니다.</strong><p>한 줄에 학생 번호와 별칭을 입력해 한 번에 추가하세요.</p></div> :
          <div className="class-roster-list">{detail.students.map((student, index) => <article className={student.active ? "" : "inactive"} key={student.id}><span>{index + 1}</span><div><strong>{student.displayName}</strong><small>{student.studentRef}</small></div><button type="button" disabled={busy} onClick={() => void updateStudent(student, !student.active)}>{student.active ? "비활성" : "복구"}</button></article>)}</div>}
        <p className="roster-privacy">학생 실명·민감정보 대신 학교가 정한 번호와 별칭을 사용하세요. 비활성화해도 기존 평가 기록은 삭제되지 않습니다.</p>
      </aside>
    </div>

    <section className="teacher-panel curriculum-strip">
      <header><div><p className="kicker">CURRICULUM GROWTH</p><h2>연결된 학기 교육과정</h2></div><Link href="/curriculum">교육과정 관리 →</Link></header>
      {detail.terms.length === 0 ? <div className="teacher-empty compact"><strong>연결된 교육과정이 없습니다.</strong><p>같은 학년도·학년·반으로 학기 교육과정을 만들면 단원 평가와 성장 기록이 연결됩니다.</p><Link className="outline-button button-link" href="/curriculum">학기 교육과정 만들기</Link></div> :
        <div className="term-chip-list">{detail.terms.map(term => <Link href={`/curriculum/${term.id}`} key={term.id}><span>{term.semester}학기 · {term.subject}</span><strong>{term.unitCount}단원 · 수행 증거 {term.evidenceCount}개</strong><b>열기 →</b></Link>)}</div>}
    </section>

    {rosterOpen ? <RosterDialog classId={detail.classroom.id} existingCount={activeStudents.length} onClose={() => setRosterOpen(false)} onAdded={students => {
      setDetail(current => ({ ...current, students: [...current.students, ...students], classroom: { ...current.classroom, studentCount: current.classroom.studentCount + students.length } }));
      setRosterOpen(false); setNotice(`학생 ${students.length}명을 명렬에 추가했습니다.`);
    }} /> : null}
    {distributionOpen ? <DistributionDialog classroom={detail} assessments={available} onClose={() => setDistributionOpen(false)} onCreated={item => {
      setDetail(current => ({ ...current, distributions: [item, ...current.distributions] }));
      setDistributionOpen(false); setNotice("학급 전용 QR과 학생 시험지 링크를 만들었습니다.");
    }} /> : null}
  </div>;
}

function RosterDialog({ classId, existingCount, onClose, onAdded }: { classId: string; existingCount: number; onClose: () => void; onAdded: (students: ClassStudentRecord[]) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { dialog.current?.showModal(); }, []);
  const parsed = useMemo(() => text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const columns = line.includes(",") || line.includes("\t") ? line.split(/[\t,]/) : line.split(/\s+/);
    const studentRef = columns.shift()?.trim() ?? "";
    return { studentRef, displayName: columns.join(" ").trim() };
  }), [text]);
  const valid = parsed.length > 0 && parsed.length <= 100 && parsed.every(item => item.studentRef && item.displayName) && new Set(parsed.map(item => item.studentRef)).size === parsed.length;
  const save = async () => {
    setBusy(true); setError("");
    try {
      const data = await requestJson<{ students: ClassStudentRecord[] }>(`/api/teacher/classes/${classId}/students`, { method: "POST", body: JSON.stringify({ students: parsed }) });
      onAdded(data.students);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "학생 명렬을 저장하지 못했습니다."); }
    finally { setBusy(false); }
  };
  return <dialog ref={dialog} className="create-modal real-dialog classroom-dialog" aria-labelledby="roster-dialog-title" onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <div className="modal-heading"><div><p className="kicker">CLASS ROSTER</p><h2 id="roster-dialog-title">학생 명렬 한 번에 추가</h2></div><button type="button" aria-label="닫기" disabled={busy} onClick={onClose}>×</button></div>
    <div className="wizard-body"><p className="wizard-guide">한 줄에 “학생 참조 번호, 표시 별칭” 순서로 입력하세요. 실명 대신 학교에서 정한 별칭을 권장합니다.</p>
      <label className="roster-paste-field">명렬 붙여넣기<textarea value={text} onChange={event => setText(event.target.value)} placeholder={"01, 햇살\n02, 초록\n03, 바다"} /></label>
      <div className="roster-preview"><strong>미리보기 · {parsed.length}명</strong>{parsed.slice(0, 8).map((item, index) => <span key={`${item.studentRef}-${index}`}><b>{item.studentRef || "번호 없음"}</b>{item.displayName || "별칭 없음"}</span>)}{parsed.length > 8 ? <small>외 {parsed.length - 8}명</small> : null}</div>
      <p className="lock-note">현재 활성 학생 {existingCount}명 · 한 번에 최대 100명 · 중복 번호는 저장되지 않습니다.</p>{error ? <p className="ai-generation-error" role="alert">{error}</p> : null}
    </div>
    <div className="modal-actions"><button className="outline-button" type="button" disabled={busy} onClick={onClose}>취소</button><button className="primary-button" type="button" disabled={busy || !valid} onClick={() => void save()}>{busy ? "저장 중…" : `${parsed.length}명 명렬에 추가`}</button></div>
  </dialog>;
}

function DistributionDialog({ classroom, assessments, onClose, onCreated }: { classroom: ClassroomDetailRecord; assessments: AssessmentRecord[]; onClose: () => void; onCreated: (item: DistributionRecord) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [assessmentId, setAssessmentId] = useState(assessments[0]?.id ?? "");
  const [instructions, setInstructions] = useState("문항을 차례대로 읽고, 자신의 생각과 근거를 구체적으로 써 주세요.");
  const [closesAt, setClosesAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { dialog.current?.showModal(); }, []);
  const save = async () => {
    setBusy(true); setError("");
    try {
      const data = await requestJson<{ distribution: DistributionRecord }>("/api/teacher/distributions", {
        method: "POST",
        body: JSON.stringify({ assessmentId, classId: classroom.classroom.id, instructions, closesAt: closesAt ? new Date(closesAt).toISOString() : null }),
      });
      onCreated(data.distribution);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "평가를 배포하지 못했습니다."); }
    finally { setBusy(false); }
  };
  return <dialog ref={dialog} className="create-modal real-dialog classroom-dialog" aria-labelledby="distribution-dialog-title" onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <div className="modal-heading"><div><p className="kicker">{classroom.classroom.grade}학년 {classroom.classroom.name}</p><h2 id="distribution-dialog-title">학급 전용 평가 배포</h2></div><button type="button" aria-label="닫기" disabled={busy} onClick={onClose}>×</button></div>
    <div className="wizard-body"><p className="wizard-guide">이 학급 명렬에 등록된 학생만 참여할 수 있는 QR과 링크가 만들어집니다. 학생 화면에는 시험지만 표시됩니다.</p>
      {assessments.length === 0 ? <div className="teacher-empty compact"><strong>배포할 수 있는 공개 평가가 없습니다.</strong><p>{classroom.classroom.grade}학년 평가를 만들고 ‘공개’ 상태로 바꾼 뒤 다시 시도해 주세요.</p><Link className="primary-button button-link" href="/assessments">평가 문항 만들기</Link></div> : <div className="distribution-form">
        <label>배포할 평가<select value={assessmentId} onChange={event => setAssessmentId(event.target.value)}>{assessments.map(item => <option value={item.id} key={item.id}>{item.definition.title} · {item.definition.subject}</option>)}</select></label>
        <label>학생 안내<textarea maxLength={2000} value={instructions} onChange={event => setInstructions(event.target.value)} /></label>
        <label>자동 마감 시각 <small>선택 사항</small><input type="datetime-local" value={closesAt} onChange={event => setClosesAt(event.target.value)} /></label>
        <p className="lock-note">대상 학생 {classroom.students.filter(item => item.active).length}명 · 이미 같은 평가를 이 학급에 배포했다면 중복 배포되지 않습니다.</p>
      </div>}
      {error ? <p className="ai-generation-error" role="alert">{error}</p> : null}
    </div>
    <div className="modal-actions"><button className="outline-button" type="button" disabled={busy} onClick={onClose}>취소</button><button className="primary-button" type="button" disabled={busy || !assessmentId || classroom.students.every(item => !item.active)} onClick={() => void save()}>{busy ? "배포 중…" : "QR·학생 링크 만들기"}</button></div>
  </dialog>;
}
