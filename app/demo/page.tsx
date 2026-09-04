"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import AchievementStandardPicker, { type AchievementStandard } from "../achievement-standard-picker";

type View = "curriculum" | "assessments" | "review" | "respond" | "formative";
type ResponseMode = "text" | "photo" | "speech";
type SourceMode = "text" | "audio" | "image";
type QuestionKind = "서술형" | "선택형" | "말하기";

type AssessmentQuestion = {
  id: string;
  prompt: string;
  kind: QuestionKind;
  standardCode: string;
  criterion: string;
  points: number;
};

const subjectOptions = [
  "1학년 국어", "1학년 수학", "2학년 국어", "2학년 수학",
  "3학년 국어", "3학년 사회", "3학년 수학", "3학년 과학", "3학년 도덕", "3학년 영어",
  "4학년 국어", "4학년 사회", "4학년 수학", "4학년 과학", "4학년 도덕", "4학년 영어",
  "5학년 국어", "5학년 사회", "5학년 수학", "5학년 과학", "5학년 도덕", "5학년 영어",
  "6학년 국어", "6학년 사회", "6학년 수학", "6학년 과학", "6학년 도덕", "6학년 영어",
];

const studentRows = [
  { name: "김민지", submitted: "5분 전 제출", flag: "근거 확인 필요" },
  { name: "이서준", submitted: "12분 전 제출", flag: "경계 수준" },
  { name: "박하윤", submitted: "18분 전 제출", flag: "전사 확인 필요" },
  { name: "최지호", submitted: "25분 전 제출", flag: "새 오개념" },
];

const initialAssessments = [
  { id: 1, title: "민주주의의 발전과 사회 변화", subject: "6학년 사회", type: "독립 수행평가", status: "진행 중", submitted: 18, total: 24, review: 4 },
  { id: 2, title: "주장과 근거를 갖춘 글쓰기", subject: "5학년 국어", type: "독립 수행평가", status: "초안", submitted: 0, total: 22, review: 0 },
  { id: 3, title: "곱셈의 의미 알아보기", subject: "3학년 수학", type: "지원형 형성평가", status: "완료", submitted: 21, total: 21, review: 0 },
];

const criteria = [
  {
    name: "개념 이해",
    description: "민주주의 발전의 의미와 변화를 정확히 설명했습니다.",
    evidence: "‘국민의 의견을 정치에 반영할 수 있는 기회’",
    suggested: 3,
  },
  {
    name: "근거 제시",
    description: "선거 제도와 언론의 자유를 구체적 사례로 제시했습니다.",
    evidence: "‘정부의 잘못을 비판하고 다양한 정보를 알 수 있게’",
    suggested: 3,
  },
  {
    name: "논리적 설명",
    description: "변화와 사회적 영향을 연결했지만 관계를 더 설명할 수 있습니다.",
    evidence: "‘공정성과 책임성을 높였습니다’",
    suggested: 2,
  },
];

const initialQuestions: AssessmentQuestion[] = [
  {
    id: "question-1",
    prompt: "민주주의의 발전이 우리 사회에 가져온 변화를 두 가지 제시하고, 각각이 시민의 삶에 어떤 영향을 주었는지 설명하세요.",
    kind: "서술형",
    standardCode: "",
    criterion: "개념 이해",
    points: 20,
  },
];

const chatSeed = [
  { role: "student", time: "00:32", text: "배가 3척 있는데, 한 척에 4명이 타요. 5척이면 모두 몇 명이 타나요?" },
  { role: "coach", time: "00:45", text: "좋아요. 먼저 한 척에 몇 명이 타는지 다시 말해볼까요?" },
  { role: "student", time: "00:58", text: "한 척에 4명이요." },
  { role: "coach", time: "01:05", text: "그럼 5척이면 4명씩 몇 번 있는 것과 같을까요?" },
  { role: "hint", time: "01:52", text: "같은 수를 여러 번 더하는 상황을 곱셈으로 나타낼 수 있어요. ‘한 묶음의 수 × 묶음의 개수’로 생각해 보세요." },
  { role: "student", time: "02:18", text: "아! 4 × 5 = 20이에요." },
];

function NavButton({ active, glyph, label, onClick }: { active: boolean; glyph: string; label: string; onClick: () => void }) {
  return (
    <button className={`nav-button ${active ? "active" : ""}`} onClick={onClick} aria-current={active ? "page" : undefined}>
      <span aria-hidden="true">{glyph}</span>
      <small>{label}</small>
    </button>
  );
}

function StatusToast({ children }: { children: React.ReactNode }) {
  return <div className="status-toast" role="status"><span>✓</span>{children}</div>;
}

function DemoQr() {
  const [joinUrl, setJoinUrl] = useState("/join/6S24");

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setJoinUrl(`${window.location.origin}/join/6S24`);
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="demo-qr" aria-label="학생 시험지 참여 QR 코드">
      <QRCodeSVG value={joinUrl} size={168} level="H" marginSize={1} bgColor="#ffffff" fgColor="#0e2c49" title="학생 시험지 열기" />
    </div>
  );
}

