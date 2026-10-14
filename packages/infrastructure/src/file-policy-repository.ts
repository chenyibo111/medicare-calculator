import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PolicyRepository } from "../../application/src/ports.js";
import type { CalculationCriteria } from "../../contracts/src/calculation-contract.js";
import type { PublishedPolicy } from "../../domain/src/policy.js";

type StoredPolicy = PublishedPolicy & { readonly status: "draft" | "published" };

export class FilePolicyRepository implements PolicyRepository {
  constructor(private readonly policyDirectory: string) {}

  async findPublished(criteria: CalculationCriteria): Promise<PublishedPolicy | null> {
    const fileNames = await readdir(this.policyDirectory);
    const policies = await Promise.all(fileNames
      .filter((fileName) => fileName.endsWith(".json"))
      .map(async (fileName) => JSON.parse(await readFile(join(this.policyDirectory, fileName), "utf8")) as StoredPolicy));

    const candidates = policies
      .filter((policy) => policy.status === "published")
      .filter((policy) => policy.region === criteria.region)
      .filter((policy) => policy.effectiveFrom <= criteria.calculationDate)
      .sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom));

    return candidates[0] ?? null;
  }
}
