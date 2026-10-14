import type { ApprovedPolicyDraft, PendingPolicyDraft, PolicyReviewGateway } from "../../application/src/publish-policy.js";
import { randomUUID } from "node:crypto";

export class LocalReviewGateway implements PolicyReviewGateway {
  private readonly approvals = new Map<string, { readonly draftId: string; readonly reviewer: string }>();

  async approve(draft: PendingPolicyDraft, reviewer: string): Promise<ApprovedPolicyDraft> {
    if (reviewer.trim() === "") throw new Error("审核人不能为空");
    const approvalId = randomUUID();
    const normalizedReviewer = reviewer.trim();
    this.approvals.set(approvalId, { draftId: draft.id, reviewer: normalizedReviewer });
    return { ...draft, status: "approved", approvalId, reviewer: normalizedReviewer, approvedAt: new Date().toISOString() };
  }

  async verifyApproved(draft: ApprovedPolicyDraft): Promise<void> {
    const approval = this.approvals.get(draft.approvalId);
    if (approval === undefined || approval.draftId !== draft.id || approval.reviewer !== draft.reviewer || draft.reviewer.trim() === "") {
      throw new Error("审核凭证无效，不能发布政策");
    }
  }
}
