import { useMemo } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { RadioTower } from 'lucide-react'
import type { MetricKey } from '../../data/types'
import { getZone } from '../../data/zones'
import { METRIC_META, ZONE_COLORS } from '../../domain/constants'
import {
  formatDateTimeFromMs,
  formatNumber,
  formatTimeFromMs,
  formatTimeWithSecondsFromMs,
} from '../../domain/format'
import { metricStatus } from '../../domain/priority'
import {
  prepareChartSeries,
  type ChartSeriesPoint,
} from '../../domain/chartSeries'
import {
  useLiveData,
  type LivePoint,
  type MqttStatus,
} from '../../state/LiveDataContext'
import { ZoneStatusBadge } from '../ui/Badge'

interface BoardMetric {
  key: MetricKey
  label: string
  color: string
}

/* 低饱和色系，与事件详情页图表一致 */
const BOARD_METRICS: BoardMetric[] = [
  { key: 'pm25', label: 'PM2.5', color: '#56779a' },
  { key: 'co2', label: 'CO₂', color: '#b37a58' },
  { key: 'crowdDensity', label: '人流密度', color: '#4f8988' },
]

const MQTT_STATUS_TEXT: Record<MqttStatus, string> = {
  online: '已连接',
  connecting: '连接中',
  reconnecting: '重连中',
  offline: '离线',
}

interface BoardRow {
  ts: number
  pm25: number
  co2: number
  crowdDensity: number
}

function toRows(points: LivePoint[]): BoardRow[] {
  return points.map((point) => ({
    ts: point.ts,
    pm25: point.pm25,
    co2: point.co2,
    crowdDensity: point.crowdLevel,
  }))
}

/** X 轴跨度小于该值时，刻度精确到秒，避免短窗口内相邻刻度显示同一分钟 */
const SECOND_TICK_SPAN_MS = 5 * 60 * 1000

/**
 * 单指标趋势图：Y 轴按数据区间自适应（±8%），波动占满图面。
 * Web 端 LiveBoard 与 H5 现场端（H5TrendChart）共用同一组件，
 * 两端渲染逻辑 100% 一致。
 */
