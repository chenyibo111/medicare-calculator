# Compose 生产化基础 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将服务端演示升级为可由 Docker Compose 实际运行的 PostgreSQL、Redis 与 Next API 闭环；政策发布、缓存失效与计算审计均有可验证的持久化证据，同时保持离线 H5 零依赖。

**Architecture:** 领域层继续只处理金额与规则；应用层通过端口协调发布、计算和 Outbox；基础设施层提供 PostgreSQL 仓库、Redis 缓存及事件分发；Compose 下的服务组合根只能注入真实依赖，快速测试则显式注入本地适配器。政策发布以一个 PostgreSQL 事务写入版本切换与 Outbox，Worker 幂等消费事件以失效并预热 Redis。

**Tech Stack:** Node.js 20、pnpm workspace、TypeScript strict、Next.js、PostgreSQL 16、Redis 7、Docker Compose、原生 SQL、`pg`、`redis`、Vitest、Playwright。

**Spec:** `docs/superpowers/specs/2026-10-14-production-foundation-design.md`

## Global Constraints

- 金额、比例和政策计算继续在 `packages/domain` 中以纯 TypeScript 和整数分实现；页面、SQL、Redis 不得复制报销公式。
- Compose 运行模式中，数据库或 Redis 不可连接时必须显式失败并返回中文操作提示，绝不能悄悄回退到文件仓库或内存缓存。
- 快速质量门禁 `pnpm run verify` 不得要求 Docker；只有 `pnpm run verify:compose` 依赖 Docker Desktop。
- 离线 H5 不发起网络请求，继续只读取打包的示例政策快照；其“方案设计”页仅陈述已经实现的能力。
- 不提交 `.env`、真实账号、个人医疗信息或真实政策抓取数据；Compose 密码仅来自本地未追踪环境文件。
- 每个实现任务完成后都要执行对应测试；本期结束前同步 `README.md`、`docs/architecture.md`、离线 Demo，并记录真实验证证据。

## Review Focus

1. 同一地区、险种与生效区间的版本替换是否在一个事务内完成，失败时是否完全回滚。
2. Compose 模式是否会因 PostgreSQL/Redis 不可用而失败，而非意外使用内存或文件适配器。
3. 单元、API 和 Playwright 测试是否能显式选择测试适配器，从而不误依赖 Docker。
4. 按计算日期查询时，是否只选择已发布且有效期覆盖该日期的最新版本。
5. Outbox 重复投递是否安全，且不会恢复已失效的旧版本缓存。

---

## Task 1: 固化 Compose 运行入口与环境边界

**Files:**
- Create: `docker-compose.yml`
- Create: `apps/service-web/Dockerfile`
- Create: `apps/service-web/.dockerignore`
- Create: `.env.example`
- Create: `scripts/compose-service.mjs`
- Modify: `.gitignore`
- Modify: `package.json`
- Test: `tests/compose/compose-contract.test.ts`

- [ ] **Step 1: 先写 Compose 契约测试。**
  - 断言 Compose 定义 `postgres`、`redis`、`service-web` 三个服务；前两者使用命名卷和 healthcheck。
  - 断言应用容器从 `DATABASE_URL`、`REDIS_URL` 读取连接信息，不把口令写死在仓库或镜像命令中。
  - 断言 `.env` 被忽略而 `.env.example` 只包含安全占位值。

- [ ] **Step 2: 运行测试确认失败。**
  - Run: `pnpm exec vitest run tests/compose/compose-contract.test.ts`
  - Expected: 因 Compose 与环境文件尚不存在而失败。

- [ ] **Step 3: 实现 Compose、镜像及启动编排。**
  - PostgreSQL 固定使用 `postgres:16-alpine`，Redis 固定使用 `redis:7-alpine`；数据库初始化后由服务容器执行应用迁移和种子。
  - 服务容器只在两个依赖健康后启动，并以 `MEDICARE_RUNTIME=compose` 标识运行形态；`scripts/compose-service.mjs` 负责启动前依赖检查、迁移、种子和 Next 服务，不把 shell 逻辑散落在 Compose 中。
  - 提供 `pnpm run compose:up`、`compose:down` 与 `verify:compose` 的占位命令；此时不替换现有快速 `verify`。

