# 受控政策源导入实施计划

> **给执行者：** 实施此计划时，使用 `superpowers:executing-plans`，逐任务推进并在每个任务后验证。

**目标：** 在 Compose 服务版提供可重复的受控政策 JSON 导入能力：对原始字节做 SHA-256，按确定性映射生成带 JSONPath 证据的草稿，持久化来源与提取元数据，并使审核后台可完成导入、异人审核、发布与缓存生效的全链路演示。

**架构：** 新增“捕获来源”与“确定性提取”数据结构；`PolicyReviewWorkflow` 接收包含来源工件、提取方法和证据的草稿创建输入。PostgreSQL 通过增量迁移保存来源工件元数据及草稿提取元数据，`content_hash` 改为原始 UTF-8 文件字节的 SHA-256。服务端仅暴露固定白名单源标识，后端自行解析路径，绝不信任客户端路径或规则数据。现有 Compose v1/v2 模板、审核/发布、Outbox 和计算 API 均保留。

**技术栈：** TypeScript、Vitest、Next.js Route Handlers/React、PostgreSQL、Docker Compose、Playwright。

---

## 任务 1：定义可追溯来源、提取与证据领域契约

**文件：**
- 修改：`packages/application/src/publish-policy.ts`
- 修改：`packages/application/src/policy-review-workflow.ts`
- 修改：`tests/application/policy-review-workflow.test.ts`

**步骤：**

1. 在 `tests/application/policy-review-workflow.test.ts` 先为内存存储增加来源工件、提取元数据和证据字段，并增加断言：确定性导入创建的草稿保留 `deterministic_json`、`aiAssisted=false` 与字段证据；来源地区与政策地区不一致仍被拒绝。
2. 运行 `pnpm test -- tests/application/policy-review-workflow.test.ts`，确认因契约尚未扩展而失败。
3. 在 `publish-policy.ts` 引入：
   - `SourceArtifact`：`fileName`、`format`、`sha256`、`byteLength`。
   - `CapturedPolicySource`：来源 UUID、地区、URL、采集时间、工件和仅服务端使用的 `rawDocument`。
   - `PolicyEvidence`：字段、JSONPath、摘录、来源 SHA-256。
   - `PolicyExtractionMetadata`：方法、适配器版本、AI 辅助标识；确定性方法不得以 `demoAIProposal` 表达。
4. 将 `PolicySourceConnector` 的结果更新为捕获来源；将 `PolicyExtractionAdapter` 的结果更新为包含 `policy`、`evidence` 和 `extraction` 的待建草稿输入。保留现有发布草稿所需的最小兼容字段，避免触及 `PolicyPublisher` 的审核门禁。
5. 扩展 `PolicyReviewDraft` 与 `PolicyReviewStore.createDraft`，让领域工作流显式接收并返回来源元数据、提取元数据和证据；仍只允许 `policy_author` 创建。
6. 再次运行同一测试，预期通过。

## 任务 2：实现原始字节哈希与确定性 JSON 提取

**文件：**
- 新增：`packages/infrastructure/src/deterministic-json-extraction-adapter.ts`
- 修改：`packages/infrastructure/src/local-policy-source.ts`
- 修改：`packages/infrastructure/src/demo-extraction-adapter.ts`
- 修改：`packages/infrastructure/src/index.ts`
- 新增：`tests/infrastructure/deterministic-json-extraction-adapter.test.ts`
- 修改：`tests/worker/policy-pipeline.test.ts`
- 新增：`data/raw-policy-sources/compose-import-v1.json`

**步骤：**

