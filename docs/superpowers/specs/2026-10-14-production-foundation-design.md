# 生产化一期：Docker Compose、政策持久化与 Redis 缓存设计

## 目标

把当前“文件政策仓库 + 进程内 TTL 缓存”的服务端演示，升级为可由 Docker Compose 实际启动的 PostgreSQL 与 Redis 运行模式。该阶段仍只覆盖城市 A / B 的示例住院政策；它证明政策可持久化、可审核发布、可回滚，并证明在线计算实际读取数据库与 Redis，而不是模拟生产依赖。

交付是供代码仓库评测的本地可运行闭环，不是对外生产部署。离线 H5 始终零依赖、只消费打包快照；服务版的 Compose 运行模式才使用 PostgreSQL 与 Redis。

## 范围与非范围

本期实现以下能力：

- `docker compose up --build` 启动 PostgreSQL、Redis 和服务版；服务等待依赖健康后执行迁移与示例政策初始化。
- 已发布政策、来源证据、审核记录、版本状态、发布事件和计算审计持久化到 PostgreSQL。
- 服务端通过 PostgreSQL 查询“计算日期有效的已发布政策”，通过 Redis 缓存已解析政策；首次请求未命中、后续请求命中。
- 发布事务将新版本发布、旧版本替换和 Outbox 事件写入同一数据库事务；事件消费者清理受影响 Redis 键并预热新版本。
- 现有文件 / 内存适配器保留给领域和快速单元测试，但 Compose 服务运行时不得回退到它们。
- 离线 Demo 的方案设计页新增“生产化进展”状态，明确本期已接入 PostgreSQL 与 Redis，仍未接入真实政策来源或真实模型。
- README、架构文档和运行命令同步更新；仓库提供 Compose 集成验证命令。

本期不实现真实政府站点采集、真实 OCR/LLM、登录系统、跨地域容灾、Redis Cluster、Kubernetes 或真实个人医保数据。

## 运行形态

```text
离线 H5（保持不变）
浏览器 → 打包的城市 A/B 政策快照 → 领域规则引擎 → 本地结算单

Compose 服务版（本期新增）
浏览器 → Next API → CalculateReimbursementUseCase
                    → RedisPolicyCache（命中）
                    → PostgresPolicyRepository（未命中）
                    → ReimbursementEngine
                    → PostgreSQL calculation_audit_events

政策发布（后台 / Worker）
草稿 → 双人审核证据 → PostgreSQL 事务：发布、替换、Outbox
     → Outbox 消费者 → Redis 失效 + 热点预热
```

Compose 包含三个服务：`postgres`（PostgreSQL 16）、`redis`（Redis 7）和 `service-web`。两个基础服务使用命名卷；应用容器只依赖环境变量 `DATABASE_URL` 与 `REDIS_URL`，不得持有数据库或缓存管理口令的默认明文值。仓库提供 `.env.example`，实际本地密码由评测者复制为未跟踪的 `.env` 文件。

## 政策与审计数据模型

迁移采用项目内原生 SQL，而非引入 ORM。这样评测者能够直接审阅约束、索引和事务边界。

| 表 | 核心字段 | 约束 / 用途 |
| --- | --- | --- |
| `policy_sources` | `id`、`region`、`source_url`、`content_hash`、`captured_at` | 来源证据不可覆盖；相同来源内容通过哈希去重。 |
| `policy_drafts` | `id`、`source_id`、`policy_payload JSONB`、`status`、`evidence JSONB` | 仅保存 `pending_review` 草稿；AI/OCR 只能写此表。 |
| `policy_reviews` | `id`、`draft_id`、`reviewer_id`、`decision`、`reviewed_at` | 审批凭证可验证；发布必须关联批准记录。 |
| `policy_versions` | `id`、`region`、`benefit_plan`、`version`、`effective_from`、`effective_to`、`status`、`source_id`、`policy_payload JSONB` | 版本唯一；有效时间区间和已发布状态受索引保护。 |
| `policy_outbox_events` | `id`、`event_type`、`aggregate_id`、`payload JSONB`、`processed_at` | 与发布事务同写；支持重试、幂等消费和缓存失效。 |
| `calculation_audit_events` | `calculation_id`、`policy_version_id`、`input_hash`、`result_hash`、`trace JSONB`、`created_at` | 仅保存最小化计算证据，不存真实身份资料。 |

