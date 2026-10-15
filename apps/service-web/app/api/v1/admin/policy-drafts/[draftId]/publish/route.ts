import {
  adminErrorResponse,
  assertAdminConsoleEnabled,
  getAdminPolicyReviewWorkflow,
  operatorFromRequest,
} from "../../../../../../../server/admin-console.js";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ draftId: string }> }): Promise<Response> {
  try {
    assertAdminConsoleEnabled();
    const operator = operatorFromRequest(request);
    const { draftId } = await context.params;
    const draft = await (await getAdminPolicyReviewWorkflow()).publishDraft(operator, draftId);
    return Response.json({ draft });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
