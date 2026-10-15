import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const environmentFile = ".env";
const acceptanceRegion = "Compose验收市";
const acceptanceVersion = { v1: "compose-e2e-v1", v2: "compose-e2e-v2" };
const calculationDate = new Date().toISOString().slice(0, 10);

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

async function postgres(sql) {
  return compose([
    "exec", "-T", "postgres", "psql", "-U", environment.POSTGRES_USER ?? "medicare_app",
    "-d", environment.POSTGRES_DB ?? "medicare_demo", "-tAc", sql,
  ]);
}

async function resetAcceptanceData() {
  await postgres(`DELETE FROM calculation_audit_events WHERE policy_version_id IN (SELECT id FROM policy_versions WHERE region = '${acceptanceRegion}')`);
  await postgres(`DELETE FROM policy_outbox_events WHERE payload->>'region' = '${acceptanceRegion}'`);
  await postgres(`DELETE FROM policy_reviews WHERE draft_id IN (SELECT id FROM policy_drafts WHERE source_id IN (SELECT id FROM policy_sources WHERE region = '${acceptanceRegion}'))`);
  await postgres(`DELETE FROM policy_drafts WHERE source_id IN (SELECT id FROM policy_sources WHERE region = '${acceptanceRegion}')`);
  await postgres(`DELETE FROM policy_versions WHERE region = '${acceptanceRegion}'`);
  await postgres(`DELETE FROM policy_sources WHERE region = '${acceptanceRegion}'`);
  await compose([
    "exec", "-T", "redis", "redis-cli", "DEL",
    `${acceptanceRegion}:resident:${calculationDate}`,
    "policy:version:compose-e2e-v1:keys",
    "policy:version:compose-e2e-v2:keys",
  ]);
}

const payload = {
  region: acceptanceRegion,
  hospitalLevel: "tertiary",
  employmentStatus: "resident",
  totalAmountFen: 2_000_000,
  outOfCatalogAmountFen: 100_000,
  classBAmountFen: 200_000,
  annualReimbursedAmountFen: 0,
  outOfAreaFiled: true,
};

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

async function publish(version) {
  const output = await compose([
    "exec", "-T", "policy-worker", "pnpm", "run", "compose:publish-acceptance-policy", "--", "--version", version,
  ]);
  const receipt = JSON.parse(output);
  if (receipt.version !== acceptanceVersion[version] || receipt.status !== "published") {
    throw new Error(`验收政策发布失败：${output}`);
  }
}

async function waitForProcessedEvent(version) {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const processed = await postgres(
      `SELECT processed_at IS NOT NULL FROM policy_outbox_events WHERE payload->>'newPolicyVersion' = '${version}' ORDER BY created_at DESC LIMIT 1`,
    );
    if (processed === "t") return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Worker 未在 30 秒内处理 Outbox 事件：${version}`);
}

await resetAcceptanceData();
await publish("v1");
await waitForProcessedEvent(acceptanceVersion.v1);
const beforePublication = await calculateWhenReady();
if (beforePublication.policyVersion !== acceptanceVersion.v1) {
  throw new Error(`发布前政策版本错误：${beforePublication.policyVersion}`);
}

await publish("v2");
await waitForProcessedEvent(acceptanceVersion.v2);
const afterPublication = await calculateWhenReady();
if (afterPublication.policyVersion !== acceptanceVersion.v2) {
  throw new Error(`发布后 API 未切换到新版本：${afterPublication.policyVersion}`);
}

await compose(["exec", "-T", "redis", "redis-cli", "DEL", `${acceptanceRegion}:resident:${calculationDate}`]);
const first = await calculateWhenReady();
const second = await calculateWhenReady();

if (first.policyVersion !== acceptanceVersion.v2 || second.policyVersion !== acceptanceVersion.v2) {
  throw new Error(`缓存验收读取了错误版本：首次=${first.policyVersion}，再次=${second.policyVersion}`);
}
if (first.cacheStatus !== "miss" || second.cacheStatus !== "hit") {
  throw new Error(`缓存验收失败：首次=${first.cacheStatus}，再次=${second.cacheStatus}`);
}

const auditRows = await postgres(
  `SELECT cache_status FROM calculation_audit_events WHERE calculation_id IN ('${first.calculationId}', '${second.calculationId}') ORDER BY cache_status`,
);
if (auditRows.split(/\r?\n/).sort().join(",") !== "hit,miss") {
  throw new Error(`审计验收失败：未找到本次两条 cacheStatus 审计记录，实际为 ${auditRows || "空"}`);
}

console.info(`Compose smoke 通过：${beforePublication.policyVersion} → ${afterPublication.policyVersion}，Worker 已处理 Outbox；清理新版本缓存后首次 miss、再次 hit，审计记录已写入 PostgreSQL。`);
