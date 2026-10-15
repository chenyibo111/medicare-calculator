import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PolicyReviewWorkflow, OperatorIdentity } from "../../../packages/application/src/policy-review-workflow.js";
import { DeterministicJsonExtractionAdapter } from "../../../packages/infrastructure/src/deterministic-json-extraction-adapter.js";
import { LocalPolicySource } from "../../../packages/infrastructure/src/local-policy-source.js";

const repositoryRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const sourceDirectory = resolve(repositoryRoot, "data/raw-policy-sources");
const controlledSources = [{
  key: "compose-import-v1",
  label: "Compose 验收导入政策 v1",
  region: "Compose验收市",
  sourceUrl: "https://example.test/compose/import-v1",
  fileName: "compose-import-v1.json",
}] as const;

export function listControlledPolicySources() {
  return controlledSources.map(({ key, label, region, sourceUrl }) => ({ key, label, region, sourceUrl }));
}

export async function importControlledPolicySource(input: {
  readonly sourceKey: string;
  readonly operator: OperatorIdentity;
  readonly workflow: Pick<PolicyReviewWorkflow, "createDraft">;
}) {
  const selected = controlledSources.find((source) => source.key === input.sourceKey);
  if (selected === undefined) throw new Error("不支持的受控政策源");
  const path = resolve(sourceDirectory, selected.fileName);
  const relativePath = relative(sourceDirectory, path);
  if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) throw new Error("受控政策源路径无效");
  const captured = await new LocalPolicySource().fetch(path);
  const extracted = await new DeterministicJsonExtractionAdapter().propose(captured);
  return input.workflow.createDraft(input.operator, {
    source: extracted.source,
    policy: extracted.policy,
    evidence: extracted.evidence,
    extraction: extracted.extraction,
  });
}
