import { getClassroomRepository, getRepository } from "../../../../../db/connection";
import { requireTeacher } from "../../../../../lib/teacher-auth";
import { AppError } from "../../../../../lib/assessment-domain";
import { apiError, privateJson, validateId } from "../../../../../lib/http";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const owner = await requireTeacher();
    const id = validateId((await params).id);
    const rawDistributionId = new URL(request.url).searchParams.get("distribution");
    const distributionId = rawDistributionId ? validateId(rawDistributionId) : undefined;
    const repo = getRepository();
    const [assessment, submissions, distribution] = await Promise.all([
      repo.getOwned(id, owner),
      repo.submissions(id, owner, distributionId),
      distributionId ? getClassroomRepository().getDistribution(distributionId, owner) : Promise.resolve(null),
    ]);
    if (distribution && distribution.assessmentId !== id) throw new AppError(404, "이 평가의 학급 배포를 찾을 수 없습니다.");
    return privateJson({ assessment, submissions, distribution });
  } catch (error) { return apiError(error); }
}
