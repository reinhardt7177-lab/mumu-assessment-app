import { redirect } from "next/navigation";
import { databaseConfigured, getGrowthRepository } from "../../../db/connection";
import { AppError } from "../../../lib/assessment-domain";
import { authConfigured, requireTeacher } from "../../../lib/teacher-auth";
import SchoolPlanImporter from "./school-plan-importer";
import TeacherHeader from "../../teacher-header";

export const dynamic = "force-dynamic";

export default async function SchoolCurriculumSetupPage() {
  if (!databaseConfigured() || !authConfigured()) redirect("/");
  let owner: string;
  try { owner = await requireTeacher(); }
  catch (error) { if (error instanceof AppError) redirect("/"); throw error; }
  const repository = getGrowthRepository();
  const [schools, plans] = await Promise.all([repository.listSchools(owner), repository.listSchoolPlans(owner)]);
  return <main className="real-workspace">
    <TeacherHeader active="curriculum" />
    <SchoolPlanImporter initialSchools={schools} initialPlans={plans} defaultSchoolYear={new Date().getFullYear()} />
  </main>;
}
