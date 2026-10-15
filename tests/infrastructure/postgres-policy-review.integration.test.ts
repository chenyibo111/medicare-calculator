import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPostgresSqlExecutor } from "../../packages/infrastructure/src/postgres/client.js";
import { PostgresPolicyPublicationStore } from "../../packages/infrastructure/src/postgres/postgres-policy-publication-store.js";
import { PostgresPolicyReviewStore } from "../../packages/infrastructure/src/postgres/postgres-policy-review-store.js";

const integration = process.env.DATABASE_URL ? describe : describe.skip;

integration("PostgreSQL 持久化政策审核", () => {
  it("以已持久化草稿完成提交、异人审核和事务发布", async () => {
    const executor = createPostgresSqlExecutor(process.env.DATABASE_URL!);
    const region = `审核工作台测试市-${randomUUID()}`;
    const sourceId = randomUUID();
    const draftId = randomUUID();
    const version = `CONSOLE-${randomUUID()}`;
    const reviewStore = new PostgresPolicyReviewStore(executor);
    const publicationStore = new PostgresPolicyPublicationStore(executor);

    try {
      await reviewStore.createDraft({
        id: draftId,
        source: { sourceId, region, sourceUrl: "https://example.test/review-console" },
        createdAt: "2026-10-15T00:00:00.000Z",
        policy: {
          region,
          benefitPlan: "居民医保",
          version,
          effectiveFrom: "2026-10-15",
          sourceReference: "审核工作台集成测试",
          hospitalRules: {
            community: { deductibleFen: 100, reimbursementRateBps: 8_000 },
            secondary: { deductibleFen: 100, reimbursementRateBps: 7_000 },
            tertiary: { deductibleFen: 100, reimbursementRateBps: 6_000 },
          },
          classBAdvanceRateBps: 0,
          annualCapFen: 1_000_000,
          retirementBonusBps: 0,
          unfiledOutOfAreaReductionBps: 0,
          catastrophicTiers: [],
        },
      });
      await reviewStore.submitDraft({ draftId, submittedBy: "author-1", submittedAt: "2026-10-15T00:01:00.000Z" });
      await expect(reviewStore.decideDraft({
        draftId, reviewerId: "author-1", decision: "approved", reason: "不允许自审", reviewedAt: "2026-10-15T00:02:00.000Z",
      })).rejects.toThrow("不能审核自己提交的草稿");
      await reviewStore.decideDraft({
        draftId, reviewerId: "reviewer-1", decision: "approved", reason: "字段与来源已核对", reviewedAt: "2026-10-15T00:03:00.000Z",
      });

      const approved = await reviewStore.getApprovedDraft(draftId);
      expect(approved).toMatchObject({ id: draftId, reviewer: "reviewer-1", policy: { version } });
      await publicationStore.publishApprovedVersion({
        approvedDraft: approved!,
        publication: {
          policy: { ...approved!.policy, status: "published" },
          event: {
            eventType: "policy.published",
            region,
            benefitPlan: "居民医保",
            newPolicyVersion: version,
            previousPolicyVersion: null,
            effectiveFrom: "2026-10-15",
            effectiveTo: null,
          },
        },
      });

      const stored = await executor.query("SELECT status FROM policy_drafts WHERE id = $1::uuid", [draftId]);
      expect(stored.rows).toEqual([{ status: "published" }]);
    } finally {
      await executor.query("DELETE FROM policy_outbox_events WHERE payload->>'region' = $1", [region]);
      await executor.query("DELETE FROM policy_reviews WHERE draft_id = $1::uuid", [draftId]);
      await executor.query("DELETE FROM policy_drafts WHERE id = $1::uuid", [draftId]);
      await executor.query("DELETE FROM policy_versions WHERE region = $1", [region]);
      await executor.query("DELETE FROM policy_sources WHERE id = $1::uuid", [sourceId]);
      await executor.close();
    }
  });
});
