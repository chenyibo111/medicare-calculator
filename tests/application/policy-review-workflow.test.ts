import { describe, expect, it } from "vitest";
import type { PublishedPolicy } from "../../packages/domain/src/policy.js";
import type { ApprovedPolicyDraft } from "../../packages/application/src/publish-policy.js";
import {
  PolicyReviewWorkflow,
  type OperatorIdentity,
  type PolicyReviewDraft,
  type PolicyReviewStore,
} from "../../packages/application/src/policy-review-workflow.js";

const policy: PublishedPolicy = {
  region: "Compose验收市",
  benefitPlan: "居民医保",
  version: "compose-console-v1",
  effectiveFrom: "2026-10-15",
  sourceReference: "本地评测固定验收政策",
  hospitalRules: {
    community: { deductibleFen: 80_000, reimbursementRateBps: 7_000 },
    secondary: { deductibleFen: 80_000, reimbursementRateBps: 7_000 },
    tertiary: { deductibleFen: 80_000, reimbursementRateBps: 7_000 },
  },
  classBAdvanceRateBps: 2_000,
  annualCapFen: 9_999_999_999,
  retirementBonusBps: 0,
  unfiledOutOfAreaReductionBps: 0,
  catastrophicTiers: [],
};

const author: OperatorIdentity = { id: "author-1", displayName: "政策录入员", roles: ["policy_author"] };
const reviewer: OperatorIdentity = { id: "reviewer-1", displayName: "政策审核员", roles: ["policy_reviewer"] };
const staticDraftCandidate = {
  source: {
    sourceId: "source-1",
    region: policy.region,
    sourceUrl: "https://example.test/compose",
    capturedAt: "2026-10-15T00:00:00.000Z",
    artifact: { fileName: "compose-template.json", format: "json" as const, sha256: "b".repeat(64), byteLength: 512 },
  },
  policy,
  evidence: [],
  extraction: { method: "demo_static" as const, adapterVersion: "1.0.0", aiAssisted: false },
  demoAIProposal: true as const,
};

class InMemoryPolicyReviewStore implements PolicyReviewStore {
  readonly drafts = new Map<string, PolicyReviewDraft>();
  readonly decisions: Array<{ draftId: string; reviewerId: string; decision: "approved" | "rejected"; reason: string }> = [];

  async createDraft(input: PolicyReviewStore["createDraft"] extends (value: infer Value) => unknown ? Value : never) {
    const draft: PolicyReviewDraft = {
      id: input.id,
      status: "draft",
      source: input.source,
      policy: input.policy,
      evidence: input.evidence,
      extraction: input.extraction,
      submittedBy: null,
      submittedAt: null,
      review: null,
    };
    this.drafts.set(draft.id, draft);
    return draft;
  }

  async getDraft(draftId: string) { return this.drafts.get(draftId) ?? null; }
  async listDrafts() { return [...this.drafts.values()]; }

  async submitDraft(input: { draftId: string; submittedBy: string; submittedAt: string }) {
    const draft = this.drafts.get(input.draftId);
    if (draft === undefined || draft.status !== "draft") throw new Error("草稿当前不能提交审核");
    const submitted = { ...draft, status: "pending_review" as const, submittedBy: input.submittedBy, submittedAt: input.submittedAt };
    this.drafts.set(submitted.id, submitted);
    return submitted;
  }

  async decideDraft(input: { draftId: string; reviewerId: string; decision: "approved" | "rejected"; reason: string; reviewedAt: string }) {
    const draft = this.drafts.get(input.draftId);
    if (draft === undefined || draft.status !== "pending_review") throw new Error("草稿当前不能审核");
    const review = { id: `review-${draft.id}`, reviewerId: input.reviewerId, decision: input.decision, reason: input.reason, reviewedAt: input.reviewedAt } as const;
    const decided = { ...draft, status: input.decision, review };
    this.decisions.push({ draftId: input.draftId, reviewerId: input.reviewerId, decision: input.decision, reason: input.reason });
    this.drafts.set(decided.id, decided);
    return decided;
  }

