#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
AirGuard 离线分析报告（D5 配套工具）。

读取传感器导出 CSV（长表：ts,zone_id,pm25,co2,crowd_level），
用 pandas 分析三个区域的 PM2.5 / CO2 趋势，matplotlib 出图，
生成单文件 report.html（图表 base64 内嵌）：今日摘要 + 趋势图 + 事件时间线。

找不到 CSV 时自动生成一份与 simulator.js 同口径的模拟数据
（5 秒粒度 · 随机游走 · 注入午餐高峰 / 午后扬尘两段异常），
保存为 sensor_export_simulated.csv 后再分析，保证报告内容完整可复现。

用法：
    python analyze_report.py                      # 找 sensor_export.csv，没有则生成模拟数据
    python analyze_report.py --csv my_export.csv  # 分析指定导出
    python analyze_report.py --out report.html    # 指定输出路径
"""
from __future__ import annotations

import argparse
import base64
import io
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

import matplotlib

matplotlib.use("Agg")
import matplotlib.dates as mdates
import matplotlib.pyplot as plt

# --------------------------------------------------------------------------
# 口径常量（与 Web 端 src/domain/constants.ts 保持一致）
# --------------------------------------------------------------------------

ZONES = [
    {"id": "zone-s", "name": "教学区 A 栋", "short": "教学区A"},
    {"id": "zone-w", "name": "第二食堂就餐区", "short": "第二食堂"},
    {"id": "zone-n", "name": "东区宿舍 3 号楼", "short": "东区宿舍"},
]
ZONE_NAMES = {z["id"]: z["name"] for z in ZONES}

# 图表系列色：categorical 固定顺序（项目 ZONE_COLORS 饱和度不足，
# CVD 校验未过；此处采用已验证调色板 slot 1–3，全项 PASS）
ZONE_COLORS = {
    "zone-s": "#2a78d6",
    "zone-w": "#eb6834",
    "zone-n": "#1baf7a",
}

# 状态分级阈值（与 simulator.js / METRIC_META 一致）
# 注：图表标题用 "CO2" 而非 "CO₂"——微软雅黑不含下标字符 U+2082
THRESHOLDS = {
    "pm25": {"label": "PM2.5", "unit": "μg/m³", "watch": 35, "alert": 75, "critical": 115},
    "co2": {"label": "CO2", "unit": "ppm", "watch": 800, "alert": 1000, "critical": 1500},
}

LEVELS = ["NORMAL", "WATCH", "ALERT", "CRITICAL"]
LEVEL_LABELS = {"NORMAL": "正常", "WATCH": "关注", "ALERT": "警戒", "CRITICAL": "严重"}
# 状态色（仅用于状态语义：badge / 阈值参考线，一律配文字标签）
LEVEL_COLORS = {"NORMAL": "#0d9b86", "WATCH": "#e5a93c", "ALERT": "#e2703a", "CRITICAL": "#d9534f"}
# 阈值参考线用 status 调色板步骤（warning / serious / critical）
THRESHOLD_LINE_COLORS = {"watch": "#fab219", "alert": "#ec835a", "critical": "#d03b3b"}

# 图表 chrome（浅色，参考调色板的 ink/grid 规范）
INK_PRIMARY = "#0b0b0b"
INK_SECONDARY = "#52514e"
INK_MUTED = "#898781"
GRID_COLOR = "#e1e0d9"
AXIS_COLOR = "#c3c2b7"

# 模拟数据的正常游走配置（与 simulator.js NORMAL_CONFIG 一致）
NORMAL_CFG = {
    "pm25": {"min": 20, "max": 30, "step": 2.0, "recovery_step": 45.0, "digits": 0},
    "co2": {"min": 600, "max": 780, "step": 10.0, "recovery_step": 400.0, "digits": 0},
    "crowd_level": {"min": 0.18, "max": 0.45, "step": 0.02, "recovery_step": 0.15, "digits": 2},
}

# 模拟注入的异常窗口：(zone, 指标, 起始, 结束, 异常区间, 爬升步长)
# 叙事：午餐高峰食堂 CO₂ 飙升 + 午后教学区 PM2.5 扬尘；宿舍全天正常作对照。
SIM_EVENTS = [
    ("zone-w", "co2", "11:30", "12:40", (1000, 1450), 120.0),
    ("zone-w", "pm25", "11:30", "12:40", (40, 70), 12.0),
    ("zone-s", "pm25", "15:00", "15:35", (80, 110), 25.0),
    ("zone-s", "co2", "15:00", "15:35", (820, 950), 60.0),
]


# --------------------------------------------------------------------------
# 数据获取
# --------------------------------------------------------------------------

def _walk_step(value: float, target: float, cfg: dict, outside: bool) -> float:
    """单步游走：限步长向 target 靠近；越出正常区间时用恢复步长（平滑回落）。"""
    step = cfg["recovery_step"] if outside else cfg["step"]
    delta = np.clip(target - value, -step, step)
    return round(float(np.clip(value + delta, cfg["min"], cfg["max"])), cfg["digits"])


def simulate_csv(path: Path, seed: int = 20261024) -> Path:
    """生成与 simulator.js 同口径的模拟 CSV（今天 08:00–18:00，5 秒粒度）。"""
    rng = np.random.default_rng(seed)
    today = datetime.now().date()
    start = datetime.combine(today, datetime.min.time()).replace(hour=8)
    periods = int((10 * 3600) / 5)  # 08:00–18:00
    ts_index = pd.date_range(start, periods=periods, freq="5s")

    # 每区域的异常脚本索引：时间 → (指标 → 区间/步长)
    def events_at(zone_id: str, t: datetime) -> dict:
        active = {}
        hm = t.strftime("%H:%M")
        for z, metric, t0, t1, band, step in SIM_EVENTS:
            if z == zone_id and t0 <= hm <= t1:
                active[metric] = (band, step)
        return active

    rows = []
    initials = {"zone-n": (24, 650, 0.22), "zone-s": (26, 700, 0.30), "zone-w": (28, 740, 0.36)}
    for zone in ZONES:
        state = {
            "pm25": initials[zone["id"]][0],
            "co2": initials[zone["id"]][1],
            "crowd_level": initials[zone["id"]][2],
        }
        targets = {m: rng.uniform(c["min"], c["max"]) for m, c in NORMAL_CFG.items()}
        for t in ts_index:
            active = events_at(zone["id"], t)
            for metric, cfg in NORMAL_CFG.items():
                if metric in active:
                    # 异常模式：目标取自异常区间，大步长爬升
                    band, step = active[metric]
                    if abs(targets[metric] - state[metric]) < step or not (
                        band[0] <= targets[metric] <= band[1]
                    ):
                        targets[metric] = rng.uniform(band[0], band[1])
                    delta = np.clip(targets[metric] - state[metric], -step, step)
                    state[metric] = round(float(max(0.0, state[metric] + delta)), cfg["digits"])
                else:
                    outside = not (cfg["min"] <= state[metric] <= cfg["max"])
                    if abs(targets[metric] - state[metric]) < cfg["step"] or outside:
                        if not (cfg["min"] <= targets[metric] <= cfg["max"]):
                            targets[metric] = rng.uniform(cfg["min"], cfg["max"])
                    state[metric] = _walk_step(state[metric], targets[metric], cfg, outside)
            rows.append((t, zone["id"], state["pm25"], state["co2"], state["crowd_level"]))

    df = pd.DataFrame(rows, columns=["ts", "zone_id", "pm25", "co2", "crowd_level"])
    df.to_csv(path, index=False, encoding="utf-8")
    return path


def load_data(csv_arg: str | None) -> tuple[pd.DataFrame, str, bool]:
    """返回 (df, 来源描述, 是否模拟)。优先读真实导出，缺文件则生成模拟数据。"""
    if csv_arg:
        path = Path(csv_arg)
        if not path.exists():
            sys.exit(f"[analyze_report] 找不到指定 CSV：{path}")
        simulated = False
    else:
        path = Path("sensor_export.csv")
        simulated = not path.exists()
        if simulated:
            path = Path("sensor_export_simulated.csv")
            if not path.exists():
                print(f"[analyze_report] 未发现导出 CSV，生成模拟数据 → {path}")
                simulate_csv(path)
            else:
                print(f"[analyze_report] 复用已有模拟数据 → {path}")

    df = pd.read_csv(path, parse_dates=["ts"])
    required = {"ts", "zone_id", "pm25", "co2"}
    missing = required - set(df.columns)
    if missing:
        sys.exit(f"[analyze_report] CSV 缺少必需列：{sorted(missing)}（需要 ts,zone_id,pm25,co2[,crowd_level]）")
    df = df[df["zone_id"].isin(ZONE_NAMES)].sort_values("ts").reset_index(drop=True)
    if df.empty:
        sys.exit("[analyze_report] CSV 中没有三个区域的任何数据。")
    source = f"{path}（{'模拟生成' if simulated else '外部导出'} · {len(df)} 行）"
    return df, source, simulated


# --------------------------------------------------------------------------
# 分析
# --------------------------------------------------------------------------

def level_of(metric: str, value: float) -> str:
    th = THRESHOLDS[metric]
    if value >= th["critical"]:
        return "CRITICAL"
    if value >= th["alert"]:
        return "ALERT"
    if value >= th["watch"]:
        return "WATCH"
    return "NORMAL"


@dataclass
class ZoneSummary:
    zone_id: str
    name: str
    status: str
    points: int
    span: str
    metrics: dict = field(default_factory=dict)  # metric -> dict


@dataclass
class Event:
    zone_id: str
    metric: str
    start: pd.Timestamp
    end: pd.Timestamp
    peak: float
    peak_level: str

    @property
    def minutes(self) -> float:
        return (self.end - self.start).total_seconds() / 60


def summarize(df: pd.DataFrame) -> list[ZoneSummary]:
    out = []
    for zone in ZONES:
        zdf = df[df["zone_id"] == zone["id"]]
        if zdf.empty:
            continue
        metrics = {}
        worst = "NORMAL"
        for metric, th in THRESHOLDS.items():
            s = zdf[metric].astype(float)
            latest = float(s.iloc[-1])
            latest_level = level_of(metric, latest)
            over_minutes = float((s >= th["watch"]).sum() * 5 / 60)  # 5 秒粒度
            metrics[metric] = {
                "latest": latest,
                "latest_level": latest_level,
                "mean": float(s.mean()),
                "peak": float(s.max()),
                "peak_at": zdf.loc[s.idxmax(), "ts"],
                "p95": float(s.quantile(0.95)),
                "over_minutes": over_minutes,
            }
            if LEVELS.index(latest_level) > LEVELS.index(worst):
                worst = latest_level
        span = f"{zdf['ts'].iloc[0]:%m-%d %H:%M} – {zdf['ts'].iloc[-1]:%H:%M}"
        out.append(
            ZoneSummary(zone["id"], zone["name"], worst, len(zdf), span, metrics)
        )
    return out


def derive_events(df: pd.DataFrame, gap_minutes: float = 2.0) -> list[Event]:
    """从数据派生事件：连续 ≥WATCH 的区段，间隔 < gap_minutes 的相邻段合并。"""
    events: list[Event] = []
    gap = pd.Timedelta(minutes=gap_minutes)
    for zone in ZONES:
        zdf = df[df["zone_id"] == zone["id"]]
        for metric, th in THRESHOLDS.items():
            over = zdf[zdf[metric] >= th["watch"]]
            if over.empty:
                continue
            # 段切分：相邻越限点时间差 > gap 即分段
            breaks = over["ts"].diff() > gap
            seg_id = breaks.cumsum()
            for _, seg in over.groupby(seg_id):
                peak_idx = seg[metric].idxmax()
                events.append(
                    Event(
                        zone_id=zone["id"],
                        metric=metric,
                        start=seg["ts"].iloc[0],
                        end=seg["ts"].iloc[-1],
                        peak=float(seg.loc[peak_idx, metric]),
                        peak_level=level_of(metric, float(seg.loc[peak_idx, metric])),
                    )
                )
    return sorted(events, key=lambda e: e.start)


# --------------------------------------------------------------------------
# 图表（matplotlib → PNG → base64）
# --------------------------------------------------------------------------

def _setup_style() -> None:
    plt.rcParams.update(
        {
            "font.sans-serif": ["Microsoft YaHei", "SimHei", "DejaVu Sans"],
            "axes.unicode_minus": False,
            "figure.facecolor": "white",
            "axes.facecolor": "white",
            "axes.edgecolor": AXIS_COLOR,
            "axes.linewidth": 1,
            "xtick.color": INK_MUTED,
            "ytick.color": INK_MUTED,
            "text.color": INK_PRIMARY,
            "axes.labelcolor": INK_SECONDARY,
        }
    )


def _end_labels(ax, items: list[tuple[pd.Timestamp, float, str]]) -> None:
    """末端直接标注（区域名+当前值），重叠时用 leader line 错开（不硬挤）。"""
    if not items:
        return
    ax.figure.canvas.draw()
    trans = ax.transData
    inv = trans.inverted()
    pts = []
    for x, y, text in items:
        px, py = trans.transform((mdates.date2num(x), y))
        pts.append([px, py, text, x, y])
    pts.sort(key=lambda p: p[1])

    # dpi=160 下 9.5pt 行高约 21px，24px 保证不重叠
    min_gap = 24.0
    for i in range(1, len(pts)):
        if pts[i][1] - pts[i - 1][1] < min_gap:
            pts[i][1] = pts[i - 1][1] + min_gap

    x_ax = ax.get_xlim()[1]
    # 轴右缘外移 8px，文字与轴线之间留呼吸位
    x_px = trans.transform((x_ax, 0))[0] + 8
    for px, py, text, x_data, y_data in pts:
        label_x, label_y = inv.transform((x_px, py))
        moved = abs(py - trans.transform((mdates.date2num(x_data), y_data))[1]) > 4
        ax.annotate(
            text,
            xy=(x_data, y_data),
            xytext=(label_x, label_y),
            xycoords="data",
            textcoords="data",
            fontsize=9.5,
            fontweight="bold",
            color=INK_PRIMARY,
            va="center",
            ha="left",
            annotation_clip=False,
            arrowprops=(
                {"arrowstyle": "-", "color": AXIS_COLOR, "linewidth": 0.8, "shrinkA": 0, "shrinkB": 2}
                if moved
                else None
            ),
        )


def trend_chart(df: pd.DataFrame, metric: str) -> str:
    th = THRESHOLDS[metric]
    fig, ax = plt.subplots(figsize=(10.8, 3.9), dpi=160)

    end_items = []
    for zone in ZONES:
        zdf = df[df["zone_id"] == zone["id"]]
        if zdf.empty:
            continue
        color = ZONE_COLORS[zone["id"]]
        ax.plot(
            zdf["ts"],
            zdf[metric],
            color=color,
            linewidth=2,
            solid_joinstyle="round",
            solid_capstyle="round",
            label=zone["short"],
            zorder=3,
        )
        x_end, y_end = zdf["ts"].iloc[-1], float(zdf[metric].iloc[-1])
        # 末端圆点：>=8px，2px surface ring
        ax.scatter(
            [x_end], [y_end], s=80, color=color, edgecolor="white", linewidth=2, zorder=5
        )
        end_items.append((x_end, y_end, f"{zone['short']} {y_end:g}"))

    # 阈值参考线（status 色细线 + muted 文字标签，右侧轴内对齐）
    for key, label in (("watch", "关注"), ("alert", "警戒"), ("critical", "严重")):
        y = th[key]
        ax.axhline(y, color=THRESHOLD_LINE_COLORS[key], linewidth=1, alpha=0.9, zorder=2)
        ax.text(
            0.005, y, f"{label} {y:g}",
            transform=ax.get_yaxis_transform(),
            fontsize=8, color=INK_MUTED, va="bottom", ha="left",
        )

    ax.grid(axis="y", color=GRID_COLOR, linewidth=1)  # hairline 实线
    ax.set_axisbelow(True)
    for side in ("top", "right", "left"):
        ax.spines[side].set_visible(False)
    ax.spines["bottom"].set_color(AXIS_COLOR)

    all_vals = df[metric].astype(float)
    y_lo = min(float(all_vals.min()), th["watch"])
    y_hi = max(float(all_vals.max()), th["critical"])
    ax.set_ylim(y_lo * 0.92, y_hi * 1.06)
    ax.set_title(f"{th['label']} 浓度趋势（{th['unit']}）", fontsize=13, loc="left", pad=26)
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%H:%M"))
    ax.xaxis.set_major_locator(mdates.HourLocator())
    ax.tick_params(labelsize=9, length=0)
    ax.legend(
        loc="lower left", bbox_to_anchor=(0, 1.0, 1, 0.12), ncols=3,
        frameon=False, fontsize=9.5, handlelength=1.6, columnspacing=1.6,
    )

    fig.subplots_adjust(left=0.055, right=0.865, top=0.86, bottom=0.12)
    _end_labels(ax, end_items)

    buf = io.BytesIO()
    fig.savefig(buf, format="png", facecolor="white")
    plt.close(fig)
    return base64.b64encode(buf.getvalue()).decode("ascii")


# --------------------------------------------------------------------------
# HTML 报告
# --------------------------------------------------------------------------

def _fmt(value: float, metric: str) -> str:
    return f"{value:,.0f}" if metric in ("pm25", "co2") else f"{value:.2f}"


def _badge(level: str) -> str:
    return (
        f'<span class="badge" style="--c:{LEVEL_COLORS[level]}">'
        f'<span class="badge__dot"></span>{LEVEL_LABELS[level]}</span>'
    )


def render_html(
    summaries: list[ZoneSummary],
    events: list[Event],
    charts: dict[str, str],
    source: str,
    simulated: bool,
) -> str:
    now = datetime.now()
    cards = []
    for s in summaries:
        rows = []
        for metric in ("pm25", "co2"):
            m = s.metrics[metric]
            th = THRESHOLDS[metric]
            rows.append(
                f"""
                <tr>
                  <td class="metric">{th['label']}<span class="unit">{th['unit']}</span></td>
                  <td class="num">{_fmt(m['latest'], metric)}</td>
                  <td class="num muted">{_fmt(m['mean'], metric)}</td>
                  <td class="num muted">{_fmt(m['peak'], metric)}</td>
                  <td class="num {'warn' if m['over_minutes'] > 0 else 'muted'}">{m['over_minutes']:.0f} min</td>
                </tr>"""
            )
        cards.append(
            f"""
        <article class="zone-card">
          <header>
            <span class="zone-dot" style="--c:{ZONE_COLORS[s.zone_id]}"></span>
            <h3>{s.name}</h3>
            {_badge(s.status)}
          </header>
          <p class="zone-meta">{s.points:,} 个采样点 · {s.span}</p>
          <table class="stat-table">
            <thead>
              <tr><th></th><th class="num">当前</th><th class="num">均值</th><th class="num">峰值</th><th class="num">超标</th></tr>
            </thead>
            <tbody>{''.join(rows)}</tbody>
          </table>
        </article>"""
        )

    if events:
        timeline_items = []
        for e in events:
            th = THRESHOLDS[e.metric]
            timeline_items.append(
                f"""
            <li class="tl-item">
              <span class="tl-dot" style="--c:{LEVEL_COLORS[e.peak_level]}"></span>
              <div class="tl-card">
                <div class="tl-head">
                  <span class="tl-time">{e.start:%H:%M}</span>
                  {_badge(e.peak_level)}
                  <strong>{ZONE_NAMES[e.zone_id]} · {th['label']}</strong>
                </div>
                <p class="tl-detail">
                  {e.start:%H:%M} – {e.end:%H:%M}（约 {e.minutes:.0f} 分钟）·
                  峰值 {_fmt(e.peak, e.metric)} {th['unit']}（{e.end:%H:%M} 前后）·
                  {th['label']} 关注阈值 {th['watch']:g} {th['unit']}
                </p>
              </div>
            </li>"""
            )
        timeline_html = f'<ol class="timeline">{"".join(timeline_items)}</ol>'
        event_note = f"共派生 {len(events)} 段越限事件（连续 ≥ 关注阈值，间隔 &lt; 2 分钟自动合并）"
    else:
        timeline_html = '<p class="empty">全天无越限时段：三区域指标均在关注阈值以下。</p>'
        event_note = "无越限事件"

    source_badge = "模拟数据" if simulated else "CSV 导出"
    th_rows = "".join(
        f"<tr><td>{th['label']}（{th['unit']}）</td>"
        f"<td class='num'>{th['watch']:g}</td><td class='num'>{th['alert']:g}</td><td class='num'>{th['critical']:g}</td></tr>"
        for th in THRESHOLDS.values()
    )

    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AirGuard 离线分析报告 · {now:%Y-%m-%d}</title>
<style>
  :root {{
    --bg: #edf3f2; --surface: #ffffff; --border: #e2ebe8; --border-strong: #cfdeda;
    --text: #16302b; --text-2: #4f6762; --text-3: #7f958f;
    --primary: #0d9b86; --amber: #c98a1e;
  }}
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0; padding: 32px 20px 56px;
    font-family: 'Inter','PingFang SC','Microsoft YaHei',system-ui,sans-serif;
    font-size: 14px; line-height: 1.55; color: var(--text);
    background: linear-gradient(180deg, #f1f6f5 0%, #eaf1ef 100%);
  }}
  .page {{ max-width: 1080px; margin: 0 auto; }}
  header.report-head {{
    display: flex; align-items: flex-end; justify-content: space-between;
    flex-wrap: wrap; gap: 12px; margin-bottom: 20px;
  }}
  .report-head h1 {{ margin: 0; font-size: 22px; }}
  .report-head .sub {{ margin: 4px 0 0; font-size: 12px; color: var(--text-3); }}
  .badge {{
    display: inline-flex; align-items: center; gap: 5px;
    padding: 2px 9px; border-radius: 999px; font-size: 11px; font-weight: 600;
    color: var(--c, var(--text-2)); background: color-mix(in srgb, var(--c, #7f958f) 10%, #fff);
    border: 1px solid color-mix(in srgb, var(--c, #7f958f) 28%, #fff);
  }}
  .badge__dot {{ width: 6px; height: 6px; border-radius: 50%; background: var(--c); }}
  h2.section {{ font-size: 15px; margin: 28px 0 4px; }}
  p.section-sub {{ margin: 0 0 12px; font-size: 12px; color: var(--text-3); }}
  .zone-grid {{ display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }}
  @media (max-width: 900px) {{ .zone-grid {{ grid-template-columns: 1fr; }} }}
  .zone-card {{
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 16px; padding: 16px; box-shadow: 0 1px 2px rgba(22,48,43,.04);
  }}
  .zone-card header {{ display: flex; align-items: center; gap: 8px; }}
  .zone-card h3 {{ margin: 0; font-size: 14px; flex: 1; }}
  .zone-dot {{ width: 10px; height: 10px; border-radius: 3px; background: var(--c); }}
  .zone-meta {{ margin: 6px 0 10px; font-size: 11px; color: var(--text-3); }}
  .stat-table {{ width: 100%; border-collapse: collapse; font-size: 12px; }}
  .stat-table th {{ font-weight: 500; color: var(--text-3); font-size: 10.5px; padding: 4px 6px; border-bottom: 1px solid var(--border); }}
  .stat-table td {{ padding: 6px; border-bottom: 1px solid var(--border); }}
  .stat-table tr:last-child td {{ border-bottom: none; }}
  .metric {{ font-weight: 600; }}
  .metric .unit {{ margin-left: 4px; font-weight: 400; font-size: 10px; color: var(--text-3); }}
  .num {{ text-align: right; font-variant-numeric: tabular-nums; }}
  .muted {{ color: var(--text-3); }}
  .warn {{ color: var(--amber); font-weight: 600; }}
  .chart-card {{
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 16px; padding: 12px; margin-bottom: 14px;
    box-shadow: 0 1px 2px rgba(22,48,43,.04);
  }}
  .chart-card img {{ width: 100%; display: block; border-radius: 8px; }}
  .timeline {{ list-style: none; margin: 0; padding: 0 0 0 4px; }}
  .tl-item {{ position: relative; padding: 0 0 14px 22px; border-left: 2px solid var(--border-strong); }}
  .tl-item:last-child {{ padding-bottom: 0; }}
  .tl-dot {{
    position: absolute; left: -7px; top: 4px;
    width: 12px; height: 12px; border-radius: 50%;
    background: var(--c); border: 2px solid #fff; box-shadow: 0 0 0 1px var(--border-strong);
  }}
  .tl-card {{
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 12px; padding: 10px 14px;
  }}
  .tl-head {{ display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }}
  .tl-head strong {{ font-size: 13px; }}
  .tl-time {{ font-variant-numeric: tabular-nums; font-weight: 700; font-size: 13px; }}
  .tl-detail {{ margin: 4px 0 0; font-size: 11.5px; color: var(--text-2); }}
  .empty {{
    padding: 18px; text-align: center; color: var(--text-3); font-size: 12.5px;
    background: var(--surface); border: 1px dashed var(--border-strong); border-radius: 12px;
  }}
  footer {{
    margin-top: 32px; padding-top: 14px; border-top: 1px solid var(--border);
    font-size: 11px; color: var(--text-3);
  }}
  footer table {{ margin-top: 8px; border-collapse: collapse; font-size: 11px; }}
  footer td, footer th {{ padding: 3px 14px 3px 0; text-align: left; }}
</style>
</head>
<body>
<div class="page">
  <header class="report-head">
    <div>
      <h1>AirGuard 离线分析报告</h1>
      <p class="sub">生成于 {now:%Y-%m-%d %H:%M} · 数据源：{source} · 口径与 Web 端规则（recovery-rule/1.0.0）一致</p>
    </div>
    <span class="badge" style="--c:#4a7fa5">{source_badge}</span>
  </header>

  <h2 class="section">今日摘要</h2>
  <p class="section-sub">三区域当前状态与全天统计；「超标」= 达到关注阈值及以上的累计时长。</p>
  <div class="zone-grid">{''.join(cards)}</div>

  <h2 class="section">指标趋势</h2>
  <p class="section-sub">5 秒粒度折线；水平参考线为关注 / 警戒 / 严重阈值；末端标注为最新读数。</p>
  <div class="chart-card"><img alt="PM2.5 趋势图" src="data:image/png;base64,{charts['pm25']}"></div>
  <div class="chart-card"><img alt="CO₂ 趋势图" src="data:image/png;base64,{charts['co2']}"></div>

  <h2 class="section">事件时间线</h2>
  <p class="section-sub">{event_note}。</p>
  {timeline_html}

  <footer>
    <p>阈值口径（与 simulator.js / Web 端 METRIC_META 一致）：</p>
    <table>
      <tr><th>指标</th><th>关注</th><th>警戒</th><th>严重</th></tr>
      {th_rows}
    </table>
    <p style="margin-top:8px">
      {'本报告基于本地生成的模拟数据，仅用于流程演示，不代表真实环境监测结果。' if simulated else '本报告基于导出的传感器数据生成。'}
      图表区域配色与 Web 端区域色不同：Web 端低饱和区域色未通过图表色弱分离度校验，报告改用经验证的图表调色板。
    </p>
  </footer>
</div>
</body>
</html>"""


# --------------------------------------------------------------------------
# 主流程
# --------------------------------------------------------------------------

def main() -> None:
    # Windows 控制台默认 GBK，避免中文输出乱码
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description="AirGuard 离线分析报告生成器")
    parser.add_argument("--csv", help="传感器导出 CSV 路径（缺省找 sensor_export.csv，没有则生成模拟数据）")
    parser.add_argument("--out", default="report.html", help="输出 HTML 路径（默认 report.html）")
    args = parser.parse_args()

    df, source, simulated = load_data(args.csv)
    summaries = summarize(df)
    events = derive_events(df)

    _setup_style()
    charts = {metric: trend_chart(df, metric) for metric in ("pm25", "co2")}

    html = render_html(summaries, events, charts, source, simulated)
    out_path = Path(args.out)
    out_path.write_text(html, encoding="utf-8")

    print(f"[analyze_report] 分析完成：{len(summaries)} 个区域，{len(events)} 段事件")
    for s in summaries:
        print(f"  · {s.name}: 当前 {LEVEL_LABELS[s.status]}，{s.points:,} 点")
    print(f"[analyze_report] 报告已生成 → {out_path.resolve()}")


if __name__ == "__main__":
    main()
