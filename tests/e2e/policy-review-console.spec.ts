import { expect, test } from "@playwright/test";

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
});