- [ ] **Step 4: 重新运行契约测试。**
  - Run: `pnpm exec vitest run tests/compose/compose-contract.test.ts`
  - Expected: 通过，且不会启动 Docker。

- [ ] **Step 5: 提交本任务。**
  - Run: `git add docker-compose.yml apps/service-web/Dockerfile apps/service-web/.dockerignore .env.example .gitignore package.json scripts/compose-service.mjs tests/compose/compose-contract.test.ts && git commit -m "feat: add compose runtime shell"`

## Task 2: 建立可审阅的 PostgreSQL 迁移、种子与版本模型

**Files:**
- Create: `db/migrations/001_policy_foundation.sql`
- Create: `db/seeds/001_demo_policies.sql`
- Create: `scripts/db-migrate.mjs`
- Create: `scripts/db-seed.mjs`
- Create: `packages/infrastructure/src/postgres/client.ts`
- Create: `packages/infrastructure/src/postgres/migration-runner.ts`
- Modify: `packages/infrastructure/package.json`
- Modify: `packages/infrastructure/src/index.ts`
- Test: `tests/infrastructure/migration-runner.test.ts`
- Test: `tests/compose/postgres-schema.integration.test.ts`

- [ ] **Step 1: 写迁移与种子读取测试。**
  - 单元测试验证迁移按文件名顺序执行、`schema_migrations` 防止重复执行、种子必须在迁移成功后运行。
  - Compose 集成测试预期真实数据库具有六张业务表及必要索引：来源、草稿、审核、政策版本、Outbox、计算审计。

- [ ] **Step 2: 运行测试确认失败。**
  - Run: `pnpm exec vitest run tests/infrastructure/migration-runner.test.ts`
  - Expected: 因迁移运行器和 SQL 尚不存在而失败。

- [ ] **Step 3: 实现原生 SQL schema、迁移与示例种子。**
  - 创建不可覆盖的 `policy_sources`，含来源 URL 与内容哈希唯一约束。
  - 创建 `policy_drafts`、`policy_reviews`、`policy_versions`、`policy_outbox_events`、`calculation_audit_events`；`policy_payload` 与 `trace` 使用 JSONB。
  - 对政策版本建立地区、险种、状态、生效区间查询索引；用约束防止无效生效区间，保留 `effective_to` 与 `superseded` 状态。
  - 仅种入现有城市 A / B 示例政策与可审阅的演示来源、审核记录；种子可重复执行。

- [ ] **Step 4: 验证迁移与真实 schema。**
  - Run: `pnpm exec vitest run tests/infrastructure/migration-runner.test.ts`
  - Run: `pnpm run verify:compose -- --scope schema`
  - Expected: 单元测试通过；Compose 测试能验证 schema 与幂等种子。

- [ ] **Step 5: 提交本任务。**
  - Run: `git add db scripts packages/infrastructure tests/infrastructure tests/compose && git commit -m "feat: add policy postgres schema and seeds"`

## Task 3: 扩展领域与应用端口，明确版本发布事务

**Files:**
- Modify: `packages/domain/src/policy.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/application/src/ports.ts`
- Modify: `packages/application/src/publish-policy.ts`
- Modify: `packages/application/src/index.ts`
- Test: `tests/application/policy-publication-transaction.test.ts`
- Test: `tests/application/policy-pipeline.test.ts`

- [ ] **Step 1: 写发布事务的应用层测试。**
  - 覆盖未审批、伪造审批、重复版本、重叠有效期和仓储失败的情形；所有失败均不产生“已发布版本 + Outbox”的部分结果。
  - 覆盖合法替换：旧版本标记 `superseded`，新版本为 `published`，并生成携带新旧版本、区域、险种及有效期的 `policy.published` 事件。

- [ ] **Step 2: 运行测试确认失败。**
  - Run: `pnpm exec vitest run tests/application/policy-publication-transaction.test.ts`
  - Expected: 因事务端口和 Outbox 语义尚未实现而失败。

