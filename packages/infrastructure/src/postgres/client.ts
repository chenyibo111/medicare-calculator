import { Pool, type PoolClient, type QueryResultRow } from "pg";
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

  async transaction<T>(operation: (executor: SqlExecutor) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const transactionExecutor: SqlExecutor = {
      async query(sql, values = []) {
        const result = await client.query<QueryResultRow>(sql, [...values]);
        return { rows: result.rows };
      },
    };

    await client.query("BEGIN");
    try {
      const result = await operation(transactionExecutor);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export function createPostgresSqlExecutor(connectionString: string): PostgresSqlExecutor {
  return new PostgresSqlExecutor(new Pool({ connectionString }));
}
