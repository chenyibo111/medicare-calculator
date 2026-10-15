import type { PublishedPolicy } from "../../domain/src/policy.js";

export interface RawPolicySource {
  readonly sourceId: string;
  readonly region: string;
  readonly sourceUrl: string;
  readonly proposedPolicy: PublishedPolicy;
}

export interface SourceArtifact {
  readonly fileName: string;
  readonly format: "json";
  readonly sha256: string;
  readonly byteLength: number;
}

export interface CapturedPolicySource {
  readonly sourceId: string;
  readonly region: string;
  readonly sourceUrl: string;
  readonly capturedAt: string;
  readonly artifact: SourceArtifact;
  readonly rawDocument: string;
}

export type PolicyDraftSource = Omit<CapturedPolicySource, "rawDocument">;

export interface PolicyEvidence {
  readonly field: string;
  readonly locator: string;
  readonly excerpt: string;
  readonly sourceSha256: string;
}

export interface PolicyExtractionMetadata {
  readonly method: "demo_static" | "deterministic_json" | "ocr_llm";
  readonly adapterVersion: string;
  readonly aiAssisted: boolean;
}

export interface PolicyDraftCandidate {
  readonly source: PolicyDraftSource;
  readonly policy: PublishedPolicy;
  readonly evidence: readonly PolicyEvidence[];
  readonly extraction: PolicyExtractionMetadata;
  readonly demoAIProposal?: true;
}

export interface PendingPolicyDraft extends PolicyDraftCandidate {
  readonly id: string;
  readonly status: "pending_review";
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

export interface PolicySourceConnector { fetch(sourceConfig: string): Promise<CapturedPolicySource>; }
export interface PolicyExtractionAdapter { propose(rawSource: CapturedPolicySource): Promise<PendingPolicyDraft>; }
export interface PolicyReviewGateway {
  approve(draft: PendingPolicyDraft, reviewer: string): Promise<ApprovedPolicyDraft>;
  verifyApproved(draft: ApprovedPolicyDraft): Promise<void>;
}
export interface PublishedPolicyVersion extends PublishedPolicy {
  readonly status: "published";
}

export interface PolicyPublishedEvent {
  readonly eventType: "policy.published";
  readonly region: string;
  readonly benefitPlan: PublishedPolicy["benefitPlan"];
  readonly newPolicyVersion: string;
  readonly previousPolicyVersion: string | null;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
}

export interface PolicyPublicationStore {
  publishApprovedVersion(input: {
    readonly approvedDraft: ApprovedPolicyDraft;
    readonly publication: {
      readonly policy: PublishedPolicyVersion;
      readonly event: PolicyPublishedEvent;
    };
  }): Promise<void>;
}

export class PolicyPublisher {
  constructor(
    private readonly dependencies: {
      readonly store: PolicyPublicationStore;
      readonly reviewGateway: PolicyReviewGateway;
      readonly now?: () => string;
    },
  ) {}

  async publish(draft: PendingPolicyDraft | ApprovedPolicyDraft): Promise<PublishedPolicyDraft> {
    if (draft.status !== "approved") throw new Error("审核通过后才能发布政策");
    await this.dependencies.reviewGateway.verifyApproved(draft);
    const policy: PublishedPolicyVersion = { ...draft.policy, status: "published" };
    await this.dependencies.store.publishApprovedVersion({
      approvedDraft: draft,
      publication: {
        policy,
        event: {
          eventType: "policy.published",
          region: policy.region,
          benefitPlan: policy.benefitPlan,
          newPolicyVersion: policy.version,
          previousPolicyVersion: null,
          effectiveFrom: policy.effectiveFrom,
          effectiveTo: policy.effectiveTo ?? null,
        },
      },
    });
    return {
      ...draft,
      status: "published",
      publishedAt: (this.dependencies.now ?? (() => new Date().toISOString()))(),
    };
  }
}