function AssessmentHome({ onOpenReview, onOpenAnalysis }: { onOpenReview: () => void; onOpenAnalysis: () => void }) {
  const [assessments, setAssessments] = useState(initialAssessments);
  const [creating, setCreating] = useState(false);
  const [step, setStep] = useState(1);
  const [created, setCreated] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("6학년 사회");
  const [assessmentType, setAssessmentType] = useState("독립 수행평가");
  const [learningGoal, setLearningGoal] = useState("민주주의의 발전이 우리 사회에 미친 변화를 근거와 함께 설명할 수 있다.");
  const [selectedStandards, setSelectedStandards] = useState<AchievementStandard[]>([]);
  const [methods, setMethods] = useState(["글쓰기"]);
  const [questions, setQuestions] = useState<AssessmentQuestion[]>(initialQuestions);
  const [questionsGenerated, setQuestionsGenerated] = useState(false);
  const [questionsGenerating, setQuestionsGenerating] = useState(false);
  const [questionGenerationError, setQuestionGenerationError] = useState("");
  const [joinUrl, setJoinUrl] = useState("/join/6S24");

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setJoinUrl(`${window.location.origin}/join/6S24`);
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  const toggleMethod = (method: string) => setMethods((current) => current.includes(method) ? current.filter((item) => item !== method) : [...current, method]);
  const updateQuestion = (id: string, patch: Partial<AssessmentQuestion>) => setQuestions((current) => current.map((question) => question.id === id ? { ...question, ...patch } : question));
  const addQuestion = () => setQuestions((current) => [...current, { id: `question-${Date.now()}`, prompt: "", kind: "서술형", standardCode: selectedStandards[0]?.code ?? "", criterion: "개념 이해", points: 10 }]);
  const removeQuestion = (id: string) => setQuestions((current) => current.filter((question) => question.id !== id));
  const generateQuestionDrafts = async () => {
    if (selectedStandards.length === 0 || questionsGenerating) return;
    if (questions.length > 0 && !window.confirm("새 문항 초안을 만들면 현재 작성한 문항이 교체됩니다. 계속할까요?")) return;
    setQuestionsGenerating(true);
    setQuestionsGenerated(false);
    setQuestionGenerationError("");
    try {
      const response = await fetch("/api/ai/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, subject, learningGoal, standards: selectedStandards, count: 3 }),
        signal: AbortSignal.timeout(45_000),
      });
      const payload = await response.json() as { error?: string; questions?: Omit<AssessmentQuestion, "id">[] };
      if (!response.ok || !payload.questions) throw new Error(payload.error || "문항 초안을 만들지 못했습니다.");
      setQuestions(payload.questions.map((question, index) => ({ ...question, id: `question-${Date.now()}-${index + 1}` })));
      setQuestionsGenerated(true);
    } catch (error) {
      setQuestionGenerationError(error instanceof Error && error.name === "TimeoutError" ? "문항 생성 시간이 길어지고 있습니다. 잠시 뒤 다시 시도해 주세요." : error instanceof Error ? error.message : "문항 초안을 만들지 못했습니다.");
    } finally {
      setQuestionsGenerating(false);
    }
  };
  const questionPoints = useMemo(() => questions.reduce((sum, question) => sum + question.points, 0), [questions]);
  const hasValidQuestions = questions.length > 0 && questions.every((question) => question.prompt.trim().length > 0 && question.points > 0);
  const openCreator = () => { setCreating(true); setStep(1); setCreated(false); };
  const closeCreator = () => setCreating(false);
  const finishCreation = () => {
    const newTitle = title.trim() || "새로운 학생 평가";
    setAssessments((current) => [{ id: Date.now(), title: newTitle, subject, type: assessmentType, status: "배포 준비", submitted: 0, total: 24, review: 0 }, ...current]);
    setTitle("");
    setSelectedStandards([]);
    setCreating(false);
    setCreated(true);
    setSharing(true);
  };

  return (
    <div className="assessment-home">
      <section className="home-hero">
        <div>
          <p className="kicker">이준용 선생님의 평가 워크스페이스</p>
          <h2>평가를 만들고, 배포하고, 학생의 성장을 확인하세요.</h2>
          <p>평가 목표와 루브릭을 설정하면 QR·링크 배포부터 응답 수합과 분석까지 한곳에서 이어집니다.</p>
        </div>
        <button className="create-button" onClick={openCreator}><span>＋</span> 새 평가 만들기</button>
      </section>

      <section className="flow-strip" aria-label="평가 진행 과정">
        {[
          ["1", "평가 설계", "목표·문항·방법"], ["2", "QR·링크 배포", "학생에게 공유"], ["3", "응답 수합", "글·사진·음성·대화"], ["4", "AI 분석", "근거·루브릭 추천"], ["5", "교사 확정", "피드백 공개"],
        ].map((item, index) => <div key={item[0]}><span>{item[0]}</span><strong>{item[1]}</strong><small>{item[2]}</small>{index < 4 && <b>→</b>}</div>)}
      </section>

      <section className="home-metrics" aria-label="평가 현황">
        <article><small>진행 중 평가</small><strong>1</strong><span>6학년 사회</span></article>
        <article><small>오늘 수합된 응답</small><strong>18</strong><span>학생 제출</span></article>
        <article><small>교사 검토 필요</small><strong className="warning-number">4</strong><span>우선 확인</span></article>
        <article><small>분석 완료</small><strong>21</strong><span>형성평가 응답</span></article>
      </section>

      <section className="assessment-section">
        <div className="assessment-list-heading">
          <div><p className="kicker">나의 평가</p><h2>만들어진 평가</h2></div>
          <div className="list-controls"><button className="active">전체</button><button>진행 중</button><button>초안</button><button>완료</button></div>
        </div>
        {created && <StatusToast>평가가 만들어졌습니다. QR과 링크로 바로 배포할 수 있어요.</StatusToast>}
        <div className="assessment-cards">
          {assessments.map((assessment) => {
            const progress = assessment.total ? Math.round((assessment.submitted / assessment.total) * 100) : 0;
            return (
              <article className="assessment-card" key={assessment.id}>
                <div className="assessment-card-top"><span className={`status-label status-${assessment.status.replace(" ", "")}`}>{assessment.status}</span><button aria-label="평가 더보기">•••</button></div>
                <p>{assessment.subject} · {assessment.type}</p>
                <h3>{assessment.title}</h3>
                <div className="progress-copy"><span>응답 수합</span><strong>{assessment.submitted} / {assessment.total}</strong></div>
                <div className="progress-track"><i style={{ width: `${progress}%` }} /></div>
                <div className="assessment-card-bottom">
                  <span className={assessment.review ? "needs-review" : ""}>{assessment.review ? `● 검토 필요 ${assessment.review}` : assessment.status === "초안" ? "루브릭 작성 중" : assessment.status === "배포 준비" ? "학생 배포 전" : "✓ 분석 완료"}</span>
                  <div>
                    {assessment.status !== "초안" && assessment.status !== "완료" && <button onClick={() => setSharing(true)}>공유</button>}
                    <button onClick={assessment.status === "초안" ? openCreator : assessment.status === "완료" ? onOpenAnalysis : onOpenReview}>{assessment.status === "초안" ? "계속 만들기" : assessment.status === "완료" ? "분석 보기" : "수합·분석"} →</button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {creating && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeCreator(); }}>
          <section className="create-modal" aria-labelledby="create-title">
            <div className="modal-heading">
              <div>
                <p className="kicker">평가 만들기 · {step} / 6</p>
                <h2 id="create-title">{step === 1 ? "기본 정보" : step === 2 ? "성취기준 선택" : step === 3 ? "평가 문항 만들기" : step === 4 ? "응답 방법 설정" : step === 5 ? "루브릭 확인" : "배포 준비"}</h2>
              </div>
              <button type="button" onClick={closeCreator} aria-label="닫기">×</button>
            </div>
            <div className="creation-path">
              <span className={step >= 1 ? "active" : ""}>1 기본 정보</span><i />
              <span className={step >= 2 ? "active" : ""}>2 성취기준</span><i />
              <span className={step >= 3 ? "active" : ""}>3 평가 문항</span><i />
              <span className={step >= 4 ? "active" : ""}>4 평가 방법</span><i />
              <span className={step >= 5 ? "active" : ""}>5 루브릭</span><i />
              <span className={step >= 6 ? "active" : ""}>6 배포</span>
            </div>
            {step === 1 && (
              <div className="wizard-body">
                <label>평가 이름<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="예: 민주주의의 발전과 사회 변화" /></label>
                <div className="field-row">
                  <label>학년·교과<select value={subject} onChange={(event) => { setSubject(event.target.value); setSelectedStandards([]); setQuestions((current) => current.map((question) => ({ ...question, standardCode: "" }))); }}>{subjectOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
                  <label>평가 유형<select value={assessmentType} onChange={(event) => setAssessmentType(event.target.value)}><option>독립 수행평가</option><option>지원형 형성평가</option></select></label>
                </div>
                <label>학습 목표<textarea value={learningGoal} onChange={(event) => setLearningGoal(event.target.value)} /></label>
              </div>
            )}
            {step === 2 && <AchievementStandardPicker key={subject} subjectLabel={subject} selected={selectedStandards} onChange={setSelectedStandards} />}
            {step === 3 && (
              <div className="wizard-body question-builder">
                <div className="question-builder-heading"><div><p className="wizard-guide">선택한 성취기준을 실제로 확인할 문항을 만드세요. 각 문항은 성취기준과 평가 기준에 연결됩니다.</p><span>{selectedStandards.map((standard) => standard.code).join(" · ")} · 총 {questions.length}문항 · {questionPoints}점</span></div><button type="button" className="ai-question-button" onClick={generateQuestionDrafts} disabled={questionsGenerating}>{questionsGenerating ? "문항 초안 만드는 중…" : questions.length > 0 ? "✦ 문항 초안 다시 만들기" : "✦ 문항 초안 만들기"}</button></div>
                {questionsGenerated && <StatusToast>선택한 성취기준과 학습 목표를 바탕으로 문항 초안을 만들었습니다. 교사가 반드시 검토해 주세요.</StatusToast>}
                {questionGenerationError && <p className="ai-generation-error" role="alert">{questionGenerationError}</p>}
                <div className="question-list">{questions.map((question, index) => <article className="question-editor" key={question.id}><div className="question-editor-head"><strong>문항 {index + 1}</strong><div><select aria-label={`문항 ${index + 1} 유형`} value={question.kind} onChange={(event) => updateQuestion(question.id, { kind: event.target.value as QuestionKind })}><option>서술형</option><option>선택형</option><option>말하기</option></select><button type="button" onClick={() => removeQuestion(question.id)} aria-label={`문항 ${index + 1} 삭제`}>삭제</button></div></div><label>문항 내용<textarea value={question.prompt} onChange={(event) => updateQuestion(question.id, { prompt: event.target.value })} placeholder="학생에게 제시할 평가 문항을 입력하세요." /></label><div className="question-meta"><label>연결 성취기준<select value={question.standardCode} onChange={(event) => updateQuestion(question.id, { standardCode: event.target.value })}><option value="">선택 기준 전체</option>{selectedStandards.map((standard) => <option value={standard.code} key={standard.code}>{standard.code}</option>)}</select></label><label>평가 기준<select value={question.criterion} onChange={(event) => updateQuestion(question.id, { criterion: event.target.value })}>{criteria.map((criterion) => <option key={criterion.name}>{criterion.name}</option>)}</select></label><label>배점<input type="number" min="1" max="100" value={question.points} onChange={(event) => updateQuestion(question.id, { points: Number(event.target.value) })} /></label></div></article>)}</div>
                <button type="button" className="add-question-button" onClick={addQuestion}>＋ 문항 직접 추가</button>
                {!hasValidQuestions && <p className="question-warning">문항 내용과 1점 이상의 배점을 입력해야 다음 단계로 이동할 수 있습니다.</p>}
              </div>
            )}
            {step === 4 && <div className="wizard-body"><p className="wizard-guide">학생에게 허용할 응답 방법을 선택하세요. 평가 목적에 따라 여러 방법을 제공할 수 있습니다.</p><div className="method-grid">{[["글쓰기", "직접 입력한 서술형 답안"], ["손글씨 사진", "OCR로 답안을 읽고 원본 확인"], ["말하기", "녹음과 자동 전사문 수합"], ["챗봇 대화", "힌트와 생각 변화 과정 기록"]].map(([name, description]) => <button className={methods.includes(name) ? "selected" : ""} onClick={() => toggleMethod(name)} key={name}><span>{methods.includes(name) ? "✓" : "+"}</span><strong>{name}</strong><small>{description}</small></button>)}</div><div className="setting-row"><span><strong>학생 참여 방식</strong><small>이름과 참여 코드로 입장</small></span><em>QR · 링크</em></div><div className="setting-row"><span><strong>결과 공개</strong><small>교사 확정 후 학생에게 공개</small></span><em>교사 승인</em></div></div>}
            {step === 5 && <div className="wizard-body"><p className="wizard-guide">성취기준과 문항에 맞는 수준별 판단 기준을 교사가 확인하고 평가 공개 전에 잠급니다.</p><div className="rubric-preview">{criteria.map((criterion, index) => <article key={criterion.name}><span>{index + 1}</span><div><strong>{criterion.name}</strong><small>{criterion.description}</small></div><em>4수준</em></article>)}</div><button className="ai-draft-button">✦ AI로 수준별 예시 답안 만들기</button><div className="lock-note">▣ 평가를 공개하면 루브릭 v1.0으로 잠깁니다.</div></div>}
            {step === 6 && <div className="wizard-body distribution-preview"><DemoQr /><div><p className="kicker">학생 참여 준비 완료</p><h3>{title || "새로운 학생 평가"}</h3><p>{selectedStandards.length}개 성취기준에 연결된 {questions.length}개 평가 문항을 QR 코드, 참여 링크, 수업용 코드로 학생에게 배포할 수 있습니다.</p><div className="join-code"><small>수업용 코드</small><strong>6S24</strong></div><span>{methods.join(" · ") || "응답 방법을 선택하지 않음"}</span></div></div>}
            <div className="modal-actions"><button type="button" className="outline-button" onClick={() => step === 1 ? closeCreator() : setStep((current) => current - 1)}>{step === 1 ? "취소" : "이전"}</button><button type="button" className="primary-button" disabled={(step === 2 && selectedStandards.length === 0) || (step === 3 && !hasValidQuestions)} onClick={() => step === 6 ? finishCreation() : setStep((current) => current + 1)}>{step === 6 ? "평가 만들고 배포" : "다음"}</button></div>
          </section>
        </div>
      )}

      {sharing && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSharing(false); }}>
          <section className="share-modal" aria-labelledby="share-title">
            <div className="modal-heading"><div><p className="kicker">학생 배포</p><h2 id="share-title">QR·링크로 평가 공유</h2></div><button onClick={() => setSharing(false)} aria-label="닫기">×</button></div>
            <div className="share-body"><DemoQr /><div><span className="success-pill">학생 참여 가능</span><h3>민주주의의 발전과 사회 변화</h3><p>QR을 스캔하면 교사용 메뉴 없이 학생 시험지만 바로 열립니다.</p><label>학생 시험지 링크<div><input readOnly value={joinUrl} /><button onClick={async () => { await navigator.clipboard?.writeText(joinUrl); setCopied(true); }}>{copied ? "복사됨" : "링크 복사"}</button></div></label><div className="share-code"><span>수업용 코드</span><strong>6S24</strong></div></div></div>
            <div className="share-summary"><span><strong>응답 방법</strong> 글쓰기 · 손글씨 사진 · 말하기</span><span><strong>현재 수합</strong> 18 / 24명</span><span><strong>마감</strong> 오늘 오후 4:00</span></div>
            <div className="modal-actions"><button className="outline-button" onClick={() => window.open("/join/6S24", "_blank", "noopener,noreferrer")}>학생 시험지 열기</button><button className="primary-button" onClick={() => setSharing(false)}>배포 완료</button></div>
          </section>
        </div>
      )}
    </div>
  );
}