单个政策版本的规则内容保留为 `policy_payload JSONB`，由现有 `PublishedPolicy` 映射；领域引擎仍不依赖数据库模型。发布时事务必须：锁定相同地区、险种和有效期范围的当前版本；将其标为 `superseded`；写入新 `published` 版本；写入 `policy.published` Outbox 事件。失败时整个事务回滚。

## Redis 缓存与失效

缓存键为 `policy:v1:{region}:{benefitPlan}:{calculationDate}`，值为可用于领域计算的已发布政策 JSON。缓存命中 / 未命中必须继续返回给 API，供评测和可观测性验证。

每次写入缓存，同时把键加入 `policy:version:{version}:keys` 集合。发布事件携带新旧版本和地区 / 险种 / 生效期；消费者删除旧版本集合内的所有键，删除该集合，并对新版本的当前日期键执行预热。消费者必须可重复执行：重复事件不得报错或恢复旧缓存。

服务启动时连接 Redis 失败应直接失败，并给出“请先运行 docker compose up”的中文可操作错误；不得悄悄切到内存缓存。单元测试依旧通过显式注入本地适配器运行，不依赖 Docker。

## 应用边界

- `domain` 保持纯 TypeScript：金额、规则匹配和报销引擎不引入 SQL、Redis 或 Docker。
- `application` 新增发布事务、Outbox 分发和审核凭证所需端口；用例只依赖端口。
- `infrastructure` 新增 PostgreSQL 仓库、Redis 缓存、PostgreSQL 审计和 Outbox 消费者；文件 / 内存实现不删除。
- `apps/service-web/server/composition-root.ts` 根据明确的 Compose 配置组装 PostgreSQL / Redis 适配器；测试组合根另行注入内存适配器。
- `worker` 负责处理未消费的 Outbox 事件；同一事件重复处理必须安全。

## 正确性、测试与失败处理

本期在现有领域和 API 测试之外增加：

1. PostgreSQL 仓库契约测试：只返回已发布、且在计算日期有效的最新政策。
2. 发布事务测试：未经批准、伪造审批、重复版本、有效期重叠均拒绝；失败不产生部分发布记录。
3. Redis 测试：首次未命中、再次命中；发布事件后受影响缓存失效；重复事件安全。
4. Compose 集成测试：迁移、种子、API 计算、Redis 命中和审计记录可从真实 PostgreSQL / Redis 验证。
5. 既有离线 / 服务端一致性测试继续通过；服务端 Compose 模式返回同一金额、政策版本和轨迹。

`pnpm run verify` 保持不需要 Docker 的快速质量门禁。新增 `pnpm run verify:compose` 明确要求 Docker Desktop 已运行，并在失败时打印启动提示。README 将两类命令分开，避免评测者误把基础设施依赖当作安装问题。

## 文档与离线 Demo 更新规则

每个后续生产化阶段完成时，必须同时完成以下三件事：

1. 更新 `docs/architecture.md`，标记“已实现”和“仍为生产替换点”。
2. 更新 README 的启动、验证命令和评测演示步骤。
3. 更新离线 Demo 的方案设计页，在“生产化进展”中展示本阶段的真实实现、验证证据与下一阶段边界；不得把未实现能力描述为已上线。

## 后续阶段顺序

本期完成后，再按独立计划执行：

1. 黄金样例、发布前回归和计算回放。
2. 在线 API 的幂等、请求上下文、限流和结构化审计。
3. 带证据定位和置信度的 AI 政策草稿工作流。
4. 压测脚本、指标定义、容量与成本证据。
5. 提交包装：评测指南、生产化实现矩阵和最终演示剧本。

这些阶段不得抢在本期的真实持久化、缓存失效和发布事务之前实现。
