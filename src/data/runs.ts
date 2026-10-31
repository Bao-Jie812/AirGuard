import {
  APP_VERSION,
  CONFIG_VERSION,
  DATA_VERSION,
  EVENT_STATUS_LABELS,
  LLM_EXPLAIN_VERSION,
  METRIC_META,
  ML_MODEL_VERSION,
  RULE_VERSION,
} from '../domain/constants'
import { evaluateRecovery } from '../domain/recovery'
import { formatDateTime, formatNumber } from '../domain/format'
import {
  DORM_RECOVERED_EVENT_ID,
  DORM_RECOVERY_RUN_ID,
  DORM_VENT_ACTION_ID,
  EVENT_CREATION_RUN_ID,
  HANDLING_EVENT_ID,
  PRIORITY_RUN_ID,
  RECOVERED_EVENT_ID,
  RECOVERY_RUN_ID,
  SEED_ACTIONS,
  SEED_EVENTS,
  SEED_RECOVERY_SAMPLES,
  SEED_TIMES,
  VENT_ACTION_ID,
} from './events'
import type {
  ActionRecord,
  EnvironmentEvent,
  EventStatus,
  FinalOutput,
  RecoveryEvaluation,
  RunEvidenceSnapshot,
  RunStatus,
  RunTrace,
  RunVersionSet,
  ToolCallRecord,
  ZoneDefinition,
} from './types'
import { getZone } from './zones'

export const DEMO_VERSIONS: RunVersionSet = {
  app: APP_VERSION,
  config: CONFIG_VERSION,
  data: DATA_VERSION,
  rule: RULE_VERSION,
  model: ML_MODEL_VERSION,
}

/**
 * 种子运行快照：
 * 1. 10:15 Priority 分析 → 第二食堂 Priority #1
 * 2. 10:40 Recovery 重新评估 → 第二食堂已恢复
 * 3. 14:20 Event 创建 → 教学区 A 待处置事件（外部天气接口超时，PARTIAL）
 * 4. 16:00 Recovery 重新评估 → 东区宿舍已恢复
 * 全部通过 SEEDED_DEMO 标记为历史快照，不会在打开页面时重新计算。
 */
export const SEED_RUNS: RunTrace[] = buildSeedRuns()

function eventStatusLabel(status: EventStatus): string {
  return `${status} · ${EVENT_STATUS_LABELS[status]}`
}

/**
 * Run 证据快照直接来自评估使用的真实后验样本（MQTT 实时数据），
 * 不再引用任何静态演示证据。
 */
function samplesToEvidence(
  evaluation: RecoveryEvaluation,
): RunEvidenceSnapshot[] {
  return evaluation.sampleEvaluations.map(({ sample }) => ({
    evidenceId: sample.sampleId,
    kind: 'CURRENT',
    source: sample.source,
    status: sample.quality,
    title: 'Action 后验样本（MQTT 实时）',
    summary: `PM2.5 ${formatNumber(sample.pm25)} μg/m³ · CO₂ ${formatNumber(sample.co2)} ppm · 人流 ${formatNumber(sample.crowdDensity, 2)} 人/㎡`,
    observedAt: sample.timestamp,
    limitation: sample.note,
  }))
}

export interface CreateRecoveryRunInput {
  runId: string
  event: EnvironmentEvent
  action: ActionRecord
  evaluation: RecoveryEvaluation
  createdAt: string
}

