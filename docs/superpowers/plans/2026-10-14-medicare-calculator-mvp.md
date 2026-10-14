# 医保报销计算器 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建可直接打开的离线报销演示 H5，以及可通过 Next.js API 与后端交互的服务版，并保留从政策采集到生产基础设施替换的清晰入口。

**Architecture:** 采用 npm workspaces。领域层、应用层和 API 契约置于共享包中；离线版把共享领域层和只读政策快照打包为静态资产，服务版的浏览器仅调用 Next.js API。文件政策仓库、TTL 缓存、审计和模拟 Worker 实现基础设施端口，后续可在不改用例和领域规则的前提下替换为生产适配器。

**Tech Stack:** Node.js 20+, TypeScript 5.9, Next.js 15.5, React 19, Zod 4, Vitest 3, Playwright 1.55, esbuild。

**Spec:** [医保报销计算器 MVP 设计](../specs/2026-10-14-medicare-calculator-mvp-design.md)

## Global Constraints

- 仅使用示例城市 A/B 的住院报销政策；所有页面必须标注“示例政策，仅供演示”。
- 所有领域金额使用整数分，显示层才格式化为人民币两位小数。
- 报销金额必须来自 `ReimbursementEngine`，不得由 Next API 路由或前端复制公式。
- AI 提取适配器只能生成待审核草稿；只有 `PolicyPublisher` 能发布政策。
- 离线版不访问网络、不宣称实时政策；服务版页面不得导入已发布政策数据。
- 生产组件替换只能发生在基础设施端口实现层；API DTO、用例和领域层保持兼容。
- 不接入真实个人信息、真实医保结算、真实政府网站、真实 LLM、Redis 或数据库。
- 所有用户可见文案使用简体中文，表单具有可访问标签、就近错误和键盘焦点。

## Review Focus

- 金额为小数元时必须精确转换为分，且最终金额无浮点误差；由 Task 2 的金额与引擎测试覆盖。
- 目录外费用或乙类费用超过总费用、负数金额、城市 B 的退休状态必须得到可恢复错误，不得产生猜测金额；由 Task 3 的请求验证测试覆盖。
- 年度累计已超过封顶线时，城市 A 只可按已配置大病保险阶梯处理超额理论报销，城市 B 不得编造大病保险；由 Task 2 的边界测试覆盖。
- 发布新政策版本后，同一计算条件不得继续读取旧缓存；由 Task 4 的缓存失效集成测试覆盖。
- 服务版页面不得含有政策比例或计算公式，也不得在 API 失败时退化到浏览器自行计算；由 Task 7 的 API 驱动 UI 与浏览器测试覆盖。

---

## File Structure

```text
package.json                              workspace scripts and pinned tooling
tsconfig.base.json                         shared TypeScript compiler settings
vitest.workspace.ts                        root test projects
apps/
  offline-demo/
    src/index.html                         static page shell
    src/main.ts                            form state and domain invocation
    src/styles.css                         responsive presentation
    src/policy-snapshot.ts                 offline-only published policy snapshot adapter
    dist/                                  generated, browser-openable output
  service-web/
    app/page.tsx                           API-driven calculator and design view
    app/api/v1/reimbursement-calculations/route.ts
    app/api/v1/policy-status/route.ts
    app/globals.css
    server/composition-root.ts             server-only dependency injection
packages/
  domain/src/
    money.ts                               integer-fen helpers
    policy.ts                              immutable policy types and matching
    reimbursement-engine.ts                pure calculation and trace
  contracts/src/
    calculation-contract.ts                request/response schemas and DTOs
  application/src/
    ports.ts                               repository/cache/audit/worker interfaces
    calculate-reimbursement.ts             online calculation use case
    publish-policy.ts                      reviewed-policy publication use case
  infrastructure/src/
    file-policy-repository.ts              local published-policy adapter
    ttl-policy-cache.ts                    in-memory TTL cache adapter
    in-memory-audit-log.ts                 auditable local event adapter
    local-policy-source.ts                 local raw-source adapter
    demo-extraction-adapter.ts             no-network draft proposal adapter
    local-review-gateway.ts                review gate adapter
data/
  raw-policy-sources/                      source fixtures
  policy-drafts/                           generated draft fixtures
  published-policies/                      approved A/B versioned policies
worker/src/run-policy-pipeline.ts          offline pipeline CLI
scripts/build-offline.mjs                  esbuild static bundle command
tests/
  domain/reimbursement-engine.test.ts
  application/calculate-reimbursement.test.ts
  infrastructure/policy-cache.test.ts
  worker/policy-pipeline.test.ts
  api/calculation-route.test.ts
  e2e/offline-and-service.spec.ts
docs/
  architecture.md                          component boundaries and replacement matrix
  demo-scenarios.md                        assessor walkthrough
README.md                                  install, run, verify, and scope
```

