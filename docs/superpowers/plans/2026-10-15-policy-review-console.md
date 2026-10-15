# 政策审核与发布工作台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在本地 Compose 评测环境中提供持久化、禁止自审的政策审核与发布后台，并复用已有 Outbox 发布闭环。

**Architecture:** 应用层新增操作者身份与审核工作流端口；PostgreSQL 存储草稿、审核决定和发布状态。后台路由只在 Compose 管理开关开启时使用服务端评测会话取得身份，所有发布仍交由 `PolicyPublisher` 和既有事务存储层处理。

**Tech Stack:** TypeScript、Next.js App Router、Zod、Vitest、Playwright、PostgreSQL 16、Redis 7、Docker Compose。

**Spec:** `docs/superpowers/specs/2026-10-15-policy-review-console-design.md`

## Global Constraints

- 后台只在 `MEDICARE_RUNTIME=compose` 且 `MEDICARE_ADMIN_CONSOLE=true` 时可访问；未开启时返回 404。
- 后台必须使用“本地评测身份”文案，演示身份不可表述为生产认证；生产替换点固定为 `OperatorIdentityProvider`。
- 角色为 `policy_author` 与 `policy_reviewer`；提交人不能审核自己的草稿。
- 后台 API 不得直接写 `policy_versions` 或 `policy_outbox_events`，发布必须复用 `PolicyPublisher` 与 PostgreSQL 发布事务。
- 发布事务必须验证持久化批准记录，将草稿标为 `published`，并原子写政策版本与 `policy.published` Outbox。
- 保留 `compose:publish-acceptance-policy` 与 `pnpm run verify:compose`；它们改走持久化工作流的两个系统验收身份。
- 不实现真实 SSO/OAuth、自由规则编辑、真实来源/OCR/LLM、用户管理或多方会签。

## Review Focus

- 后台关闭、非 Compose 模式或无会话时，治理路由必须返回 404 且不泄露草稿数据（Task 4）。
- 录入员试图批准自己的草稿时，应用用例和数据库验证都拒绝，且不写 `policy_reviews`（Task 2、3）。
- 同一草稿被并发批准或重复发布时，至多一条有效批准/发布记录和一条 Outbox 事件存在（Task 3、5）。
- 浏览器提交伪造的角色、审核人或草稿状态时，服务端必须忽略并从会话/数据库重新验证（Task 4）。
- 失败的发布事务不能把草稿留在 `published`，也不能写部分政策版本或 Outbox（Task 3、5）。

---

## File Structure

- `db/migrations/002_policy_review_console.sql`：扩展草稿状态和审核约束，增加提交人、提交时间、审核理由和必要索引。
- `packages/application/src/policy-review-workflow.ts`：操作者、角色、草稿与审核命令/查询端口，及状态变迁用例。
- `packages/application/src/publish-policy.ts`：使发布门禁接收并验证持久化审核凭证。
- `packages/infrastructure/src/postgres/postgres-policy-review-store.ts`：PostgreSQL 草稿、审核和发布资格存储实现。
- `packages/infrastructure/src/postgres/postgres-policy-publication-store.ts`：复用已保存的来源/草稿，在发布事务内更新草稿状态。
- `apps/service-web/server/admin-console.ts`：Compose 开关、评测会话与 `OperatorIdentityProvider` 组合根。
- `apps/service-web/app/admin/policy-review/page.tsx` 与 `components/policy-review-console.tsx`：本地评测后台页面。
- `apps/service-web/app/api/admin/policy-review/**/route.ts`：后台查询和命令路由，仅转发服务端身份与应用命令。
- `worker/src/publish-compose-acceptance-policy.ts`：使用两个系统验收身份创建、审核、发布固定模板。
- `scripts/compose-smoke.mjs`、README、生产说明、离线 H5：更新验收与实现边界。

### Task 1: 迁移审核数据模型

**Files:**
- Create: `db/migrations/002_policy_review_console.sql`
- Modify: `tests/compose/postgres-schema.integration.test.ts`
- Modify: `tests/infrastructure/migration-runner.test.ts`

**Interfaces:**
- Produces: `policy_drafts.status` 支持 `draft`、`pending_review`、`approved`、`rejected`、`published`；包含 `submitted_by`、`submitted_at`。
- Produces: `policy_reviews.review_reason` 和“一份草稿最多一条有效决定”的数据库约束/索引，供 `PostgresPolicyReviewStore` 使用。

