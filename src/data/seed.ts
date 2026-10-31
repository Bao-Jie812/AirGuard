import { SCHEMA_VERSION } from '../domain/constants'
import {
  SEED_ACTIONS,
  SEED_EVENTS,
  SEED_RECOVERY_SAMPLES,
} from './events'
import { SEED_RUNS } from './runs'
import type { StoreState } from './types'

export function getSeedState(): StoreState {
  return {
    schemaVersion: SCHEMA_VERSION,
    events: structuredClone(SEED_EVENTS),
    actions: structuredClone(SEED_ACTIONS),
    recoverySamples: structuredClone(SEED_RECOVERY_SAMPLES),
    runs: structuredClone(SEED_RUNS),
  }
}

/**
 * 启动与一键清空共用的干净初始态：固定保留 2 条已恢复示例事件，
 * 以及它们关联的 Action / 后验样本 / Run Trace，不带任何未关闭事件。
 */
export function getCleanState(): StoreState {
  const events = SEED_EVENTS.filter(
    (event) => event.status === 'RECOVERED',
  ).slice(0, 2)
  const eventIds = new Set(events.map((event) => event.eventId))
  return {
    schemaVersion: SCHEMA_VERSION,
    events: structuredClone(events),
    actions: structuredClone(
      SEED_ACTIONS.filter((action) => eventIds.has(action.eventId)),
    ),
    recoverySamples: structuredClone(
      SEED_RECOVERY_SAMPLES.filter((sample) => eventIds.has(sample.eventId)),
    ),
    runs: structuredClone(
      SEED_RUNS.filter(
        (run) => run.eventId !== undefined && eventIds.has(run.eventId),
      ),
    ),
  }
}
