"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { StudentAssessmentQuestion } from "../lib/assessment-domain";
import { requestFormData, requestJson } from "../lib/client-api";
import type { ResponseEvidenceRecord, StudentEvidencePayload } from "../lib/evidence-domain";

type Method = "text" | "photo" | "speech" | "chat" | "screen";
type Props = {
  code: string;
  question: StudentAssessmentQuestion;
  methods: Method[];
  disabled: boolean;
  textValue: string;
  elapsedSeconds: number;
  evidence: ResponseEvidenceRecord[];
  policy: StudentEvidencePayload["policy"];
  onTextChange: (value: string) => void;
  onEvidenceChange: (value: ResponseEvidenceRecord[]) => void;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
};

const labels: Record<Method, { icon: string; title: string; description: string }> = {
  text: { icon: "✎", title: "화면에서 답하기", description: "보기 선택 또는 글 입력" },
  photo: { icon: "▣", title: "손글씨 사진", description: "답안 영역 촬영 후 OCR 확인" },
  speech: { icon: "●", title: "말로 답하기", description: "녹음 후 전사 내용 확인" },
  chat: { icon: "⌁", title: "대화로 답하기", description: "질문을 받으며 생각 설명하기" },
  screen: { icon: "▱", title: "화면 녹화", description: "디지털 수행 과정을 영상으로 남기기" },
};

function latestForQuestion(evidence: ResponseEvidenceRecord[], questionId: string, modality: Exclude<Method, "text">) {
  return evidence.filter(item => item.questionId === questionId && item.modality === modality).at(-1) ?? null;
}

function captionTrack(text?: string | null) {
  const caption = text?.trim().replace(/\r?\n/g, " ") || "아직 전사되지 않은 녹음입니다.";
  return `data:text/vtt;charset=utf-8,${encodeURIComponent(`WEBVTT\n\n00:00.000 --> 59:59.000\n${caption}`)}`;
}

export function responseIsComplete(response: ResponseEvidenceRecord | null) {
  if (!response) return false;
  if (response.modality === "chat") return Boolean(response.chat?.messages.some(message => message.role === "student"));
  return response.derivations.some(item => item.status === "complete" && Boolean(item.extractedText?.trim()));
}

