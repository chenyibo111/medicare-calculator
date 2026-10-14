INSERT INTO policy_sources (id, region, source_url, content_hash, captured_at)
VALUES
  ('00000000-0000-4000-8000-0000000000a1', '城市A', 'https://example.invalid/policies/city-a-2026-01', 'demo-city-a-2026-01', '2026-01-01T00:00:00Z'),
  ('00000000-0000-4000-8000-0000000000b1', '城市B', 'https://example.invalid/policies/city-b-2026-01', 'demo-city-b-2026-01', '2026-01-01T00:00:00Z')
ON CONFLICT (content_hash) DO NOTHING;

INSERT INTO policy_drafts (id, source_id, policy_payload, evidence, status)
VALUES
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a1', '{"region":"城市A","benefitPlan":"职工医保","version":"A-2026.01"}'::jsonb, '[{"type":"demo-source","reference":"城市 A 示例政策"}]'::jsonb, 'pending_review'),
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000b1', '{"region":"城市B","benefitPlan":"职工医保","version":"B-2026.01"}'::jsonb, '[{"type":"demo-source","reference":"城市 B 示例政策"}]'::jsonb, 'pending_review')
ON CONFLICT (id) DO NOTHING;

INSERT INTO policy_reviews (id, draft_id, reviewer_id, decision, reviewed_at)
VALUES
  ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000a2', 'demo-reviewer-a', 'approved', '2026-01-02T00:00:00Z'),
  ('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000b2', 'demo-reviewer-b', 'approved', '2026-01-02T00:00:00Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO policy_versions (
  id, region, benefit_plan, version, effective_from, effective_to, status, source_id, policy_payload, published_at
)
VALUES
  (
    '00000000-0000-4000-8000-0000000000a4', '城市A', '职工医保', 'A-2026.01', '2026-01-01', NULL, 'published',
    '00000000-0000-4000-8000-0000000000a1',
    '{"region":"城市A","benefitPlan":"职工医保","version":"A-2026.01","effectiveFrom":"2026-01-01","sourceReference":"示例城市 A 医保政策","hospitalRules":{"community":{"deductibleFen":20000,"reimbursementRateBps":9000},"secondary":{"deductibleFen":40000,"reimbursementRateBps":8500},"tertiary":{"deductibleFen":80000,"reimbursementRateBps":8000}},"classBAdvanceRateBps":1000,"annualCapFen":40000000,"retirementBonusBps":500,"unfiledOutOfAreaReductionBps":2000,"catastrophicTiers":[{"upperBoundFen":5000000,"reimbursementRateBps":6000},{"upperBoundFen":10000000,"reimbursementRateBps":6500},{"upperBoundFen":null,"reimbursementRateBps":7000}]}'::jsonb,
    '2026-01-02T00:00:00Z'
  ),
  (
    '00000000-0000-4000-8000-0000000000b4', '城市B', '职工医保', 'B-2026.01', '2026-01-01', NULL, 'published',
    '00000000-0000-4000-8000-0000000000b1',
    '{"region":"城市B","benefitPlan":"职工医保","version":"B-2026.01","effectiveFrom":"2026-01-01","sourceReference":"示例城市 B 医保政策","hospitalRules":{"community":{"deductibleFen":10000,"reimbursementRateBps":8500},"secondary":{"deductibleFen":30000,"reimbursementRateBps":7500},"tertiary":{"deductibleFen":60000,"reimbursementRateBps":6500}},"classBAdvanceRateBps":1500,"annualCapFen":20000000,"retirementBonusBps":0,"unfiledOutOfAreaReductionBps":1500,"catastrophicTiers":[]}'::jsonb,
    '2026-01-02T00:00:00Z'
  )
ON CONFLICT (region, benefit_plan, version) DO NOTHING;
