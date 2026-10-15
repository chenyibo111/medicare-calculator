# 医保报销计算器 MVP

一个可用于企业 AI 实践评测的医保住院报销预估产品，提供离线 H5、快速测试服务和 Docker Compose 三条可运行路径。两种页面均只覆盖城市 A / B 的示例住院政策，始终标注“**示例政策，仅供演示**”。

> 不接入真实参保信息、真实医保结算、真实政府站点或真实模型服务。Compose 路径已使用 PostgreSQL、Redis 与 `policy-worker`，但数据仅为可审阅的示例政策；结果是规则预估，不是医保结算承诺。

## 快速运行

环境：Node.js 20+、pnpm 11+。

```powershell
pnpm install
```

### 1. 离线演示版

```powershell
pnpm run build:offline
```

直接用浏览器打开 `apps/offline-demo/dist/index.html`。它是一个没有 API 请求的静态 H5：政策快照和共享规则引擎都已打包到本地资源中。

### 2. 快速测试服务版

```powershell
pnpm run dev:service
```

访问 `http://localhost:3000`。此路径显式使用文件/内存测试适配器，适合快速 UI 与 API 测试；浏览器只向 `POST /api/v1/reimbursement-calculations` 发送 DTO。

### 3. Docker Compose 服务版

```powershell
Copy-Item .env.example .env
# 编辑 .env：设置 POSTGRES_PASSWORD；若 5432/6379 已被占用，可修改 POSTGRES_PORT/REDIS_PORT
docker compose --env-file .env up --build
```

访问 `http://localhost:3010`。该路径使用 PostgreSQL 政策仓库与审计日志、Redis 政策缓存，以及常驻的 `policy-worker`；启动时执行迁移和可重复的城市 A/B 示例种子。

完整的可复跑验收：

```powershell
pnpm run verify:compose
```

该命令会在隔离的“Compose验收市”发布 v1、建立缓存、发布 v2，等待 `policy-worker` 消费 Outbox，断言 API 已切换到 v2；随后清理 v2 缓存并验证一次 Redis miss、一次 hit 及 PostgreSQL 审计记录。结束时仅停止本项目容器，保留命名卷。

本地开发/评测入口（不是生产管理后台）：

```powershell
docker compose --env-file .env exec -T policy-worker pnpm run compose:publish-acceptance-policy -- --version v1
```

同一验收版本可安全重复执行：若该地区、险种与版本已入库（即使后来已被 v2 替代），命令会返回 `already_published`，不会重复写入政策、审核记录或 Outbox 事件。

要在页面直接演示版本切换：依次发布 v1 或 v2 后，打开 `http://localhost:3010`，点击“填入 Compose 验收样例”再开始测算；结算单的“政策版本”将显示 `compose-e2e-v1` 或 `compose-e2e-v2`。该按钮只填入固定测算条件，不提供浏览器端发布能力。

要演示持久化审核与发布闭环，在 `.env` 增加 `MEDICARE_ADMIN_CONSOLE=true` 后重新执行 `docker compose --env-file .env up --build -d`，再访问 `http://localhost:3010/admin/policy-review`。后台提供固定的本地录入员/审核员身份，草稿必须经历“创建 → 提交 → 异人批准 → 发布”；它不是生产登录。生产通过 `OperatorIdentityProvider` 替换为企业 SSO/OAuth，用户测算页不会出现后台链接。

后台的真实 Compose 浏览器验收会创建唯一版本的草稿，并验证完整异人审核与发布闭环：

```powershell
pnpm run test:e2e:compose-admin
```

PostgreSQL 集成验收还覆盖自审不写审核记录、重复发布不重复写版本/Outbox，以及并发审核至多产生一条有效决定。

### 4. 政策处理演示

```powershell
pnpm run worker:demo
```

该命令展示“本地原始材料 → 明确标识的 AI 提案 → 人工审核 → 版本化发布 → 缓存失效”。生成的草稿和演示发布文件被忽略，不会混入受版本控制的示例政策。

### 5. 快速验证

```powershell
pnpm run verify
```

