# 受控政策源导入与可追溯草稿设计

**日期：** 2026-10-15  
**状态：** 已确认，待实施  
**范围：** Compose 服务版的本地政策 JSON 导入、原文证据、结构化草稿和审核后台展示。

## 1. 目标与边界

本迭代让仓库中一份受控的原始政策 JSON，能够在服务版中被导入为可审核的结构化草稿，并全程保留可复核的来源与字段证据。它补齐“政策从哪里来、规则如何对应原文”的可验证链路。

本迭代**不**实现浏览器任意文件上传、真实政府网站爬取、附件对象存储、OCR、LLM、自动审核或自动发布。它们是未来替换来源连接器或提取适配器的实现，而不是当前演示能力。

离线 H5 不导入生产政策、也不复制审核后台；仅更新架构状态说明，指出服务版已经实现可追溯的受控 JSON 导入。

## 2. 交付后的数据流

```text
仓库 data/raw-policy-sources/compose-import-v1.json
  └─ 原始 UTF-8 字节、来源 URL、采集时间、结构化规则字段
       ↓
LocalPolicySource
  └─ 原始字节 SHA-256、文件名、格式、来源元数据
       ↓
DeterministicJsonExtractionAdapter
  └─ PublishedPolicy + JSONPath 字段证据 + extractionMethod=deterministic_json
       ↓
PolicyReviewWorkflow.createDraft
       ↓
PostgreSQL policy_sources / policy_drafts
       ↓
本地评测后台：导入 → 提交 → 异人审核 → 发布
       ↓
事务发布 + policy.published Outbox + Worker Redis 失效与预热
```

“导入”指录入员从服务端固定白名单中选择一个随仓库交付的源文件，而非把任意文件写入服务端。这样 Docker 运行、测试和面试评测均可重复，且不会把文件安全、病毒扫描、对象存储和权限隔离伪装成已完成能力。

## 3. 数据契约

### 3.1 原始源文件

新增一份 Compose 验收导入政策 JSON，具有稳定的来源身份、地区、来源 URL、采集时间和规则数据。其完整文件内容是哈希对象；哈希绝不能由 URL、来源 ID、草稿或结构化规则重新序列化得出。

来源适配器返回的领域对象至少包含：

- `sourceId`：这一次来源记录的 UUID；每次导入新建。
- `region`、`sourceUrl`、`capturedAt`：供治理与审核展示。
- `artifact`：`fileName`、`format`、原始内容 SHA-256、原始内容长度。
- `rawDocument`：仅在服务端提取阶段使用，不返回浏览器，也不写入 API DTO。

### 3.2 提取结果与证据

确定性 JSON 适配器只按受控映射读取字段，输出：

- `policy`：现有 `PublishedPolicy`，仍由领域模型和发布门禁验证。
- `evidence`：每一项包含 `field`、`locator`（JSONPath）、`excerpt` 和来源哈希摘要。关键的版本、生效期、医院等级规则、封顶线和大病阶梯必须可定位。
- `extraction`：`method: "deterministic_json"`、`aiAssisted: false`、适配器版本。不能继续使用笼统的 `demoAIProposal: true` 描述此链路。

未来 OCR/LLM 适配器可以写入 `method: "ocr_llm"`、提示词/模型版本、置信度和同样的证据结构；无论其置信度如何，输出仍只能是草稿。

### 3.3 持久化与幂等

现有 `policy_sources.content_hash` 继续作为全局内容唯一键，但必须存入原始文件 SHA-256。迁移补充来源工件元数据及草稿提取元数据（可放进现有 `evidence JSONB` 的有版本结构，或用明确列保存）；读取模型必须暴露审核页面需要的内容。

导入操作在事务中执行：

1. 若同一 SHA-256 已存在来源，返回明确的冲突结果，且不创建第二份来源或草稿。
2. 若不存在，插入来源和 `draft` 状态草稿。
3. 来源插入、草稿插入失败时整体回滚。

只有审核通过的已有草稿才可进入现有发布事务；导入不能绕过提交、异人审核、发布、Outbox 或缓存失效。

## 4. 服务端与界面

保留现有“创建 Compose v1/v2 草稿”快捷模板，保证已存在的验收链路和浏览器测试继续有效。

为 `policy_author` 增加受控导入动作：

1. API 返回可导入的白名单条目（显示名称、地区、版本、来源 URL，不返回原始文件）。
2. 录入员点击“导入受控政策源”。
3. 服务端读取固定文件、计算哈希、提取字段和证据，并通过 `PolicyReviewWorkflow` 创建草稿。
4. 若内容已导入，API 返回可解释的冲突提示；不是静默成功。

草稿卡片新增以下审阅信息：来源文件名、来源 URL、SHA-256 前缀、采集时间、提取方式、是否 AI 辅助、证据数量。页面显示关键证据定位（字段名、JSONPath、摘录），不回传完整原文，也不提供原始文件下载。

所有路由仍受 `MEDICARE_RUNTIME=compose`、`MEDICARE_ADMIN_CONSOLE=true`、HTTP-only 演示会话和服务端角色判断约束；客户端提交的角色、来源路径和规则内容均不被信任。

## 5. 测试与验收

### 单元测试

- 相同原始字节的 SHA-256 稳定；更改一个字节后哈希变化。
- 适配器输出指定规则字段及字段级 JSONPath 证据，且 `aiAssisted=false`。
- 内容相同的重复导入不会创建第二个草稿。
- 地区不一致、未知白名单源、缺少必填字段均显式失败。

### PostgreSQL 集成测试

- 真正写入来源哈希、工件元数据、提取元数据、证据和草稿。
- 来源与草稿在一个事务内持久化，重复哈希得到冲突而非 `unique constraint` 泄漏。
- 导入后仍必须经过提交、异人审核和现有发布门禁。

### Compose 浏览器验收

在本地评测后台以录入员身份导入受控源，观察草稿证据；切换审核员批准并发布；最后以 API 计算确认新版本实际可被后端命中，并断言 Outbox 已被 Worker 消费。保留原 Compose v1/v2 模板验收测试。

## 6. 安全与生产演进

当前不处理任意上传文件，因此不宣称具备上传安全或多租户隔离。生产接入顺序为：

1. 用官方 API/公告连接器替换白名单文件目录，保留 `CapturedPolicySource` 契约与哈希逻辑。
2. 将原始附件存入对象存储，并以不可变对象版本、内容哈希和访问控制作为证据根。
3. 增加 PDF/OCR/LLM 提取适配器；记录模型、提示词、置信度和页码/坐标证据。
4. 替换本地身份为企业 SSO、RBAC、双人复核与审计保留策略。

上述替换不得改动确定性 `ReimbursementEngine`、计算 API 的金额契约，或赋予 AI 发布和计算决定权。

## 7. 文档同步

实施完成时同步更新 `README.md`、`docs/architecture.md`、`docs/production-foundation.md` 与离线 H5 的方案设计状态；明确区分“已实现的受控 JSON 导入”与“仍未实现的真实采集/OCR/LLM/对象存储”。
