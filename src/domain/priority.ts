import type {
  EventStatus,
  MetricKey,
  PriorityAssessment,
  PriorityFactor,
  PriorityLevel,
  ZoneDefinition,
  ZoneStatus,
} from '../data/types'
import { ZONES } from '../data/zones'
import {
  EVENT_STATUS_LABELS,
  METRIC_META,
  METRIC_ORDER,
  PRIORITY_LEVEL_LABELS,
  ZONE_STATUS_LABELS,
} from './constants'
import { clamp, formatDuration, formatNumber } from './format'

/** 评估所需的最小时间序列点（MQTT 实时历史 / liveStore 持久化数据） */
export interface MetricSeriesPoint {
  ts: number
  pm25: number
  co2: number
  crowdDensity: number
}

const METRIC_WEIGHTS: Record<MetricKey, number> = {
  pm25: 0.3,
  co2: 0.3,
  crowdDensity: 0.2,
}

const DURATION_WEIGHT = 0.1
const TREND_WEIGHT = 0.1

export function metricStatus(metric: MetricKey, value: number): ZoneStatus {
  const meta = METRIC_META[metric]
  if (value >= meta.critical) return 'CRITICAL'
  if (value >= meta.alert) return 'ALERT'
  if (value >= meta.watch) return 'WATCH'
  return 'NORMAL'
}

export function metricStatusLabel(metric: MetricKey, value: number): string {
  return ZONE_STATUS_LABELS[metricStatus(metric, value)]
}

/**
 * 正常区间内的基础负荷上限。
 * 正常值只用于“同档内排序”，因此整体贡献必须很小：
 * 三个指标都接近关注阈值时，加权后总分也 < 5 分。
 */
export const BASELINE_MAX_SEVERITY = 6

/**
 * 指标严重度（0–100），分段连续：
 *   0        → 0
 *   正常区间 → 0–6（仅用于正常区域之间的排序）
 *   WATCH    → 6
 *   ALERT    → 50
 *   CRITICAL → 80
 *   ≥CRITICAL → 80–100
 * 只有达到 WATCH / ALERT / CRITICAL 才会进入高分段；
 * 未关闭事件通过独立的事件因子加分，不混入指标严重度。
 */
export function metricSeverity(metric: MetricKey, value: number): number {
  const meta = METRIC_META[metric]
  if (!Number.isFinite(value) || value <= 0) return 0
  if (value < meta.watch) {
    return (value / meta.watch) * BASELINE_MAX_SEVERITY
  }
  if (value < meta.alert) {
    return (
      BASELINE_MAX_SEVERITY +
      ((value - meta.watch) / (meta.alert - meta.watch)) *
        (50 - BASELINE_MAX_SEVERITY)
    )
  }
  if (value < meta.critical) {
    return 50 + ((value - meta.alert) / (meta.critical - meta.alert)) * 30
  }
  return 80 + clamp(((value - meta.critical) / meta.critical) * 100, 0, 20)
}

export function zoneStatusFromMetrics(values: {
  pm25: number
  co2: number
  crowdDensity: number
}): ZoneStatus {
  const statuses = METRIC_ORDER.map((metric) =>
    metricStatus(metric, values[metric]),
  )
  if (statuses.includes('CRITICAL')) return 'CRITICAL'
  if (statuses.includes('ALERT')) return 'ALERT'
  if (statuses.includes('WATCH')) return 'WATCH'
  return 'NORMAL'
}

function oneHourEarlier(
  points: MetricSeriesPoint[],
  current: MetricSeriesPoint,
): MetricSeriesPoint | null {
  const target = current.ts - 60 * 60 * 1000
  let nearest: MetricSeriesPoint | null = null
  let distance = Number.POSITIVE_INFINITY
  for (const point of points) {
    if (point.ts > target) break
    const nextDistance = Math.abs(point.ts - target)
    if (nextDistance < distance) {
      nearest = point
      distance = nextDistance
    }
  }
  return nearest
}

function continuousAnomalyMinutes(
  points: MetricSeriesPoint[],
  metric: MetricKey,
): number | null {
  const meta = METRIC_META[metric]
  const latest = points[points.length - 1]
  if (!latest || latest[metric] < meta.watch) return null

  let startTs = latest.ts
  for (let i = points.length - 1; i >= 0; i -= 1) {
    if (points[i][metric] >= meta.watch) {
      startTs = points[i].ts
    } else {
      break
    }
  }
  return Math.round((latest.ts - startTs) / 60000)
}

function describeDelta(delta: number, unit: string, digits: number): string {
  if (Math.abs(delta) < Math.pow(10, -digits) / 2) return '基本持平'
  const formatted = formatNumber(Math.abs(delta), digits)
  return delta > 0 ? `上升 ${formatted} ${unit}` : `下降 ${formatted} ${unit}`
}

