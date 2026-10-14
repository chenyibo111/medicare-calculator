import { expect, test } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const offlinePage = pathToFileURL(resolve("apps/offline-demo/dist/index.html")).href;

test.describe("离线演示版", () => {
  test("提示示例政策、填充城市 A 样例，并在本地展示精确结果与计算明细", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    await page.goto(offlinePage);

    await expect(page.getByText("示例政策，仅供演示")).toBeVisible();
    await page.getByTestId("sample-city-a").click();
    await page.getByRole("button", { name: "开始测算" }).click();

    await expect(page.getByTestId("estimated-self-pay")).toHaveText("¥25,440.00");
    await expect(page.getByText("乙类先行自付")).toBeVisible();
    await expect(page.getByText("A-2026.01")).toBeVisible();
    expect(requests.some((url) => url.includes("/api/"))).toBe(false);
  });

  test("在字段旁给出可恢复的金额错误", async ({ page }) => {
    await page.goto(offlinePage);
    await page.getByLabel("总医疗费用（元）").fill("-1");
    await page.getByRole("button", { name: "开始测算" }).click();

    await expect(page.getByTestId("totalAmount-error")).toHaveText("请输入不小于 0 的金额");
    await expect(page.getByLabel("总医疗费用（元）")).toBeFocused();
  });
});
