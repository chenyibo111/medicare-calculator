import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PolicyPublisher } from "../../packages/application/src/publish-policy.js";
import { PolicyReviewWorkflow, type OperatorIdentity } from "../../packages/application/src/policy-review-workflow.js";
import { PostgresPolicyPublicationStore } from "../../packages/infrastructure/src/postgres/postgres-policy-publication-store.js";
import { PostgresPolicyReviewStore } from "../../packages/infrastructure/src/postgres/postgres-policy-review-store.js";
import { createPostgresSqlExecutor, type PostgresSqlExecutor } from "../../packages/infrastructure/src/postgres/client.js";
import {
  COMPOSE_ACCEPTANCE_BENEFIT_PLAN,
  COMPOSE_ACCEPTANCE_REGION,
  type ComposeAcceptancePolicyVersion,
  composeAcceptancePolicy,
} from "./compose-policy-fixtures.js";

type AcceptanceWorkflow = Pick<PolicyReviewWorkflow, "createDraft" | "submitDraft" | "decideDraft" | "publishDraft">;
const acceptanceAuthor: OperatorIdentity = { id: "system-compose-author", displayName: "系统验收录入员", roles: ["policy_author"] };
const acceptanceReviewer: OperatorIdentity = { id: "system-compose-reviewer", displayName: "系统验收审核员", roles: ["policy_reviewer"] };

export async function publishComposeAcceptancePolicy(dependencies: {
  readonly version: ComposeAcceptancePolicyVersion;
  readonly hasPersistedVersion: (version: string) => Promise<boolean>;
  readonly workflow: AcceptanceWorkflow;
  readonly now?: () => string;
}): Promise<{ version: string; created: boolean }> {
  const policy = composeAcceptancePolicy(dependencies.version);
  if (await dependencies.hasPersistedVersion(policy.version)) {
    return { version: policy.version, created: false };
  }

  const rawDocument = JSON.stringify({ template: `compose-acceptance-${dependencies.version}`, policy });
  const draft = await dependencies.workflow.createDraft(acceptanceAuthor, {
      source: {
      sourceId: randomUUID(),
      region: COMPOSE_ACCEPTANCE_REGION,
      sourceUrl: `https://example.test/compose-acceptance/${dependencies.version}`,
      capturedAt: (dependencies.now ?? (() => new Date().toISOString()))(),
      artifact: { fileName: `compose-acceptance-${dependencies.version}.json`, format: "json", sha256: createHash("sha256").update(rawDocument).digest("hex"), byteLength: Buffer.byteLength(rawDocument) },
    },
    policy,
    evidence: [],
    extraction: { method: "demo_static", adapterVersion: "1.0.0", aiAssisted: false },
    demoAIProposal: true,
  });
  await dependencies.workflow.submitDraft(acceptanceAuthor, draft.id);
  await dependencies.workflow.decideDraft(acceptanceReviewer, draft.id, "approved", "系统 Compose 验收审核通过");
  await dependencies.workflow.publishDraft(acceptanceReviewer, draft.id);
  return { version: policy.version, created: true };
}

export async function hasPersistedComposeAcceptancePolicyVersion(
  database: PostgresSqlExecutor,
  version: string,
): Promise<boolean> {
  const result = await database.query(
    `SELECT EXISTS (
      SELECT 1 FROM policy_versions
      WHERE region = $1 AND benefit_plan = $2 AND version = $3
    ) AS exists`,
    [COMPOSE_ACCEPTANCE_REGION, COMPOSE_ACCEPTANCE_BENEFIT_PLAN, version],
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
  try {
    const reviewStore = new PostgresPolicyReviewStore(database);
    const workflow = new PolicyReviewWorkflow({
      store: reviewStore,
      publisher: new PolicyPublisher({ store: new PostgresPolicyPublicationStore(database), reviewGateway: reviewStore }),
    });
    const result = await publishComposeAcceptancePolicy({
      version: requestedVersion(args),
      hasPersistedVersion: (version) => hasPersistedComposeAcceptancePolicyVersion(database, version),
      workflow,
    });
    console.info(JSON.stringify({ region: COMPOSE_ACCEPTANCE_REGION, status: result.created ? "published" : "already_published", ...result }));
  } finally {
    await database.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await runComposeAcceptancePublisher();
}
