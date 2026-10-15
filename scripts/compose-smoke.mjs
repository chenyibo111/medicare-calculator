import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const environmentFile = ".env";

if (!existsSync(environmentFile)) {
  throw new Error("未找到 .env，无法执行 Compose smoke 验收。");
}

function readEnvironment() {
  return Object.fromEntries(
    readFileSync(environmentFile, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

const environment = readEnvironment();

async function docker(args) {
  const result = await execFileAsync("docker", args, {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  return result.stdout.trim();
}

function compose(args) {
  return docker(["compose", "--env-file", environmentFile, ...args]);
}

const payload = {
  region: "城市B",
  hospitalLevel: "tertiary",
  employmentStatus: "resident",
  totalAmountFen: 6_000_000,
  outOfCatalogAmountFen: 200_000,
  classBAmountFen: 1_000_000,
  annualReimbursedAmountFen: 0,
  outOfAreaFiled: true,
};

const calculationDate = new Date().toISOString().slice(0, 10);
const cacheKey = `城市B:resident:${calculationDate}`;
await compose(["exec", "-T", "redis", "redis-cli", "DEL", cacheKey]);

async function calculateWhenReady() {
  const endpoint = `http://127.0.0.1:${environment.SERVICE_WEB_PORT ?? "3010"}/api/v1/reimbursement-calculations`;
  let lastError;
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(`API 返回 ${response.status}：${JSON.stringify(body)}`);
      return body;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  throw new Error(`服务版在 30 秒内未就绪：${lastError instanceof Error ? lastError.message : "未知错误"}`);
}

const first = await calculateWhenReady();
const second = await calculateWhenReady();

if (first.cacheStatus !== "miss" || second.cacheStatus !== "hit") {
  throw new Error(`缓存验收失败：首次=${first.cacheStatus}，再次=${second.cacheStatus}`);
}
if (first.result?.estimatedSelfPayFen !== 2_366_500) {
  throw new Error(`金额验收失败：预计自费=${first.result?.estimatedSelfPayFen}`);
}

const auditRows = await compose([
  "exec", "-T", "postgres", "psql", "-U", environment.POSTGRES_USER ?? "medicare_app",
  "-d", environment.POSTGRES_DB ?? "medicare_demo", "-tAc",
  `SELECT cache_status FROM calculation_audit_events WHERE calculation_id IN ('${first.calculationId}', '${second.calculationId}') ORDER BY cache_status`,
]);

if (auditRows.split(/\r?\n/).sort().join(",") !== "hit,miss") {
  throw new Error(`审计验收失败：未找到本次两条 cacheStatus 审计记录，实际为 ${auditRows || "空"}`);
}

console.info(`Compose smoke 通过：${first.policyVersion}，首次 miss、再次 hit，审计记录已写入 PostgreSQL。`);
