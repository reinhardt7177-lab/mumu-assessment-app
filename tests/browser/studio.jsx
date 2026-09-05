// Isolated UI harness: synthetic fixtures and mocked requests; never imports server auth or database.
import React from "react";
import { createRoot } from "react-dom/client";
import DesignStudioEditor from "../../app/design/[sessionId]/design-studio-editor";
import "../../app/globals.css";
import "../../app/teacher-workspace.css";
import "../../app/design-studio.css";

const criterion = { id: "criterion-1", standardCode: "6사01-01", name: "개념과 근거", description: "민주주의를 사례와 연결한다.", high: "핵심 개념을 정확히 설명하고 두 사례를 연결한다.", middle: "핵심 개념을 설명하고 한 사례를 제시한다.", low: "개념을 부분적으로 설명하여 추가 확인이 필요하다." };
let session = {
  id: "00000000-0000-4000-8000-000000000001", ownerId: "synthetic", title: "민주주의와 시민의 역할", grade: 6, subject: "사회", learningGoal: "민주주의의 의미와 시민의 역할을 사례로 설명한다.",
  status: "draft", currentStep: 5, approvedAssessmentId: null, createdAt: "2026-09-05", updatedAt: "2026-09-05",
  source: { id: "source", kind: "direct_text", fileName: null, mimeType: null, sha256: null, text: "합성 수업자료: 시민 참여 사례를 비교하고 민주주의의 의미를 설명한다." },
  standards: [{ code: "6사01-01", domain: "정치", content: "민주주의의 의미와 중요성을 이해하고, 민주주의 발전을 위한 시민의 역할을 탐색한다.", rationale: "합성 수업 목표와 연결", confidence: .9, state: "selected" }],
  competency: { bigIdea: "시민 참여", observableIndicators: ["사례 설명"], prerequisites: ["민주주의 이해"], misconceptions: ["다수결만이 전부라는 생각"], successCriteria: [{ id: criterion.id, name: criterion.name, standardCode: criterion.standardCode, evidence: criterion.description }] },
  blueprint: { rubric: [criterion], questions: [{ id: "question-1", standardCode: criterion.standardCode, criterion: criterion.name, prompt: "학교에서 시민의 참여와 비슷한 사례를 찾아 민주주의와 연결해 설명하세요.", kind: "서술형", points: 10, evidenceExpected: criterion.description, responseMethods: ["text"] }], methods: ["text"], grading: { upperThreshold: 80, middleThreshold: 50 } },
  validity: null,
};
window.__mumuChecks = { requests: [] };
window.fetch = async (url, init = {}) => {
  if (!String(url).startsWith("/api/teacher/design-sessions/")) throw new Error("Harness blocks non-synthetic requests");
  const body = JSON.parse(init.body ?? "{}");
  window.__mumuChecks.requests.push({ path: String(url), method: init.method, body });
  if (init.method === "PATCH") {
    session = { ...session, ...Object.fromEntries(Object.entries(body).filter(([key]) => !["questions", "rubric", "methods"].includes(key))), blueprint: { ...session.blueprint, ...Object.fromEntries(Object.entries(body).filter(([key]) => ["questions", "rubric", "methods"].includes(key))) } };
  }
  // No AI invoked. This harness validates UI request order/payload, not generated content or persistence.
  return Response.json({ session, generation: { fallback: false } });
};
createRoot(document.getElementById("root")).render(<><div className="demo-warning">합성 UI 검증 전용 · API 응답 모형 · 실제 저장/AI 호출 없음</div><main style={{ padding: "24px", maxWidth: 1500, margin: "auto" }}><DesignStudioEditor initialSession={structuredClone(session)} unitTargets={[{ unitId: "00000000-0000-4000-8000-000000000002", termId: "synthetic-term", label: "2026 · 2학기 · 합성 6-1 · 사회 · 민주주의", grade: 6, subject: "사회", standardCodes: ["6사01-01"] }]} /></main></>);
