import { getRepository } from "../../../../db/connection";
import { requireTeacher } from "../../../../lib/teacher-auth";
import { apiError, privateJson, readMutation } from "../../../../lib/http";

export async function GET() {
  try { const owner = await requireTeacher(); return privateJson({ assessments: await getRepository().list(owner) }); }
  catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const owner = await requireTeacher();
    const input = await readMutation(request);
    return privateJson({ assessment: await getRepository().create(owner, input) }, 201);
  } catch (error) { return apiError(error); }
}
