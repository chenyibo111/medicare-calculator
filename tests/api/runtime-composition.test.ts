import { describe, expect, it } from "vitest";
import { resolveRuntimeConfig } from "../../apps/service-web/server/runtime-config.js";

describe("service runtime configuration", () => {
  it("Compose 模式缺少连接信息时返回中文可操作错误", () => {
    expect(() => resolveRuntimeConfig({ MEDICARE_RUNTIME: "compose" })).toThrow(
      "请先配置 DATABASE_URL 与 REDIS_URL，并运行 docker compose up --build",
    );
  });

  it("测试模式显式选择本地适配器", () => {
    expect(resolveRuntimeConfig({ MEDICARE_RUNTIME: "test" })).toEqual({ mode: "test" });
  });
});
