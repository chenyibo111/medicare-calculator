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
});