function buildFactors(
  points: MetricSeriesPoint[],
  primaryMetric: MetricKey,
  primaryDelta: number,
  anomalyMinutes: number | null,
  zoneStatus: ZoneStatus,
): PriorityFactor[] {
  const latest = points[points.length - 1]
  const factors: PriorityFactor[] = METRIC_ORDER.map((metric) => {
    const meta = METRIC_META[metric]
    const value = latest[metric]
    const severity = metricSeverity(metric, value)
    const status = metricStatus(metric, value)
    const statusLabel = ZONE_STATUS_LABELS[status]
    const detail =
      status === 'NORMAL'
        ? `${formatNumber(value, meta.digits)} ${meta.unit}，正常水平（关注阈值 ${formatNumber(meta.watch, meta.digits)}）`
        : `${formatNumber(value, meta.digits)} ${meta.unit}，处于${statusLabel}水平`
    return {
      key: metric,
      label: meta.label,
      contribution: Number((severity * METRIC_WEIGHTS[metric]).toFixed(1)),
      severity: Number(severity.toFixed(1)),
      detail,
    }
  })

  const meta = METRIC_META[primaryMetric]
  // 完全正常的区域不叠加趋势 / 持续异常加分，
  // 保证无事件的全绿区域总分稳定落在 0–5 分。
  const trendSeverity =
    zoneStatus === 'NORMAL'
      ? 0
      : clamp(
          (primaryDelta / (meta.alert - meta.watch)) * 100,
          0,
          100,
        )
  factors.push({
    key: 'trend',
    label: '1 小时变化',
    contribution: Number((trendSeverity * TREND_WEIGHT).toFixed(1)),
    severity: Number(trendSeverity.toFixed(1)),
    detail: `${meta.shortLabel} 较 1 小时前${describeDelta(primaryDelta, meta.unit, meta.digits)}`,
  })

  const durationSeverity =
    zoneStatus === 'NORMAL' || anomalyMinutes === null
      ? 0
      : clamp(anomalyMinutes / 240, 0, 1) * 100
  factors.push({
    key: 'duration',
    label: '异常持续',
    contribution: Number((durationSeverity * DURATION_WEIGHT).toFixed(1)),
    severity: Number(durationSeverity.toFixed(1)),
    detail:
      anomalyMinutes === null
        ? '当前指标未形成持续异常'
        : `主要指标已持续异常约 ${formatDuration(anomalyMinutes)}`,
  })

  return factors
}

function priorityLevel(score: number): PriorityLevel {
  if (score >= 50) return 'CRITICAL'
  if (score >= 35) return 'HIGH'
  if (score >= 20) return 'MEDIUM'
  return 'LOW'
}

function buildSummary(
  primaryMetric: MetricKey,
  primaryValue: number,
  primaryDelta: number,
  zoneStatus: ZoneStatus,
  anomalyMinutes: number | null,
  factors: PriorityFactor[],
): string {
  const meta = METRIC_META[primaryMetric]
  // 只把达到 WATCH 及以上的指标视作“异常贡献”。
  // 正常区间的基础负荷（< BASELINE_MAX_SEVERITY）不进入异常摘要。
  const activeFactors = factors
    .filter(
      (factor) =>
        factor.key !== 'trend' &&
        factor.key !== 'duration' &&
        factor.severity >= BASELINE_MAX_SEVERITY &&
        factor.key !== primaryMetric,
    )
    .sort((a, b) => b.contribution - a.contribution)

  if (zoneStatus === 'NORMAL' || activeFactors.length === 0) {
    return `当前主要指标${meta.shortLabel}为 ${formatNumber(primaryValue, meta.digits)} ${meta.unit}，区域整体处于${ZONE_STATUS_LABELS[zoneStatus]}范围；${describeDelta(primaryDelta, meta.unit, meta.digits)}。`
  }

  const secondary = activeFactors[0]
  const durationText =
    anomalyMinutes !== null && anomalyMinutes >= 1
      ? `异常已持续约 ${formatDuration(anomalyMinutes)}`
      : '尚未形成持续异常'
  const trendText =
    primaryDelta === 0
      ? '较 1 小时前基本持平'
      : `较 1 小时前${describeDelta(primaryDelta, meta.unit, meta.digits)}`

  return `${meta.shortLabel} ${formatNumber(primaryValue, meta.digits)} ${meta.unit}，处于${ZONE_STATUS_LABELS[zoneStatus]}水平；${secondary.detail}；${durationText}，${trendText}。`
}

function emptyAssessment(zoneId: string): PriorityAssessment {
  return {
    zoneId,
    score: 0,
    level: 'LOW',
    zoneStatus: 'NORMAL',
    rank: 0,
    factors: [],
    primaryMetric: 'pm25',
    primaryDelta: 0,
    anomalyDurationMinutes: null,
    summary: '等待 MQTT 实时数据接入，暂未形成评估。',
  }
}

