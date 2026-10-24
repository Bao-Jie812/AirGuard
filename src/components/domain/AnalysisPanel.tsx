import { useMemo, useState, type FormEvent } from 'react'
import { Bell, CheckCircle2, Search } from 'lucide-react'
import { getZone } from '../../data/zones'
import type { MetricKey } from '../../data/types'
import { METRIC_BAR_LIMITS, METRIC_META } from '../../domain/constants'
import { formatNumber } from '../../domain/format'
import { useAppStore } from '../../state/AppStore'
import { useLiveData } from '../../state/LiveDataContext'
import { useSelectedZone } from '../../state/SelectedZone'
import { getEventsForZone } from '../../state/selectors'
import { useToast } from '../../state/ToastContext'
import { EmptyState } from '../ui/EmptyState'

function smoothPath(points: Array<{ x: number; y: number }>): string {
  if (points.length < 2) return ''
  let d = `M ${points[0].x} ${points[0].y}`
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[Math.max(0, i - 1)]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[Math.min(points.length - 1, i + 2)]
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`
  }
  return d
}

/** 实时环境指标条渲染顺序；阈值配置见 domain/constants METRIC_BAR_LIMITS */
const BAR_ORDER: MetricKey[] = ['co2', 'pm25', 'crowdDensity']

export function AnalysisPanel() {
  const { state } = useAppStore()
  const { histories, readings } = useLiveData()
  const { selectedZoneId } = useSelectedZone()
  const { toast } = useToast()
  const [keyword, setKeyword] = useState('')
  const zone = getZone(selectedZoneId)
  // MQTT 实时读数：驱动底部「实时环境指标」进度条
  const reading = readings[selectedZoneId]

  // 事件统计全部来自真实业务状态（MQTT 触发的事件 + 真实处置记录）
  const eventStats = useMemo(() => {
    const zoneEvents = getEventsForZone(state, selectedZoneId)
    const open = zoneEvents.filter((event) => event.status === 'OPEN').length
    const handling = zoneEvents.filter(
      (event) =>
        event.status === 'HANDLING' || event.status === 'STILL_HANDLING',
    ).length
    const recovered = zoneEvents.filter(
      (event) => event.status === 'RECOVERED',
    ).length
    const actions = state.actions.filter(
      (action) => action.zoneId === selectedZoneId,
    ).length
    return { total: zoneEvents.length, open, handling, recovered, actions }
  }, [state, selectedZoneId])

  // PM2.5 趋势仅使用 MQTT 实时历史（无数据时明确提示）
  const trend = useMemo(() => {
    const live = histories[selectedZoneId] ?? []
    const sampleCount = 6
    const step = Math.max(1, Math.floor(live.length / sampleCount))
    const current: number[] = []
    const labels: string[] = []
    for (let i = sampleCount - 1; i >= 0; i -= 1) {
      const index = live.length - 1 - i * step
      if (index < 0) break
      const point = live[index]
      current.unshift(Math.round(point.pm25))
      labels.unshift(
        new Date(point.ts).toLocaleTimeString('zh-CN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }),
      )
    }
    return { current, labels }
  }, [histories, selectedZoneId])

  function handleSearch(event: FormEvent) {
    event.preventDefault()
    toast(
      `全局搜索将在阶段二提供，当前仅演示交互。关键词：${keyword || '（空）'}`,
      'info',
    )
  }

  const chartW = 300
  const chartH = 132
  const padL = 30
  const padR = 10
  const padT = 12
  const padB = 24
  const hasTrend = trend.current.length >= 2
  const maxV = hasTrend ? Math.max(...trend.current) * 1.15 || 1 : 1
  const toX = (index: number) =>
    padL + (index / (trend.current.length - 1)) * (chartW - padL - padR)
  const toY = (value: number) =>
    padT + (1 - value / maxV) * (chartH - padT - padB)
  const currentPoints = trend.current.map((value, index) => ({
    x: toX(index),
    y: toY(value),
  }))
  const areaPath = hasTrend
    ? `${smoothPath(currentPoints)} L ${currentPoints[currentPoints.length - 1].x} ${chartH - padB} L ${currentPoints[0].x} ${chartH - padB} Z`
    : ''

  return (
    <aside className="analysis-panel">
      <form className="analysis-search" onSubmit={handleSearch}>
        <input
          type="search"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="搜索关键词"
          aria-label="搜索关键词"
        />
        <button type="submit" aria-label="搜索">
          <Search size={17} />
        </button>
      </form>

      <section className="card analysis-card">
        <header className="analysis-card__head">
          <h3>{zone.shortName} · 事件分析</h3>
          <span className="analysis-tag">实时</span>
        </header>
        <p className="analysis-total">{formatNumber(eventStats.total)}</p>
        <p className="analysis-range">MQTT 实时触发的区域事件</p>

        <div className="analysis-split analysis-split--triple">
          <div className="analysis-split__item">
            <span className="analysis-split__icon analysis-split__icon--alert">
              <Bell size={15} />
            </span>
            <span className="analysis-split__copy">
              <small>待处置</small>
              <strong>{formatNumber(eventStats.open)}</strong>
            </span>
          </div>
          <div className="analysis-split__item">
            <span className="analysis-split__icon analysis-split__icon--normal">
              <CheckCircle2 size={15} />
            </span>
            <span className="analysis-split__copy">
              <small>处置中</small>
              <strong>{formatNumber(eventStats.handling)}</strong>
            </span>
          </div>
          <div className="analysis-split__item">
            <span className="analysis-split__icon analysis-split__icon--normal">
              <CheckCircle2 size={15} />
            </span>
            <span className="analysis-split__copy">
              <small>已恢复</small>
              <strong>{formatNumber(eventStats.recovered)}</strong>
            </span>
          </div>
        </div>
        <p className="analysis-note">
          Action 记录 {eventStats.actions} 条 · 事件由实时数据自动创建
        </p>
      </section>

      <section className="card analysis-card">
        <header className="analysis-card__head">
          <h3>{zone.shortName} · 空气质量趋势</h3>
          <span className="analysis-tag">PM2.5 实时</span>
        </header>
        {hasTrend ? (
          <>
            <svg
              className="analysis-trend"
              viewBox={`0 0 ${chartW} ${chartH}`}
              role="img"
              aria-label="PM2.5 实时趋势"
            >
              <defs>
                <linearGradient id="trend-area" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0d9b86" stopOpacity="0.2" />
                  <stop offset="100%" stopColor="#0d9b86" stopOpacity="0" />
                </linearGradient>
              </defs>
              {[0.25, 0.5, 0.75].map((ratio) => (
                <path
                  key={ratio}
                  d={`M ${padL} ${padT + ratio * (chartH - padT - padB)} H ${chartW - padR}`}
                  stroke="#e5ede9"
                  strokeDasharray="3 5"
                />
              ))}
              <path d={areaPath} fill="url(#trend-area)" />
              <path
                d={smoothPath(currentPoints)}
                fill="none"
                stroke="#0d9b86"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
              <circle
                cx={currentPoints[currentPoints.length - 1].x}
                cy={currentPoints[currentPoints.length - 1].y}
                r="3.4"
                fill="#0d9b86"
                stroke="#fff"
                strokeWidth="1.6"
              />
              {trend.labels.map((label, index) =>
                index % 2 === 0 ? (
                  <text
                    key={`${label}-${index}`}
                    x={toX(index)}
                    y={chartH - 8}
                    textAnchor="middle"
                    className="analysis-trend__tick"
                  >
                    {label}
                  </text>
                ) : null,
              )}
            </svg>
            <div className="analysis-legend">
              <span>
                <i style={{ background: '#0d9b86' }} />
                MQTT 实时序列（5 秒粒度）
              </span>
            </div>
          </>
        ) : (
          <EmptyState
            title="收集数据中"
            description="等待 MQTT 实时推送累积后绘制 PM2.5 趋势。"
            compact
          />
        )}
      </section>

      {/* 实时环境指标：水平进度条，flex 拉伸填满右栏剩余高度 */}
      <section className="card analysis-card analysis-card--stretch">
        <header className="analysis-card__head">
          <h3>{zone.shortName} · 实时环境指标</h3>
          <span className="analysis-tag">MQTT 实时</span>
        </header>
        <div className="metric-bars">
          {BAR_ORDER.map((key) => {
            const meta = METRIC_META[key]
            const limits = METRIC_BAR_LIMITS[key]
            const value =
              key === 'crowdDensity'
                ? (reading?.crowdLevel ?? null)
                : (reading?.[key] ?? null)
            const ratio = value === null ? 0 : Math.min(1, value / limits.max)
            const color =
              value === null
                ? '#a8bcb5'
                : value > limits.red
                  ? '#d9534f'
                  : value > limits.orange
                    ? '#e2703a'
                    : '#0d9b86'
            return (
              <div className="metric-bar" key={key}>
                <div className="metric-bar__head">
                  <span>{meta.label}</span>
                  <strong style={{ color }}>
                    {value === null
                      ? '—'
                      : `${formatNumber(value, meta.digits)} ${meta.unit}`}
                  </strong>
                </div>
                <div
                  className="metric-bar__track"
                  role="progressbar"
                  aria-label={meta.label}
                  aria-valuemin={0}
                  aria-valuemax={limits.max}
                  aria-valuenow={value ?? 0}
                >
                  <div
                    className="metric-bar__fill"
                    style={{ width: `${ratio * 100}%`, background: color }}
                  />
                </div>
              </div>
            )
          })}
        </div>
        <p className="analysis-note">
          满刻度：CO₂ 1500 ppm · PM2.5 150 μg/m³ · 人流 1.0 人/㎡
        </p>
      </section>
    </aside>
  )
}