export function createRecoveryRun({
  runId,
  event,
  action,
  evaluation,
  createdAt,
}: CreateRecoveryRunInput): RunTrace {
  const zone: ZoneDefinition = getZone(event.zoneId)
  const evidence = samplesToEvidence(evaluation)
  const latestEvaluation =
    evaluation.sampleEvaluations[
      evaluation.sampleEvaluations.length - 1
    ] ?? null
  const latestChecks = latestEvaluation?.checks ?? []
  const outcomeLabel = eventStatusLabel(evaluation.outcomeStatus)

  const ruleDetails = [
    { label: 'Action 时间', value: formatDateTime(action.actionAt) },
    {
      label: '有效后验样本',
      value: `${evaluation.validPostActionSampleCount} 组`,
    },
    {
      label: '连续合规样本',
      value: `${evaluation.trailingPassCount} / ${evaluation.requiredConsecutive}`,
      pass: evaluation.outcomeStatus === 'RECOVERED',
    },
    ...latestChecks.map((check) => ({
      label: `最新 ${check.label}`,
      value: `${formatNumber(check.actual ?? 0, METRIC_META[check.key].digits)} ${check.unit} / ≤ ${formatNumber(check.threshold, METRIC_META[check.key].digits)} ${check.unit}`,
      pass: check.pass,
    })),
  ]

  const explainText = `本次 Recovery 重新评估使用 Action ${action.actionId}（${formatDateTime(action.actionAt)}）之后的 ${evaluation.validPostActionSampleCount} 组 MQTT 实时后验数据。${evaluation.reason} 本解释只复述已保存输入与规则结果，不修改 Priority、Event 或 Recovery 状态。Action Completed ≠ Recovery。`

  const finalTone: FinalOutput['tone'] =
    evaluation.outcomeStatus === 'RECOVERED'
      ? 'success'
      : evaluation.outcomeStatus === 'STILL_HANDLING'
        ? 'warning'
        : evaluation.outcomeStatus === 'INSUFFICIENT_EVIDENCE'
          ? 'info'
          : 'neutral'

  const overallStatus: RunStatus = 'SUCCESS'

  const toolCalls: ToolCallRecord[] = [
    {
      callId: `${runId}-SAMPLES`,
      tool: 'live.samples.query',
      mode: 'LOCAL',
      params: `zone=${zone.zoneId}; source=mqtt-live; after=${action.actionId}`,
      status: 'SUCCESS',
      startedAt: createdAt,
      durationMs: 2,
      outputSummary: `读取 Action 后 MQTT 实时后验样本 ${evaluation.validPostActionSampleCount} 组。`,
    },
    {
      callId: `${runId}-RULE`,
      tool: 'rule.recovery',
      mode: 'LOCAL',
      params: `event=${event.eventId}; action=${action.actionId}; rule=${RULE_VERSION}`,
      status: 'SUCCESS',
      startedAt: createdAt,
      durationMs: 1,
      outputSummary: `${evaluation.validPostActionSampleCount} 组有效样本；连续合规 ${evaluation.trailingPassCount}/${evaluation.requiredConsecutive}；${evaluation.outcomeStatus}。`,
    },
    {
      callId: `${runId}-EXPLAIN`,
      tool: 'explain.compose',
      mode: 'LOCAL',
      params: 'mode=template; readOnly=true',
      status: 'SUCCESS',
      startedAt: createdAt,
      durationMs: 1,
      outputSummary: '使用模板生成解释，未调用真实 LLM；不写回业务状态。',
    },
  ]

  return {
    runId,
    kind: 'RECOVERY_EVALUATION',
    scenarioId: event.scenarioId,
    zoneId: event.zoneId,
    eventId: event.eventId,
    actionId: action.actionId,
    createdAt,
    executionMode: 'LOCAL_DEMO',
    status: overallStatus,
    trigger: '用户点击“执行 Recovery 重新评估”',
    durationMs: 5,
    versions: DEMO_VERSIONS,
    inputSnapshot: {
      title: `${zone.shortName} · Action 后 Recovery 重新评估`,
      description:
        '本运行在浏览器本地执行规则计算；输入为 MQTT 实时后验样本与已保存业务状态。',
      fields: [
        { label: '事件', value: event.eventId },
        {
          label: '评估前事件状态',
          value: eventStatusLabel(event.status),
        },
        {
          label: 'Action',
          value: `${action.actionId} · ${formatDateTime(action.actionAt)}`,
        },
        {
          label: '后验有效样本',
          value: `${evaluation.validPostActionSampleCount} 组`,
        },
        {
          label: '恢复阈值',
          value: `PM2.5 ≤ ${event.thresholds.pm25} · CO₂ ≤ ${event.thresholds.co2} · 人流密度 ≤ ${event.thresholds.crowdDensity} · 连续 ${event.thresholds.consecutiveSamples} 组`,
        },
        { label: '评估时间', value: formatDateTime(createdAt) },
        { label: '样本来源', value: 'MQTT 实时流', source: 'SIMULATED' },
      ],
    },
    evidence,
    toolCalls,
    ruleResult: {
      ruleId: evaluation.ruleId,
      version: evaluation.ruleVersion,
      outcome: outcomeLabel,
      passed:
        evaluation.outcomeStatus === 'RECOVERED'
          ? true
          : evaluation.outcomeStatus === 'INSUFFICIENT_EVIDENCE'
            ? null
            : false,
      reason: evaluation.reason,
      details: ruleDetails,
    },
    mlResult: null,
    llmExplain: {
      generatedAt: createdAt,
      modelVersion: LLM_EXPLAIN_VERSION,
      mode: '模板生成（未调用真实 LLM）',
      text: explainText,
      basedOn: [
        ...evidence.map((item) => item.evidenceId),
        `Action ${action.actionId} 后 ${evaluation.validPostActionSampleCount} 组 RecoverySample`,
      ],
      simulated: true,
    },
    failures: [],
    finalOutput: {
      label: outcomeLabel,
      tone: finalTone,
      summary: evaluation.reason,
      limitations: evaluation.limitations,
    },
  }
}

