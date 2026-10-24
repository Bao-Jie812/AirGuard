import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronRight,
  Minus,
} from 'lucide-react'
import type { MetricKey, PriorityAssessment } from '../../data/types'
import { getZone } from '../../data/zones'
import {
  METRIC_META,
  ZONE_COLORS,
  ZONE_STATUS_LABELS,
} from '../../domain/constants'
import {
  cn,
  formatDelta,
  formatNumber,
} from '../../domain/format'
import { useAppStore } from '../../state/AppStore'
import {
  useLiveData,
  type LivePoint,
  type LiveSensorReading,
} from '../../state/LiveDataContext'
import { getActiveEventForZone } from '../../state/selectors'
import { MiniSparkline } from '../ui/MiniSparkline'
import { PriorityLevelBadge, ZoneStatusBadge } from '../ui/Badge'

interface PriorityTableProps {
  selectedZoneId: string
  onSelect: (zoneId: string) => void
}

/**
 * 优先使用当前 MQTT 读数；页面刷新后尚未收到下一条消息时，
 * 回退到同一份 MQTT 历史序列的最新点。
 * 这样表格展示的数值与 Priority 计算使用的数据始终同源，
 * 不会出现“Priority 有分数、指标列却是 —”的错位。
 */
function metricValue(
  reading: LiveSensorReading | undefined,
  history: LivePoint[] | undefined,
  metric: MetricKey,
): number | null {
  if (reading && reading.receivedAt > 0) {
    if (metric === 'pm25') return reading.pm25
    if (metric === 'co2') return reading.co2
    return reading.crowdLevel
  }
  const latest = history?.[history.length - 1]
  if (!latest) return null
  if (metric === 'pm25') return latest.pm25
  if (metric === 'co2') return latest.co2
  return latest.crowdLevel
}

function MetricCell({
  zoneId,
  metric,
  readings,
  histories,
}: {
  zoneId: string
  metric: MetricKey
  readings: Record<string, LiveSensorReading>
  histories: Record<string, LivePoint[]>
}) {
  const meta = METRIC_META[metric]
  const value = metricValue(readings[zoneId], histories[zoneId], metric)
  if (value === null) {
    return <span className="priority-table__metric priority-table__metric--empty">—</span>
  }
  return (
    <span className="priority-table__metric">
      {formatNumber(value, meta.digits)}
      <small>{meta.unit}</small>
    </span>
  )
}

function TrendCell({ priority }: { priority: PriorityAssessment }) {
  const meta = METRIC_META[priority.primaryMetric]
  const delta = priority.primaryDelta
  const improving = delta < 0
  const worsening = delta > 0
  const Icon = Math.abs(delta) < 0.01 ? Minus : improving ? ArrowDownRight : ArrowUpRight
  return (
    <span
      className={cn(
        'priority-trend',
        worsening && 'priority-trend--worse',
        improving && 'priority-trend--better',
      )}
      title="相比 1 小时前"
    >
      <Icon size={14} />
      <span>
        {meta.shortLabel} {formatDelta(delta, meta.digits)}
      </span>
    </span>
  )
}

function Sparkline({ priority }: { priority: PriorityAssessment }) {
  const { histories } = useLiveData()
  const live = histories[priority.zoneId] ?? []
  const values = live.slice(-26).map((point) =>
    priority.primaryMetric === 'pm25'
      ? point.pm25
      : priority.primaryMetric === 'co2'
        ? point.co2
        : point.crowdLevel,
  )
  return (
    <MiniSparkline
      values={values}
      color={ZONE_COLORS[priority.zoneId]}
      width={88}
      height={28}
    />
  )
}