### Task 1: Initialize workspace and executable toolchain

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `vitest.workspace.ts`, `.gitignore`
- Create: `apps/offline-demo/src/index.html`, `apps/service-web/package.json`, `scripts/build-offline.mjs`
- Create: `README.md`

**Interfaces:**
- Produces: npm workspace names `@medicare/domain`, `@medicare/contracts`, `@medicare/application`, `@medicare/infrastructure`, `@medicare/service-web`.
- Produces: `npm run test`, `npm run build:offline`, `npm run dev:service`, `npm run worker:demo`, and `npm run verify`.

- [ ] **Step 1: Write a failing toolchain smoke test**

Create `tests/toolchain/workspace.test.ts` asserting the root package scripts and all four package names exist.

- [ ] **Step 2: Run the smoke test to verify it fails**

Run: `npm test -- --run tests/toolchain/workspace.test.ts`  
Expected: FAIL because workspace configuration is absent.

- [ ] **Step 3: Add workspace configuration and pinned dependencies**

Configure npm workspaces for `apps/*` and `packages/*`; pin Node 20+, Next.js 15.5, React 19, TypeScript 5.9, Zod 4, Vitest 3, Playwright 1.55 and esbuild. Add scripts that build a browser-openable offline bundle and start the service edition without importing data into the client.

- [ ] **Step 4: Run the smoke test and build command**

