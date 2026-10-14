import type { PostgresSqlExecutor } from "./client.js";

export interface StoredOutboxEvent {
  readonly id: string;
  readonly eventType: string;
  readonly aggregateId: string;
  readonly payload: Record<string, unknown>;
}

export class PostgresOutboxDispatcher {
  constructor(private readonly database: PostgresSqlExecutor) {}

  async processNext(deliver: (event: StoredOutboxEvent) => Promise<void>): Promise<boolean> {
    return this.database.transaction(async (executor) => {
      const result = await executor.query(`
        SELECT id, event_type, aggregate_id, payload
        FROM policy_outbox_events
        WHERE processed_at IS NULL
        ORDER BY created_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `);
      const row = result.rows[0];
      if (!row || typeof row.id !== "string" || typeof row.event_type !== "string" || typeof row.aggregate_id !== "string") {
        return false;
      }

      const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
      if (!payload || typeof payload !== "object") {
        throw new Error(`Outbox 事件 ${row.id} 的载荷格式不合法`);
      }
      await deliver({
        id: row.id,
        eventType: row.event_type,
        aggregateId: row.aggregate_id,
        payload: payload as Record<string, unknown>,
      });
      await executor.query("UPDATE policy_outbox_events SET processed_at = now() WHERE id = $1::uuid", [row.id]);
      return true;
    });
  }
}
