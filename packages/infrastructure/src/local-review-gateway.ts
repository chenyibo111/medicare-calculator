import type { ApprovedPolicyDraft, PendingPolicyDraft, PolicyReviewGateway } from "../../application/src/publish-policy.js";

export class LocalReviewGateway implements PolicyReviewGateway {
  async approve(draft: PendingPolicyDraft, reviewer: string): Promise<ApprovedPolicyDraft> {
    if (reviewer.trim() === "") throw new Error("审核人不能为空");
    return { ...draft, status: "approved", reviewer: reviewer.trim(), approvedAt: new Date().toISOString() };
  }
}
