import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { InMemoryAuditLog } from "../../packages/infrastructure/src/in-memory-audit-log.js";
import { FilePolicyRepository } from "../../packages/infrastructure/src/file-policy-repository.js";
import { TtlPolicyCache } from "../../packages/infrastructure/src/ttl-policy-cache.js";

const publishedPolicy = {
  status: "published",
  region: "测试城市",
  benefitPlan: "居民医保",
  version: "T-2026.01",
  effectiveFrom: "2026-01-01",
  sourceReference: "测试来源",
  hospitalRules: {
    community: { deductibleFen: 100, reimbursementRateBps: 8500 },
    secondary: { deductibleFen: 200, reimbursementRateBps: 7500 },
    tertiary: { deductibleFen: 300, reimbursementRateBps: 6500 },
  },
  classBAdvanceRateBps: 1500,
  annualCapFen: 2_000_000,
  retirementBonusBps: 0,
  unfiledOutOfAreaReductionBps: 1500,
  catastrophicTiers: [],
};

describe("FilePolicyRepository", () => {
  it("returns only published policies effective for the requested date", async () => {
    const directory = await mkdtemp(join(tmpdir(), "medicare-policy-"));
    await writeFile(join(directory, "published.json"), JSON.stringify(publishedPolicy));
    await writeFile(join(directory, "draft.json"), JSON.stringify({ ...publishedPolicy, status: "draft", version: "T-draft" }));
    const repository = new FilePolicyRepository(directory);

    await expect(repository.findPublished({
      region: "测试城市",
      hospitalLevel: "tertiary",
      employmentStatus: "resident",
      calculationDate: "2026-10-14",
    })).resolves.toMatchObject({ version: "T-2026.01" });
    await expect(repository.findPublished({
      region: "测试城市",
      hospitalLevel: "tertiary",
      employmentStatus: "resident",
      calculationDate: "2025-12-31",
    })).resolves.toBeNull();
  });
});

describe("TtlPolicyCache", () => {
  it("reports miss then hit, expires values, and removes entries for an invalidated policy version", async () => {
    let now = 0;
    const cache = new TtlPolicyCache({ ttlMs: 1_000, now: () => now });
    let loads = 0;
    const loadV1 = async () => ({ version: "T-2026.01" });

    await expect(cache.getOrLoad("测试城市:居民医保:2026-10-14", async () => {
      loads += 1;
      return loadV1();
    })).resolves.toMatchObject({ status: "miss" });
    await expect(cache.getOrLoad("测试城市:居民医保:2026-10-14", async () => {
      loads += 1;
      return loadV1();
    })).resolves.toMatchObject({ status: "hit" });
    expect(loads).toBe(1);

    now += 1_001;
    await cache.getOrLoad("测试城市:居民医保:2026-10-14", async () => {
      loads += 1;
      return loadV1();
    });
    expect(loads).toBe(2);

    await cache.invalidateByPolicyVersion("T-2026.02");
    await expect(cache.getOrLoad("测试城市:居民医保:2026-10-14", async () => {
      loads += 1;
      return { version: "T-2026.02" };
    })).resolves.toMatchObject({ status: "miss", value: { version: "T-2026.02" } });
    expect(loads).toBe(3);
  });
});

describe("InMemoryAuditLog", () => {
  it("preserves append-only calculation events", async () => {
    const auditLog = new InMemoryAuditLog();
    await auditLog.append({
      calculationId: "calculation-1",
      region: "测试城市",
      policyVersion: "T-2026.01",
      cacheStatus: "miss",
      createdAt: "2026-10-14T00:00:00.000Z",
    });

    expect(auditLog.readAll()).toEqual([expect.objectContaining({ calculationId: "calculation-1" })]);
  });
});
