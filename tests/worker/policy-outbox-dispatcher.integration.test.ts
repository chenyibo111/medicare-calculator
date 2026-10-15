import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPostgresSqlExecutor, type PostgresSqlExecutor } from "../../packages/infrastructure/src/postgres/client.js";
import { PostgresOutboxDispatcher } from "../../packages/infrastructure/src/postgres/postgres-outbox-dispatcher.js";

const integration = process.env.DATABASE_URL ? describe : describe.skip;

async function createOutboxEvent(database: PostgresSqlExecutor, payload: Record<string, unknown>) {
  const sourceId = randomUUID();
  const versionId = randomUUID();
  const eventId = randomUUID();
  const region = `Outbox集成测试市-${eventId}`;

  await database.query(
    `INSERT INTO policy_sources (id, region, source_url, content_hash, captured_at)
     VALUES ($1::uuid, $2, $3, $4, now())`,
    [sourceId, region, `https://example.test/outbox/${eventId}`, `outbox-${eventId}`],
  );
  await database.query(
    `INSERT INTO policy_versions (id, region, benefit_plan, version, effective_from, status, source_id, policy_payload, published_at)
     VALUES ($1::uuid, $2, '居民医保', $3, '2026-01-01', 'published', $4::uuid, '{}'::jsonb, now())`,
    [versionId, region, `outbox-${eventId}`, sourceId],
  );
  await database.query(
    `INSERT INTO policy_outbox_events (id, event_type, aggregate_id, payload)
     VALUES ($1::uuid, 'policy.published', $2::uuid, $3::jsonb)`,
    [eventId, versionId, JSON.stringify(payload)],
  );

  return { eventId, sourceId, versionId };
}

async function removeOutboxEvent(database: PostgresSqlExecutor, ids: { eventId: string; sourceId: string; versionId: string }) {
  await database.query("DELETE FROM policy_outbox_events WHERE id = $1::uuid", [ids.eventId]);
  await database.query("DELETE FROM policy_versions WHERE id = $1::uuid", [ids.versionId]);
  await database.query("DELETE FROM policy_sources WHERE id = $1::uuid", [ids.sourceId]);
}

integration("PostgresOutboxDispatcher", () => {
  it("只在处理成功后标记事件，重复运行不会重复消费", async () => {
    const database = createPostgresSqlExecutor(process.env.DATABASE_URL!);
    const dispatcher = new PostgresOutboxDispatcher(database);
    const distractor = await createOutboxEvent(database, { newPolicyVersion: "distractor-test" });
    const event = await createOutboxEvent(database, { newPolicyVersion: "success-test" });
    const deliveries: string[] = [];

    try {
      const first = await dispatcher.processNext(async (received) => { deliveries.push(received.id); }, { eventId: event.eventId });
      const second = await dispatcher.processNext(async (received) => { deliveries.push(received.id); }, { eventId: event.eventId });

      expect(first).toBe(true);
      expect(second).toBe(false);
      expect(deliveries).toEqual([event.eventId]);
    } finally {
      await removeOutboxEvent(database, event);
      await removeOutboxEvent(database, distractor);
      await database.close();
    }
  });

  it("投递失败时保留事件供后续重试", async () => {
    const database = createPostgresSqlExecutor(process.env.DATABASE_URL!);
    const dispatcher = new PostgresOutboxDispatcher(database);
    const event = await createOutboxEvent(database, { newPolicyVersion: "retry-test" });

    try {
      await expect(dispatcher.processNext(async () => {
        throw new Error("temporary delivery failure");
      }, { eventId: event.eventId })).rejects.toThrow("temporary delivery failure");

      const result = await database.query(
        "SELECT processed_at FROM policy_outbox_events WHERE id = $1::uuid",
        [event.eventId],
      );
      expect(result.rows).toEqual([{ processed_at: null }]);
    } finally {
      await removeOutboxEvent(database, event);
      await database.close();
    }
  });

  it("并发消费者只会领取同一事件一次", async () => {
    const firstDatabase = createPostgresSqlExecutor(process.env.DATABASE_URL!);
    const secondDatabase = createPostgresSqlExecutor(process.env.DATABASE_URL!);
    const event = await createOutboxEvent(firstDatabase, { newPolicyVersion: "concurrent-test" });
    let deliveries = 0;

    try {
      const results = await Promise.all([
        new PostgresOutboxDispatcher(firstDatabase).processNext(async () => { deliveries += 1; }, { eventId: event.eventId }),
        new PostgresOutboxDispatcher(secondDatabase).processNext(async () => { deliveries += 1; }, { eventId: event.eventId }),
      ]);

      expect(results.sort()).toEqual([false, true]);
      expect(deliveries).toBe(1);
    } finally {
      await removeOutboxEvent(firstDatabase, event);
      await firstDatabase.close();
      await secondDatabase.close();
    }
  });
});
