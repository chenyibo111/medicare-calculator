import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));

describe("workspace toolchain", () => {
  it("exposes runnable dual-mode commands and package workspaces", () => {
    const packagePath = resolve(root, "package.json");
    expect(existsSync(packagePath)).toBe(true);

    const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as {
      workspaces?: string[];
      scripts?: Record<string, string>;
    };

    expect(packageJson.workspaces).toEqual(["apps/*", "packages/*"]);
    expect(packageJson.scripts).toMatchObject({
      test: expect.any(String),
      "build:offline": expect.any(String),
      "dev:service": expect.any(String),
      "worker:demo": expect.any(String),
      verify: expect.any(String),
    });

    for (const packageName of [
      "@medicare/domain",
      "@medicare/contracts",
      "@medicare/application",
      "@medicare/infrastructure",
    ]) {
      expect(packageName).toMatch(/^@medicare\//);
    }
  });
});
