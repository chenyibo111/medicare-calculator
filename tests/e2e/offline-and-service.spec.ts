import { expect, test } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const offlinePage = pathToFileURL(resolve("apps/offline-demo/dist/index.html")).href;

test.describe("离线演示版 @offline", () => {
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

test.describe("服务版 @service", () => {
  test("通过 API 测算并展示服务端的政策版本、请求标识与缓存状态", async ({ page }) => {
    await page.goto("http://127.0.0.1:3011");
    const calculationRequest = page.waitForRequest((request) => request.url().endsWith("/api/v1/reimbursement-calculations") && request.method() === "POST");
    await page.getByTestId("service-sample-city-b").click();
    await page.getByRole("button", { name: "开始测算" }).click();

    const request = await calculationRequest;
    expect(await request.postDataJSON()).toMatchObject({ region: "城市B", totalAmountFen: 6_000_000 });
    await expect(page.getByTestId("service-estimated-self-pay")).toHaveText("¥23,665.00");
    await expect(page.getByText("B-2026.01")).toBeVisible();
    await expect(page.getByText("服务器计算")).toBeVisible();
  });

  test("API 错误时保留输入并给出可恢复提示", async ({ page }) => {
    await page.goto("http://127.0.0.1:3011");
    await page.getByTestId("service-sample-city-b").click();
    await page.route("**/api/v1/reimbursement-calculations", (route) => route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ message: "总医疗费用必须是非负整数分" }) }));
    await page.getByRole("button", { name: "开始测算" }).click();

    await expect(page.getByTestId("totalAmount-error")).toHaveText("总医疗费用必须是非负整数分");
    await expect(page.getByLabel("总医疗费用（元）")).toHaveValue("60000");
    await expect(page.getByLabel("总医疗费用（元）")).toBeFocused();
  });
});
