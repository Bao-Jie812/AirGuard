import { METRIC_META } from '../domain/constants'
import { seedDateStamp, seedIsoAt } from './seedTime'
import type {
  ActionRecord,
  EnvironmentEvent,
  EventStatus,
  RecoverySample,
} from './types'

export const ACTIVE_EVENT_STATUSES: EventStatus[] = [
  'OPEN',
  'HANDLING',
  'STILL_HANDLING',
  'INSUFFICIENT_EVIDENCE',
]

export function isActiveEventStatus(status: EventStatus): boolean {
  return ACTIVE_EVENT_STATUSES.includes(status)
}

/* ------------------------------------------------------------------ */
/* 业务 ID 与时间基准：事件、Action、样本、Run 全部共用这一组关联键      */
/* ------------------------------------------------------------------ */

const STAMP = seedDateStamp()

export const RECOVERED_EVENT_ID = `EVT-${STAMP}-001`
export const HANDLING_EVENT_ID = `EVT-${STAMP}-002`
export const VENT_ACTION_ID = `ACT-${STAMP}-001`
export const WINDOW_ACTION_ID = `ACT-${STAMP}-002`

export const PRIORITY_RUN_ID = `RUN-${STAMP}-001`
export const RECOVERY_RUN_ID = `RUN-${STAMP}-002`
export const EVENT_CREATION_RUN_ID = `RUN-${STAMP}-003`

/**
 * 种子时间线（同一天）：
 * 10:15  第二食堂 CO₂ 超限，事件创建 + Priority 分析
 * 10:20  开启排风（Action）
 * 10:40  Recovery 判定恢复
 * 14:20  教学区 A 人流密度突增，事件创建
 * 14:25  开窗通风（Action）
 * 14:30  后验样本仍高于阈值，保持处置中
 */
export const SEED_TIMES = {
  cafeteriaOpenedAt: seedIsoAt(10, 15),
  ventilationAt: seedIsoAt(10, 20),
  sample1At: seedIsoAt(10, 25),
  sample2At: seedIsoAt(10, 30),
  sample3At: seedIsoAt(10, 35),
  recoveredAt: seedIsoAt(10, 40),
  crowdOpenedAt: seedIsoAt(14, 20),
  crowdActionAt: seedIsoAt(14, 25),
  crowdSampleAt: seedIsoAt(14, 30),
} as const

const RECOVERY_THRESHOLDS = {
  pm25: METRIC_META.pm25.alert,
  co2: METRIC_META.co2.alert,
  crowdDensity: METRIC_META.crowdDensity.alert,
  consecutiveSamples: 2,
} as const

/* ------------------------------------------------------------------ */
/* 种子事件                                                            */
/* ------------------------------------------------------------------ */

export const SEED_EVENTS: EnvironmentEvent[] = [
  {
    eventId: RECOVERED_EVENT_ID,
    zoneId: 'zone-w',
    title: '第二食堂 CO₂ 持续偏高',
    description:
      'MQTT 实时监测显示第二食堂就餐区 CO₂ 持续高于 1000 ppm 警戒阈值。现场开启东侧排风并保持门窗通风后，浓度逐步回落至恢复阈值以下，事件已关闭。',
    severity: 'HIGH',
    status: 'RECOVERED',
    openedAt: SEED_TIMES.cafeteriaOpenedAt,
    closedAt: SEED_TIMES.recoveredAt,
    scenarioId: null,
    primaryMetric: 'co2',
    thresholds: { ...RECOVERY_THRESHOLDS },
    limitations: [],
    statusHistory: [
      {
        at: SEED_TIMES.cafeteriaOpenedAt,
        status: 'OPEN',
        reason:
          'MQTT 实时数据触发：第二食堂 CO₂ 达警戒水平，自动创建事件。',
      },
      {
        at: SEED_TIMES.ventilationAt,
        status: 'HANDLING',
        reason: `记录 Action ${VENT_ACTION_ID}：开启东侧排风系统。事件进入处置中。`,
      },
      {
        at: SEED_TIMES.recoveredAt,
        status: 'RECOVERED',
        reason:
          'Action 后连续 3 组有效样本满足恢复阈值，事件判定为已恢复。',
        runId: RECOVERY_RUN_ID,
      },
    ],
  },
  {
    eventId: HANDLING_EVENT_ID,
    zoneId: 'zone-s',
    title: '教学区 A 人流密度突增',
    description:
      '课间换场期间教学区 A 人流密度升至 0.86 人/㎡，超过 0.80 人/㎡ 警戒阈值。现场已启动侧门分流与人员引导，等待后续 MQTT 数据验证恢复。',
    severity: 'HIGH',
    status: 'HANDLING',
    openedAt: SEED_TIMES.crowdOpenedAt,
    scenarioId: null,
    primaryMetric: 'crowdDensity',
    thresholds: { ...RECOVERY_THRESHOLDS },
    limitations: [],
    statusHistory: [
      {
        at: SEED_TIMES.crowdOpenedAt,
        status: 'OPEN',
        reason:
          'MQTT 实时数据触发：教学区 A 人流密度达警戒水平，自动创建事件。',
      },
      {
        at: SEED_TIMES.crowdActionAt,
        status: 'HANDLING',
        reason: `记录 Action ${WINDOW_ACTION_ID}：开窗通风换气。事件进入处置中。`,
      },
    ],
  },
]

