# 医保报销计算器 MVP

一个可用于企业 AI 实践评测的“双运行模式”医保住院报销预估产品：既能直接打开离线 H5，也能启动 Next.js 服务版。两种模式都只覆盖城市 A / B 的示例住院政策，页面始终标注“**示例政策，仅供演示**”。

> 不接入真实参保信息、真实医保结算、真实政府站点、真实模型服务、Redis 或数据库；结果是规则预估，不是医保结算承诺。

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

### 2. 启动服务版

```powershell
pnpm run dev:service
```

访问 `http://localhost:3000`。浏览器只向 `POST /api/v1/reimbursement-calculations` 发送 DTO；政策选择、缓存读取和规则计算均在服务端完成。

### 3. 政策处理演示

```powershell
pnpm run worker:demo
```

该命令展示“本地原始材料 → 明确标识的 AI 提案 → 人工审核 → 版本化发布 → 缓存失效”。生成的草稿和演示发布文件被忽略，不会混入受版本控制的示例政策。

### 4. 验证

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
3. 启动服务版，填入城市 B 样例，展示 API 返回的政策版本、请求标识和缓存状态。
4. 再提交一次相同服务端请求，观察缓存状态由“未命中”变为“命中”。
5. 运行 Worker，说明 AI 不具备发布权限，必须经过审核门禁。
6. 查看两版页面的“方案设计/可演进的后端边界”。

更完整的演示剧本见 [docs/demo-scenarios.md](docs/demo-scenarios.md)。

## 代码模块

| 目录 | 责任 | 是否可替换 |
| --- | --- | --- |
| `packages/domain` | 整数分金额、政策匹配、确定性报销引擎与轨迹 | 不在路由或 UI 复制公式 |
| `packages/contracts` | 请求/响应 DTO 与 Zod 校验 | 服务 API 的兼容边界 |
| `packages/application` | 计算用例、审核门禁、发布用例、端口定义 | 不依赖文件/缓存/Next |
| `packages/infrastructure` | 本地文件政策仓库、TTL 缓存、审计、提取/审核适配器 | 生产版替换此层 |
| `worker` | 离线政策处理命令 | 可替换为队列消费者 |
| `apps/offline-demo` | 无网络的演示 H5 | 只读快照适配器 |
| `apps/service-web` | Next.js 页面、API 路由、服务端组合根 | 客户端不导入政策 |

## MVP 与生产版本差异

本项目刻意把本地 JSON、内存 TTL、模拟 AI 提案和手动 Worker 明确标为 MVP 适配器。生产演进保持 `ReimbursementEngine`、应用用例与 API DTO 不变，只替换基础设施端口：

| MVP | 生产替换 | 保持不变 |
| --- | --- | --- |
| 本地原始政策 JSON | 官方来源连接器、附件存储与变更检测 | `PolicySourceConnector` |
| 模拟提取建议 | OCR / 受控 LLM / 证据定位 | `PolicyExtractionAdapter`，仍需人工审核 |
| 文件政策仓库 | 版本化数据库与对象存储 | `PolicyRepository` |
| 进程内 TTL | Redis / 事件驱动失效 / 热点预热 | `PolicyCache` |
| Next 单进程 API | 无状态计算服务、网关、限流与扩缩 | DTO 与 `CalculateReimbursementUseCase` |
| 手动 Worker | 队列、重试、死信和审批工作台 | 发布门禁与审计事件 |

生产路径、AI 边界、缓存策略、正确性校验与性能方案详见 [docs/architecture.md](docs/architecture.md)；完整的设计与替换矩阵见 [MVP 设计说明](docs/superpowers/specs/2026-10-14-medicare-calculator-mvp-design.md)。

## 可验证事实与限制

- 所有领域金额都以整数“分”计算；只有展示层转为人民币两位小数。
- 城市 B 未配置大病保险阶梯时，结果明确为 `¥0.00`，不编造规则。
- AI 只能形成 `pending_review` 草稿；只有审核通过的草稿才能由 `PolicyPublisher` 发布并触发缓存失效。
- 服务端响应不回传原始政策文件或可由浏览器覆盖的政策比例。
- `calculationId`、政策版本、缓存状态和稳定步骤轨迹构成当前 MVP 的可追溯证据，不等同于生产级不可变审计存储。