- [ ] **Step 3: 实现纯应用层模型与端口。**
  - 为政策版本加入生命周期与有效期表达，不让领域对象依赖 SQL 列名。
  - 新增原子发布端口：调用方一次提交审批凭证、版本与发布事件，由基础设施保证同事务落库。
  - 将缓存失效从 `PolicyPublisher` 的直接副作用迁移为 Outbox 消费后的副作用；保留文件/内存适配器，以显式测试替身实现同一端口。

- [ ] **Step 4: 重跑应用测试与既有流水线测试。**
  - Run: `pnpm exec vitest run tests/application/policy-publication-transaction.test.ts tests/worker/policy-pipeline.test.ts`
  - Expected: 均通过；旧测试体现的新发布边界而非绕过事务。

- [ ] **Step 5: 提交本任务。**
  - Run: `git add packages/domain packages/application tests/application tests/worker && git commit -m "feat: model transactional policy publication"`

## Task 4: 实现 PostgreSQL 政策仓库、发布仓库与审计仓库

**Files:**
- Create: `packages/infrastructure/src/postgres/postgres-policy-repository.ts`
- Create: `packages/infrastructure/src/postgres/postgres-policy-publication-store.ts`
- Create: `packages/infrastructure/src/postgres/postgres-audit-log.ts`
- Create: `packages/infrastructure/src/postgres/policy-row-mapper.ts`
- Modify: `packages/infrastructure/src/index.ts`
- Test: `tests/infrastructure/postgres-policy-repository.integration.test.ts`
- Test: `tests/infrastructure/postgres-publication.integration.test.ts`
- Test: `tests/infrastructure/postgres-audit-log.integration.test.ts`

- [ ] **Step 1: 写真实 PostgreSQL 适配器契约测试。**
  - 给定不同状态和时间边界的版本，断言仓库只返回计算日生效的最新已发布政策。
  - 断言事务内发布成功时旧版本、 新版本和 Outbox 同时可见；错误时三者都不可见。
  - 断言计算审计仅写入输入哈希、结果哈希、政策版本、缓存状态和轨迹，不写身份或明细原文。

- [ ] **Step 2: 运行测试确认失败。**
  - Run: `pnpm run verify:compose -- --scope postgres-adapters`
  - Expected: 因 PostgreSQL 适配器尚未实现而失败。

- [ ] **Step 3: 实现 PostgreSQL 适配器。**
  - 所有参数化查询均使用绑定参数；JSONB 映射被集中在 `policy-row-mapper.ts`，不泄露到领域层。
  - `PostgresPolicyPublicationStore` 用同一 client transaction 完成锁定、替换、插入新版本与写 Outbox。
  - `PostgresAuditLog` 写最小化、可回放的证据；为未来请求上下文预留 nullable metadata 字段而不接受原始敏感数据。

- [ ] **Step 4: 重跑 PostgreSQL 集成测试。**
  - Run: `pnpm run verify:compose -- --scope postgres-adapters`
  - Expected: 真实 PostgreSQL 上通过；测试结束清除其专用测试数据。

- [ ] **Step 5: 提交本任务。**
  - Run: `git add packages/infrastructure tests/infrastructure && git commit -m "feat: persist policies and audits in postgres"`

## Task 5: 实现 Redis 政策缓存与幂等 Outbox 消费

**Files:**
- Create: `packages/infrastructure/src/redis/redis-policy-cache.ts`
- Create: `packages/infrastructure/src/postgres/postgres-outbox-store.ts`
- Create: `packages/infrastructure/src/outbox/policy-publication-dispatcher.ts`
- Create: `worker/src/process-policy-outbox.ts`
- Modify: `worker/package.json`
- Modify: `worker/src/index.ts`
- Modify: `packages/infrastructure/src/index.ts`
- Test: `tests/infrastructure/redis-policy-cache.integration.test.ts`
- Test: `tests/worker/policy-outbox-dispatcher.integration.test.ts`

