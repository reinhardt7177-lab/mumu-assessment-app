"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { SchoolCurriculumPlanRecord } from "../../db/growth-repository";
import { requestFormData, requestJson } from "../../lib/client-api";
import type { DesignSessionRecord } from "../../lib/design-studio-domain";

type SessionSummary = {
  id: string; title: string; grade: number; subject: string; learningGoal: string;
  status: string; currentStep: number; approvedAssessmentId: string | null;
  selectedStandardCount: number; hasBlueprint: boolean; validityBlocked: boolean | null; updatedAt: string;
};

type SourceMode = "plan" | "upload" | "direct";
type FormState = {
  title: string;
  grade: number;
  subject: string;
  learningGoal: string;
  sourceText: string;
  sourceKind: "direct_text" | "upload";
  fileName: string | null;
  mimeType: string | null;
  sha256: string | null;
};
type PlanChoice = {
  id: string;
  plan: SchoolCurriculumPlanRecord;
  template: SchoolCurriculumPlanRecord["gradeTemplates"][number];
  unit: SchoolCurriculumPlanRecord["gradeTemplates"][number]["units"][number];
};
type UploadPreview = {
  source: { kind: "upload"; fileName: string; mimeType: string; sha256: string; text: string };
  analysis: { title: string; grade: number; subject: string; learningGoal: string; warnings: string[] };
  extraction: { characterCount: number };
};

const subjects = ["국어", "사회", "수학", "과학", "도덕", "영어"];
const stepNames = ["자료", "성취기준", "성공 기준", "루브릭", "문항", "타당도", "승인"];
const methodLabel: Record<string, string> = {
  text: "글쓰기·선다형", photo: "손글씨 사진", speech: "말하기", chat: "챗봇 대화", screen: "화면 녹화", observation: "관찰 기록",
};
const emptyForm: FormState = {
  title: "", grade: 6, subject: "사회", learningGoal: "", sourceText: "",
  sourceKind: "direct_text", fileName: null, mimeType: null, sha256: null,
};

function flattenPlanChoices(plans: SchoolCurriculumPlanRecord[]) {
  return plans.flatMap(plan => plan.gradeTemplates.flatMap(template => template.units.map(unit => ({
    id: [plan.id, template.key, unit.key].join(":"),
    plan, template, unit,
  }))));
}

function formFromPlan(choice: PlanChoice): FormState {
  const { plan, template, unit } = choice;
  const learningGoal = unit.assessmentFocus.trim() ||
    unit.standardCodes.length
      ? unit.standardCodes.join(", ") + " 성취기준에 따른 핵심 개념을 이해하고 근거를 들어 설명한다."
      : unit.title + "의 핵심 내용을 이해하고 수업 맥락에 적용한다.";
  const sourceText = [
    "출처: " + plan.schoolName + " " + plan.schoolYear + "학년도 학습 및 평가 계획",
    "학년·학기·교과: " + template.grade + "학년 " + template.semester + "학기 " + template.subject,
    "단원: " + unit.title,
    unit.standardCodes.length ? "성취기준: " + unit.standardCodes.join(", ") : "",
    unit.plannedPeriod ? "수업 시기: " + unit.plannedPeriod : "",
    unit.teachingHours !== null ? "수업 시수: " + unit.teachingHours + "차시" : "",
    unit.assessmentTiming ? "평가 시기: " + unit.assessmentTiming : "",
    unit.assessmentMethods.length ? "평가 방법: " + unit.assessmentMethods.map(item => methodLabel[item] || item).join(", ") : "",
    unit.assessmentFocus ? "평가 중점: " + unit.assessmentFocus : "",
    template.notes ? "학년 계획 참고: " + template.notes : "",
    plan.schoolBasics.assessmentPolicy ? "학교 평가 방침: " + plan.schoolBasics.assessmentPolicy : "",
  ].filter(Boolean).join("\n");

  return {
    title: unit.title + " 평가",
    grade: template.grade,
    subject: template.subject,
    learningGoal,
    sourceText,
    sourceKind: "direct_text",
    fileName: plan.schoolName + " " + plan.schoolYear + "학년도 평가계획",
    mimeType: "application/x-mumu-school-plan",
    sha256: null,
  };
}

