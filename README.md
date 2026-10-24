# AirGuard · 多区域环境与人流智能分析

阶段一前端原型。一个统一 Web 工作台，覆盖 **Overview / History / Evidence / Event-Action-Re-evaluate / Run Trace**，并配套 2.5D 空间地图和现场 H5 只读预览。

> **阶段一数据边界**：全部业务数据均为本地模拟。未连接真实传感器、MQTT、外部 API、RAG 服务、LLM 或真实机器学习模型。Camera 拍照与 TTS / ASR 尚未实现，相关入口在界面中明确标注“阶段二”。

## 已确认的范围决策（2026-10-19）

- **仓库工作流**：`airguard-draft` 为私有草稿仓库，持续接收开发记录；`airguard-competition` 为公开正式仓库，只接收审核通过、确认完成的发布快照，不镜像草稿历史。
- **ASR**：纳入项目范围，与 TTS 分开验收；当前阶段尚未实现。
- **机器学习**：按最高标准实施，包含真实训练、时间序列防泄漏划分、Rule 基线对照、评估指标、模型保存 / 重载 / 版本、错误案例与固定测试。当前阶段只有明确标注的占位输出。
- **外部证据与知识库**：纳入范围。正式实现必须支持真实 Web API / RAG 链路，并保留固定证据快照回放以保证可重复验证。
- **最终验收**：接受 S1–S5、系统级 Failure 调试、Regression、完整 `run_id` 回查与独立复现的检查清单。
- **B01–B08**：已获得统一定义，能力映射见 [docs/b01_b08_increment_map.md](docs/b01_b08_increment_map.md)。

## 快速启动

环境要求：Node.js 20+（本次验证使用 Node v24.21.0 / npm 11.19.0）。

```bash
npm install
npm run dev
```

打开终端提示的地址，默认是 <http://localhost:5173>。

其他命令：

```bash
npm run typecheck   # TypeScript 类型检查
npm run build       # 类型检查 + 生产构建，输出 dist/
npm run preview     # 本地预览生产构建
npm run lint        # Oxlint
```

> 应用使用 `BrowserRouter`。若部署到静态服务器，需要把未知路径回退到 `index.html`，否则刷新子路由会 404。

## 页面路由

| 路由 | 视图 | 主要作用 |
| --- | --- | --- |
| `/overview` | 区域总览 | 多区域指标、Priority 排序、首要关注区、证据健康、事件与运行入口 |
| `/history` | 历史趋势 | 区域指标趋势、异常持续时间、Event / Action / Recovery 时间标记、Action 前后均值对比 |
| `/evidence` | 证据与知识 | Current、History、External、RAG、Rule、ML、人工观察；来源、状态、有效期、限制、证据分歧 |
| `/events` | 事件与处置 | 事件筛选与状态概览 |
| `/events/:eventId` | 事件详情 | 记录 Action、查看 Action 后验样本、执行 Recovery 重新评估、查看证据失败与关联运行 |
| `/runs` | Run Trace | 运行快照列表、场景与状态筛选 |
| `/runs/:runId` | Run Trace 详情 | 输入、证据、工具调用、Rule / ML、解释、失败记录、版本与最终输出 |
| `/map` | 空间地图 | 2.5D 空间示意、Priority 队列、未关闭事件标记，点击区域查看详情入口 |
| `/m` | 现场 H5 | 同一业务状态的移动端只读预览；Camera / TTS 明确未实现 |

## 阶段一已实现

