import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPostgresSqlExecutor } from "../../packages/infrastructure/src/postgres/client.js";
import { PostgresPolicyPublicationStore } from "../../packages/infrastructure/src/postgres/postgres-policy-publication-store.js";

const integration = process.env.DATABASE_URL ? describe : describe.skip;

integration("PostgreSQL 政策发布事务", () => {
  it("同一事务中写入已发布版本、替换状态和 Outbox 事件", async () => {
    const executor = createPostgresSqlExecutor(process.env.DATABASE_URL!);
    const store = new PostgresPolicyPublicationStore(executor);
    const version = `TXN-${randomUUID()}`;
    const draft = {
      id: randomUUID(),
      status: "approved" as const,
      demoAIProposal: true as const,
      source: { sourceId: randomUUID(), region: "事务测试市", sourceUrl: "https://example.test/transaction" },
      policy: {
        region: "事务测试市",
        benefitPlan: "居民医保" as const,
        version,
        effectiveFrom: "2026-04-01",
        sourceReference: "事务测试来源",
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
      },
      approvalId: randomUUID(),
      reviewer: "transaction-reviewer",
      approvedAt: "2026-03-01T00:00:00.000Z",
    };

    try {
      await store.publishApprovedVersion({
        approvedDraft: draft,
        publication: {
          policy: { ...draft.policy, status: "published" },
          event: {
            eventType: "policy.published",
            region: draft.policy.region,
            benefitPlan: draft.policy.benefitPlan,
            newPolicyVersion: version,
            previousPolicyVersion: null,
            effectiveFrom: draft.policy.effectiveFrom,
            effectiveTo: null,
          },
        },
      });

      const result = await executor.query(
        "SELECT version, status FROM policy_versions WHERE region = $1 AND version = $2",
        ["事务测试市", version],
      );
      expect(result.rows).toEqual([{ version, status: "published" }]);

      const events = await executor.query(
        "SELECT event_type FROM policy_outbox_events WHERE payload->>'newPolicyVersion' = $1",
        [version],
      );
      expect(events.rows).toEqual([{ event_type: "policy.published" }]);
    } finally {
      await executor.close();
    }
  });
});
