import { Link, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  Camera,
  ClipboardList,
  MapPin,
  ShieldAlert,
} from 'lucide-react'
import { ZONES, getZone } from '../data/zones'
import type { MetricKey } from '../data/types'
import {
  countEvidenceStatuses,
  getEvidenceExceptions,
  getEvidenceStatusCounts,
  type EvidenceLiveContext,
} from '../data/evidence'
import {
  EVIDENCE_KIND_LABELS,
  EVIDENCE_STATUS_LABELS,
  METRIC_BAR_LIMITS,
  METRIC_META,
  ZONE_COLORS,
} from '../domain/constants'
import { formatDateTime, formatDuration, formatNumber } from '../domain/format'
import { effectiveZoneStatus, priorityLevelText } from '../domain/priority'
import { useAppStore } from '../state/AppStore'
import { useLiveData } from '../state/LiveDataContext'
import {
  useSelectedZone,
  useSyncZoneFromUrl,
} from '../state/SelectedZone'
import {
  getActiveEventForZone,
  getActiveEvents,
  getEventsForZone,
} from '../state/selectors'
import { PageIntro } from '../components/ui/PageIntro'
import { SectionCard } from '../components/ui/Card'
import { StatTile } from '../components/ui/StatTile'
import { buttonClass } from '../components/ui/Button'
import {
  EventStatusBadge,
  PriorityLevelBadge,
  RunStatusBadge,
  ZoneStatusBadge,
} from '../components/ui/Badge'
import { ProgressBar } from '../components/ui/ProgressBar'
import {
  PriorityMobileList,
  PriorityTable,
} from '../components/domain/PriorityTable'
import { EventSummaryRow } from '../components/domain/EventSummaryRow'
import { IsometricMap } from '../components/domain/IsometricMap'
import { AnalysisPanel } from '../components/domain/AnalysisPanel'
import { LiveBoard } from '../components/domain/LiveBoard'
import { DemoControlBar } from '../components/domain/DemoControlPanel'
import { EmptyState } from '../components/ui/EmptyState'

/** 实时环境指标监控：进度条渲染顺序；阈值配置见 domain/constants METRIC_BAR_LIMITS */
const METRIC_BAR_ORDER: MetricKey[] = ['co2', 'pm25', 'crowdDensity']

