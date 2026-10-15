# 政策发布运行闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Docker Compose 中可复跑地证明一条经审核发布的政策会经 Outbox、Worker 和 Redis 缓存生效，并被计算 API 使用。

**Architecture:** 复用现有 PostgreSQL 事务发布器和 Outbox 调度器。新增一个可常驻或一次性运行的 Worker 运行时、一个仅用于本地验收的发布 CLI，以及 Compose `policy-worker` 服务；Compose smoke 用独立验收地区验证版本切换和缓存语义，不污染城市 A/B 展示数据。

**Tech Stack:** TypeScript、Node 22、pnpm、Vitest、PostgreSQL 16、Redis 7、Docker Compose。

**Spec:** `docs/superpowers/specs/2026-10-15-policy-publication-runtime-design.md`

## Global Constraints

- 不能新增无鉴权的公共 HTTP 政策发布接口；浏览器只保留计算 API。
- 发布必须经 `PolicyPublisher`、审核门禁与 `PostgresPolicyPublicationStore`，不得以 SQL 绕过发布边界。
- 发布事务必须原子写入新版本、废弃重叠旧版本和 `policy.published` Outbox 事件。
- Worker 仅在处理成功后设置 `processed_at`；失败事件必须留待重试。
- Compose 验收只操作隔离验收地区与缓存键，结束时只停止容器，不删除命名卷。
- 文档必须区分已实现 Compose 发布闭环与仍未实现的真实来源、AI/OCR、审核工作台和生产级高可用。

## Review Focus

- Worker 在一个事件处理失败时不得吞错或写入 `processed_at`；由任务 1 的失败路径集成测试固定。
- 多个 Worker 同时领取时同一事件只能由一个消费者处理；由任务 1 的 PostgreSQL 并发领取测试固定。
- 发布新版本必须失效命中中的旧版本缓存，不能只预热新键；由任务 3 的端到端缓存测试固定。
- Worker 已预热新政策时，验证脚本不能错误要求发布后的第一次 API 调用为 `miss`；由任务 4 显式清理新键后再断言 `miss → hit` 固定。
- 已有命名卷含验收版本时，发布 CLI 和 smoke 应可重复运行；由任务 2 的幂等 CLI 测试固定。

---

## File Structure

- `worker/src/policy-outbox-runtime.ts`：封装一次排空、常驻轮询、退避与关闭行为，不包含 Docker 或 CLI 参数解析。
- `worker/src/process-policy-outbox.ts`：Worker CLI 入口，读取环境变量、解析 `--once`、构造 Postgres/Redis 依赖并输出结构化日志。
- `worker/src/publish-compose-acceptance-policy.ts`：仅用于本地 Compose 验收的受控发布 CLI，创建固定验收政策并调用 `PolicyPublisher`。
- `worker/src/compose-policy-fixtures.ts`：验收地区、版本、计算请求及政策构造函数的唯一来源，供发布 CLI 和 smoke 使用。
- `docker-compose.yml`：加入常驻 `policy-worker`，复用服务镜像与数据库/Redis 依赖。
- `package.json`：增加明确的 `worker:outbox`、`worker:outbox:once`、`compose:publish-acceptance-policy` 脚本。
- `scripts/compose-smoke.mjs`：改为真实发布并等待 Worker 消费，再验证版本切换、缓存和审计。
- `scripts/verify-compose.mjs`：失败时收集 Worker 日志。
- `tests/worker/policy-outbox-runtime.test.ts`：Worker 运行时的无事件、失败重试/不确认和停止行为。
- `tests/worker/policy-outbox-dispatcher.integration.test.ts`：扩展真实数据库的并发安全领取、失败未确认断言。
- `tests/worker/publish-compose-acceptance-policy.test.ts`：验收发布的固定、幂等输入选择测试。
- `tests/compose/compose-contract.test.ts`：Compose 四服务及 Worker 命令/依赖契约。
- `tests/compose/compose-smoke.integration.test.ts`：更新一键验收静态契约。
- `README.md`、`docs/production-foundation.md`、`docs/architecture.md`、`apps/offline-demo/src/index.html`：同步真实能力状态与运行命令。