1. 在新单元测试中固定一份源 JSON 的原始字节，断言 SHA-256 与 `byteLength`；只改一个字符，断言 SHA-256 改变。
2. 为受控 JSON 写测试：输出的 `PublishedPolicy` 正确；版本、生效日期、三档医院规则、封顶线及大病梯度均有对应 JSONPath 证据；提取元数据为 `deterministic_json` 与 `aiAssisted=false`。
3. 运行这两个测试，确认新类缺失而失败。
4. 让 `LocalPolicySource` 读取 `Buffer`，对原始字节 `createHash("sha256")`，只在服务端解析 JSON，输出捕获来源对象。它不读取由 HTTP 请求提供的文件路径。
5. 创建确定性提取适配器，逐字段验证 JSON 的必要形状和地区一致性，输出结构化政策、证据和提取元数据。错误必须可读，不允许从缺失字段猜测规则。
6. 让旧 `DemoExtractionAdapter` 仅服务于离线 worker 演示，迁移到同一新契约但清晰标为 `demo_static`，不得让确定性导入显示为 AI。
7. 添加 `compose-import-v1.json`：来源说明、采集时间、Compose 验收市/居民医保、唯一政策版本和完整规则。它是仓库提交的受控数据，不声称是官方真实政策。
8. 调整现有 worker 测试和 `worker/src/run-policy-pipeline.ts` 的类型调用，使离线演示仍可运行。
9. 运行 `pnpm test -- tests/infrastructure/deterministic-json-extraction-adapter.test.ts tests/worker/policy-pipeline.test.ts`。

## 任务 3：迁移 PostgreSQL 持久化，并实现重复内容的可解释冲突

**文件：**
- 新增：`db/migrations/003_policy_source_artifact.sql`
- 修改：`packages/infrastructure/src/postgres/postgres-policy-review-store.ts`
- 修改：`tests/infrastructure/postgres-policy-review.integration.test.ts`
- 修改：`tests/compose/postgres-schema.integration.test.ts`

**步骤：**

1. 为 PostgreSQL 集成测试先写两个场景：
   - 创建导入草稿后，可读取与原始字节完全一致的 SHA-256、文件名、格式、采集时间、提取方式和证据。
   - 相同 SHA-256 再次导入时，返回应用层明确的“该政策源内容已导入”错误，且来源/草稿总数均不增加。
2. 运行带 `DATABASE_URL` 的集成测试，确认失败。
3. 新增迁移：给 `policy_sources` 增加工件文件名、格式与字节长度；给 `policy_drafts` 增加有版本的提取元数据 JSONB 或等价明确字段。保留既有 `evidence` 字段，但将其存为包含证据数组和提取信息的稳定结构。迁移不得改写已有数据或删除表。
4. 更新存储实现：
   - 插入来源时使用 `artifact.sha256`，移除目前对 `JSON.stringify(input.source)` 的伪哈希。
   - 在同一事务内先查询/插入来源，捕获唯一冲突并转换为领域错误，而不是把 PostgreSQL 错误泄漏给路由。
   - 插入草稿时保存证据和提取信息；读取、列表、审核通过读取均重建完整模型。
5. 扩展 schema 集成测试，确认新列与默认/约束可用。
6. 运行：`pnpm test -- tests/infrastructure/postgres-policy-review.integration.test.ts tests/compose/postgres-schema.integration.test.ts`（在 Compose 数据库环境中）。

## 任务 4：受控导入清单与后台 API

**文件：**
- 新增：`apps/service-web/server/controlled-policy-import.ts`
- 修改：`apps/service-web/server/admin-console.ts`
- 修改：`apps/service-web/app/api/v1/admin/policy-drafts/route.ts`
- 新增：`apps/service-web/app/api/v1/admin/policy-sources/route.ts`
- 新增：`tests/service/controlled-policy-import.test.ts`
- 修改：`tests/service/admin-console.test.ts`

**步骤：**

1. 先写服务测试：清单仅返回允许的源标识和展示元数据，未知标识拒绝；录入员可以导入；审核员或未登录请求不能导入；请求中的 `filePath`、`policy` 或 `sourceUrl` 不会被接受。
2. 运行相关测试，确认失败。
3. 在 `controlled-policy-import.ts` 定义固定 `sourceKey -> 相对仓库路径/展示元数据` 映射。使用服务端 `resolve` 与根路径校验，确保实际路径始终在 `data/raw-policy-sources` 下。
4. 该模块协调 `LocalPolicySource`、确定性提取适配器和 `PolicyReviewWorkflow.createDraft`。它每次创建新的来源 UUID，但由内容 SHA-256 防重复。
5. `GET /api/v1/admin/policy-sources` 返回无原文的白名单；扩展现有草稿 `POST` 支持严格的 `{ sourceKey }` 导入请求，同时保留 `{ templateVersion: "v1" | "v2" }`。
6. 保持现有 Compose/后台开关、HTTP-only 演示会话与服务端角色判定；在 API 层把重复导入映射为 `409 CONFLICT` 和中文可解释信息。
7. 运行 `pnpm test -- tests/service/controlled-policy-import.test.ts tests/service/admin-console.test.ts`。

