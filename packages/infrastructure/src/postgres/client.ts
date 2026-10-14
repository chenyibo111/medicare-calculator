import { Pool, type QueryResultRow } from "pg";
import type { SqlExecutor, SqlQueryResult } from "./migration-runner.js";

export class PostgresSqlExecutor implements SqlExecutor {
  constructor(private readonly pool: Pool) {}

  async query(
    sql: string,
    values: readonly unknown[] = [],
  ): Promise<SqlQueryResult> {
    const result = await this.pool.query<QueryResultRow>(sql, [...values]);
    return { rows: result.rows };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function createPostgresSqlExecutor(connectionString: string): PostgresSqlExecutor {
  return new PostgresSqlExecutor(new Pool({ connectionString }));
}
