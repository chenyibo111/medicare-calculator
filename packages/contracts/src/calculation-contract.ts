import { z } from "zod";
import type { CalculationResult, CalculationTraceStep } from "../../domain/src/reimbursement-engine.js";
import type { EmploymentStatus, HospitalLevel } from "../../domain/src/policy.js";

const integerFen = (label: string) => z.number({ error: `${label}必须是非负整数分` }).int(`${label}必须是非负整数分`).nonnegative(`${label}必须是非负整数分`);

export const CalculationRequestSchema = z.object({
  region: z.string().min(1, "请选择统筹地区"),
  hospitalLevel: z.enum(["community", "secondary", "tertiary"], { error: "请选择医院等级" }),
  employmentStatus: z.enum(["employed", "retired", "resident"], { error: "请选择参保身份" }),
  totalAmountFen: integerFen("总医疗费用"),
  outOfCatalogAmountFen: integerFen("目录外费用"),
  classBAmountFen: integerFen("乙类费用"),
  annualReimbursedAmountFen: integerFen("年度已报销累计"),
  outOfAreaFiled: z.boolean({ error: "请填写异地备案状态" }),
}).superRefine((value, context) => {
  if (value.outOfCatalogAmountFen > value.totalAmountFen) {
    context.addIssue({ code: "custom", path: ["outOfCatalogAmountFen"], message: "目录外费用不能大于总医疗费用" });
  }
  if (value.classBAmountFen > value.totalAmountFen) {
    context.addIssue({ code: "custom", path: ["classBAmountFen"], message: "乙类费用不能大于总医疗费用" });
  }
  if (value.region === "城市B" && value.employmentStatus !== "resident") {
    context.addIssue({ code: "custom", path: ["employmentStatus"], message: "城市B 仅支持居民医保身份" });
  }
});

export type CalculationRequest = z.infer<typeof CalculationRequestSchema>;

export interface CalculationResponse {
  readonly calculationId: string;
  readonly policyVersion: string;
  readonly cacheStatus: "hit" | "miss";
  readonly result: CalculationResult;
  readonly trace: readonly CalculationTraceStep[];
}

export interface RequestContext {
  readonly requestId?: string;
  readonly calculationDate?: string;
}

export type CalculationCriteria = {
  readonly region: string;
  readonly hospitalLevel: HospitalLevel;
  readonly employmentStatus: EmploymentStatus;
  readonly calculationDate: string;
};

export class CalculationValidationError extends Error {
  readonly code = "VALIDATION_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "CalculationValidationError";
  }
}

export function parseCalculationRequest(value: unknown): CalculationRequest {
  const parsed = CalculationRequestSchema.safeParse(value);
  if (!parsed.success) {
    throw new CalculationValidationError(parsed.error.issues[0]?.message ?? "请求参数不合法");
  }
  return parsed.data;
}