function TeacherReview() {
  const [studentIndex, setStudentIndex] = useState(0);
  const [source, setSource] = useState<SourceMode>("text");
  const [levels, setLevels] = useState(criteria.map((item) => item.suggested));
  const [status, setStatus] = useState<"idle" | "hold" | "confirmed">("idle");

  const selectStudent = (index: number) => {
    setStudentIndex(index);
    setLevels(criteria.map((item) => item.suggested));
    setStatus("idle");
  };

  return (
    <div className="review-layout">
      <aside className="review-queue surface-muted">
        <div className="queue-header">
          <div>
            <p className="kicker">검토 대기열</p>
            <h2>교사 확인 필요</h2>
          </div>
          <span className="count-badge">4</span>
        </div>
        <div className="queue-filter"><span>위험도 높은 순</span><button aria-label="필터 열기">≡</button></div>
        <div className="student-list">
          {studentRows.map((student, index) => (
            <button key={student.name} className={`student-row ${studentIndex === index ? "selected" : ""}`} onClick={() => selectStudent(index)}>
              <span className="student-avatar">{student.name.slice(1)}</span>
              <span className="student-copy"><strong>{student.name}</strong><small>{student.submitted}</small><em>● {student.flag}</em></span>
            </button>
          ))}
        </div>
        <div className="queue-summary"><span>검토 진행률</span><strong>18 / 24</strong><div><i /></div></div>
      </aside>

      <section className="evidence-workspace">
        <div className="panel-heading">
          <div><p className="kicker">{studentRows[studentIndex].name} 학생</p><h2>학생 답안과 평가 근거</h2></div>
          <span className="type-pill">독립 수행평가</span>
        </div>
        <div className="question-card">
          <span>평가 과제</span>
          <strong>민주주의가 발전하면서 우리 사회에 나타난 변화를 근거와 함께 설명하세요.</strong>
        </div>
        <div className="source-tabs" role="tablist" aria-label="학생 답안 유형">
          <button className={source === "text" ? "active" : ""} onClick={() => setSource("text")}>▤ 텍스트</button>
          <button className={source === "audio" ? "active" : ""} onClick={() => setSource("audio")}>◉ 오디오</button>
          <button className={source === "image" ? "active" : ""} onClick={() => setSource("image")}>▧ 이미지</button>
        </div>

        {source === "text" && (
          <div className="answer-sheet">
            <p>민주주의가 발전하면서 <mark>국민의 의견을 정치에 반영할 수 있는 기회</mark>가 늘어났습니다. 예를 들어 선거 제도가 개선되어 더 많은 사람이 투표에 참여할 수 있게 되었고, 언론의 자유가 확대되어 <mark>정부의 잘못을 비판하고 다양한 정보를 알 수 있게 되었습니다.</mark> 이러한 변화는 사회의 공정성과 책임성을 높였습니다.</p>
          </div>
        )}
        {source === "audio" && (
          <div className="audio-source">
            <button className="play-button" aria-label="녹음 재생">▶</button>
            <div className="waveform" aria-hidden="true">{Array.from({ length: 44 }).map((_, i) => <i key={i} style={{ height: `${10 + ((i * 13) % 31)}px` }} />)}</div>
            <span>00:00 / 00:28</span>
            <p><strong>자동 전사문</strong> · 낮은 신뢰도 구간이 없습니다.</p>
          </div>
        )}
        {source === "image" && (
          <div className="image-source">
            <div className="paper-scan"><span>민주주의가 발전하면서 국민의 의견을<br />정치에 반영할 수 있는 기회가 늘어났습니다.<br />선거 제도와 언론의 자유가 확대되었습니다.</span></div>
            <div><span className="success-pill">OCR 확인 완료</span><h3>원본 답안과 변환문이 일치합니다.</h3><p>교사가 수정한 글자는 없습니다.</p></div>
          </div>
        )}
        <div className="evidence-legend"><span /><strong>근거 하이라이트</strong><small>AI가 기준과 연결한 원문입니다. 교사가 직접 확인합니다.</small></div>
      </section>

      <aside className="rubric-workspace">
        <div className="panel-heading">
          <div><p className="kicker">루브릭 v1.0 · 잠금</p><h2>기준별 검토</h2></div>
          <span className="ai-pill">✦ AI 추천</span>
        </div>
        <div className="rubric-list">
          {criteria.map((criterion, index) => (
            <article className="rubric-item" key={criterion.name}>
              <div className="criterion-title"><strong>{criterion.name}</strong><span>추천 {criterion.suggested}</span></div>
              <div className="level-picker" aria-label={`${criterion.name} 수준`}>
                {[1, 2, 3, 4].map((level) => <button key={level} className={levels[index] === level ? "selected" : ""} onClick={() => setLevels((current) => current.map((value, i) => i === index ? level : value))}>{level}</button>)}
              </div>
              <p>{criterion.description}</p>
              <blockquote>{criterion.evidence}</blockquote>
            </article>
          ))}
        </div>
        <div className="ai-summary"><span>✦</span><div><strong>AI 종합 추천 · 3수준</strong><p>두 가지 변화와 사회적 영향을 설명했습니다. 논리 연결은 교사 확인이 필요합니다.</p></div></div>
        {status === "confirmed" && <StatusToast>{studentRows[studentIndex].name} 학생의 평가를 확정했습니다.</StatusToast>}
        {status === "hold" && <div className="hold-notice" role="status">판단 보류함에 저장했습니다.</div>}
        <div className="review-actions">
          <button className="outline-button" onClick={() => setStatus("hold")}>판단 보류</button>
          <button className="primary-button" onClick={() => setStatus("confirmed")}>{status === "confirmed" ? "확정 완료" : "교사 확정"}</button>
        </div>
      </aside>
    </div>
  );
}

