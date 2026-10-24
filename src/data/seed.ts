import { SCHEMA_VERSION } from '../domain/constants'
import { SEED_ACTIONS, SEED_EVENTS, SEED_RECOVERY_SAMPLES } from './events'
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