### Task 1: 可运行的 Outbox Worker

**Files:**
- Create: `worker/src/policy-outbox-runtime.ts`
- Modify: `worker/src/process-policy-outbox.ts`
- Create: `tests/worker/policy-outbox-runtime.test.ts`
- Modify: `tests/worker/policy-outbox-dispatcher.integration.test.ts`

**Interfaces:**
- Consumes: `PolicyPublicationDispatcher.processNext(): Promise<boolean>`。
- Produces: `runOutboxWorker(options: { processNext: () => Promise<boolean>; sleep?: (milliseconds: number) => Promise<void>; pollIntervalMs?: number; once?: boolean; shouldStop?: () => boolean; onEvent?: (event: "processed" | "idle" | "error", error?: unknown) => void }): Promise<{ processed: number }>`。
- Produces: `process-policy-outbox.ts --once`，默认常驻；退出前关闭 Redis 与 PostgreSQL。

- [ ] **Step 1: 写出 Worker 运行时的失败测试**

在 `tests/worker/policy-outbox-runtime.test.ts` 中覆盖：一次模式连续处理 `true, true, false` 后返回 `processed: 2`；`processNext` 抛错时调用 `onEvent("error", error)`、不把它记为 processed；常驻模式空闲时调用注入的 `sleep` 后继续轮询。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/worker/policy-outbox-runtime.test.ts`

Expected: FAIL，提示找不到 `policy-outbox-runtime` 或 `runOutboxWorker`。

- [ ] **Step 3: 实现 `runOutboxWorker`**

在 `worker/src/policy-outbox-runtime.ts` 中实现该接口：`once` 排空后退出；常驻空闲时使用默认 1 秒、最大 10 秒的退避并在成功处理后重置；异常不确认事件，记录后退避并继续，`shouldStop` 为真时结束。

- [ ] **Step 4: 运行单元测试确认通过**

Run: `pnpm vitest run tests/worker/policy-outbox-runtime.test.ts`

Expected: PASS。

- [ ] **Step 5: 扩展 PostgreSQL Outbox 集成测试**

在 `tests/worker/policy-outbox-dispatcher.integration.test.ts` 添加：投递回调抛错后同一事件仍为未处理；两个调度器并发执行时仅一个回调获得该事件。使用每例随机 UUID 聚合 ID，避免干扰已有卷数据。

- [ ] **Step 6: 运行 Outbox 集成测试**

Run: `pnpm vitest run tests/worker/policy-outbox-dispatcher.integration.test.ts`

Expected: DATABASE_URL 未设置时跳过；设置 Compose 数据库 URL 时所有用例 PASS。

- [ ] **Step 7: 将 CLI 接入运行时**

修改 `worker/src/process-policy-outbox.ts`：解析 `--once`，构造 `PolicyPublicationDispatcher` 后调用 `runOutboxWorker`；用 `console.info` / `console.error` 输出含 `eventId`、`eventType`、`outcome` 的单行 JSON；在 `finally` 关闭客户端，并让不可恢复启动错误非零退出。

- [ ] **Step 8: 执行类型检查和 Worker 测试**

Run: `pnpm run typecheck && pnpm vitest run tests/worker`

Expected: PASS，数据库集成测试在无 DATABASE_URL 时仅跳过。

- [ ] **Step 9: 提交 Task 1**

```bash
git add worker/src/policy-outbox-runtime.ts worker/src/process-policy-outbox.ts tests/worker
git commit -m "feat: run policy outbox worker continuously"
```

### Task 2: 隔离且幂等的 Compose 验收发布 CLI

**Files:**
- Create: `worker/src/compose-policy-fixtures.ts`
- Create: `worker/src/publish-compose-acceptance-policy.ts`
- Create: `tests/worker/publish-compose-acceptance-policy.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `PolicyPublisher.publish(draft)` 与 PostgreSQL 发布存储。
- Produces: `COMPOSE_ACCEPTANCE_POLICY`，包含固定 `region`、`benefitPlan`、`v1` / `v2` 版本、当日生效日和有效 `ReimbursementRequest`。
- Produces: `publishComposeAcceptancePolicy(dependencies): Promise<{ version: string; created: boolean }>`；已发布目标版本时返回 `{ created: false }`。
- Produces: `pnpm run compose:publish-acceptance-policy -- --version v1|v2`。

