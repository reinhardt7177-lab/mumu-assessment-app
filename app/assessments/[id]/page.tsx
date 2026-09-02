import { notFound, redirect } from "next/navigation";
import { requireTeacher } from "../../../lib/teacher-auth";
import { getClassroomRepository, getRepository } from "../../../db/connection";
import { AppError } from "../../../lib/assessment-domain";
import { validateId } from "../../../lib/http";
import AssessmentDetail from "../../assessment-detail";
import TeacherHeader from "../../teacher-header";

export const dynamic = "force-dynamic";
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ distribution?: string }> }) {
  let owner: string;
  try { owner = await requireTeacher(); }
  catch (error) { if (error instanceof AppError) redirect(error.status === 401 ? "/sign-in" : "/"); throw error; }
  let id: string;
  try { id = validateId((await params).id); } catch { notFound(); }
  let distributionId: string | undefined;
  try { const raw = (await searchParams).distribution; distributionId = raw ? validateId(raw) : undefined; } catch { notFound(); }
  const repo = getRepository();
  const data = await Promise.all([
    repo.getOwned(id, owner),
    repo.submissions(id, owner, distributionId),
    distributionId ? getClassroomRepository().getDistribution(distributionId, owner) : Promise.resolve(null),
  ]).catch(error => { if (error instanceof AppError && error.status === 404) notFound(); throw error; });
  if (data[2] && data[2].assessmentId !== id) notFound();
  return <main className="real-workspace"><TeacherHeader active="assessments" /><AssessmentDetail initialAssessment={data[0]} initialSubmissions={data[1]} initialDistribution={data[2]} /></main>;
}
