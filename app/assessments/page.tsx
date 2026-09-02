import { redirect } from "next/navigation";
import { databaseConfigured, getRepository } from "../../db/connection";
import { AppError } from "../../lib/assessment-domain";
import { authConfigured, requireTeacher } from "../../lib/teacher-auth";
import TeacherHeader from "../teacher-header";
import Workspace from "../workspace";

export const dynamic = "force-dynamic";

export default async function AssessmentsPage() {
  if (!databaseConfigured() || !authConfigured()) redirect("/");
  let owner: string;
  try { owner = await requireTeacher(); }
  catch (error) { if (error instanceof AppError) redirect(error.status === 401 ? "/sign-in" : "/"); throw error; }
  const assessments = await getRepository().list(owner);
  return <main className="real-workspace"><TeacherHeader active="assessments" /><Workspace initialAssessments={assessments} /></main>;
}
