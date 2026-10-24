import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  ClipboardList,
  Search,
  ShieldCheck,
} from 'lucide-react'
import { PageIntro } from '../components/ui/PageIntro'
import { SectionCard } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { buttonClass } from '../components/ui/Button'
import {
  EventStatusBadge,
  ScenarioBadge,
  SeverityBadge,
} from '../components/ui/Badge'
import { useAppStore } from '../state/AppStore'
import { useLiveData } from '../state/LiveDataContext'
import { getZone, ZONES } from '../data/zones'
import {
  formatDateTime,
  formatRelativeToNow,
} from '../domain/format'
import { SCENARIO_LABELS } from '../domain/constants'
import { isActiveEventStatus } from '../data/events'
import {
  getActionsForEvent,
  getLatestRunForEvent,
} from '../state/selectors'

type StatusFilter = 'ALL' | 'ACTIVE' | 'RECOVERED'

export function EventsPage() {
  const { state } = useAppStore()
  const { mqttStatus, readings } = useLiveData()
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')
  const [zoneFilter, setZoneFilter] = useState('ALL')
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    return [...state.events]
      .filter((event) => {
        if (statusFilter === 'ACTIVE' && !isActiveEventStatus(event.status)) {
          return false
        }
        if (statusFilter === 'RECOVERED' && event.status !== 'RECOVERED') {
          return false
        }
        if (zoneFilter !== 'ALL' && event.zoneId !== zoneFilter) return false
        const normalized = query.trim().toLowerCase()
        if (normalized) {
          const haystack =
            `${event.eventId} ${event.title} ${event.description} ${getZone(event.zoneId).name}`.toLowerCase()
          if (!haystack.includes(normalized)) return false
        }
        return true
      })
      .sort((a, b) => {
        const activeDiff =
          Number(a.status === 'RECOVERED') - Number(b.status === 'RECOVERED')
        if (activeDiff !== 0) return activeDiff
        return (
          new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime()
        )
      })
  }, [state.events, statusFilter, zoneFilter, query])

  const activeCount = state.events.filter((event) =>
    isActiveEventStatus(event.status),
  ).length
  const recoveredCount = state.events.length - activeCount
  const actionCount = state.actions.length
  const runCount = state.runs.filter((run) => run.eventId).length

  return (
    <div className="page-stack events-page">
      <PageIntro
        eyebrow="Event / Action / Re-evaluate"
        title="事件与处置"
        description="记录现场 Action，用 Action 之后的新业务数据重新评估 Recovery。Action 完成不等于恢复。"
        actions={
          <>
            <Link
              className={buttonClass('secondary', 'md')}
              to="/runs"
            >
              运行记录
            </Link>
            <Link
              className={buttonClass('primary', 'md')}
              to="/overview"
            >
              返回区域总览
              <ArrowRight size={15} />
            </Link>
          </>
        }
      />

      <div className="event-overview-strip">
        <div>
          <span className="event-overview-strip__icon">
            <ClipboardList size={17} />
          </span>
          <strong>{activeCount}</strong>
          <span>未关闭事件</span>
        </div>
        <div>
          <span className="status-dot status-dot--green" />
          <strong>{recoveredCount}</strong>
          <span>已恢复事件</span>
        </div>
        <div>
          <span className="status-dot status-dot--blue" />
          <strong>{actionCount}</strong>
          <span>Action 记录</span>
        </div>
        <div>
          <span className="status-dot status-dot--violet" />
          <strong>{runCount}</strong>
          <span>事件关联运行</span>
        </div>
        <div>
          <span
            className={`status-dot ${
              mqttStatus === 'online'
                ? 'status-dot--green'
                : 'status-dot--amber'
            }`}
          />
          <strong>
            {mqttStatus === 'online'
              ? 'MQTT 在线'
              : mqttStatus === 'connecting'
                ? 'MQTT 连接中'
                : mqttStatus === 'reconnecting'
                  ? 'MQTT 重连中'
                  : 'MQTT 离线'}
          </strong>
          <span>处置动作多端同步</span>
        </div>
      </div>

      <SectionCard
        title="全部事件"
        subtitle="按处置状态查看事件；详情页可追加 Action 并重新评估。"
        action={<span className="card-meta">{filtered.length} 个结果</span>}
      >
        <div className="list-toolbar">
          <div className="segmented" role="group" aria-label="事件状态筛选">
            {(
              [
                { key: 'ALL', label: '全部' },
                { key: 'ACTIVE', label: '未关闭' },
                { key: 'RECOVERED', label: '已恢复' },
              ] as const
            ).map((option) => (
              <button
                type="button"
                key={option.key}
                className={
                  statusFilter === option.key
                    ? 'segmented__item segmented__item--active'
                    : 'segmented__item'
                }
                onClick={() => setStatusFilter(option.key)}
                aria-pressed={statusFilter === option.key}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="toolbar-spacer" />
          <label className="select-field">
            <span>区域</span>
            <select
              value={zoneFilter}
              onChange={(event) => setZoneFilter(event.target.value)}
            >
              <option value="ALL">全部区域</option>
              {ZONES.map((zone) => (
                <option value={zone.zoneId} key={zone.zoneId}>
                  {zone.shortName}
                </option>
              ))}
            </select>
          </label>
          <label className="search-field">
            <Search size={15} />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索事件 ID / 标题 / 区域"
              aria-label="搜索事件"
            />
          </label>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            title="没有匹配的事件"
            description="调整状态、区域或搜索词后再试。事件由 MQTT 实时数据超过阈值时自动创建。"
            action={
              <button
                type="button"
                className={buttonClass('secondary', 'sm')}
                onClick={() => {
                  setStatusFilter('ALL')
                  setZoneFilter('ALL')
                  setQuery('')
                }}
              >
                清除筛选
              </button>
            }
          />
        ) : (
          <div className="event-card-grid">
            {filtered.map((event) => {
              const zone = getZone(event.zoneId)
              const actions = getActionsForEvent(state, event.eventId)
              const latestRun = getLatestRunForEvent(state, event.eventId)
              const latestStatus =
                event.statusHistory[event.statusHistory.length - 1]
              return (
                <article className="event-card" key={event.eventId}>
                  <div className="event-card__top">
                    <span
                      className={`event-card__severity event-card__severity--${event.severity.toLowerCase()}`}
                    />
                    <span className="event-card__badges">
                      <SeverityBadge severity={event.severity} />
                      <EventStatusBadge status={event.status} />
                      {event.scenarioId && (
                        <ScenarioBadge
                          scenarioId={event.scenarioId}
                          label={SCENARIO_LABELS[event.scenarioId]}
                        />
                      )}
                    </span>
                    {event.status === 'RECOVERED' && (
                      <span className="event-card__recovered-icon">
                        <ShieldCheck size={18} />
                      </span>
                    )}
                  </div>
                  <Link
                    className="event-card__title"
                    to={`/events/${event.eventId}`}
                  >
                    {event.title}
                  </Link>
                  <p className="event-card__description">{event.description}</p>
                  <div className="event-card__meta-grid">
                    <div>
                      <span>区域</span>
                      <strong>{zone.name}</strong>
                    </div>
                    <div>
                      <span>开启时间</span>
                      <strong>{formatDateTime(event.openedAt)}</strong>
                    </div>
                    <div>
                      <span>Action</span>
                      <strong>{actions.length} 条</strong>
                    </div>
                    <div>
                      <span>最近更新</span>
                      <strong>{formatRelativeToNow(latestStatus.at)}</strong>
                    </div>
                  </div>
                  <div className="event-card__latest">
                    <span className="event-card__latest-label">最新状态依据</span>
                    <p>{latestStatus.reason}</p>
                  </div>
                  {(readings[event.zoneId]?.receivedAt ?? 0) > 0 && (
                    <div className="event-card__live">
                      <span>MQTT 实时</span>
                      <strong>
                        PM2.5 {readings[event.zoneId].pm25} · CO₂{' '}
                        {readings[event.zoneId].co2} · 人流{' '}
                        {readings[event.zoneId].crowdLevel.toFixed(2)}
                      </strong>
                    </div>
                  )}
                  <div className="event-card__footer">
                    <span className="event-card__ids">
                      <span className="mono">{event.eventId}</span>
                      {latestRun && (
                        <Link
                          to={`/runs/${latestRun.runId}`}
                          className="mono inline-link"
                        >
                          {latestRun.runId}
                        </Link>
                      )}
                    </span>
                    <Link
                      to={`/events/${event.eventId}`}
                      className={buttonClass('secondary', 'sm')}
                    >
                      查看处置详情
                      <ArrowRight size={14} />
                    </Link>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </SectionCard>
    </div>
  )
}
