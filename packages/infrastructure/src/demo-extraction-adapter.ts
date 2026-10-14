import type { PendingPolicyDraft, PolicyExtractionAdapter, RawPolicySource } from "../../application/src/publish-policy.js";

export class DemoExtractionAdapter implements PolicyExtractionAdapter {
  async propose(rawSource: RawPolicySource): Promise<PendingPolicyDraft> {
    return {
      id: `draft-${rawSource.sourceId}-${rawSource.proposedPolicy.version}`,
      status: "pending_review",
      demoAIProposal: true,
      source: { sourceId: rawSource.sourceId, region: rawSource.region, sourceUrl: rawSource.sourceUrl },
      policy: rawSource.proposedPolicy,
    };
  }
}
