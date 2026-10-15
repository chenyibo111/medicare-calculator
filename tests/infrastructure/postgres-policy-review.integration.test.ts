import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPostgresSqlExecutor } from "../../packages/infrastructure/src/postgres/client.js";
import { PostgresPolicyPublicationStore } from "../../packages/infrastructure/src/postgres/postgres-policy-publication-store.js";
import { PostgresPolicyReviewStore } from "../../packages/infrastructure/src/postgres/postgres-policy-review-store.js";

const integration = process.env.DATABASE_URL ? describe : describe.skip;
const staticExtraction = { method: "demo_static" as const, adapterVersion: "test-1.0.0", aiAssisted: false };

function reviewSource(sourceId: string, region: string, sourceUrl: string) {
  return {
    sourceId, region, sourceUrl, capturedAt: "2026-10-15T00:00:00.000Z",
    artifact: { fileName: "integration-test.json", format: "json" as const, sha256: sourceId.replaceAll("-", "").padEnd(64, "0"), byteLength: 512 },
  };
}

integration("PostgreSQL 持久化政策审核", () => {
  it("持久化原始来源工件、提取元数据与字段证据，并拒绝重复内容导入", async () => {
    const executor = createPostgresSqlExecutor(process.env.DATABASE_URL!);
    const region = `来源导入测试市-${randomUUID()}`;
    const sourceId = randomUUID();
    const duplicateSourceId = randomUUID();
    const draftId = randomUUID();
    const reviewStore = new PostgresPolicyReviewStore(executor);
    const sha256 = "a".repeat(64);
    const source = {
      sourceId,
      region,
      sourceUrl: "https://example.test/controlled/import-v1",
      capturedAt: "2026-10-15T00:00:00.000Z",
      artifact: { fileName: "compose-import-v1.json", format: "json" as const, sha256, byteLength: 2048 },
    };
    const policy = {
      region, benefitPlan: "居民医保" as const, version: `IMPORT-${randomUUID()}`, effectiveFrom: "2026-10-15", sourceReference: "受控来源导入测试",
      hospitalRules: { community: { deductibleFen: 100, reimbursementRateBps: 8_000 }, secondary: { deductibleFen: 100, reimbursementRateBps: 7_000 }, tertiary: { deductibleFen: 100, reimbursementRateBps: 6_000 } },
      classBAdvanceRateBps: 0, annualCapFen: 1_000_000, retirementBonusBps: 0, unfiledOutOfAreaReductionBps: 0, catastrophicTiers: [],
    };
    const extraction = { method: "deterministic_json" as const, adapterVersion: "1.0.0", aiAssisted: false };
    const evidence = [{ field: "policy.version", locator: "$.policy.version", excerpt: policy.version, sourceSha256: sha256 }];
    try {
      await reviewStore.createDraft({ id: draftId, source, policy, evidence, extraction, createdAt: source.capturedAt });
      const stored = await reviewStore.getDraft(draftId);
      expect(stored).toMatchObject({
        source: { sourceId, capturedAt: source.capturedAt, artifact: source.artifact },
        extraction,
        evidence,
      });
      await expect(reviewStore.createDraft({
        id: randomUUID(),
        source: { ...source, sourceId: duplicateSourceId },
        policy: { ...policy, version: `DUPLICATE-${randomUUID()}` },
        evidence,
        extraction,
        createdAt: source.capturedAt,
      })).rejects.toThrow("该政策源内容已导入");
      const counts = await executor.query(
        "SELECT (SELECT count(*)::int FROM policy_sources WHERE content_hash = $1) AS sources, (SELECT count(*)::int FROM policy_drafts WHERE source_id = $2::uuid) AS drafts",
        [sha256, sourceId],
      );
      expect(counts.rows).toEqual([{ sources: 1, drafts: 1 }]);
    } finally {
      await executor.query("DELETE FROM policy_reviews WHERE draft_id = $1::uuid", [draftId]);
      await executor.query("DELETE FROM policy_drafts WHERE id = $1::uuid", [draftId]);
      await executor.query("DELETE FROM policy_sources WHERE id = $1::uuid", [sourceId]);
      await executor.close();
    }
  });

  it("并发审核同一草稿时至多持久化一条有效决定", async () => {
    const executor = createPostgresSqlExecutor(process.env.DATABASE_URL!);
    const region = `并发审核测试市-${randomUUID()}`;
    const sourceId = randomUUID();
    const draftId = randomUUID();
    const reviewStore = new PostgresPolicyReviewStore(executor);
    try {
      await reviewStore.createDraft({
        id: draftId, source: reviewSource(sourceId, region, "https://example.test/concurrent"), createdAt: "2026-10-15T00:00:00.000Z",
        policy: { region, benefitPlan: "居民医保", version: `CONCURRENT-${randomUUID()}`, effectiveFrom: "2026-10-15", sourceReference: "并发审核测试", hospitalRules: { community: { deductibleFen: 100, reimbursementRateBps: 8_000 }, secondary: { deductibleFen: 100, reimbursementRateBps: 7_000 }, tertiary: { deductibleFen: 100, reimbursementRateBps: 6_000 } }, classBAdvanceRateBps: 0, annualCapFen: 1_000_000, retirementBonusBps: 0, unfiledOutOfAreaReductionBps: 0, catastrophicTiers: [] },
        evidence: [], extraction: staticExtraction,
      });
      await reviewStore.submitDraft({ draftId, submittedBy: "author-concurrent", submittedAt: "2026-10-15T00:01:00.000Z" });
      const results = await Promise.allSettled([
        reviewStore.decideDraft({ draftId, reviewerId: "reviewer-a", decision: "approved", reason: "审核 A", reviewedAt: "2026-10-15T00:02:00.000Z" }),
        reviewStore.decideDraft({ draftId, reviewerId: "reviewer-b", decision: "approved", reason: "审核 B", reviewedAt: "2026-10-15T00:02:00.000Z" }),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const reviews = await executor.query("SELECT reviewer_id, decision FROM policy_reviews WHERE draft_id = $1::uuid", [draftId]);
      expect(reviews.rows).toHaveLength(1);
      expect(reviews.rows[0]?.decision).toBe("approved");
    } finally {
      await executor.query("DELETE FROM policy_reviews WHERE draft_id = $1::uuid", [draftId]);
      await executor.query("DELETE FROM policy_drafts WHERE id = $1::uuid", [draftId]);
      await executor.query("DELETE FROM policy_sources WHERE id = $1::uuid", [sourceId]);
      await executor.close();
    }
  });

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
        source: reviewSource(sourceId, region, "https://example.test/review-console"),
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
        evidence: [], extraction: staticExtraction,
      });
      await reviewStore.submitDraft({ draftId, submittedBy: "author-1", submittedAt: "2026-10-15T00:01:00.000Z" });
      await expect(reviewStore.decideDraft({
        draftId, reviewerId: "author-1", decision: "approved", reason: "不允许自审", reviewedAt: "2026-10-15T00:02:00.000Z",
      })).rejects.toThrow("不能审核自己提交的草稿");
      const selfReview = await executor.query("SELECT count(*)::int AS count FROM policy_reviews WHERE draft_id = $1::uuid", [draftId]);
      expect(selfReview.rows).toEqual([{ count: 0 }]);
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
      await expect(publicationStore.publishApprovedVersion({
        approvedDraft: approved!,
        publication: {
          policy: { ...approved!.policy, status: "published" },
          event: { eventType: "policy.published", region, benefitPlan: "居民医保", newPolicyVersion: version, previousPolicyVersion: null, effectiveFrom: "2026-10-15", effectiveTo: null },
        },
      })).rejects.toThrow("审核凭证无效，不能发布政策");
      const publicationCounts = await executor.query(
        "SELECT (SELECT count(*)::int FROM policy_versions WHERE region = $1) AS versions, (SELECT count(*)::int FROM policy_outbox_events WHERE payload->>'region' = $1) AS events",
        [region],
      );
      expect(publicationCounts.rows).toEqual([{ versions: 1, events: 1 }]);
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
