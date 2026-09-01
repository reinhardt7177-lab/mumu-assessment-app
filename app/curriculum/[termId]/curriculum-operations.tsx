"use client";

import { useState } from "react";
import type {
  CurriculumDashboardRecord,
  CurriculumWorkflowRecord,
  WorkflowEvidenceRecord,
  WorkflowFeedbackRecord,
} from "../../../db/growth-repository";
import AssessmentRecordDialog from "./assessment-record-dialog";
import { FeedbackDialog, InterventionDialog, ReassessmentDialog } from "./growth-support-dialogs";
import SemesterJudgementDialog from "./semester-judgement-dialog";

const modalityLabel = { text: "글", photo: "손글씨 사진", speech: "말하기", observation: "관찰", chat: "챗봇 대화" };
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
        {workflow.evidence.map(item => <EvidenceCard key={item.id} item={item} onReview={() => setReviewEvidence(item)} onFeedback={() => setFeedbackSeed(item)} />)}
      </div>}
    </div> : null}

    {tab === "feedback" ? <div className="operation-panel" role="tabpanel">
      <div className="operation-panel-intro"><div><strong>수준을 올리는 수업을 기록합니다</strong><p>강점과 격차를 분리하고, 추가 학습 뒤 새로운 맥락의 독립 재평가로 성장을 확인합니다.</p></div><button type="button" className="outline-button" disabled={!firstFinalEvidence} onClick={() => setFeedbackSeed(firstFinalEvidence ?? null)}>＋ 피드백 설계</button></div>
      {workflow.feedback.length === 0 ? <OperationEmpty title="진행 중인 피드백이 없습니다." description="최종 루브릭 판단이 있는 수행 증거에서 피드백을 설계하세요." action="수행 증거 보기" onAction={() => switchTab("evidence")} /> : <div className="feedback-cycle-list">
        {workflow.feedback.map(cycle => <article key={cycle.id} className={`feedback-cycle-card status-${cycle.status}`}>
          <header><div><span>{cycle.standardCode} · {cycle.unitTitle}</span><h3>{cycle.studentName}</h3></div><em>{feedbackStatus[cycle.status]}</em></header>
          <div className="feedback-cycle-grid"><div><small>확인된 강점</small><p>{cycle.strength}</p></div><div><small>{cycle.gapType === "conceptual" ? "개념 격차" : cycle.gapType === "procedural" ? "절차 격차" : "표현·소통 격차"}</small><p>{cycle.gapDescription}</p></div><div><small>다음 학습</small><p>{cycle.nextLearning}</p></div></div>
          <div className="growth-trace"><span>근거 판단 {cycle.basisJudgementIds.length}개</span><span>추가 학습 {cycle.interventions.length}회</span><span>재평가 {cycle.reassessments.length}회</span></div>
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

function EvidenceCard({ item, onReview, onFeedback }: { item: WorkflowEvidenceRecord; onReview: () => void; onFeedback: () => void }) {
  const final = item.judgements.filter(judgement => judgement.state === "final");
  const text = item.originalText ?? item.transformedText ?? "비공개 원본 참조로 보관된 수행 증거";
  return <article className="evidence-work-card">
    <header><div><span>{item.unitTitle} · {item.eventTitle}</span><h3>{item.studentName}</h3></div><div className="evidence-badges"><em>{modalityLabel[item.modality]}</em><em className={item.assistanceLevel === "independent" ? "independent" : "supported"}>{assistanceLabel[item.assistanceLevel]}</em></div></header>
    <blockquote>{text}</blockquote>
    <div className="criterion-chip-row">{item.judgements.length ? item.judgements.map(judgement => <span key={judgement.id} className={`level-${judgement.level.replace("판단 ", "")}`}><small>{judgement.standardCode} · {judgement.criterionName}</small><strong>{judgement.level}</strong><em>{judgement.state === "final" ? "교사 확정" : "초안"}</em></span>) : <span className="judgement-empty"><strong>루브릭 판단 전</strong><small>잠긴 기준에 따라 근거를 남겨 주세요.</small></span>}</div>
    <footer><small>{new Date(item.collectedAt).toLocaleString("ko-KR")}</small><div><button type="button" className="outline-button" onClick={onReview}>{item.judgements.length ? "판단 보완·개정" : "루브릭 판단"}</button><button type="button" className="primary-button" disabled={final.length === 0} onClick={onFeedback}>피드백 설계</button></div></footer>
  </article>;
}

function SemesterMatrix({ dashboard, workflow, onCreate }: { dashboard: CurriculumDashboardRecord; workflow: CurriculumWorkflowRecord; onCreate: (studentId?: string, standardCode?: string) => void }) {
  const seen = new Set<string>();
  const standards = dashboard.units.flatMap(unit => unit.standards.map(standard => ({ ...standard, unitTitle: unit.title }))).filter(standard => !seen.has(standard.code) && seen.add(standard.code));
  if (!dashboard.students.length || !standards.length) return <OperationEmpty title="학생과 성취기준을 먼저 준비해 주세요." description="학기말 종합은 학생별·성취기준별로 누적된 최종 수행 증거를 사용합니다." action="평가 설계로 이동" onAction={onCreate} />;
  const latest = new Map(workflow.semesterJudgements.map(item => [`${item.studentId}:${item.standardCode}`, item]));
  return <div className="semester-live-matrix" aria-label="학생별 성취기준 학기말 종합 판단">
    <div className="semester-matrix-row header"><strong>학생</strong>{standards.map(standard => <span key={standard.id}>{standard.code}<small>{standard.unitTitle}</small></span>)}</div>
    {dashboard.students.map(student => <div className="semester-matrix-row" key={student.id}><strong>{student.displayName}</strong>{standards.map(standard => { const judgement = latest.get(`${student.id}:${standard.code}`); return <button type="button" key={standard.id} onClick={() => onCreate(student.id, standard.code)} aria-label={`${student.displayName} ${standard.code} 학기말 판단 ${judgement?.level ?? "판단 전"}`} className={judgement ? `semester-cell level-${judgement.level.replace("판단 ", "")}` : "semester-cell empty"}><b>{judgement?.level ?? "판단 전"}</b><small>{judgement ? `${judgement.evidence.length}개 근거 · ${judgement.state === "final" ? "확정" : "초안"}` : "누적 증거 필요"}</small></button>; })}</div>)}
  </div>;
}

function OperationEmpty({ title, description, action, onAction }: { title: string; description: string; action: string; onAction: () => void }) {
  return <div className="curriculum-empty-panel operation-empty"><h3>{title}</h3><p>{description}</p><button type="button" className="outline-button" onClick={onAction}>{action}</button></div>;
}