export default function StudentEvidenceResponse(props: Props) {
  const { code, question, methods, disabled, textValue, elapsedSeconds, evidence, policy } = props;
  const [method, setMethod] = useState<Method>(methods.includes("text") ? "text" : methods[0]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [identifiersRemoved, setIdentifiersRemoved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [chatMessage, setChatMessage] = useState("");
  const [recording, setRecording] = useState(false);
  const [recordedUrl, setRecordedUrl] = useState("");
  const [recordedSeconds, setRecordedSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordStartedAt = useRef(0);
  const screenStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    if (screenStopTimerRef.current) clearTimeout(screenStopTimerRef.current);
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
  }, [recordedUrl]);

  const photo = latestForQuestion(evidence, question.id, "photo");
  const speech = latestForQuestion(evidence, question.id, "speech");
  const chat = latestForQuestion(evidence, question.id, "chat");
  const screen = latestForQuestion(evidence, question.id, "screen");
  const selectedResponse = method === "photo" ? photo : method === "speech" ? speech : method === "chat" ? chat : method === "screen" ? screen : null;
  const latestDerivation = selectedResponse?.derivations.find(item => item.status === "complete") ?? selectedResponse?.derivations[0];
  const aiReady = policy.enabled && policy.aiConfigured;
  const mediaReady = aiReady && policy.storageConfigured;
  const tabs = useMemo(() => methods.filter(item => labels[item]), [methods]);

  const uploadAndProcess = async (modality: "photo" | "speech" | "screen") => {
    if (!selectedFile || !identifiersRemoved) return;
    setBusy(true); props.onError("");
    try {
      const form = new FormData();
      form.set("questionId", question.id);
      form.set("modality", modality);
      form.set("file", selectedFile);
      form.set("identifiersRemoved", "true");
      if ((modality === "speech" || modality === "screen") && recordedSeconds > 0) form.set("durationSeconds", String(recordedSeconds));
      const uploaded = await requestFormData<{ responses: ResponseEvidenceRecord[] }>(`/api/student/${code}/evidence`, form);
      props.onEvidenceChange(uploaded.responses);
      const response = latestForQuestion(uploaded.responses, question.id, modality);
      if (!response) throw new Error("업로드한 답안을 찾을 수 없습니다.");
      if (modality === "screen") {
        props.onNotice("화면 녹화를 비공개로 저장했어요. 선생님이 수행 과정을 직접 확인합니다.");
        setSelectedFile(null); setIdentifiersRemoved(false); setRecordedUrl(""); setRecordedSeconds(0);
        return;
      }
      props.onNotice(modality === "photo" ? "사진을 안전하게 저장했어요. 글자를 읽는 중…" : "녹음을 안전하게 저장했어요. 말한 내용을 옮기는 중…");
      const processed = await requestJson<{ responses: ResponseEvidenceRecord[] }>(`/api/student/${code}/evidence/${response.id}/process`, {
        method: "POST", body: "{}", signal: AbortSignal.timeout(60_000),
      });
      props.onEvidenceChange(processed.responses);
      props.onNotice(modality === "photo" ? "손글씨 변환이 끝났어요. 읽힌 내용을 확인해 주세요." : "음성 전사가 끝났어요. 옮겨진 내용을 확인해 주세요.");
      setSelectedFile(null); setIdentifiersRemoved(false);
    } catch (reason) {
      props.onError(reason instanceof Error ? reason.message : "응답을 처리하지 못했어요.");
    } finally { setBusy(false); }
  };

  const startRecording = async () => {
    props.onError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw new Error("이 기기에서는 브라우저 녹음을 지원하지 않아요. 녹음 파일을 선택해 주세요.");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const preferred = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "";
      const recorder = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined);
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = () => {
        const mimeType = (recorder.mimeType || "audio/webm").split(";", 1)[0];
        const blob = new Blob(chunks, { type: mimeType });
        if (recordedUrl) URL.revokeObjectURL(recordedUrl);
        const url = URL.createObjectURL(blob);
        setRecordedUrl(url);
        setRecordedSeconds(Math.max(1, Math.min(180, Math.round((Date.now() - recordStartedAt.current) / 1000))));
        setSelectedFile(new File([blob], `oral-answer.${mimeType === "audio/mp4" ? "m4a" : "webm"}`, { type: mimeType }));
        stream.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      };
      recorderRef.current = recorder;
      recordStartedAt.current = Date.now();
      recorder.start(500);
      setRecording(true);
    } catch (reason) { props.onError(reason instanceof Error ? reason.message : "마이크를 시작하지 못했어요."); }
  };

  const stopRecording = () => {
    if (screenStopTimerRef.current) clearTimeout(screenStopTimerRef.current);
    screenStopTimerRef.current = null;
    if (recorderRef.current?.state !== "inactive") recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  };

  const startScreenRecording = async () => {
    props.onError("");
    try {
      if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === "undefined") throw new Error("이 기기에서는 화면 녹화를 지원하지 않아요. 녹화 파일을 선택해 주세요.");
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 10 }, audio: false });
      streamRef.current = stream;
      const preferred = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : MediaRecorder.isTypeSupported("video/webm") ? "video/webm" : "";
      const recorder = new MediaRecorder(stream, preferred ? { mimeType: preferred, videoBitsPerSecond: 350_000 } : { videoBitsPerSecond: 350_000 });
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = () => {
        if (screenStopTimerRef.current) clearTimeout(screenStopTimerRef.current);
        screenStopTimerRef.current = null;
        const mimeType = (recorder.mimeType || "video/webm").split(";", 1)[0];
        const blob = new Blob(chunks, { type: mimeType });
        if (recordedUrl) URL.revokeObjectURL(recordedUrl);
        setRecordedUrl(URL.createObjectURL(blob));
        setRecordedSeconds(Math.max(1, Math.min(30, Math.round((Date.now() - recordStartedAt.current) / 1000))));
        setSelectedFile(new File([blob], `screen-answer.${mimeType === "video/mp4" ? "mp4" : "webm"}`, { type: mimeType }));
        stream.getTracks().forEach(track => track.stop());
        streamRef.current = null;
        setRecording(false);
      };
      stream.getVideoTracks()[0].onended = () => { if (recorder.state !== "inactive") recorder.stop(); };
      recorderRef.current = recorder;
      recordStartedAt.current = Date.now();
      recorder.start(500);
      setRecording(true);
      screenStopTimerRef.current = setTimeout(() => { if (recorder.state !== "inactive") recorder.stop(); }, 30_000);
    } catch (reason) { props.onError(reason instanceof Error ? reason.message : "화면 녹화를 시작하지 못했어요."); }
  };

  const sendChat = async () => {
    if (!chatMessage.trim()) return;
    setBusy(true); props.onError("");
    try {
      const data = await requestJson<{ responses: ResponseEvidenceRecord[] }>(`/api/student/${code}/evidence/chat`, {
        method: "POST",
        body: JSON.stringify({ questionId: question.id, sessionId: chat?.chat?.id, message: chatMessage, elapsedSeconds }),
        signal: AbortSignal.timeout(60_000),
      });
      props.onEvidenceChange(data.responses);
      setChatMessage("");
      props.onNotice("대화와 도움 수준이 평가 기록에 저장됐어요.");
    } catch (reason) { props.onError(reason instanceof Error ? reason.message : "대화를 이어가지 못했어요."); }
    finally { setBusy(false); }
  };

  return <div className="student-response-methods">
    <div className="student-method-tabs" role="tablist" aria-label="응답 방법">
      {tabs.map(item => <button key={item} type="button" role="tab" aria-selected={method === item} disabled={disabled || busy} onClick={() => setMethod(item)}>
        <span>{labels[item].icon}</span><strong>{labels[item].title}</strong><small>{labels[item].description}</small>
      </button>)}
    </div>

    {method === "text" && <div className="student-method-panel" role="tabpanel">
      {question.kind === "선택형" && (question.choices ?? []).length >= 2 ? <fieldset className="student-choice-list">
        <legend>보기에서 답 하나를 고르세요.</legend>
        {(question.choices ?? []).map((choice, index) => <label className={textValue === choice ? "selected" : ""} key={`${index}-${choice}`}><input type="radio" name={`answer-${question.id}`} value={choice} checked={textValue === choice} disabled={disabled || busy} onChange={() => props.onTextChange(choice)} /><span>{index + 1}</span><strong>{choice}</strong></label>)}
      </fieldset> : question.kind === "단답형" || question.kind === "선택형" ? <>
        {question.kind === "선택형" && <p className="evidence-readiness-warning">보기 구성이 확인되지 않아 직접 답을 적습니다. 선생님께 알려 주세요.</p>}
        <label className="student-short-answer" htmlFor={`answer-${question.id}`}><span>{question.kind === "단답형" ? "짧은 답" : "답"}</span><input id={`answer-${question.id}`} value={textValue} maxLength={500} disabled={disabled || busy} onChange={event => props.onTextChange(event.target.value)} placeholder="정답을 입력하세요." autoComplete="off" /></label>
        <small>{textValue.length} / 500자</small>
      </> : <>
        <label className="sr-only" htmlFor={`answer-${question.id}`}>{question.kind === "말하기" ? "말하기 문항의 글 답안" : "서술형 답안"}</label>
        <textarea id={`answer-${question.id}`} value={textValue} maxLength={10000} disabled={disabled || busy} onChange={event => props.onTextChange(event.target.value)} placeholder={question.kind === "말하기" ? "말하기 대신 글로 답하도록 허용된 경우 이곳에 입력하세요." : "나의 생각과 근거를 써주세요."} />
        <small>{textValue.length} / 10,000자</small>
      </>}
    </div>}

    {(method === "photo" || method === "speech" || method === "screen") && <div className="student-method-panel media-answer-panel" role="tabpanel">
      {!mediaReady && <p className="evidence-readiness-warning">선생님이 학교 승인 설정과 비공개 저장소를 준비하면 사용할 수 있어요. 지금은 글 답안을 이용해 주세요.</p>}
      {method === "photo" ? <>
        <label className="evidence-file-picker">답안 영역 사진 선택<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={disabled || busy || !mediaReady} onChange={event => setSelectedFile(event.target.files?.[0] ?? null)} /></label>
        {photo?.assets[0] && <>
          {/* Private assets require the student's authenticated cookie, so the browser must load the source directly. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="student-evidence-preview" src={`/api/student/${code}/evidence/assets/${photo.assets[0].id}`} alt="내가 올린 손글씨 답안" />
        </>}
      </> : method === "speech" ? <>
        <div className="recording-controls">
          {!recording ? <button type="button" className="outline-button" disabled={disabled || busy || !mediaReady} onClick={startRecording}>● 녹음 시작</button> : <button type="button" className="primary-button recording" onClick={stopRecording}>■ 녹음 끝내기</button>}
          <label className="evidence-file-picker compact">또는 녹음 파일 선택<input type="file" accept="audio/webm,audio/mp4,audio/mpeg,audio/wav" disabled={disabled || busy || !mediaReady} onChange={event => { setSelectedFile(event.target.files?.[0] ?? null); setRecordedSeconds(0); }} /></label>
        </div>
        {recordedUrl && <audio className="student-audio-preview" controls src={recordedUrl}><track kind="captions" src={captionTrack()} srcLang="ko" label="한국어 전사" default />녹음을 재생할 수 없습니다.</audio>}
        {speech?.assets[0] && !recordedUrl && <audio className="student-audio-preview" controls src={`/api/student/${code}/evidence/assets/${speech.assets[0].id}`}><track kind="captions" src={captionTrack(latestDerivation?.extractedText)} srcLang="ko" label="한국어 전사" default />녹음을 재생할 수 없습니다.</audio>}
      </> : <>
        <p className="screen-recording-guide">디지털 작품을 만드는 과정을 최대 30초 동안 녹화합니다. 화면 공유 창에서 평가에 필요한 창만 선택하세요.</p>
        <div className="recording-controls">
          {!recording ? <button type="button" className="outline-button" disabled={disabled || busy || !mediaReady} onClick={startScreenRecording}>▱ 화면 녹화 시작</button> : <button type="button" className="primary-button recording" onClick={stopRecording}>■ 녹화 끝내기</button>}
          <label className="evidence-file-picker compact">또는 녹화 파일 선택<input type="file" accept="video/webm,video/mp4" disabled={disabled || busy || !mediaReady} onChange={event => { setSelectedFile(event.target.files?.[0] ?? null); setRecordedSeconds(0); }} /></label>
        </div>
        {recordedUrl && <video className="student-screen-preview" controls src={recordedUrl}><track kind="captions" src={captionTrack("화면 녹화에는 음성이 없습니다.")} srcLang="ko" label="음성 없음" default />화면 녹화를 재생할 수 없습니다.</video>}
        {screen?.assets[0] && !recordedUrl && <video className="student-screen-preview" controls src={`/api/student/${code}/evidence/assets/${screen.assets[0].id}`}><track kind="captions" src={captionTrack("화면 녹화에는 음성이 없습니다.")} srcLang="ko" label="음성 없음" default />화면 녹화를 재생할 수 없습니다.</video>}
      </>}
      <label className="identifier-confirmation"><input type="checkbox" checked={identifiersRemoved} disabled={disabled || busy || !selectedFile} onChange={event => setIdentifiersRemoved(event.target.checked)} />
        <span>{method === "photo" ? "사진에 이름·번호가 보이지 않고 답안 영역만 담겼어요." : method === "speech" ? "녹음에서 이름·번호를 말하지 않았어요." : "화면에 이름·번호·알림 등 개인정보가 보이지 않아요."}</span>
      </label>
      {selectedFile && <p className="selected-evidence-file">선택됨 · {selectedFile.name} · {(selectedFile.size / 1024 / 1024).toFixed(1)}MB</p>}
      <button type="button" className="primary-button" disabled={disabled || busy || !mediaReady || !selectedFile || !identifiersRemoved} onClick={() => void uploadAndProcess(method)}>{busy ? "안전하게 처리하는 중…" : method === "photo" ? "사진 저장하고 글자 읽기" : method === "speech" ? "녹음 저장하고 전사하기" : "화면 녹화 저장하기"}</button>
      {method !== "screen" && latestDerivation && <div className={`evidence-derivation ${latestDerivation.status}`}>
        <strong>{latestDerivation.status === "complete" ? "변환된 답안" : latestDerivation.status === "pending" ? "변환 중" : "변환 실패"}</strong>
        {latestDerivation.extractedText && <p>{latestDerivation.extractedText}</p>}
        {latestDerivation.confidence != null && <small>변환 신뢰도 참고값 {Math.round(latestDerivation.confidence * 100)}% · 성취 수준에는 직접 반영하지 않아요.</small>}
        {latestDerivation.errorMessage && <small>{latestDerivation.errorMessage}</small>}
      </div>}
    </div>}

    {method === "chat" && <div className="student-method-panel chat-answer-panel" role="tabpanel">
      {!aiReady && <p className="evidence-readiness-warning">선생님이 학교 승인 설정과 AI 제공자를 준비하면 사용할 수 있어요. 지금은 글 답안을 이용해 주세요.</p>}
      <p className="chat-boundary">챗봇은 정답을 알려주지 않고, 내 생각을 더 자세히 말하도록 질문해요. 받은 도움도 함께 기록됩니다.</p>
      <div className="assessment-chat-log" aria-live="polite">
        {chat?.chat?.messages.length ? chat.chat.messages.map(message => <div key={message.id} className={message.role}><strong>{message.role === "student" ? "나" : "생각 도우미"}</strong><p>{message.content}</p>{message.role === "assistant" && message.helpType !== "none" ? <small>도움 기록 · {message.helpType === "prompt" ? "질문 촉진" : message.helpType === "step_hint" ? "단계 힌트" : "다른 맥락 예시"}</small> : null}</div>) : <p className="chat-empty">문항에 대한 내 생각을 먼저 말해 보세요.</p>}
      </div>
      <div className="chat-composer"><textarea value={chatMessage} maxLength={2000} disabled={disabled || busy || !aiReady} onChange={event => setChatMessage(event.target.value)} placeholder="내 생각과 이유를 적어보세요." /><button type="button" className="primary-button" disabled={disabled || busy || !aiReady || !chatMessage.trim()} onClick={() => void sendChat()}>{busy ? "생각을 살펴보는 중…" : "대화 이어가기"}</button></div>
      {chat?.chat && <small className="chat-metrics">대화 {Math.floor(chat.chat.elapsedSeconds / 60)}분 {chat.chat.elapsedSeconds % 60}초 · 도움 {chat.chat.helpCount}회</small>}
    </div>}
  </div>;
}