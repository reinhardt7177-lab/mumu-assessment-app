import { notFound, redirect } from "next/navigation";
import { databaseConfigured, getClassroomRepository, getRepository } from "../../../db/connection";
import { AppError } from "../../../lib/assessment-domain";
import { validateId } from "../../../lib/http";
import { authConfigured, requireTeacher } from "../../../lib/teacher-auth";
import ClassroomDetail from "./classroom-detail";
import TeacherHeader from "../../teacher-header";

export const dynamic = "force-dynamic";

export default async function ClassroomPage({ params }: { params: Promise<{ classId: string }> }) {
  if (!databaseConfigured() || !authConfigured()) redirect("/");
  let owner: string;
  try { owner = await requireTeacher(); }
  catch (error) { if (error instanceof AppError) redirect(error.status === 401 ? "/sign-in" : "/"); throw error; }
  let classId: string;
  try { classId = validateId((await params).classId); } catch { notFound(); }
  const [detail, assessments] = await Promise.all([
    getClassroomRepository().getClassroom(classId, owner),
    getRepository().list(owner),
  ]).catch(error => { if (error instanceof AppError && error.status === 404) notFound(); throw error; });
  return <main className="real-workspace"><TeacherHeader active="classes" /><ClassroomDetail initialDetail={detail} assessments={assessments} /></main>;
}
