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

  test("方案设计按生产语义区分离线政策生产与在线用户测算", async ({ page }) => {
    await page.goto(offlinePage);
    await expect(page.getByTestId("delivery-versions-card")).toBeVisible();
    await expect(page.locator(".masthead [data-testid='delivery-versions-card']")).toHaveCount(0);
    await expect(page.locator(".delivery-banner[data-testid='delivery-versions-card']")).toBeVisible();
    await expect(page.getByTestId("delivery-versions-card")).toContainText("本次交付：两种可运行的演示版本");
    await expect(page.getByTestId("delivery-versions-card")).toContainText("离线 H5 Demo");
    await expect(page.getByTestId("delivery-versions-card")).toContainText("在线 API 版");
    await page.getByRole("tab", { name: "方案设计" }).click();

    await expect(page.getByRole("heading", { name: "生产系统的离线与在线数据流" })).toBeVisible();
    await expect(page.getByTestId("production-offline-card")).toContainText("政策生产链路（离线）");
    await expect(page.getByTestId("production-online-card")).toContainText("用户测算链路（在线）");
    await expect(page.getByTestId("production-foundation-status")).toContainText("PostgreSQL 政策持久化、Redis 缓存、Outbox 与 Worker 已实现");
    await expect(page.getByTestId("production-foundation-status")).toContainText("Worker 已纳入 Compose");
    await expect(page.getByTestId("production-foundation-status")).toContainText("真实政策来源与 AI 草稿尚未实现");
    await expect(page.getByRole("heading", { name: "AI 的能力边界" })).toBeVisible();
    await expect(page.getByText("AI 不得参与的环节")).toBeVisible();
    await expect(page.getByRole("heading", { name: "千万日活：性能与成本" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "如何证明算得对" })).toBeVisible();
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

  test("Compose 验收样例提交固定验收输入并展示服务端返回的政策版本", async ({ page }) => {
    await page.goto("http://127.0.0.1:3011");
    await page.route("**/api/v1/reimbursement-calculations", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        calculationId: "compose-acceptance-calculation",
        policyVersion: "compose-e2e-v2",
        cacheStatus: "miss",
        result: { estimatedSelfPayFen: 726_000, basicReimbursementFen: 1_274_000, catastrophicReimbursementFen: 0 },
        trace: [],
      }),
    }));
    const calculationRequest = page.waitForRequest((request) => request.url().endsWith("/api/v1/reimbursement-calculations") && request.method() === "POST");

    await page.getByTestId("service-sample-compose").click();
    await expect(page.getByLabel("参保城市")).toHaveValue("Compose验收市");
    await page.getByRole("button", { name: "开始测算" }).click();

    expect(await (await calculationRequest).postDataJSON()).toMatchObject({
      region: "Compose验收市",
      employmentStatus: "resident",
      hospitalLevel: "tertiary",
      totalAmountFen: 2_000_000,
      outOfCatalogAmountFen: 100_000,
      classBAmountFen: 200_000,
      annualReimbursedAmountFen: 0,
      outOfAreaFiled: true,
    });
    await expect(page.getByText("compose-e2e-v2", { exact: true })).toBeVisible();
    await expect(page.getByTestId("service-estimated-self-pay")).toHaveText("¥7,260.00");
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

  test("服务版聚焦在线测算，不展示方案设计区", async ({ page }) => {
    await page.goto("http://127.0.0.1:3011");

    await expect(page.getByText("方案设计", { exact: true })).not.toBeVisible();
  });
});
