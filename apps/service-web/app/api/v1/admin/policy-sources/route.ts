import {
  adminErrorResponse,
  assertAdminConsoleEnabled,
  operatorFromRequest,
} from "../../../../../server/admin-console.js";
import { listControlledPolicySources } from "../../../../../server/controlled-policy-import.js";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    assertAdminConsoleEnabled();
    operatorFromRequest(request);
    return Response.json({ sources: listControlledPolicySources(), localEvaluationOnly: true });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
