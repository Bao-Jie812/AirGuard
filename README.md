# AirGuard · 多区域环境与人流智能分析系统

> 🌿 让校园多区域监测从「看到指标」走向「知道先看哪里、为什么、处置后是否真的改善」。

AirGuard 是基于 **React + TypeScript + MQTT** 的校园环境与人流监测工作台。系统通过 MQTT 接收宿舍、教学区、食堂三个区域的模拟实时数据，以 **Three.js / React Three Fiber** 构建可交互的校园 3D 场景，并在 Web 大屏与 H5 现场端同步展示环境指标、关注优先级和事件状态。规则阈值与浏览器端 **Z-score 滑动窗口异常检测**并列对照；高德天气作为独立的室外参考证据，失效时不阻断室内业务链。

**一句话体验路径：** 区域总览 → 找到 Priority 最高的区域及原因 → 查看趋势与证据 → 记录 Action → 等待后续样本验证 Recovery → 回查 Run Trace。

> **数据声明：** 当前 MQTT 数据由 `simulator.js` 生成，属于演示数据，不代表真实校园传感器结果；地图是校园空间示意，不使用真实地理坐标。本文介绍的是仓库内已经实现的功能，不将案例书的 V1.0 目标误写成当前完成情况。

## ✨ 核心亮点

| 能力 | 当前实现 | 价值 |
| --- | --- | --- |
| 🔄 双数据链 | **实时链：** `simulator.js` → MQTT/JSON → 共享前端状态 → Web 工作台、H5 与 3D 场景；**离线链：** CSV → Python → `report.html` | 实时处置与离线复盘各有入口；报告可用指定 CSV 重新生成 |
| 🏫 空间联动 | 三个 `zoneId` 对应不同楼栋；3D 建筑和 2D 示意图响应实时状态、未关闭事件和区域选择 | 让异常、Priority 与事件在空间中可见 |
| 📊 可解释 Priority | 当前 PM2.5、CO₂、人流密度、历史趋势、持续时间及未关闭事件共同参与排序，并显示因子贡献 | 回答「为什么现在先关注这里」，而非只给出神秘分数 |
| ⚖️ 规则 / 轻量 ML 对照 | 固定阈值与 Z-score 滑动窗口统计并列；规则正常但统计异常 → 建议复核，规则异常但统计正常 → 保留规则警示 | 不用一个模型结论覆盖已确认的业务事实 |
| 🧩 可信降级 | 南京市高德天气实况请求失败时显示 `TIMEOUT` / `ERROR` 和原因 | 室外证据不可用 ≠ 室内状态异常，也不影响 MQTT、Priority 与事件链 |
| 🔁 Event → Action → Recovery | MQTT 越限读数可创建事件；Web / H5 记录处置；只接受 Action 后的新样本，并要求连续两组满足规则才确认恢复 | 证明「已经处置」不等于「已经恢复」 |
| 📷 现场佐证 | Web / H5 拍照留档生成“人工观察”证据，压缩照片经 MQTT 同步（在线时） | 照片提供现场佐证，不替代传感器事实 |

### 系统数据流

```text
实时链：模拟器 ──MQTT/TCP──> 公共 Broker ──MQTT/WebSocket──> 浏览器共享状态
                                                        ├── Web 总览 / 趋势 / 证据
                                                        ├── 3D 校园空间 / 2D 示意图
                                                        └── H5 现场查看与处置

离线链：CSV ──> analyze_report.py ──> 趋势、摘要、事件时间线 ──> report.html
```

实时链和离线链属于**同一项目的两条处理路径**，当前离线脚本**不会自动导出 MQTT 历史**；要分析采集数据，请先提供符合字段要求的 CSV。

## 🧰 技术栈

| 层级 | 技术 |
| --- | --- |
| 前端 | React 19、TypeScript、Vite 8、React Router、CSS |
| 实时消息 | MQTT.js、MQTT over WebSocket（浏览器）/ MQTT over TCP（模拟器） |
| 空间与图表 | Three.js、React Three Fiber、Drei、Recharts |
| 离线分析 | Python 3、NumPy、pandas、Matplotlib，输出单文件 HTML 报告 |
| 外部证据 | 高德开放平台天气 Web 服务 API（南京市实时天气） |
| 本地状态 | 浏览器 `localStorage` 保存实时历史、事件、Action 与运行记录；照片只在当前会话内保存 |

