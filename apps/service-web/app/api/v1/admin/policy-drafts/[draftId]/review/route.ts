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
    const body = await request.json() as { decision?: unknown; reason?: unknown };
    if ((body.decision !== "approved" && body.decision !== "rejected") || typeof body.reason !== "string") {
      return Response.json({ code: "INVALID_REQUEST", message: "请提供审核结论与审核意见" }, { status: 400 });
    }
    const { draftId } = await context.params;
    const draft = await (await getAdminPolicyReviewWorkflow()).decideDraft(operator, draftId, body.decision, body.reason);
    return Response.json({ draft });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
