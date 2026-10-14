import { CalculateReimbursementUseCase } from "../../../packages/application/src/calculate-reimbursement.js";
import { PostgresAuditLog, PostgresPolicyRepository, RedisPolicyCache, createPostgresSqlExecutor } from "../../../packages/infrastructure/src/index.js";
import { resolveRuntimeConfig } from "./runtime-config.js";
import { createTestCalculationUseCase } from "./test-composition-root.js";

let calculationUseCasePromise: Promise<CalculateReimbursementUseCase> | undefined;

async function createCalculationUseCase(): Promise<CalculateReimbursementUseCase> {
  const config = resolveRuntimeConfig(process.env);
  if (config.mode === "test") return createTestCalculationUseCase();

  const database = createPostgresSqlExecutor(config.databaseUrl);
  try {
    await database.query("SELECT 1");
    const cache = await RedisPolicyCache.connect(config.redisUrl);
    return new CalculateReimbursementUseCase({ repository: new PostgresPolicyRepository(database), cache, auditLog: new PostgresAuditLog(database) });
  } catch (error) {
    await database.close();
    const message = error instanceof Error ? error.message : "未知错误";
    throw new Error(`生产依赖不可用，请先运行 docker compose up：${message}`);
  }
}

export function getCalculationUseCase(): Promise<CalculateReimbursementUseCase> {
  calculationUseCasePromise ??= createCalculationUseCase();
  return calculationUseCasePromise;
}