完整验证包括 TypeScript 类型检查、领域/应用/基础设施/API/文档测试、离线构建、服务版构建，以及离线与服务两套 Playwright 浏览器流程。只运行某一浏览器项目：

```powershell
pnpm exec playwright test --project=offline
pnpm exec playwright test --project=service
```

## 评测时建议展示

1. 打开离线版，点击“填入城市 A 样例”，展示预计自费和可展开的计算明细。
2. 切换退休身份、医院等级或异地备案，说明 UI 只采集条件，规则由共享引擎决定。
3. 运行 `pnpm run verify:compose`，展示 v1 → v2 发布、`policy-worker` 消费 Outbox、API 版本切换、Redis miss/hit 与审计记录的一键证据。
4. 启动 Compose 服务版，填入城市 B 样例，展示 API 返回的政策版本、请求标识和缓存状态。
5. 运行 Worker，说明 AI 不具备发布权限，必须经过审核门禁。
6. 查看离线版“方案设计”中的已实现与待替换边界；服务版只聚焦在线测算。

更完整的演示剧本见 [docs/demo-scenarios.md](docs/demo-scenarios.md)。

## 代码模块

| 目录 | 责任 | 是否可替换 |
| --- | --- | --- |
| `packages/domain` | 整数分金额、政策匹配、确定性报销引擎与轨迹 | 不在路由或 UI 复制公式 |
| `packages/contracts` | 请求/响应 DTO 与 Zod 校验 | 服务 API 的兼容边界 |
| `packages/application` | 计算用例、审核门禁、发布用例、端口定义 | 不依赖文件/缓存/Next |
| `packages/infrastructure` | 文件/内存测试替身，以及 PostgreSQL、Redis、Outbox、审计适配器 | 真实来源接入仍待替换 |
| `worker` | 离线政策处理演示、Compose 常驻 Outbox 消费与受控验收发布 CLI | 可替换为队列消费者与审核工作台 |
| `apps/offline-demo` | 无网络的演示 H5 | 只读快照适配器 |
| `apps/service-web` | Next.js 页面、API 路由、服务端组合根 | 客户端不导入政策 |

## MVP 与生产版本差异

本期已将政策持久化、Redis 缓存、事务发布、Outbox 与计算审计从“替换设想”推进到 Compose 可运行实现；真实政策来源与 AI/OCR 仍是后续替换点。`ReimbursementEngine`、应用用例与 API DTO 保持不变：

| MVP | 生产替换 | 保持不变 |
| --- | --- | --- |
| 本地原始政策 JSON | 官方来源连接器、附件存储与变更检测 | `PolicySourceConnector` |
| 模拟提取建议 | OCR / 受控 LLM / 证据定位 | `PolicyExtractionAdapter`，仍需人工审核 |
| 文件政策仓库（快速测试） | PostgreSQL 版本化仓库（Compose 已实现） | `PolicyRepository` |
| 进程内 TTL（快速测试） | Redis / 事件驱动失效 / 热点预热（Compose 已实现） | `PolicyCache` |
| Next 单进程 API | 无状态计算服务、网关、限流与扩缩 | DTO 与 `CalculateReimbursementUseCase` |
| Compose 常驻 `policy-worker` + 本地验收 CLI + 持久化本地评测后台 | 队列、重试、死信、企业 SSO/OAuth 与审批工作台 | 发布门禁、`OperatorIdentityProvider` 与审计事件 |

已实现与后续替换矩阵见 [Compose 生产化基础](docs/production-foundation.md)；生产架构、AI 边界、缓存策略、正确性校验与性能方案见 [架构说明](docs/architecture.md)。

## 可验证事实与限制

- 所有领域金额都以整数“分”计算；只有展示层转为人民币两位小数。
- 城市 B 未配置大病保险阶梯时，结果明确为 `¥0.00`，不编造规则。
- AI / OCR 当前未接入真实来源；后续只能形成 `pending_review` 草稿，发布仍必须经过人工审核门禁。
- 服务端响应不回传原始政策文件或可由浏览器覆盖的政策比例。
- Compose 路径已将最小化审计证据持久化到 PostgreSQL；它仍不等同于生产级不可变审计存储。
