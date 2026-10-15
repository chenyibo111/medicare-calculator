import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));

function composeConfig(): Record<string, unknown> {
  const result = spawnSync(
    "docker",
    ["compose", "--env-file", ".env.example", "config", "--format", "json"],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        POSTGRES_PASSWORD: "contract-test-only-secret",
      },
    },
  );

  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

describe("Compose 运行契约", () => {
  it("以健康检查的 PostgreSQL、Redis 和服务版解析运行配置", () => {
    expect(existsSync(resolve(root, "docker-compose.yml"))).toBe(true);

    const config = composeConfig() as {
      services: Record<
        string,
        {
          image?: string;
          depends_on?: Record<string, { condition?: string }>;
          environment?: Record<string, string>;
          healthcheck?: unknown;
          restart?: string;
          command?: string[];
        }
      >;
      volumes?: Record<string, unknown>;
    };

    expect(Object.keys(config.services).sort()).toEqual([
      "policy-worker",
      "postgres",
      "redis",
      "service-web",
    ]);
    expect(config.services.postgres.image).toBe("postgres:16-alpine");
    expect(config.services.redis.image).toBe("redis:7-alpine");
    expect(config.services.postgres.healthcheck).toBeDefined();
    expect(config.services.redis.healthcheck).toBeDefined();
    expect(config.services["service-web"].depends_on).toMatchObject({
      postgres: { condition: "service_healthy" },
      redis: { condition: "service_healthy" },
    });
    expect(config.services["service-web"].environment).toMatchObject({
      MEDICARE_RUNTIME: "compose",
      MEDICARE_ADMIN_CONSOLE: "false",
      DATABASE_URL: expect.stringContaining("postgres://"),
      REDIS_URL: expect.stringContaining("redis://"),
    });
    expect(config.services["policy-worker"].environment).not.toHaveProperty("MEDICARE_ADMIN_CONSOLE");
    expect(config.services["policy-worker"]).toMatchObject({
      restart: "unless-stopped",
      command: ["pnpm", "run", "worker:outbox"],
      depends_on: {
        postgres: { condition: "service_healthy" },
        redis: { condition: "service_healthy" },
      },
      environment: {
        MEDICARE_RUNTIME: "compose",
        DATABASE_URL: expect.stringContaining("postgres://"),
        REDIS_URL: expect.stringContaining("redis://"),
      },
    });
    expect(config.volumes).toMatchObject({
      medicare_postgres_data: {},
      medicare_redis_data: {},
    });
  });

  it("要求本地密钥，且 Git 不会跟踪 .env", () => {
    const envExamplePath = resolve(root, ".env.example");
    expect(existsSync(envExamplePath)).toBe(true);

    const uncommentedPassword = readFileSync(envExamplePath, "utf8")
      .split(/\r?\n/)
      .find((line) => /^POSTGRES_PASSWORD=\S+/.test(line));
    expect(uncommentedPassword).toBeUndefined();

    const ignored = spawnSync("git", ["check-ignore", "--quiet", ".env"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(ignored.status).toBe(0);
  });

  it("使用兼容仓库 pnpm 版本的 Node 22 基础镜像", () => {
    const dockerfile = readFileSync(
      resolve(root, "apps/service-web/Dockerfile"),
      "utf8",
    );

    expect(dockerfile).toMatch(/^FROM node:22-alpine$/m);
  });

  it("从 scripts 目录定位迁移与种子脚本", () => {
    const launcher = readFileSync(
      resolve(root, "scripts/compose-service.mjs"),
      "utf8",
    );

    expect(launcher).toContain('const root = new URL("./", import.meta.url);');
  });

  it("服务包提供镜像所需的生产启动命令", () => {
    const servicePackage = JSON.parse(
      readFileSync(resolve(root, "apps/service-web/package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(servicePackage.scripts?.start).toBe("next start");
  });
});
