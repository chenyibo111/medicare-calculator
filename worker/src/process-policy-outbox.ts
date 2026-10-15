import {
  PostgresOutboxDispatcher,
  PostgresPolicyRepository,
  RedisPolicyCache,
  PolicyPublicationDispatcher,
  createPostgresSqlExecutor,
} from "../../packages/infrastructure/src/index.js";
import { runOutboxWorker } from "./policy-outbox-runtime.js";

if (!process.env.DATABASE_URL || !process.env.REDIS_URL) {
  throw new Error("缺少 DATABASE_URL 或 REDIS_URL。请先运行 docker compose up --build。");
}

const database = createPostgresSqlExecutor(process.env.DATABASE_URL);
const cache = await RedisPolicyCache.connect(process.env.REDIS_URL);
let stopRequested = false;
const requestStop = () => { stopRequested = true; };
process.once("SIGTERM", requestStop);
process.once("SIGINT", requestStop);

function logEvent(event: { id: string; eventType: string; payload: Record<string, unknown> }, outcome: string, error?: unknown) {
  console[outcome === "error" ? "error" : "info"](JSON.stringify({
    eventId: event.id,
    eventType: event.eventType,
    region: typeof event.payload.region === "string" ? event.payload.region : null,
    policyVersion: typeof event.payload.newPolicyVersion === "string" ? event.payload.newPolicyVersion : null,
    outcome,
    error: error instanceof Error ? error.message : undefined,
  }));
}

const dispatcher = new PolicyPublicationDispatcher({
  outbox: new PostgresOutboxDispatcher(database),
  cache,
  repository: new PostgresPolicyRepository(database),
  onEvent: logEvent,
});

try {
  const result = await runOutboxWorker({
    once: process.argv.includes("--once"),
    processNext: () => dispatcher.processNext(),
    shouldStop: () => stopRequested,
    onEvent: (outcome, error) => {
      if (outcome === "error") console.error(JSON.stringify({ outcome, error: error instanceof Error ? error.message : "unknown" }));
    },
  });
  console.info(JSON.stringify({ outcome: "stopped", processed: result.processed }));
} finally {
  process.removeListener("SIGTERM", requestStop);
  process.removeListener("SIGINT", requestStop);
  await cache.close();
  await database.close();
}