- [ ] **Step 1: 写出验收 fixture 与幂等发布的失败测试**

在 `tests/worker/publish-compose-acceptance-policy.test.ts` 断言固定验收地区不等于城市 A/B、政策可匹配其固定请求、第一次发布指定版本返回 `created: true`、查询到已存在目标版本时返回 `created: false` 且不调用发布器。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/worker/publish-compose-acceptance-policy.test.ts`

Expected: FAIL，提示 fixture 或发布函数不存在。

- [ ] **Step 3: 实现验收 fixture 和受控发布函数**

在 `compose-policy-fixtures.ts` 固定“Compose验收市”与居民医保的 v1/v2 规则差异、来源 URL 和测试请求；在发布模块中查询目标版本，缺失时构造 approved draft 并通过 `PolicyPublisher` 与验证审核网关发布。不得直接写 `policy_versions` 或 `policy_outbox_events` SQL。

- [ ] **Step 4: 运行 CLI 单元测试确认通过**

Run: `pnpm vitest run tests/worker/publish-compose-acceptance-policy.test.ts`

Expected: PASS。

- [ ] **Step 5: 增加真实 Compose CLI 入口**

使 `publish-compose-acceptance-policy.ts` 校验 `DATABASE_URL`，构造 PostgreSQL Store 与审核网关，解析唯一允许的 `--version v1|v2`，输出 JSON 结果。为根 `package.json` 添加三条命令：常驻 Worker、一次 Worker、验收发布命令。

- [ ] **Step 6: 运行类型检查和验收 CLI 测试**

Run: `pnpm run typecheck && pnpm vitest run tests/worker/publish-compose-acceptance-policy.test.ts`

Expected: PASS。

- [ ] **Step 7: 提交 Task 2**

```bash
git add worker/src/compose-policy-fixtures.ts worker/src/publish-compose-acceptance-policy.ts tests/worker/publish-compose-acceptance-policy.test.ts package.json
git commit -m "feat: add compose policy publication cli"
```

### Task 3: 将 Worker 纳入 Compose 并验证版本失效

**Files:**
- Modify: `docker-compose.yml`
- Modify: `tests/compose/compose-contract.test.ts`
- Modify: `tests/worker/policy-publication-dispatcher.test.ts`
- Modify: `tests/infrastructure/postgres-publication.integration.test.ts`

**Interfaces:**
- Consumes: 根镜像中的 `worker/src/process-policy-outbox.ts` 与 `MEDICARE_RUNTIME=compose` 环境变量。
- Produces: `policy-worker` Compose 服务，默认运行 `pnpm run worker:outbox`，依赖 PostgreSQL、Redis 健康检查并保持 `restart: unless-stopped`。
- Produces: 发布 v2 时 Outbox 载荷保存真实 `previousPolicyVersion`，缓存失效针对该版本执行。

- [ ] **Step 1: 写出 Compose Worker 契约的失败测试**

在 `tests/compose/compose-contract.test.ts` 断言服务集合包含 `policy-worker`；其环境含 Compose 数据库和 Redis URL、依赖两个健康检查服务、restart 为 `unless-stopped`，命令为根 package 中定义的常驻 Worker 命令。

- [ ] **Step 2: 运行 Compose 契约测试确认失败**

Run: `pnpm vitest run tests/compose/compose-contract.test.ts`

Expected: FAIL，服务集合尚无 `policy-worker`。

- [ ] **Step 3: 修改 Compose 运行定义**

在 `docker-compose.yml` 添加 `policy-worker`，与 `service-web` 共享 build context 和数据库/Redis 连接变量，但以 Worker 命令覆盖镜像默认 CMD；不发布端口，不添加浏览器路由。

- [ ] **Step 4: 写出真实 previous-policy-version 的失败集成测试**

在 `tests/infrastructure/postgres-publication.integration.test.ts` 先发布一个独立地区 v1，再发布相同生效期的 v2；断言 v1 是 `superseded`、v2 是 `published`，v2 Outbox JSON 的 `previousPolicyVersion` 为 v1，而非 `null`。

- [ ] **Step 5: 运行发布集成测试确认通过**

Run: `pnpm vitest run tests/infrastructure/postgres-publication.integration.test.ts`

Expected: PASS；该断言应确认现有发布存储已把事务内查询到的旧版本写入 Outbox。无 DATABASE_URL 时跳过。

- [ ] **Step 6: 添加缓存失效回归测试**

在 `tests/worker/policy-publication-dispatcher.test.ts` 构造含 `previousPolicyVersion` 的事件，断言先调用 `invalidateByPolicyVersion(previous)`，再按新版本加载政策预热；没有旧版本时不调用失效。

- [ ] **Step 7: 执行 Compose 与发布测试**

Run: `pnpm run typecheck && pnpm vitest run tests/compose/compose-contract.test.ts tests/worker/policy-publication-dispatcher.test.ts tests/infrastructure/postgres-publication.integration.test.ts`

Expected: PASS，集成测试只在没有 DATABASE_URL 时跳过。

- [ ] **Step 8: 提交 Task 3**

```bash
git add docker-compose.yml tests/compose/compose-contract.test.ts tests/worker/policy-publication-dispatcher.test.ts tests/infrastructure/postgres-publication.integration.test.ts
git commit -m "feat: run policy worker in compose"
```

### Task 4: 扩展 Compose 端到端验收

**Files:**
- Modify: `scripts/compose-smoke.mjs`
- Modify: `scripts/verify-compose.mjs`
- Modify: `tests/compose/compose-smoke.integration.test.ts`

**Interfaces:**
- Consumes: `docker compose exec` 运行的验收发布 CLI、`policy-worker`、固定验收 fixture。
- Produces: `pnpm run verify:compose` 的可读端到端证据：v1 缓存、发布 v2、Outbox 已处理、API 返回 v2、删除 v2 键后的 miss/hit 与审计记录。

- [ ] **Step 1: 写出 smoke 契约的失败测试**

在 `tests/compose/compose-smoke.integration.test.ts` 断言脚本包含 v1/v2 发布、轮询 `policy_outbox_events.processed_at`、检查 `policyVersion`、清理新版本键后检查 `miss` / `hit`；验证器失败路径请求 `policy-worker` 日志。

- [ ] **Step 2: 运行 smoke 契约测试确认失败**

Run: `pnpm vitest run tests/compose/compose-smoke.integration.test.ts`

Expected: FAIL，现有 smoke 只覆盖城市 B 的缓存和审计。

- [ ] **Step 3: 改写 Compose smoke 数据流**

在 `scripts/compose-smoke.mjs`：通过 `policy-worker` 容器运行 v1、先计算形成 v1 缓存；通过 `service-web` 或临时 CLI 容器发布 v2；轮询 v2 Outbox 的 `processed_at`；计算确认返回 v2；删除 v2 当日 Redis 键后计算两次并断言 `miss → hit`；查询这些 calculation ID 的审计和 v2 事件。所有 SQL 参数只能来自固定 fixture 值或 API 返回的 UUID。

- [ ] **Step 4: 改善失败诊断**

在 `scripts/verify-compose.mjs` 的异常路径收集 `service-web` 与 `policy-worker` 各自最近 120 行日志，成功路径仍仅执行 `compose stop`。

- [ ] **Step 5: 运行 smoke 静态契约确认通过**

Run: `pnpm vitest run tests/compose/compose-smoke.integration.test.ts`

Expected: PASS。

- [ ] **Step 6: 执行真实 Compose 验收**

Run: `pnpm run verify:compose`

Expected: 输出发布的 v2、Worker 已处理、API 政策版本切换、清理新键后的首次 miss / 再次 hit，以及 PostgreSQL 审计成功。

- [ ] **Step 7: 提交 Task 4**

```bash
git add scripts/compose-smoke.mjs scripts/verify-compose.mjs tests/compose/compose-smoke.integration.test.ts
git commit -m "test: verify policy publication runtime in compose"
```

### Task 5: 更新面试交付材料并做全量验证

**Files:**
- Modify: `README.md`
- Modify: `docs/production-foundation.md`
- Modify: `docs/architecture.md`
- Modify: `apps/offline-demo/src/index.html`
- Modify: `tests/docs/readme.test.ts`
- Modify: `tests/e2e/offline-and-service.spec.ts`

**Interfaces:**
- Consumes: 已落地的 Compose 服务、验收命令及当前离线 H5 文案结构。
- Produces: 面试官能从 README、架构文档和离线方案页验证“Worker 闭环已实现、发布 CLI 不属于生产后台、真实来源/AI/OCR 仍未实现”。

- [ ] **Step 1: 写出文档与离线页面的失败断言**

在 `tests/docs/readme.test.ts` 断言 README 有 `policy-worker`、`compose:publish-acceptance-policy` 和“本地开发/评测入口”边界；在离线 E2E 增加架构页状态断言，要求明确“Worker 已纳入 Compose”与“真实政策来源与 AI 草稿尚未实现”。

- [ ] **Step 2: 运行文档与离线 E2E 测试确认失败**

Run: `pnpm vitest run tests/docs/readme.test.ts && pnpm exec playwright test --project=offline`

Expected: FAIL，当前文案未包含新运行闭环的准确状态。

- [ ] **Step 3: 更新面向评测的文档与 H5 状态**

说明准确的运行命令、数据流和边界：Worker 已是 Compose 服务；CLI 只用于本地演示；缓存预热可能使首次 API 命中，因此验收单独清键验证 miss/hit；真实政策来源、AI/OCR、工作台、监控和高可用仍未实现。服务版继续不显示“方案设计”Tab。

- [ ] **Step 4: 运行文档、浏览器与完整项目验证**

Run: `pnpm run verify`

Expected: 类型检查、Vitest、离线/服务构建和两套 Playwright 流程全部 PASS；Compose 依赖的集成测试在未设置 DATABASE_URL 时仍明确跳过。

- [ ] **Step 5: 复跑 Compose 验收和差异检查**

Run: `pnpm run verify:compose && git diff --check`

Expected: 端到端 Compose 验收 PASS，且无空白错误。

- [ ] **Step 6: 提交 Task 5**

```bash
git add README.md docs/production-foundation.md docs/architecture.md apps/offline-demo/src/index.html tests/docs/readme.test.ts tests/e2e/offline-and-service.spec.ts
git commit -m "docs: document policy publication runtime"
```

## Self-Review

- Spec coverage: 五个任务覆盖常驻/一次 Worker、受控发布、事务旧版本、Compose 服务、缓存切换、可观测失败日志、端到端验收和文档边界；真实来源、AI/OCR、工作台与高可用仍明确不在范围。
- Step scan: 每个任务按先失败测试、再最小实现、再验证和提交组织；没有未定义的实现接口。
- Type consistency: `runOutboxWorker` 只依赖 `processNext`；发布模块通过 `PolicyPublisher`；Compose 服务调用根 package 命令；smoke 使用固定 fixture 的 v1/v2。
- Review Focus: 五类高风险输入/状态均映射到任务 1 至 4 的具体测试。
- Proportion: 计划只确定边界、接口、测试和运行命令，不重写实现代码。
