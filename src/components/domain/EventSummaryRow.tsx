import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import type { EnvironmentEvent } from '../../data/types'
import {
  SCENARIO_LABELS,
} from '../../domain/constants'
import { formatDateTime } from '../../domain/format'
import { useAppStore } from '../../state/AppStore'
import { getActionsForEvent, getLatestRunForEvent } from '../../state/selectors'
import { getZone } from '../../data/zones'
import { EventStatusBadge, ScenarioBadge, SeverityBadge } from '../ui/Badge'

export function EventSummaryRow({ event }: { event: EnvironmentEvent }) {
  const { state } = useAppStore()
  const zone = getZone(event.zoneId)
  const actions = getActionsForEvent(state, event.eventId)
  const latestRun = getLatestRunForEvent(state, event.eventId)

  return (
    <Link className="event-row" to={`/events/${event.eventId}`}>
      <span
        className={`event-row__severity event-row__severity--${event.severity.toLowerCase()}`}
        aria-hidden="true"
      />
      <span className="event-row__main">
        <span className="event-row__title-line">
          <strong>{event.title}</strong>
          <SeverityBadge severity={event.severity} />
          {event.scenarioId && (
            <ScenarioBadge
              scenarioId={event.scenarioId}
              label={SCENARIO_LABELS[event.scenarioId]}
            />
          )}
        </span>
        <span className="event-row__meta">
          {zone.shortName} · {formatDateTime(event.openedAt)} 开启 ·{' '}
          {actions.length} 条 Action
          {latestRun ? ` · ${latestRun.runId}` : ' · 尚无运行记录'}
        </span>
      </span>
      <span className="event-row__status">
        <EventStatusBadge status={event.status} />
      </span>
      <ChevronRight size={16} className="event-row__chevron" />
    </Link>
  )
}