- [ ] **Step 1: 写迁移失败测试**

在 `tests/compose/postgres-schema.integration.test.ts` 断言新列、状态约束和审核唯一性；在迁移测试断言 `002_policy_review_console.sql` 被按顺序加载。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/compose/postgres-schema.integration.test.ts tests/infrastructure/migration-runner.test.ts`
Expected: FAIL，缺少第二个迁移或新 schema 字段。

- [ ] **Step 3: 实现 `002_policy_review_console.sql`**

以 `ALTER TABLE` 演进现有表；保留已有记录可读。增加 `submitted_by text`、`submitted_at timestamptz`、`review_reason text`，替换草稿状态检查约束，并建立支持状态列表与审核验证的索引。使用部分唯一索引确保每草稿最多一条 `approved` 或 `rejected` 的有效决定。

- [ ] **Step 4: 运行迁移测试确认通过**

Run: `pnpm vitest run tests/compose/postgres-schema.integration.test.ts tests/infrastructure/migration-runner.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add db/migrations/002_policy_review_console.sql tests/compose/postgres-schema.integration.test.ts tests/infrastructure/migration-runner.test.ts
git commit -m "feat: persist policy review lifecycle"
```

### Task 2: 定义审核工作流应用边界

**Files:**
- Create: `packages/application/src/policy-review-workflow.ts`
- Modify: `packages/application/src/publish-policy.ts`
- Test: `tests/application/policy-review-workflow.test.ts`
- Test: `tests/application/policy-publication-transaction.test.ts`

**Interfaces:**
- Produces: `OperatorIdentity { operatorId: string; roles: readonly PolicyRole[] }`、`OperatorIdentityProvider`。
- Produces: `PolicyReviewWorkflow.createDraft`、`submitDraft`、`decideReview`、`publishApprovedDraft` 及 `PolicyReviewStore` 端口。
- Consumes: `PolicyPublisher.publish(draft)`；`PolicyReviewGateway.verifyApproved(draft)`。

- [ ] **Step 1: 写工作流失败测试**

覆盖：录入员可创建/提交、审核员可批准、提交人自审被拒绝、非审核角色被拒绝、拒绝草稿不能发布、批准草稿只调用一次 `PolicyPublisher.publish`。测试使用内存 `PolicyReviewStore`，断言审核命令只接受服务端 `OperatorIdentity`。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/application/policy-review-workflow.test.ts tests/application/policy-publication-transaction.test.ts`
Expected: FAIL，缺少工作流和角色模型。

- [ ] **Step 3: 实现应用端口和 `PolicyReviewWorkflow`**

定义角色检查和状态流；`decideReview(input: { draftId: string; decision: "approved" | "rejected"; reason?: string }, actor: OperatorIdentity)` 必须验证 `actor.operatorId !== submittedBy`。`publishApprovedDraft(draftId, actor)` 仅接受审核角色，并通过持久化网关重建 `ApprovedPolicyDraft` 后调用现有 `PolicyPublisher`。

- [ ] **Step 4: 运行工作流测试确认通过**

Run: `pnpm vitest run tests/application/policy-review-workflow.test.ts tests/application/policy-publication-transaction.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add packages/application/src/policy-review-workflow.ts packages/application/src/publish-policy.ts tests/application/policy-review-workflow.test.ts tests/application/policy-publication-transaction.test.ts
git commit -m "feat: add policy review workflow"
```

### Task 3: 实现 PostgreSQL 审核与发布资格存储

**Files:**
- Create: `packages/infrastructure/src/postgres/postgres-policy-review-store.ts`
- Modify: `packages/infrastructure/src/postgres/postgres-policy-publication-store.ts`
- Modify: `packages/infrastructure/src/index.ts`
- Test: `tests/infrastructure/postgres-policy-review-store.integration.test.ts`
- Test: `tests/infrastructure/postgres-publication.integration.test.ts`

**Interfaces:**
- Implements: Task 2 的 `PolicyReviewStore` 和持久化 `PolicyReviewGateway`。
- Consumes: `PostgresSqlExecutor`、已有 `PostgresPolicyPublicationStore`。
- Produces: 草稿详情、审核记录、可发布的 `ApprovedPolicyDraft`；发布事务中的草稿状态更新。

- [ ] **Step 1: 写 PostgreSQL 集成失败测试**