export function OverviewPage() {
  const { state, activeEventCount } = useAppStore()
  const { readings, histories, priorities, topZoneId } = useLiveData()
  const [, setSearchParams] = useSearchParams()
  const { selectedZoneId, setSelectedZoneId } = useSelectedZone()
  useSyncZoneFromUrl()

  // 当前首要关注 = 实时 Priority #1，与下方优先级表格使用同一份排序结果
  const leadingPriority = priorities[0]
  const leadingZoneId =
    topZoneId ?? leadingPriority?.zoneId ?? ZONES[0].zoneId
  // factors 为空 = 该区域尚未收到 MQTT 数据，避免展示“教学区 0.0”这类假结论
  const hasPriorityData = (leadingPriority?.factors.length ?? 0) > 0
  const selectedZone = getZone(selectedZoneId)
  const selectedPriority =
    priorities.find((priority) => priority.zoneId === selectedZoneId) ??
    priorities[0]
  // MQTT 实时读数与历史（无静态回退；未收到推送则视为无数据）
  const liveReading = readings[selectedZoneId]
  const hasLive = (liveReading?.receivedAt ?? 0) > 0
  const ctxByZone = Object.fromEntries(
    ZONES.map((zone) => [
      zone.zoneId,
      {
        reading: readings[zone.zoneId],
        history: histories[zone.zoneId] ?? [],
        priority: priorities.find((item) => item.zoneId === zone.zoneId),
      } satisfies EvidenceLiveContext,
    ]),
  )
  const activeEvents = getActiveEvents(state)
  const activeFocusEvent = getActiveEventForZone(state, selectedZoneId)
  const focusEvent =
    activeFocusEvent ?? getEventsForZone(state, selectedZoneId)[0]
  // 关注卡状态与地图同源：未关闭事件覆盖瞬时指标档位（只升不降）
  const focusStatus = effectiveZoneStatus(
    selectedPriority.zoneStatus,
    activeFocusEvent ? [activeFocusEvent] : [],
  )
  // 没有未关闭事件时，卡片下方展示的只是历史事件（通常是 RECOVERED）
  const focusEventIsHistorical = !activeFocusEvent && Boolean(focusEvent)
  const exceptions = getEvidenceExceptions(ctxByZone)
  const evidenceCounts = countEvidenceStatuses(ctxByZone)
  // 各区域有效证据数：驱动「证据健康」卡内迷你柱状图
  const zoneValidCounts = ZONES.map((zone) => ({
    zone,
    valid: getEvidenceStatusCounts(
      zone.zoneId,
      ctxByZone[zone.zoneId] ?? { history: [] },
    ).VALID,
  }))
  const zoneValidMax = Math.max(1, ...zoneValidCounts.map((item) => item.valid))
  const exceptionsForZone = exceptions.filter(
    (item) => item.zoneId === selectedZoneId,
  )
  const sortedRuns = [...state.runs].sort((a, b) => {
    const diff =
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    return diff !== 0 ? diff : b.runId.localeCompare(a.runId)
  })
  const topFactors = [...selectedPriority.factors]
    .sort((a, b) => b.contribution - a.contribution)
    .filter((factor) => factor.contribution > 0)
    .slice(0, 3)

  function selectZone(zoneId: string) {
    setSelectedZoneId(zoneId)
    setSearchParams({ zone: zoneId }, { replace: true })
  }

  return (
    <div className="page-stack overview-page">
      <PageIntro
        eyebrow="Overview / 当前态势"
        title="区域总览"
        description={
          <>
            先看哪里，为什么，然后带着可回查的证据进入处置流程。
            <span
              key={leadingZoneId}
              className="page-intro__inline-note fade-swap"
            >
              {hasPriorityData
                ? `当前监控重点：${getZone(leadingZoneId).shortName}`
                : '等待 MQTT 实时数据接入…'}
            </span>
          </>
        }
        actions={
          <>
            <DemoControlBar />
            <Link
              className={buttonClass('subtle', 'md')}
              to={`/evidence?zone=${selectedZoneId}`}
              title="上传现场照片，生成「人工观察」证据卡"
            >
              <Camera size={16} />
              拍照留档
            </Link>
          </>
        }
      />

      <div className="overview-hero">
        <SectionCard
          title="校园空间态势"
          subtitle="屋顶色条与建筑高度档位对应区域状态；点击建筑切换下方关注卡。"
          className="overview-hero__map"
          flush
          action={
            <Link to="/map" className="inline-link">
              打开空间地图
              <ArrowRight size={14} />
            </Link>
          }
        >
          <div className="map-canvas">
            <IsometricMap
              priorities={priorities}
              activeEvents={activeEvents}
              selectedZoneId={selectedZoneId}
              onSelect={selectZone}
            />
          </div>
        </SectionCard>
        <AnalysisPanel />
      </div>

      <div className="stat-grid">
        <StatTile
          label="接入区域"
          value={ZONES.length}
          unit="个"
          hint="统一 zone_id · MQTT 实时接入"
          icon={<MapPin size={17} />}
        />
        <StatTile
          key={leadingZoneId}
          className="fade-swap"
          label="当前首要关注"
          value={hasPriorityData ? getZone(leadingZoneId).shortName : '—'}
          hint={
            hasPriorityData
              ? `Priority #${leadingPriority?.rank ?? 1} · ${leadingPriority?.score.toFixed(1) ?? '—'} 分 · ${leadingPriority ? priorityLevelText(leadingPriority.level) : '—'} · 与优先级表格同步`
              : 'MQTT 已连接后自动计算并排序'
          }
          tone="warning"
          icon={<ShieldAlert size={17} />}
        />
        <StatTile
          label="未关闭事件"
          value={activeEventCount}
          unit="个"
          hint={`共 ${state.events.length} 个事件 · ${state.events.length - activeEventCount} 个已恢复`}
          tone="danger"
          icon={<ClipboardList size={17} />}
        />
        <StatTile
          label="证据链路异常"
          value={exceptions.length}
          unit="项"
          hint="技术失败单独展示，不改写业务事实"
          tone="warning"
          icon={<AlertTriangle size={17} />}
        />
      </div>

      <div className="overview-grid">
        <div className="overview-main">
          <SectionCard
            title="区域关注优先级"
            subtitle="相同输入下排序可解释；点击区域切换右侧关注卡。"
            className="overview-priority"
            flush
            action={
              <span className="card-meta">
                {hasLive && liveReading
                  ? `MQTT 实时 · ${formatDateTime(liveReading.time)}`
                  : '等待 MQTT 实时数据'}
              </span>
            }
          >
            <PriorityTable
              selectedZoneId={selectedZoneId}
              onSelect={selectZone}
            />
            <PriorityMobileList
              selectedZoneId={selectedZoneId}
              onSelect={selectZone}
            />
          </SectionCard>

          <SectionCard
            title="证据健康"
            subtitle="来源、有效性与故障独立呈现"
            className="evidence-health-card"
            action={
              <Link to="/evidence" className="inline-link">
                全部证据
                <ArrowRight size={14} />
              </Link>
            }
          >
            <div className="evidence-health-summary">
              <div>
                <span>有效</span>
                <strong>{evidenceCounts.VALID}</strong>
              </div>
              <div>
                <span>异常 / 失效</span>
                <strong>{exceptions.length}</strong>
              </div>
              <div>
                <span>链路类别</span>
                <strong>
                  {new Set(exceptions.map((item) => item.kind)).size}
                </strong>
              </div>
            </div>
            <div className="evidence-exception-list">
              {exceptions.slice(0, 5).map((item) => (
                <Link
                  key={item.evidenceId}
                  to={`/evidence?zone=${item.zoneId}`}
                  className="evidence-exception"
                >
                  <span className="evidence-exception__zone">
                    {getZone(item.zoneId).shortName}
                  </span>
                  <span className="evidence-exception__kind">
                    {EVIDENCE_KIND_LABELS[item.kind]} ·{' '}
                    {EVIDENCE_STATUS_LABELS[item.status]}
                  </span>
                  <span className="evidence-exception__code">
                    {item.status}
                  </span>
                </Link>
              ))}
            </div>
            {/* 各区域有效证据迷你柱状图：吃掉卡片富余高度，与右侧关注卡底边对齐 */}
            <div className="evidence-zone-bars">
              <div className="evidence-zone-bars__head">
                <span>各区域有效证据</span>
                <span className="muted">实时统计 · 随 MQTT 更新</span>
              </div>
              <div className="evidence-zone-bars__chart">
                {zoneValidCounts.map(({ zone, valid }) => (
                  <div className="evidence-zone-bar" key={zone.zoneId}>
                    <strong>{valid}</strong>
                    <div className="evidence-zone-bar__track">
                      <i
                        style={{
                          height: `${Math.max(4, (valid / zoneValidMax) * 100)}%`,
                          background: ZONE_COLORS[zone.zoneId],
                        }}
                      />
                    </div>
                    <span>{zone.shortName}</span>
                  </div>
                ))}
              </div>
            </div>
            <p className="evidence-health-note">
              外部接口或工具失败 ≠ 业务未恢复。系统保留失败原因和仍有效的业务事实。
            </p>
          </SectionCard>
        </div>

        <div className="overview-side">
          <section
            className={`focus-card focus-card--${focusStatus.toLowerCase()}`}
            style={{
              ['--zone-color' as string]: ZONE_COLORS[selectedZoneId],
            }}
          >
            <div className="focus-card__top">
              <div>
                <span className="focus-card__eyebrow">
                  Priority #{selectedPriority.rank}
                  <span>·</span>
                  {selectedZone.category}
                </span>
                <h2>{selectedZone.name}</h2>
                <p className="focus-card__building">
                  <MapPin size={14} />
                  {selectedZone.building}
                </p>
              </div>
              <ZoneStatusBadge status={focusStatus} />
            </div>

            <div className="focus-score">
              <div className="focus-score__value">
                <strong>{selectedPriority.score.toFixed(1)}</strong>
                <span>Priority 得分</span>
              </div>
              <PriorityLevelBadge level={selectedPriority.level} />
            </div>
            <p className="focus-card__summary">{selectedPriority.summary}</p>

            <div className="focus-factors">
              <div className="focus-factors__head">
                <span>为什么是这个排名</span>
                <span className="muted">
                  {selectedPriority.anomalyDurationMinutes !== null
                    ? `持续异常 ${formatDuration(selectedPriority.anomalyDurationMinutes)}`
                    : '无持续异常'}
                </span>
              </div>
              {topFactors.length === 0 ? (
                <p className="focus-factors__empty">
                  当前各项指标均低于关注阈值，未产生风险加分。
                </p>
              ) : (
                topFactors.map((factor) => (
                  <div className="factor-row" key={factor.key}>
                    <div className="factor-row__top">
                      <span>{factor.label}</span>
                      <strong>+{factor.contribution.toFixed(1)}</strong>
                    </div>
                    <ProgressBar
                      value={factor.severity}
                      tone={
                        factor.severity >= 70
                          ? 'danger'
                          : factor.severity >= 40
                            ? 'warning'
                            : 'info'
                      }
                      label={factor.label}
                      height={5}
                    />
                    <p>{factor.detail}</p>
                  </div>
                ))
              )}
            </div>

            {/* 实时环境指标监控：MQTT 实时驱动，绿→黄→红渐变进度条；超警戒线整条变橙/红 */}
            <div className="focus-metrics">
              <div className="focus-metrics__head">
                <span>实时环境指标监控</span>
                <span className="muted">
                  {hasLive && liveReading
                    ? `MQTT 实时 · ${formatDateTime(liveReading.time)}`
                    : '等待 MQTT 数据'}
                </span>
              </div>
              {METRIC_BAR_ORDER.map((key) => {
                const meta = METRIC_META[key]
                const limits = METRIC_BAR_LIMITS[key]
                const value =
                  key === 'crowdDensity'
                    ? (liveReading?.crowdLevel ?? null)
                    : (liveReading?.[key] ?? null)
                const ratio = value === null ? 0 : Math.min(1, value / limits.max)
                const level =
                  value === null
                    ? 'none'
                    : value > limits.red
                      ? 'red'
                      : value > limits.orange
                        ? 'orange'
                        : 'normal'
                return (
                  <div
                    className={`metric-bar metric-bar--${level}`}
                    key={key}
                  >
                    <div className="metric-bar__head">
                      <span>{meta.label}</span>
                      <strong>
                        {value === null
                          ? '—'
                          : `${formatNumber(value, meta.digits)} ${meta.unit}`}
                      </strong>
                    </div>
                    <div
                      className="metric-bar__track metric-bar__track--gauge"
                      role="progressbar"
                      aria-label={meta.label}
                      aria-valuemin={0}
                      aria-valuemax={limits.max}
                      aria-valuenow={value ?? 0}
                    >
                      {/* 渐变层满宽铺设，clip-path 按数值裁切：渐变刻度相对满刻度锚定，不会随填充量压缩 */}
                      <div
                        className="metric-bar__fill metric-bar__fill--gauge"
                        style={{ ['--p' as string]: `${ratio * 100}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="focus-event">
              <div className="focus-event__head">
                <span>
                  {activeFocusEvent
                    ? '未关闭事件'
                    : focusEventIsHistorical
                      ? '最近历史事件'
                      : '关联事件'}
                </span>
                {focusEvent ? (
                  <EventStatusBadge status={focusEvent.status} />
                ) : (
                  <span className="muted">无事件</span>
                )}
              </div>
              {focusEvent ? (
                <>
                  <p className="focus-event__title">{focusEvent.title}</p>
                  <p className="focus-event__meta">
                    {focusEvent.eventId} · 开启于{' '}
                    {formatDateTime(focusEvent.openedAt)}
                  </p>
                  {focusEventIsHistorical && (
                    <p className="focus-event__meta muted">
                      该事件已恢复，仅作历史记录；当前状态以上方实时指标为准。
                    </p>
                  )}
                  <Link
                    to={`/events/${focusEvent.eventId}`}
                    className="inline-link"
                  >
                    查看处置与恢复评估
                    <ArrowRight size={14} />
                  </Link>
                </>
              ) : (
                <p className="focus-event__meta">
                  该区域当前没有关联事件，仍可通过 History 与 Evidence
                  继续观察。
                </p>
              )}
            </div>

            {exceptionsForZone.length > 0 && (
              <div className="focus-card__limitation">
                <AlertTriangle size={14} />
                <span>
                  {exceptionsForZone
                    .map(
                      (item) =>
                        `${EVIDENCE_KIND_LABELS[item.kind]} ${EVIDENCE_STATUS_LABELS[item.status]}`,
                    )
                    .join(' · ')}
                  ，仅影响证据完整度，不改变已确认业务事实。
                </span>
              </div>
            )}

            <div className="focus-card__actions">
              <Link
                className={buttonClass('secondary', 'sm')}
                to={`/history?zone=${selectedZoneId}`}
              >
                历史趋势
              </Link>
              <Link
                className={buttonClass('secondary', 'sm')}
                to={`/evidence?zone=${selectedZoneId}`}
              >
                查看证据
              </Link>
              <Link
                className={buttonClass('secondary', 'sm')}
                to="/map"
              >
                空间位置
              </Link>
            </div>
          </section>
        </div>
      </div>

      <LiveBoard zoneId={selectedZoneId} />

      <div className="overview-bottom">
        <SectionCard
          title="事件动态"
          subtitle={`${activeEvents.length} 个事件尚未关闭`}
          action={
            <Link to="/events" className="inline-link">
              查看全部
              <ArrowRight size={14} />
            </Link>
          }
          flush
        >
          <div className="event-list">
            {[...state.events]
              .sort((a, b) => {
                const activeDiff =
                  Number(a.status === 'RECOVERED') -
                  Number(b.status === 'RECOVERED')
                if (activeDiff !== 0) return activeDiff
                return (
                  new Date(b.openedAt).getTime() -
                  new Date(a.openedAt).getTime()
                )
              })
              .map((event) => (
                <EventSummaryRow key={event.eventId} event={event} />
              ))}
          </div>
        </SectionCard>

        <SectionCard
          title="最近运行"
          subtitle="已保存 Run Trace 可回查，不会因打开页面重新计算"
          action={
            <Link to="/runs" className="inline-link">
              全部运行
              <ArrowRight size={14} />
            </Link>
          }
          flush
        >
          <div className="run-mini-list">
            {sortedRuns.slice(0, 4).map((run) => (
              <Link
                to={`/runs/${run.runId}`}
                className="run-mini"
                key={run.runId}
              >
                <span className="run-mini__top">
                  <span className="mono">{run.runId}</span>
                  <RunStatusBadge status={run.status} />
                </span>
                <span className="run-mini__result">
                  {run.finalOutput.label}
                </span>
                <span className="run-mini__meta">
                  {getZone(run.zoneId).shortName} ·{' '}
                  {formatDateTime(run.createdAt)} ·{' '}
                  {run.executionMode === 'SEEDED_DEMO'
                    ? '种子快照'
                    : '本地执行'}
                </span>
              </Link>
            ))}
            {sortedRuns.length === 0 && (
              <EmptyState
                title="暂无运行记录"
                description="执行一次 Recovery 重新评估后会生成新的 run_id。"
                compact
              />
            )}
          </div>
        </SectionCard>
      </div>
    </div>
  )
}
