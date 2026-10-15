import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));

describe("Compose 可复跑验收入口", () => {
  it("提供不删除命名卷的真实依赖 smoke 验证", () => {
    const verifierPath = resolve(root, "scripts/verify-compose.mjs");
    const smokePath = resolve(root, "scripts/compose-smoke.mjs");
    const rootPackage = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(existsSync(verifierPath)).toBe(true);
    expect(existsSync(smokePath)).toBe(true);
    expect(rootPackage.scripts?.["verify:compose"]).toBe("node scripts/verify-compose.mjs");

    const verifier = readFileSync(verifierPath, "utf8");
    const smoke = readFileSync(smokePath, "utf8");
    expect(verifier).toContain('"up", "--build", "-d"');
    expect(verifier).toContain('"stop"');
    expect(verifier).not.toContain('"down", "--volumes"');
    expect(verifier).toContain('await run(process.execPath, ["scripts/compose-smoke.mjs"]);');
    expect(verifier).toContain('"policy-worker"');
    expect(smoke).toContain("compose:publish-acceptance-policy");
    expect(smoke).toContain("policy_outbox_events");
    expect(smoke).toContain("processed_at");
    expect(smoke).toContain("policyVersion");
    expect(smoke).toContain("policy:version:compose-e2e-v1:keys");
    expect(smoke).toContain("miss");
    expect(smoke).toContain("hit");
    expect(smoke).toContain("calculation_audit_events");
  });
});