export function BoardChart({
  rows,
  metric,
  color,
  className = 'live-board__chart',
}: {
  rows: ChartSeriesPoint[]
  metric: MetricKey
  color: string
  /** 容器类名：H5 端传入自定义类覆盖高度（默认 220px） */
  className?: string
}) {
  const meta = METRIC_META[metric]
  const gradientId = `live-board-gradient-${metric}`
  const firstTs = rows[0]?.ts ?? 0
  const lastTs = rows[rows.length - 1]?.ts ?? 0
  const spanMs = lastTs - firstTs
  const values = rows
    .map((row) => row[metric])
    .filter((value): value is number => value !== null)
  const min = Math.min(...values)
  const max = Math.max(...values)
  // 警戒阈值线只在落入可视区间时绘制，避免误导
  const showAlertLine = meta.alert >= min * 0.92 && meta.alert <= max * 1.08
  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={rows}
          margin={{ top: 8, right: 6, bottom: 0, left: 0 }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.22} />
              <stop offset="100%" stopColor={color} stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid
            stroke="#e7edf2"
            strokeDasharray="3 4"
            vertical={false}
          />
          <XAxis
            dataKey="ts"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(value) =>
              spanMs < SECOND_TICK_SPAN_MS
                ? formatTimeWithSecondsFromMs(Number(value))
                : formatTimeFromMs(Number(value))
            }
            tick={{ fontSize: 10, fill: '#7a8b98' }}
            tickLine={false}
            axisLine={{ stroke: '#dfe7ee' }}
            minTickGap={56}
          />
          <YAxis
            width={46}
            domain={[
              (dataMin: number) => Math.floor(dataMin * 0.92),
              (dataMax: number) => Math.ceil(dataMax * 1.08),
            ]}
            tick={{ fontSize: 10, fill: '#7a8b98' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) =>
              formatNumber(Number(value), meta.digits === 2 ? 1 : 0)
            }
          />
          <Tooltip
            cursor={{ stroke: '#9fb2c0', strokeDasharray: '3 3' }}
            contentStyle={{
              borderRadius: 10,
              border: '1px solid #dfe7ee',
              boxShadow: '0 12px 32px -18px rgba(24, 50, 68, 0.35)',
              fontSize: 12,
              padding: '8px 10px',
            }}
            labelStyle={{ color: '#5b6d7b', marginBottom: 4 }}
            formatter={(value) => [
              `${formatNumber(Number(value), meta.digits)} ${meta.unit}`,
              meta.shortLabel,
            ]}
            labelFormatter={(label) => formatDateTimeFromMs(Number(label))}
          />
          {showAlertLine && (
            <ReferenceLine
              y={meta.alert}
              stroke="#d5b98f"
              strokeDasharray="5 4"
              strokeWidth={1}
            />
          )}
          <Area
            type="monotone"
            dataKey={metric}
            stroke={color}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={false}
            connectNulls={false}
            activeDot={{ r: 3.5, strokeWidth: 2, fill: '#ffffff' }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

/**
 * MQTT 实时监控大屏：横向铺开的三张大折线图，
 * 跟随全局选中区域，每 5 秒随 MQTT 推送更新。
 */
export function LiveBoard({ zoneId }: { zoneId: string }) {
  const { mqttStatus, readings, histories, priorities } = useLiveData()
  const zone = getZone(zoneId)
  const reading = readings[zoneId]
  const isStale = priorities.find((item) => item.zoneId === zoneId)?.summary.startsWith('STALE') ?? false
  // 大屏图表：断档断线 + 移动平均去抖；KPI 数值仍取原始最新点
  const rawRows = useMemo(
    () => toRows(histories[zoneId] ?? []),
    [histories, zoneId],
  )
  const rows = useMemo(() => prepareChartSeries(rawRows), [rawRows])
  const latest = rawRows.length > 0 ? rawRows[rawRows.length - 1] : null
  // 页面刷新后 readings 尚未恢复、但本地历史已恢复时，仍按历史快照展示，
  // 避免出现“已缓存 N 点”却显示“等待实时数据”的矛盾状态。
  const hasLive = !isStale && ((reading?.receivedAt ?? 0) > 0 || rawRows.length > 0)

  return (
    <section
      className="live-board"
      style={{ ['--zone-color' as string]: ZONE_COLORS[zoneId] }}
    >
      <div className="live-board__head">
        <div className="live-board__title">
          <span className="live-board__title-icon">
            <RadioTower size={18} />
          </span>
          <div>
            <h2>MQTT 实时监控大屏</h2>
            <p>
              {zone.name} · airguard/sensor/{zoneId} · 每 5 秒刷新 · 已缓存{' '}
              {rawRows.length} 点
            </p>
          </div>
        </div>
        <div className="live-board__meta">
          {latest && (
            <span className="live-board__updated">
              更新于 {formatDateTimeFromMs(latest.ts)}
            </span>
          )}
          <span className={`live-status live-status--${isStale ? 'offline' : mqttStatus}`}>
            <span className="live-dot" aria-hidden="true" />
            {isStale ? '数据离线 · STALE' : MQTT_STATUS_TEXT[mqttStatus]}
          </span>
        </div>
      </div>

      {hasLive && rows.length >= 2 && latest ? (
        <div className="live-board__grid">
          {BOARD_METRICS.map((metric) => {
            const meta = METRIC_META[metric.key]
            const value = latest[metric.key]
            const status = metricStatus(metric.key, value)
            return (
              <div className="live-board__panel" key={metric.key}>
                <div className="live-board__panel-head">
                  <span className="live-board__metric-label">
                    {metric.label}
                  </span>
                  <ZoneStatusBadge status={status} />
                </div>
                <div className="live-board__value">
                  <strong>{formatNumber(value, meta.digits)}</strong>
                  <small>{meta.unit}</small>
                </div>
                <BoardChart
                  rows={rows}
                  metric={metric.key}
                  color={metric.color}
                />
              </div>
            )
          })}
        </div>
      ) : (
        <div className="live-board__empty">
          <span className="live-dot live-dot--waiting" aria-hidden="true" />
          <p>
            {isStale
              ? '数据离线（STALE）：超过 15 秒未收到该区域的新数据，当前值已停止展示。'
              : <>等待实时数据 —— 运行 <code>npm run simulator</code> 启动 MQTT 模拟器后，此处每 5 秒绘制一个数据点。</>}
          </p>
        </div>
      )}
    </section>
  )
}
