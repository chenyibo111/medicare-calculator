import { describe, expect, it } from "vitest";
import { POST } from "../../apps/service-web/app/api/v1/reimbursement-calculations/route.js";

const validRequest = {
  region: "城市B",
  hospitalLevel: "tertiary",
  employmentStatus: "resident",
  totalAmountFen: 6_000_000,
  outOfCatalogAmountFen: 200_000,
  classBAmountFen: 1_000_000,
  annualReimbursedAmountFen: 0,
  outOfAreaFiled: true,
};

function request(body: unknown): Request {
  return new Request("http://localhost/api/v1/reimbursement-calculations", {
    method: "POST",
    headers: { "content-type": "application/json", "x-request-id": "api-test" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/reimbursement-calculations", () => {
  it("returns the server calculation contract and caches a repeated request", async () => {
    const first = await POST(request(validRequest));
    const firstBody = await first.json();
    const second = await POST(request(validRequest));
    const secondBody = await second.json();

    expect(first.status).toBe(200);
    expect(firstBody).toMatchObject({
      calculationId: "api-test",
      policyVersion: "B-2026.01",
      cacheStatus: "miss",
      result: { estimatedSelfPayFen: 2_366_500 },
    });
    expect(firstBody).not.toHaveProperty("policy");
    expect(second.status).toBe(200);
    expect(secondBody.cacheStatus).toBe("hit");
  });

  it("returns a recoverable Chinese 400 error for invalid input", async () => {
    const response = await POST(request({ ...validRequest, totalAmountFen: -1 }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "VALIDATION_ERROR",
      message: "总医疗费用必须是非负整数分",
    });
  });
});