function StudentResponse() {
  const [mode, setMode] = useState<ResponseMode>("text");
  const [answer, setAnswer] = useState("민주주의가 발전하면서 국민이 정치에 참여할 기회가 많아졌습니다.");
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(24);
  const [uploaded, setUploaded] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  const time = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <div className="student-page">
      <div className="student-topline"><span>독립 수행평가</span><strong>1 / 1</strong></div>
      <section className="goal-banner"><div className="goal-icon">◎</div><div><p className="kicker">학습 목표</p><h2>민주주의의 발전이 우리 사회에 미친 변화를 근거와 함께 설명할 수 있어요.</h2></div></section>
      <section className="response-card">
        <div className="student-task-heading">
          <div><p className="kicker">평가 과제</p><h1>{mode === "speech" ? "말로 설명해 보세요" : mode === "photo" ? "손글씨 답안을 촬영하세요" : "내 생각을 글로 써보세요"}</h1></div>
          <div className="mode-switch" role="tablist" aria-label="응답 방식">
            <button className={mode === "text" ? "active" : ""} onClick={() => setMode("text")}>▤ 글쓰기</button>
            <button className={mode === "photo" ? "active" : ""} onClick={() => setMode("photo")}>▧ 사진</button>
            <button className={mode === "speech" ? "active" : ""} onClick={() => setMode("speech")}>◉ 말하기</button>
          </div>
        </div>

        {mode === "text" && <div className="write-mode"><label htmlFor="student-answer">나의 답안</label><textarea id="student-answer" value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="평가 과제에 대한 내 생각을 써보세요." /><div className="writing-meta"><span>자동 저장됨</span><span>{answer.length}자</span></div></div>}
        {mode === "photo" && <div className={`photo-mode ${uploaded ? "uploaded" : ""}`}><div className="upload-icon">▧</div><h2>{uploaded ? "답안 이미지가 준비되었습니다" : "답안이 잘 보이도록 촬영해 주세요"}</h2><p>{uploaded ? "OCR 변환 후 원문을 확인할 수 있습니다." : "흐림, 그림자, 잘림이 없도록 찍으면 더 정확하게 읽을 수 있어요."}</p><button onClick={() => setUploaded(true)}>{uploaded ? "다른 사진 선택" : "사진 불러오기"}</button></div>}
        {mode === "speech" && <div className="speech-mode"><div className="record-zone"><button className={`record-button ${recording ? "recording" : ""}`} onClick={() => setRecording((value) => !value)} aria-label={recording ? "녹음 멈추기" : "녹음 시작"}><span>{recording ? "■" : "●"}</span></button><div><p className={recording ? "record-state live" : "record-state"}>{recording ? "녹음 중" : "녹음 준비"}</p><strong className="record-time">{time}</strong><div className="waveform student-wave" aria-hidden="true">{Array.from({ length: 34 }).map((_, i) => <i key={i} style={{ height: `${10 + ((i * 17) % 36)}px`, opacity: recording ? 1 : .35 }} />)}</div></div></div><div className="transcript-card"><p className="kicker">내 말이 이렇게 기록되고 있어요</p><p>민주주의가 발전하면서 국민의 의견이 정책에 반영되는 기회가 많아졌어요. 이로 인해 우리 사회가 더 공정하고 평등하게 변화했어요.</p></div><div className="privacy-note">▣ 내 답변은 안전하게 저장되며 선생님에게만 제출됩니다.</div></div>}

        {submitted && <StatusToast>답안이 제출되었습니다. 선생님의 확인 후 결과가 공개됩니다.</StatusToast>}
        <div className="student-actions"><button className="outline-button" onClick={() => { setAnswer(""); setSeconds(0); setUploaded(false); setSubmitted(false); }}>다시 하기</button><button className="primary-button" onClick={() => { setRecording(false); setSubmitted(true); }}>제출하기</button></div>
      </section>
    </div>
  );
}

