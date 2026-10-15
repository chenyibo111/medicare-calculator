import {
  adminErrorResponse,
  assertAdminConsoleEnabled,
  localSessionCookie,
  operatorFromRequest,
  resolveLocalAdminOperator,
  type LocalAdminSession,
} from "../../../../../server/admin-console.js";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    assertAdminConsoleEnabled();
    return Response.json({ operator: operatorFromRequest(request), localEvaluationOnly: true });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertAdminConsoleEnabled();
    const body = await request.json() as { session?: unknown };
    if (body.session !== "policy-author" && body.session !== "policy-reviewer") {
      return Response.json({ code: "INVALID_REQUEST", message: "请选择本地评测身份" }, { status: 400 });
    }
    const session = body.session as LocalAdminSession;
    const response = Response.json({ operator: resolveLocalAdminOperator(session), localEvaluationOnly: true });
    response.headers.set("Set-Cookie", localSessionCookie(session));
    return response;
  } catch (error) {
    return adminErrorResponse(error);
  }
}