export default function DesignStudioHome({
  initialSessions,
  initialPlans,
}: {
  initialSessions: SessionSummary[];
  initialPlans: SchoolCurriculumPlanRecord[];
}) {
  const router = useRouter();
  const planChoices = useMemo(() => flattenPlanChoices(initialPlans), [initialPlans]);
  const firstPlan = planChoices[0] ?? null;
  const [creating, setCreating] = useState(initialSessions.length === 0);
  const [sourceMode, setSourceMode] = useState<SourceMode>(firstPlan ? "plan" : "upload");
  const [selectedPlanId, setSelectedPlanId] = useState(firstPlan?.id ?? "");
  const [form, setForm] = useState<FormState>(firstPlan ? formFromPlan(firstPlan) : emptyForm);
  const [uploadSummary, setUploadSummary] = useState<{ name: string; characters: number; warnings: string[] } | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const selectedPlan = planChoices.find(item => item.id === selectedPlanId) ?? null;
  const ready = form.title.trim().length >= 2 && form.learningGoal.trim().length >= 5 && form.sourceText.trim().length >= 5;

  const chooseMode = (mode: SourceMode) => {
    setSourceMode(mode);
    setError("");
    setUploadSummary(null);
    if (mode === "plan" && firstPlan) {
      setSelectedPlanId(firstPlan.id);
      setForm(formFromPlan(firstPlan));
    } else {
      setForm({ ...emptyForm, sourceKind: mode === "upload" ? "upload" : "direct_text" });
    }
  };

  const choosePlan = (id: string) => {
    setSelectedPlanId(id);
    const choice = planChoices.find(item => item.id === id);
    if (choice) setForm(formFromPlan(choice));
  };

  const analyzeUpload = async (file: File) => {
    setBusy("upload");
    setError("");
    try {
      const body = new FormData();
      body.set("file", file);
      const result = await requestFormData<UploadPreview>("/api/teacher/design-sources/preview", body);
      setForm({
        title: result.analysis.title,
        grade: result.analysis.grade,
        subject: result.analysis.subject,
        learningGoal: result.analysis.learningGoal,
        sourceText: result.source.text,
        sourceKind: "upload",
        fileName: result.source.fileName,
        mimeType: result.source.mimeType,
        sha256: result.source.sha256,
      });
      setUploadSummary({ name: result.source.fileName, characters: result.extraction.characterCount, warnings: result.analysis.warnings });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "지도안 파일을 분석하지 못했습니다.");
    } finally {
      setBusy("");
    }
  };

  const create = async () => {
    setBusy("create");
    setError("");
    try {
      const result = await requestJson<{ session: DesignSessionRecord }>("/api/teacher/design-sessions", {
        method: "POST",
        body: JSON.stringify({
          title: form.title,
          grade: form.grade,
          subject: form.subject,
          learningGoal: form.learningGoal,
          source: {
            kind: form.sourceKind,
            fileName: form.fileName,
            mimeType: form.mimeType,
            sha256: form.sha256,
            text: form.sourceText,
          },
        }),
      });
      try {
        await requestJson("/api/teacher/design-sessions/" + result.session.id + "/standards/suggest", {
          method: "POST",
          body: "{}",
        });
      } catch {
        // The editor keeps a visible retry action when automatic alignment is unavailable.
      }
      router.push("/design/" + result.session.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "평가 설계를 시작하지 못했습니다.");
    } finally {
      setBusy("");
    }
  };

  return <div className="design-home teacher-surface">
    <section className="design-hero">
      <div><p className="kicker">ASSESSMENT DESIGN STUDIO</p><h1>가지고 계신 수업자료가<br />근거 있는 평가로.</h1><p>학교 평가계획이나 지도안을 불러오면 학년·교과·단원·성취기준을 분석하고, 교사는 초안을 확인하고 고칩니다.</p></div>
      <div className="design-hero-side">
        <div className="design-hero-flow" aria-label="평가 설계 흐름">
          <div className="design-flow-heading"><span>평가 설계 흐름</span><small>자료를 불러오면 문항 초안까지 자동 연결</small></div>
          <ol>
            <li><b>1</b><span><small>불러오기</small><strong>자료 선택</strong></span></li>
            <li><b>2</b><span><small>교육과정 정렬</small><strong>자동 분석</strong></span></li>
            <li><b>3</b><span><small>교사 수정</small><strong>루브릭·문항</strong></span></li>
            <li><b>4</b><span><small>배포 전 확인</small><strong>교사 승인</strong></span></li>
          </ol>
        </div>
        <button className="design-light-button" type="button" onClick={() => setCreating(current => !current)}>{creating ? "설계 영역 닫기" : "＋ 새 평가 설계 시작"}</button>
      </div>
    </section>

    {creating && <section className="design-create-card source-first-card">
      <header><div><p className="kicker">STEP 1 · SOURCE</p><h2>어디에서 평가를 시작할까요?</h2><p>이미 있는 자료를 선택하면 다시 입력하지 않아도 됩니다.</p></div><span>교사는 확인·수정만</span></header>

      <div className="design-source-modes" role="tablist" aria-label="평가 자료 선택">
        <button type="button" role="tab" aria-selected={sourceMode === "plan"} className={sourceMode === "plan" ? "active" : ""} onClick={() => chooseMode("plan")}>
          <b>01</b><span><strong>교육과정·평가계획</strong><small>학교에서 확정한 계획과 단원 불러오기</small></span><em>{planChoices.length ? planChoices.length + "개 단원" : "계획 필요"}</em>
        </button>
        <button type="button" role="tab" aria-selected={sourceMode === "upload"} className={sourceMode === "upload" ? "active" : ""} onClick={() => chooseMode("upload")}>
          <b>02</b><span><strong>지도안 파일 업로드</strong><small>PDF·XLSX·CSV·TXT에서 자동 추출</small></span><em>추천</em>
        </button>
        <button type="button" role="tab" aria-selected={sourceMode === "direct"} className={sourceMode === "direct" ? "active" : ""} onClick={() => chooseMode("direct")}>
          <b>03</b><span><strong>빠른 직접 입력</strong><small>자료가 없을 때 핵심 내용만 작성</small></span><em>선택</em>
        </button>
      </div>

      {sourceMode === "plan" && <div className="design-source-panel">
        {planChoices.length ? <>
          <div className="plan-source-picker">
            <label><span>확정된 학교 계획 · 단원</span><select value={selectedPlanId} onChange={event => choosePlan(event.target.value)}>{planChoices.map(choice => <option key={choice.id} value={choice.id}>{choice.plan.schoolYear} · {choice.plan.schoolName} · {choice.template.grade}학년 {choice.template.subject} · {choice.unit.title}</option>)}</select></label>
            {selectedPlan && <div className="plan-source-summary"><span>{selectedPlan.template.grade}학년 {selectedPlan.template.semester}학기 · {selectedPlan.template.subject}</span><strong>{selectedPlan.unit.title}</strong><p>{selectedPlan.unit.assessmentFocus || "등록된 성취기준과 단원 정보를 바탕으로 평가 설계를 시작합니다."}</p><div><small>성취기준 {selectedPlan.unit.standardCodes.length}개</small><small>{selectedPlan.unit.assessmentMethods.map(item => methodLabel[item] || item).join(" · ")}</small><small>{selectedPlan.unit.assessmentTiming || "평가 시기 확인 필요"}</small></div></div>}
          </div>
        </> : <div className="design-source-empty"><span>⌁</span><div><strong>확정된 학교·학년 평가계획이 없습니다.</strong><p>교육과정 문서를 한 번 등록해 두면 이후에는 단원만 골라 평가를 만들 수 있습니다.</p></div><Link href="/curriculum/setup">교육과정·평가계획 등록 →</Link></div>}
      </div>}

      {sourceMode === "upload" && <div className="design-source-panel upload-source-panel">
        <label className={"design-source-drop " + (busy === "upload" ? "busy" : "")}>
          <input type="file" accept=".pdf,.txt,.xlsx,.csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain" disabled={Boolean(busy)} onChange={event => { const file = event.target.files?.[0]; if (file) void analyzeUpload(file); }} />
          <span>{busy === "upload" ? "···" : "↑"}</span>
          <strong>{busy === "upload" ? "지도안을 읽고 있습니다" : "지도안·평가계획 파일을 놓거나 선택하세요"}</strong>
          <small>PDF·XLSX·CSV·TXT · 최대 8MB · 원본 파일은 저장하지 않습니다</small>
        </label>
        {uploadSummary && <div className="upload-analysis-result"><span>분석 완료</span><div><strong>{uploadSummary.name}</strong><small>{uploadSummary.characters.toLocaleString()}자 추출 · 아래 자동 입력값을 확인해 주세요.</small></div>{uploadSummary.warnings.length ? <p>{uploadSummary.warnings.join(" · ")}</p> : <b>학년·교과·학습 목표 후보를 자동으로 채웠습니다.</b>}</div>}
      </div>}

      {sourceMode === "direct" && <div className="design-source-panel direct-source-panel"><p>자료가 없거나 간단한 확인 평가를 만들 때만 사용하세요. 교육과정·지도안 불러오기가 기본 경로입니다.</p></div>}

      {(sourceMode === "direct" || (sourceMode === "upload" && uploadSummary)) && <div className="design-create-grid source-review-grid">
        <label className="wide"><span>평가 이름 · 자동 입력</span><input value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} placeholder="예: 민주주의의 발전 단원 서술형 평가" /></label>
        <label><span>학년</span><select value={form.grade} onChange={event => setForm({ ...form, grade: Number(event.target.value) })}>{[1,2,3,4,5,6].map(grade => <option key={grade} value={grade}>{grade}학년</option>)}</select></label>
        <label><span>교과</span><select value={form.subject} onChange={event => setForm({ ...form, subject: event.target.value })}>{subjects.map(subject => <option key={subject}>{subject}</option>)}</select></label>
        <label className="full"><span>학습 목표 · 자동 분석 후 교사 확인</span><input value={form.learningGoal} onChange={event => setForm({ ...form, learningGoal: event.target.value })} placeholder="학생이 수업 후 무엇을 할 수 있어야 하나요?" /></label>
        {sourceMode === "direct" && <label className="full"><span>핵심 수업 내용</span><textarea value={form.sourceText} onChange={event => setForm({ ...form, sourceText: event.target.value })} placeholder="핵심 수업 내용이나 평가 계획을 간단히 적어 주세요." /></label>}
      </div>}

      {sourceMode === "plan" && selectedPlan && <div className="source-auto-note"><span>✓</span><p><strong>자동으로 준비되었습니다.</strong> 평가 이름·학년·교과·학습 목표·성취기준 후보를 단원 계획에서 가져옵니다.</p></div>}
      {error && <p className="design-error" role="alert">{error}</p>}
      <footer><small>다음 화면에서 공식 성취기준 후보와 분석 결과를 확인하고 언제든 수정할 수 있습니다.</small><button className="primary-button source-start-button" type="button" disabled={Boolean(busy) || !ready} onClick={() => void create()}>{busy === "create" ? "자료 분석·설계 공간 준비 중…" : "자료 분석하고 평가 설계 시작 →"}</button></footer>
    </section>}

    <section className="design-library teacher-panel">
      <header><div><p className="kicker">MY DESIGN WORK</p><h2>평가 설계 작업</h2></div><strong>{initialSessions.length}개</strong></header>
      {initialSessions.length === 0 ? <div className="teacher-empty compact"><strong>아직 저장된 설계가 없습니다.</strong><p>교육과정·평가계획을 선택하거나 지도안을 올려 첫 평가를 만들어 보세요.</p></div> : <div className="design-session-grid">{initialSessions.map(session => <Link href={"/design/" + session.id} className="design-session-card" key={session.id}>
        <div className="design-session-top"><span className={"design-status " + session.status}>{session.status === "approved" ? "평가 생성 완료" : session.validityBlocked ? "보완 필요" : "설계 중"}</span><small>{new Date(session.updatedAt).toLocaleDateString("ko-KR")}</small></div>
        <p>{session.grade}학년 {session.subject}</p><h3>{session.title}</h3><p className="design-goal">{session.learningGoal}</p>
        <div className="design-card-progress"><i><b style={{ width: Math.round(session.currentStep / 7 * 100) + "%" }} /></i><span>{stepNames[Math.min(6, Math.max(0, session.currentStep - 1))]}</span></div>
        <footer><span>성취기준 {session.selectedStandardCount}개</span><strong>{session.status === "approved" ? "평가 열기" : "계속 설계하기"} →</strong></footer>
      </Link>)}</div>}
    </section>
  </div>;
}