创建真实来源和草稿，断言提交/批准的外键链路；断言自审及第二次决定被数据库/仓储拒绝；模拟发布写入失败并断言草稿仍为 `approved`；成功发布后断言草稿为 `published`、仅一条版本和 Outbox。

- [ ] **Step 2: 运行集成测试确认失败**

Run: `pnpm vitest run tests/infrastructure/postgres-policy-review-store.integration.test.ts tests/infrastructure/postgres-publication.integration.test.ts`
Expected: FAIL，缺少 PostgreSQL 审核仓储或发布关联。

- [ ] **Step 3: 实现 `PostgresPolicyReviewStore` 与发布关联**

草稿创建时持久化来源/规则/提交者；批准和拒绝用条件更新锁定 `pending_review` 草稿；发布资格查询返回批准审核凭证。修改 `PostgresPolicyPublicationStore.publishApprovedVersion` 接受已持久化草稿标识，在同一事务内锁定并更新草稿为 `published`，再废弃重叠版本、写版本和 Outbox。

- [ ] **Step 4: 运行集成测试确认通过**

Run: `pnpm vitest run tests/infrastructure/postgres-policy-review-store.integration.test.ts tests/infrastructure/postgres-publication.integration.test.ts`
Expected: PASS（需 Compose PostgreSQL 环境变量）。

- [ ] **Step 5: Commit**

```powershell
git add packages/infrastructure/src/postgres packages/infrastructure/src/index.ts tests/infrastructure/postgres-policy-review-store.integration.test.ts tests/infrastructure/postgres-publication.integration.test.ts
git commit -m "feat: store reviewed policy drafts in postgres"
```

### Task 4: 增加受控后台 API 与演示身份会话

**Files:**
- Create: `apps/service-web/server/admin-console.ts`
- Create: `apps/service-web/app/api/admin/policy-review/session/route.ts`
- Create: `apps/service-web/app/api/admin/policy-review/drafts/route.ts`
- Create: `apps/service-web/app/api/admin/policy-review/drafts/[draftId]/submit/route.ts`
- Create: `apps/service-web/app/api/admin/policy-review/drafts/[draftId]/decision/route.ts`
- Create: `apps/service-web/app/api/admin/policy-review/drafts/[draftId]/publish/route.ts`
- Modify: `apps/service-web/server/runtime-config.ts`
- Test: `tests/api/policy-review-console-routes.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `OperatorIdentityProvider`、`PolicyReviewWorkflow`；Task 3 的 PostgreSQL 仓储。
- Produces: 后台受控 API；`requireAdminConsole()` 在未开启时以 `notFound()`/404 终止。

- [ ] **Step 1: 写路由失败测试**

覆盖：非 Compose 或开关关闭时 `GET /api/admin/policy-review/drafts` 返回 404；无评测会话不返回草稿；录入员的审核命令被拒绝；伪造 request body 的 `reviewer` 或 `role` 不影响服务端身份；后台会话只允许两种固定评测身份。

- [ ] **Step 2: 运行路由测试确认失败**

Run: `pnpm vitest run tests/api/policy-review-console-routes.test.ts`
Expected: FAIL，路由与后台组合根不存在。

- [ ] **Step 3: 实现配置、会话和 API 路由**

在 `runtime-config.ts` 解析 `MEDICARE_ADMIN_CONSOLE`。`admin-console.ts` 只在 Compose+开关下创建 PostgreSQL 工作流，并从 HTTP-only、短期评测会话 cookie 解析固定录入员或审核员；路由只传递命令数据，不接收客户端角色。开关关闭或路由不存在返回 404，无会话返回 401，角色不足/自审返回 403，状态冲突/重复命令返回 409，载荷不合法返回 400；均只返回稳定中文 `message`，不返回堆栈、连接信息或草稿以外的数据。

- [ ] **Step 4: 运行路由测试确认通过**

Run: `pnpm vitest run tests/api/policy-review-console-routes.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add apps/service-web/server/admin-console.ts apps/service-web/server/runtime-config.ts apps/service-web/app/api/admin tests/api/policy-review-console-routes.test.ts
git commit -m "feat: add guarded policy review api"
```

### Task 5: 构建本地评测审核后台并接入 Compose 验收

**Files:**
- Create: `apps/service-web/app/admin/policy-review/page.tsx`
- Create: `apps/service-web/components/policy-review-console.tsx`
- Modify: `apps/service-web/app/globals.css`
- Modify: `worker/src/publish-compose-acceptance-policy.ts`
- Modify: `scripts/compose-smoke.mjs`
- Modify: `docker-compose.yml`
- Test: `tests/e2e/policy-review-console.spec.ts`
- Test: `tests/worker/publish-compose-acceptance-policy.test.ts`
- Test: `tests/compose/compose-contract.test.ts`

**Interfaces:**
- Consumes: Task 4 的 session/draft/command API；Task 3 的 persisted workflow.
- Produces: `/admin/policy-review` 后台页面；Compose `MEDICARE_ADMIN_CONSOLE=true` 配置；持久化审核的验收 CLI。

- [ ] **Step 1: 写页面和 Compose 契约失败测试**

Playwright 覆盖：页面先显示“本地评测后台”与非生产提示；录入员创建/提交固定 Compose 草稿，不能看到批准操作；切换审核员后可批准，发布完成显示版本和 Outbox 待处理/已处理状态。Compose 契约断言后台开关只注入 `service-web`。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec playwright test tests/e2e/policy-review-console.spec.ts; pnpm vitest run tests/compose/compose-contract.test.ts tests/worker/publish-compose-acceptance-policy.test.ts`
Expected: FAIL，后台页面、开关或持久化 CLI 流程不存在。