Run: `npm test -- --run tests/toolchain/workspace.test.ts && npm run build:offline`  
Expected: PASS; `apps/offline-demo/dist/index.html` exists.

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.base.json vitest.workspace.ts .gitignore apps/offline-demo scripts tests/toolchain README.md
git commit -m "chore: scaffold dual-mode medicare workspace"
```

### Task 2: Implement the shared policy model and deterministic rule engine

**Files:**
- Create: `packages/domain/package.json`
- Create: `packages/domain/src/money.ts`, `packages/domain/src/policy.ts`, `packages/domain/src/reimbursement-engine.ts`, `packages/domain/src/index.ts`
- Create: `data/published-policies/city-a.v1.json`, `data/published-policies/city-b.v1.json`
- Test: `tests/domain/reimbursement-engine.test.ts`

**Interfaces:**
- Produces: `ReimbursementEngine.calculate(policy: PublishedPolicy, request: ValidatedCalculationInput): CalculationResult`.
- Produces: `yuanToFen(value: string): number`, `formatFen(value: number): string`, and `matchPolicy(policy, request): MatchedRuleSet`.
- Consumed by: Tasks 3, 5, 6, 7, and 8.

- [ ] **Step 1: Write failing gold-case tests**

Cover city A tertiary employed and retired cases, city B tertiary resident case, unfiled out-of-area reduction, class-B advance payment, prior reimbursement at the cap, and all city A catastrophic tiers. Assert each trace step and all amounts are integer fen.

- [ ] **Step 2: Run the domain tests to verify they fail**

Run: `npm test -- --run tests/domain/reimbursement-engine.test.ts`  
Expected: FAIL because the domain package and policy fixtures do not exist.

- [ ] **Step 3: Implement immutable policy and money types**

Define `PublishedPolicy` with region, benefit plan, effective period, version, source reference, hospital-level rules, class-B percentage, cap and optional tier list. Reject unsupported condition combinations before calculation.

- [ ] **Step 4: Implement `ReimbursementEngine.calculate`**

Implement the eight calculation steps from the spec using integer arithmetic and stable trace records. Apply city A’s 5-point retirement addition and both cities’ unfiled reduction. Treat city B’s absent catastrophic tier list as zero reimbursement with an explicit trace label.

- [ ] **Step 5: Run domain tests and property tests**

Run: `npm test -- --run tests/domain/reimbursement-engine.test.ts`  
Expected: PASS; no result is negative, no reimbursement exceeds total cost, and higher annual reimbursement cannot increase basic reimbursement.

- [ ] **Step 6: Commit**

```bash
git add packages/domain data/published-policies tests/domain
git commit -m "feat: add deterministic reimbursement domain engine"
```

### Task 3: Define calculation contracts and the application use case

**Files:**
- Create: `packages/contracts/package.json`, `packages/contracts/src/calculation-contract.ts`, `packages/contracts/src/index.ts`
- Create: `packages/application/package.json`, `packages/application/src/ports.ts`, `packages/application/src/calculate-reimbursement.ts`, `packages/application/src/index.ts`
- Test: `tests/application/calculate-reimbursement.test.ts`

**Interfaces:**
- Produces: `CalculationRequestSchema`, `CalculationResponse`, and `CalculateReimbursementUseCase.execute(request: CalculationRequest, context: RequestContext): Promise<CalculationResponse>`.
- Consumes: Task 2 `ReimbursementEngine.calculate` and ports `PolicyRepository`, `PolicyCache`, `AuditLog`.
- Consumed by: Tasks 4, 6, and 7.

- [ ] **Step 1: Write failing validation and use-case tests**

Assert that negative amounts, catalog amounts exceeding total amount, city B retirement selection, unknown regions, and malformed money fields return a typed Chinese validation error. Assert a valid request returns version, cache status, calculation ID, result and trace.

- [ ] **Step 2: Run the application tests to verify they fail**

Run: `npm test -- --run tests/application/calculate-reimbursement.test.ts`  
Expected: FAIL because contracts and the use case are absent.

- [ ] **Step 3: Define DTO schemas and infrastructure ports**

Use Zod only at the contract boundary. Define `PolicyRepository.findPublished(criteria)`, `PolicyCache.getOrLoad(key, loader)`, `PolicyCache.invalidateByPolicyVersion(version)`, and `AuditLog.append(event)` in `ports.ts`.

- [ ] **Step 4: Implement the calculation use case**

Validate input, construct a deterministic policy lookup key, load only published policy through the cache port, call the shared engine, append an audit event, and return the typed response. Do not expose policy percentage fields beyond the trace descriptions.

- [ ] **Step 5: Run application tests**

Run: `npm test -- --run tests/application/calculate-reimbursement.test.ts`  
Expected: PASS; invalid requests never call the engine and valid requests never accept a client-supplied rule.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts packages/application tests/application
git commit -m "feat: add calculation contract and use case"
```

### Task 4: Add file-backed policy, TTL cache, and audit adapters

**Files:**
- Create: `packages/infrastructure/package.json`
- Create: `packages/infrastructure/src/file-policy-repository.ts`, `packages/infrastructure/src/ttl-policy-cache.ts`, `packages/infrastructure/src/in-memory-audit-log.ts`, `packages/infrastructure/src/index.ts`
- Test: `tests/infrastructure/policy-cache.test.ts`