function FormativeAnalysis() {
  const [messages, setMessages] = useState(chatSeed);
  const [input, setInput] = useState("");
  const [memo, setMemo] = useState("");
  const [saved, setSaved] = useState(false);

  const sendMessage = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;
    setMessages((current) => [...current, { role: "student", time: "지금", text: trimmed }, { role: "coach", time: "지금", text: "좋아요. 방금 설명에서 ‘한 묶음의 수’와 ‘묶음의 개수’를 찾아 다시 말해볼까요?" }]);
    setInput("");
  };

  return (
    <div className="formative-page">
      <section className="metric-row">
        <article><span>◷</span><div><small>학습 시간</small><strong>12분 34초</strong><em>과정 참고 정보</em></div></article>
        <article><span>◌</span><div><small>대화</small><strong>8회</strong><em>학생 발화 4회</em></div></article>
        <article><span>◈</span><div><small>힌트 사용</small><strong>2단계</strong><em>최소 힌트부터 제공</em></div></article>
        <article className="ai-metric"><span>✦</span><div><small>AI 추천 도달 수준</small><strong>성장 중</strong><em>교사 확인 전 추천</em></div></article>
      </section>

      <div className="formative-grid">
        <section className="chat-panel">
          <div className="panel-heading"><div><p className="kicker">김민지 학생</p><h2>챗봇과의 대화</h2></div><span className="type-pill">지원형 형성평가</span></div>
          <div className="chat-scroll" aria-live="polite">
            {messages.map((message, index) => <div className={`chat-line ${message.role}`} key={`${message.time}-${index}`}><time>{message.time}</time><span className="speaker">{message.role === "student" ? "학생" : message.role === "coach" ? "학습코치" : "생각 힌트"}</span><p>{message.text}</p></div>)}
          </div>
          <form className="chat-input" onSubmit={sendMessage}><label htmlFor="chat-message" className="sr-only">학생 답변 입력</label><input id="chat-message" value={input} onChange={(event) => setInput(event.target.value)} placeholder="학생 답변을 입력해 대화를 시뮬레이션해 보세요." /><button type="submit">보내기</button></form>
        </section>

        <section className="analysis-panel">
          <div className="panel-heading"><div><p className="kicker">과정 증거 기반</p><h2>학습 분석 요약</h2></div><span className="ai-pill">✦ AI 분석</span></div>
          <div className="growth-flow"><article><span>처음 생각</span><strong>4 + 4 + 4 + 4 + 4 = 20</strong><p>반복되는 구조를 덧셈으로 표현함</p></article><b>→</b><article><span>수정한 생각</span><strong>4 × 5 = 20</strong><p>곱셈식으로 일반화해 설명함</p></article></div>
          <div className="analysis-cards">
            <article className="strength"><span>✓</span><div><h3>확인된 강점</h3><p>문제에서 필요한 정보를 찾고, 덧셈을 곱셈으로 연결했습니다.</p></div></article>
            <article className="misconception"><span>!</span><div><h3>남은 오개념</h3><p>‘한 묶음의 수’와 ‘묶음의 개수’의 순서를 상황에 따라 혼동할 수 있습니다.</p></div></article>
            <article className="next-step"><span>→</span><div><h3>다음 학습 제안</h3><p>다양한 묶음 상황을 그림과 곱셈식으로 함께 나타내는 연습을 권합니다.</p></div></article>
          </div>
          <blockquote className="conversation-evidence"><span>대화 근거</span>“아! 4 × 5 = 20이에요.”<small>02:18 학생 발화</small></blockquote>
          <div className="memo-box"><label htmlFor="teacher-memo">교사 메모</label><textarea id="teacher-memo" value={memo} onChange={(event) => { setMemo(event.target.value); setSaved(false); }} placeholder="학생의 학습 과정과 다음 지원 계획을 메모하세요." /><button onClick={() => setSaved(true)}>피드백 저장</button></div>
          {saved && <StatusToast>교사 메모와 피드백을 저장했습니다.</StatusToast>}
        </section>
      </div>
    </div>
  );
}