export function getLatestSampleForEvent(
  allSamples: RecoveryEvaluation['sampleEvaluations'],
): RecoveryEvaluation['sampleEvaluations'][number] | null {
  return allSamples[allSamples.length - 1] ?? null
}

export function latestEvidenceStatusText(status: EventStatus): string {
  return EVENT_STATUS_LABELS[status]
}

/* ------------------------------------------------------------------ */
/* 种子 Run Trace 构建                                                 */
/* ------------------------------------------------------------------ */

function requireSeedEntry<T>(
  value: T | undefined,
  label: string,
): T {
  if (!value) throw new Error(`种子数据缺少：${label}`)
  return value
}

function buildPrioritySeedRun(): RunTrace {
  const recoveredEvent = requireSeedEntry(
    SEED_EVENTS.find((event) => event.eventId === RECOVERED_EVENT_ID),
    '第二食堂已恢复事件',
  )
  const evidenceIds = [
    `${PRIORITY_RUN_ID}-EVD-CO2`,
    `${PRIORITY_RUN_ID}-EVD-RULE`,
  ]

  return {
    runId: PRIORITY_RUN_ID,
    kind: 'PRIORITY_ANALYSIS',
    scenarioId: null,
    zoneId: 'zone-w',
    eventId: recoveredEvent.eventId,
    createdAt: SEED_TIMES.cafeteriaOpenedAt,
    executionMode: 'SEEDED_DEMO',
    status: 'SUCCESS',
    trigger: 'MQTT 实时数据触发 Priority 周期评估',
    durationMs: 6,
    versions: DEMO_VERSIONS,
    inputSnapshot: {
      title: '第二食堂 · 区域 Priority 评估',
      description:
        '按 PM2.5、CO₂、人流密度、1 小时变化与持续异常时间计算三个区域的优先级。',
      fields: [
        { label: '评估区域', value: '教学区 A / 第二食堂 / 东区宿舍' },
        { label: '主要指标', value: 'CO₂ 1180 ppm（警戒阈值 1000 ppm）' },
        { label: 'PM2.5', value: '42 μg/m³（关注阈值 35 μg/m³）' },
        { label: '人流密度', value: '0.38 人/㎡' },
        {
          label: '数据来源',
          value: 'MQTT 实时流',
          source: 'SIMULATED',
        },
        {
          label: '评估时间',
          value: formatDateTime(SEED_TIMES.cafeteriaOpenedAt),
        },
      ],
    },
    evidence: [
      {
        evidenceId: evidenceIds[0],
        kind: 'CURRENT',
        source: 'SIMULATED',
        status: 'VALID',
        title: '第二食堂 CO₂ 实时快照',
        summary:
          'CO₂ 1180 ppm，高于 1000 ppm 警戒阈值；PM2.5 42 μg/m³，人流密度 0.38 人/㎡。',
        observedAt: SEED_TIMES.cafeteriaOpenedAt,
      },
      {
        evidenceId: evidenceIds[1],
        kind: 'RULE',
        source: 'SIMULATED',
        status: 'VALID',
        title: 'Priority 规则计算',
        summary:
          'CO₂ 与 PM2.5 贡献高于其余区域，综合得分 42.8，判定第二食堂为 Priority #1。',
        observedAt: SEED_TIMES.cafeteriaOpenedAt,
      },
    ],
    toolCalls: [
      {
        callId: `${PRIORITY_RUN_ID}-SERIES`,
        tool: 'live.series.query',
        mode: 'LOCAL',
        params: 'zones=zone-n,zone-s,zone-w; window=1h; source=mqtt-live',
        status: 'SUCCESS',
        startedAt: SEED_TIMES.cafeteriaOpenedAt,
        durationMs: 3,
        outputSummary:
          '读取三个区域最近 1 小时的 MQTT 序列，用于趋势与持续异常计算。',
      },
      {
        callId: `${PRIORITY_RUN_ID}-RULE`,
        tool: 'priority.assess',
        mode: 'LOCAL',
        params: 'rule=priority-rule/1.0.0',
        status: 'SUCCESS',
        startedAt: SEED_TIMES.cafeteriaOpenedAt,
        durationMs: 2,
        outputSummary: '第二食堂综合得分 42.8，排名第 1。',
      },
    ],
    ruleResult: {
      ruleId: 'PRIORITY-CORE',
      version: 'priority-rule/1.0.0',
      outcome: '第二食堂 · Priority #1',
      passed: true,
      reason:
        'CO₂ 1180 ppm 高于 1000 ppm 警戒阈值，PM2.5 42 μg/m³ 高于 35 μg/m³ 关注阈值；第二食堂综合得分高于其余区域。',
      details: [
        {
          label: 'CO₂',
          value: '1180 ppm / > 1000 ppm 警戒阈值',
          pass: false,
        },
        {
          label: 'PM2.5',
          value: '42 μg/m³ / > 35 μg/m³ 关注阈值',
          pass: false,
        },
        {
          label: '人流密度',
          value: '0.38 人/㎡ / < 0.50 人/㎡ 关注阈值',
          pass: true,
        },
        {
          label: '综合 Priority',
          value: '42.8 分 · 排名 #1',
        },
      ],
    },
    mlResult: null,
    llmExplain: {
      generatedAt: SEED_TIMES.cafeteriaOpenedAt,
      modelVersion: LLM_EXPLAIN_VERSION,
      mode: '模板生成（未调用真实 LLM）',
      text: '第二食堂 CO₂ 1180 ppm，高于 1000 ppm 警戒阈值；结合 PM2.5 与人流密度，Priority 综合得分 42.8，排名第 1。本解释只复述已保存的输入与规则结果。',
      basedOn: [...evidenceIds, 'priority-rule/1.0.0'],
      simulated: true,
    },
    failures: [],
    finalOutput: {
      label: '第二食堂判定为 Priority #1',
      tone: 'warning',
      summary:
        'CO₂ 1180 ppm 高于警戒阈值，综合 Priority 42.8，排名第 1。',
      limitations: [],
    },
  }
}

