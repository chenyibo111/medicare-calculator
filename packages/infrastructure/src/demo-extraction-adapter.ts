import type { CapturedPolicySource, PendingPolicyDraft, PolicyExtractionAdapter, RawPolicySource } from "../../application/src/publish-policy.js";

export class DemoExtractionAdapter implements PolicyExtractionAdapter {
  async propose(rawSource: CapturedPolicySource): Promise<PendingPolicyDraft> {
    const document = JSON.parse(rawSource.rawDocument) as RawPolicySource;
    if (document.proposedPolicy === undefined) throw new Error("离线演示政策源缺少 proposedPolicy");
    return {
      id: `draft-${rawSource.sourceId}-${document.proposedPolicy.version}`,
      status: "pending_review",
      demoAIProposal: true,
      source: { sourceId: rawSource.sourceId, region: rawSource.region, sourceUrl: rawSource.sourceUrl, capturedAt: rawSource.capturedAt, artifact: rawSource.artifact },
      policy: document.proposedPolicy,
      evidence: [],
      extraction: { method: "demo_static", adapterVersion: "1.0.0", aiAssisted: false },
    };
  }
}