type MasterLevel = "상" | "중" | "하";

const curriculumUnits = [
  {
    id: "democracy",
    order: "1단원",
    title: "민주주의와 시민 참여",
    standards: "6사08-01 · 6사08-02",
    standardText: "[6사08-01] 민주주의에서 선거의 의미와 역할을 파악하고, 시민의 주권 행사를 위해 선거에 참여하는 태도를 기른다. [6사08-02] 민주 국가에서 국회, 행정부, 법원이 하는 일에 대해 이해하고, 각 국가기관의 권력을 분립하는 이유를 탐색한다.",
    state: "피드백 진행",
    rubricReady: true,
    assessed: 24,
    high: 8,
    middle: 11,
    low: 5,
  },
  {
    id: "media",
    order: "2단원",
    title: "미디어와 민주 시민",
    standards: "6사08-03",
    standardText: "[6사08-03] 민주주의에서 미디어의 의미와 역할을 이해하고, 여러 가지 미디어의 내용을 비판적으로 분석하여 올바르게 이용하는 태도를 기른다.",
    state: "평가 설계",
    rubricReady: false,
    assessed: 0,
    high: 0,
    middle: 0,
    low: 0,
  },
  {
    id: "world",
    order: "3단원",
    title: "지구, 대륙 그리고 국가들",
    standards: "6사09-01 · 6사09-02",
    standardText: "[6사09-01] 세계를 표현하는 다양한 공간 자료의 특징을 이해하고, 지구본과 세계지도에서 위치를 표현하는 방법을 익힌다. [6사09-02] 세계 주요 대륙과 대양을 파악하고, 우리나라 및 세계 여러 국가의 위치와 영토의 특징을 이해한다.",
    state: "수업 예정",
    rubricReady: false,
    assessed: 0,
    high: 0,
    middle: 0,
    low: 0,
  },
];

const growthStudents = [
  { name: "김민지", first: "중" as MasterLevel, current: "상" as MasterLevel, evidence: 3, gap: "선거와 시민 주권의 관계를 구체 사례로 설명하기", next: "미디어 자료의 관점을 비교하는 확장 학습" },
  { name: "이서준", first: "하" as MasterLevel, current: "중" as MasterLevel, evidence: 4, gap: "국가기관별 역할을 권력 분립의 이유와 연결하기", next: "역할 카드 분류 후 새로운 사례로 재설명" },
  { name: "박하윤", first: "상" as MasterLevel, current: "상" as MasterLevel, evidence: 3, gap: "서로 다른 자료의 관점을 비교해 판단하기", next: "서로 다른 선거 공약을 분석하는 확장 탐구" },
  { name: "최지호", first: "하" as MasterLevel, current: "하" as MasterLevel, evidence: 2, gap: "선거를 절차가 아닌 시민의 주권 행사로 이해하기", next: "소집단 재학습 후 그림 자료를 활용한 구술 재평가" },
];