- [ ] **Step 1: 写缓存与重复事件测试。**
  - 断言首次查询为 miss、再次查询为 hit；每个缓存键同时登记到对应版本的 Redis 集合。
  - 发布事件消费后，旧版本关联键被删除，新版本当前日期键预热。
  - 同一 Outbox 事件再次投递不报错、不恢复旧缓存，且不会造成重复处理状态。

- [ ] **Step 2: 运行测试确认失败。**
  - Run: `pnpm run verify:compose -- --scope redis-outbox`
  - Expected: 因 Redis 缓存和 Outbox dispatcher 尚未实现而失败。

- [ ] **Step 3: 实现 Redis 与 Outbox。**
  - 键格式固定为 `policy:v1:{region}:{benefitPlan}:{calculationDate}`；每个版本使用 `policy:version:{version}:keys` 维护失效索引。
  - Worker 获取未处理 Outbox 时采用行锁或等价的安全领取机制；只在缓存失效与预热成功后标记已处理，并可安全重试。
  - Redis 连接异常向上抛出明确错误，不允许服务组合根替换成内存缓存。

- [ ] **Step 4: 重跑缓存与 Outbox 集成测试。**
  - Run: `pnpm run verify:compose -- --scope redis-outbox`
  - Expected: Redis 真实命中、失效、预热和幂等处理均通过。

- [ ] **Step 5: 提交本任务。**
  - Run: `git add packages/infrastructure worker tests/infrastructure tests/worker && git commit -m "feat: add redis invalidation outbox"`

## Task 6: 组装 Compose 服务并保留显式测试组合根

**Files:**
- Modify: `apps/service-web/server/composition-root.ts`
- Create: `apps/service-web/server/test-composition-root.ts`
- Create: `apps/service-web/server/runtime-config.ts`
- Modify: `apps/service-web/app/api/reimbursement/route.ts`
- Modify: `apps/service-web/package.json`
- Modify: `playwright.config.ts`
- Test: `tests/api/runtime-composition.test.ts`
- Test: `tests/api/reimbursement-api.compose.integration.test.ts`
- Test: `tests/e2e/offline-and-service.spec.ts`

- [ ] **Step 1: 写运行时选择与失败模式测试。**
  - `MEDICARE_RUNTIME=compose` 缺少任一连接串、连接失败或初始化失败时，断言服务给出中文、可操作错误，不返回演示政策结果。
  - `MEDICARE_RUNTIME=test` 必须显式注入内存/文件测试适配器；Playwright 使用该模式且无需 Docker。
  - Compose API 测试验证同一请求的第二次计算返回 Redis hit，并能在 PostgreSQL 中查到审计记录。

- [ ] **Step 2: 运行测试确认失败。**
  - Run: `pnpm exec vitest run tests/api/runtime-composition.test.ts`
  - Expected: 因运行时配置及双组合根尚未实现而失败。

- [ ] **Step 3: 实现组合根与 API 诊断。**
  - Compose 根只构造 PostgreSQL、Redis、PostgreSQL 审计和 Outbox 相关依赖；启动失败信息不泄漏连接串或密码。
  - 测试根单独构造快速替身，避免将生产回退逻辑藏在同一条件分支中。
  - 计算 API 沿用既有契约，并返回可验证的 `cacheStatus`、政策版本和计算 ID；不暴露数据库细节。

- [ ] **Step 4: 验证 API、E2E 与 Compose 闭环。**
  - Run: `pnpm exec vitest run tests/api/runtime-composition.test.ts`
  - Run: `pnpm run test:e2e`
  - Run: `pnpm run verify:compose -- --scope api`
  - Expected: 测试形态无需 Docker；Compose 形态使用真实依赖并记录审计。

- [ ] **Step 5: 提交本任务。**
  - Run: `git add apps/service-web playwright.config.ts tests/api tests/e2e && git commit -m "feat: wire compose runtime into calculation api"`

## Task 7: 把 Compose 验证命令变成可复跑证据

