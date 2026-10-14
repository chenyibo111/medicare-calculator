import {
  PostgresOutboxDispatcher,
  PostgresPolicyRepository,
  RedisPolicyCache,
  PolicyPublicationDispatcher,
  createPostgresSqlExecutor,
} from "../../packages/infrastructure/src/index.js";

if (!process.env.DATABASE_URL || !process.env.REDIS_URL) {
  throw new Error("缺少 DATABASE_URL 或 REDIS_URL。请先运行 docker compose up --build。");
}

const database = createPostgresSqlExecutor(process.env.DATABASE_URL);
const cache = await RedisPolicyCache.connect(process.env.REDIS_URL);
const dispatcher = new PolicyPublicationDispatcher({
  outbox: new PostgresOutboxDispatcher(database),
  cache,
  repository: new PostgresPolicyRepository(database),
});

try {
  let processed = 0;
  while (await dispatcher.processNext()) processed += 1;
  console.info(`Outbox 处理完成：${processed} 条事件。`);
} finally {
  await cache.close();
  await database.close();
}
