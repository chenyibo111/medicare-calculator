# Compose 生产化基础：已实现与后续路径

本文件只描述本仓库已经可复跑的能力与明确预留的替换点，不把设计目标写成已上线能力。

## 已实现的闭环

`docker compose up --build` 会启动 PostgreSQL 16、Redis 7 与 Next 服务。服务容器启动时执行原生 SQL 迁移和城市 A/B 示例种子；Compose 运行模式只能创建 PostgreSQL 仓库、Redis 缓存与 PostgreSQL 审计日志，依赖不可用时显式报错，不会回退到文件或内存适配器。

一次计算的在线链路为：

```text
POST /api/v1/reimbursement-calculations
  → RedisPolicyCache（命中直接返回已发布政策）
  → PostgresPolicyRepository（未命中时按地区、生效日查询）
  → ReimbursementEngine（整数分、确定性规则）
  → PostgresAuditLog（版本、缓存状态、输入/结果哈希）
```

政策发布通过一个 PostgreSQL 事务更新旧版本状态、写入新版本和 `policy.published` Outbox 事件。Worker 以安全领取方式消费事件，删除旧版本缓存键并预热新版本当天键；重复事件不会恢复旧缓存。

## 可复跑验收

`pnpm run verify:compose` 会：

1. 检查 Docker Desktop 和本地 `.env`。
2. 构建并启动本项目 Compose 服务，等待其迁移和种子完成。
3. 删除仅用于本次演示日期的城市 B 缓存键，连续调用 API 两次。
4. 断言首次 `cacheStatus=miss`、第二次 `cacheStatus=hit`，并断言预计自费为 `2,366,500` 分。
5. 从 PostgreSQL 查到这两次请求对应的 `miss` 与 `hit` 审计记录。
6. 仅停止本项目容器，保留命名卷；不会执行 `down --volumes`。

## 仍是下一阶段的能力

| 能力 | 当前入口 | 后续替换路径 |
| --- | --- | --- |
| 真实政策获取 | 仅城市 A/B SQL 示例种子 | 官方来源连接器、变更检测、附件对象存储与内容哈希 |
| AI / OCR | 仅离线 Worker 演示提案 | 模型网关、OCR、证据定位、置信度评测；结果始终进入人工审核 |
| 审核工作台 | 数据模型与发布事务 | RBAC、双人复核、影响分析、回放与回滚 UI |
| 高并发运行 | 单机 Compose 的 PostgreSQL / Redis | Redis Cluster、只读副本、无状态 API 多副本、限流与 SLO |
| 审计保留 | 最小化哈希和执行轨迹 | 不可变事件流、保留策略、告警、访问审计与合规复核 |

无论后续替换何种基础设施，金额计算继续只由 `packages/domain` 中的确定性整数分规则执行。AI 不参与金额决策、不发布政策，也不接收真实个人医疗信息。