- [ ] **Step 3: 实现后台页面与验收 CLI 适配**

页面使用原生按钮和可恢复状态反馈，显示身份条、草稿列表和详情操作区；不提供自由规则编辑。更新验收 CLI：用系统录入员创建/提交模板，再以系统审核员批准并发布；已存在版本保持幂等。Compose 仅给 `service-web` 增加后台开关，不向用户测算页面添加管理链接。

- [ ] **Step 4: 运行页面和 Compose 契约测试确认通过**

Run: `pnpm exec playwright test tests/e2e/policy-review-console.spec.ts; pnpm vitest run tests/compose/compose-contract.test.ts tests/worker/publish-compose-acceptance-policy.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add apps/service-web/app/admin apps/service-web/components/policy-review-console.tsx apps/service-web/app/globals.css worker/src/publish-compose-acceptance-policy.ts scripts/compose-smoke.mjs docker-compose.yml tests/e2e/policy-review-console.spec.ts tests/worker/publish-compose-acceptance-policy.test.ts tests/compose/compose-contract.test.ts
git commit -m "feat: add local policy review console"
```

### Task 6: 完整 Compose 验收与文档边界

**Files:**
- Modify: `README.md`
- Modify: `docs/production-foundation.md`
- Modify: `docs/architecture.md`
- Modify: `apps/offline-demo/src/index.html`
- Modify: `tests/docs/readme.test.ts`
- Modify: `scripts/verify-compose.mjs`

**Interfaces:**
- Consumes: Tasks 1–5 的后台、持久化工作流与 Compose 验收。
- Produces: 面试官可复跑的后台审核、发布、Worker、版本切换、缓存和审计证据。

- [ ] **Step 1: 写文档/验收失败测试**

扩展 README 测试，要求出现“本地评测后台”“本地评测身份”“OperatorIdentityProvider”和真实 SSO/OAuth 替换边界。扩展 Compose smoke 测试，要求验收 CLI 输出持久化审核流的状态。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/docs/readme.test.ts tests/compose/compose-smoke.integration.test.ts`
Expected: FAIL，文档与验收输出尚未描述后台边界。

- [ ] **Step 3: 更新验收、README、架构说明和离线 H5**

`verify:compose` 在成功信息中加入审核工作流证据；文档说明后台为本地评测入口、演示身份不可替代 SSO/OAuth、真实来源/AI/监控仍待实现。离线 H5 仅更新真实能力状态，不加入后台网络交互。

- [ ] **Step 4: 运行全量验证**

Run: `pnpm run verify; pnpm run verify:compose`
Expected: 所有快速测试、构建、页面 E2E 和 Compose 发布/审核/Worker/缓存/审计验收均通过。

- [ ] **Step 5: Commit**

```powershell
git add README.md docs/production-foundation.md docs/architecture.md apps/offline-demo/src/index.html tests/docs/readme.test.ts scripts/verify-compose.mjs tests/compose/compose-smoke.integration.test.ts
git commit -m "docs: document policy review console"
```
