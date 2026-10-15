import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PolicyPublisher, type PolicyReviewGateway } from "../../packages/application/src/publish-policy.js";
import { LocalReviewGateway } from "../../packages/infrastructure/src/local-review-gateway.js";
import { PostgresPolicyPublicationStore } from "../../packages/infrastructure/src/postgres/postgres-policy-publication-store.js";
import { createPostgresSqlExecutor, type PostgresSqlExecutor } from "../../packages/infrastructure/src/postgres/client.js";
import {
  COMPOSE_ACCEPTANCE_REGION,
  type ComposeAcceptancePolicyVersion,
  composeAcceptancePolicy,
} from "./compose-policy-fixtures.js";

type AcceptancePublisher = Pick<PolicyPublisher, "publish">;

export async function publishComposeAcceptancePolicy(dependencies: {
  readonly version: ComposeAcceptancePolicyVersion;
  readonly hasPublishedVersion: (version: string) => Promise<boolean>;
  readonly publisher: AcceptancePublisher;
  readonly reviewGateway: PolicyReviewGateway;
  readonly now?: () => string;
}): Promise<{ version: string; created: boolean }> {
  const policy = composeAcceptancePolicy(dependencies.version);
  if (await dependencies.hasPublishedVersion(policy.version)) {
    return { version: policy.version, created: false };
  }

  const pendingDraft = {
    id: randomUUID(),
    status: "pending_review" as const,
    demoAIProposal: true as const,
    source: {
      sourceId: randomUUID(),
      region: COMPOSE_ACCEPTANCE_REGION,
      sourceUrl: `https://example.test/compose-acceptance/${dependencies.version}`,
    },
    policy,
  };
  const approved = await dependencies.reviewGateway.approve(pendingDraft, "compose-acceptance-reviewer");
  await dependencies.publisher.publish(approved);
  return { version: policy.version, created: true };
}

async function hasPublishedVersion(database: PostgresSqlExecutor, version: string): Promise<boolean> {
  const result = await database.query(
    `SELECT EXISTS (
      SELECT 1 FROM policy_versions
      WHERE region = $1 AND version = $2 AND status = 'published'
    ) AS exists`,
    [COMPOSE_ACCEPTANCE_REGION, version],
  );
  return result.rows[0]?.exists === true;
}

function requestedVersion(args: readonly string[]): ComposeAcceptancePolicyVersion {
  const value = args[args.indexOf("--version") + 1];
  if (value === "v1" || value === "v2") return value;
  throw new Error("仅支持 --version v1 或 --version v2。");
}

export async function runComposeAcceptancePublisher(args: readonly string[] = process.argv.slice(2)): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("缺少 DATABASE_URL。请通过 docker compose exec 运行验收发布命令。");

  const database = createPostgresSqlExecutor(process.env.DATABASE_URL);
  const reviewGateway = new LocalReviewGateway();
  try {
    const result = await publishComposeAcceptancePolicy({
      version: requestedVersion(args),
      hasPublishedVersion: (version) => hasPublishedVersion(database, version),
      reviewGateway,
      publisher: new PolicyPublisher({
        store: new PostgresPolicyPublicationStore(database),
        reviewGateway,
      }),
    });
    console.info(JSON.stringify({ region: COMPOSE_ACCEPTANCE_REGION, status: result.created ? "published" : "already_published", ...result }));
  } finally {
    await database.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await runComposeAcceptancePublisher();
}
