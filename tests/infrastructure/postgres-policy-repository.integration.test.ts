import { describe, expect, it } from "vitest";
import { PostgresAuditLog } from "../../packages/infrastructure/src/postgres/postgres-audit-log.js";
import { createPostgresSqlExecutor } from "../../packages/infrastructure/src/postgres/client.js";
import { PostgresPolicyRepository } from "../../packages/infrastructure/src/postgres/postgres-policy-repository.js";

const integration = process.env.DATABASE_URL ? describe : describe.skip;

integration("PostgreSQL 政策与审计适配器", () => {
  it("仅返回计算日有效的已发布政策，并将最小化计算证据写入审计表", async () => {
    const executor = createPostgresSqlExecutor(process.env.DATABASE_URL!);
    const repository = new PostgresPolicyRepository(executor);
    const auditLog = new PostgresAuditLog(executor);

    try {
      await expect(repository.findPublished({
        region: "城市A",
        hospitalLevel: "tertiary",
        employmentStatus: "employed",
        calculationDate: "2026-03-01",
      })).resolves.toMatchObject({ version: "A-2026.01" });

      await expect(repository.findPublished({
        region: "城市A",
        hospitalLevel: "tertiary",
        employmentStatus: "employed",
        calculationDate: "2025-12-31",
      })).resolves.toBeNull();

      await auditLog.append({
        calculationId: "00000000-0000-4000-8000-000000000099",
        region: "城市A",
        policyVersion: "A-2026.01",
        cacheStatus: "miss",
        createdAt: "2026-03-01T00:00:00.000Z",
      });

      const auditRows = await executor.query(`
        SELECT input_hash, result_hash, trace
        FROM calculation_audit_events
        WHERE calculation_id = '00000000-0000-4000-8000-000000000099'
      `);
      expect(auditRows.rows).toHaveLength(1);
      expect(auditRows.rows[0]?.input_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(auditRows.rows[0]?.result_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(auditRows.rows[0]?.trace).toEqual({ cacheStatus: "miss", region: "城市A" });
    } finally {
      await executor.close();
    }
  });
});
