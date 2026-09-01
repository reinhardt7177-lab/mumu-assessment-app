import { getRepository } from "../../../../../db/connection";
import { requireTeacher } from "../../../../../lib/teacher-auth";
import { apiError, privateJson } from "../../../../../lib/http";

export async function GET(request: Request) {
  try {
    const owner = await requireTeacher();
    const requestedLimit = Number(new URL(request.url).searchParams.get("limit") ?? 12);
    const limit = Number.isInteger(requestedLimit) && requestedLimit >= 1 && requestedLimit <= 30 ? requestedLimit : 12;
    const generations = await getRepository().listQuestionGenerations(owner, limit);
    return privateJson({ generations: generations.map(({ id, title, subject, learningGoal, requestedCount, output, createdAt }) => ({
      id, title, subject, learningGoal, requestedCount, output, createdAt,
    })) });
  } catch (error) { return apiError(error); }
}
