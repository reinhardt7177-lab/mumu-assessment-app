import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { databaseConfigured, getGrowthRepository } from "../../db/connection";
import { authConfigured, requireTeacher } from "../../lib/teacher-auth";
import { AppError } from "../../lib/assessment-domain";
import CurriculumWorkspace from "./curriculum-workspace";

export const dynamic = "force-dynamic";

export default async function CurriculumPage() {
  if (!databaseConfigured() || !authConfigured()) redirect("/");
  let owner: string;
  try { owner = await requireTeacher(); }
  catch (error) { if (error instanceof AppError) redirect("/"); throw error; }
  const terms = await getGrowthRepository().listTerms(owner);
  return <main className="real-workspace">
    <header className="workspace-header"><Link href="/curriculum" className="workspace-brand"><span>M</span><strong>Mumu 평가</strong></Link><nav aria-label="교사 워크스페이스"><Link className="active" href="/curriculum">교육과정 성장 평가</Link><Link href="/">평가 문항·QR</Link></nav><UserButton /></header>
    <CurriculumWorkspace initialTerms={terms} defaultSchoolYear={new Date().getFullYear()} />
  </main>;
}
