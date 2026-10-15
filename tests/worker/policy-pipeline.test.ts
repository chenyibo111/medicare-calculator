import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PolicyPublisher } from "../../packages/application/src/publish-policy.js";
import { DemoExtractionAdapter } from "../../packages/infrastructure/src/demo-extraction-adapter.js";
import { LocalPolicySource } from "../../packages/infrastructure/src/local-policy-source.js";
import { LocalReviewGateway } from "../../packages/infrastructure/src/local-review-gateway.js";
import type { PublishedPolicy } from "../../packages/domain/src/policy.js";

const proposedPolicy: PublishedPolicy = {
  region: "测试城市",
  benefitPlan: "居民医保",
  version: "T-2026.02",
  effectiveFrom: "2026-02-01",
  sourceReference: "测试政策来源",
  hospitalRules: {
    community: { deductibleFen: 100, reimbursementRateBps: 8500 },
    secondary: { deductibleFen: 200, reimbursementRateBps: 7500 },
    tertiary: { deductibleFen: 300, reimbursementRateBps: 6500 },
  },
  classBAdvanceRateBps: 1500,
  annualCapFen: 2_000_000,
  retirementBonusBps: 0,
  unfiledOutOfAreaReductionBps: 1500,
  catastrophicTiers: [],
};

describe("offline policy pipeline", () => {
  it("keeps deterministic AI extraction proposals pending human review", async () => {
    const directory = await mkdtemp(join(tmpdir(), "medicare-source-"));
    const sourcePath = join(directory, "policy.json");
    await writeFile(sourcePath, JSON.stringify({
      sourceId: "source-1",
      region: "测试城市",
      sourceUrl: "https://example.test/policy",
      capturedAt: "2026-10-15T00:00:00.000Z",
      proposedPolicy,
    }));

    const source = await new LocalPolicySource().fetch(sourcePath);
    const draft = await new DemoExtractionAdapter().propose(source);

    expect(draft.status).toBe("pending_review");
    expect(draft.demoAIProposal).toBe(true);
    expect(draft.extraction).toEqual({ method: "demo_static", adapterVersion: "1.0.0", aiAssisted: false });
    expect(draft.source.sourceUrl).toBe("https://example.test/policy");
    expect(draft.policy.version).toBe("T-2026.02");
  });

  it("refuses direct publication and writes an Outbox event only with an approved version", async () => {
    const sourceDocument = {
      sourceId: "source-1",
      region: "测试城市",
      sourceUrl: "https://example.test/policy",
      capturedAt: "2026-10-15T00:00:00.000Z",
      proposedPolicy,
    };
    const source = {
      sourceId: "source-capture-1",
      region: "测试城市",
      sourceUrl: "https://example.test/policy",
      capturedAt: "2026-10-15T00:00:00.000Z",
      artifact: { fileName: "policy.json", format: "json" as const, sha256: "a".repeat(64), byteLength: 512 },
      rawDocument: JSON.stringify(sourceDocument),
    };
    const draft = await new DemoExtractionAdapter().propose(source);
    const saved: unknown[] = [];
    const outboxEvents: string[] = [];
    const reviewGateway = new LocalReviewGateway();
    const publisher = new PolicyPublisher({
      store: {
        async publishApprovedVersion({ publication }) {
          saved.push(publication.policy);
          outboxEvents.push(publication.event.eventType);
        },
      },
      reviewGateway,
    });

    await expect(publisher.publish(draft)).rejects.toThrow("审核通过后才能发布政策");
    await expect(reviewGateway.approve(draft, "")).rejects.toThrow("审核人不能为空");

    const approved = await reviewGateway.approve(draft, "policy-reviewer");
    await expect(publisher.publish({ ...approved, approvalId: "forged" })).rejects.toThrow("审核凭证无效");
    const published = await publisher.publish(approved);

    expect(published.status).toBe("published");
    expect(published.policy.version).toBe("T-2026.02");
    expect(saved).toHaveLength(1);
    expect(outboxEvents).toEqual(["policy.published"]);
  });
});
