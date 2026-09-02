import { redirect } from "next/navigation";
import { databaseConfigured, getClassroomRepository, getGrowthRepository } from "../../db/connection";
import { AppError } from "../../lib/assessment-domain";
import { authConfigured, requireTeacher } from "../../lib/teacher-auth";
import ClassroomList from "./classroom-list";
import TeacherHeader from "../teacher-header";

export const dynamic = "force-dynamic";

export default async function ClassesPage() {
  if (!databaseConfigured() || !authConfigured()) redirect("/");
  let owner: string;
  try { owner = await requireTeacher(); }
  catch (error) { if (error instanceof AppError) redirect(error.status === 401 ? "/sign-in" : "/"); throw error; }
  const [classes, schools] = await Promise.all([
    getClassroomRepository().listClasses(owner),
    getGrowthRepository().listSchools(owner),
  ]);
  return <main className="real-workspace"><TeacherHeader active="classes" /><ClassroomList initialClasses={classes} schools={schools} /></main>;
}
