import { redirect } from "next/navigation";
import { getGrowthRepository } from "../../../db/connection";
import { AppError } from "../../../lib/assessment-domain";
import { requireTeacher } from "../../../lib/teacher-auth";
import { validateId } from "../../../lib/http";
import CurriculumTermDashboard from "./curriculum-term-dashboard";
import TeacherHeader from "../../teacher-header";

export const dynamic = "force-dynamic";

export default async function CurriculumTermPage({ params }: { params: Promise<{ termId: string }> }) {
  let owner: string;
  try { owner = await requireTeacher(); }
  catch (error) { if (error instanceof AppError) redirect("/"); throw error; }
  const { termId } = await params;
  const id = validateId(termId);
  const repository = getGrowthRepository();
  const [dashboard, workflow] = await Promise.all([
    repository.getDashboard(id, owner),
    repository.getWorkflow(id, owner),
  ]);
  return <main className="real-workspace">
    <TeacherHeader active="curriculum" />
    <CurriculumTermDashboard initialDashboard={dashboard} initialWorkflow={workflow} />
  </main>;
}
