import { CalculationApplicationError } from "../../../../../../packages/application/src/calculate-reimbursement";
import { getCalculationUseCase } from "../../../../server/composition-root";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json();
    const response = await (await getCalculationUseCase()).execute(body, {
      requestId: request.headers.get("x-request-id") ?? undefined,
    });
    return Response.json(response);
  } catch (error) {
    if (error instanceof CalculationApplicationError) {
      return Response.json({ code: error.code, message: error.message }, { status: error.code === "VALIDATION_ERROR" ? 400 : 404 });
    }
    return Response.json({ code: "INVALID_REQUEST", message: "请求格式不正确" }, { status: 400 });
  }
}
