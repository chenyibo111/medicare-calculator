import { describe, expect, it } from "vitest";
import {
  createPostgresSqlExecutor,
  type PostgresSqlExecutor,
} from "../../packages/infrastructure/src/postgres/client.js";

const integration = process.env.DATABASE_URL ? describe : describe.skip;

integration("PostgreSQL 政策基础 schema", () => {
  let executor: PostgresSqlExecutor;

  it("迁移和种子提供六张业务表、索引与城市 A/B 已发布政策", async () => {
    executor = createPostgresSqlExecutor(process.env.DATABASE_URL!);

    try {
      const tables = await executor.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
      `);
      expect(tables.rows.map((row) => row.table_name).sort()).toEqual(
        expect.arrayContaining([
          "calculation_audit_events",
          "policy_drafts",
          "policy_outbox_events",
          "policy_reviews",
          "policy_sources",
          "policy_versions",
        ]),
      );

      const indexes = await executor.query(`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'policy_versions'
      `);
      expect(indexes.rows.map((row) => row.indexname)).toContain("policy_versions_lookup_idx");

      const demoPolicies = await executor.query(`
        SELECT region, version, status
        FROM policy_versions
        WHERE status = 'published'
        ORDER BY region
      `);
      expect(demoPolicies.rows).toEqual([
        { region: "城市A", version: "A-2026.01", status: "published" },
        { region: "城市B", version: "B-2026.01", status: "published" },
      ]);
    } finally {
      await executor.close();
    }
  });
});
