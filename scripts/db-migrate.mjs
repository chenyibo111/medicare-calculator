import { fileURLToPath } from "node:url";
import {
  createPostgresSqlExecutor,
  MigrationRunner,
} from "../packages/infrastructure/src/index.js";

if (!process.env.DATABASE_URL) {
  throw new Error("未配置 DATABASE_URL。请先复制 .env.example 为 .env 并运行 docker compose up --build。");
}

const executor = createPostgresSqlExecutor(process.env.DATABASE_URL);

try {
  const directory = fileURLToPath(new URL("../db/migrations/", import.meta.url));
  const migrated = await new MigrationRunner(executor, directory).migrate();
  console.info(`数据库迁移完成：${migrated.length} 项新迁移。`);
} finally {
  await executor.close();
}
