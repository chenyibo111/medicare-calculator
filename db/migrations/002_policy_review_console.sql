ALTER TABLE policy_drafts
  DROP CONSTRAINT policy_drafts_status_check,
  ADD COLUMN submitted_by text,
  ADD COLUMN submitted_at timestamptz,
  ADD CONSTRAINT policy_drafts_status_check
    CHECK (status IN ('draft', 'pending_review', 'approved', 'rejected', 'published'));

ALTER TABLE policy_reviews
  ADD COLUMN review_reason text;

CREATE INDEX policy_drafts_review_queue_idx
  ON policy_drafts (status, submitted_at DESC, created_at DESC);

CREATE UNIQUE INDEX policy_reviews_single_decision_per_draft_idx
  ON policy_reviews (draft_id)
  WHERE decision IN ('approved', 'rejected');