- 统一侧边栏与顶部导航，桌面、平板与移动端响应式布局。
- 统一 zone / event / run / sample / evidence 数据模型与 `zone_id`、`event_id`、`run_id` 关联。
- 可见的数据来源区分：`SIMULATED`、`PUBLIC`、`MANUAL_OBSERVATION`、`MODEL_OUTPUT`。
- 可解释的 Priority 规则：当前指标 + 人流 + 1 小时变化 + 持续异常时间；可展开因子贡献。
- 6 个区域、3 个种子事件、2 条 Action、10 组后验样本、4 条种子 Run Trace。
- Action 记录表单与本地持久化；只登记处置，不直接改变 Recovery。
- Recovery 规则执行与结果 UI：`PM2.5 ≤ 75 μg/m³`、`CO₂ ≤ 1000 ppm`、`人流密度 ≤ 0.8 人/㎡`，要求最新 Action 之后连续 2 组有效样本。
- 本地重新评估会生成新的 `run_id` 并持久化；历史 Run Trace 只读取快照，不重新计算。
- Evidence 失败 / 过期 / 缺失 / 超时状态；证据冲突面板；工具失败与业务状态分离。
- 数据持久化到 `localStorage`（键名 `airguard.phase1.store`），顶部“重置演示”可恢复初始种子状态。
- 加载骨架、空数据、404 / 缺失 run_id、成功 Toast 等界面状态。

## 统一模拟场景

演示时钟固定为 **2026-10-19 14:30（Asia/Shanghai）**，历史数据从当日 00:00 至 14:30，15 分钟粒度。

| 区域 | 当前状态 | 演示用途 |
| --- | --- | --- |
| 第二食堂 | ALERT / Priority #1 | S5：Action 后 CO₂ 仍高于阈值，保持 `STILL_HANDLING` |
| 图书馆 | WATCH / Priority #2 | S4：Rule 与 ML 分歧；外部天气 TIMEOUT；RAG 相关度偏低 |
| 教学区 A | WATCH | 稳态中的轻微关注输入 |
| 体育馆 | NORMAL | S5：首组后验仍异常，连续两组合规后 `RECOVERED` |
| 东区宿舍 | NORMAL | RAG No-source（缺失）展示 |
| 实验楼 | NORMAL | 外部数据源 MISSING 展示 |

种子 Run Trace：

- `RUN-20261019-001`：第二食堂 Recovery 重新评估 → `STILL_HANDLING`
- `RUN-20261019-002`：图书馆证据分析 → `OPEN · WATCH`，保留 Rule / ML 分歧
- `RUN-20261019-003`：体育馆 Recovery 重新评估 → `RECOVERED`
- `RUN-20261019-004`：六区域 Priority 排序快照

这些是 **S1–S5 的部分演示切片**，不是完整的五场景验收记录。正式 S1–S5 场景脚本、回归测试与发布证据应在后续阶段补齐。

## 核心业务约束（已落地）

1. **Action Completed ≠ Recovery**：记录 Action 后事件进入 `HANDLING`；只有最新 Action 之后的有效样本满足规则才可能 `RECOVERED`。
2. **Evidence Failure ≠ Business Not Recovered**：外部证据超时或缺失只影响对应证据与解释完整度，不直接改写事件状态。
3. **已保存结果稳定**：Run Trace 从本地存储读取；重新打开不会触发新的模型或工具调用。
4. **模型边界**：ML 是演示占位输出，不修改 Priority / Event / Recovery；LLM Explain 为模板生成，只复述已保存证据。
5. **按最新 Action 重新开窗**：追加新 Action 后，旧后验样本不再计入新评估窗口；在没有新数据时会得到 `INSUFFICIENT_EVIDENCE`。

## 演示路径建议

1. **Overview**：查看第二食堂为什么排第一，展开因子贡献与证据健康。
2. **History**：切换区域与时间范围，查看 Event / Action 标记和 Action 前后均值对比。
3. **Evidence**：切换第二食堂 / 图书馆，查看超时、缺失、RAG 低相关度和 Rule / ML 分歧。
4. **事件详情**：
   - 第二食堂直接点击“执行 Recovery 重新评估”，会生成新的 `STILL_HANDLING` 运行。
   - 图书馆可记录一条 Action，再重新评估；由于新 Action 后没有样本，结果为 `INSUFFICIENT_EVIDENCE`。
5. **Run Trace**：打开新生成的 `run_id`，刷新页面确认结果保持不变；查看失败与版本信息。
6. **空间地图 / 现场 H5**：确认地图、H5 与 Web 使用同一状态；点击 Camera / TTS 会明确提示阶段二未实现。
7. 如需恢复初始状态：顶部“重置演示” → 确认重置。

## 目录结构

