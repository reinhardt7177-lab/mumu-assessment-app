import Link from "next/link";
import type { AssessmentRecord } from "../lib/assessment-domain";
import type { ClassroomRecord, DistributionRecord } from "../db/classroom-repository";

export default function TeacherDashboard({
  classes,
  distributions,
  assessments,
}: {
  classes: ClassroomRecord[];
  distributions: DistributionRecord[];
  assessments: AssessmentRecord[];
}) {
  const open = distributions.filter(item => item.status === "open");
  const submitted = distributions.reduce((sum, item) => sum + item.submittedCount, 0);
  const pending = distributions.reduce((sum, item) => sum + item.pendingReviewCount, 0);
  const students = classes.reduce((sum, item) => sum + item.studentCount, 0);
  return <div className="teacher-surface">
    <section className="teacher-welcome">
      <div><p className="kicker">이준용 선생님의 평가 운영실</p><h1>학급의 오늘과<br />학생의 성장을 한눈에.</h1><p>평가 문항을 만들고 학급에 배포하면, 답안·루브릭 판단·피드백이 학기말 성장 기록까지 이어집니다.</p></div>
      <div className="teacher-quick-actions">
        <Link className="primary-button button-link" href="/design">＋ AI 평가 설계하기</Link>
        <Link className="outline-button button-link" href="/classes">학급·명렬 관리</Link>
      </div>
    </section>

    <section className="teacher-metric-grid" aria-label="운영 현황">
      <article><span className="metric-icon">교</span><div><small>운영 학급</small><strong>{classes.length}</strong><p>등록 학생 {students}명</p></div></article>
      <article><span className="metric-icon teal">진</span><div><small>진행 중 배포</small><strong>{open.length}</strong><p>학생 시험지 열림</p></div></article>
      <article><span className="metric-icon violet">답</span><div><small>수합된 답안</small><strong>{submitted}</strong><p>학급별 안전 저장</p></div></article>
      <article><span className="metric-icon amber">검</span><div><small>검토 대기</small><strong>{pending}</strong><p>교사 최종 판단 필요</p></div></article>
    </section>

    <div className="teacher-dashboard-grid">
      <section className="teacher-panel">
        <header><div><p className="kicker">MY CLASSES</p><h2>나의 학급</h2></div><Link href="/classes">전체 학급 →</Link></header>
        {classes.length === 0 ? <div className="teacher-empty"><strong>먼저 학급을 등록해 주세요.</strong><p>학급 정보와 학생 명렬이 평가 배포의 기준이 됩니다.</p><Link className="primary-button button-link" href="/classes">첫 학급 만들기</Link></div> :
          <div className="class-summary-list">{classes.slice(0, 5).map(item => <Link href={`/classes/${item.id}`} key={item.id}>
            <span>{item.grade}</span><div><strong>{item.schoolYear}학년도 {item.grade}학년 {item.name}</strong><small>{item.schoolName ?? "학교 미지정"} · 학생 {item.studentCount}명</small></div>
            <b>{item.openDistributionCount ? `진행 ${item.openDistributionCount}` : "준비"}</b>
          </Link>)}</div>}
      </section>

      <section className="teacher-panel">
        <header><div><p className="kicker">LIVE ASSESSMENTS</p><h2>진행 중 평가</h2></div><Link href="/assessments">평가 보관함 →</Link></header>
        {open.length === 0 ? <div className="teacher-empty compact"><strong>배포 중인 평가가 없습니다.</strong><p>공개한 평가를 학급 상세에서 선택해 배포하세요.</p></div> :
          <div className="distribution-summary-list">{open.slice(0, 6).map(item => {
            const rate = item.totalStudents ? Math.round(item.submittedCount / item.totalStudents * 100) : 0;
            return <Link href={`/assessments/${item.assessmentId}?distribution=${item.id}`} key={item.id}>
              <div><span>{item.grade}학년 {item.className}</span><strong>{item.assessmentTitle}</strong><small>{item.subject} · 제출 {item.submittedCount}/{item.totalStudents}명</small></div>
              <div className="mini-progress"><i style={{ width: `${rate}%` }} /><b>{rate}%</b></div>
            </Link>;
          })}</div>}
      </section>
    </div>

    <section className="teacher-flow">
      <div><span>1</span><strong>학급·명렬 등록</strong><small>학생 번호와 별칭만 사용</small></div>
      <i>→</i><div><span>2</span><strong>문항·루브릭 설계</strong><small>저장 평가 {assessments.length}개</small></div>
      <i>→</i><div><span>3</span><strong>QR·링크 배포</strong><small>학생은 시험지만 확인</small></div>
      <i>→</i><div><span>4</span><strong>피드백·성장 판단</strong><small>추가 학습과 학기말 종합</small></div>
    </section>
  </div>;
}
