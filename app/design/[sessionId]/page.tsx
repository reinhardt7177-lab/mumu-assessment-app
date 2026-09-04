import { redirect } from "next/navigation";
import { databaseConfigured, getDesignStudioRepository } from "../../../db/connection";
import { AppError } from "../../../lib/assessment-domain";
import { authConfigured, requireTeacher } from "../../../lib/teacher-auth";
import TeacherHeader from "../../teacher-header";
import DesignStudioEditor from "./design-studio-editor";

export const dynamic = "force-dynamic";

export default async function DesignSessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  if (!databaseConfigured() || !authConfigured()) redirect("/");
  let teacherId: string;
  try { teacherId = await requireTeacher(); }
  catch (error) { if (error instanceof AppError) redirect(error.status === 401 ? "/sign-in" : "/"); throw error; }
  const session = await getDesignStudioRepository().get((await params).sessionId, teacherId);
  return <main className="real-workspace"><TeacherHeader active="design" /><DesignStudioEditor initialSession={session} /></main>;
}
