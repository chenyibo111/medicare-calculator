import { randomUUID } from "node:crypto";
import type {
  ApprovedPolicyDraft,
  PendingPolicyDraft,
  PolicyEvidence,
  PolicyExtractionMetadata,
  PolicyReviewGateway,
} from "../../../application/src/publish-policy.js";
import type {
  PolicyDraftReview,
  PolicyReviewDraft,
  PolicyReviewStore,
} from "../../../application/src/policy-review-workflow.js";
import type { PublishedPolicy } from "../../../domain/src/policy.js";
import type { PostgresSqlExecutor } from "./client.js";
import type { SqlExecutor, SqlQueryResult } from "./migration-runner.js";

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null) return value as Record<string, unknown>;
  if (typeof value === "string") return JSON.parse(value) as Record<string, unknown>;
  throw new Error("政策审核数据格式无效");
}

function asArray(value: unknown): unknown[] {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(parsed)) throw new Error("政策审核证据格式无效");
  return parsed;
}

function readString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`政策审核数据缺少 ${key}`);
  return value;
}

function readNullableString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function readIsoTimestamp(row: Record<string, unknown>, key: string): string {
  const value = readString(row, key);
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) throw new Error(`政策审核数据中的 ${key} 不是有效时间`);
  return timestamp.toISOString();
}

function mapExtraction(value: unknown): PolicyExtractionMetadata {
  const extraction = asRecord(value);
  const method = extraction.method;
  const adapterVersion = extraction.adapterVersion;
  const aiAssisted = extraction.aiAssisted;
  if (!(method === "demo_static" || method === "deterministic_json" || method === "ocr_llm") || typeof adapterVersion !== "string" || typeof aiAssisted !== "boolean") {
    throw new Error("政策审核提取元数据无效");
  }
  return { method, adapterVersion, aiAssisted };
}

function mapDraft(result: SqlQueryResult): PolicyReviewDraft | null {
  const row = result.rows[0];
  if (row === undefined) return null;
  const status = readString(row, "status");
  if (!(["draft", "pending_review", "approved", "rejected", "published"] as const).includes(status as never)) {
    throw new Error("政策审核草稿状态无效");
  }
  const reviewId = readNullableString(row, "review_id");
  const review: PolicyDraftReview | null = reviewId === null ? null : {
    id: reviewId,
    reviewerId: readString(row, "reviewer_id"),
    decision: readString(row, "decision") as "approved" | "rejected",
    reason: readNullableString(row, "review_reason"),
    reviewedAt: readString(row, "reviewed_at"),
  };
  const extraction = mapExtraction(row.extraction);
  return {
    id: readString(row, "id"),
    status: status as PolicyReviewDraft["status"],
    ...(extraction.method === "demo_static" ? { demoAIProposal: true as const } : {}),
    source: {
      sourceId: readString(row, "source_id"),
      region: readString(row, "region"),
      sourceUrl: readString(row, "source_url"),
      capturedAt: readIsoTimestamp(row, "captured_at"),
      artifact: {
        fileName: readString(row, "artifact_file_name"),
        format: "json",
        sha256: readString(row, "content_hash"),
        byteLength: Number(row.artifact_byte_length),
      },
    },
    policy: asRecord(row.policy_payload) as unknown as PublishedPolicy,
    evidence: asArray(row.evidence) as PolicyEvidence[],
    extraction,
    submittedBy: readNullableString(row, "submitted_by"),
    submittedAt: readNullableString(row, "submitted_at"),
    review,
  };
}

async function fetchDraft(executor: SqlExecutor, draftId: string, forUpdate = false): Promise<PolicyReviewDraft | null> {
  const lock = forUpdate ? " FOR UPDATE OF d" : "";
  const result = await executor.query(
    `SELECT d.id::text, d.status, d.submitted_by, d.submitted_at::text, d.policy_payload, d.evidence, d.extraction,
            s.id::text AS source_id, s.region, s.source_url, s.captured_at::text, s.content_hash, s.artifact_file_name, s.artifact_format, s.artifact_byte_length,
            r.id::text AS review_id, r.reviewer_id, r.decision, r.review_reason, r.reviewed_at::text
     FROM policy_drafts d
     JOIN policy_sources s ON s.id = d.source_id
     LEFT JOIN policy_reviews r ON r.draft_id = d.id
     WHERE d.id = $1::uuid${lock}`,
    [draftId],
  );
  return mapDraft(result);
}

export async function loadApprovedPolicyDraft(
  executor: SqlExecutor,
  draftId: string,
  forUpdate = false,
): Promise<ApprovedPolicyDraft | null> {
  const draft = await fetchDraft(executor, draftId, forUpdate);
  if (draft?.status !== "approved" || draft.review?.decision !== "approved") return null;
  return {
    id: draft.id,
    status: "approved",
    demoAIProposal: draft.demoAIProposal,
    source: draft.source,
    policy: draft.policy,
    evidence: draft.evidence,
    extraction: draft.extraction,
    approvalId: draft.review.id,
    reviewer: draft.review.reviewerId,
    approvedAt: draft.review.reviewedAt,
  };
}

export class PostgresPolicyReviewStore implements PolicyReviewStore, PolicyReviewGateway {
  constructor(private readonly database: PostgresSqlExecutor) {}