**Interfaces:**
- Produces: `FilePolicyRepository`, `TtlPolicyCache`, and `InMemoryAuditLog` implementations for Task 3 ports.
- Consumed by: Tasks 5, 6, and 7.

- [ ] **Step 1: Write failing infrastructure tests**

Assert that the repository returns only a policy marked published and effective for the supplied date; first lookup reports `miss`, second reports `hit`, expiry reloads, and invalidating a policy version forces a miss.

- [ ] **Step 2: Run infrastructure tests to verify they fail**

Run: `npm test -- --run tests/infrastructure/policy-cache.test.ts`  
Expected: FAIL because the adapters are absent.

- [ ] **Step 3: Implement adapters behind the application ports**

Read versioned JSON from `data/published-policies`; isolate filesystem access to the repository. Implement an injectable-clock TTL map and append-only local audit event store. The cache key must include region, plan, effective date and policy version.

- [ ] **Step 4: Run infrastructure tests**

Run: `npm test -- --run tests/infrastructure/policy-cache.test.ts`  
Expected: PASS; a version invalidation cannot return stale cached data.

- [ ] **Step 5: Commit**

```bash
git add packages/infrastructure tests/infrastructure
git commit -m "feat: add local policy repository cache and audit adapters"
```

### Task 5: Implement the offline policy pipeline with review gate

**Files:**
- Create: `data/raw-policy-sources/city-a-source.json`, `data/raw-policy-sources/city-b-source.json`
- Create: `packages/infrastructure/src/local-policy-source.ts`, `packages/infrastructure/src/demo-extraction-adapter.ts`, `packages/infrastructure/src/local-review-gateway.ts`
- Create: `packages/application/src/publish-policy.ts`, `worker/src/run-policy-pipeline.ts`
- Test: `tests/worker/policy-pipeline.test.ts`

**Interfaces:**
- Produces: `PolicySourceConnector.fetch(sourceConfig)`, `PolicyExtractionAdapter.propose(rawSource)`, `PolicyReviewGateway.approve(draft, reviewer)`, and `PolicyPublisher.publish(approvedDraft)`.
- Consumes: Task 4 repository and cache invalidation port.
- Consumed by: Task 9 documentation and the service design view.

- [ ] **Step 1: Write failing policy-pipeline tests**

Assert that an extraction proposal has source references and a `pending_review` state, publishing an unapproved draft fails, approving it publishes a versioned policy, and publication calls cache invalidation.

- [ ] **Step 2: Run worker tests to verify they fail**

Run: `npm test -- --run tests/worker/policy-pipeline.test.ts`  
Expected: FAIL because no source, review gate or publisher exists.

- [ ] **Step 3: Implement local source, proposal, review and publication adapters**

The extraction adapter must be deterministic and carry a visible `demoAIProposal: true` marker. The reviewer must require a non-empty reviewer identity. Only an approved draft is written to the published-policy location and invalidates the policy cache.

- [ ] **Step 4: Implement the worker CLI**

Add `npm run worker:demo` to execute the pipeline against fixtures and print source, draft, reviewer, published version and invalidation outcomes without contacting external services.

- [ ] **Step 5: Run worker tests and CLI**

Run: `npm test -- --run tests/worker/policy-pipeline.test.ts && npm run worker:demo`  
Expected: PASS; CLI output shows an approved, published version and cache invalidation.

- [ ] **Step 6: Commit**

```bash
git add data/raw-policy-sources packages/application packages/infrastructure worker tests/worker package.json
git commit -m "feat: add reviewed policy publication pipeline"
```

### Task 6: Expose the server-side API with Next.js composition root

**Files:**
- Create: `apps/service-web/next.config.ts`, `apps/service-web/tsconfig.json`, `apps/service-web/app/api/v1/reimbursement-calculations/route.ts`, `apps/service-web/app/api/v1/policy-status/route.ts`
- Create: `apps/service-web/server/composition-root.ts`
- Test: `tests/api/calculation-route.test.ts`

