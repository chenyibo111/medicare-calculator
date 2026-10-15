ALTER TABLE policy_sources
  ADD COLUMN artifact_file_name text NOT NULL DEFAULT 'legacy-policy-source.json',
  ADD COLUMN artifact_format text NOT NULL DEFAULT 'json',
  ADD COLUMN artifact_byte_length bigint NOT NULL DEFAULT 0;

ALTER TABLE policy_drafts
  ADD COLUMN extraction jsonb NOT NULL DEFAULT '{"method":"demo_static","adapterVersion":"legacy-seed","aiAssisted":false}'::jsonb;
