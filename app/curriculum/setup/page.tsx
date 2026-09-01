import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { databaseConfigured, getGrowthRepository } from "../../../db/connection";
import { AppError } from "../../../lib/assessment-domain";
import { authConfigured, requireTeacher } from "../../../lib/teacher-auth";
import SchoolPlanImporter from "./school-plan-importer";

export const dynamic = "force-dynamic";

export default async function SchoolCurriculumSetupPage() {
  if (!databaseConfigured() || !authConfigured()) redirect("/");
  let owner: string;
  try { owner = await requireTeacher(); }
  catch (error) { if (error instanceof AppError) redirect("/"); throw error; }
  const repository = getGrowthRepository();
  const [schools, plans] = await Promise.all([repository.listSchools(owner), repository.listSchoolPlans(owner)]);
  return <main className="real-workspace">
    <header className="workspace-header"><Link href="/curriculum" className="workspace-brand"><span>M</span><strong>Mumu 평가</strong></Link><nav aria-label="교사 워크스페이스"><Link className="active" href="/curriculum">교육과정 성장 평가</Link><Link href="/">평가 문항·QR</Link></nav><UserButton /></header>
    <SchoolPlanImporter initialSchools={schools} initialPlans={plans} defaultSchoolYear={new Date().getFullYear()} />
  </main>;
}
