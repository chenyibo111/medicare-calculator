import { createHash, randomUUID } from "node:crypto";
import type { PolicyPublicationStore } from "../../../application/src/publish-policy.js";
import type { SqlExecutor } from "./migration-runner.js";
import type { PostgresSqlExecutor } from "./client.js";

function contentHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

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
    const sourceId = randomUUID();
    const draftId = randomUUID();
    const versionId = randomUUID();
    const eventId = randomUUID();

    await executor.query(
      `INSERT INTO policy_sources (id, region, source_url, content_hash, captured_at)
       VALUES ($1::uuid, $2, $3, $4, $5::timestamptz)`,
      [sourceId, publication.policy.region, approvedDraft.source.sourceUrl, contentHash(approvedDraft.source), approvedDraft.approvedAt],
    );
    await executor.query(
      `INSERT INTO policy_drafts (id, source_id, policy_payload, evidence, status)
       VALUES ($1::uuid, $2::uuid, $3::jsonb, $4::jsonb, 'pending_review')`,
      [draftId, sourceId, JSON.stringify(approvedDraft.policy), JSON.stringify([{ approvalId: approvedDraft.approvalId }])],
    );
    await executor.query(
      `INSERT INTO policy_reviews (id, draft_id, reviewer_id, decision, reviewed_at)
       VALUES ($1::uuid, $2::uuid, $3, 'approved', $4::timestamptz)`,
      [randomUUID(), draftId, approvedDraft.reviewer, approvedDraft.approvedAt],
    );

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
  }
}
