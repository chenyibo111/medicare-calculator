# 政策审核与发布工作台：设计规格

## 目标与范围

本阶段将 Compose 验收发布所用的进程内 `LocalReviewGateway` 替换为 PostgreSQL 中可查询、可验证的审核工作流，并提供一个仅在本地评测 Compose 环境显式开启的后台网页。评测者可以查看一份政策草稿如何从提交、审核到发布，并由既有 Outbox Worker 驱动在线计算版本切换。

范围内：

- 持久化政策草稿、提交人、审核决定、审核人及状态变迁；
- 最小角色模型：`policy_author` 与 `policy_reviewer`，提交人不得审核自己的草稿；
- 草稿列表、详情、批准、拒绝与发布的本地评测后台；
- 可替换的操作者身份端口，以及 Compose 下明确标识为演示身份的实现；
- 复用既有 `PolicyPublisher`、PostgreSQL 发布事务、Outbox Worker、Redis 缓存与计算审计；
- 更新验收命令、自动化测试、README、生产化文档和离线 H5 的实现边界。

范围外：真实账号密码、企业 SSO/OAuth、用户管理、真实政策来源/OCR/LLM、自由编辑政策规则、生产级 RBAC 管理、双人以上会签、回滚 UI、跨地域高可用。

## 约束与成功标准

- 后台只在 `MEDICARE_RUNTIME=compose` 且 `MEDICARE_ADMIN_CONSOLE=true` 时注册；未开启时返回 404，不出现在用户测算页面。
- “本地评测身份”只是受控演示替身，页面必须清楚说明它不能替代生产认证。生产通过 `OperatorIdentityProvider` 接入企业 SSO/OAuth，应用工作流不依赖具体认证协议。
- 所有状态变迁都经应用用例校验；后台 API 不得直接写 `policy_versions` 或 `policy_outbox_events`。
- 审核与发布必须验证数据库中的草稿、提交人、批准记录及操作者角色；不得信任浏览器传入的审核人或“已批准”状态。
- 发布仍以单一 PostgreSQL 事务完成：验证批准状态、更新草稿为 `published`、废弃重叠版本、写入新版本与 `policy.published` Outbox。
- 既有 `compose:publish-acceptance-policy` 和 `verify:compose` 仍可运行；它们以两个确定的系统验收身份走同一审核用例，不依赖后台网页。

成功时，评测者可在后台看到已提交的 Compose 验收草稿，以审核员身份批准，再发布；`policy-worker` 消费 Outbox 后，服务版 Compose 样例从旧 `policyVersion` 切换到新版本。重复发布、非审核角色、自审、未批准草稿和已拒绝草稿均不能产生新政策版本或 Outbox 事件。

## 运行架构与数据流

```text
本地评测后台 /admin/policy-review
  → OperatorIdentityProvider（演示身份：录入员 / 审核员）
  → PolicyReviewWorkflow 应用用例
  → PostgreSQL：policy_sources / policy_drafts / policy_reviews
                    ↓（仅批准草稿）
             PolicyPublisher + PostgresPolicyPublicationStore
                    ↓ 单一发布事务
             policy_versions + policy_outbox_events

policy-worker → Redis 失效 / 预热 → 标记 Outbox processed_at
用户服务页 → 计算 API → Redis / PostgreSQL → policyVersion + 计算审计
```

后台页面与 API 只处理治理数据；用户测算页面继续只向计算 API 传递测算条件。后台不接收或展示真实参保人资料。

## 领域与数据设计

### 操作者与角色

应用层新增 `OperatorIdentityProvider`，返回不可由浏览器任意指定的 `operatorId` 与角色集合。工作流只需 `policy_author`、`policy_reviewer` 两种角色：

- `policy_author` 可创建和提交草稿；
- `policy_reviewer` 可批准或拒绝已提交草稿；
- 批准时 `operatorId` 必须不同于 `submitted_by`；
- 发布只允许已批准草稿，并再次通过持久化审核凭证验证。

Compose 的演示适配器通过服务端签发的短期评测会话选择两个固定身份，并且仅在后台开关开启时工作。生产替换为 SSO/OAuth 适配器；应用用例、状态检查与数据库记录不变。

### 草稿和审核状态

迁移将 `policy_drafts.status` 从仅允许 `pending_review` 扩展为：