```text
src/
├── App.tsx                    # 路由
├── main.tsx                   # 入口与样式加载
├── components/
│   ├── charts/                # Recharts 趋势图与时间标记
│   ├── domain/                # PriorityTable / EvidenceCard / IsometricMap / ZonePicker 等
│   ├── layout/                # AppShell / Sidebar / Topbar
│   └── ui/                    # Button / Badge / Card / Modal / Notice / Skeleton 等
├── data/
│   ├── zones.ts               # 6 区域定义与指标曲线锚点
│   ├── history.ts             # 确定性 15 分钟历史序列
│   ├── evidence.ts            # 证据生成、健康计数、证据冲突
│   ├── events.ts              # 种子事件 / Action / 后验样本
│   ├── runs.ts                # 种子 Run Trace 与本地运行构建器
│   ├── seed.ts                # 初始状态
│   └── types.ts               # 统一业务类型
├── domain/
│   ├── priority.ts            # Priority 评分与解释因子
│   ├── recovery.ts            # Recovery Rule 判定
│   ├── constants.ts           # 版本、阈值、标签、演示时钟
│   └── format.ts              # 日期、时长、数值格式化
├── pages/                     # 10 个页面（含 H5 与 404）
├── state/
│   ├── AppStore.tsx           # 持久化状态、Action、重新评估
│   ├── selectors.ts           # 查询辅助
│   └── ToastContext.tsx       # 轻量反馈
└── styles/                    # tokens / global / components / pages
docs/
└── screenshots/               # 实际运行截图
```

## 验证情况

- `npm run build`：通过。
- `npm run lint`：0 errors；存在 Fast Refresh / Effect 相关警告（见下）。
- 使用本机 Edge + Playwright Core 无头浏览器检查了 1440 / 1280 / 1024 / 768 / 390 宽度。
- 所有已实现路由无控制台错误或页面异常。
- 实测交互：
  - 记录 Action 后事件进入 `HANDLING`；
  - 新 Action 后重新评估 → `INSUFFICIENT_EVIDENCE`，生成并保存新 Run Trace；
  - 第二食堂重新评估 → `STILL_HANDLING`，刷新后结果不变；
  - “重置演示”恢复 4 条种子运行；
  - 768px 下 Priority 表切换为移动卡片，390px 下页面可用。
- 运行截图见 [docs/screenshots](docs/screenshots/)。

## 本阶段未实现 / 已知限制

- 无后端、数据库、MQTT、真实传感器、真实外部 API、真实 RAG / LLM / ML 服务。
- ML 当前为固定演示占位输出；真实训练、评估指标、Reload 测试与错误案例集已确认纳入后续最高标准范围。
- Camera 拍照、照片上传、TTS、ASR 当前未实现（已确认纳入后续范围）；H5 当前为只读预览，不支持在 H5 内记录 Action。
- 地图为 Three.js 3D 示意场景（非真实地理位置坐标），建筑、道路与装饰均为程序化生成的低多边形模型。
- 不能注入新的后验数据；演示恢复与未恢复线索来自预置样本。新增 Action 后会因无新样本得到证据不足。
- 历史与当前数据固定在演示时钟，不会实时更新。
- 未完成正式 S1–S5 场景脚本回放、Regression 测试、系统级 Failure 调试记录和发布证据汇总。
- 构建产物主 JS 约 1.39 MB（gzip 约 389 KB），主要来自 Three.js 与 Recharts；本阶段未做路由级代码拆分。
- Oxlint 仍有 Fast Refresh（同一文件导出 hook/工具函数）与 Effect 内状态更新提示，未影响运行。

## 下一步

1. 完成 GitHub 草稿仓库 / 正式仓库初始化（私有草稿持续开发，公开正式仓库仅接收发布快照）。
2. 若教师提供 C02 AirGuard 仓库，再做资产核验，并决定哪些当前原型代码可以直接迁移。
3. 进入阶段二：后端 / SQLite、真实 Web API、RAG / Citation、Tool Calling、真实 LLM Context、ML 闭环、ASR / TTS / Camera。
4. 补齐 S1–S5 场景脚本、Failure 注入、Regression、发布证据与独立复现说明。
5. 正式仓库只接收确认完成的发布版本，不推送草稿历史。