## 任务 5：审核后台呈现来源和证据

**文件：**
- 修改：`apps/service-web/components/policy-review-console.tsx`
- 修改：`apps/service-web/app/globals.css`
- 修改：`tests/e2e/policy-review-console.spec.ts`
- 修改：`tests/api/runtime-composition.test.ts`（仅当 API DTO/组合根行为发生改变）

**步骤：**

1. 先修改 Playwright 测试：录入员看到“导入受控政策源”动作，创建导入草稿后断言来源文件名、SHA-256 摘要、`确定性 JSON 映射（非 AI）` 和至少一个 JSONPath 证据；已有模板流程继续通过。
2. 在组件类型中扩展草稿来源/提取/证据字段，在作者工具栏显示白名单源条目和明确的受控导入按钮。加载清单失败应显示可恢复错误。
3. 在草稿卡片用现有“可核查、结算单”视觉语言展示溯源信息和折叠/紧凑证据列表；不显示原始全文，不增加生产后台入口。
4. 更新 CSS，避免卡片信息过密、移动端溢出或按钮布局跳动；复用 `DESIGN.md` 中颜色/排版令牌。
5. 用截图或 Playwright UI 验证审核页面布局，并运行 `pnpm run test:e2e:compose-admin`（Compose 已启动且 `MEDICARE_ADMIN_CONSOLE=true`）。

## 任务 6：全链路 Compose 验收与文档同步

**文件：**
- 修改：`tests/e2e/policy-review-console.spec.ts`
- 修改：`README.md`
- 修改：`docs/architecture.md`
- 修改：`docs/production-foundation.md`
- 修改：`apps/offline-demo/src/index.html`
- 修改：`apps/offline-demo/src/styles.css`（仅当新增状态说明需要样式）
- 修改：`tests/docs/readme.test.ts`

**步骤：**

1. 扩展 Compose 浏览器测试：导入受控源 → 提交 → 异人批准 → 发布 → 轮询 Outbox `processed_at` → 调用计算 API → 断言响应 `policyVersion` 是该导入草稿版本且第二次请求命中缓存。仍保留 Compose 固定模板的现有测试。
2. 更新 README 的“已实现/待替换”矩阵与手动验证命令：说明导入来自镜像内受控数据，而非真实官方采集或上传。
3. 更新架构与生产基础文档，准确描述：原始字节哈希、字段证据、去重、非 AI 确定性映射；继续标注对象存储、官方来源、OCR/LLM 和企业 SSO 为未实现。
4. 更新离线 H5 的方案设计文案，只反映服务版当前能力和生产替换路径，不在离线页面引入后台或动态导入。
5. 更新 README 文档测试预期。
6. 执行质量门禁：
   - `pnpm run typecheck`
   - `pnpm test`
   - `pnpm run build:offline`
   - `pnpm run build:service`
   - `pnpm run test:e2e:compose-admin`
   - 使用 Compose 重建后，手动走一次导入、审核、发布、API 计算，记录验证命令和预期现象。

## 任务 7：提交前核验与提交

**文件：** 所有上述变更。

**步骤：**

1. 检查 `git diff --check`、`git status --short`，确保未把 `.env`、Docker 卷数据、截图临时文件或环境机密加入提交。
2. 复核迁移可从空数据库顺序执行；重复导入不会出现 PostgreSQL `unique constraint` 原始错误；审核、发布和计算链路没有任何 AI 旁路。
3. 查看完整 diff，确认文档声称的“已实现”均有测试证据，未把受控 JSON 演示表述为真实采集/OCR/LLM。
4. 提交实施变更，提交信息建议：`feat: import traceable policy sources`。
