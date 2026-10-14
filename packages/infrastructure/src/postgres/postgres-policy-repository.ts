import type { PolicyRepository } from "../../../application/src/ports.js";
import type { CalculationCriteria } from "../../../contracts/src/calculation-contract.js";
import type { PublishedPolicy } from "../../../domain/src/policy.js";
import type { SqlExecutor } from "./migration-runner.js";
import { mapPublishedPolicy } from "./policy-row-mapper.js";

export class PostgresPolicyRepository implements PolicyRepository {
  constructor(private readonly executor: SqlExecutor) {}

  async findPublished(criteria: CalculationCriteria): Promise<PublishedPolicy | null> {
    const result = await this.executor.query(
      `
        SELECT policy_payload
        FROM policy_versions
        WHERE region = $1
          AND status = 'published'
          AND effective_from <= $2::date
          AND (effective_to IS NULL OR effective_to >= $2::date)
        ORDER BY effective_from DESC, created_at DESC
        LIMIT 1
      `,
      [criteria.region, criteria.calculationDate],
    );

    const payload = result.rows[0]?.policy_payload;
    return payload === undefined ? null : mapPublishedPolicy(payload);
  }
}
