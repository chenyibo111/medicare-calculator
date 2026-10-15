# 架构与生产演进

## 一句话边界

离线 H5 用于即时、无网络的规则演示；Compose 服务版把政策选择、Redis 缓存、计算和审计留在后端；AI/OCR 尚未接入真实来源，且无论何时都不能计算、发布或猜测政策。

## 运行数据流

```text
离线 H5
表单条件 → 只读政策快照 → ReimbursementEngine → 结算单 + 轨迹

服务版
浏览器表单 → POST /api/v1/reimbursement-calculations
          → CalculateReimbursementUseCase
          → RedisPolicyCache → PostgresPolicyRepository（未命中）
          → ReimbursementEngine → PostgresAuditLog
          → DTO：金额 / 政策版本 / 缓存状态 / 计算轨迹
```

服务版客户端没有已发布政策文件、政策比例或报销公式。Compose 组合根只能注入 PostgreSQL、Redis 与 PostgreSQL 审计；连接失败显式报错，不回退到文件或内存替身。快速测试服务则通过单独的测试组合根显式注入替身。

## 政策数据生命周期

```text
RawPolicySource
  → PolicyExtractionAdapter（AI 可辅助，输出 pending_review）
  → PolicyReviewGateway（人工审核）
  → PolicyPublisher（写入已发布版本）
  → PolicyCache.invalidateByPolicyVersion(version)
```

`PolicyPublisher` 是唯一发布关口。当前已实现 PostgreSQL 事务发布：旧版本状态、新版本和 `policy.published` Outbox 事件在同一事务写入；Compose 常驻 `policy-worker` 消费后精准失效旧版本 Redis 键并预热新版本。发布 CLI 仅为本地开发/评测入口，不是公开管理 API。真实来源采集、附件对象存储、OCR/LLM 草稿与审核工作台尚未实现。

## 正确性策略

- 规则引擎以整数分运行；金额转换和分位点计算均由单元测试覆盖。
- API 契约拒绝负数、费用关系非法、城市 B 的退休状态和未知地区。
- 金标测试覆盖医院等级、退休加点、未备案降点、封顶线以及城市 A 全部大病保险区间。
- 同一输入的离线与服务版浏览器流程都断言确定金额；服务版额外断言 API 请求和可恢复错误。
- 发布测试验证未审核草稿无法发布；PostgreSQL 与 Redis 集成测试验证版本查询、审计、缓存命中、失效和 Outbox 幂等消费。

## 规模与生产方案

| 关注点 | MVP 事实 | 生产路径 |
| --- | --- | --- |
| 政策存储 | Compose 已使用 PostgreSQL 版本、审核与审计表 | 原始附件对象存储、只读副本、分区与生效期索引演练 |
| 缓存 | Compose 已使用 Redis、版本键索引与 Outbox 失效/预热 | Redis Cluster、本地一级缓存、失效风暴压测 |
| 计算服务 | Next API 单进程 | 无状态计算服务、多实例、网关限流、幂等键、超时和熔断 |
| 政策接入 | 城市 A/B 可审阅示例种子 | 官方 API/公告采集、内容哈希、来源签名、变更检测与人工介入队列 |
| AI | 未接入真实模型；仅保留演示边界 | OCR、证据定位、模型网关、提示词版本、置信度评测与强制人工复核 |
| 审核/审计 | PostgreSQL 最小化哈希、版本和缓存状态审计 | RBAC、双人复核、不可变事件流、回放、保留策略和告警 |

对 1000 万 DAU 的假设下，计算服务应保持无状态；政策按地区和版本缓存；高频请求只命中已验证规则快照；政策发布通过事件驱动失效。先建立政策回放、容量压测、来源时效告警、错误率/SLO 和缓存命中率监控，再扩展地域覆盖。

## AI 允许与禁止

| 可以 | 不可以 |
| --- | --- |
| OCR、字段提取、原文证据定位、政策差异提示、低置信度分流 | 直接发布政策、决定用户报销金额、编造缺失规则、绕过人工审核、把真实用户医疗信息用于训练 |

## 上线前门槛

1. 每条政策能关联原始来源、适用期、审核记录、规则版本与回放结果。
2. 政策变更通过金标回归、历史回放、影响范围分析和缓存一致性演练。
3. 身份、最小权限、加密、脱敏、保留与删除流程完成安全/合规审查。
4. 数据库、缓存、队列和计算服务完成容量、故障恢复与区域化部署演练。
5. 监控覆盖来源失败、政策过期、计算异常、缓存异常、队列积压、延迟和成本。
