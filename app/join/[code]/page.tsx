import type { Metadata } from "next";
import StudentExam from "../../student-exam";

type JoinPageProps = {
  params: Promise<{ code: string }>;
};

export async function generateMetadata({ params }: JoinPageProps): Promise<Metadata> {
  const { code } = await params;
  const title = "학생 시험지 | Mumu 평가";
  const description = `참여 코드 ${code.toUpperCase()} · 선생님이 배포한 학생 평가`;

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