```text
draft → pending_review → approved → published
                       ↘ rejected
```

草稿记录新增 `submitted_by`、`submitted_at`；`policy_reviews` 继续保留每次决定的审核人、决定、时间与可选理由，并为同一草稿的有效审核决定建立约束。后台第一期不支持从 `rejected` 回退编辑；重新提交须创建一份新草稿，保留证据链。

草稿和来源先持久化；发布存储层复用其 `source_id` 与 `draft_id`，不再在发布时生成另一套来源、草稿或审核记录。这样政策版本、审核决定和来源形成真实外键链路。

### 发布门禁

新增 PostgreSQL 审核网关/工作流仓储。它在批准时写入审核决定，在发布时以事务内读取验证：

1. 草稿存在且状态为 `approved`；
2. 批准审核记录属于该草稿，决定为 `approved`；
3. 审核人不等于提交人；
4. 草稿未被发布。

通过后才调用现有 `PolicyPublisher` 和 `PostgresPolicyPublicationStore`。存储层在同一个事务中将草稿改为 `published`，再写版本和 Outbox；失败回滚所有本次发布写入。重复发布必须返回领域错误，不得重复创建事件。

## 后台页面与接口

后台路由为 `/admin/policy-review`，包含三个稳定区域：

1. **身份条**：显示当前是“本地评测录入员”或“本地评测审核员”、角色及非生产提示；
2. **草稿列表**：显示地区、险种、版本、提交人、状态、最近审核决定与时间；
3. **详情与操作区**：显示规则摘要、来源链接、证据、当前会替代的版本，以及与当前角色匹配的“提交审核”“批准”“拒绝”“发布”操作。

后台 API 只在开关开启时注册。每个命令端点从服务端会话读取身份，调用应用用例，并返回可恢复的字段/状态错误；前端不把角色、审核人或发布状态作为可信参数传入。发布完成后页面显示版本与 Outbox 待处理状态，Worker 完成后可刷新查看已处理状态。

为控制范围，第一期草稿由“创建 Compose 验收草稿”受控操作产生，规则来自仓库中的固定验收模板；不提供自由规则编辑。这样评测者能看到完整治理闭环，又不会把错误的自由政策编辑器伪装成合规生产能力。

## 错误处理与安全边界

- 未启用后台、非 Compose 运行模式或不存在的评测会话统一返回 404/未授权，不泄露治理数据；
- 角色不足、自审、无效状态、重复审核和重复发布返回明确的可恢复错误；
- 演示身份、环境变量和数据库连接信息不进入浏览器日志、页面或 API 错误；
- 后台不接受 AI 决定、AI 审核或 AI 发布；AI/OCR 日后只能创建待审核草稿与证据；
- 页面文案使用“本地评测后台”“演示身份”，文档明确生产需反向代理、SSO/OAuth、网络隔离和审计告警。

## 测试与验收

1. 应用层单元测试：角色不足、自审、未批准、已拒绝、重复发布均被拒绝；批准后仅产生一次发布请求。
2. PostgreSQL 集成测试：草稿、提交、审核、发布的外键链路；发布事务失败时草稿不被错误标记为已发布；同一草稿不会有两条成功发布事件。
3. API/页面测试：后台关闭时不可访问；开启后演示身份可见；录入员不能审批自己的草稿；审核员批准后出现发布操作；发布结果显示版本与 Outbox 状态。
4. Compose smoke：保留现有 v1/v2、缓存和审计验收，同时断言验收 CLI 使用持久化审核工作流。
5. 回归：`pnpm run verify`、`pnpm run verify:compose`、离线 H5 无网络请求；README、生产说明和离线架构状态准确反映“后台已实现、真实 SSO/来源/AI 仍待替换”。

## MVP 到生产的替换路径

| 本期本地评测实现 | 生产替换 | 保持不变 |
| --- | --- | --- |
| 固定演示身份与会话 | 企业 SSO/OAuth、组织目录、细粒度权限 | `OperatorIdentityProvider` 与角色校验 |
| 固定 Compose 政策模板 | 受控来源连接器、附件存储、证据定位 | 草稿、审核、发布状态流 |
| 单审核人且禁止自审 | 双人会签、职责分离、风控规则 | 审核凭证验证与发布事务 |
| Compose 路由开关 | 内网管理域、网关认证、审计告警 | 后台 API 的应用用例边界 |
