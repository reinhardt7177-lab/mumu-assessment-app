"use client";

import { useState } from "react";
import type {
  CurriculumDashboardRecord,
  CurriculumWorkflowRecord,
  WorkflowEvidenceRecord,
  WorkflowFeedbackRecord,
  WorkflowRubricRecord,
} from "../../../db/growth-repository";
import AssessmentRecordDialog from "./assessment-record-dialog";
import { FeedbackDialog, InterventionDialog, ReassessmentDialog } from "./growth-support-dialogs";
import SemesterJudgementDialog from "./semester-judgement-dialog";
import { requestJson } from "../../../lib/client-api";

const modalityLabel = { text: "글", photo: "손글씨 사진", speech: "말하기", observation: "관찰", chat: "챗봇 대화", multimodal: "복합 응답" };
const assistanceLabel = {
  independent: "독립 수행",
  teacher_prompt: "교사 질문",
  step_hint: "단계 힌트",
  example: "예시 제공",
  scaffolded: "구조화 지원",
};
const feedbackStatus = {
  planned: "추가 학습 계획",
  in_progress: "추가 학습 중",
  ready_for_reassessment: "독립 재평가 필요",
  completed: "성장 확인 완료",
};
type ImportedResponse = {
  responseEvidenceId: string;
  modality: "photo" | "speech" | "chat";
  assistanceLevel: string;
  derivedText?: string | null;
  confidence?: number | null;
  chat?: { elapsedSeconds: number; messages: Array<{ role: "student" | "assistant"; content: string; helpType: string }> } | null;
};
type ImportedAnswer = { questionId: string; standardCode: string; criterion: string; prompt: string; answer?: string; textAnswer?: string | null; responses?: ImportedResponse[] };
type ImportedAnswers = { format: "mumu.text.answers.v1" | "mumu.multimodal.answers.v2"; assessmentTitle: string; answers: ImportedAnswer[] };
function importedAnswers(value: string | null): ImportedAnswers | null {
  if (!value?.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(value) as Partial<ImportedAnswers>;
    return (parsed.format === "mumu.text.answers.v1" || parsed.format === "mumu.multimodal.answers.v2") && Array.isArray(parsed.answers) ? parsed as ImportedAnswers : null;
  } catch { return null; }
}
function visibleResponseText(response: ImportedResponse) {
  if (response.derivedText) return response.derivedText;
  if (response.chat) return response.chat.messages.filter(message => message.role === "student").map(message => message.content).join("\n");
  return "변환된 답안 없음";
}
type Tab = "evidence" | "feedback" | "semester";

