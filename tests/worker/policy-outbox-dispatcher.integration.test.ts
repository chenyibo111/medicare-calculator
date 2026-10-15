import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPostgresSqlExecutor } from "../../packages/infrastructure/src/postgres/client.js";
import { PostgresOutboxDispatcher } from "../../packages/infrastructure/src/postgres/postgres-outbox-dispatcher.js";

const integration = process.env.DATABASE_URL ? describe : describe.skip;

integration("PostgresOutboxDispatcher", () => {
  it("只在处理成功后标记事件，重复运行不会重复消费", async () => {
    const database = createPostgresSqlExecutor(process.env.DATABASE_URL!);
    const dispatcher = new PostgresOutboxDispatcher(database);
    let deliveries = 0;

    try {
      await database.query(
        `INSERT INTO policy_outbox_events (id, event_type, aggregate_id, payload)
         VALUES ($1::uuid, 'policy.published', '00000000-0000-4000-8000-0000000000a4'::uuid, $2::jsonb)`,
        [randomUUID(), JSON.stringify({ newPolicyVersion: "A-2026.01" })],
      );
      const first = await dispatcher.processNext(async () => { deliveries += 1; });
      const second = await dispatcher.processNext(async () => { deliveries += 1; });

      expect(first).toBe(true);
      expect(second).toBe(false);
      expect(deliveries).toBe(1);
    } finally {
      await database.close();
    }
  });

  it("投递失败时保留事件供后续重试", async () => {
    const database = createPostgresSqlExecutor(process.env.DATABASE_URL!);
    const dispatcher = new PostgresOutboxDispatcher(database);
    const eventId = randomUUID();

    try {
      await database.query(
        `INSERT INTO policy_outbox_events (id, event_type, aggregate_id, payload)
         VALUES ($1::uuid, 'policy.published', $2::uuid, $3::jsonb)`,
        [eventId, randomUUID(), JSON.stringify({ newPolicyVersion: "retry-test" })],
      );

      await expect(dispatcher.processNext(async () => {
        throw new Error("temporary delivery failure");
      })).rejects.toThrow("temporary delivery failure");

      const result = await database.query(
        "SELECT processed_at FROM policy_outbox_events WHERE id = $1::uuid",
        [eventId],
      );
      expect(result.rows).toEqual([{ processed_at: null }]);
    } finally {
      await database.query("DELETE FROM policy_outbox_events WHERE id = $1::uuid", [eventId]);
      await database.close();
    }
  });

  it("并发消费者只会领取同一事件一次", async () => {
    const firstDatabase = createPostgresSqlExecutor(process.env.DATABASE_URL!);
    const secondDatabase = createPostgresSqlExecutor(process.env.DATABASE_URL!);
    const eventId = randomUUID();
    let deliveries = 0;

    try {
      await firstDatabase.query(
        `INSERT INTO policy_outbox_events (id, event_type, aggregate_id, payload)
         VALUES ($1::uuid, 'policy.published', $2::uuid, $3::jsonb)`,
        [eventId, randomUUID(), JSON.stringify({ newPolicyVersion: "concurrent-test" })],
      );

      const results = await Promise.all([
        new PostgresOutboxDispatcher(firstDatabase).processNext(async () => { deliveries += 1; }),
        new PostgresOutboxDispatcher(secondDatabase).processNext(async () => { deliveries += 1; }),
      ]);

      expect(results.sort()).toEqual([false, true]);
      expect(deliveries).toBe(1);
    } finally {
      await firstDatabase.query("DELETE FROM policy_outbox_events WHERE id = $1::uuid", [eventId]);
      await firstDatabase.close();
      await secondDatabase.close();
    }
  });
});
