import {
  adminErrorResponse,
  assertAdminConsoleEnabled,
  createComposeAcceptanceDraftInput,
  getAdminConsole,
  getAdminPolicyReviewWorkflow,
  operatorFromRequest,
  type ComposeAcceptancePolicyVersion,
} from "../../../../../server/admin-console.js";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    assertAdminConsoleEnabled();
    operatorFromRequest(request);
    const { reviewStore } = await getAdminConsole();
    return Response.json({ drafts: await reviewStore.listDrafts(), localEvaluationOnly: true });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertAdminConsoleEnabled();
    const operator = operatorFromRequest(request);
    const body = await request.json() as { templateVersion?: unknown };
    if (body.templateVersion !== "v1" && body.templateVersion !== "v2") {
      return Response.json({ code: "INVALID_REQUEST", message: "仅支持固定 Compose 验收模板 v1 或 v2" }, { status: 400 });
    }
    const template = createComposeAcceptanceDraftInput(body.templateVersion as ComposeAcceptancePolicyVersion);
    const draft = await (await getAdminPolicyReviewWorkflow()).createDraft(operator, template.source, template.policy);
    return Response.json({ draft }, { status: 201 });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
