import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ArrowRight,
  Clock3,
  History as HistoryIcon,
  Minus,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import type { ChartMarker } from '../components/charts/MetricTrendChart'
import {
  ChartMarkerLegend,
  MetricTrendChart,
} from '../components/charts/MetricTrendChart'
import { SectionCard } from '../components/ui/Card'
import { StatTile } from '../components/ui/StatTile'
import { ZonePicker } from '../components/domain/ZonePicker'
import { PageIntro } from '../components/ui/PageIntro'
import { SkeletonChart, SkeletonText } from '../components/ui/Skeleton'
import { EmptyState } from '../components/ui/EmptyState'
import { buttonClass } from '../components/ui/Button'
import {
  EventStatusBadge,
  PriorityLevelBadge,
  ZoneStatusBadge,
} from '../components/ui/Badge'
import { useAppStore } from '../state/AppStore'
import { useLiveData, type LivePoint } from '../state/LiveDataContext'
import {
  useSelectedZone,
  useSyncZoneFromUrl,
} from '../state/SelectedZone'
import { getZone } from '../data/zones'
import type { ActionRecord, HistoryPoint, MetricKey } from '../data/types'
import { prepareChartSeries } from '../domain/chartSeries'
import { loadHistoryArchive, mergeLivePoints } from '../state/liveStore'
import {
  METRIC_META,
  ZONE_COLORS,
} from '../domain/constants'
import {
  formatDateTime,
  formatDateTimeFromMs,
  formatDelta,
  formatDuration,
  formatNumber,
  formatTime,
} from '../domain/format'
import {
  metricStatus,
  priorityLevelText,
} from '../domain/priority'
import { getEventsForZone } from '../state/selectors'
import { cn } from '../domain/format'

type RangeKey = '3h' | '6h' | '12h' | 'today'

const RANGE_OPTIONS: { key: RangeKey; label: string; hours: number | 'today' }[] = [
  { key: '3h', label: '近 3 小时', hours: 3 },
  { key: '6h', label: '近 6 小时', hours: 6 },
  { key: '12h', label: '近 12 小时', hours: 12 },
  { key: 'today', label: '今日', hours: 'today' },
]

type ComparisonSource =
  | 'MQTT_HISTORY'
  | 'ACTION_SNAPSHOT'
  | 'RECOVERY_SAMPLE'

interface ComparisonValue {
  ts: number
  pm25: number
  co2: number
  crowdDensity: number
  source: ComparisonSource
}

interface ComparisonRow {
  metric: MetricKey
  before: number | null
  after: number | null
  delta: number | null
}

const COMPARISON_METRICS: MetricKey[] = ['pm25', 'co2', 'crowdDensity']

const COMPARISON_SOURCE_LABELS: Record<ComparisonSource, string> = {
  MQTT_HISTORY: '本地历史',
  ACTION_SNAPSHOT: 'Action 快照',
  RECOVERY_SAMPLE: 'Recovery 样本',
}

function comparisonDigits(metric: MetricKey): number {
  // PM2.5 在对比面板里保留 1 位小数，变化更直观
  return metric === 'pm25' ? 1 : METRIC_META[metric].digits
}

function snapshotOf(point: HistoryPoint) {
  return {
    ts: point.ts,
    pm25: point.pm25,
    co2: point.co2,
    crowdDensity: point.crowdDensity,
  }
}

function nearestHourAgo(points: HistoryPoint[], latestTs: number) {
  const target = latestTs - 60 * 60 * 1000
  let nearest: HistoryPoint | null = null
  let distance = Number.POSITIVE_INFINITY
  for (const point of points) {
    const next = Math.abs(point.ts - target)
    if (next < distance) {
      nearest = point
      distance = next
    }
  }
  // 容差 20 分钟：差距过大说明序列里没有可比的参照点，不做「较 1 小时前」
  return nearest && distance <= 20 * 60 * 1000 ? nearest : null
}

