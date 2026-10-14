export type ServiceRuntimeConfig =
  | { readonly mode: "test" }
  | { readonly mode: "compose"; readonly databaseUrl: string; readonly redisUrl: string };

export function resolveRuntimeConfig(environment: Record<string, string | undefined>): ServiceRuntimeConfig {
  if (environment.MEDICARE_RUNTIME === "compose") {
    if (!environment.DATABASE_URL || !environment.REDIS_URL) {
      throw new Error("请先配置 DATABASE_URL 与 REDIS_URL，并运行 docker compose up --build");
    }
    return { mode: "compose", databaseUrl: environment.DATABASE_URL, redisUrl: environment.REDIS_URL };
  }
  return { mode: "test" };
}
