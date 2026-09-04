"use client";

import { useEffect, useState } from "react";
import { requestJson } from "../lib/client-api";
import type { EvidencePolicy } from "../lib/evidence-domain";

type Provider = { id: string; displayName: string; capabilities: string[] };
type Payload = { policy: EvidencePolicy; providers: Provider[] };

const capabilityNames: Record<string, string> = {
  ocr: "손글씨 OCR",
  transcription: "음성 전사",
  chat: "평가 챗봇",
  criterion_recommendation: "루브릭 추천",
};

export default function EvidencePolicyPanel() {
  const [policy, setPolicy] = useState<EvidencePolicy | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [providerId, setProviderId] = useState("disabled");
  const [acknowledgement, setAcknowledgement] = useState("");
  const [retentionDays, setRetentionDays] = useState(90);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    requestJson<Payload>("/api/teacher/evidence-policy", { signal: controller.signal }).then(data => {
      setPolicy(data.policy); setProviders(data.providers); setEnabled(data.policy.enabled);
      setProviderId(data.policy.providerId); setAcknowledgement(data.policy.acknowledgement ?? "");
      setRetentionDays(data.policy.retentionDays);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "안전 설정을 불러오지 못했습니다."); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, []);

  const save = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      const data = await requestJson<{ policy: EvidencePolicy }>("/api/teacher/evidence-policy", {
        method: "PUT",
        body: JSON.stringify({ enabled, providerId: enabled ? providerId : providerId || "disabled", acknowledgement, retentionDays }),
      });
      setPolicy(data.policy);
      setNotice(data.policy.enabled ? "학교 승인 설정을 저장했습니다. 선택한 제공자로만 익명 학생 증거를 전송합니다." : "학생 증거의 외부 AI 전송을 껐습니다.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "안전 설정을 저장하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const selected = providers.find(item => item.id === providerId);
  return <section className="teacher-panel evidence-policy-panel">
    <header><div><p className="kicker">STUDENT EVIDENCE AI</p><h2>학생 증거 AI 안전 설정</h2></div><span className={`policy-status ${policy?.enabled ? "enabled" : "disabled"}`}>{policy?.enabled ? "승인 ON" : "기본 OFF"}</span></header>
    <p className="policy-intro">학교 승인 설정이 켜진 경우에만 이름·번호를 제외한 손글씨 답안, 음성, 텍스트, 챗봇 대화와 평가 기준을 선택한 외부 AI 제공자로 보냅니다.</p>
    {busy && !policy ? <p role="status">설정을 불러오는 중…</p> : <div className="policy-form">
      <label className="policy-switch" htmlFor="evidence-ai-enabled"><input id="evidence-ai-enabled" aria-label="학생 증거 외부 AI 분석 허용" type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} /><span><strong>학생 증거 외부 AI 분석 허용</strong><small>끄면 업로드 원본이 외부 AI로 전송되지 않습니다.</small></span></label>
      <div className="field-row">
        <label>선택 제공자<select value={providerId} disabled={!enabled || busy} onChange={event => setProviderId(event.target.value)}><option value="disabled">선택 안 함</option>{providers.map(provider => <option value={provider.id} key={provider.id}>{provider.displayName}</option>)}</select></label>
        <label>비공개 원본 보관 기간<select value={retentionDays} disabled={busy} onChange={event => setRetentionDays(Number(event.target.value))}><option value={30}>30일</option><option value={60}>60일</option><option value={90}>90일</option><option value={180}>180일</option><option value={365}>365일</option></select></label>
      </div>
      {selected && <p className="provider-capabilities">사용 기능 · {selected.capabilities.map(item => capabilityNames[item] ?? item).join(" · ")}</p>}
      <label>학교 확인 기록<textarea value={acknowledgement} disabled={!enabled || busy} maxLength={1000} onChange={event => setAcknowledgement(event.target.value)} placeholder="예: 학교 내부 개인정보 검토와 학생·보호자 안내 절차를 확인했습니다." /></label>
      <ul className="policy-guardrails"><li>학생은 사진·녹음에 이름과 번호가 없음을 확인해야 업로드할 수 있습니다.</li><li>AI 결과는 추천·변환 초안이며 성취 수준은 교사가 원문을 보고 확정합니다.</li><li>운영 검증에는 실제 학생 자료가 아닌 합성 자료만 사용합니다.</li></ul>
      <button type="button" className="primary-button" disabled={busy || (enabled && (providerId === "disabled" || acknowledgement.trim().length < 10))} onClick={() => void save()}>{busy ? "저장하는 중…" : "안전 설정 저장"}</button>
    </div>}
    {policy && <div className="policy-connection"><span>{policy.storageConfigured ? "비공개 저장소 연결" : "비공개 저장소 연결 필요"}</span><span>{policy.aiConfigured ? "AI 제공자 선택됨" : "AI 제공자 선택 필요"}</span>{policy.acknowledgedAt && <small>최근 승인 기록 · {new Date(policy.acknowledgedAt).toLocaleString("ko-KR")}</small>}</div>}
    {error && <p className="ai-generation-error" role="alert">{error}</p>}{notice && <p className="save-notice" role="status">{notice}</p>}
  </section>;
}