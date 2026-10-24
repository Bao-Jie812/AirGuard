import { isActiveEventStatus } from '../data/events'
import type {
  ActionRecord,
  EnvironmentEvent,
  EventStatus,
  PriorityAssessment,
  RecoverySample,
  RunTrace,
  StoreState,
} from '../data/types'
import { getZone, ZONES } from '../data/zones'

export function getEventById(
  state: StoreState,
  eventId: string | undefined,
): EnvironmentEvent | undefined {
  if (!eventId) return undefined
  return state.events.find((event) => event.eventId === eventId)
}

export function getActionsForEvent(
  state: StoreState,
  eventId: string,
): ActionRecord[] {
  return state.actions
    .filter((action) => action.eventId === eventId)
    .sort(
      (a, b) =>
        new Date(b.actionAt).getTime() - new Date(a.actionAt).getTime(),
    )
}

export function getSamplesForEvent(
  state: StoreState,
  eventId: string,
): RecoverySample[] {
  return state.recoverySamples
    .filter((sample) => sample.eventId === eventId)
    .sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    )
}

export function getRunsForEvent(
  state: StoreState,
  eventId: string,
): RunTrace[] {
  return state.runs
    .filter((run) => run.eventId === eventId)
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
}

export function getRunsForZone(
  state: StoreState,
  zoneId: string,
): RunTrace[] {
  return state.runs
    .filter((run) => run.zoneId === zoneId)
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
}

export function getLatestRunForEvent(
  state: StoreState,
  eventId: string,
): RunTrace | undefined {
  return getRunsForEvent(state, eventId)[0]
}

export function getActiveEvents(state: StoreState): EnvironmentEvent[] {
  return state.events
    .filter((event) => isActiveEventStatus(event.status))
    .sort(
      (a, b) =>
        new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime(),
    )
}

export function getActiveEventForZone(
  state: StoreState,
  zoneId: string,
): EnvironmentEvent | undefined {
  return getActiveEvents(state).find((event) => event.zoneId === zoneId)
}

export function getEventsForZone(
  state: StoreState,
  zoneId: string,
): EnvironmentEvent[] {
  return state.events
    .filter((event) => event.zoneId === zoneId)
    .sort(
      (a, b) =>
        new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime(),
    )
}

export function getEventZoneName(event: EnvironmentEvent): string {
  return getZone(event.zoneId).name
}

export function countEventsByStatus(
  state: StoreState,
  status: EventStatus,
): number {
  return state.events.filter((event) => event.status === status).length
}

export function getPriorityForZoneFromSnapshot(
  priorities: PriorityAssessment[],
  zoneId: string,
): PriorityAssessment | undefined {
  return priorities.find((priority) => priority.zoneId === zoneId)
}

export const ALL_ZONES = ZONES
