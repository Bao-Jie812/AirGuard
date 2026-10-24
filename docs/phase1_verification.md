# AirGuard 阶段一验证记录

日期：2026-10-19  
项目目录：`D:\AirGuard`  
验证方式：本地 Vite 开发服务 + 本机 Microsoft Edge（Playwright Core 无头驱动）+ 生产构建。

## 1. M0 起点核验

- `D:\AirGuard` 初次检查时为空目录。
- 不是 Git 仓库。
- 未发现教师指定的 C02 AirGuard 仓库、启动脚本、页面、API、数据库、模型或测试资产。
- 因此本阶段为新建前端原型；**没有复用任何未实际检查过的资产**。
- 初始 Git 状态：无仓库，无提交记录。

环境：

- Node v24.21.0
- npm 11.19.0
- Windows 11
- 本机 Edge：`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`

## 2. 构建与静态检查

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| TypeScript / 生产构建 | `npm run build` | 通过；2551 modules transformed |
| 类型检查 | `npm run typecheck` | 通过 |
| Oxlint | `npm run lint` | 0 errors；保留 Fast Refresh / Effect 开发提示 |
| 控制台错误 | 无头浏览器遍历页面 | 0 console errors / 0 page errors |

构建体积：

- `dist/assets/index-*.js`：813.11 kB（gzip 241.35 kB）
- `dist/assets/index-*.css`：87.25 kB（gzip 15.61 kB）
- Vite 提示主 chunk > 500 kB；阶段一未做路由级拆包。

## 3. 页面巡检

在 1440×1000 桌面视口逐页加载、等待异步渲染并截图：

| 路由 | 检查点 | 结果 |
| --- | --- | --- |
| `/overview` | Priority 排序、关注卡、事件、证据健康 | 通过 |
| `/history?zone=zone_canteen_2` | 三张趋势图、Event / Action 标记、异常持续、前后对比 | 通过 |
| `/evidence?zone=zone_canteen_2` | 七项证据、来源、TIMEOUT、RAG 引用、ML、人工观察 | 通过 |
| `/evidence?zone=zone_library` | Rule / ML / History 分歧面板 | 通过 |
| `/events` | 事件筛选、搜索、事件卡 | 通过 |
| `/events/EVT-20261019-001` | 趋势、Action、样本表、Rule、即时预览、已保存结论 | 通过 |
| `/runs` | 运行列表与筛选 | 通过 |
| `/runs/RUN-20261019-001` | 输入、7 项证据、工具调用、失败、版本、解释 | 通过 |
| `/map` | 6 个区域、Priority 队列、事件标记、区域详情 | 通过 |
| `/m` | H5 只读预览、Camera / TTS 阶段二提示 | 通过 |
| 不存在的 `run_id` / `event_id` | 错误与返回入口 | 通过 |

响应式检查：

- 1440px：桌面双栏布局；Priority 表带迷你趋势。
- 1280px：总览改为单栏 Priority + 双列关注区；趋势迷你列隐藏。
- 1024px：侧边栏保留，统计卡改 2×2。
- 768px：Priority 表切换为移动卡片；无横向页面溢出。
- 390px：移动导航抽屉、移动卡片、H5 全宽布局可用。

说明：1440px 桌面截图中侧边栏的关闭按钮与移动菜单按钮已按桌面规则隐藏；此前测试中发现两者因选择器优先级意外显示，已修复并复测。

## 4. 交互验证

### 4.1 记录 Action

步骤：进入 `EVT-20261019-002`（图书馆）→ 记录 Action → 填写标题与备注 → 保存。

结果：

- 新增本地 Action。
- 事件状态变为 `HANDLING`。
- 页面出现成功 Toast。
- Action 后验样本仍为空，系统没有自动恢复事件。

### 4.2 新 Action 后重新评估

步骤：在上一步基础上点击“执行 Recovery 重新评估”。

结果：

- 生成 `RUN-20261019-005`。
- 结果为 `INSUFFICIENT_EVIDENCE`。
- 原因：最新 Action 之后没有有效的新业务数据。
- 运行列表从 4 条变为 5 条。
- 证明 Action Completed ≠ Recovery。

### 4.3 第二食堂重新评估与快照稳定性

步骤：在种子状态打开 `EVT-20261019-001` → 执行 Recovery 重新评估。

结果：

- 生成 `RUN-20261019-005`，结果 `STILL_HANDLING`。
- 最新有效样本 7 组；最近 CO₂ 分别为 1120 / 1090 ppm，高于 1000 ppm。
- 直接打开该 run 详情，刷新页面后仍显示 `STILL_HANDLING · 仍未恢复`，未重新生成结果。

### 4.4 重置演示

步骤：顶部“重置演示” → 确认。

结果：

- 本地 Action 与新增运行被清除。
- 恢复 4 条种子 Run Trace。
- 页面状态回到种子事件。

### 4.5 其他交互检查

- Evidence“仅看异常 / 失效”：第二食堂筛选后仅显示 1 项 TIMEOUT 证据；体育馆显示“该区域没有异常证据”空状态。
- 空间地图点击“教学区 A”后，右侧详情切换为“教学区 A 栋”。
- Run Trace 状态筛选“部分降级”：正确筛出 2 条 `PARTIAL` 运行。
- 事件状态筛选“未关闭”：显示 2 个事件；搜索“图书馆”后正确收敛为 1 条。
- Action 弹窗打开后焦点落在第一个表单控件（SELECT），不会先聚焦关闭按钮。

### 4.6 多端同源

在 H5 页面读取到同一事件与 Action 后的状态变化；H5 没有独立数据源。
Camera / TTS 点击后仅提示“阶段二实现”，不调用设备或生成伪结果。

## 5. 截图

- [区域总览](screenshots/overview.png)
- [历史趋势](screenshots/history.png)
- [证据与知识](screenshots/evidence.png)
- [事件与处置](screenshots/events.png)
- [事件详情](screenshots/event-detail.png)
- [Run Trace 列表](screenshots/runs.png)
- [Run Trace 详情](screenshots/run-trace.png)
- [空间地图](screenshots/space-map.png)
- [现场 H5](screenshots/h5.png)
- [移动端总览](screenshots/mobile-overview.png)
- [移动端 H5](screenshots/mobile-h5.png)

## 6. 当前测试边界

- 以上为前端原型冒烟验证，不是正式回归测试套件。
- 未实现自动化单元测试 / 端到端测试仓库脚本。
- 未验证真实 MQTT、传感器、外部 API、RAG、LLM 或 ML 推理。
- 未完成教师要求的正式 S1–S5 场景回放记录与至少一次系统级 Failure 调试。
- 上述内容需要在后续阶段补入发布证据与复现文档。
