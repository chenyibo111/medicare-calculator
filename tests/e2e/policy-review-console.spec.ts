import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const composeRequest = {
  region: "Compose验收市", hospitalLevel: "tertiary", employmentStatus: "resident",
  totalAmountFen: 2_000_000, outOfCatalogAmountFen: 100_000, classBAmountFen: 200_000,
  annualReimbursedAmountFen: 0, outOfAreaFiled: true,
};

function composeValue(key: string): string {
  const line = readFileSync(".env", "utf8").split(/\r?\n/).find((value) => value.startsWith(`${key}=`));
  if (line === undefined) throw new Error(`.env 缺少 ${key}`);
  return line.slice(key.length + 1);
}

function outboxProcessed(version: string): boolean {
  if (!/^compose-console-v1-[a-f0-9]{8}$/.test(version)) throw new Error("验收版本格式无效");
  const query = `SELECT processed_at IS NOT NULL FROM policy_outbox_events WHERE payload->>'newPolicyVersion' = '${version}'`;
  const output = execFileSync("docker", ["compose", "--env-file", ".env", "exec", "-T", "postgres", "psql", "-U", composeValue("POSTGRES_USER"), "-d", composeValue("POSTGRES_DB"), "-tAc", query], { encoding: "utf8" }).trim();
  return output === "t";
}

test("本地评测后台以异人审核发布唯一 Compose 政策", async ({ page }) => {
  await page.goto("/admin/policy-review");
  await expect(page.getByText("本地评测后台")).toBeVisible();

  await page.getByLabel("切换本地评测身份").selectOption("policy-author");
  await page.getByTestId("create-compose-v1").click();
  const newDraft = page.getByTestId("policy-review-draft").filter({ hasText: "草稿" }).first();
  const version = await newDraft.getByRole("heading").textContent();
  expect(version).toMatch(/^compose-console-v1-[a-f0-9]{8}$/);
  const draft = page.getByTestId("policy-review-draft").filter({ hasText: version! });
  await expect(draft).toContainText("草稿");
  await draft.getByRole("button", { name: "提交审核" }).click();
  await expect(draft).toContainText("待审核");

  await page.getByLabel("切换本地评测身份").selectOption("policy-reviewer");
  await draft.getByLabel("审核意见").fill("自动化验收：规则字段与来源已核对");
  await draft.getByRole("button", { name: "批准草稿" }).click();
  await expect(draft).toContainText("已批准");
  await draft.getByRole("button", { name: "发布政策并写入 Outbox" }).click();
  await expect(draft).toContainText("已发布");
  await expect(draft).toContainText(/compose-console-v1-/);
  await expect.poll(() => outboxProcessed(version!), { timeout: 15_000, intervals: [250, 500, 1_000] }).toBe(true);

  const first = await page.request.post("/api/v1/reimbursement-calculations", { data: composeRequest });
  expect(first.ok()).toBe(true);
  expect((await first.json()).policyVersion).toBe(version);
  const second = await page.request.post("/api/v1/reimbursement-calculations", { data: composeRequest });
  expect((await second.json())).toMatchObject({ policyVersion: version, cacheStatus: "hit" });
});