const rubricDescriptors = [
  {
    criterion: "개념과 원리",
    high: "선거의 의미와 역할을 시민 주권과 연결하고, 권력 분립이 필요한 이유를 국가기관의 관계로 설명한다.",
    middle: "선거와 국가기관의 역할을 설명하고, 시민 참여 또는 권력 분립의 중요성을 사례와 연결한다.",
    low: "선거를 투표 절차로 설명하거나 국가기관의 이름을 제시하지만, 시민 주권·권력 분립과의 연결 근거는 드러나지 않는다.",
  },
  {
    criterion: "근거 활용",
    high: "자료에서 관련 사실을 선택하고, 그 사실이 자신의 설명을 뒷받침하는 이유를 밝힌다.",
    middle: "관련 사례나 자료를 제시하고 주장과 연결하지만, 근거가 설명을 뒷받침하는 이유는 부분적으로 드러난다.",
    low: "사례를 나열하거나 자료의 문장을 옮기지만, 주장과 근거의 관계는 드러나지 않는다.",
  },
  {
    criterion: "민주적 참여 태도",
    high: "공동의 문제에서 서로 다른 의견을 비교하고, 시민으로서 가능한 참여 방법을 이유와 함께 제안한다.",
    middle: "서로 다른 의견이 있음을 알고, 시민 참여 방법을 한 가지 제안한다.",
    low: "자신의 의견은 말하지만 다른 관점이나 참여 방법은 아직 제시하지 않는다.",
  },
];

function LevelBadge({ level }: { level: MasterLevel }) {
  return <span className={"master-level level-" + level}>{level}</span>;
}

function CurriculumMaster({ onCreateAssessment }: { onCreateAssessment: () => void }) {
  const [unitId, setUnitId] = useState("democracy");
  const [studentIndex, setStudentIndex] = useState(0);
  const [cycleRecorded, setCycleRecorded] = useState(false);
  const unit = curriculumUnits.find((item) => item.id === unitId) ?? curriculumUnits[0];
  const student = growthStudents[studentIndex];
  const currentLevel = cycleRecorded && student.current === "하" ? "중" : student.current;

  return (
    <div className="curriculum-master">
      <section className="master-hero">
        <div>
          <span className="master-eyebrow">교육과정 → 수업 → 평가 → 성장 → 기록</span>
          <h2>교육과정 평가 마스터</h2>
          <p>성취기준별 수행 증거를 단원마다 쌓고, 피드백과 추가 학습·재평가를 거쳐 학기말 성장 결과로 연결합니다.</p>
        </div>
        <div className="master-hero-actions"><span>상·중·하 = 준거 수준 · 석차 아님</span><button type="button" onClick={onCreateAssessment}>＋ 단원 평가 설계</button></div>
      </section>

      <section className="master-cycle" aria-label="교육과정 평가 순환 과정">
        {[
          ["1", "성취기준 해석", "관찰 가능한 성공 기준"],
          ["2", "단원 평가", "여러 방식의 수행 증거"],
          ["3", "루브릭 판단", "기준별 상·중·하"],
          ["4", "피드백·추가 학습", "격차에 맞춘 다음 수업"],
          ["5", "재평가", "성장한 독립 수행 확인"],
          ["6", "학기말 종합", "증거 기반 교사 판단"],
        ].map(([number, label, note], index) => <article key={number}><span>{number}</span><div><strong>{label}</strong><small>{note}</small></div>{index < 5 ? <b>→</b> : null}</article>)}
      </section>

      <section className="master-metrics" aria-label="교육과정 평가 현황">
        <article><span>성취기준</span><strong>9</strong><small>이번 학기 평가 계획</small></article>
        <article><span>수집된 수행 증거</span><strong>68</strong><small>글·관찰·구술·대화</small></article>
        <article><span>추가 학습 진행</span><strong>5명</strong><small>격차별 맞춤 지원</small></article>
        <article className="growth-metric"><span>수준 상승</span><strong>7명</strong><small>재평가에서 확인</small></article>
      </section>

      <section className="master-section">
        <div className="master-section-heading"><div><p className="kicker">교육과정 지도</p><h2>단원별 성취기준과 평가 진행</h2></div><button className="outline-button">학기 평가 계획 보기</button></div>
        <div className="unit-map">
          {curriculumUnits.map((item) => (
            <button type="button" key={item.id} className={unitId === item.id ? "selected" : ""} onClick={() => setUnitId(item.id)}>
              <span>{item.order}<em>{item.state}</em></span>
              <strong>{item.title}</strong>
              <small>{item.standards}</small>
              {item.assessed > 0 ? <div className="unit-levels"><i className="high" style={{ width: item.high / item.assessed * 100 + "%" }} /><i className="middle" style={{ width: item.middle / item.assessed * 100 + "%" }} /><i className="low" style={{ width: item.low / item.assessed * 100 + "%" }} /></div> : <div className="unit-empty">평가 전</div>}
            </button>
          ))}
        </div>
      </section>

      <div className="master-dashboard-grid">
        <section className="master-section rubric-overview">
          <div className="master-section-heading"><div><p className="kicker">{unit.standards}</p><h2>{unit.title} · 준거참조 루브릭</h2></div><span className="validity-chip">성취기준 정렬 확인</span></div>
          <p className="master-standard">{unit.standardText}</p>
          {unit.rubricReady ? (
            <>
              <div className="master-rubric-table" role="table" aria-label="성취기준 루브릭">
                <div className="rubric-table-head" role="row"><strong>평가 요소</strong><span>상</span><span>중</span><span>하</span></div>
                {rubricDescriptors.map((row) => <div className="rubric-table-row" role="row" key={row.criterion}><strong>{row.criterion}</strong><p>{row.high}</p><p>{row.middle}</p><p>{row.low}</p></div>)}
              </div>
              <div className="rubric-note"><strong>판단 원칙</strong><span>수행물 하나의 총점이 아니라 기준별 근거를 따로 판단합니다. 표현 방식은 성취기준이 요구하지 않는 한 수준을 낮추는 이유로 사용하지 않습니다.</span></div>
            </>
          ) : (
            <div className="unit-planning-empty">
              <span>루브릭 설계 전</span>
              <strong>이 성취기준의 관찰 가능한 성공 기준부터 설계합니다.</strong>
              <p>성취기준을 평가 요소로 풀고, 각 요소의 상·중·하 수행 기술문과 평가 문항을 함께 만듭니다.</p>
              <button type="button" className="primary-button" onClick={onCreateAssessment}>이 단원 평가 설계하기</button>
            </div>
          )}
        </section>

        <aside className="master-section student-growth-panel">
          <div className="master-section-heading"><div><p className="kicker">학생 성장 기록</p><h2>피드백에서 재평가까지</h2></div><select aria-label="학생 선택" value={studentIndex} onChange={(event) => { setStudentIndex(Number(event.target.value)); setCycleRecorded(false); }}>{growthStudents.map((item, index) => <option value={index} key={item.name}>{item.name}</option>)}</select></div>
          <div className="student-level-change"><div><small>최초 수행</small><LevelBadge level={student.first} /></div><b>→</b><div><small>현재 확인 수준</small><LevelBadge level={currentLevel} /></div><span>증거 {student.evidence + (cycleRecorded ? 1 : 0)}개</span></div>
          <ol className="learning-cycle-log">
            <li className="done"><span>1</span><div><strong>단원 수행 증거</strong><p>서술형 답안과 수업 관찰 기록을 기준별로 연결했습니다.</p></div></li>
            <li className="done"><span>2</span><div><strong>핵심 격차 진단</strong><p>{student.gap}</p><em>개념·절차·표현 격차를 구분해 기록</em></div></li>
            <li className="active"><span>3</span><div><strong>추가 학습</strong><p>{student.next}</p></div></li>
            <li className={cycleRecorded ? "done" : ""}><span>4</span><div><strong>재평가 증거</strong><p>{cycleRecorded ? "새로운 과제에서 학생이 도움 없이 설명한 근거를 추가했습니다." : "같은 답을 외우는 재시험이 아니라 새로운 맥락의 독립 수행을 확인합니다."}</p></div></li>
          </ol>
          <button type="button" className="primary-button full-button" onClick={() => setCycleRecorded(true)}>{cycleRecorded ? "성장 증거 기록됨" : "＋ 추가 학습·재평가 기록"}</button>
        </aside>
      </div>

      <section className="master-section semester-section">
        <div className="master-section-heading"><div><p className="kicker">학기말 종합 평가 미리보기</p><h2>성취기준별 증거를 모아 학생의 성장을 설명합니다</h2></div><button className="primary-button">학기말 종합 판단 열기</button></div>
        <div className="semester-grid">
          <div className="student-growth-list">
            {growthStudents.map((item, index) => <button type="button" key={item.name} className={studentIndex === index ? "selected" : ""} onClick={() => { setStudentIndex(index); setCycleRecorded(false); }}><span>{item.name.slice(1)}</span><div><strong>{item.name}</strong><small>수행 증거 {item.evidence}개</small></div><LevelBadge level={item.current} /><em>{item.first !== item.current ? item.first + "→" + item.current + " 성장" : "수준 유지"}</em></button>)}
          </div>
          <div className="semester-evidence">
            <div className="semester-rule"><span>종합 판단 원칙</span><strong>최근의 독립 수행 + 반복 확인 + 교사 근거 기록</strong><p>단순 평균이나 한 번의 최고 점수로 결정하지 않으며, 근거가 부족하면 “판단 보류”로 남깁니다.</p></div>
            {[
              ["6사08-01", "선거와 시민 주권", student.current, "3개", "상승"],
              ["6사08-02", "국가기관과 권력 분립", "중", "2개", "유지"],
              ["6사08-03", "미디어 비판적 분석", "판단 전", "0개", "평가 예정"],
            ].map(([code, label, level, evidence, trend]) => <div className="semester-standard-row" key={code}><span>{code}</span><strong>{label}</strong><em>{evidence}</em>{level === "판단 전" ? <b className="pending-level">판단 전</b> : <LevelBadge level={level as MasterLevel} />}<small>{trend}</small></div>)}
            <blockquote>“민주주의의 핵심 개념을 사례와 연결해 설명하는 수준이 향상되었습니다. 권력 분립은 기관별 역할을 넘어 상호 견제의 이유를 설명하는 추가 경험이 필요합니다.”</blockquote>
            <p className="teacher-final-note">AI는 근거를 정리하고 문장 초안을 제안합니다. <strong>학기말 종합 수준과 서술은 교사가 최종 확정합니다.</strong></p>
          </div>
        </div>
      </section>
    </div>
  );
}

