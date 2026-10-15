import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("assessor README", () => {
  it("documents both run modes, verification, limitations and evolution materials", async () => {
    const readme = await readFile("README.md", "utf8");
    expect(readme).toContain("build:offline");
    expect(readme).toContain("apps/offline-demo/dist/index.html");
    expect(readme).toContain("dev:service");
    expect(readme).toContain("worker:demo");
    expect(readme).toContain("policy-worker");
    expect(readme).toContain("compose:publish-acceptance-policy");
    expect(readme).toContain("本地开发/评测入口");
    expect(readme).toContain("verify");
    expect(readme).toContain("示例政策，仅供演示");
    expect(readme).toContain("MVP 与生产版本差异");
    expect(readme).toContain("docs/architecture.md");
  });
});