## 🚀 环境准备与快速启动

### 1. 安装环境与依赖

- **Node.js：推荐 22.12.0 或更新版本。**&#8203; 当前使用的 Vite 8.3.4 要求 `^20.19.0 || >=22.12.0`；Node 18 和更早版本不适用。
- npm 随 Node.js 安装；离线分析另需 Python 3 与 `numpy`、`pandas`、`matplotlib`。
- 需要能访问 MQTT Broker；若使用天气功能，还需能访问高德天气接口。

在项目根目录执行：

```bash
node --version
npm --version
npm install
```

已有 `package-lock.json` 时也可使用 `npm ci` 做锁定依赖安装。

### 2. 配置高德天气 Key（重要）

在**项目根目录**（与 `package.json` 同级）手动创建 `.env` 文件，填入你在[高德开放平台](https://lbs.amap.com/)申请的 **Web 服务 Key**：

```dotenv
VITE_AMAP_KEY=请替换为你自己的高德Web服务Key
```

- 当前天气接口为 `https://restapi.amap.com/v3/weather/weatherInfo`，查询南京市实况（城市代码 `320100`）。
- `.env` 已被 `.gitignore` 忽略，**不要把真实 Key 提交到 GitHub**；修改 `.env` 后必须重启 Vite 开发服务。
- `VITE_` 变量会被打包进浏览器代码，**并非真正保密**：请按高德平台说明限制 Key 的使用范围；若用于公开部署，应改为后端代理并做好访问控制。
- 没有 Key 也可以运行核心 MQTT、3D、Priority 与事件功能；天气证据会显示 `ERROR` 并解释降级原因。

### 3. 启动 Web 前端（终端 A）

```bash
npm run dev
```

打开终端显示的地址，通常为 <http://localhost:5173/>；工作台默认进入 `/overview`。现场端地址为 <http://localhost:5173/m>（端口以实际终端输出为准）。

### 4. 启动 MQTT 数据模拟器（终端 B）

在**同一项目根目录**另开终端，保持前端运行，然后执行：

```bash
node simulator.js
# 等价命令：npm run simulator
```

连接成功后，终端会显示 `connected to mqtt://broker.emqx.io:1883`；默认每 **5 秒**向 `airguard/sensor/zone-n`、`zone-s`、`zone-w` 分别发布一条 JSON。刷新 Web / H5 页面后，应看到 MQTT 已连接、三区域指标与趋势图更新，3D 楼栋状态随实时数据变化。

> 模拟器默认使用公共 Broker `broker.emqx.io:1883`；浏览器使用 `ws://broker.emqx.io:8083/mqtt`。两端必须连到**同一个 Broker**。当前浏览器连接地址写在 `src/services/mqttClient.ts`，模拟器可通过环境变量 `MQTT_BROKER_URL` 改地址；只改模拟器一侧会导致两端不通。公共 Broker 仅用于演示，不要传输真实个人信息或敏感现场照片。

**一条典型传感器消息**（示例值；实际内容以模拟器输出为准）：

```json
{
  "zoneId": "zone-w",
  "pm25": 28,
  "co2": 740,
  "crowdLevel": 0.36,
  "status": "NORMAL",
  "time": "2026-10-25T06:00:00.000Z"
}
```

`crowdLevel` 在**当前代码中是人流密度（人/㎡）**&#8203;，不是 C02 原任务书示例的 0–3 离散拥挤等级。客户端依据数值重新计算 `status`，不会盲信报文中的状态字段；相关阈值以 `src/domain/constants.ts` 和 `simulator.js` 为准。阈值只用于演示，不是公共卫生或健康诊断标准。

### 5. 复现异常 → 处置 → 恢复（推荐演示）

1. 打开 `/overview`，在“演示控制”点击**触发食堂异常**；浏览器向 `airguard/control` 发送指令，模拟器收到后立即发布异常读数。仅点击按钮本身**不会**在前端伪造事件。
2. 查看实时图表、Priority、地图告警和新建的 `OPEN` 事件；打开事件详情，或在 `/m` 的“处置”页记录 Action，事件进入 `HANDLING`。
3. 模拟器随后逐步回落。系统收集 `action_at` **之后**的有效 MQTT 样本；若尚未连续两组符合恢复规则，保持处理中 / 未恢复；达到事件定义的连续两组恢复条件后才进入 `RECOVERED`。
4. 需要重演时，可用演示控制的“一键恢复正常”让模拟器改发正常数据；这只是**恢复模拟输入**，不等于直接强制将事件标记为 `RECOVERED`。如需保存一次明确的重新评估结果，可在事件详情触发 Recovery 重新评估并进入 `/runs` 查看 `run_id`。

> 浏览器端历史和部分业务状态存于 `localStorage`，重开页面可回看；不同浏览器的本地历史**不是共享数据库**。现场联动依赖 MQTT 消息，不要把该演示形态描述为已完成服务端持久化。

### 6. 可选：生成 Python 离线分析报告

准备 Python 环境并安装依赖。建议将虚拟环境创建在**项目目录外**，避免意外把依赖文件提交到 GitHub。在 Windows（PowerShell / Git Bash）中可执行：

```bash
python -m venv ../airguard-report-venv
../airguard-report-venv/Scripts/python.exe -m pip install numpy pandas matplotlib
../airguard-report-venv/Scripts/python.exe analyze_report.py
```

在 macOS / Linux 中，将以上解释器路径替换为 `../airguard-report-venv/bin/python`，创建环境时可使用 `python3 -m venv ../airguard-report-venv`。下文的 `python` 指已激活上述环境的解释器；未激活时请使用虚拟环境中的 Python 完整路径。

默认优先读取项目根目录的 `sensor_export.csv`；如果没有，则**生成或复用** `sensor_export_simulated.csv`，并在根目录生成 `report.html`。在浏览器打开 `report.html` 可查看三区域摘要、PM2.5 / CO₂ 趋势及由数据派生的越限时间线。

要验证“换一份数据，报告能重算”，请显式指定 CSV：

```bash
python analyze_report.py --csv my_export.csv --out report.html
```

CSV 最少包含 `ts,zone_id,pm25,co2`，建议再包含 `crowd_level`；`zone_id` 取 `zone-n` / `zone-s` / `zone-w`。默认自动生成的模拟报告与实时 MQTT **不是同一次采集记录**，不要混称为实时导出结果。

## 🗂️ 项目目录

```text
AirGuard/
├── src/
│   ├── components/
│   │   ├── charts/           # Recharts 实时/历史趋势组件
│   │   ├── domain/           # 3D 校园、2D 地图、Priority、证据及业务卡片
│   │   ├── layout/           # Web 工作台侧栏、顶部导航
│   │   └── ui/               # 通用按钮、标签、卡片与交互组件
│   ├── pages/                # Overview、History、Evidence、Events、Runs、Map、H5
│   ├── services/             # MQTT 客户端、天气请求、图片压缩
│   ├── state/                # 实时数据、事件状态、浏览器持久化与通知
│   ├── domain/               # Priority、Recovery、Z-score、阈值及图表数据处理
│   ├── data/                 # 区域、业务类型、演示证据与种子数据
│   └── styles/               # 全局变量与 Web / H5 样式
├── simulator.js              # MQTT 三区域实时数据与异常/恢复指令模拟器
├── analyze_report.py         # CSV → Python 统计与可复现 HTML 报告
├── report.html               # 离线报告示例 / 重新运行后的输出
├── docs/                     # 阶段性说明及截图（部分旧文档记录早期原型）
└── package.json              # 前端依赖及脚本
```

## 🧭 页面与业务边界

| 地址 | 内容 |
| --- | --- |
| `/overview` | 区域总览、可解释 Priority、3D 态势、实时大屏与证据健康 |
| `/history` | MQTT 历史趋势及 Event / Action 时间线 |
| `/evidence` | 当前事实、历史、规则、Z-score、天气、演示知识引用与人工观察 |
| `/events`、`/events/:eventId` | 事件列表、处置 Action、后验样本与恢复复核 |
| `/runs`、`/runs/:runId` | 已保存的运行快照和可回查分析记录 |
| `/map` | 交互式校园 3D 空间 / 2D 示意 |
| `/m` | H5 现场查看、事件处置与拍照留档 |

**哪些是演示、哪些是真实接入：** MQTT 传输和高德 HTTP 请求是真实网络调用，但 MQTT 观测值来自模拟器；Z-score 是浏览器内统计检测，**尚无训练 / 测试 / 模型文件保存与重载流程**；知识引用目前是静态演示条目，不是在线 RAG 检索；Run Trace 包含演示快照与本地运行记录，不等同于已建成数据库或完整后端 Tool Trace。S03-B 案例书要求的完整 S1–S5、B01–B08 验收证据应单独核验，不能仅凭现有页面宣称全部通过。

## 🧪 检查与构建

```bash
npm run typecheck   # TypeScript 类型检查
npm run lint        # Oxlint 静态检查
npm run build       # 类型检查 + Vite 生产构建，产物在 dist/
npm run preview     # 本地预览已构建版本
```

应用使用 `BrowserRouter`；部署到静态服务器时，应配置未知路径回退至 `index.html`，否则刷新 `/m` 等子路由可能返回 404。HTTPS 页面不能直接连接当前硬编码的 `ws://` 地址；公开部署需要提供与页面协议兼容的安全 WebSocket 接入并相应修改客户端配置。

## ❓ 常见问题（FAQ）

<details>
<summary><strong>MQTT 一直显示离线或“重连中”，怎么排查？</strong></summary>

1. 确认前端和 `node simulator.js` **两个进程都在运行**，模拟器终端出现 `connected to ...` 及周期性发布日志。
2. 浏览器开发者工具检查 WebSocket 连接；本地前端使用 `ws://broker.emqx.io:8083/mqtt`，模拟器使用 `mqtt://broker.emqx.io:1883`。检查网络 / 防火墙是否允许相应端口，公共 Broker 是否可用。
3. 确保 Web 与模拟器使用同一 Broker、同一组 `airguard/sensor/...` Topic；如果更换 Broker，浏览器 URL 与模拟器 URL 都要调整。
4. 若页面通过 HTTPS 打开，`ws://` 会被浏览器拦截；本地先用 `http://localhost:5173` 验证，正式部署改用可用的 `wss://` 服务。
5. “已连接”只说明浏览器连上 Broker；**看不到数据**还要检查模拟器是否正在发布、订阅 Topic 是否一致。连接恢复后等待下一轮约 5 秒的采样。

</details>

<details>
<summary><strong>高德天气出现 TIMEOUT / ERROR，是否影响监测？</strong></summary>

不会。`TIMEOUT` 表示请求超过约 5 秒；`ERROR` 可能是 Key 未配置、鉴权失败、网络错误或接口返回不符合预期。先确认根目录 `.env` 中配置了有效的 `VITE_AMAP_KEY`，重启 `npm run dev`；再到 `/evidence` 点击“刷新天气”，用浏览器 F12 → Console 查看 `[天气]` 日志和接口错误码。即使天气不可用，室内 MQTT 数据、Priority 与 Event / Action / Recovery 不应被天气失败改写。

</details>

<details>
<summary><strong>打开页面却没有曲线、ML 显示“样本积累中”？</strong></summary>

先确认 MQTT 模拟器持续发布。实时图表需要至少两个数据点；Z-score 会在当前点之前积累足够的历史基线后才输出结果（当前最少 12 个基线点，每 5 秒一条）。断网、刚启动或本地历史为空时不应凭空显示模型判定。

</details>

<details>
<summary><strong>为什么运行 Python 脚本后，报告与当前 MQTT 大屏不一样？</strong></summary>

两条链目前不会自动互相导出：未指定 CSV 时，脚本读取 `sensor_export.csv`，或者生成 / 复用 `sensor_export_simulated.csv`。若要分析你自己的采样记录，请先导出符合字段约定的 CSV，再通过 `--csv` 指定文件；不要把模拟离线数据当作实时历史。

</details>

## ⚠️ 使用边界

本项目面向教学与竞赛演示，不提供真实公共卫生判断、人员身份识别或自动物理控制；阈值与 Priority 只是项目内可解释的关注规则。公共 MQTT Broker 和前端天气 Key 均不适合承载正式生产或敏感数据。若扩展为正式系统，需要私有消息服务、密钥代理、服务端持久化、权限隔离，并补齐异常输入、时序健壮性与场景回归验证。