export function PriorityTable({
  selectedZoneId,
  onSelect,
}: PriorityTableProps) {
  const { state } = useAppStore()
  const { priorities, readings, histories } = useLiveData()

  return (
    <div className="priority-table">
      <div className="priority-table__head" aria-hidden="true">
        <span>排名</span>
        <span>区域</span>
        <span>Priority</span>
        <span>PM2.5</span>
        <span>CO₂</span>
        <span>人流</span>
        <span>1 小时变化</span>
        <span className="priority-spark-head">趋势</span>
        <span />
      </div>
      <div className="priority-table__body">
        {priorities.map((priority) => {
          const activeEvent = getActiveEventForZone(state, priority.zoneId)
          // factors 为空表示尚未收到该区域的 MQTT 数据；
          // 此时不要显示误导性的 0.0 / 正常，改为显式等待状态。
          const hasData = priority.factors.length > 0
          return (
            <button
              type="button"
              key={priority.zoneId}
              className={cn(
                'priority-row',
                selectedZoneId === priority.zoneId && 'priority-row--selected',
              )}
              onClick={() => onSelect(priority.zoneId)}
              aria-pressed={selectedZoneId === priority.zoneId}
              style={{
                ['--zone-color' as string]: ZONE_COLORS[priority.zoneId],
              }}
            >
              <span className="priority-rank">
                {hasData ? String(priority.rank).padStart(2, '0') : '—'}
              </span>
              <span className="priority-zone">
                <span className="priority-zone__name">
                  {getZone(priority.zoneId).shortName}
                  {activeEvent && (
                    <span
                      className="priority-zone__active"
                      title={`未关闭事件：${activeEvent.title}`}
                    />
                  )}
                </span>
                <span className="priority-zone__status">
                  {hasData
                    ? ZONE_STATUS_LABELS[priority.zoneStatus]
                    : '等待 MQTT 数据'}
                  {activeEvent ? ' · 事件未关闭' : ''}
                </span>
              </span>
              <span className="priority-score">
                <strong>{hasData ? priority.score.toFixed(1) : '—'}</strong>
                {hasData && <PriorityLevelBadge level={priority.level} />}
              </span>
              <span className="priority-table__metric-cell">
                <MetricCell
                  zoneId={priority.zoneId}
                  metric="pm25"
                  readings={readings}
                  histories={histories}
                />
              </span>
              <span className="priority-table__metric-cell">
                <MetricCell
                  zoneId={priority.zoneId}
                  metric="co2"
                  readings={readings}
                  histories={histories}
                />
              </span>
              <span className="priority-table__metric-cell">
                <MetricCell
                  zoneId={priority.zoneId}
                  metric="crowdDensity"
                  readings={readings}
                  histories={histories}
                />
              </span>
              <span className="priority-trend-cell">
                {hasData ? (
                  <TrendCell priority={priority} />
                ) : (
                  <span className="priority-trend" title="等待 MQTT 数据">
                    <Minus size={14} />
                    <span>—</span>
                  </span>
                )}
              </span>
              <span className="priority-spark">
                <Sparkline priority={priority} />
              </span>
              <ChevronRight className="priority-chevron" size={16} />
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function PriorityMobileList({
  selectedZoneId,
  onSelect,
}: PriorityTableProps) {
  const { state } = useAppStore()
  const { priorities, readings, histories } = useLiveData()
  return (
    <div className="priority-mobile">
      {priorities.map((priority) => {
        const activeEvent = getActiveEventForZone(state, priority.zoneId)
        const hasData = priority.factors.length > 0
        const meta = METRIC_META[priority.primaryMetric]
        const reading = readings[priority.zoneId]
        const history = histories[priority.zoneId]
        const pm25 = metricValue(reading, history, 'pm25')
        const co2 = metricValue(reading, history, 'co2')
        const crowd = metricValue(reading, history, 'crowdDensity')
        return (
          <button
            type="button"
            key={priority.zoneId}
            className={cn(
              'priority-mobile__card',
              selectedZoneId === priority.zoneId &&
                'priority-mobile__card--selected',
            )}
            style={{
              ['--zone-color' as string]: ZONE_COLORS[priority.zoneId],
            }}
            onClick={() => onSelect(priority.zoneId)}
            aria-pressed={selectedZoneId === priority.zoneId}
          >
            <div className="priority-mobile__top">
              <span className="priority-mobile__rank">
                {hasData ? `#${priority.rank}` : '—'}
              </span>
              <strong>{getZone(priority.zoneId).shortName}</strong>
              {hasData ? (
                <ZoneStatusBadge status={priority.zoneStatus} />
              ) : (
                <span className="muted">等待数据</span>
              )}
              <span className="priority-mobile__score">
                {hasData ? priority.score.toFixed(1) : '—'}
              </span>
            </div>
            <div className="priority-mobile__metrics">
              <span>
                PM2.5{' '}
                <strong>{pm25 === null ? '—' : formatNumber(pm25)}</strong>
                <small>μg/m³</small>
              </span>
              <span>
                CO₂{' '}
                <strong>{co2 === null ? '—' : formatNumber(co2)}</strong>
                <small>ppm</small>
              </span>
              <span>
                人流{' '}
                <strong>
                  {crowd === null ? '—' : formatNumber(crowd, 2)}
                </strong>
                <small>人/㎡</small>
              </span>
            </div>
            <div className="priority-mobile__footer">
              <span>
                {hasData
                  ? `${meta.shortLabel} ${formatDelta(priority.primaryDelta, meta.digits)} ${meta.unit} · 1 小时`
                  : '等待 MQTT 实时数据'}
              </span>
              {activeEvent && (
                <span className="priority-mobile__event">事件未关闭</span>
              )}
              <ChevronRight size={16} />
            </div>
          </button>
        )
      })}
    </div>
  )
}