**Files:**
- Create: `scripts/verify-compose.mjs`
- Create: `scripts/compose-smoke.mjs`
- Modify: `package.json`
- Modify: `tests/compose/compose-contract.test.ts`
- Test: `tests/compose/compose-smoke.integration.test.ts`

- [ ] **Step 1: 写 Compose 验收测试。**
  - 预期一次命令能迁移、种子、调用 API 两次、核验第二次 Redis hit，并从 PostgreSQL 查询相应审计事件。
  - 预期 Docker Desktop 未运行时输出中文启动提示；失败时保留足够诊断日志且不会删除用户卷。

- [ ] **Step 2: 运行测试确认失败。**
  - Run: `pnpm exec vitest run tests/compose/compose-smoke.integration.test.ts`
  - Expected: 因验证编排脚本尚不存在而失败。

- [ ] **Step 3: 实现可复跑的 `verify:compose`。**
  - 脚本显式检查 Docker、构建和启动 Compose、等待健康、执行 smoke 断言，并以确定的方式停止仅本项目创建的容器。
  - 不移除命名卷；提供单独、需要用户明确运行的清理命令，而不让验证过程破坏本地数据。
  - 保持 `pnpm run verify` 的现有无 Docker 执行路径。

- [ ] **Step 4: 运行两类验证。**
  - Run: `pnpm run verify`
  - Run: `pnpm run verify:compose`
  - Expected: 快速门禁和真实依赖门禁均通过；输出可直接写入评测证据。

- [ ] **Step 5: 提交本任务。**
  - Run: `git add scripts package.json tests/compose && git commit -m "test: add compose verification evidence"`

## Task 8: 更新架构说明、评测路径与离线 Demo 的真实状态

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Create: `docs/production-foundation.md`
- Modify: `apps/offline-demo/src/index.html`
- Modify: `apps/offline-demo/src/main.ts`
- Modify: `apps/offline-demo/src/styles.css`
- Modify: `tests/e2e/offline-and-service.spec.ts`

- [ ] **Step 1: 写离线 Demo 与文档可见性断言。**
  - E2E 断言离线“方案设计”页明确显示“PostgreSQL 政策持久化、Redis 缓存、Outbox 已实现”，同时明确“真实政策来源与 AI 草稿尚未实现”。
  - 断言服务版仍不出现“方案设计”Tab；其验证入口位于 README，而不是伪装成前端功能。

- [ ] **Step 2: 运行测试确认失败。**
  - Run: `pnpm run test:e2e`
  - Expected: 因生产化进展文本和相应断言尚未更新而失败。

- [ ] **Step 3: 更新面向评测者的内容。**
  - README 分开写明离线 H5、快速测试服务与 Docker Compose 服务三种路径，提供 5 分钟评测剧本和常见失败排查。
  - 架构文档列出本期真实实现、缓存键、事务与 Outbox 边界，以及下一阶段尚未实现的能力。
  - 离线 Demo 只更新架构说明与进度卡，不连接服务端、不声称可浏览真实实时政策。

- [ ] **Step 4: 最终全量验证与人工代码审阅。**
  - Run: `pnpm run verify`
  - Run: `pnpm run verify:compose`
  - Run: `git diff --check`
  - Review: 检查无 `.env`、密钥、个人数据、非中文可操作错误或未完成占位标记被提交。

- [ ] **Step 5: 提交本任务。**
  - Run: `git add README.md docs apps/offline-demo tests/e2e && git commit -m "docs: document compose production foundation"`

## Final Acceptance Checklist

- [ ] `docker compose up --build` 能启动 PostgreSQL、Redis 与服务版，服务使用真实连接而非本地替身。
- [ ] `pnpm run verify` 无 Docker 依赖且通过；`pnpm run verify:compose` 在 Docker Desktop 可用时能产生迁移、缓存命中和审计证据。
- [ ] 发布操作以事务同步生成新版本、旧版本状态与 Outbox；重复 Outbox 消费安全。
- [ ] 计算 API 的金额与既有离线演示保持一致，且返回政策版本、缓存状态和可追踪计算 ID。
- [ ] README、架构文档、离线 Demo 全部准确区分已实现与后续替换点。