  async getApprovedDraft(draftId: string): Promise<ApprovedPolicyDraft | null> {
    const draft = this.drafts.get(draftId);
    if (draft?.status !== "approved" || draft.review?.decision !== "approved") return null;
    return { ...draft, status: "approved", approvalId: draft.review.id, reviewer: draft.review.reviewerId, approvedAt: draft.review.reviewedAt };
  }
}

describe("PolicyReviewWorkflow", () => {
  it("将受控导入的来源工件、确定性提取方式与字段证据保留在草稿中", async () => {
    const store = new InMemoryPolicyReviewStore();
    const workflow = new PolicyReviewWorkflow({ store, now: () => "2026-10-15T00:00:00.000Z", createId: () => "draft-import-1" });
    const imported = {
      source: {
        sourceId: "source-import-1",
        region: policy.region,
        sourceUrl: "https://example.test/compose/import-v1",
        capturedAt: "2026-10-15T00:00:00.000Z",
        artifact: { fileName: "compose-import-v1.json", format: "json", sha256: "a".repeat(64), byteLength: 2048 },
        rawDocument: "{\"document\":\"not returned to the review store\"}",
      },
      policy,
      extraction: { method: "deterministic_json", adapterVersion: "1.0.0", aiAssisted: false },
      evidence: [{ field: "policy.version", locator: "$.policy.version", excerpt: policy.version, sourceSha256: "a".repeat(64) }],
    };

    const draft = await (workflow as unknown as { createDraft(operator: OperatorIdentity, candidate: typeof imported): Promise<PolicyReviewDraft> }).createDraft(author, imported);

    expect(draft).toMatchObject({
      id: "draft-import-1",
      status: "draft",
      source: {
        sourceId: "source-import-1",
        capturedAt: "2026-10-15T00:00:00.000Z",
        artifact: { fileName: "compose-import-v1.json", sha256: "a".repeat(64) },
      },
      extraction: { method: "deterministic_json", aiAssisted: false },
      evidence: [{ field: "policy.version", locator: "$.policy.version" }],
    });
    expect(JSON.stringify(draft)).not.toContain("not returned to the review store");
  });

  it("只允许政策录入员创建并提交草稿，审核员不能审核自己提交的草稿", async () => {
    const store = new InMemoryPolicyReviewStore();
    const workflow = new PolicyReviewWorkflow({ store, now: () => "2026-10-15T00:00:00.000Z", createId: () => "draft-1" });

    await expect(workflow.createDraft(reviewer, staticDraftCandidate)).rejects.toThrow("没有政策录入权限");
    await workflow.createDraft(author, staticDraftCandidate);
    await workflow.submitDraft(author, "draft-1");

    await expect(workflow.decideDraft({ ...author, roles: ["policy_author", "policy_reviewer"] }, "draft-1", "approved", "规则字段完整")).rejects.toThrow("不能审核自己提交的草稿");
    await workflow.decideDraft(reviewer, "draft-1", "approved", "规则字段完整");

    expect(store.decisions).toEqual([{ draftId: "draft-1", reviewerId: "reviewer-1", decision: "approved", reason: "规则字段完整" }]);
  });

  it("仅将已批准草稿交给既有发布器，并保留审核凭证", async () => {
    const store = new InMemoryPolicyReviewStore();
    const published: ApprovedPolicyDraft[] = [];
    const workflow = new PolicyReviewWorkflow({
      store,
      publisher: {
        async publish(draft) {
          if (draft.status !== "approved") throw new Error("审核通过后才能发布政策");
          published.push(draft);
          return { ...draft, status: "published", publishedAt: "2026-10-15T00:01:00.000Z" };
        },
      },
      now: () => "2026-10-15T00:00:00.000Z",
      createId: () => "draft-2",
    });

    await workflow.createDraft(author, { ...staticDraftCandidate, source: { ...staticDraftCandidate.source, sourceId: "source-2" } });
    await workflow.submitDraft(author, "draft-2");
    await workflow.decideDraft(reviewer, "draft-2", "approved", "验收通过");
    const result = await workflow.publishDraft(reviewer, "draft-2");

    expect(result.status).toBe("published");
    expect(published).toMatchObject([{ id: "draft-2", approvalId: "review-draft-2", reviewer: "reviewer-1" }]);
  });
});
