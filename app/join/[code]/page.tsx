import type { Metadata } from "next";
import StudentExam from "../../student-exam";

type JoinPageProps = {
  params: Promise<{ code: string }>;
};

export async function generateMetadata({ params }: JoinPageProps): Promise<Metadata> {
  const { code } = await params;
  const title = "민주주의의 발전과 사회 변화 | 학생 시험지";
  const description = `참여 코드 ${code.toUpperCase()} · 6학년 사회 학생 평가`;

  return {
    title,
    description,
    openGraph: { title, description, images: [] },
    twitter: { title, description, images: [] },
  };
}

export default async function JoinPage({ params }: JoinPageProps) {
  const { code } = await params;
  return <StudentExam code={code.toUpperCase()} />;
}
