"use client";

import { useEffect, useMemo, useState } from "react";

export type AchievementStandard = {
  code: string;
  content: string;
  subject: string;
  schoolLevel: string;
  gradeBand: string;
  domain: string;
  curriculumYear: number;
};

type PickerProps = {
  subjectLabel: string;
  selected: AchievementStandard[];
  onChange: (standards: AchievementStandard[]) => void;
};

function parseSubjectLabel(subjectLabel: string) {
  const match = subjectLabel.match(/^(\d)학년\s+(.+)$/);
  const grade = Number(match?.[1] ?? 6);
  return {
    subject: match?.[2] ?? "사회",
    gradeBand: grade <= 2 ? "1~2학년" : grade <= 4 ? "3~4학년" : "5~6학년",
  };
}

export default function AchievementStandardPicker({ subjectLabel, selected, onChange }: PickerProps) {
  const parsed = parseSubjectLabel(subjectLabel);
  const [standards, setStandards] = useState<AchievementStandard[]>([]);
  const [query, setQuery] = useState("");
  const [domain, setDomain] = useState("전체 영역");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    const params = new URLSearchParams({ subject: parsed.subject, gradeBand: parsed.gradeBand });
    fetch(`/api/achievement-standards?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("성취기준을 불러오지 못했습니다.");
        return response.json() as Promise<{ standards: AchievementStandard[] }>;
      })
      .then((result) => setStandards(result.standards))
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "성취기준을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [subjectLabel, parsed.gradeBand, parsed.subject]);

  const domains = useMemo(
    () => [...new Set(standards.map((standard) => standard.domain))].sort((a, b) => a.localeCompare(b, "ko")),
    [standards],
  );
  const visibleStandards = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
    return standards.filter((standard) => {
      if (domain !== "전체 영역" && standard.domain !== domain) return false;
      if (!normalizedQuery) return true;
      return `${standard.code} ${standard.domain} ${standard.content}`
        .toLocaleLowerCase("ko-KR")
        .includes(normalizedQuery);
    });
  }, [domain, query, standards]);

  const toggleStandard = (standard: AchievementStandard) => {
    if (selected.some((item) => item.code === standard.code)) {
      onChange(selected.filter((item) => item.code !== standard.code));
      return;
    }
    if (selected.length < 5) onChange([...selected, standard]);
  };

  return (
    <div className="wizard-body standard-picker">
      <div className="standard-picker-intro">
        <div>
          <p className="wizard-guide">평가할 성취기준을 먼저 선택하세요. 다음 단계의 문항과 루브릭이 선택한 기준을 따라갑니다.</p>
          <span>2022 개정 교육과정 · {parsed.gradeBand} {parsed.subject}</span>
        </div>
        <strong>{selected.length} / 5 선택</strong>
      </div>

      {selected.length > 0 && (
        <div className="selected-standard-chips" aria-label="선택한 성취기준">
          {selected.map((standard) => (
            <button type="button" key={standard.code} onClick={() => toggleStandard(standard)} title="선택 해제">
              {standard.code} <span>×</span>
            </button>
          ))}
        </div>
      )}

      <div className="standard-filters">
        <label>
          성취기준 검색
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="코드나 핵심어를 입력하세요" />
        </label>
        <label>
          영역
          <select value={domain} onChange={(event) => setDomain(event.target.value)}>
            <option>전체 영역</option>
            {domains.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
      </div>

      {loading && <div className="standard-state">성취기준을 불러오는 중입니다…</div>}
      {error && <div className="standard-state error">{error}</div>}
      {!loading && !error && (
        <div className="standard-list" aria-label={`${parsed.subject} 성취기준 목록`}>
          {visibleStandards.map((standard) => {
            const isSelected = selected.some((item) => item.code === standard.code);
            return (
              <button
                type="button"
                className={isSelected ? "selected" : ""}
                key={standard.code}
                onClick={() => toggleStandard(standard)}
                aria-pressed={isSelected}
              >
                <span className="standard-check">{isSelected ? "✓" : "+"}</span>
                <span className="standard-copy">
                  <span><strong>{standard.code}</strong><em>{standard.domain}</em></span>
                  <small>{standard.content}</small>
                </span>
              </button>
            );
          })}
          {visibleStandards.length === 0 && <div className="standard-state">검색 조건에 맞는 성취기준이 없습니다.</div>}
        </div>
      )}
      {selected.length === 0 && <p className="question-warning">문항 생성에 사용할 성취기준을 1개 이상 선택해 주세요.</p>}
    </div>
  );
}