export default function CurriculumOperations({
  dashboard,
  workflow,
  onRefresh,
}: {
  dashboard: CurriculumDashboardRecord;
  workflow: CurriculumWorkflowRecord;
  onRefresh: () => Promise<void>;
}) {
  const [tab, setTab] = useState<Tab>("evidence");
  const [recording, setRecording] = useState(false);
  const [reviewEvidence, setReviewEvidence] = useState<WorkflowEvidenceRecord | null>(null);
  const [feedbackSeed, setFeedbackSeed] = useState<WorkflowEvidenceRecord | null>(null);
  const [interventionCycle, setInterventionCycle] = useState<WorkflowFeedbackRecord | null>(null);
  const [reassessmentCycle, setReassessmentCycle] = useState<WorkflowFeedbackRecord | null>(null);
  const [semesterSeed, setSemesterSeed] = useState<{ studentId?: string; standardCode?: string } | null>(null);
  const firstFinalEvidence = workflow.evidence.find(item => item.judgements.some(judgement => judgement.state === "final"));
  const switchTab = (next: Tab) => setTab(next);

  return <section className="master-section curriculum-operations" aria-labelledby="curriculum-operations-title">
    <div className="master-section-heading operations-heading">
      <div><p className="kicker">실제 교사 운영</p><h2 id="curriculum-operations-title">증거에서 성장과 학기말 기록까지</h2></div>
      <button type="button" className="primary-button" onClick={() => setRecording(true)}>＋ 평가·수행 증거 기록</button>
    </div>
    <div className="curriculum-operation-tabs" role="tablist" aria-label="성장 평가 업무">
      <button type="button" role="tab" aria-selected={tab === "evidence"} onClick={() => switchTab("evidence")}>수행 증거·루브릭 <span>{workflow.evidence.length}</span></button>
      <button type="button" role="tab" aria-selected={tab === "feedback"} onClick={() => switchTab("feedback")}>피드백·추가 학습 <span>{workflow.feedback.length}</span></button>
      <button type="button" role="tab" aria-selected={tab === "semester"} onClick={() => switchTab("semester")}>학기말 종합 <span>{workflow.semesterJudgements.filter(item => item.state === "final").length}</span></button>
    </div>

    {tab === "evidence" ? <div className="operation-panel" role="tabpanel">
      <div className="operation-panel-intro"><div><strong>학생이 무엇을 했는지 먼저 남깁니다</strong><p>원본·도움 수준·평가 맥락을 보존하고, 잠긴 루브릭의 각 기준을 따로 판단합니다.</p></div><span>AI 제안 ≠ 교사 최종 판단</span></div>
      {workflow.evidence.length === 0 ? <OperationEmpty title="아직 수행 증거가 없습니다." description="첫 단원 평가를 기록하면 학생별 성장 이력이 시작됩니다." action="평가·증거 기록" onAction={() => setRecording(true)} /> : <div className="evidence-work-list">
        {workflow.evidence.map(item => <EvidenceCard key={item.id} item={item} rubric={workflow.rubrics.find(rubric => rubric.unitId === item.unitId && rubric.state === "locked")} onReview={() => setReviewEvidence(item)} onFeedback={() => setFeedbackSeed(item)} onRefresh={onRefresh} />)}
      </div>}
    </div> : null}

    {tab === "feedback" ? <div className="operation-panel" role="tabpanel">
      <div className="operation-panel-intro"><div><strong>수준을 올리는 수업을 기록합니다</strong><p>강점과 격차를 분리하고, 추가 학습 뒤 새로운 맥락의 독립 재평가로 성장을 확인합니다.</p></div><button type="button" className="outline-button" disabled={!firstFinalEvidence} onClick={() => setFeedbackSeed(firstFinalEvidence ?? null)}>＋ 피드백 설계</button></div>
      {workflow.feedback.length === 0 ? <OperationEmpty title="진행 중인 피드백이 없습니다." description="최종 루브릭 판단이 있는 수행 증거에서 피드백을 설계하세요." action="수행 증거 보기" onAction={() => switchTab("evidence")} /> : <div className="feedback-cycle-list">
        {workflow.feedback.map(cycle => <article key={cycle.id} className={`feedback-cycle-card status-${cycle.status}`}>
          <header><div><span>{cycle.standardCode} · {cycle.unitTitle}</span><h3>{cycle.studentName}</h3></div><em>{feedbackStatus[cycle.status]}</em></header>
          <div className="feedback-cycle-grid"><div><small>확인된 강점</small><p>{cycle.strength}</p></div><div><small>{cycle.gapType === "conceptual" ? "개념 격차" : cycle.gapType === "procedural" ? "절차 격차" : "표현·소통 격차"}</small><p>{cycle.gapDescription}</p></div><div><small>다음 학습</small><p>{cycle.nextLearning}</p></div></div>
          <div className="growth-trace"><span>근거 판단 {cycle.basisJudgementIds.length}개</span><span>추가 학습 {cycle.interventions.length}회</span><span>재평가 {cycle.reassessments.length}회</span></div><GrowthChange cycle={cycle} workflow={workflow} />
          {cycle.interventions.length ? <details><summary>추가 학습 기록 보기</summary>{cycle.interventions.map(item => <p key={item.id}><strong>{new Date(item.occurredAt).toLocaleDateString("ko-KR")}</strong> · {item.activity}<br /><small>{item.teacherNote}</small></p>)}</details> : null}
          <footer><button type="button" className="outline-button" disabled={cycle.status === "completed"} onClick={() => setInterventionCycle(cycle)}>＋ 추가 학습</button><button type="button" className="primary-button" disabled={cycle.status === "completed"} onClick={() => setReassessmentCycle(cycle)}>재평가 연결</button></footer>
        </article>)}
      </div>}
    </div> : null}

    {tab === "semester" ? <div className="operation-panel" role="tabpanel">
      <div className="operation-panel-intro"><div><strong>평균이 아닌 누적 증거로 종합합니다</strong><p>최근의 반복된 독립 수행을 중심으로 판단하고, 근거가 부족하면 ‘판단 보류’로 남깁니다.</p></div><button type="button" className="primary-button" onClick={() => setSemesterSeed({})}>＋ 학기말 판단</button></div>
      <SemesterMatrix dashboard={dashboard} workflow={workflow} onCreate={(studentId, standardCode) => setSemesterSeed({ studentId, standardCode })} />
    </div> : null}

    {recording ? <AssessmentRecordDialog dashboard={dashboard} workflow={workflow} onClose={() => setRecording(false)} onSaved={async () => { setRecording(false); await onRefresh(); }} /> : null}
    {reviewEvidence ? <AssessmentRecordDialog dashboard={dashboard} workflow={workflow} evidence={reviewEvidence} onClose={() => setReviewEvidence(null)} onSaved={async () => { setReviewEvidence(null); await onRefresh(); }} /> : null}
    {feedbackSeed ? <FeedbackDialog dashboard={dashboard} workflow={workflow} seed={feedbackSeed} onClose={() => setFeedbackSeed(null)} onSaved={async () => { setFeedbackSeed(null); await onRefresh(); setTab("feedback"); }} /> : null}
    {interventionCycle ? <InterventionDialog cycle={interventionCycle} onClose={() => setInterventionCycle(null)} onSaved={async () => { setInterventionCycle(null); await onRefresh(); }} /> : null}
    {reassessmentCycle ? <ReassessmentDialog cycle={reassessmentCycle} workflow={workflow} onClose={() => setReassessmentCycle(null)} onSaved={async () => { setReassessmentCycle(null); await onRefresh(); }} /> : null}
    {semesterSeed ? <SemesterJudgementDialog dashboard={dashboard} workflow={workflow} initialStudentId={semesterSeed.studentId} initialStandardCode={semesterSeed.standardCode} onClose={() => setSemesterSeed(null)} onSaved={async () => { setSemesterSeed(null); await onRefresh(); }} /> : null}
  </section>;
}

