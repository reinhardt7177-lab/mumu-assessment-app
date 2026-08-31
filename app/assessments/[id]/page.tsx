import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { requireTeacher } from "../../../lib/teacher-auth";
import { getRepository } from "../../../db/connection";
import { AppError } from "../../../lib/assessment-domain";
import { validateId } from "../../../lib/http";
import AssessmentDetail from "../../assessment-detail";

export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  let owner: string;
  try { owner = await requireTeacher(); }
  catch (error) { if (error instanceof AppError) redirect(error.status === 401 ? "/sign-in" : "/"); throw error; }
  let id: string;
  try { id = validateId((await params).id); } catch { notFound(); }
  const repo = getRepository();
  const data = await Promise.all([repo.getOwned(id, owner), repo.submissions(id, owner)]).catch(error => { if (error instanceof AppError && error.status === 404) notFound(); throw error; });
  return <main className="real-workspace"><header className="workspace-header"><Link className="workspace-brand" href="/"><span>M</span><strong>Mumu 평가</strong></Link><div><Link href="/">← 나의 평가</Link><UserButton /></div></header><AssessmentDetail initialAssessment={data[0]} initialSubmissions={data[1]} /></main>;
}
