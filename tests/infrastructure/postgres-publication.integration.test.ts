import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPostgresSqlExecutor } from "../../packages/infrastructure/src/postgres/client.js";
import { PostgresPolicyPublicationStore } from "../../packages/infrastructure/src/postgres/postgres-policy-publication-store.js";
import { PostgresPolicyReviewStore } from "../../packages/infrastructure/src/postgres/postgres-policy-review-store.js";

const integration = process.env.DATABASE_URL ? describe : describe.skip;

integration("PostgreSQL 政策发布事务", () => {
  it("同一事务中写入已发布版本、替换状态和 Outbox 事件", async () => {
    const executor = createPostgresSqlExecutor(process.env.DATABASE_URL!);
    const store = new PostgresPolicyPublicationStore(executor);
    const reviewStore = new PostgresPolicyReviewStore(executor);
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
      await reviewStore.createDraft({ id: draft.id, source: draft.source, policy: draft.policy, createdAt: draft.approvedAt });
      await reviewStore.submitDraft({ draftId: draft.id, submittedBy: "transaction-author", submittedAt: draft.approvedAt });
      await reviewStore.decideDraft({
        draftId: draft.id,
        reviewerId: draft.reviewer,
        decision: "approved",
        reason: "事务测试审核通过",
        reviewedAt: draft.approvedAt,
      });
      const persistedDraft = await reviewStore.getApprovedDraft(draft.id);
      await store.publishApprovedVersion({
        approvedDraft: persistedDraft!,
        publication: {
          policy: { ...persistedDraft!.policy, status: "published" },
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

  it("发布重叠新版本时把真实旧版本写入 Outbox 并废弃旧版本", async () => {
    const executor = createPostgresSqlExecutor(process.env.DATABASE_URL!);
    const store = new PostgresPolicyPublicationStore(executor);
    const reviewStore = new PostgresPolicyReviewStore(executor);
    const region = `版本切换测试市-${randomUUID()}`;
    const v1 = `V1-${randomUUID()}`;
    const v2 = `V2-${randomUUID()}`;
    const createDraft = (version: string) => ({
      id: randomUUID(),
      status: "approved" as const,
      demoAIProposal: true as const,
      source: { sourceId: randomUUID(), region, sourceUrl: `https://example.test/${version}` },
      policy: {
        region,
        benefitPlan: "居民医保" as const,
        version,
        effectiveFrom: "2026-04-01",
        sourceReference: "版本切换测试来源",
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
      reviewer: "version-reviewer",
      approvedAt: "2026-03-01T00:00:00.000Z",
    });
    const publish = async (version: string) => {
      const draft = createDraft(version);
      await reviewStore.createDraft({ id: draft.id, source: draft.source, policy: draft.policy, createdAt: draft.approvedAt });
      await reviewStore.submitDraft({ draftId: draft.id, submittedBy: "version-author", submittedAt: draft.approvedAt });
      await reviewStore.decideDraft({
        draftId: draft.id,
        reviewerId: draft.reviewer,
        decision: "approved",
        reason: "版本切换测试审核通过",
        reviewedAt: draft.approvedAt,
      });
      const persistedDraft = await reviewStore.getApprovedDraft(draft.id);
      await store.publishApprovedVersion({
        approvedDraft: persistedDraft!,
        publication: {
          policy: { ...persistedDraft!.policy, status: "published" },
          event: {
            eventType: "policy.published",
            region,
            benefitPlan: "居民医保",
            newPolicyVersion: version,
            previousPolicyVersion: null,
            effectiveFrom: "2026-04-01",
            effectiveTo: null,
          },
        },
      });
    };

    try {
      await publish(v1);
      await publish(v2);

      const versions = await executor.query(
        "SELECT version, status FROM policy_versions WHERE region = $1 ORDER BY version",
        [region],
      );
      const event = await executor.query(
        "SELECT payload->>'previousPolicyVersion' AS previous_policy_version FROM policy_outbox_events WHERE payload->>'newPolicyVersion' = $1",
        [v2],
      );

      expect(versions.rows).toEqual([
        { version: v1, status: "superseded" },
        { version: v2, status: "published" },
      ]);
      expect(event.rows).toEqual([{ previous_policy_version: v1 }]);
    } finally {
      await executor.query("DELETE FROM policy_outbox_events WHERE payload->>'region' = $1", [region]);
      await executor.query("DELETE FROM policy_reviews WHERE draft_id IN (SELECT id FROM policy_drafts WHERE source_id IN (SELECT id FROM policy_sources WHERE region = $1))", [region]);
      await executor.query("DELETE FROM policy_drafts WHERE source_id IN (SELECT id FROM policy_sources WHERE region = $1)", [region]);
      await executor.query("DELETE FROM policy_versions WHERE region = $1", [region]);
      await executor.query("DELETE FROM policy_sources WHERE region = $1", [region]);
      await executor.close();
    }
  });
});
