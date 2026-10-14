import type { PublishedPolicy } from "../../../domain/src/policy.js";

export function mapPublishedPolicy(payload: unknown): PublishedPolicy {
  const value = typeof payload === "string" ? JSON.parse(payload) : payload;
  if (!value || typeof value !== "object") {
    throw new Error("数据库中的政策规则格式不合法");
  }

  return value as PublishedPolicy;
}
