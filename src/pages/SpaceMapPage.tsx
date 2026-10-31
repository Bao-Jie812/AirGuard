import { Link, useSearchParams } from 'react-router-dom'
import {
  ArrowRight,
  Building2,
  MapPin,
  Radar,
} from 'lucide-react'
import { PageIntro } from '../components/ui/PageIntro'
import { SectionCard } from '../components/ui/Card'
import { IsometricMap } from '../components/domain/IsometricMap'
import { Map2D } from '../components/domain/Map2D'
import {
  DeviceAlarmSlider,
  useDeviceAlarmStats,
} from '../components/domain/AlarmHistoryTable'
import { ZoneRiskChart } from '../components/domain/ZoneRiskChart'
import {
  EventStatusBadge,
  PriorityLevelBadge,
  ZoneStatusBadge,
} from '../components/ui/Badge'
import { ProgressBar } from '../components/ui/ProgressBar'
import { buttonClass } from '../components/ui/Button'
import { useAppStore } from '../state/AppStore'
import { useLiveData } from '../state/LiveDataContext'
import {
  useSelectedZone,
  useSyncZoneFromUrl,
} from '../state/SelectedZone'
import { ZONES, getZone } from '../data/zones'
import {
  METRIC_META,
  ZONE_COLORS,
} from '../domain/constants'
import {
  formatDateTime,
  formatDuration,
  formatNumber,
  cn,
} from '../domain/format'
import { metricStatus, effectiveZoneStatus } from '../domain/priority'
import {
  getActiveEvents,
  getEventsForZone,
} from '../state/selectors'