**Interfaces:**
- Produces: `POST /api/v1/reimbursement-calculations` and `GET /api/v1/policy-status`.
- Consumes: Task 3 `CalculateReimbursementUseCase` and Task 4 adapter implementations.
- Consumed by: Task 8 front-end page.

- [ ] **Step 1: Write failing API tests**

Assert a valid POST returns 200 with the calculation contract, invalid input returns a Chinese 400 response, and a second identical POST returns `cacheStatus: "hit"`. Assert the response excludes raw policy files and policy mutation endpoints.

- [ ] **Step 2: Run API tests to verify they fail**

Run: `npm test -- --run tests/api/calculation-route.test.ts`  
Expected: FAIL because routes and composition root do not exist.

- [ ] **Step 3: Implement a server-only composition root and thin routes**

Construct the repository, cache, audit log and use case only in `server/composition-root.ts`. Route handlers parse JSON, call the use case and translate typed errors to HTTP. Do not import `data/` or `ReimbursementEngine` directly from route files.

- [ ] **Step 4: Run API tests and start the service**

Run: `npm test -- --run tests/api/calculation-route.test.ts && npm run dev:service`  
Expected: PASS; manual POST returns calculation ID, policy version, trace and cache state.

- [ ] **Step 5: Commit**

```bash
git add apps/service-web tests/api package.json
git commit -m "feat: expose server reimbursement calculation API"
```

### Task 7: Build the browser-openable offline H5

**Files:**
- Create: `apps/offline-demo/src/main.ts`, `apps/offline-demo/src/policy-snapshot.ts`, `apps/offline-demo/src/styles.css`
- Modify: `apps/offline-demo/src/index.html`
- Modify: `scripts/build-offline.mjs`
- Test: `tests/e2e/offline-and-service.spec.ts`

**Interfaces:**
- Consumes: Task 2 domain package and the approved city A/B snapshots.
- Produces: `apps/offline-demo/dist/index.html` with no runtime network requests.
- Consumed by: Task 9 demonstration documentation.

- [ ] **Step 1: Write a failing browser test**

Assert the offline page labels the policy as a demo, city A/B sample buttons populate fields, validation is shown next to invalid fields, and calculating a city A sample renders exact summary and trace values without network calls.

- [ ] **Step 2: Run the offline browser test to verify it fails**

Run: `npm run test:e2e -- --project=offline`  
Expected: FAIL because the static UI is absent.

- [ ] **Step 3: Implement the offline screen**

Use semantic form controls for city, status, hospital level, amounts and filing status. Bundle the shared engine and a dedicated read-only snapshot with esbuild. Keep policy percentages out of normal controls; results show total, self-pay, basic insurance, catastrophic insurance and expandable trace.

- [ ] **Step 4: Implement responsive visual design**

Use a calm healthcare-oriented visual system with concise Chinese labels, strong currency hierarchy, error proximity, keyboard focus and narrow-screen support. Include “报销测算” and “方案设计” views; the latter contains static architecture, AI-boundary and production-replacement summaries.

- [ ] **Step 5: Build and run offline verification**

Run: `npm run build:offline && npm run test:e2e -- --project=offline`  
Expected: PASS; `dist/index.html` opens without an application server and no request is made to an API endpoint.

- [ ] **Step 6: Commit**

```bash
git add apps/offline-demo scripts tests/e2e
git commit -m "feat: add interactive offline calculator demo"
```

### Task 8: Build the API-driven Next.js service UI

**Files:**
- Create: `apps/service-web/app/page.tsx`, `apps/service-web/app/globals.css`
- Create: `apps/service-web/components/calculation-form.tsx`, `apps/service-web/components/calculation-result.tsx`, `apps/service-web/components/architecture-view.tsx`
- Modify: `tests/e2e/offline-and-service.spec.ts`

