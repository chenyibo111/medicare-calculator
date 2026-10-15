import type {
  CapturedPolicySource,
  PendingPolicyDraft,
  PolicyEvidence,
  PolicyExtractionAdapter,
} from "../../application/src/publish-policy.js";
import type { PublishedPolicy } from "../../domain/src/policy.js";

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function stringAt(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") throw new Error(`受控政策源缺少 ${key}`);
  return value;
}

function numberAt(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isInteger(value)) throw new Error(`受控政策源的 ${key} 必须为整数`);
  return value;
}

function evidence(field: string, value: unknown, sourceSha256: string): PolicyEvidence {
  return { field, locator: `$.${field}`, excerpt: JSON.stringify(value), sourceSha256 };
}

export class DeterministicJsonExtractionAdapter implements PolicyExtractionAdapter {
  async propose(source: CapturedPolicySource): Promise<PendingPolicyDraft> {
    const document = asRecord(JSON.parse(source.rawDocument), "受控政策源必须是 JSON 对象");
    const policyRecord = asRecord(document.policy, "受控政策源缺少 policy 对象");
    const hospitalRules = asRecord(policyRecord.hospitalRules, "受控政策源缺少 hospitalRules 对象");
    const hospitalRule = (level: "community" | "secondary" | "tertiary") => {
      const rule = asRecord(hospitalRules[level], `受控政策源缺少 ${level} 医院规则`);
      return { deductibleFen: numberAt(rule, "deductibleFen"), reimbursementRateBps: numberAt(rule, "reimbursementRateBps") };
    };
    const catastrophicTiers = policyRecord.catastrophicTiers;
    if (!Array.isArray(catastrophicTiers)) throw new Error("受控政策源的 catastrophicTiers 必须为数组");
    const policy: PublishedPolicy = {
      region: stringAt(policyRecord, "region"),
      benefitPlan: stringAt(policyRecord, "benefitPlan") as PublishedPolicy["benefitPlan"],
      version: stringAt(policyRecord, "version"),
      effectiveFrom: stringAt(policyRecord, "effectiveFrom"),
      sourceReference: stringAt(policyRecord, "sourceReference"),
      hospitalRules: { community: hospitalRule("community"), secondary: hospitalRule("secondary"), tertiary: hospitalRule("tertiary") },
      classBAdvanceRateBps: numberAt(policyRecord, "classBAdvanceRateBps"),
      annualCapFen: numberAt(policyRecord, "annualCapFen"),
      retirementBonusBps: numberAt(policyRecord, "retirementBonusBps"),
      unfiledOutOfAreaReductionBps: numberAt(policyRecord, "unfiledOutOfAreaReductionBps"),
      catastrophicTiers: catastrophicTiers as PublishedPolicy["catastrophicTiers"],
    };
    if (policy.region !== source.region) throw new Error("政策来源地区与政策规则地区不一致");
    const fields: Array<[string, unknown]> = [
      ["policy.version", policy.version], ["policy.effectiveFrom", policy.effectiveFrom],
      ["policy.hospitalRules.community.deductibleFen", policy.hospitalRules.community.deductibleFen],
      ["policy.hospitalRules.community.reimbursementRateBps", policy.hospitalRules.community.reimbursementRateBps],
      ["policy.hospitalRules.secondary.deductibleFen", policy.hospitalRules.secondary.deductibleFen],
      ["policy.hospitalRules.secondary.reimbursementRateBps", policy.hospitalRules.secondary.reimbursementRateBps],
      ["policy.hospitalRules.tertiary.deductibleFen", policy.hospitalRules.tertiary.deductibleFen],
      ["policy.hospitalRules.tertiary.reimbursementRateBps", policy.hospitalRules.tertiary.reimbursementRateBps],
      ["policy.classBAdvanceRateBps", policy.classBAdvanceRateBps], ["policy.annualCapFen", policy.annualCapFen],
      ["policy.retirementBonusBps", policy.retirementBonusBps], ["policy.unfiledOutOfAreaReductionBps", policy.unfiledOutOfAreaReductionBps],
      ["policy.catastrophicTiers", policy.catastrophicTiers],
    ];
    return {
      id: `draft-${source.sourceId}`,
      status: "pending_review",
      source: { sourceId: source.sourceId, region: source.region, sourceUrl: source.sourceUrl, capturedAt: source.capturedAt, artifact: source.artifact },
      policy,
      evidence: fields.map(([field, value]) => evidence(field, value, source.artifact.sha256)),
      extraction: { method: "deterministic_json", adapterVersion: "1.0.0", aiAssisted: false },
    };
  }
}
