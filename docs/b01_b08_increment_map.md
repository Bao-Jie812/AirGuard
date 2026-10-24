# B01–B08 能力迁移映射

用途：把八项技术能力落实为 AirGuard 的具体业务问题、实现位置、输入输出、验证方式和运行证据。

> 当前状态：阶段一前端原型。B01、B04、B05、B07、B08 已有演示级实现或证据入口；B02、B03、B06 尚未实现。本文不把占位展示写成已完成能力。正式仓库只接收达到验收标准的版本。

| 能力 | 当前阶段一状态 | 正式验收目标 |
| --- | --- | --- |
| B01 LLM Context | 演示：模板 Explain，已保存 Run Trace | 真实 LLM、结构化上下文、约束验证、解释不写回业务状态 |
| B02 SQLite / History | 未实现：localStorage + 确定性模拟历史 | SQLite 持久化、完整历史查询、迁移与重启恢复 |
| B03 Web API | 未实现：固定外部证据快照 | 真实外部 API、超时 / 缓存 / 有效期 / 降级 |
| B04 RAG / Citation | 部分：演示知识库与静态引用 | 真实检索、引用有效性、相关度阈值、No-source |
| B05 Tool Calling | 部分：工具调用快照 + 本地规则 | 工具注册、参数校验、追踪、重试与失败隔离 |
| B06 ML Closed Loop | 未实现：固定占位输出 | 真实训练、评估、保存、重载、版本、错误案例 |
| B07 Integration | 部分：前端视图统一状态 | 前后端 / 数据库 / 工具 / 模型 / 多端完整集成 |
| B08 Validation / Competition | 部分：冒烟验证与截图 | S1–S5、Failure、Regression、复现与发布证据 |

## B01 · LLM Context

**对应业务问题**：如何基于统一的 Current / History / Evidence 生成解释，但不补造传感器事实、不覆盖规则结论？

**当前实现**

- Run Trace 保存 LLM Explain 文本、引用依据与模型版本占位。
- 解释由本地模板生成，界面明确标注“未调用真实 LLM”。
- 解释文本只读，不改变 Priority、Event 或 Recovery。
- 相关位置：[src/data/runs.ts](../src/data/runs.ts)、[src/pages/RunDetailPage.tsx](../src/pages/RunDetailPage.tsx)。

**正式实现要求**

- 从数据库读取结构化 Context：区域、指标、历史窗口、证据状态、规则结果、事件 / Action / Recovery 状态、证据限制。
- 输入快照与 prompt / context 版本写入 Run Trace；可重放。
- LLM 仅生成解释；输出经过结构校验与证据引用校验，不允许写入业务状态。
- 上下文缺失、证据超时、引用不足时，明确表达限制而不是补写事实。
- 解释与已保存状态冲突时，拒绝输出或标记为失败，保留失败记录。

**输入 → 输出**

- 输入：Zone / Event / Run 上下文、证据列表、规则输出、可用引用、限制集合。
- 输出：有证据引用的解释文本、上下文版本、模型版本、校验结果。

**验证**

- 证据不足时解释不含新事实。
- 无法引用来源的断言被拒绝。
- 重新加载 Run Trace 后解释不变。
- 修改 LLM 不改变规则业务状态。

**目标证据**：LLM Context JSON 快照、prompt 版本、解释校验日志、对应 `run_id`。

## B02 · SQLite / History

**对应业务问题**：如何持久保存多区域历史、事件、Action、后验样本、证据与运行记录，并支持时间线和 Action 前后查询？

**当前实现**

- 浏览器 `localStorage` 保存事件、Action、后验样本与新增运行；历史曲线为确定性模拟生成。
- 这一层只适用于前端原型，不满足比赛级持久化与查询要求。
- 相关位置：[src/state/AppStore.tsx](../src/state/AppStore.tsx)、[src/data/history.ts](../src/data/history.ts)。

**正式实现要求**

- SQLite 表至少包含：zones、readings、events、actions、recovery_samples、evidence_snapshots、runs、run_evidence、tool_calls、failures、model_versions。
- 使用事务写入 Action、后验数据、评估结果与 Run Trace，保证一致。
- 支持按 zone、时间窗口、event、action_at 与 run_id 查询历史。
- Schema 版本与迁移；应用重启后历史不丢失。
- 区分实时数据、固定快照回放与派生结果。

**输入 → 输出**

- 输入：模拟 / 真实采样、Action、证据、运行结果。
- 输出：可回查时间序列、事件时间线、Action 前后对照、稳定运行快照。

**验证**

- 重启后数据一致。
- 区域之间数据不串线。
- Action 前后查询只使用正确窗口。
- Run Trace 关联数据完整可回查。

**目标证据**：SQLite schema、迁移记录、查询测试、重启前后样本、`run_id` 关联截图或日志。

## B03 · Web API

**对应业务问题**：如何接入天气 / 室外空气质量等外部证据，并在接口失败时记录来源、时间、有效期和降级，而不改写室内业务事实？

**当前实现**