**Interfaces:**
- Consumes: Task 6 HTTP API and Task 3 `CalculationResponse` type only.
- Produces: an API-driven service edition with no client policy import.
- Consumed by: Task 9 documentation and final verification.

- [ ] **Step 1: Extend the failing browser test**

Assert the service page sends a POST rather than calculating in the browser, renders server-supplied version, trace ID and cache state, and shows a recoverable error when the API returns 400 or 500.

- [ ] **Step 2: Run the service browser test to verify it fails**

Run: `npm run test:e2e -- --project=service`  
Expected: FAIL because the service page is absent.

- [ ] **Step 3: Implement API-only form and result components**

Use `fetch` against the defined API route. Keep numeric conversion in request DTO mapping only. Disable the calculate button while pending, retain user input on failure, and never fall back to local formulas or embedded policy values.

- [ ] **Step 4: Implement the service architecture view**

Show offline and online data-flow diagrams, AI allowed/prohibited responsibilities, cache replacement path, and correctness checks. Keep claims factual to the MVP: file repository and in-memory TTL cache are explicitly named as demo adapters.

- [ ] **Step 5: Run both browser projects**

Run: `npm run test:e2e -- --project=offline --project=service`  
Expected: PASS; same sample input yields the same amounts and trace in both modes, while only the service mode displays API cache status.

- [ ] **Step 6: Commit**

```bash
git add apps/service-web tests/e2e
git commit -m "feat: add API-driven service calculator UI"
```

### Task 9: Package assessor-facing documentation and final verification

**Files:**
- Create: `docs/architecture.md`, `docs/demo-scenarios.md`
- Modify: `README.md`
- Modify: `tests/e2e/offline-and-service.spec.ts`

**Interfaces:**
- Consumes: all prior runnable commands and the public API contract.
- Produces: complete evaluator instructions and a repeatable full verification command.

- [ ] **Step 1: Write failing documentation checks**

Create `tests/docs/readme.test.ts` that asserts README includes the offline open path, service start command, worker command, test command, demo limitation, MVP-to-production matrix link and policy disclaimer.

- [ ] **Step 2: Run the documentation test to verify it fails**

Run: `npm test -- --run tests/docs/readme.test.ts`  
Expected: FAIL because assessor instructions are incomplete.

- [ ] **Step 3: Document architecture and evaluator workflow**

Document module boundaries, API route examples, policy data lifecycle, each MVP/production replacement point, AI restrictions, seven-minute assessment walkthrough, and exact limitations. Do not present any mock component as a deployed production system.

- [ ] **Step 4: Add and run full verification**

Make `npm run verify` run type-checking, unit tests, API tests, offline build, and both browser tests. Run it once from a clean install state.

Run: `npm run verify`  
Expected: PASS; offline bundle, worker, service API and both browser flows are verified.

- [ ] **Step 5: Commit**

```bash
git add README.md docs tests/docs package.json
git commit -m "docs: add assessor guide and verification workflow"
```

## Plan Self-Review

- **Spec coverage:** Tasks 2–5 implement policy data, rule calculation, cache, review and Worker boundaries. Tasks 6–8 implement the two runtime modes and API split. Task 9 documents MVP/production deltas, demonstrations and verification.
- **Step scan:** Every task begins with a named failing test, has a focused implementation step, a concrete command with an expected outcome, and an isolated commit.
- **Type consistency:** `ReimbursementEngine.calculate` is created in Task 2, consumed by Task 3, and never called by routes or service UI. `CalculateReimbursementUseCase.execute` is created in Task 3, injected in Task 6, and used only by routes. Cache invalidation is defined in Task 3, implemented in Task 4, and invoked in Task 5.
- **Review Focus coverage:** Exact money and cap behavior are Task 2; invalid combinations are Task 3; cache invalidation is Task 4/5; server-only calculation is Task 8.
- **Proportion:** Tasks are grouped by independently testable module boundaries. The plan states signatures, policy values, files and verification commands without embedding implementation bodies.


