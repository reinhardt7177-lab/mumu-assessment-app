import { redirect } from "next/navigation";
import { databaseConfigured, getClassroomRepository, getGrowthRepository } from "../../db/connection";
import { authConfigured, requireTeacher } from "../../lib/teacher-auth";
import { AppError } from "../../lib/assessment-domain";
import CurriculumWorkspace from "./curriculum-workspace";
import TeacherHeader from "../teacher-header";

export const dynamic = "force-dynamic";

export default async function CurriculumPage() {
  if (!databaseConfigured() || !authConfigured()) redirect("/");
  let owner: string;
  try { owner = await requireTeacher(); }
  catch (error) { if (error instanceof AppError) redirect("/"); throw error; }
  const [terms, classes] = await Promise.all([
    getGrowthRepository().listTerms(owner),
    getClassroomRepository().listClasses(owner),
  ]);
  return <main className="real-workspace">
    <TeacherHeader active="curriculum" />
    <CurriculumWorkspace initialTerms={terms} classes={classes} defaultSchoolYear={new Date().getFullYear()} />
  </main>;
}
