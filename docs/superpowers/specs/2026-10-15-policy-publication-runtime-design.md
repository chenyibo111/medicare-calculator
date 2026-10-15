# 政策发布运行闭环：设计规格

## 目标与范围

本阶段把现有的“事务发布 + Outbox 消费器”接成 Docker Compose 中可复跑的运行闭环，供面试官在本地代码仓库中验证一次政策变更如何安全影响在线计算。

范围内：

- 为 Compose 增加常驻 `policy-worker` 服务；
- 提供仅面向本地演示/验收的命令行发布入口，不开放 HTTP 管理接口；
- 以一个隔离的验收地区发布政策新版本，验证事件消费、缓存失效/预热和 API 读取新版本；
- 扩展 Compose 验收、测试、README、生产化说明和离线 H5 的能力状态。

范围外：真实政策采集、AI/OCR、审核工作台、RBAC、生产队列、死信队列、回滚 UI 与多地域高可用。

## 约束与成功标准

- 管理性发布不能通过无鉴权公共 HTTP API 暴露；浏览器仍只能调用计算 API。
- 发布必须复用 `PolicyPublisher`、人工审核门禁和 `PostgresPolicyPublicationStore`，不允许用 SQL 绕过领域发布边界。
- 发布事务仍需原子写入新版本、废弃重叠旧版本及 `policy.published` Outbox 事件。
- Worker 可重启、可多副本竞争领取同一 Outbox；`FOR UPDATE SKIP LOCKED` 保持一次安全领取，处理成功后才标记 `processed_at`。
- 验收脚本能在全新或已有命名卷的环境中重复执行，且只影响专用验收地区和对应缓存键。

成功时，`pnpm run verify:compose` 可证明：发布新版本前后，计算 API 返回的政策版本发生切换；新版本首个在线请求为 `miss`，重复请求为 `hit`；对应计算审计与 Outbox 已处理状态均落在 PostgreSQL。

## 运行架构与数据流

```text
本地验收 CLI
  → PolicyPublisher
  → PostgreSQL 单事务：policy_sources / policy_drafts / policy_reviews
                       / policy_versions / policy_outbox_events

policy-worker（Compose 常驻服务）
  → SELECT ... FOR UPDATE SKIP LOCKED
  → 失效旧版本 Redis 键
  → 预热新版本当天键
  → 标记 Outbox processed_at

浏览器 → 计算 API → RedisPolicyCache → PostgreSQL policy_versions
                         ↓
                       确定性规则引擎 → calculation_audit_events
```

`service-web` 与 `policy-worker` 使用同一应用镜像及 `DATABASE_URL`、`REDIS_URL`，但以不同命令启动。Web 容器只提供用户计算；Worker 不监听 HTTP 端口。

## 组件设计

### 1. 常驻 Worker

现有 `process-policy-outbox.ts` 将从“一次性排空后退出”演进为可通过运行参数区分的入口：

- `--once`：用于 CI/本地验收，排空当前可处理事件后退出；
- 默认模式：在无事件时以有限退避轮询，持续消费；
- 收到 `SIGTERM` / `SIGINT` 后停止领取新事件，关闭 Redis 与 PostgreSQL 连接；
- 单条事件失败时保留未处理状态，记录结构化错误并延迟重试，避免错误标记为已处理。

Compose 的 `policy-worker` 依赖 PostgreSQL 和 Redis 健康检查，使用默认常驻模式并设置 `restart: unless-stopped`。

### 2. 本地发布 CLI

新增一个开发者命令，在容器内或通过 `docker compose exec` 执行。它创建一个明确标记为验收用途的来源、待审草稿和人工批准记录，再调用 `PolicyPublisher.publish`。

验收政策使用固定的专用地区/险种与可预期版本，例如“验收城市 / 居民医保 / compose-e2e-v1、v2”。该数据不会污染城市 A/B 的展示政策；命令可重复运行：若目标版本已发布，则返回该版本或跳过创建，而不是生成无界重复记录。

CLI 输出只包含版本、事件 ID、地区和状态，不输出数据库连接字符串或 `.env` 内容。

### 3. 缓存与版本切换

发布前先针对专用验收政策发起计算以建立旧版本缓存。发布新版本后：

1. Worker 领取 `policy.published`；
2. 从事务写入的 `previousPolicyVersion` 失效旧版本关联 Redis 键；
3. 读取新政策并预热当天键；
4. API 后续计算选择新发布版本，不允许继续返回旧版本。

验收以 API 返回版本和审计记录为准，而不是只观察 Redis 键。若预热已完成，首个验收计算可能为 `hit`；因此本阶段将显式删除新版本验收缓存键后再进行“首次 miss / 第二次 hit”断言。这样分别证明发布一致性与计算缓存行为，避免把预热的正确行为误判为失败。

## 错误处理与可观测性

- Worker 日志使用 JSON 风格字段，至少包含 `eventId`、`eventType`、`region`、`policyVersion`、`outcome` 和错误信息。
- 无效 Outbox 载荷或缓存/数据库暂时不可用不得设置 `processed_at`；重启后允许重新处理。
- 发布 CLI 在审核或发布失败时非零退出；不吞掉异常。
- 验收脚本在超时或断言失败时打印 `service-web` 和 `policy-worker` 的最近日志；最后只停止项目容器，保留命名卷。

## 测试与验收

1. 单元测试：Worker 在空队列、成功事件、失败事件、终止信号与一次模式下的行为；发布 CLI 的幂等选择逻辑。
2. 基础设施/集成测试：发布事务记录真实 `previousPolicyVersion`；Worker 消费后 Outbox 被标记；重复消费不恢复旧缓存。
3. Compose smoke：建立验收旧版本缓存，发布 v2，等待 Worker 标记事件已处理，断言 API 读取 v2；删除 v2 当天缓存后，断言 `miss` 后为 `hit`，并查询相应审计记录。
4. 回归：`pnpm run verify` 保持通过；离线 H5 不发网络请求，且只更新真实能力状态文案。

## 文档边界

README、`docs/production-foundation.md`、`docs/architecture.md` 和离线 H5 必须明确：

- Compose 中 Worker、事务发布、缓存失效/预热与端到端验收已实现；
- 发布 CLI 仅为本地开发/评测入口，不是生产管理后台；
- 真实政策来源、OCR/AI、人工审核工作台、监控与高可用仍未实现；
- AI 仍不得决定金额或直接发布政策。