interface RecoverySeedRunConfig {
  eventId: string
  actionId: string
  runId: string
  recoveredAt: string
  eventLabel: string
}

function buildRecoverySeedRun({
  eventId,
  actionId,
  runId,
  recoveredAt,
  eventLabel,
}: RecoverySeedRunConfig): RunTrace {
  const recoveredEvent = requireSeedEntry(
    SEED_EVENTS.find((event) => event.eventId === eventId),
    eventLabel,
  )
  const action = requireSeedEntry(
    SEED_ACTIONS.find((item) => item.actionId === actionId),
    `${eventLabel} Action`,
  )
  // 评估前的状态：HANDLING（RECOVERED 是评估结果，不是输入）
  const preRecoveryEvent: EnvironmentEvent = {
    ...recoveredEvent,
    status: 'HANDLING',
    closedAt: undefined,
    statusHistory: recoveredEvent.statusHistory.filter(
      (entry) => entry.status !== 'RECOVERED',
    ),
  }
  const evaluation = evaluateRecovery(
    preRecoveryEvent,
    SEED_ACTIONS,
    SEED_RECOVERY_SAMPLES,
    recoveredAt,
  )
  const run = createRecoveryRun({
    runId,
    event: preRecoveryEvent,
    action,
    evaluation,
    createdAt: recoveredAt,
  })

  return {
    ...run,
    executionMode: 'SEEDED_DEMO',
    trigger: '事件恢复时间点自动执行 Recovery 规则评估（种子快照）',
    finalOutput: {
      ...run.finalOutput,
      label: `${getZone(recoveredEvent.zoneId).shortName}已恢复`,
      tone: 'success',
      summary: `Action ${action.actionId}（${action.title}）后连续 ${evaluation.trailingPassCount} 组有效样本满足恢复阈值，事件由 HANDLING 转为 RECOVERED。`,
      limitations: [],
    },
  }
}