- 外部证据为固定演示快照，已展示 VALID / STALE / TIMEOUT / MISSING 状态与限制。
- 没有真实 HTTP 请求。
- 相关位置：[src/data/evidence.ts](../src/data/evidence.ts)、[src/components/domain/EvidenceCard.tsx](../src/components/domain/EvidenceCard.tsx)。

**正式实现要求**

- 真实外部 API 适配器，统一封装超时、重试、缓存、有效时间与错误码。
- 每次调用保存请求参数、响应摘要、时间戳与来源。
- 失败记录写入 Run Trace；外部证据失败与业务状态解耦。
- 固定快照回放和真实链路分别标记，验收材料不可混淆。

**输入 → 输出**

- 输入：区域、外部 API 参数、缓存策略。
- 输出：带来源 / 时间 / 有效期 / 状态的外部证据或明确失败记录。

**验证**

- 超时、无效响应、过期缓存均可见。
- 错误不改变已确认的 Indoor Current 事实。
- 同一输入下固定快照回放可重复。

**目标证据**：API 调用日志、超时记录、有效 / 过期证据样例、失败 Run Trace。

## B04 · RAG / Citation

**对应业务问题**：如何用有来源的知识解释处置依据，并在知识缺失或低相关时明确说“不知道”？

**当前实现**

- 演示知识库条目、文档 ID、相关度与引用片段已展示。
- 低相关度 0.41 与 No-source 状态已有 UI 处理。
- 内容明确标注为演示知识库，非真实文献。
- 相关位置：[src/data/evidence.ts](../src/data/evidence.ts)、[src/pages/EvidencePage.tsx](../src/pages/EvidencePage.tsx)。

**正式实现要求**

- 建立可版本化的知识库与检索；引用必须能回到文档、段落和版本。
- 相关度阈值、无来源处理、引用有效性校验。
- RAG 引用与 LLM 解释分离：无引用不得写成确定事实。
- 固定知识快照支持可重复回放。
- 记录检索查询、来源、相关度、采用 / 拒绝理由。

**输入 → 输出**

- 输入：业务问题 / 检索 query、区域与事件上下文、知识库版本。
- 输出：引用列表、相关度、阈值判断、可用 / 不可用限制。

**验证**

- No-source 不生成伪引用。
- 低相关引用不支撑确定结论。
- 引用可定位到真实文档版本。
- 解释中的每个知识断言都有引用。

**目标证据**：检索日志、引用快照、No-source 案例、知识库版本。

## B05 · Tool Calling

**对应业务问题**：系统如何调用历史查询、外部天气、RAG 与模型等工具，并记录参数、超时、失败和降级？

**当前实现**

- Run Trace 有工具调用表、参数、耗时、状态与失败记录，但种子运行中的外部工具结果是演示快照。
- 本地规则计算是真实执行的。
- 相关位置：[src/domain/recovery.ts](../src/domain/recovery.ts)、[src/pages/RunDetailPage.tsx](../src/pages/RunDetailPage.tsx)、[src/data/runs.ts](../src/data/runs.ts)。

**正式实现要求**

- 工具注册表与受控调用编排；工具权限、参数 Schema、超时、重试、取消。
- 每次工具调用生成独立记录，并关联 `run_id` 与证据 ID。
- 参数错误、超时、No-source 与部分失败分别建模。
- Tool Failure 不直接导致事件变为未恢复；降级策略明确。
- 不允许未记录的工具调用影响业务状态。

**输入 → 输出**

- 输入：工具名称、结构化参数、run_id、超时预算。
- 输出：工具结果、证据引用、错误 / 降级记录、耗时。

**验证**

- 工具参数错误被拒绝并记录。
- 超时后仍保留有效业务事实。
- 相同 run_id 的工具结果可从快照回放。
- 失败记录能回到具体证据。

**目标证据**：工具调用日志、参数 Schema、失败注入测试、Run Trace。

## B06 · ML Closed Loop

**对应业务问题**：轻量 ML 能否在 Priority / 风险分析中提供可验证的辅助价值，而不是装饰性标签？

**当前实现**

- 页面展示 ML 风险概率和模型版本占位，明确标注“未训练、未校准、演示输出”。
- ML 与 Rule 的分歧已展示，禁止 ML 覆盖业务状态。
- 相关位置：[src/data/evidence.ts](../src/data/evidence.ts)、[src/pages/EvidencePage.tsx](../src/pages/EvidencePage.tsx)。

**正式实现要求（最高标准）**

- 明确任务、特征、标签、数据来源、训练 / 验证 / 测试划分；时间序列采用按时间切分或滚动验证，防止信息泄漏。
- 至少一个 Rule / 基础基线对照。
- 选择合适指标（分类 Precision / Recall / F1；回归 MAE / RMSE），同时报告样本量、数据来源与测试条件。
- 训练 → 测试 → 评估 → 保存 → 重载 → 版本 → 固定测试可重复。
- 保存模型配置、评估结果、错误案例与失败案例。
- 模型加载或推理失败不破坏核心业务链。
- 在 Run Trace 记录实际使用的模型版本与推理结果。
- ML 输出是辅助证据，不得覆盖 Rule、Priority、Event 或 Recovery。

**输入 → 输出**

