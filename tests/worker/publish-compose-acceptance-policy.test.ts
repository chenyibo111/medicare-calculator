import { describe, expect, it } from "vitest";
import { matchPolicy } from "../../packages/domain/src/policy.js";
import {
  COMPOSE_ACCEPTANCE_CALCULATION_REQUEST,
  COMPOSE_ACCEPTANCE_REGION,
  composeAcceptancePolicy,
} from "../../worker/src/compose-policy-fixtures.js";
import { publishComposeAcceptancePolicy } from "../../worker/src/publish-compose-acceptance-policy.js";

describe("Compose 验收政策发布", () => {
  it("使用独立于城市 A/B 的可匹配验收政策", () => {
    const v1 = composeAcceptancePolicy("v1");
    const v2 = composeAcceptancePolicy("v2");

    expect(COMPOSE_ACCEPTANCE_REGION).not.toMatch(/^城市[AB]$/);
    expect(v1.version).not.toBe(v2.version);
    expect(matchPolicy(v1, COMPOSE_ACCEPTANCE_CALCULATION_REQUEST)).toMatchObject({
      hospitalRule: v1.hospitalRules.tertiary,
    });
  });

  it("目标版本不存在时经审核发布，已存在时幂等跳过", async () => {
    const publishedVersions: string[] = [];
    const publisher = {
      async publish(draft: { policy: { version: string } }) {
        publishedVersions.push(draft.policy.version);
      },
    };
    const reviewGateway = {
      async approve(draft: { id: string; policy: unknown }, reviewer: string) {
        return {
          ...draft,
          status: "approved" as const,
          approvalId: "approval-acceptance",
          reviewer,
          approvedAt: "2026-10-15T00:00:00.000Z",
        };
      },
      async verifyApproved() {},
    };

    const created = await publishComposeAcceptancePolicy({
      version: "v1",
      hasPublishedVersion: async () => false,
      publisher: publisher as never,
      reviewGateway: reviewGateway as never,
      now: () => "2026-10-15T00:00:00.000Z",
    });
    const skipped = await publishComposeAcceptancePolicy({
      version: "v1",
      hasPublishedVersion: async () => true,
      publisher: publisher as never,
      reviewGateway: reviewGateway as never,
      now: () => "2026-10-15T00:00:00.000Z",
    });

    expect(created).toEqual({ version: composeAcceptancePolicy("v1").version, created: true });
    expect(skipped).toEqual({ version: composeAcceptancePolicy("v1").version, created: false });
    expect(publishedVersions).toEqual([composeAcceptancePolicy("v1").version]);
  });
});
