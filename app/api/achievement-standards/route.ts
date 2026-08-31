import curriculum from "@/data/achievement-standards.2022.json";

type AchievementStandard = {
  code: string;
  content: string;
  subject: string;
  schoolLevel: string;
  gradeBand: string;
  domain: string;
  curriculumYear: number;
};

const standards = curriculum.standards as AchievementStandard[];
const allowedSubjects = new Set(["국어", "사회", "수학", "과학", "도덕", "영어"]);
const allowedGradeBands = new Set(["1~2학년", "3~4학년", "5~6학년"]);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const subject = searchParams.get("subject")?.trim() ?? "";
  const gradeBand = searchParams.get("gradeBand")?.trim() ?? "";
  const query = searchParams.get("q")?.trim().toLocaleLowerCase("ko-KR") ?? "";

  if (subject && !allowedSubjects.has(subject)) {
    return Response.json({ error: "지원하지 않는 교과입니다." }, { status: 400 });
  }
  if (gradeBand && !allowedGradeBands.has(gradeBand)) {
    return Response.json({ error: "지원하지 않는 학년군입니다." }, { status: 400 });
  }

  const filtered = standards.filter((standard) => {
    if (subject && standard.subject !== subject) return false;
    if (gradeBand && standard.gradeBand !== gradeBand) return false;
    if (!query) return true;
    const haystack = `${standard.code} ${standard.domain} ${standard.content}`.toLocaleLowerCase("ko-KR");
    return haystack.includes(query);
  });

  return Response.json(
    {
      metadata: {
        curriculumYear: curriculum.metadata.curriculumYear,
        notice: curriculum.metadata.notice,
        scope: curriculum.metadata.scope,
        count: filtered.length,
      },
      domains: [...new Set(filtered.map((standard) => standard.domain))].sort((a, b) => a.localeCompare(b, "ko")),
      standards: filtered,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      },
    },
  );
}
