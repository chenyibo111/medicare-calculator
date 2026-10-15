import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const composeEnvironmentFile = ".env";

if (!existsSync(composeEnvironmentFile)) {
  throw new Error("未找到 .env。请先复制 .env.example 为 .env 并设置 POSTGRES_PASSWORD，再运行 pnpm run verify:compose。");
}

async function run(command, args, options = {}) {
  const result = await execFileAsync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    ...options,
  });
  return result.stdout.trim();
}

function docker(args) {
  return run("docker", args);
}

function compose(args) {
  return docker(["compose", "--env-file", composeEnvironmentFile, ...args]);
}

try {
  await docker(["info"]);
} catch {
  throw new Error("Docker Desktop 未启动或当前终端无权访问。请启动 Docker Desktop 后重试 pnpm run verify:compose。");
}

try {
  await compose(["up", "--build", "-d"]);
  await run(process.execPath, ["scripts/compose-smoke.mjs"]);
  console.info("Compose 验收通过：迁移、种子、Redis 命中与 PostgreSQL 审计均已验证。");
} catch (error) {
  try {
    const logs = await compose(["logs", "--tail", "120"]);
    console.error(`Compose 验收失败，最近服务日志：\n${logs}`);
  } catch {
    console.error("Compose 验收失败，且无法读取服务日志。");
  }
  throw error;
} finally {
  await compose(["stop"]);
}
