import { redirect } from "next/navigation";
import { databaseConfigured, getDesignStudioRepository } from "../../db/connection";
import { AppError } from "../../lib/assessment-domain";
import { authConfigured, requireTeacher } from "../../lib/teacher-auth";
import TeacherHeader from "../teacher-header";
import DesignStudioHome from "./design-studio-home";

export const dynamic = "force-dynamic";

export default async function DesignPage() {
  if (!databaseConfigured() || !authConfigured()) redirect("/");
  let teacherId: string;
  try { teacherId = await requireTeacher(); }
  catch (error) { if (error instanceof AppError) redirect(error.status === 401 ? "/sign-in" : "/"); throw error; }
  const sessions = await getDesignStudioRepository().list(teacherId);
  return <main className="real-workspace"><TeacherHeader active="design" /><DesignStudioHome initialSessions={sessions} /></main>;
}