function EvidenceCard({ item, rubric, onReview, onFeedback, onRefresh }: { item: WorkflowEvidenceRecord; rubric?: WorkflowRubricRecord; onReview: () => void; onFeedback: () => void; onRefresh: () => Promise<void> }) {
  const final = item.judgements.filter(judgement => judgement.state === "final");
  const imported = importedAnswers(item.transformedText ?? item.originalText);
  const text = item.transformedText ?? item.originalText ?? "비공개 원본 참조로 보관된 수행 증거";
  const [criterionId, setCriterionId] = useState(rubric?.criteria[0]?.id ?? "");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiNotice, setAiNotice] = useState("");
  const runSuggestion = async () => {
    if (!criterionId) return;
    setAiBusy(true); setAiError(""); setAiNotice("");
    try {
      const data = await requestJson<{ suggestion: { suggestedLevel: string }; cached: boolean }>(`/api/teacher/curriculum/evidence/${item.id}/ai-recommendation`, {
        method: "POST", body: JSON.stringify({ rubricCriterionId: criterionId }), signal: AbortSignal.timeout(60_000),
      });
      setAiNotice(`${data.cached ? "저장된" : "새"} AI 추천 ${data.suggestion.suggestedLevel}을 불러왔습니다. 원문을 보고 교사가 확정해 주세요.`);
      await onRefresh();
    } catch (reason) { setAiError(reason instanceof Error ? reason.message : "AI 추천을 만들지 못했습니다."); }
    finally { setAiBusy(false); }
  };
  return <article className="evidence-work-card">
    <header><div><span>{item.unitTitle} · {item.eventTitle}</span><h3>{item.studentName}</h3></div><div className="evidence-badges">{item.attemptId ? <em className="imported">QR 자동 수합</em> : null}<em>{modalityLabel[item.modality]}</em><em className={item.assistanceLevel === "independent" ? "independent" : "supported"}>{assistanceLabel[item.assistanceLevel]}</em></div></header>
    {imported ? <div className="evidence-answer-list"><strong>{imported.assessmentTitle}</strong>{imported.answers.map((answer, index) => <article key={answer.questionId}><small>{answer.standardCode} · {answer.criterion}</small><p><b>{index + 1}. {answer.prompt}</b></p>{answer.answer || answer.textAnswer ? <blockquote>{answer.answer ?? answer.textAnswer}</blockquote> : null}{answer.responses?.map(response => <div className="imported-response" key={response.responseEvidenceId}><header><span>{modalityLabel[response.modality]}</span><small>{assistanceLabel[response.assistanceLevel as keyof typeof assistanceLabel] ?? response.assistanceLevel}</small></header><blockquote>{visibleResponseText(response)}</blockquote>{response.confidence != null ? <small>변환 신뢰도 참고값 {Math.round(response.confidence * 100)}%</small> : null}</div>)}</article>)}</div> : <blockquote>{text}</blockquote>}
    <div className="criterion-chip-row">{item.judgements.length ? item.judgements.map(judgement => <span key={judgement.id} className={`level-${judgement.level.replace("판단 ", "")}`}><small>{judgement.standardCode} · {judgement.criterionName}</small><strong>{judgement.level}</strong><em>{judgement.state === "final" ? "교사 확정" : "초안"}</em></span>) : <span className="judgement-empty"><strong>루브릭 판단 전</strong><small>잠긴 기준에 따라 근거를 남겨 주세요.</small></span>}</div>
    {item.aiSuggestions.length ? <div className="ai-suggestion-summary"><header><strong>AI 추천 · 교사 판단과 분리 보관</strong><small>참고 자료</small></header>{item.aiSuggestions.map(suggestion => <div key={suggestion.id}><span>{suggestion.criterionName}</span><b>{suggestion.suggestedLevel}</b><em>확신 {Math.round(suggestion.confidence * 100)}%</em><p>{suggestion.rationale}</p><blockquote>{suggestion.evidenceExcerpt}</blockquote><small>불확실성: {suggestion.uncertainty}</small><small>추가로 필요한 증거: {suggestion.missingEvidence}</small><small>평가 유의점: {suggestion.constructCaution}</small></div>)}</div> : null}
    {rubric?.criteria.length ? <div className="ai-recommendation-control"><div><strong>평가 요소별 AI 추천</strong><small>학교 승인 ON · 익명 증거 · 교사 최종 확정</small></div><select aria-label="AI 추천 평가 요소" value={criterionId} onChange={event => setCriterionId(event.target.value)}>{rubric.criteria.map(criterion => <option key={criterion.id} value={criterion.id}>{criterion.name}</option>)}</select><button type="button" className="outline-button" disabled={aiBusy || (item.transformationStatus === "automated" && !item.teacherVerified)} onClick={() => void runSuggestion()}>{aiBusy ? "근거를 분석하는 중…" : "AI 추천 받기"}</button>{item.transformationStatus === "automated" && !item.teacherVerified ? <p>OCR·전사 결과를 원본과 대조해 교사 확인본을 먼저 저장해 주세요.</p> : null}{aiError && <p className="ai-generation-error" role="alert">{aiError}</p>}{aiNotice && <p className="save-notice" role="status">{aiNotice}</p>}</div> : <div className="ai-consent-note"><strong>잠긴 루브릭 필요</strong><span>단원 성취기준의 루브릭을 검토·잠근 뒤 AI 추천을 요청할 수 있습니다.</span></div>}
    <footer><small>{new Date(item.collectedAt).toLocaleString("ko-KR")}</small><div><button type="button" className="outline-button" onClick={onReview}>{item.judgements.length ? "판단 보완·개정" : "루브릭 판단"}</button><button type="button" className="primary-button" disabled={final.length === 0} onClick={onFeedback}>피드백 설계</button></div></footer>
  </article>;
}
function GrowthChange({ cycle, workflow }: { cycle: WorkflowFeedbackRecord; workflow: CurriculumWorkflowRecord }) {
  const judgements = workflow.evidence.flatMap(evidence => evidence.judgements.map(judgement => ({ ...judgement, evidenceId: evidence.id, collectedAt: evidence.collectedAt })));
  const prior = judgements.filter(item => cycle.basisJudgementIds.includes(item.id)).sort((a, b) => a.collectedAt.localeCompare(b.collectedAt)).at(-1);
  const reassessedIds = new Set(cycle.reassessments.filter(item => item.independent).map(item => item.newEvidenceId));
  const current = judgements.filter(item => reassessedIds.has(item.evidenceId) && item.standardCode === cycle.standardCode && item.state === "final").sort((a, b) => a.collectedAt.localeCompare(b.collectedAt)).at(-1);
  if (!prior && !current) return null;
  const score = (level?: string) => level === "상" ? 3 : level === "중" ? 2 : level === "하" ? 1 : 0;
  const delta = score(current?.level) - score(prior?.level);
  return <div className="growth-change"><div><small>최초 근거</small><strong>{prior?.level ?? "판단 보류"}</strong></div><b>→</b><div><small>독립 재평가</small><strong>{current?.level ?? "증거 대기"}</strong></div><em className={delta > 0 ? "up" : delta < 0 ? "down" : "steady"}>{current ? delta > 0 ? `+${delta}단계 성장` : delta < 0 ? "추가 확인 필요" : "수준 유지" : "재평가 연결 필요"}</em></div>;
}
function SemesterMatrix({ dashboard, workflow, onCreate }: { dashboard: CurriculumDashboardRecord; workflow: CurriculumWorkflowRecord; onCreate: (studentId?: string, standardCode?: string) => void }) {
  const seen = new Set<string>();
  const standards = dashboard.units.flatMap(unit => unit.standards.map(standard => ({ ...standard, unitTitle: unit.title }))).filter(standard => !seen.has(standard.code) && seen.add(standard.code));
  if (!dashboard.students.length || !standards.length) return <OperationEmpty title="학생과 성취기준을 먼저 준비해 주세요." description="학기말 종합은 학생별·성취기준별로 누적된 최종 수행 증거를 사용합니다." action="평가 설계로 이동" onAction={onCreate} />;
  const latest = new Map(workflow.semesterJudgements.map(item => [`${item.studentId}:${item.standardCode}`, item]));
  return <div className="semester-live-matrix" aria-label="학생별 성취기준 학기말 종합 판단">
    <div className="semester-matrix-row header"><strong>학생</strong>{standards.map(standard => <span key={standard.id}>{standard.code}<small>{standard.unitTitle}</small></span>)}</div>
    {dashboard.students.map(student => <div className="semester-matrix-row" key={student.id}><strong><span>{student.displayName}</span><a href={`/curriculum/${dashboard.term.id}/report/${student.id}`}>종합 리포트</a></strong>{standards.map(standard => { const judgement = latest.get(`${student.id}:${standard.code}`); return <button type="button" key={standard.id} onClick={() => onCreate(student.id, standard.code)} aria-label={`${student.displayName} ${standard.code} 학기말 판단 ${judgement?.level ?? "판단 전"}`} className={judgement ? `semester-cell level-${judgement.level.replace("판단 ", "")}` : "semester-cell empty"}><b>{judgement?.level ?? "판단 전"}</b><small>{judgement ? `${judgement.evidence.length}개 근거 · ${judgement.state === "final" ? "확정" : "초안"}` : "누적 증거 필요"}</small></button>; })}</div>)}
  </div>;
}

function OperationEmpty({ title, description, action, onAction }: { title: string; description: string; action: string; onAction: () => void }) {
  return <div className="curriculum-empty-panel operation-empty"><h3>{title}</h3><p>{description}</p><button type="button" className="outline-button" onClick={onAction}>{action}</button></div>;
}
