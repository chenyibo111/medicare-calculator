import type { PolicyCache } from "./ports.js";
import type { PublishedPolicy } from "../../domain/src/policy.js";

export interface RawPolicySource {
  readonly sourceId: string;
  readonly region: string;
  readonly sourceUrl: string;
  readonly proposedPolicy: PublishedPolicy;
}

export interface PendingPolicyDraft {
  readonly id: string;
  readonly status: "pending_review";
  readonly demoAIProposal: true;
  readonly source: Pick<RawPolicySource, "sourceId" | "region" | "sourceUrl">;
  readonly policy: PublishedPolicy;
}

export interface ApprovedPolicyDraft extends Omit<PendingPolicyDraft, "status"> {
  readonly status: "approved";
  readonly approvalId: string;
  readonly reviewer: string;
  readonly approvedAt: string;
}

export interface PublishedPolicyDraft extends Omit<ApprovedPolicyDraft, "status"> {
  readonly status: "published";
  readonly publishedAt: string;
}

export interface PolicySourceConnector { fetch(sourceConfig: string): Promise<RawPolicySource>; }
export interface PolicyExtractionAdapter { propose(rawSource: RawPolicySource): Promise<PendingPolicyDraft>; }
export interface PolicyReviewGateway {
  approve(draft: PendingPolicyDraft, reviewer: string): Promise<ApprovedPolicyDraft>;
  verifyApproved(draft: ApprovedPolicyDraft): Promise<void>;
}
export interface PublishedPolicyStore { savePublished(policy: PublishedPolicy & { readonly status: "published" }): Promise<void>; }

export class PolicyPublisher {
  constructor(private readonly dependencies: { readonly store: PublishedPolicyStore; readonly cache: PolicyCache; readonly reviewGateway: PolicyReviewGateway }) {}

  async publish(draft: PendingPolicyDraft | ApprovedPolicyDraft): Promise<PublishedPolicyDraft> {
    if (draft.status !== "approved") throw new Error("审核通过后才能发布政策");
    await this.dependencies.reviewGateway.verifyApproved(draft);
    await this.dependencies.store.savePublished({ ...draft.policy, status: "published" });
    await this.dependencies.cache.invalidateByPolicyVersion(draft.policy.version);
    return { ...draft, status: "published", publishedAt: new Date().toISOString() };
  }
}
