import {
  adminErrorResponse,
  assertAdminConsoleEnabled,
  createComposeAcceptanceDraftInput,
  getAdminConsole,
  getAdminPolicyReviewWorkflow,
  operatorFromRequest,
  type ComposeAcceptancePolicyVersion,
} from "../../../../../server/admin-console.js";
import { importControlledPolicySource } from "../../../../../server/controlled-policy-import.js";

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
    const body = await request.json() as { templateVersion?: unknown; sourceKey?: unknown };
    const workflow = await getAdminPolicyReviewWorkflow();
    if (typeof body.sourceKey === "string") {
      const draft = await importControlledPolicySource({ sourceKey: body.sourceKey, operator, workflow });
      return Response.json({ draft }, { status: 201 });
    }
    if (body.templateVersion !== "v1" && body.templateVersion !== "v2") {
      return Response.json({ code: "INVALID_REQUEST", message: "仅支持固定 Compose 验收模板 v1 / v2 或受控政策源" }, { status: 400 });
    }
    const template = createComposeAcceptanceDraftInput(body.templateVersion as ComposeAcceptancePolicyVersion);
    const draft = await workflow.createDraft(operator, template);
    return Response.json({ draft }, { status: 201 });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
