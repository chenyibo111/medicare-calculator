import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DeterministicJsonExtractionAdapter } from "../../packages/infrastructure/src/deterministic-json-extraction-adapter.js";
import { LocalPolicySource } from "../../packages/infrastructure/src/local-policy-source.js";

const document = {
  region: "Compose验收市",
  sourceUrl: "https://example.test/compose/import-v1",
  capturedAt: "2026-10-15T00:00:00.000Z",
  policy: {
    region: "Compose验收市",
    benefitPlan: "居民医保",
    version: "compose-import-v1",
    effectiveFrom: "2026-10-15",
    sourceReference: "仓库受控 Compose 导入政策",
    hospitalRules: {
      community: { deductibleFen: 80_000, reimbursementRateBps: 7_000 },
      secondary: { deductibleFen: 80_000, reimbursementRateBps: 7_000 },
      tertiary: { deductibleFen: 80_000, reimbursementRateBps: 7_000 },
    },
    classBAdvanceRateBps: 0,
    annualCapFen: 5_000_000,
    retirementBonusBps: 0,
    unfiledOutOfAreaReductionBps: 0,
    catastrophicTiers: [],
  },
};

async function writeSource(contents: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "medicare-controlled-source-"));
  const path = join(directory, "compose-import-v1.json");
  await writeFile(path, contents, "utf8");
  return path;
}

describe("受控 JSON 政策提取", () => {
  it("基于原始 UTF-8 字节生成来源哈希，任意字节变化均改变哈希", async () => {
    const contents = `${JSON.stringify(document, null, 2)}\n`;
    const changedContents = contents.replace("compose-import-v1", "compose-import-v2");

    const original = await new LocalPolicySource().fetch(await writeSource(contents));
    const changed = await new LocalPolicySource().fetch(await writeSource(changedContents));

    expect(original.artifact).toMatchObject({
      fileName: "compose-import-v1.json",
      format: "json",
      byteLength: Buffer.byteLength(contents),
      sha256: createHash("sha256").update(Buffer.from(contents, "utf8")).digest("hex"),
    });
    expect(changed.artifact.sha256).not.toBe(original.artifact.sha256);
  });

  it("以确定性映射产出完整政策、字段级 JSONPath 证据，且不标记为 AI", async () => {
    const source = await new LocalPolicySource().fetch(await writeSource(`${JSON.stringify(document)}\n`));

    const draft = await new DeterministicJsonExtractionAdapter().propose(source);

    expect(draft.policy).toMatchObject({ region: "Compose验收市", version: "compose-import-v1", annualCapFen: 5_000_000 });
    expect(draft.extraction).toEqual({ method: "deterministic_json", adapterVersion: "1.0.0", aiAssisted: false });
    expect(draft.demoAIProposal).toBeUndefined();
    expect(draft.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "policy.version", locator: "$.policy.version", sourceSha256: source.artifact.sha256 }),
      expect.objectContaining({ field: "policy.hospitalRules.tertiary.reimbursementRateBps", locator: "$.policy.hospitalRules.tertiary.reimbursementRateBps" }),
      expect.objectContaining({ field: "policy.annualCapFen", locator: "$.policy.annualCapFen" }),
    ]));
  });
});