/* ------------------------------------------------------------------ */
/* 种子 Action                                                         */
/* ------------------------------------------------------------------ */

export const SEED_ACTIONS: ActionRecord[] = [
  {
    actionId: VENT_ACTION_ID,
    eventId: RECOVERED_EVENT_ID,
    zoneId: 'zone-w',
    type: 'VENTILATION',
    title: '开启东侧排风系统',
    note: '开启东侧排风机并保持门窗通风，降低就餐区 CO₂ 浓度。',
    operator: '现场值班组',
    actionAt: SEED_TIMES.ventilationAt,
    createdAt: SEED_TIMES.ventilationAt,
    executionMode: 'SEEDED_DEMO',
    baseline: {
      ts: new Date(SEED_TIMES.ventilationAt).getTime() - 5_000,
      pm25: 42,
      co2: 1180,
      crowdDensity: 0.46,
      source: 'SEED_DEMO',
    },
  },
  {
    actionId: WINDOW_ACTION_ID,
    eventId: HANDLING_EVENT_ID,
    zoneId: 'zone-s',
    type: 'WINDOW_OPEN',
    title: '开窗通风换气',
    note: '打开教室两侧窗户加强自然通风，持续观察人流密度与 CO₂。',
    operator: '现场值班组',
    actionAt: SEED_TIMES.crowdActionAt,
    createdAt: SEED_TIMES.crowdActionAt,
    executionMode: 'SEEDED_DEMO',
    baseline: {
      ts: new Date(SEED_TIMES.crowdActionAt).getTime() - 5_000,
      pm25: 33,
      co2: 810,
      crowdDensity: 0.86,
      source: 'SEED_DEMO',
    },
  },
]

/* ------------------------------------------------------------------ */
/* 种子 Recovery 样本                                                  */
/* ------------------------------------------------------------------ */

export const SEED_RECOVERY_SAMPLES: RecoverySample[] = [
  {
    sampleId: `SMP-${RECOVERED_EVENT_ID}-1025`,
    eventId: RECOVERED_EVENT_ID,
    actionId: VENT_ACTION_ID,
    timestamp: SEED_TIMES.sample1At,
    pm25: 38,
    co2: 1060,
    crowdDensity: 0.36,
    source: 'SIMULATED',
    quality: 'VALID',
    note: '排风开启后首组数据，CO₂ 仍高于恢复阈值。',
  },
  {
    sampleId: `SMP-${RECOVERED_EVENT_ID}-1030`,
    eventId: RECOVERED_EVENT_ID,
    actionId: VENT_ACTION_ID,
    timestamp: SEED_TIMES.sample2At,
    pm25: 34,
    co2: 980,
    crowdDensity: 0.34,
    source: 'SIMULATED',
    quality: 'VALID',
    note: 'CO₂ 回落至 1000 ppm 以下。',
  },
  {
    sampleId: `SMP-${RECOVERED_EVENT_ID}-1035`,
    eventId: RECOVERED_EVENT_ID,
    actionId: VENT_ACTION_ID,
    timestamp: SEED_TIMES.sample3At,
    pm25: 31,
    co2: 930,
    crowdDensity: 0.33,
    source: 'SIMULATED',
    quality: 'VALID',
    note: '连续第二组合规样本。',
  },
  {
    sampleId: `SMP-${RECOVERED_EVENT_ID}-1040`,
    eventId: RECOVERED_EVENT_ID,
    actionId: VENT_ACTION_ID,
    timestamp: SEED_TIMES.recoveredAt,
    pm25: 29,
    co2: 900,
    crowdDensity: 0.32,
    source: 'SIMULATED',
    quality: 'VALID',
    note: '连续第三组合规样本，满足恢复规则。',
  },
  {
    sampleId: `SMP-${HANDLING_EVENT_ID}-1430`,
    eventId: HANDLING_EVENT_ID,
    actionId: WINDOW_ACTION_ID,
    timestamp: SEED_TIMES.crowdSampleAt,
    pm25: 32,
    co2: 820,
    crowdDensity: 0.84,
    source: 'SIMULATED',
    quality: 'VALID',
    note: '开窗后首组数据，人流密度仍高于 0.80 人/㎡。',
  },
]