/** MQTT 实时历史（localStorage 持久化）转换为图表点 —— 唯一数据源 */
function toHistoryPoints(live: LivePoint[], areaSqm: number): HistoryPoint[] {
  return live.map((point) => ({
    ts: point.ts,
    pm25: point.pm25,
    co2: point.co2,
    crowdDensity: point.crowdLevel,
    crowdCount: Math.round(point.crowdLevel * areaSqm),
    source: 'SIMULATED',
    timestamp: new Date(point.ts).toISOString(),
    timeLabel: formatTime(new Date(point.ts).toISOString()),
  }))
}

export function HistoryPage() {
  const { state } = useAppStore()
  const { histories, priorities } = useLiveData()
  const [, setSearchParams] = useSearchParams()
  const [range, setRange] = useState<RangeKey>('6h')
  const [loading, setLoading] = useState(true)
  const { selectedZoneId, setSelectedZoneId } = useSelectedZone()
  useSyncZoneFromUrl()

  const zone = getZone(selectedZoneId)
  const priority = priorities.find((item) => item.zoneId === selectedZoneId)
  const rangeConfig =
    RANGE_OPTIONS.find((option) => option.key === range) ?? RANGE_OPTIONS[1]
  // 历史归档在页面挂载时读取一次（localStorage 中跨会话持久化），
  // 再与当前实时序列合并。MQTT 断线 / 刷新后，旧数据仍可用于趋势与前后对比。
  const [archivedHistory] = useState(() => loadHistoryArchive())
  const zoneLivePoints = useMemo(
    () =>
      mergeLivePoints(
        archivedHistory[selectedZoneId] ?? [],
        histories[selectedZoneId] ?? [],
      ),
    [archivedHistory, histories, selectedZoneId],
  )
  const mergedPoints = useMemo(
    () => toHistoryPoints(zoneLivePoints, zone.areaSqm),
    [zoneLivePoints, zone.areaSqm],
  )
  const points = useMemo(() => {
    const end = mergedPoints[mergedPoints.length - 1]
    if (!end) return mergedPoints
    if (rangeConfig.hours === 'today') {
      // 归档可能跨天；「今日」只取最新数据所在自然日
      const dayStart = new Date(end.ts)
      dayStart.setHours(0, 0, 0, 0)
      return mergedPoints.filter((point) => point.ts >= dayStart.getTime())
    }
    const threshold = end.ts - rangeConfig.hours * 60 * 60 * 1000
    return mergedPoints.filter((point) => point.ts >= threshold)
  }, [mergedPoints, rangeConfig])
  // 图表序列：断档处断线 + 移动平均去抖（统计数值仍用原始 points）
  const chartSeries = useMemo(() => prepareChartSeries(points), [points])
  const latest = points[points.length - 1]
  const earlier = latest ? nearestHourAgo(mergedPoints, latest.ts) : null
  const events = getEventsForZone(state, selectedZoneId)
  const actions = useMemo(
    () =>
      state.actions
        .filter((action) => action.zoneId === selectedZoneId)
        .sort(
          (a, b) =>
            new Date(b.actionAt).getTime() - new Date(a.actionAt).getTime(),
        ),
    [state.actions, selectedZoneId],
  )

  useEffect(() => {
    setLoading(true)
    const timer = window.setTimeout(() => setLoading(false), 280)
    return () => window.clearTimeout(timer)
  }, [selectedZoneId, range])

  const markers = useMemo<ChartMarker[]>(() => {
    const result: ChartMarker[] = []
    for (const event of events) {
      result.push({
        at: event.openedAt,
        type: 'event',
        label: `事件开启 ${formatTime(event.openedAt)}`,
      })
      const eventActions = state.actions.filter(
        (action) => action.eventId === event.eventId,
      )
      for (const action of eventActions) {
        result.push({
          at: action.actionAt,
          type: 'action',
          label: `Action ${formatTime(action.actionAt)}`,
        })
      }
      if (event.closedAt) {
        result.push({
          at: event.closedAt,
          type: 'recovery',
          label: `恢复 ${formatTime(event.closedAt)}`,
        })
      }
    }
    return result
  }, [events, state.actions])

  /**
   * Action 前后对比。
   *
   * 数据源按优先级组合，任何一侧有数据都会立即渲染，不再依赖
   * 「Action 前后必须有 MQTT 实时点」这一前提：
   *   - 前值：Action 前最近的本地历史 / Action 记录时快照（取更接近 action_at 者）
   *   - 后值：该 Action 的 Recovery 后验样本（localStorage 持久化）→ Action 后的本地历史
   */
  const comparison = useMemo(() => {
    if (actions.length === 0) return null

    const build = (action: ActionRecord) => {
      const actionTs = new Date(action.actionAt).getTime()
      const samples = state.recoverySamples
        .filter(
          (sample) =>
            sample.eventId === action.eventId &&
            sample.actionId === action.actionId &&
            new Date(sample.timestamp).getTime() > actionTs,
        )
        .map((sample) => ({
          ts: new Date(sample.timestamp).getTime(),
          pm25: sample.pm25,
          co2: sample.co2,
          crowdDensity: sample.crowdDensity,
        }))
        .sort((a, b) => a.ts - b.ts)

      const beforeLive = mergedPoints.filter((point) => point.ts <= actionTs)
      const nearestBefore = beforeLive[beforeLive.length - 1] ?? null
      const afterLive = mergedPoints.filter((point) => point.ts > actionTs)
      const latestAfter = afterLive[afterLive.length - 1] ?? null

      // 前值取「离 Action 最近的那份数据」：本地历史点与 Action 记录时
      // 快照比较时间距离，谁更接近 action_at 用谁。
      const liveGap = nearestBefore
        ? actionTs - nearestBefore.ts
        : Number.POSITIVE_INFINITY
      const baselineGap = action.baseline
        ? actionTs - action.baseline.ts
        : Number.POSITIVE_INFINITY
      const before: ComparisonValue | null =
        action.baseline && baselineGap < liveGap
          ? { ...action.baseline, source: 'ACTION_SNAPSHOT' }
          : nearestBefore
            ? { ...snapshotOf(nearestBefore), source: 'MQTT_HISTORY' }
            : action.baseline
              ? { ...action.baseline, source: 'ACTION_SNAPSHOT' }
              : null

      const after: ComparisonValue | null =
        samples.length > 0
          ? { ...samples[samples.length - 1], source: 'RECOVERY_SAMPLE' }
          : latestAfter
            ? { ...snapshotOf(latestAfter), source: 'MQTT_HISTORY' }
            : null

      const rows: ComparisonRow[] = COMPARISON_METRICS.map((metric) => ({
        metric,
        before: before ? before[metric] : null,
        after: after ? after[metric] : null,
        delta: before && after ? after[metric] - before[metric] : null,
      }))

      return { action, before, after, rows }
    }

    // 优先展示最新一条前后数据齐全的 Action；没有齐全的就退到
    // 任一有数据的 Action，最后才退到最新 Action，避免面板空转。
    const candidates = actions.map(build)
    return (
      candidates.find(
        (item) => item.before !== null && item.after !== null,
      ) ??
      candidates.find(
        (item) => item.before !== null || item.after !== null,
      ) ??
      candidates[0]
    )
  }, [actions, mergedPoints, state.recoverySamples])

  const timelineEntries = events
    .flatMap((event) =>
      event.statusHistory.map((entry) => ({
        ...entry,
        eventId: event.eventId,
        eventTitle: event.title,
      })),
    )
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())

  function selectZone(zoneId: string) {
    setSelectedZoneId(zoneId)
    setSearchParams({ zone: zoneId }, { replace: true })
  }

  return (
    <div className="page-stack history-page">
      <PageIntro
        eyebrow="History / 历史演化"
        title="历史趋势"
        description="查看指标如何变化、异常持续了多久，以及 Event 与 Action 在时间轴上的位置。"
        actions={
          <>
            <Link
              className={buttonClass('secondary', 'md')}
              to={`/evidence?zone=${selectedZoneId}`}
            >
              证据与知识
            </Link>
            {events[0] ? (
              <Link
                className={buttonClass('primary', 'md')}
                to={`/events/${events[0].eventId}`}
              >
                查看关联事件
                <ArrowRight size={15} />
              </Link>
            ) : (
              <Link className={buttonClass('primary', 'md')} to="/events">
                查看事件
                <ArrowRight size={15} />
              </Link>
            )}
          </>
        }
      />

      <div className="filter-card">
        <div className="filter-card__row">
          <ZonePicker
            selectedZoneId={selectedZoneId}
            onChange={selectZone}
          />
          <div className="segmented" role="group" aria-label="时间范围">
            {RANGE_OPTIONS.map((option) => (
              <button
                type="button"
                key={option.key}
                className={cn(
                  'segmented__item',
                  range === option.key && 'segmented__item--active',
                )}
                onClick={() => setRange(option.key)}
                aria-pressed={range === option.key}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="filter-card__meta">
          <span>
            <HistoryIcon size={14} />
            {zone.name} · {rangeConfig.label} · 5 秒粒度 · MQTT 实时
          </span>
          {priority && (
            <span className="filter-card__priority">
              Priority #{priority.rank} · {priority.score.toFixed(1)}
              <PriorityLevelBadge level={priority.level} />
            </span>
          )}
        </div>
      </div>

      <div className="stat-grid stat-grid--four">
        {(['pm25', 'co2', 'crowdDensity'] as const).map((metric) => {
          const meta = METRIC_META[metric]
          const value = latest ? latest[metric] : null
          const before = earlier && latest ? earlier[metric] : value
          const status = value === null ? 'NORMAL' : metricStatus(metric, value)
          return (
            <StatTile
              key={metric}
              label={meta.label}
              value={value === null ? '—' : formatNumber(value, meta.digits)}
              unit={meta.unit}
              tone={
                status === 'ALERT' || status === 'CRITICAL'
                  ? 'danger'
                  : status === 'WATCH'
                    ? 'warning'
                    : 'default'
              }
              hint={
                value === null
                  ? '等待 MQTT 实时数据'
                  : earlier && before !== null
                    ? `较 1 小时前 ${formatDelta(value - before, meta.digits)} ${meta.unit}`
                    : '实时数据累计不足 1 小时'
              }
            />
          )
        })}
        <StatTile
          label="异常持续时间"
          value={
            priority?.anomalyDurationMinutes !== null &&
            priority?.anomalyDurationMinutes !== undefined
              ? formatDuration(priority.anomalyDurationMinutes)
              : '未持续'
          }
          tone={
            priority?.anomalyDurationMinutes ? 'warning' : 'default'
          }
          hint={
            priority?.anomalyDurationMinutes && latest
              ? `自 ${formatTime(
                  new Date(
                    latest.ts - priority.anomalyDurationMinutes * 60000,
                  ).toISOString(),
                )} 起持续高于关注阈值`
              : '主要指标未持续高于关注阈值'
          }
          icon={<Clock3 size={17} />}
        />
      </div>

      <SectionCard
        title="环境指标趋势"
        subtitle={`${zone.name} · 虚线标记 Event / Action 发生时间与警戒阈值`}
        action={<ZoneStatusBadge status={priority?.zoneStatus ?? 'NORMAL'} />}
      >
        {loading ? (
          <div className="chart-pair">
            <div>
              <SkeletonText lines={1} />
              <SkeletonChart height={220} />
            </div>
            <div>
              <SkeletonText lines={1} />
              <SkeletonChart height={220} />
            </div>
          </div>
        ) : points.length < 2 ? (
          <EmptyState
            title="收集数据中"
            description="等待 MQTT 实时数据累积（每 5 秒一个点）。启动 npm run simulator 后，趋势图会随推送逐点绘出。"
            compact
          />
        ) : (
          <>
            <ChartMarkerLegend markers={markers} />
            <div className="chart-pair">
              <div className="chart-block">
                <div className="chart-block__head">
                  <span className="chart-block__title">PM2.5</span>
                  <span className="chart-block__value">
                    {latest ? formatNumber(latest.pm25) : '—'}
                    <small>μg/m³</small>
                  </span>
                </div>
                <MetricTrendChart
                  data={chartSeries}
                  metric="pm25"
                  color="#56779a"
                  markers={markers}
                  syncId="history"
                />
              </div>
              <div className="chart-block">
                <div className="chart-block__head">
                  <span className="chart-block__title">CO₂</span>
                  <span className="chart-block__value">
                    {latest ? formatNumber(latest.co2) : '—'}
                    <small>ppm</small>
                  </span>
                </div>
                <MetricTrendChart
                  data={chartSeries}
                  metric="co2"
                  color="#4f8988"
                  markers={markers}
                  syncId="history"
                />
              </div>
            </div>
            <div className="chart-block chart-block--full">
              <div className="chart-block__head">
                <span className="chart-block__title">人流密度</span>
                <span className="chart-block__value">
                  {latest ? formatNumber(latest.crowdDensity, 2) : '—'}
                  <small>人/㎡</small>
                </span>
              </div>
              <MetricTrendChart
                data={chartSeries}
                metric="crowdDensity"
                color="#b37a58"
                markers={markers}
                height={180}
                syncId="history"
              />
            </div>
          </>
        )}
        <p className="chart-footnote">
          图表数据来自 MQTT 实时流（localStorage 持久化，每 5 秒一点），刷新页面不丢失。
        </p>
      </SectionCard>

      <div className="history-bottom">
        <SectionCard
          title="Action 前后对比"
          subtitle="以最近可对比的 Action 为锚点：优先本地历史，缺数据时用 Action 快照与 Recovery 样本补齐"
        >
          {loading ? (
            <SkeletonText lines={5} />
          ) : comparison ? (
            <div className="comparison">
              <div className="comparison__head">
                <div>
                  <p className="comparison__action-title">
                    {comparison.action.title}
                  </p>
                  <p className="comparison__meta">
                    {comparison.action.actionId} ·{' '}
                    {formatDateTime(comparison.action.actionAt)} ·{' '}
                    {comparison.action.operator}
                  </p>
                </div>
                <Link
                  to={`/events/${comparison.action.eventId}`}
                  className="inline-link"
                >
                  查看事件
                  <ArrowRight size={14} />
                </Link>
              </div>

              <div className="comparison-sides">
                <section className="comparison-side">
                  <header className="comparison-side__head">
                    <span className="comparison-side__label">Action 前</span>
                    <small>
                      {comparison.before
                        ? `${formatDateTimeFromMs(comparison.before.ts)} · ${COMPARISON_SOURCE_LABELS[comparison.before.source]}`
                        : '暂无可用历史数据'}
                    </small>
                  </header>
                  <ul className="comparison-side__list">
                    {comparison.rows.map((row) => {
                      const meta = METRIC_META[row.metric]
                      const digits = comparisonDigits(row.metric)
                      const value =
                        row.before === null
                          ? null
                          : Number(row.before.toFixed(digits))
                      return (
                        <li
                          className="comparison-metric"
                          key={row.metric}
                        >
                          <span className="comparison-metric__label">
                            {meta.shortLabel}
                          </span>
                          <span className="comparison-metric__value">
                            <strong>
                              {value === null
                                ? '—'
                                : formatNumber(value, digits)}
                            </strong>
                            <small>{meta.unit}</small>
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </section>

                <div
                  className="comparison-sides__arrow"
                  aria-hidden="true"
                >
                  <ArrowRight size={18} />
                </div>

                <section className="comparison-side comparison-side--after">
                  <header className="comparison-side__head">
                    <span className="comparison-side__label">Action 后</span>
                    <small>
                      {comparison.after
                        ? `${formatDateTimeFromMs(comparison.after.ts)} · ${COMPARISON_SOURCE_LABELS[comparison.after.source]}`
                        : '等待 Action 后新数据'}
                    </small>
                  </header>
                  <ul className="comparison-side__list">
                    {comparison.rows.map((row) => {
                      const meta = METRIC_META[row.metric]
                      const digits = comparisonDigits(row.metric)
                      const before =
                        row.before === null
                          ? null
                          : Number(row.before.toFixed(digits))
                      const after =
                        row.after === null
                          ? null
                          : Number(row.after.toFixed(digits))
                      const delta =
                        before === null || after === null
                          ? null
                          : Number((after - before).toFixed(digits))
                      const trend =
                        delta === null
                          ? 'none'
                          : delta < 0
                            ? 'better'
                            : delta > 0
                              ? 'worse'
                              : 'flat'
                      return (
                        <li
                          className="comparison-metric"
                          key={row.metric}
                        >
                          <span className="comparison-metric__label">
                            {meta.shortLabel}
                          </span>
                          <span className="comparison-metric__value">
                            <strong>
                              {after === null
                                ? '—'
                                : formatNumber(after, digits)}
                            </strong>
                            <small>{meta.unit}</small>
                          </span>
                          <span
                            className={cn(
                              'comparison-trend',
                              trend === 'better' &&
                                'comparison-trend--better',
                              trend === 'worse' &&
                                'comparison-trend--worse',
                            )}
                            title={
                              delta === null
                                ? '等待前后对比数据'
                                : `${formatDelta(delta, digits)} ${meta.unit}`
                            }
                          >
                            {trend === 'better' ? (
                              <TrendingDown size={13} />
                            ) : trend === 'worse' ? (
                              <TrendingUp size={13} />
                            ) : trend === 'flat' ? (
                              <Minus size={13} />
                            ) : null}
                            {delta === null
                              ? '—'
                              : formatDelta(delta, digits)}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              </div>

              {!comparison.before && !comparison.after && (
                <p className="comparison__empty-note">
                  尚未找到可用的本地历史或 Recovery 样本。启动 MQTT
                  模拟器并记录 Action 后，这里会自动显示前后数值。
                </p>
              )}

              <div className="comparison__footer">
                <span>
                  {comparison.before
                    ? `前值：${COMPARISON_SOURCE_LABELS[comparison.before.source]} ${formatDateTimeFromMs(comparison.before.ts)}`
                    : '前值：缺失'}
                  {' · '}
                  {comparison.after
                    ? `后值：${COMPARISON_SOURCE_LABELS[comparison.after.source]} ${formatDateTimeFromMs(comparison.after.ts)}`
                    : '后值：等待新数据'}
                </span>
                <Link
                  to={`/events/${comparison.action.eventId}`}
                  className={buttonClass('secondary', 'sm')}
                >
                  进入 Recovery 重新评估
                </Link>
              </div>
              <div className="inline-rule-note">
                Action 完成只代表处置动作已记录；是否恢复仍以 Action 后新数据和
                Recovery Rule 为准。前后对比取 Action 前后各一条快照，仅作趋势参考。
              </div>
            </div>
          ) : (
            <EmptyState
              title="该区域暂无 Action 前后对比"
              description="记录处置动作后，这里会展示前后数据对比。"
              compact
            />
          )}
        </SectionCard>

        <SectionCard
          title="事件与状态时间线"
          subtitle="状态变化、原因与关联 run_id"
        >
          {loading ? (
            <SkeletonText lines={6} />
          ) : timelineEntries.length > 0 ? (
            <ol className="timeline">
              {timelineEntries.map((entry) => (
                <li
                  className="timeline__item"
                  key={`${entry.eventId}-${entry.at}-${entry.status}`}
                >
                  <span
                    className={`timeline__dot timeline__dot--${entry.status.toLowerCase()}`}
                  />
                  <div className="timeline__content">
                    <div className="timeline__head">
                      <EventStatusBadge status={entry.status} />
                      <time>{formatDateTime(entry.at)}</time>
                    </div>
                    <p className="timeline__title">{entry.eventTitle}</p>
                    <p className="timeline__reason">{entry.reason}</p>
                    <div className="timeline__links">
                      <Link
                        to={`/events/${entry.eventId}`}
                        className="inline-link"
                      >
                        {entry.eventId}
                      </Link>
                      {entry.runId && (
                        <Link
                          to={`/runs/${entry.runId}`}
                          className="inline-link mono"
                        >
                          {entry.runId}
                        </Link>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState
              title="该区域暂无事件"
              description="事件由 MQTT 实时数据超过阈值时自动创建；可切换区域或等待实时数据触发。"
              compact
            />
          )}
        </SectionCard>
      </div>

      <div className="zone-color-note">
        <span
          className="zone-color-note__swatch"
          style={{ backgroundColor: ZONE_COLORS[selectedZoneId] }}
        />
        当前区域：{zone.name} · {priority ? priorityLevelText(priority.level) : '—'}优先级 ·
        数据来源 MQTT 实时流
      </div>
    </div>
  )
}
