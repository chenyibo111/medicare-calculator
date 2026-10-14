import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CalculateReimbursementUseCase } from "../../../packages/application/src/calculate-reimbursement";
import { FilePolicyRepository } from "../../../packages/infrastructure/src/file-policy-repository";
import { InMemoryAuditLog } from "../../../packages/infrastructure/src/in-memory-audit-log";
import { TtlPolicyCache } from "../../../packages/infrastructure/src/ttl-policy-cache";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const repository = new FilePolicyRepository(resolve(root, "data/published-policies"));
const cache = new TtlPolicyCache({ ttlMs: 5 * 60_000 });
const auditLog = new InMemoryAuditLog();

export const calculationUseCase = new CalculateReimbursementUseCase({ repository, cache, auditLog });
export { repository };
