import Link from "next/link";
import { databaseConfigured, getClassroomRepository, getRepository } from "../db/connection";
import { authConfigured, requireTeacher } from "../lib/teacher-auth";
import { AppError } from "../lib/assessment-domain";
import TeacherDashboard from "./teacher-dashboard";
import TeacherHeader from "./teacher-header";

export const dynamic = "force-dynamic";

export default async function Home() {
  let message = "";
  const storageReady = databaseConfigured();
  const loginReady = authConfigured();
  let owner: string | null = null;

  if (loginReady) {
    try {
      owner = await requireTeacher();
    } catch (error) {
      if (error instanceof AppError) message = error.message;
      else throw error;
    }
  }

  if (!storageReady || !owner) {
    const approvalNotice = message.includes("승인된 교사 계정") ? message : "";
    const systemNotice = !storageReady ? "서비스 저장소를 확인하고 있습니다. 실제 학생 자료는 연결이 확인된 뒤에만 수집합니다." : "";
    return <PublicHome loginReady={loginReady} notice={approvalNotice || systemNotice} />;
  }

  const [classes, distributions, assessments] = await Promise.all([
    getClassroomRepository().listClasses(owner),
    getClassroomRepository().listDistributions(owner),
    getRepository().list(owner),
  ]);

  return <main className="real-workspace">
    <TeacherHeader active="home" />
    <TeacherDashboard classes={classes} distributions={distributions} assessments={assessments} />
  </main>;
}

function PublicHome({ loginReady, notice }: { loginReady: boolean; notice: string }) {
  return <main className="public-home">
    <header className="public-header">
      <Link href="/" className="public-brand" aria-label="MUMU 평가 홈">
        <span>M</span>
        <div><strong>MUMU</strong><small>평가</small></div>
      </Link>
      <nav aria-label="서비스 안내">
        <a href="#workflow">평가 흐름</a>
        <a href="#capabilities">핵심 기능</a>
        <Link href="/demo">사용 예시</Link>
      </nav>
      <div className="public-header-actions">
        <Link className="public-text-link" href="/demo">둘러보기</Link>
        {loginReady
          ? <Link className="public-login-link" href="/sign-in">교사 로그인 <span>→</span></Link>
          : <span className="public-login-link disabled">로그인 준비 중</span>}
      </div>
    </header>

    <section className="public-hero">
      <div className="public-hero-copy">
        <span className="public-eyebrow"><i />2022 개정 교육과정 기반 · 초등 평가</span>
        <h1>평가의 순간을,<br /><em>성장의 기록</em>으로.</h1>
        <p>성취기준에서 문항과 루브릭을 설계하고, 학생의 글·사진·말·대화를 근거로 피드백과 다음 학습까지 연결합니다.</p>
        <div className="public-hero-actions">
          {loginReady
            ? <Link className="public-primary-link" href="/sign-in">교사로 시작하기 <span>↗</span></Link>
            : <span className="public-primary-link disabled">서비스 준비 중</span>}
          <Link className="public-secondary-link" href="/demo"><i>▶</i> 실제 화면 미리보기</Link>
        </div>
        <div className="public-trust-row">
          <span><b>✓</b> 교사 최종 판단</span>
          <span><b>✓</b> 학생용 시험지 분리</span>
          <span><b>✓</b> 성장 근거 누적</span>
        </div>
        {notice && <p className="public-access-notice">{notice}</p>}
      </div>

      <div className="public-product-stage" aria-label="MUMU 평가 운영 화면 예시">
        <div className="public-orbit orbit-one" />
        <div className="public-orbit orbit-two" />
        <article className="public-product-window">
          <header>
            <div className="window-brand"><span>M</span><strong>MUMU 평가</strong></div>
            <div className="window-search">학생·평가 검색</div>
            <span className="window-avatar">이</span>
          </header>
          <div className="window-body">
            <aside>
              <span className="active">⌂</span>
              <span>♧</span>
              <span>▤</span>
              <span>◫</span>
            </aside>
            <section className="window-content">
              <div className="window-heading"><div><small>오늘의 평가 운영</small><strong>6학년 1반 성장 대시보드</strong></div><button>＋ 평가 만들기</button></div>
              <div className="window-metrics">
                <article><small>진행 중 평가</small><strong>3</strong><span className="teal">LIVE</span></article>
                <article><small>제출 답안</small><strong>72</strong><span>+18 오늘</span></article>
                <article><small>피드백 대기</small><strong>8</strong><span className="amber">확인 필요</span></article>
              </div>
              <div className="window-grid">
                <article className="window-growth-card">
                  <header><strong>성취기준별 성장</strong><span>이번 학기</span></header>
                  <div className="growth-row"><small>자료 해석</small><i><b style={{ width: "84%" }} /></i><em>상</em></div>
                  <div className="growth-row"><small>근거 제시</small><i><b style={{ width: "67%" }} /></i><em>중</em></div>
                  <div className="growth-row"><small>의견 표현</small><i><b style={{ width: "78%" }} /></i><em>상</em></div>
                  <div className="growth-row"><small>경청과 질문</small><i><b style={{ width: "61%" }} /></i><em>중</em></div>
                </article>
                <article className="window-live-card">
                  <header><strong>실시간 제출</strong><span>24명</span></header>
                  <div><b>김○○</b><i><em style={{ width: "92%" }} /></i><small>제출</small></div>
                  <div><b>박○○</b><i><em style={{ width: "74%" }} /></i><small>작성 중</small></div>
                  <div><b>이○○</b><i><em style={{ width: "100%" }} /></i><small>제출</small></div>
                </article>
              </div>
            </section>
          </div>
        </article>
        <div className="public-floating-note note-one"><span>↗</span><div><small>재평가 성장 확인</small><strong>중 → 상</strong></div></div>
        <div className="public-floating-note note-two"><span>✓</span><div><small>피드백 완료</small><strong>오늘 18건</strong></div></div>
      </div>
    </section>

    <section className="public-proof-strip" id="workflow" aria-label="평가 운영 흐름">
      <article><span>01</span><div><strong>성취기준 정렬</strong><small>학교·학년 교육과정에서 시작</small></div></article>
      <article><span>02</span><div><strong>문항·루브릭 설계</strong><small>초안을 만들고 교사가 수정·확정</small></div></article>
      <article><span>03</span><div><strong>QR로 평가 배포</strong><small>학생에게는 시험지만 제공</small></div></article>
      <article><span>04</span><div><strong>피드백·성장 기록</strong><small>추가 학습과 재평가까지 연결</small></div></article>
    </section>

    <section className="public-capabilities" id="capabilities">
      <div><span>ONE CONTINUOUS FLOW</span><h2>문항 하나에서 학기말 성장 리포트까지.</h2><p>평가를 따로 보관하는 데서 끝나지 않고, 학생이 무엇을 근거로 성장했는지 교사가 설명할 수 있도록 설계했습니다.</p></div>
      <div className="capability-tags"><span>서술형 평가</span><span>손글씨 OCR</span><span>오럴 테스트</span><span>챗봇 평가</span><span>추가 학습</span><span>성장 리포트</span></div>
    </section>
  </main>;
}