export function SpaceMapPage() {
  const { state } = useAppStore()
  const { priorities, readings } = useLiveData()
  const [, setSearchParams] = useSearchParams()
  const activeEvents = getActiveEvents(state)
  const deviceStats = useDeviceAlarmStats()
  const { selectedZoneId, setSelectedZoneId } = useSelectedZone()
  useSyncZoneFromUrl()

  const zone = getZone(selectedZoneId)
  const reading = readings[selectedZoneId]
  const priority =
    priorities.find((item) => item.zoneId === selectedZoneId) ?? priorities[0]
  const activeEvent = activeEvents.find(
    (event) => event.zoneId === selectedZoneId,
  )
  const zoneEvents = getEventsForZone(state, selectedZoneId)
  const displayEvent = activeEvent ?? zoneEvents[0]
  const topFactor = [...priority.factors]
    .sort((a, b) => b.contribution - a.contribution)
    .find((factor) => factor.contribution > 0)

  function selectZone(zoneId: string) {
    setSelectedZoneId(zoneId)
    setSearchParams({ zone: zoneId }, { replace: true })
  }

  return (
    <div className="page-stack space-map-page">
      <PageIntro
        eyebrow="Space / 轻量 3D"
        title="空间地图"
        description="用同一套业务状态呈现区域空间态势：颜色与建筑高度对应 Zone 状态档位，红色标记表示未关闭事件。建筑位置固定，数据更新只改变颜色或高度。"
        actions={
          <>
            <Link
              className={buttonClass('secondary', 'md')}
              to={`/overview?zone=${selectedZoneId}`}
            >
              区域总览
            </Link>
            <Link
              className={buttonClass('primary', 'md')}
              to={`/history?zone=${selectedZoneId}`}
            >
              查看历史趋势
              <ArrowRight size={15} />
            </Link>
          </>
        }
      />

      <div className="alarm-stats">
        <div className="alarm-stat">
          <span className="alarm-stat__label">接入区域</span>
          <strong className="alarm-stat__value">{ZONES.length}</strong>
          <span className="alarm-stat__hint">统一 zone_id · SIMULATED</span>
        </div>
        <div className="alarm-stat alarm-stat--wide">
          <div className="alarm-stat__row">
            <span className="alarm-stat__label">监测设备</span>
            <strong className="alarm-stat__value">{deviceStats.total}</strong>
          </div>
          <DeviceAlarmSlider />
        </div>
      </div>

      <div className="map-dual">
        <SectionCard
          className="map-card"
          title="校园区域态势 · 3D 示意"
          subtitle="点击建筑切换区域；状态颜色与高度档位均由统一业务状态计算。"
          action={
            <span className="map-source-tag">
              <Radar size={14} />
              MQTT 实时
            </span>
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
          <div className="map-priority-queue" aria-label="区域优先级队列">
            <span className="map-priority-queue__label">Priority 队列</span>
            {priorities.map((item) => (
              <button
                type="button"
                key={item.zoneId}
                className={cn(
                  'map-queue-item',
                  item.zoneId === selectedZoneId && 'map-queue-item--active',
                )}
                onClick={() => selectZone(item.zoneId)}
                aria-pressed={item.zoneId === selectedZoneId}
              >
                <span
                  className="map-queue-item__dot"
                  style={{ backgroundColor: ZONE_COLORS[item.zoneId] }}
                />
                <span>#{item.rank}</span>
                <strong>{getZone(item.zoneId).shortName}</strong>
                <span className="map-queue-item__score">
                  {item.score.toFixed(1)}
                </span>
              </button>
            ))}
          </div>
          <div className="map-footnote">
            <MapPin size={14} />
            地图为 2.5D 空间示意，不是真实地理坐标，也不单独计算另一套业务结论。
          </div>
        </SectionCard>

        <SectionCard
          className="map-card"
          title="校园区域态势 · 2D 热力"
          subtitle="定位点颜色与 Priority 得分对应实时状态；仅警戒/严重状态显示呼吸光晕，正常状态只保留小圆点。点击定位点切换区域，与 3D 视图完全同步。"
          action={
            <span className="map-source-tag">
              <Radar size={14} />
              MQTT 实时
            </span>
          }
        >
          <Map2D
            priorities={priorities}
            activeEvents={activeEvents}
            selectedZoneId={selectedZoneId}
            onSelect={selectZone}
          />
          <div className="map-footnote">
            <MapPin size={14} />
            底图为 CSS 示意网格，非真实地理坐标；热力状态与 3D 视图、优先级表格同源。
          </div>
        </SectionCard>
      </div>

      <div className="map-dual">
        <aside className="map-side">
          <section
            className="map-zone-panel"
            style={{
              ['--zone-color' as string]: ZONE_COLORS[selectedZoneId],
            }}
          >
            <div className="map-zone-panel__top">
              <div>
                <span className="map-zone-panel__eyebrow">
                  Priority #{priority.rank} · {zone.category}
                </span>
                <h2>{zone.name}</h2>
                <p>
                  <Building2 size={14} />
                  {zone.building}
                </p>
              </div>
              <ZoneStatusBadge
                status={effectiveZoneStatus(
                  priority.zoneStatus,
                  activeEvent ? [activeEvent] : [],
                )}
              />
            </div>

            <div className="map-score-row">
              <span className="map-score-row__value">
                {priority.score.toFixed(1)}
                <small>Priority</small>
              </span>
              <PriorityLevelBadge level={priority.level} />
              <span className="map-score-row__meta">
                {priority.anomalyDurationMinutes !== null
                  ? `异常 ${formatDuration(priority.anomalyDurationMinutes)}`
                  : '无持续异常'}
              </span>
            </div>

            <div className="map-metric-list">
              {(
                [
                  ['pm25', reading?.pm25 ?? null],
                  ['co2', reading?.co2 ?? null],
                  ['crowdDensity', reading?.crowdLevel ?? null],
                ] as const
              ).map(([metric, value]) => {
                const meta = METRIC_META[metric]
                const status =
                  value === null ? 'NORMAL' : metricStatus(metric, value)
                return (
                  <div className="map-metric" key={metric}>
                    <span className="map-metric__label">{meta.label}</span>
                    <span className="map-metric__value">
                      {value === null ? '—' : formatNumber(value, meta.digits)}
                      <small>{meta.unit}</small>
                    </span>
                    <span
                      className={`map-metric__state map-metric__state--${status.toLowerCase()}`}
                    >
                      {status === 'NORMAL'
                        ? '正常'
                        : status === 'WATCH'
                          ? '关注'
                          : status === 'ALERT'
                            ? '警戒'
                            : '严重'}
                    </span>
                  </div>
                )
              })}
            </div>

            <p className="map-zone-panel__summary">{priority.summary}</p>

            {topFactor && (
              <div className="map-factor">
                <div className="map-factor__head">
                  <span>主要贡献 · {topFactor.label}</span>
                  <strong>+{topFactor.contribution.toFixed(1)}</strong>
                </div>
                <ProgressBar
                  value={topFactor.severity}
                  tone={topFactor.severity >= 50 ? 'warning' : 'info'}
                  height={5}
                />
                <p>{topFactor.detail}</p>
              </div>
            )}

            <div className="map-event-box">
              <div className="map-event-box__head">
                <span>{activeEvent ? '未关闭事件' : '最近事件'}</span>
                {displayEvent ? (
                  <EventStatusBadge status={displayEvent.status} />
                ) : (
                  <span className="muted">无</span>
                )}
              </div>
              {displayEvent ? (
                <>
                  <p className="map-event-box__title">{displayEvent.title}</p>
                  <p className="map-event-box__meta">
                    {displayEvent.eventId} ·{' '}
                    {formatDateTime(displayEvent.openedAt)}
                  </p>
                  <Link
                    to={`/events/${displayEvent.eventId}`}
                    className="inline-link"
                  >
                    进入事件与处置
                    <ArrowRight size={14} />
                  </Link>
                </>
              ) : (
                <p className="map-event-box__meta">
                  该区域暂无事件。空间状态仍随 Current 与 Priority 更新。
                </p>
              )}
            </div>

            <div className="map-zone-panel__links">
              <Link
                className={buttonClass('secondary', 'sm')}
                to={`/overview?zone=${selectedZoneId}`}
              >
                总览
              </Link>
              <Link
                className={buttonClass('secondary', 'sm')}
                to={`/history?zone=${selectedZoneId}`}
              >
                历史
              </Link>
              <Link
                className={buttonClass('secondary', 'sm')}
                to={`/evidence?zone=${selectedZoneId}`}
              >
                证据
              </Link>
            </div>
            <p className="map-zone-panel__timestamp">
              {reading
                ? `快照 ${formatDateTime(reading.time)} · 数据来源 MQTT 实时流`
                : '等待 MQTT 实时数据'}
            </p>
          </section>

          <div className="map-legend-card">
            <h3>图例说明</h3>
            <div className="map-legend-row">
              <span className="map-legend-swatch map-legend-swatch--normal" />
              <span>正常</span>
              <span className="map-legend-swatch map-legend-swatch--watch" />
              <span>关注</span>
              <span className="map-legend-swatch map-legend-swatch--alert" />
              <span>警戒</span>
              <span className="map-legend-event" />
              <span>未关闭事件</span>
            </div>
            <p>
              建筑高度按状态档位分级（正常 / 关注 / 警戒 / 严重）；同一 zone
              在总览、地图、事件与 H5 中使用同一业务状态。
            </p>
          </div>
        </aside>

        <SectionCard
          title="今日区域风险统计"
          subtitle="按区域统计高危 / 关注告警次数"
          className="map-risk-card"
          action={<span className="card-meta">近 24 小时</span>}
        >
          <ZoneRiskChart events={state.events} />
        </SectionCard>
      </div>
    </div>
  )
}
