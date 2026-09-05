import Link from "next/link";
import { redirect } from "next/navigation";
import { getGrowthRepository } from "../../../../../db/connection";
import { AppError } from "../../../../../lib/assessment-domain";
import { validateId } from "../../../../../lib/http";
import { requireTeacher } from "../../../../../lib/teacher-auth";
import PrintReportButton from "../../../../print-report-button";
import { confirmedGrowthCodes, finalSemesterJudgements } from "../../../../../lib/semester-report";

export const dynamic = "force-dynamic";

type Level = "상" | "중" | "하" | "판단 보류";
const levelRank = (level: Level | undefined) => level === "상" ? 3 : level === "중" ? 2 : level === "하" ? 1 : 0;
const levelWidth = (level: Level | undefined) => level ? `${Math.max(levelRank(level), 0) / 3 * 100}%` : "0%";
const unique = (values: string[]) => [...new Set(values.map(value => value.trim()).filter(Boolean))].slice(0, 6);

export default async function StudentSemesterReport({ params }: { params: Promise<{ termId: string; studentId: string }> }) {
  let ownerId: string;
  try { ownerId = await requireTeacher(); }
  catch (error) { if (error instanceof AppError) redirect("/"); throw error; }
  const { termId: rawTermId, studentId: rawStudentId } = await params;
  const termId = validateId(rawTermId);
  const studentId = validateId(rawStudentId);
  const repository = getGrowthRepository();
  const [dashboard, workflow] = await Promise.all([repository.getDashboard(termId, ownerId), repository.getWorkflow(termId, ownerId)]);
  const student = dashboard.students.find(item => item.id === studentId);
  if (!student) redirect(`/curriculum/${termId}`);

  const seen = new Set<string>();
  const standards = dashboard.units.flatMap(unit => unit.standards.map(standard => ({ ...standard, unitTitle: unit.title }))).filter(standard => !seen.has(standard.code) && seen.add(standard.code));
  const semester = finalSemesterJudgements(workflow, studentId);
  const evidence = workflow.evidence.filter(item => item.studentId === studentId);
  const feedback = workflow.feedback.filter(item => item.studentId === studentId);
  const rows = standards.map(standard => {
    const judgement = semester.find(item => item.standardCode === standard.code);
    const history = evidence.flatMap(item => item.judgements.filter(j => j.standardCode === standard.code && j.state === "final").map(j => ({ level: j.level, date: item.collectedAt, title: item.eventTitle, independent: item.assistanceLevel === "independent" }))).sort((a, b) => a.date.localeCompare(b.date));
    const current = judgement?.level;
    const progressDescription = judgement ? `교사 학기말 확정 · ${judgement.rationale}` : "학기말 종합 판단 전 · 개별 평가 요소의 수준을 종합 수준으로 환산하지 않습니다.";
    return { ...standard, judgement, history, current, progressDescription };
  });
  const growthCodes = confirmedGrowthCodes(evidence, feedback);
  const completedGrowth = feedback.filter(item => growthCodes.has(item.standardCode));
  const completedGrowthCount = growthCodes.size;
  const unverified = evidence.filter(item => item.transformationStatus === "automated" && !item.teacherVerified).length;
  const strengths = unique([
    ...rows.filter(row => row.current === "상").map(row => `${row.code}: ${row.judgement!.rationale}`),
    ...feedback.map(item => item.strength),
  ]);
  const growingPoints = unique([
    ...rows.filter(row => row.current === "하" || row.current === "판단 보류" || !row.current).map(row => `${row.code}: ${row.current === "하" ? "기초 개념과 적용 근거를 더 확인할 필요가 있음" : "독립 수행 증거가 더 필요함"}`),
    ...feedback.map(item => item.gapDescription),
  ]);
  const nextGoals = unique([
    ...feedback.map(item => item.nextLearning),
    ...completedGrowth.map(item => `${item.standardCode}: 확인된 성장 전략을 새로운 맥락에 확장`),
  ]);
  const supportPlans = unique([
    ...(feedback.filter(item => item.status !== "completed").map(item => `${item.standardCode}: 추가 학습 또는 독립 재평가가 진행 중`)),
    ...(unverified ? [`교사 확인 전인 OCR·전사 증거 ${unverified}건은 종합 판단 근거에서 제외`] : []),
    ...rows.filter(row => !row.judgement).map(row => `${row.code}: 평가 요소별 수행과 도움 수준을 검토해 학기말 종합 판단 필요`),
  ]);

  return <main className="semester-report-page">
    <div className="report-toolbar"><Link href={`/curriculum/${termId}`}>← 교육과정 운영실</Link><PrintReportButton /></div>
    <article className="semester-report-sheet">
      <header className="report-title"><div><p>2022 REVISED CURRICULUM · GROWTH REPORT</p><h1>{student.displayName} 학생 학기말 성장 리포트</h1><span>{dashboard.term.schoolYear}학년도 {dashboard.term.semester}학기 · {dashboard.term.grade}학년 {dashboard.term.className} · {dashboard.term.subject}</span></div><strong>{semester.filter(item => item.state === "final").length}<small>확정 성취기준</small></strong></header>
      <section className="report-summary-grid"><article><small>수집된 평가 근거</small><strong>{evidence.length}</strong></article><article><small>향상이 확인된 성취기준</small><strong>{completedGrowthCount}</strong></article><article><small>독립 재평가</small><strong>{student.independentGrowthCount}</strong></article><article><small>추가 지원 진행</small><strong>{student.openFeedbackCount}</strong></article></section>

      <section className="report-section"><header><p>01 · ACHIEVEMENT</p><h2>성취기준별 현재 수준과 성장 변화</h2><span>상·중·하는 학생 간 순위가 아니라 성취기준별 수행 기술문에 근거한 판단입니다.</span></header><div className="achievement-report-list">{rows.map(row => <article key={row.id}><div><span>{row.code} · {row.unitTitle}</span><strong>{row.content}</strong></div><div className="achievement-level-track"><i style={{ width: levelWidth(row.current) }} /><span>{row.current ?? "판단 전"}</span></div><small>{row.progressDescription}</small></article>)}</div></section>

      <section className="report-section"><header><p>02 · EVIDENCE TIMELINE</p><h2>수행 증거 흐름</h2></header><div className="report-timeline">{evidence.sort((a, b) => a.collectedAt.localeCompare(b.collectedAt)).map(item => <article key={item.id}><time>{new Date(item.collectedAt).toLocaleDateString("ko-KR")}</time><i /><div><strong>{item.eventTitle}</strong><span>{item.unitTitle} · {item.assistanceLevel === "independent" ? "독립 수행" : "도움 있는 수행"}</span><p>{item.judgements.filter(j => j.state === "final").map(j => `${j.criterionName} ${j.level}`).join(" · ") || "교사 최종 판단 전"}</p></div></article>)}</div></section>

      <section className="report-section"><header><p>03 · LEARNING SUPPORT VIEW</p><h2>강점·성장 중인 점·다음 목표·지원 계획</h2><span>학생을 분류하는 결과가 아니라 다음 학습과 교사의 지원을 설계하기 위한 요약입니다.</span></header><div className="growth-view-grid"><GrowthView title="잘하는 점" subtitle="확인된 강점" items={strengths} empty="확정된 강점 근거를 더 수집합니다." /><GrowthView title="성장 중인 점" subtitle="더 연습할 부분" items={growingPoints} empty="현재 두드러진 학습 격차가 기록되지 않았습니다." /><GrowthView title="다음 학습 목표" subtitle="학생의 다음 도전" items={nextGoals} empty="다음 학습 활동을 교사가 설계해 주세요." /><GrowthView title="교사의 지원 계획" subtitle="수업과 평가 지원" items={supportPlans} empty="현재 별도 지원 계획이 기록되지 않았습니다." /></div></section>

      <section className="report-section"><header><p>04 · STUDENT REFLECTION</p><h2>학생과 함께 확인하는 자기 성찰</h2><span>교사 피드백을 읽은 뒤 학생이 자기 말로 기록하고 다음 목표를 정합니다.</span></header><div className="reflection-grid"><article><strong>내가 잘했다고 생각하는 점</strong><p>어떤 수행이나 답안을 근거로 그렇게 생각하나요?</p></article><article><strong>피드백을 받고 바꾼 점</strong><p>처음과 비교하여 생각이나 표현이 어떻게 달라졌나요?</p></article><article><strong>다음에 도전할 목표</strong><p>다음 학습이나 평가에서 스스로 실천할 한 가지는 무엇인가요?</p></article></div></section>

      <section className="report-section next-learning-report"><header><p>05 · NEXT LEARNING</p><h2>다음 학습 제안</h2></header>{feedback.length ? <div>{feedback.map(item => <article key={item.id}><span>{item.standardCode}</span><strong>{item.nextLearning}</strong><p>확인된 강점: {item.strength}</p><small>진행 상태 · {item.status === "completed" ? "재평가 연결 완료" : item.status === "ready_for_reassessment" ? "독립 재평가 준비" : "추가 학습 진행"}</small></article>)}</div> : <p>확정된 루브릭 판단을 바탕으로 학생에게 필요한 한 가지 다음 학습을 설계해 주세요.</p>}</section>

      <footer className="report-footer"><span>AI 추천은 참고 자료이며, 이 리포트의 성취 수준과 교육적 판단은 교사가 누적 증거를 검토해 확정합니다.</span><small>생성일 {new Date().toLocaleDateString("ko-KR")}</small></footer>
    </article>
  </main>;
}

function GrowthView({ title, subtitle, items, empty }: { title: string; subtitle: string; items: string[]; empty: string }) {
  return <article><header><strong>{title}</strong><small>{subtitle}</small></header><ul>{(items.length ? items : [empty]).map((item, index) => <li key={`${title}-${index}`}>{item}</li>)}</ul></article>;
}
