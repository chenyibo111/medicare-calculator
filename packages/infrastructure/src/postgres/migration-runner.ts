import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface SqlQueryResult {
  rows: Record<string, unknown>[];
}

export interface SqlExecutor {
  query(sql: string, values?: readonly unknown[]): Promise<SqlQueryResult>;
}

export class MigrationRunner {
  constructor(
    private readonly executor: SqlExecutor,
    private readonly migrationDirectory: string,
  ) {}

  async migrate(): Promise<string[]> {
    await this.executor.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const appliedRows = await this.executor.query("SELECT name FROM schema_migrations");
    const applied = new Set(
      appliedRows.rows.flatMap((row) => (typeof row.name === "string" ? [row.name] : [])),
    );
    const fileNames = (await readdir(this.migrationDirectory))
      .filter((fileName) => /^\d+_.+\.sql$/.test(fileName))
      .sort((left, right) => left.localeCompare(right));
    const migrated: string[] = [];

    for (const fileName of fileNames) {
      if (applied.has(fileName)) {
        continue;
      }

      const sql = await readFile(join(this.migrationDirectory, fileName), "utf8");
      await this.executor.query("BEGIN");

      try {
        await this.executor.query(sql);
        await this.executor.query("INSERT INTO schema_migrations (name) VALUES ($1)", [fileName]);
        await this.executor.query("COMMIT");
        migrated.push(fileName);
      } catch (error) {
        await this.executor.query("ROLLBACK");
        throw error;
      }
    }

    return migrated;
  }
}