export default function Home() {
  const [view, setView] = useState<View>("curriculum");
  const pageTitle = useMemo(() => ({ curriculum: "교육과정 성장 평가", assessments: "단원 평가 설계", review: "루브릭 검토", respond: "학생 평가 화면", formative: "학습 과정 분석" })[view], [view]);

  return (
    <main className="app-shell">
      <aside className="side-navigation">
        <button className="brand-lockup" onClick={() => setView("curriculum")} aria-label="Mumu 평가 홈"><span>M</span><strong>Mumu<br />평가</strong></button>
        <nav aria-label="주요 메뉴">
          <NavButton active={view === "curriculum"} glyph="◎" label="교육과정" onClick={() => setView("curriculum")} />
          <NavButton active={view === "assessments"} glyph="▤" label="단원 평가" onClick={() => setView("assessments")} />
          <NavButton active={view === "review"} glyph="▣" label="루브릭 검토" onClick={() => setView("review")} />
          <NavButton active={view === "formative"} glyph="↗" label="성장 기록" onClick={() => setView("formative")} />
          <NavButton active={view === "respond"} glyph="✎" label="학생 화면" onClick={() => setView("respond")} />
        </nav>
        <div className="nav-spacer" />
        <div className="teacher-profile"><span>이</span><small>이준용<br />선생님</small></div>
      </aside>

      <section className="app-content">
        <header className="topbar">
          <div><p className="kicker">2026학년도 · 6학년 1학기 사회</p><h1>{pageTitle}</h1></div>
          <div className="top-actions"><span className="sync-state"><i /> 모든 변경사항 저장됨</span><button aria-label="알림">♢<b>2</b></button></div>
        </header>
        {view === "curriculum" && <CurriculumMaster onCreateAssessment={() => setView("assessments")} />}
        {view === "assessments" && <AssessmentHome onOpenReview={() => setView("review")} onOpenAnalysis={() => setView("formative")} />}
        {view === "review" && <TeacherReview />}
        {view === "respond" && <StudentResponse />}
        {view === "formative" && <FormativeAnalysis />}
      </section>
    </main>
  );
}
