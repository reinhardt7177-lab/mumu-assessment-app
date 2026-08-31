"use client";

import { useEffect, useState } from "react";

type ResponseMode = "text" | "photo" | "speech";

function SubmissionToast() {
  return <div className="status-toast" role="status"><span>✓</span>답안이 제출되었습니다. 선생님의 확인 후 결과가 공개됩니다.</div>;
}

export default function StudentExam({ code }: { code: string }) {
  const [mode, setMode] = useState<ResponseMode>("text");
  const [answer, setAnswer] = useState("");
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [uploaded, setUploaded] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  const time = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const reset = () => {
    setAnswer("");
    setSeconds(0);
    setUploaded(false);
    setSubmitted(false);
    setRecording(false);
  };

  return (
    <main className="exam-shell">
      <header className="exam-header">
        <div className="exam-brand"><span>M</span><strong>Mumu 평가</strong></div>
        <div className="exam-security"><i /> 학생 시험 화면</div>
      </header>

      <div className="student-page standalone-student-page">
        <div className="student-topline"><span>6학년 사회 · 독립 수행평가</span><strong>문항 1 / 1</strong></div>
        <section className="exam-title-card">
          <div>
            <p className="kicker">참여 코드 {code}</p>
            <h1>민주주의의 발전과 사회 변화</h1>
            <p>아래 과제를 읽고 편한 방법으로 답해 주세요. 답은 제출 전까지 바꿀 수 있어요.</p>
          </div>
          <span className="exam-time">예상 10분</span>
        </section>

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

          <div className="student-question">민주주의가 발전하면서 우리 사회에 나타난 변화를 두 가지 이상 들고, 그 변화가 왜 중요한지 설명하세요.</div>

          {mode === "text" && <div className="write-mode"><label htmlFor="student-exam-answer">나의 답안</label><textarea id="student-exam-answer" value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="평가 과제에 대한 내 생각을 써보세요." /><div className="writing-meta"><span>이 기기에 자동 저장 중</span><span>{answer.length}자</span></div></div>}
          {mode === "photo" && <div className={`photo-mode ${uploaded ? "uploaded" : ""}`}><div className="upload-icon">▧</div><h2>{uploaded ? "답안 이미지가 준비되었습니다" : "답안이 잘 보이도록 촬영해 주세요"}</h2><p>{uploaded ? "사진을 제출하면 선생님이 원본 답안과 함께 확인합니다." : "흐림, 그림자, 잘림이 없도록 찍으면 글씨를 더 정확하게 읽을 수 있어요."}</p><button onClick={() => setUploaded(true)}>{uploaded ? "다른 사진 선택" : "사진 불러오기"}</button></div>}
          {mode === "speech" && <div className="speech-mode"><div className="record-zone"><button className={`record-button ${recording ? "recording" : ""}`} onClick={() => setRecording((value) => !value)} aria-label={recording ? "녹음 멈추기" : "녹음 시작"}><span>{recording ? "■" : "●"}</span></button><div><p className={recording ? "record-state live" : "record-state"}>{recording ? "녹음 중" : "녹음 준비"}</p><strong className="record-time">{time}</strong><div className="waveform student-wave" aria-hidden="true">{Array.from({ length: 34 }).map((_, i) => <i key={i} style={{ height: `${10 + ((i * 17) % 36)}px`, opacity: recording ? 1 : .35 }} />)}</div></div></div><div className="transcript-card"><p className="kicker">말하기 안내</p><p>과제에 답한 뒤, 그렇게 생각한 이유와 근거를 차례대로 말해 주세요. 녹음을 마치면 전사문을 확인할 수 있어요.</p></div><div className="privacy-note">▣ 내 답변은 안전하게 저장되며 담당 선생님에게만 제출됩니다.</div></div>}

          {submitted && <SubmissionToast />}
          <div className="student-actions"><button className="outline-button" onClick={reset}>다시 하기</button><button className="primary-button" onClick={() => { setRecording(false); setSubmitted(true); }}>{submitted ? "제출 완료" : "답안 제출하기"}</button></div>
        </section>
        <p className="exam-footer-note">평가 중 문제가 생기면 화면을 닫지 말고 선생님께 알려 주세요.</p>
      </div>
    </main>
  );
}
