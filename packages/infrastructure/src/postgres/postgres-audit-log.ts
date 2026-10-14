import { createHash } from "node:crypto";
import type { AuditLog } from "../../../application/src/ports.js";
import type { SqlExecutor } from "./migration-runner.js";

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export class PostgresAuditLog implements AuditLog {
  constructor(private readonly executor: SqlExecutor) {}

  async append(event: Parameters<AuditLog["append"]>[0]): Promise<void> {
    const version = await this.executor.query(
      `
        SELECT id
        FROM policy_versions
        WHERE region = $1 AND version = $2 AND status = 'published'
        ORDER BY effective_from DESC
        LIMIT 1
      `,
      [event.region, event.policyVersion],
    );
    const policyVersionId = version.rows[0]?.id;

    if (typeof policyVersionId !== "string") {
      throw new Error(`未找到用于审计的已发布政策版本：${event.policyVersion}`);
    }

    const trace = { cacheStatus: event.cacheStatus, region: event.region };
    await this.executor.query(
      `
        INSERT INTO calculation_audit_events (
          calculation_id, policy_version_id, input_hash, result_hash, cache_status, trace, created_at
        ) VALUES ($1, $2::uuid, $3, $4, $5, $6::jsonb, $7::timestamptz)
      `,
      [
        event.calculationId,
        policyVersionId,
        sha256({ calculationId: event.calculationId, region: event.region, policyVersion: event.policyVersion }),
        sha256({ calculationId: event.calculationId, cacheStatus: event.cacheStatus }),
        event.cacheStatus,
        JSON.stringify(trace),
        event.createdAt,
      ],
    );
  }
}
