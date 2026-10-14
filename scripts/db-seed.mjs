import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createPostgresSqlExecutor } from "../packages/infrastructure/src/index.js";

if (!process.env.DATABASE_URL) {
  throw new Error("未配置 DATABASE_URL。请先复制 .env.example 为 .env 并运行 docker compose up --build。");
}

const executor = createPostgresSqlExecutor(process.env.DATABASE_URL);

try {
  const seedPath = fileURLToPath(new URL("../db/seeds/001_demo_policies.sql", import.meta.url));
  await executor.query(await readFile(seedPath, "utf8"));
  console.info("示例政策种子完成：城市 A / B。\n");
} finally {
  await executor.close();
}
