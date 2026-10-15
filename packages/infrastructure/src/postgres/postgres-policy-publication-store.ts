import { randomUUID } from "node:crypto";
import type { PolicyPublicationStore } from "../../../application/src/publish-policy.js";
import type { SqlExecutor } from "./migration-runner.js";
import type { PostgresSqlExecutor } from "./client.js";
import { loadApprovedPolicyDraft } from "./postgres-policy-review-store.js";

export class PostgresPolicyPublicationStore implements PolicyPublicationStore {
  constructor(private readonly database: PostgresSqlExecutor) {}

  async publishApprovedVersion(
    input: Parameters<PolicyPublicationStore["publishApprovedVersion"]>[0],
  ): Promise<void> {
    await this.database.transaction(async (executor) => {
      await this.persistPublication(executor, input);
    });
  }

  private async persistPublication(
    executor: SqlExecutor,
    { approvedDraft, publication }: Parameters<PolicyPublicationStore["publishApprovedVersion"]>[0],
  ): Promise<void> {
    const persistedDraft = await loadApprovedPolicyDraft(executor, approvedDraft.id, true);
    if (
      persistedDraft === null
      || persistedDraft.approvalId !== approvedDraft.approvalId
      || persistedDraft.reviewer !== approvedDraft.reviewer
      || persistedDraft.policy.version !== approvedDraft.policy.version
    ) {
      throw new Error("审核凭证无效，不能发布政策");
    }

    const sourceId = persistedDraft.source.sourceId;
    const versionId = randomUUID();
    const eventId = randomUUID();

    const overlapping = await executor.query(
      `SELECT id, version
       FROM policy_versions
       WHERE region = $1 AND benefit_plan = $2 AND status = 'published'
         AND (effective_to IS NULL OR effective_to >= $3::date)
         AND ($4::date IS NULL OR effective_from <= $4::date)
       FOR UPDATE`,
      [publication.policy.region, publication.policy.benefitPlan, publication.policy.effectiveFrom, publication.policy.effectiveTo ?? null],
    );
    const previousPolicyVersion = typeof overlapping.rows[0]?.version === "string"
      ? overlapping.rows[0].version
      : null;

    if (overlapping.rows.length > 0) {
      await executor.query(
        "UPDATE policy_versions SET status = 'superseded', superseded_at = now() WHERE id = ANY($1::uuid[])",
        [overlapping.rows.map((row) => row.id)],
      );
    }

    await executor.query(
      `INSERT INTO policy_versions (
        id, region, benefit_plan, version, effective_from, effective_to, status, source_id, policy_payload, published_at
      ) VALUES ($1::uuid, $2, $3, $4, $5::date, $6::date, 'published', $7::uuid, $8::jsonb, now())`,
      [versionId, publication.policy.region, publication.policy.benefitPlan, publication.policy.version, publication.policy.effectiveFrom, publication.policy.effectiveTo ?? null, sourceId, JSON.stringify(publication.policy)],
    );
    await executor.query(
      `INSERT INTO policy_outbox_events (id, event_type, aggregate_id, payload)
       VALUES ($1::uuid, 'policy.published', $2::uuid, $3::jsonb)`,
      [eventId, versionId, JSON.stringify({ ...publication.event, previousPolicyVersion })],
    );
    const published = await executor.query(
      "UPDATE policy_drafts SET status = 'published' WHERE id = $1::uuid AND status = 'approved' RETURNING id",
      [approvedDraft.id],
    );
    if (published.rows.length === 0) throw new Error("审核通过后才能发布政策");
  }
}