function buildEventCreationSeedRun(): RunTrace {
  const handlingEvent = requireSeedEntry(
    SEED_EVENTS.find((event) => event.eventId === HANDLING_EVENT_ID),
    '教学区 A 处理中事件',
  )
  const weatherEvidenceId = `${EVENT_CREATION_RUN_ID}-EVD-WEATHER`

  return {
    runId: EVENT_CREATION_RUN_ID,
    kind: 'EVENT_CREATION',
    scenarioId: null,
    zoneId: 'zone-s',
    eventId: handlingEvent.eventId,
    createdAt: SEED_TIMES.crowdOpenedAt,
    executionMode: 'SEEDED_DEMO',
    status: 'PARTIAL',
    trigger: 'MQTT 实时人流密度超过 ALERT 阈值，触发事件创建',
    durationMs: 8012,
    versions: DEMO_VERSIONS,
    inputSnapshot: {
      title: '教学区 A · 人流密度异常事件创建',
      description:
        'MQTT 读数触发事件创建；同时尝试获取外部天气作为辅助解释证据。',
      fields: [
        {
          label: '触发指标',
          value: '人流密度 0.86 人/㎡ ≥ 0.80 人/㎡ 警戒阈值',
        },
        { label: '事件状态', value: 'OPEN · 待处置' },
        { label: '数据来源', value: 'MQTT 实时流', source: 'SIMULATED' },
        {
          label: '外部天气',
          value: '高德天气接口 TIMEOUT（8000 ms）',
          source: 'PUBLIC',
        },
        {
          label: '创建时间',
          value: formatDateTime(SEED_TIMES.crowdOpenedAt),
        },
      ],
    },
    evidence: [
      {
        evidenceId: `${EVENT_CREATION_RUN_ID}-EVD-CROWD`,
        kind: 'CURRENT',
        source: 'SIMULATED',
        status: 'VALID',
        title: '教学区 A 人流密度实时快照',
        summary:
          '人流密度 0.86 人/㎡，高于 0.80 人/㎡ 警戒阈值；PM2.5 32 μg/m³，CO₂ 820 ppm。',
        observedAt: SEED_TIMES.crowdOpenedAt,
      },
      {
        evidenceId: weatherEvidenceId,
        kind: 'EXTERNAL',
        source: 'PUBLIC',
        status: 'TIMEOUT',
        title: '南京天气辅助证据',
        summary: '外部天气接口请求超时，未返回有效天气数据。',
        observedAt: SEED_TIMES.crowdOpenedAt,
        limitation: '天气仅作为辅助解释证据，缺失不改变事件事实。',
      },
    ],
    toolCalls: [
      {
        callId: `${EVENT_CREATION_RUN_ID}-MQTT`,
        tool: 'mqtt.ingest',
        mode: 'LOCAL',
        params: 'topic=airguard/sensor/zone-s',
        status: 'SUCCESS',
        startedAt: SEED_TIMES.crowdOpenedAt,
        durationMs: 2,
        outputSummary: '读取人流密度 0.86 人/㎡，状态 ALERT。',
      },
      {
        callId: `${EVENT_CREATION_RUN_ID}-CREATE`,
        tool: 'event.create',
        mode: 'LOCAL',
        params: `zone=zone-s; metric=crowdDensity; threshold=0.80`,
        status: 'SUCCESS',
        startedAt: SEED_TIMES.crowdOpenedAt,
        durationMs: 1,
        outputSummary: `创建事件 ${handlingEvent.eventId}，状态 OPEN。`,
      },
      {
        callId: `${EVENT_CREATION_RUN_ID}-WEATHER`,
        tool: 'weather.fetch',
        mode: 'SIMULATED',
        params: 'city=南京; endpoint=amap.weather',
        status: 'TIMEOUT',
        startedAt: SEED_TIMES.crowdOpenedAt,
        durationMs: 8000,
        outputSummary: '外部天气接口 8 秒超时；标记 TIMEOUT，不阻断事件创建。',
      },
    ],
    ruleResult: {
      ruleId: 'EVENT-THRESHOLD',
      version: 'event-rule/1.0.0',
      outcome: 'OPEN · 待处置',
      passed: true,
      reason:
        '人流密度 0.86 人/㎡ ≥ 0.80 人/㎡ ALERT 阈值，满足事件创建条件；外部天气证据超时不影响事件事实。',
      details: [
        {
          label: '人流密度',
          value: '0.86 人/㎡ / ≥ 0.80 人/㎡ 警戒阈值',
          pass: true,
        },
        {
          label: '事件创建',
          value: '已创建 OPEN 事件',
          pass: true,
        },
        {
          label: '外部天气',
          value: 'TIMEOUT · 未获取',
          pass: null,
        },
      ],
    },
    mlResult: null,
    llmExplain: {
      generatedAt: SEED_TIMES.crowdOpenedAt,
      modelVersion: LLM_EXPLAIN_VERSION,
      mode: '模板生成（未调用真实 LLM）',
      text: '教学区 A 人流密度达到 0.86 人/㎡，超过 0.80 人/㎡ ALERT 阈值，因此创建待处置事件。外部天气接口超时，仅降低解释完整度，不改变事件已发生这一业务事实。',
      basedOn: [
        `${EVENT_CREATION_RUN_ID}-EVD-CROWD`,
        weatherEvidenceId,
        'event-rule/1.0.0',
      ],
      simulated: true,
    },
    failures: [
      {
        code: 'EXTERNAL_WEATHER_TIMEOUT',
        location: 'weather.fetch · amap.weather',
        affectedEvidence: weatherEvidenceId,
        message: '外部天气接口请求超时（8000 ms），未返回有效数据。',
        impact: '外部天气证据缺失，仅影响解释完整度。',
        degradation: '运行状态标记为 PARTIAL；事件创建成功，业务事实不受影响。',
        unaffectedFacts: [
          'MQTT 实时读数有效',
          '人流密度 0.86 人/㎡ 超过 0.80 人/㎡ ALERT 阈值',
          `事件 ${handlingEvent.eventId} 已创建`,
        ],
      },
    ],
    finalOutput: {
      label: '教学区 A 创建待处置事件',
      tone: 'warning',
      summary:
        '人流密度 0.86 人/㎡ 达到 ALERT 阈值，事件已创建；外部天气接口超时，运行状态为 PARTIAL，业务事实不受影响。',
      limitations: ['外部天气证据超时，仅影响解释完整度。'],
    },
  }
}

function buildSeedRuns(): RunTrace[] {
  return [
    buildPrioritySeedRun(),
    buildRecoverySeedRun({
      eventId: RECOVERED_EVENT_ID,
      actionId: VENT_ACTION_ID,
      runId: RECOVERY_RUN_ID,
      recoveredAt: SEED_TIMES.recoveredAt,
      eventLabel: '第二食堂已恢复事件',
    }),
    buildRecoverySeedRun({
      eventId: DORM_RECOVERED_EVENT_ID,
      actionId: DORM_VENT_ACTION_ID,
      runId: DORM_RECOVERY_RUN_ID,
      recoveredAt: SEED_TIMES.dormRecoveredAt,
      eventLabel: '东区宿舍已恢复事件',
    }),
    buildEventCreationSeedRun(),
  ]
}