- 输入：按时间窗口构造的区域特征、标签、模型版本、数据版本。
- 输出：风险概率 / 分类、置信信息、模型版本、评估报告与错误案例。

**验证**

- 固定数据版本 + 模型版本 + 场景 ID 下结果可重复。
- Reload 后固定测试一致。
- Rule 与 ML 对照报告完整。
- 错误案例没有被隐藏。
- 模型故障时业务链仍可运行。

**目标证据**：数据集说明、切分代码、训练脚本、模型文件 / 版本、评估报告、错误案例、Reload 测试结果、Run Trace。

## B07 · Integration

**对应业务问题**：如何把多区域数据、SQLite 历史、Priority、事件处置、外部证据、RAG、工具、ML、LLM、地图 / H5 / Camera / TTS 集成为同一系统？

**当前实现**

- 前端已统一 zone / event / run 状态；Overview、History、Evidence、Events、Run Trace、空间地图与 H5 使用同一前端状态。
- 尚无后端、SQLite、真实工具、真实模型与真实外部服务。
- 相关位置：[src/App.tsx](../src/App.tsx)、[src/state/AppStore.tsx](../src/state/AppStore.tsx)、[src/pages/](../src/pages/)。

**正式实现要求**

- 前端 ↔ API ↔ SQLite ↔ 工具 / 模型 / LLM 的完整业务链。
- 同一 `zone_id` / `event_id` / `run_id` 跨 Web、H5、地图保持一致。
- 网络中断、同步延迟、服务失败有明确 UI 和降级行为。
- Action / Recovery / 证据 / 运行记录只通过受控 API 写入。
- 真实 MQTT / 人工观察 / 模拟数据可区分接入。

**输入 → 输出**

- 输入：多源数据（SIMULATED / PUBLIC / MANUAL_OBSERVATION / MODEL_OUTPUT）、处置动作、工具与模型结果。
- 输出：一致的业务状态、可解释 Priority、可验证 Recovery、可回查 Run Trace。

**验证**

- 一种业务状态只存在一个事实源。
- 多端一致性回归。
- 网络 / 服务故障不伪造实时状态。
- 同一事件的所有视图与 Run Trace 关联正确。

**目标证据**：集成架构图、API 契约、端到端测试、故障恢复记录、跨端一致性截图。

## B08 · Validation / Competition

**对应业务问题**：如何证明系统在固定场景、故障和版本条件下可重复、可回查、可复现，并形成比赛提交材料？

**当前实现**

- 阶段一完成构建、冒烟巡检、交互验证与截图记录。
- 有种子 Run Trace 与固定演示时钟，但尚未形成正式 S1–S5 验收材料。
- 相关位置：[docs/phase1_verification.md](phase1_verification.md)、[docs/screenshots/](screenshots/)。

**正式实现要求**

- S1–S5 场景脚本、输入版本、预期检查点、实际结果、`run_id` 与问题修复记录。
- 至少一次系统级 Failure 调试（MQTT bad JSON、History Failure、External timeout、RAG No-source、Tool 参数错误、Model Load Failure 至少覆盖一项）。
- Regression 用例与通过记录。
- app / config / data / model / rule 版本固定；固定场景可重复。
- 真实链路测试与固定快照回放分开记录。
- 至少一条完整 `run_id` 串起输入、工具、证据、规则 / ML、Explain、Event / Action 与最终状态。
- 发布证据汇总与独立复现说明。

**输入 → 输出**

- 输入：场景定义、数据版本、模型版本、配置版本、故障注入。
- 输出：场景执行结果、回归报告、发布证据、可复现说明。

**验证**

- 五场景连续可运行。
- 固定版本下结果可重复。
- 失败与降级解释完整。
- 独立环境按文档可启动并重跑关键场景。
- 正式仓库版本与验收证据一一对应。

**目标证据**：`docs/release_evidence.md`、场景运行日志、回归记录、Failure 修复记录、固定测试结果、commit / tag。

## 能力与页面映射（当前前端）

| 页面 / 模块 | 已覆盖能力 | 尚未覆盖 |
| --- | --- | --- |
| Overview / History | B07（前端集成）、B02 的读取展示 | 真实 SQLite、后端 API |
| Evidence | B03 / B04 的状态展示、B01 证据边界 | 真实外部 API、真实 RAG、真实 LLM |
| Event / Action / Re-evaluate | B05 本地规则执行、B07 状态闭环 | 受控工具编排、SQLite 事务 |
| Run Trace | B01 / B05 / B07 的证据链雏形 | 真实 LLM 上下文、真实工具结果、模型版本 |
| Space Map / H5 | B07 多端同源展示 | Camera、TTS、ASR、同步延迟协议 |
| ML 证据卡 | B06 的边界展示 | 训练、评估、重载、固定测试 |

## 当前诚实结论

阶段一证明了前端业务链、证据边界与运行追踪的可行性。上述许多能力目前只是“有位置、有状态标签”的演示，不足以支撑正式能力声明。下一阶段必须把 B02、B03、B06 从零补齐，并把 B01、B04、B05、B07、B08 从演示提升到可验证的真实链路。
