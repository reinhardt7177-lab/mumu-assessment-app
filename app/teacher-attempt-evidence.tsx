"use client";

import { useEffect, useState } from "react";
import type { AssessmentQuestion } from "../lib/assessment-domain";
import { requestJson } from "../lib/client-api";
import type { EvidenceDerivationRecord, ResponseEvidenceRecord } from "../lib/evidence-domain";

const modalityName = { photo: "손글씨 사진", speech: "말하기 녹음", chat: "챗봇 대화", screen: "화면 녹화" };
const helpName = { none: "도움 없음", prompt: "질문 촉진", step_hint: "단계 힌트", example: "다른 맥락 예시" };

function captionTrack(text?: string | null) {
  const caption = text?.trim().replace(/\r?\n/g, " ") || "아직 전사되지 않은 녹음입니다.";
  return `data:text/vtt;charset=utf-8,${encodeURIComponent(`WEBVTT\n\n00:00.000 --> 59:59.000\n${caption}`)}`;
}

export default function TeacherAttemptEvidence({ attemptId, questions }: { attemptId: string; questions: AssessmentQuestion[] }) {
  const [responses, setResponses] = useState<ResponseEvidenceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    requestJson<{ responses: ResponseEvidenceRecord[] }>(`/api/teacher/attempts/${attemptId}/evidence`, { signal: controller.signal })
      .then(data => setResponses(data.responses))
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "복합 응답을 불러오지 못했습니다."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [attemptId]);

  if (loading) return <p className="save-notice" role="status">사진·음성·챗봇·화면 녹화 응답을 불러오는 중…</p>;
  if (error) return <p className="ai-generation-error" role="alert">{error}</p>;
  if (!responses.length) return null;
  return <section className="teacher-multimodal-review">
    <header><div><p className="kicker">MULTIMODAL EVIDENCE</p><h3>사진·음성·챗봇·화면 녹화 응답</h3></div><span>자동 변환 ≠ 학생 성취</span></header>
    <p>원본과 변환본을 대조해 주세요. OCR·전사 오류를 수정하고 확인한 뒤에만 루브릭 AI 추천에 사용할 수 있습니다.</p>
    {questions.map((question, index) => {
      const items = responses.filter(item => item.questionId === question.id);
      if (!items.length) return null;
      return <article className="teacher-evidence-question" key={question.id}><h4>{index + 1}. {question.prompt}</h4>{items.map(item => item.modality === "chat"
        ? <ChatEvidence key={item.id} response={item} />
        : <MediaEvidence key={item.id} attemptId={attemptId} response={item} onChange={setResponses} />)}</article>;
    })}
  </section>;
}

function ChatEvidence({ response }: { response: ResponseEvidenceRecord }) {
  const chat = response.chat;
  if (!chat) return null;
  return <div className="teacher-evidence-item"><header><strong>{modalityName.chat}</strong><small>대화 {Math.floor(chat.elapsedSeconds / 60)}분 {chat.elapsedSeconds % 60}초 · 도움 {chat.helpCount}회</small></header>
    <div className="teacher-chat-transcript">{chat.messages.map(message => <p key={message.id}><b>{message.role === "student" ? "학생" : "생각 도우미"}</b><span>{message.content}</span><small>{message.role === "assistant" ? helpName[message.helpType] : `${message.elapsedSeconds}초`}</small></p>)}</div>
  </div>;
}

function latestComplete(derivations: EvidenceDerivationRecord[]) {
  return derivations.find(item => item.status === "complete") ?? null;
}

function MediaEvidence({ attemptId, response, onChange }: { attemptId: string; response: ResponseEvidenceRecord; onChange: (responses: ResponseEvidenceRecord[]) => void }) {
  const latest = latestComplete(response.derivations);
  const [text, setText] = useState(latest?.extractedText ?? "");
  const [reason, setReason] = useState(latest?.correctionReason ?? "원본과 대조하여 자동 변환 오류를 수정하고 확인함");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const asset = response.assets[0];
  const save = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      const data = await requestJson<{ responses: ResponseEvidenceRecord[] }>(`/api/teacher/attempts/${attemptId}/evidence/${response.id}/correction`, {
        method: "POST", body: JSON.stringify({ text, reason }),
      });
      onChange(data.responses); setNotice("교사 확인본을 새 버전으로 저장했습니다.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "확인본을 저장하지 못했습니다."); }
    finally { setBusy(false); }
  };
  return <div className="teacher-evidence-item"><header><strong>{modalityName[response.modality]}</strong><small>{response.assistanceLevel === "independent" ? "독립 수행" : `도움 수준 · ${response.assistanceLevel}`}</small></header>
    <div className="teacher-evidence-original">
      {asset && response.modality === "photo" ? <>
        {/* Private assets require the teacher's authenticated cookie, so the browser must load the source directly. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/teacher/evidence-assets/${asset.id}`} alt="학생 손글씨 답안 원본" />
      </> : null}
      {asset && response.modality === "speech" ? <audio controls src={`/api/teacher/evidence-assets/${asset.id}`}><track kind="captions" src={captionTrack(latest?.extractedText)} srcLang="ko" label="한국어 전사" default />음성 원본을 재생할 수 없습니다.</audio> : null}
      {asset && response.modality === "screen" ? <video controls src={`/api/teacher/evidence-assets/${asset.id}`}>화면 녹화를 재생할 수 없습니다.</video> : null}
    </div>
    {response.modality === "screen" ? <p className="teacher-screen-review-note">화면 녹화는 학생의 디지털 수행 과정을 교사가 직접 관찰하는 증거입니다. 영상만으로 AI가 성취 수준을 자동 확정하지 않습니다.</p> : <>
      <label>OCR·전사 확인본<textarea value={text} maxLength={50000} disabled={busy} onChange={event => setText(event.target.value)} /></label>
      {latest?.confidence != null && <p className="teacher-confidence">자동 변환 신뢰도 참고값 {Math.round(latest.confidence * 100)}% · 점수나 수준으로 사용하지 않음</p>}
      <label>확인·수정 이유<input value={reason} maxLength={1000} disabled={busy} onChange={event => setReason(event.target.value)} /></label>
      <button type="button" className="outline-button" disabled={busy || !text.trim() || reason.trim().length < 5} onClick={() => void save()}>{busy ? "저장 중…" : latest?.kind === "teacher_correction" ? "확인본 새 버전 저장" : "원본 대조 완료·확인본 저장"}</button>
    </>}
    {notice && <p className="save-notice" role="status">{notice}</p>}{error && <p className="ai-generation-error" role="alert">{error}</p>}
  </div>;
}
