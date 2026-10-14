import { describe, expect, it } from "vitest";
import {
  PolicyPublisher,
  type ApprovedPolicyDraft,
  type PolicyPublicationStore,
} from "../../packages/application/src/publish-policy.js";
import type { PublishedPolicy } from "../../packages/domain/src/policy.js";

const policy: PublishedPolicy = {
  region: "测试城市",
  benefitPlan: "居民医保",
  version: "T-2026.03",
  effectiveFrom: "2026-03-01",
  sourceReference: "测试来源",
  hospitalRules: {
    community: { deductibleFen: 100, reimbursementRateBps: 8500 },
    secondary: { deductibleFen: 200, reimbursementRateBps: 7500 },
    tertiary: { deductibleFen: 300, reimbursementRateBps: 6500 },
  },
  classBAdvanceRateBps: 0,
  annualCapFen: 1_000_000,
  retirementBonusBps: 0,
  unfiledOutOfAreaReductionBps: 0,
  catastrophicTiers: [],
};

const approvedDraft: ApprovedPolicyDraft = {
  id: "draft-1",
  status: "approved",
  demoAIProposal: true,
  source: { sourceId: "source-1", region: "测试城市", sourceUrl: "https://example.test/policy" },
  policy,
  approvalId: "approval-1",
  reviewer: "reviewer-1",
  approvedAt: "2026-02-20T00:00:00.000Z",
};

describe("PolicyPublisher", () => {
  it("将批准版本与 policy.published Outbox 事件作为同一次存储请求提交", async () => {
    const writes: Parameters<PolicyPublicationStore["publishApprovedVersion"]>[] = [];
    const store: PolicyPublicationStore = {
      async publishApprovedVersion(...input) {
        writes.push(input);
      },
    };
    const reviewGateway = {
      async approve() {
        return approvedDraft;
      },
      async verifyApproved() {},
    };
    const publisher = new PolicyPublisher({ store, reviewGateway, now: () => "2026-02-21T00:00:00.000Z" });

    const published = await publisher.publish(approvedDraft);

    expect(published).toMatchObject({ status: "published", publishedAt: "2026-02-21T00:00:00.000Z" });
    expect(writes).toEqual([
      [
        {
          approvedDraft,
          publication: {
            policy: { ...policy, status: "published" },
            event: {
              eventType: "policy.published",
              region: "测试城市",
              benefitPlan: "居民医保",
              newPolicyVersion: "T-2026.03",
              previousPolicyVersion: null,
              effectiveFrom: "2026-03-01",
              effectiveTo: null,
            },
          },
        },
      ],
    ]);
  });

  it("未经批准时不会发起版本或 Outbox 写入", async () => {
    const store: PolicyPublicationStore = {
      async publishApprovedVersion() {
        throw new Error("不应写入");
      },
    };
    const publisher = new PolicyPublisher({
      store,
      reviewGateway: {
        async approve() {
          return approvedDraft;
        },
        async verifyApproved() {},
      },
      now: () => "2026-02-21T00:00:00.000Z",
    });

    await expect(publisher.publish({ ...approvedDraft, status: "pending_review" })).rejects.toThrow(
      "审核通过后才能发布政策",
    );
  });
});
