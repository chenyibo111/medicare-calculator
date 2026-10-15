import { randomUUID } from "node:crypto";
import type {
  ApprovedPolicyDraft,
  PendingPolicyDraft,
  PolicyDraftCandidate,
  PolicyDraftSource,
  PolicyPublisher,
  PublishedPolicyDraft,
} from "./publish-policy.js";

export type PolicyOperatorRole = "policy_author" | "policy_reviewer";
export type PolicyDraftStatus = "draft" | "pending_review" | "approved" | "rejected" | "published";
export type PolicyReviewDecision = "approved" | "rejected";

export interface OperatorIdentity {
  readonly id: string;
  readonly displayName: string;
  readonly roles: readonly PolicyOperatorRole[];
}

export interface OperatorIdentityProvider {
  getCurrentOperator(): Promise<OperatorIdentity | null>;
}

export interface PolicyDraftReview {
  readonly id: string;
  readonly reviewerId: string;
  readonly decision: PolicyReviewDecision;
  readonly reason: string | null;
  readonly reviewedAt: string;
}

export interface PolicyReviewDraft extends Omit<PendingPolicyDraft, "status"> {
  readonly status: PolicyDraftStatus;
  readonly submittedBy: string | null;
  readonly submittedAt: string | null;
  readonly review: PolicyDraftReview | null;
}

export interface PolicyReviewStore {
  createDraft(input: {
    readonly id: string;
    readonly source: PolicyDraftSource;
    readonly policy: PolicyDraftCandidate["policy"];
    readonly evidence: PolicyDraftCandidate["evidence"];
    readonly extraction: PolicyDraftCandidate["extraction"];
    readonly demoAIProposal?: true;
    readonly createdAt: string;
  }): Promise<PolicyReviewDraft>;
  getDraft(draftId: string): Promise<PolicyReviewDraft | null>;
  listDrafts(): Promise<readonly PolicyReviewDraft[]>;
  submitDraft(input: { readonly draftId: string; readonly submittedBy: string; readonly submittedAt: string }): Promise<PolicyReviewDraft>;
  decideDraft(input: {
    readonly draftId: string;
    readonly reviewerId: string;
    readonly decision: PolicyReviewDecision;
    readonly reason: string;
    readonly reviewedAt: string;
  }): Promise<PolicyReviewDraft>;
  getApprovedDraft(draftId: string): Promise<ApprovedPolicyDraft | null>;
}

function hasRole(operator: OperatorIdentity, role: PolicyOperatorRole): boolean {
  return operator.roles.includes(role);
}

function sourceForReview(source: PolicyDraftCandidate["source"]): PolicyDraftSource {
  const { rawDocument: _rawDocument, ...reviewSource } = source as PolicyDraftCandidate["source"] & { rawDocument?: unknown };
  return reviewSource;
}

export class PolicyReviewWorkflow {
  constructor(
    private readonly dependencies: {
      readonly store: PolicyReviewStore;
      readonly publisher?: Pick<PolicyPublisher, "publish">;
      readonly now?: () => string;
      readonly createId?: () => string;
    },
  ) {}

  async createDraft(
    operator: OperatorIdentity,
    candidate: PolicyDraftCandidate,
  ): Promise<PolicyReviewDraft> {
    this.requireRole(operator, "policy_author", "没有政策录入权限");
    if (candidate.source.region !== candidate.policy.region) throw new Error("政策来源地区与政策规则地区不一致");
    return this.dependencies.store.createDraft({
      id: (this.dependencies.createId ?? randomUUID)(),
      source: sourceForReview(candidate.source),
      policy: candidate.policy,
      evidence: candidate.evidence,
      extraction: candidate.extraction,
      demoAIProposal: candidate.demoAIProposal,
      createdAt: this.now(),
    });
  }

  async submitDraft(operator: OperatorIdentity, draftId: string): Promise<PolicyReviewDraft> {
    this.requireRole(operator, "policy_author", "没有政策录入权限");
    return this.dependencies.store.submitDraft({ draftId, submittedBy: operator.id, submittedAt: this.now() });
  }

  async decideDraft(
    operator: OperatorIdentity,
    draftId: string,
    decision: PolicyReviewDecision,
    reason: string,
  ): Promise<PolicyReviewDraft> {
    this.requireRole(operator, "policy_reviewer", "没有政策审核权限");
    const draft = await this.dependencies.store.getDraft(draftId);
    if (draft === null) throw new Error("审核草稿不存在");
    if (draft.submittedBy === operator.id) throw new Error("不能审核自己提交的草稿");
    if (reason.trim() === "") throw new Error("审核意见不能为空");
    return this.dependencies.store.decideDraft({
      draftId,
      reviewerId: operator.id,
      decision,
      reason: reason.trim(),
      reviewedAt: this.now(),
    });
  }

  async publishDraft(operator: OperatorIdentity, draftId: string): Promise<PublishedPolicyDraft> {
    this.requireRole(operator, "policy_reviewer", "没有政策发布权限");
    const approvedDraft = await this.dependencies.store.getApprovedDraft(draftId);
    if (approvedDraft === null) throw new Error("审核通过后才能发布政策");
    if (this.dependencies.publisher === undefined) throw new Error("未配置政策发布器");
    return this.dependencies.publisher.publish(approvedDraft);
  }

  private requireRole(operator: OperatorIdentity, role: PolicyOperatorRole, message: string): void {
    if (!hasRole(operator, role)) throw new Error(message);
  }

  private now(): string {
    return (this.dependencies.now ?? (() => new Date().toISOString()))();
  }
}
