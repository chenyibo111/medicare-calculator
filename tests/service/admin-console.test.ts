import { describe, expect, it } from "vitest";
import {
  AdminConsoleUnavailableError,
  resolveLocalAdminOperator,
  resolveAdminConsoleConfig,
} from "../../apps/service-web/server/admin-console.js";

describe("本地评测后台会话与开关", () => {
  it("仅在 Compose 运行时且显式开关开启时注册后台", () => {
    expect(resolveAdminConsoleConfig({ MEDICARE_RUNTIME: "compose", MEDICARE_ADMIN_CONSOLE: "true" })).toEqual({ enabled: true });
    expect(resolveAdminConsoleConfig({ MEDICARE_RUNTIME: "compose" })).toEqual({ enabled: false });
    expect(resolveAdminConsoleConfig({ MEDICARE_RUNTIME: "test", MEDICARE_ADMIN_CONSOLE: "true" })).toEqual({ enabled: false });
  });

  it("只从服务端会话名映射固定本地角色，拒绝未知会话", () => {
    expect(resolveLocalAdminOperator("policy-author")).toMatchObject({ id: "local-policy-author", roles: ["policy_author"] });
    expect(resolveLocalAdminOperator("policy-reviewer")).toMatchObject({ id: "local-policy-reviewer", roles: ["policy_reviewer"] });
    expect(() => resolveLocalAdminOperator(null)).toThrow(AdminConsoleUnavailableError);
    expect(() => resolveLocalAdminOperator("policy-author,policy_reviewer")).toThrow(AdminConsoleUnavailableError);
  });
});
