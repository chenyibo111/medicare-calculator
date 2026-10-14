CREATE TABLE policy_sources (
  id uuid PRIMARY KEY,
  region text NOT NULL,
  source_url text NOT NULL,
  content_hash text NOT NULL UNIQUE,
  captured_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE policy_drafts (
  id uuid PRIMARY KEY,
  source_id uuid NOT NULL REFERENCES policy_sources(id),
  policy_payload jsonb NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL CHECK (status = 'pending_review'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE policy_reviews (
  id uuid PRIMARY KEY,
  draft_id uuid NOT NULL REFERENCES policy_drafts(id),
  reviewer_id text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approved', 'rejected')),
  reviewed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE policy_versions (
  id uuid PRIMARY KEY,
  region text NOT NULL,
  benefit_plan text NOT NULL,
  version text NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  status text NOT NULL CHECK (status IN ('published', 'superseded', 'withdrawn')),
  source_id uuid NOT NULL REFERENCES policy_sources(id),
  policy_payload jsonb NOT NULL,
  published_at timestamptz,
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT policy_versions_effective_range_valid
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT policy_versions_region_plan_version_unique
    UNIQUE (region, benefit_plan, version)
);

CREATE INDEX policy_versions_lookup_idx
  ON policy_versions (region, benefit_plan, status, effective_from DESC, effective_to);

CREATE TABLE policy_outbox_events (
  id uuid PRIMARY KEY,
  event_type text NOT NULL,
  aggregate_id uuid NOT NULL REFERENCES policy_versions(id),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX policy_outbox_events_unprocessed_idx
  ON policy_outbox_events (created_at)
  WHERE processed_at IS NULL;

CREATE TABLE calculation_audit_events (
  calculation_id uuid PRIMARY KEY,
  policy_version_id uuid NOT NULL REFERENCES policy_versions(id),
  input_hash text NOT NULL,
  result_hash text NOT NULL,
  cache_status text NOT NULL CHECK (cache_status IN ('hit', 'miss')),
  trace jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX calculation_audit_events_policy_created_idx
  ON calculation_audit_events (policy_version_id, created_at DESC);