export function assessZone(
  zone: ZoneDefinition,
  points: MetricSeriesPoint[],
): PriorityAssessment {
  if (points.length === 0) return emptyAssessment(zone.zoneId)
  const latest = points[points.length - 1]
  const earlier = oneHourEarlier(points, latest)

  const weighted = METRIC_ORDER.map((metric) => ({
    metric,
    weighted: metricSeverity(metric, latest[metric]) * METRIC_WEIGHTS[metric],
  }))
  const primaryMetric = weighted.reduce((best, next) =>
    next.weighted > best.weighted ? next : best,
  ).metric

  const primaryDelta = earlier
    ? Number((latest[primaryMetric] - earlier[primaryMetric]).toFixed(2))
    : 0
  const anomalyMinutes = continuousAnomalyMinutes(points, primaryMetric)
  const zoneStatus = zoneStatusFromMetrics(latest)
  const factors = buildFactors(
    points,
    primaryMetric,
    primaryDelta,
    anomalyMinutes,
    zoneStatus,
  )
  const score = Number(
    factors.reduce((total, factor) => total + factor.contribution, 0).toFixed(1),
  )

  return {
    zoneId: zone.zoneId,
    score,
    level: priorityLevel(score),
    zoneStatus,
    rank: 0,
    factors,
    primaryMetric,
    primaryDelta,
    anomalyDurationMinutes: anomalyMinutes,
    summary: buildSummary(
      primaryMetric,
      latest[primaryMetric],
      primaryDelta,
      zoneStatus,
      anomalyMinutes,
      factors,
    ),
  }
}

/** 未关闭事件对 Priority 的加分（只有非 RECOVERED 状态参与） */
export interface PriorityEventInfo {
  status: EventStatus
  title: string
}

const EVENT_PRIORITY_BOOST: Record<
  Exclude<EventStatus, 'RECOVERED'>,
  number
> = {
  OPEN: 55,
  HANDLING: 45,
  STILL_HANDLING: 50,
  INSUFFICIENT_EVIDENCE: 35,
}

/**
 * 有未关闭事件时，在当前数据得分上叠加事件因子。
 * 正常数据 + HANDLING 事件也会被顶到高优先级；
 * 已恢复（RECOVERED）事件只保留在历史记录中，不参与加分。
 */
function withActiveEvent(
  assessment: PriorityAssessment,
  event: PriorityEventInfo,
): PriorityAssessment {
  if (event.status === 'RECOVERED') return assessment
  const boost = EVENT_PRIORITY_BOOST[event.status]
  // 总分不超过 100；事件因子只占剩余空间，保证因子贡献之和与总分一致。
  const contribution = Number(
    Math.min(boost, Math.max(0, 100 - assessment.score)).toFixed(1),
  )
  const score = Number((assessment.score + contribution).toFixed(1))
  return {
    ...assessment,
    score,
    level: priorityLevel(score),
    factors: [
      ...assessment.factors,
      {
        key: 'event',
        label: '未关闭事件',
        contribution,
        severity: 100,
        detail: `${event.title}（${EVENT_STATUS_LABELS[event.status]}）`,
      },
    ],
    summary: `${assessment.summary} 另存在${EVENT_STATUS_LABELS[event.status]}事件「${event.title}」，已计入优先关注。`,
  }
}

/** 用于同分排序：剔除事件/趋势/持续异常后，比较纯指标负荷 */
function metricLoad(assessment: PriorityAssessment): number {
  return assessment.factors.reduce((total, factor) => {
    if (
      factor.key === 'trend' ||
      factor.key === 'duration' ||
      factor.key === 'event'
    ) {
      return total
    }
    return total + factor.severity
  }, 0)
}

export function assessAllZones(
  seriesByZone: Record<string, MetricSeriesPoint[]>,
  activeEventsByZone: Record<string, PriorityEventInfo | undefined> = {},
): PriorityAssessment[] {
  return ZONES.map((zone) => {
    const assessment = assessZone(zone, seriesByZone[zone.zoneId] ?? [])
    const activeEvent = activeEventsByZone[zone.zoneId]
    return activeEvent ? withActiveEvent(assessment, activeEvent) : assessment
  })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      const loadDiff = metricLoad(b) - metricLoad(a)
      if (loadDiff !== 0) return loadDiff
      return (
        (b.anomalyDurationMinutes ?? 0) - (a.anomalyDurationMinutes ?? 0)
      )
    })
    .map((assessment, index) => ({ ...assessment, rank: index + 1 }))
}

export function priorityForZone(
  priorities: PriorityAssessment[],
  zoneId: string,
): PriorityAssessment | undefined {
  return priorities.find((item) => item.zoneId === zoneId)
}

export function priorityLevelText(level: PriorityLevel): string {
  return PRIORITY_LEVEL_LABELS[level]
}
