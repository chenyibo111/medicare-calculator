import { createHash, randomUUID } from "node:crypto";
import { PolicyPublisher, type PolicyDraftCandidate } from "../../../packages/application/src/publish-policy.js";
import {
  PolicyReviewWorkflow,
  type OperatorIdentity,
} from "../../../packages/application/src/policy-review-workflow.js";
import type { PublishedPolicy } from "../../../packages/domain/src/policy.js";
import {
  PostgresPolicyPublicationStore,
  PostgresPolicyReviewStore,
  createPostgresSqlExecutor,
} from "../../../packages/infrastructure/src/index.js";
import { resolveRuntimeConfig } from "./runtime-config.js";

const adminSessionCookie = "medicare_admin_session";
const localOperators: Record<string, OperatorIdentity> = {
  "policy-author": { id: "local-policy-author", displayName: "本地政策录入员", roles: ["policy_author"] },
  "policy-reviewer": { id: "local-policy-reviewer", displayName: "本地政策审核员", roles: ["policy_reviewer"] },
};

export type LocalAdminSession = keyof typeof localOperators;
export type ComposeAcceptancePolicyVersion = "v1" | "v2";

export class AdminConsoleUnavailableError extends Error {
  constructor(message: string, readonly status: 401 | 404 = 404) {
    super(message);
  }
}

export function resolveAdminConsoleConfig(environment: Record<string, string | undefined>): { enabled: boolean } {
  return { enabled: environment.MEDICARE_RUNTIME === "compose" && environment.MEDICARE_ADMIN_CONSOLE === "true" };
}

export function resolveLocalAdminOperator(session: string | null): OperatorIdentity {
  if (session === null || !(session in localOperators)) {
    throw new AdminConsoleUnavailableError("本地评测后台未登录或会话无效", 401);
  }
  return localOperators[session as LocalAdminSession];
}

export function sessionFromRequest(request: Request): LocalAdminSession | null {
  const cookie = request.headers.get("cookie") ?? "";
  const value = cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${adminSessionCookie}=`))?.slice(adminSessionCookie.length + 1);
  return value === "policy-author" || value === "policy-reviewer" ? value : null;
}

export function operatorFromRequest(request: Request): OperatorIdentity {
  return resolveLocalAdminOperator(sessionFromRequest(request));
}

export function localSessionCookie(session: LocalAdminSession): string {
  return `${adminSessionCookie}=${session}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800`;
}

export function createComposeAcceptanceDraftInput(version: ComposeAcceptancePolicyVersion): PolicyDraftCandidate {
  const region = "Compose验收市";
  const draftToken = randomUUID().slice(0, 8);
  const policy: PublishedPolicy = {
    region,
    benefitPlan: "居民医保",
    version: `compose-console-${version}-${draftToken}`,
    effectiveFrom: "2026-10-15",
    sourceReference: `本地评测后台固定 Compose 验收政策 ${version}`,
    hospitalRules: {
      community: { deductibleFen: 20_000, reimbursementRateBps: version === "v1" ? 7_000 : 8_000 },
      secondary: { deductibleFen: 50_000, reimbursementRateBps: version === "v1" ? 6_500 : 7_500 },
      tertiary: { deductibleFen: 80_000, reimbursementRateBps: version === "v1" ? 6_000 : 7_000 },
    },
    classBAdvanceRateBps: 0,
    annualCapFen: 5_000_000,
    retirementBonusBps: 0,
    unfiledOutOfAreaReductionBps: 0,
    catastrophicTiers: [],
  };
  const capturedAt = new Date().toISOString();
  const rawDocument = JSON.stringify({ template: `compose-review-console-${version}`, policy });
  return {
    source: {
      sourceId: randomUUID(),
      region,
      sourceUrl: `https://example.test/compose-review-console/${version}`,
      capturedAt,
      artifact: {
        fileName: `compose-review-console-${version}.json`,
        format: "json",
        sha256: createHash("sha256").update(rawDocument).digest("hex"),
        byteLength: Buffer.byteLength(rawDocument),
      },
    },
    policy,
    evidence: [],
    extraction: { method: "demo_static", adapterVersion: "1.0.0", aiAssisted: false },
    demoAIProposal: true,
  };
}

interface AdminConsole {
  readonly workflow: PolicyReviewWorkflow;
  readonly reviewStore: PostgresPolicyReviewStore;
}

let adminConsolePromise: Promise<AdminConsole> | undefined;

async function createAdminConsole(): Promise<AdminConsole> {
  const runtime = resolveRuntimeConfig(process.env);
  if (runtime.mode !== "compose" || !resolveAdminConsoleConfig(process.env).enabled) {
    throw new AdminConsoleUnavailableError("本地评测后台仅在 Compose 且 MEDICARE_ADMIN_CONSOLE=true 时可用");
  }
  const database = createPostgresSqlExecutor(runtime.databaseUrl);
  try {
    await database.query("SELECT 1");
    const reviewStore = new PostgresPolicyReviewStore(database);
    const workflow = new PolicyReviewWorkflow({
      store: reviewStore,
      publisher: new PolicyPublisher({
        store: new PostgresPolicyPublicationStore(database),
        reviewGateway: reviewStore,
      }),
    });
    return { workflow, reviewStore };
  } catch (error) {
    await database.close();
    throw error;
  }
}

export function getAdminPolicyReviewWorkflow(): Promise<PolicyReviewWorkflow> {
  return getAdminConsole().then(({ workflow }) => workflow);
}

export function getAdminConsole(): Promise<AdminConsole> {
  adminConsolePromise ??= createAdminConsole();
  return adminConsolePromise;
}

export function adminErrorResponse(error: unknown): Response {
  if (error instanceof AdminConsoleUnavailableError) {
    return Response.json({ code: error.status === 401 ? "UNAUTHORIZED" : "NOT_FOUND", message: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "请求处理失败";
  const status = message.includes("权限") || message.includes("不能审核自己") ? 403
    : message.includes("当前不能") || message.includes("审核通过后") ? 409
      : 400;
  return Response.json({ code: status === 403 ? "FORBIDDEN" : status === 409 ? "CONFLICT" : "INVALID_REQUEST", message }, { status });
}

export function assertAdminConsoleEnabled(): void {
  if (!resolveAdminConsoleConfig(process.env).enabled) {
    throw new AdminConsoleUnavailableError("本地评测后台未启用");
  }
}
