import { describe, expect, it } from "vitest";
import {
  importControlledPolicySource,
  listControlledPolicySources,
} from "../../apps/service-web/server/controlled-policy-import.js";
import type { PolicyDraftCandidate } from "../../packages/application/src/publish-policy.js";
import type { OperatorIdentity } from "../../packages/application/src/policy-review-workflow.js";

const author: OperatorIdentity = { id: "author-1", displayName: "政策录入员", roles: ["policy_author"] };

describe("受控政策源导入", () => {
  it("仅暴露不含文件路径和原文的白名单条目", () => {
    expect(listControlledPolicySources()).toEqual([{
      key: "compose-import-v1",
      label: "Compose 验收导入政策 v1",
      region: "Compose验收市",
      sourceUrl: "https://example.test/compose/import-v1",
    }]);
    expect(JSON.stringify(listControlledPolicySources())).not.toContain("raw-policy-sources");
  });

  it("只允许录入员从服务器白名单导入，未知来源不会触碰文件系统", async () => {
    const captured: unknown[] = [];
    const workflow = {
      async createDraft(operator: OperatorIdentity, candidate: PolicyDraftCandidate) {
        captured.push({ operator, candidate });
        return { id: "draft-import-1", status: "draft" as const, ...candidate, submittedBy: null, submittedAt: null, review: null };
      },
    };

    await expect(importControlledPolicySource({ sourceKey: "missing", operator: author, workflow })).rejects.toThrow("不支持的受控政策源");
    await expect(importControlledPolicySource({ sourceKey: "compose-import-v1", operator: author, workflow })).resolves.toMatchObject({ id: "draft-import-1" });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      operator: author,
      candidate: {
        source: { artifact: { fileName: "compose-import-v1.json" } },
        extraction: { method: "deterministic_json", aiAssisted: false },
      },
    });
    expect(JSON.stringify(captured[0])).not.toContain("rawDocument");
  });
});
