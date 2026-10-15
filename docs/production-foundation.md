# Compose 生产化基础：已实现与后续路径

本文件只描述本仓库已经可复跑的能力与明确预留的替换点，不把设计目标写成已上线能力。

## 已实现的闭环

`docker compose up --build` 会启动 PostgreSQL 16、Redis 7、Next 服务与常驻 `policy-worker`。服务容器启动时执行原生 SQL 迁移和城市 A/B 示例种子；Compose 运行模式只能创建 PostgreSQL 仓库、Redis 缓存与 PostgreSQL 审计日志，依赖不可用时显式报错，不会回退到文件或内存适配器。

一次计算的在线链路为：

```text
POST /api/v1/reimbursement-calculations
  → RedisPolicyCache（命中直接返回已发布政策）
  → PostgresPolicyRepository（未命中时按地区、生效日查询）
  → ReimbursementEngine（整数分、确定性规则）
  → PostgresAuditLog（版本、缓存状态、输入/结果哈希）
```

政策发布通过一个 PostgreSQL 事务更新旧版本状态、写入新版本和 `policy.published` Outbox 事件。Worker 以安全领取方式消费事件，删除旧版本缓存键并预热新版本当天键；重复事件不会恢复旧缓存。

评测发布 CLI 也以 `地区 + 险种 + 版本` 作为幂等键：同一验收版本已入库后，即使状态已经因后续版本变为 `superseded`，再次执行仍只返回 `already_published`，不会再次发布或产生新的 Outbox 事件。

服务版为评测保留“Compose 验收样例”快捷填充。它与 Worker 验收政策使用同一组测算条件；在 CLI 发布 v1 或 v2 后，页面只通过测算 API 显示该次结果实际命中的 `compose-e2e-v1` 或 `compose-e2e-v2`。快捷填充不具备发布权限。另有仅在 `MEDICARE_ADMIN_CONSOLE=true` 时可访问的 `/admin/policy-review`：固定本地录入员/审核员身份走 PostgreSQL 草稿、异人审核和事务发布；生产以 `OperatorIdentityProvider` 接入企业 SSO/OAuth。

## 可复跑验收

`pnpm run verify:compose` 会：

1. 检查 Docker Desktop 和本地 `.env`。
2. 构建并启动本项目 Compose 服务，等待其迁移和种子完成。
3. 在隔离验收地区发布 v1，建立缓存，再发布 v2 并等待 `policy-worker` 写入 `processed_at`。
4. 断言 API 已从 v1 切换至 v2；删除 v2 的当天缓存后，断言首次 `cacheStatus=miss`、第二次 `cacheStatus=hit`。
5. 从 PostgreSQL 查到这两次请求对应的 `miss` 与 `hit` 审计记录。
6. 仅停止本项目容器，保留命名卷；不会执行 `down --volumes`。

## 仍是下一阶段的能力

| 能力 | 当前入口 | 后续替换路径 |
| --- | --- | --- |
| 真实政策获取 | 仅城市 A/B SQL 示例种子 | 官方来源连接器、变更检测、附件对象存储与内容哈希 |
| AI / OCR | 仅离线 Worker 演示提案 | 模型网关、OCR、证据定位、置信度评测；结果始终进入人工审核 |
| 审核工作台 | PostgreSQL 草稿、禁止自审、固定本地评测身份与发布后台 | 企业 SSO/OAuth、RBAC、双人复核、影响分析、回放与回滚 UI |
| 高并发运行 | 单机 Compose 的 PostgreSQL / Redis | Redis Cluster、只读副本、无状态 API 多副本、限流与 SLO |
| 审计保留 | 最小化哈希和执行轨迹 | 不可变事件流、保留策略、告警、访问审计与合规复核 |

无论后续替换何种基础设施，金额计算继续只由 `packages/domain` 中的确定性整数分规则执行。AI 不参与金额决策、不发布政策，也不接收真实个人医疗信息。
