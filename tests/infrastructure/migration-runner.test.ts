import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MigrationRunner,
  type SqlExecutor,
} from "../../packages/infrastructure/src/postgres/migration-runner.js";

class RecordingExecutor implements SqlExecutor {
  readonly statements: string[] = [];
  private readonly applied = new Set<string>();

  async query(sql: string, values: readonly unknown[] = []) {
    this.statements.push(sql.trim());

    if (sql.includes("SELECT name FROM schema_migrations")) {
      return { rows: [...this.applied].map((name) => ({ name })) };
    }

    if (sql.includes("INSERT INTO schema_migrations")) {
      this.applied.add(String(values[0]));
    }

    return { rows: [] };
  }
}

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createMigrationDirectory(files: Record<string, string>) {
  const directory = await mkdtemp(join(tmpdir(), "medicare-migrations-"));
  temporaryDirectories.push(directory);
  await Promise.all(
    Object.entries(files).map(([name, content]) => writeFile(join(directory, name), content)),
  );
  return directory;
}

describe("MigrationRunner", () => {
  it("项目迁移包含审核工作台的生命周期迁移", async () => {
    const executor = new RecordingExecutor();
    const runner = new MigrationRunner(executor, resolve("db/migrations"));

    await expect(runner.migrate()).resolves.toEqual([
      "001_policy_foundation.sql",
      "002_policy_review_console.sql",
      "003_policy_source_artifact.sql",
    ]);
  });

  it("按文件名顺序仅执行尚未记录的 SQL 迁移", async () => {
    const directory = await createMigrationDirectory({
      "010_indexes.sql": "CREATE INDEX policy_version_idx ON policy_versions (version);",
      "002_schema.sql": "CREATE TABLE policy_versions (version text NOT NULL);",
      "README.md": "不应作为迁移执行",
    });
    const executor = new RecordingExecutor();
    const runner = new MigrationRunner(executor, directory);

    await expect(runner.migrate()).resolves.toEqual(["002_schema.sql", "010_indexes.sql"]);
    await expect(runner.migrate()).resolves.toEqual([]);

    const appliedSql = executor.statements.filter(
      (statement) => statement.startsWith("CREATE") && !statement.includes("schema_migrations"),
    );
    expect(appliedSql).toEqual([
      "CREATE TABLE policy_versions (version text NOT NULL);",
      "CREATE INDEX policy_version_idx ON policy_versions (version);",
    ]);
  });

  it("迁移语句失败时不会将其记为已执行", async () => {
    const directory = await createMigrationDirectory({
      "001_broken.sql": "BROKEN SQL;",
    });
    const executor: SqlExecutor = {
      query: async (sql) => {
        if (sql.includes("BROKEN SQL")) {
          throw new Error("syntax error at BROKEN");
        }
        return { rows: [] };
      },
    };
    const runner = new MigrationRunner(executor, directory);

    await expect(runner.migrate()).rejects.toThrow("syntax error at BROKEN");
  });
});