  async createDraft(input: Parameters<PolicyReviewStore["createDraft"]>[0]): Promise<PolicyReviewDraft> {
    await this.database.transaction(async (executor) => {
      await executor.query(
        `INSERT INTO policy_sources (
           id, region, source_url, content_hash, captured_at, artifact_file_name, artifact_format, artifact_byte_length
         ) VALUES ($1::uuid, $2, $3, $4, $5::timestamptz, $6, $7, $8)
         ON CONFLICT (content_hash) DO NOTHING
         RETURNING id`,
        [input.source.sourceId, input.source.region, input.source.sourceUrl, input.source.artifact.sha256, input.source.capturedAt, input.source.artifact.fileName, input.source.artifact.format, input.source.artifact.byteLength],
      );
      const source = await executor.query(
        "SELECT id FROM policy_sources WHERE id = $1::uuid",
        [input.source.sourceId],
      );
      if (source.rows.length === 0) throw new Error("该政策源内容已导入");
      await executor.query(
        `INSERT INTO policy_drafts (id, source_id, policy_payload, evidence, extraction, status)
         VALUES ($1::uuid, $2::uuid, $3::jsonb, $4::jsonb, $5::jsonb, 'draft')`,
        [input.id, input.source.sourceId, JSON.stringify(input.policy), JSON.stringify(input.evidence), JSON.stringify(input.extraction)],
      );
    });
    const draft = await this.getDraft(input.id);
    if (draft === null) throw new Error("政策草稿创建失败");
    return draft;
  }

  async getDraft(draftId: string): Promise<PolicyReviewDraft | null> {
    return fetchDraft(this.database, draftId);
  }

  async listDrafts(): Promise<readonly PolicyReviewDraft[]> {
    const result = await this.database.query(
      `SELECT d.id::text, d.status, d.submitted_by, d.submitted_at::text, d.policy_payload, d.evidence, d.extraction,
              s.id::text AS source_id, s.region, s.source_url, s.captured_at::text, s.content_hash, s.artifact_file_name, s.artifact_format, s.artifact_byte_length,
              r.id::text AS review_id, r.reviewer_id, r.decision, r.review_reason, r.reviewed_at::text
       FROM policy_drafts d
       JOIN policy_sources s ON s.id = d.source_id
       LEFT JOIN policy_reviews r ON r.draft_id = d.id
       ORDER BY d.submitted_at DESC NULLS LAST, d.created_at DESC`,
    );
    return result.rows.map((row) => mapDraft({ rows: [row] })!).filter((draft): draft is PolicyReviewDraft => draft !== null);
  }

  async submitDraft(input: Parameters<PolicyReviewStore["submitDraft"]>[0]): Promise<PolicyReviewDraft> {
    const updated = await this.database.query(
      `UPDATE policy_drafts
       SET status = 'pending_review', submitted_by = $2, submitted_at = $3::timestamptz
       WHERE id = $1::uuid AND status = 'draft'
       RETURNING id`,
      [input.draftId, input.submittedBy, input.submittedAt],
    );
    if (updated.rows.length === 0) throw new Error("草稿当前不能提交审核");
    const draft = await this.getDraft(input.draftId);
    if (draft === null) throw new Error("草稿当前不能提交审核");
    return draft;
  }

  async decideDraft(input: Parameters<PolicyReviewStore["decideDraft"]>[0]): Promise<PolicyReviewDraft> {
    await this.database.transaction(async (executor) => {
      const updated = await executor.query(
        `UPDATE policy_drafts
         SET status = $3
         WHERE id = $1::uuid AND status = 'pending_review' AND submitted_by IS DISTINCT FROM $2
         RETURNING id`,
        [input.draftId, input.reviewerId, input.decision],
      );
      if (updated.rows.length === 0) {
        const existing = await fetchDraft(executor, input.draftId);
        if (existing?.submittedBy === input.reviewerId) throw new Error("不能审核自己提交的草稿");
        throw new Error("草稿当前不能审核");
      }
      await executor.query(
        `INSERT INTO policy_reviews (id, draft_id, reviewer_id, decision, review_reason, reviewed_at)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::timestamptz)`,
        [randomUUID(), input.draftId, input.reviewerId, input.decision, input.reason, input.reviewedAt],
      );
    });
    const draft = await this.getDraft(input.draftId);
    if (draft === null) throw new Error("草稿当前不能审核");
    return draft;
  }

  async getApprovedDraft(draftId: string): Promise<ApprovedPolicyDraft | null> {
    return loadApprovedPolicyDraft(this.database, draftId);
  }

  async approve(_draft: PendingPolicyDraft, _reviewer: string): Promise<ApprovedPolicyDraft> {
    throw new Error("持久化审核请通过 PolicyReviewWorkflow 的审批动作执行");
  }

  async verifyApproved(draft: ApprovedPolicyDraft): Promise<void> {
    const approved = await this.getApprovedDraft(draft.id);
    if (
      approved === null
      || approved.approvalId !== draft.approvalId
      || approved.reviewer !== draft.reviewer
      || approved.policy.version !== draft.policy.version
    ) {
      throw new Error("审核凭证无效，不能发布政策");
    }
  }
}
