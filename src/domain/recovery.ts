import type {
  ActionRecord,
  EnvironmentEvent,
  MetricKey,
  RecoveryCheck,
  RecoveryEvaluation,
  RecoverySample,
  RecoveryThresholds,
  SampleEvaluation,
} from '../data/types'
import { METRIC_META, RULE_ID, RULE_VERSION } from './constants'
import { formatNumber } from './format'

const CHECK_METRICS: MetricKey[] = ['pm25', 'co2', 'crowdDensity']

function buildChecks(
  sample: RecoverySample,
  thresholds: RecoveryThresholds,
): RecoveryCheck[] {
  return CHECK_METRICS.map((metric) => {
    const meta = METRIC_META[metric]
    const actual = sample[metric]
    const threshold = thresholds[metric]
    return {
      key: metric,
      label: meta.shortLabel,
      threshold,
      unit: meta.unit,
      actual,
      pass:
        sample.quality === 'VALID' ? actual <= threshold : null,
    }
  })
}

function evaluateSample(
  sample: RecoverySample,
  thresholds: RecoveryThresholds,
): SampleEvaluation {
  const checks = buildChecks(sample, thresholds)
  const pass =
    sample.quality === 'VALID' && checks.every((check) => check.pass === true)
  return { sample, checks, pass }
}

function failedCheckText(checks: RecoveryCheck[]): string {
  const failed = checks.filter((check) => check.pass === false)
  if (failed.length === 0) return ''
  return failed
    .map(
      (check) =>
        `${check.label} ${formatNumber(check.actual ?? 0, METRIC_META[check.key].digits)} ${check.unit} 高于阈值 ${formatNumber(check.threshold, METRIC_META[check.key].digits)} ${check.unit}`,
    )
    .join('；')
}

function latestSampleText(evaluation: SampleEvaluation): string {
  const sample = evaluation.sample
  return [
    `PM2.5 ${formatNumber(sample.pm25, 0)} μg/m³`,
    `CO₂ ${formatNumber(sample.co2, 0)} ppm`,
    `人流密度 ${formatNumber(sample.crowdDensity, 2)} 人/㎡`,
  ].join('，')
}

export function getLatestActionForEvent(
  eventId: string,
  actions: ActionRecord[],
): ActionRecord | null {
  const eventActions = actions
    .filter((action) => action.eventId === eventId)
    .sort(
      (a, b) =>
        new Date(b.actionAt).getTime() - new Date(a.actionAt).getTime(),
    )
  return eventActions[0] ?? null
}

export function getRecoverySamplesForEvent(
  eventId: string,
  samples: RecoverySample[],
): RecoverySample[] {
  return samples
    .filter((sample) => sample.eventId === eventId)
    .sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    )
}

export function evaluateRecovery(
  event: EnvironmentEvent,
  actions: ActionRecord[],
  allSamples: RecoverySample[],
  evaluatedAt: string,
): RecoveryEvaluation {
  const action = getLatestActionForEvent(event.eventId, actions)
  const limitations = [...event.limitations]
  const empty: RecoveryEvaluation = {
    ruleId: RULE_ID,
    ruleVersion: RULE_VERSION,
    evaluatedAt,
    action,
    actionAt: action?.actionAt ?? null,
    validPostActionSampleCount: 0,
    requiredConsecutive: event.thresholds.consecutiveSamples,
    trailingPassCount: 0,
    sampleEvaluations: [],
    outcomeStatus: event.status,
    recoveredAt: null,
    reason: '',
    limitations,
    coreEvidenceSufficient: false,
  }

  if (!action) {
    return {
      ...empty,
      outcomeStatus: 'OPEN',
      reason: '尚未记录 Action，无法执行 Recovery 重新评估。',
    }
  }

  const samplesAfterAction = allSamples
    .filter(
      (sample) =>
        sample.eventId === event.eventId &&
        sample.actionId === action.actionId &&
        new Date(sample.timestamp).getTime() >
          new Date(action.actionAt).getTime(),
    )
    .sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    )

  const sampleEvaluations = samplesAfterAction.map((sample) =>
    evaluateSample(sample, event.thresholds),
  )
  const validEvaluations = sampleEvaluations.filter(
    (evaluation) => evaluation.sample.quality === 'VALID',
  )
  const validCount = validEvaluations.length

  if (validCount === 0) {
    const invalidCount = samplesAfterAction.length
    return {
      ...empty,
      sampleEvaluations,
      validPostActionSampleCount: 0,
      coreEvidenceSufficient: false,
      outcomeStatus: 'INSUFFICIENT_EVIDENCE',
      reason:
        invalidCount > 0
          ? `Action 后存在 ${invalidCount} 组后验数据，但均非 VALID，无法完成 Recovery 判定。`
          : `Action 后暂无新的业务数据；无法确认是否恢复。Action 完成不等于恢复。`,
      limitations: [
        ...limitations,
        'Recovery 仅使用 action_at 之后的新业务数据；本次记录不会将事件直接置为 RECOVERED。',
      ],
    }
  }

  const latest = validEvaluations[validEvaluations.length - 1]
  let trailingPassCount = 0
  for (let i = validEvaluations.length - 1; i >= 0; i -= 1) {
    if (validEvaluations[i].pass) trailingPassCount += 1
    else break
  }

  const required = event.thresholds.consecutiveSamples
  const passed = trailingPassCount >= required
  const failureText = failedCheckText(latest.checks)
  const latestText = latestSampleText(latest)

  if (passed) {
    return {
      ...empty,
      sampleEvaluations,
      validPostActionSampleCount: validCount,
      trailingPassCount,
      recoveredAt: latest.sample.timestamp,
      outcomeStatus: 'RECOVERED',
      coreEvidenceSufficient: true,
      reason: `Action 后共有 ${validCount} 组有效后验数据；最近 ${required} 组连续满足恢复阈值。最新一组为 ${latestText}。据此进入 RECOVERED。`,
    }
  }

  if (validCount < required) {
    if (latest.pass === false) {
      return {
        ...empty,
        sampleEvaluations,
        validPostActionSampleCount: validCount,
        trailingPassCount,
        coreEvidenceSufficient: true,
        outcomeStatus: 'STILL_HANDLING',
        reason: `Action 后首组后验数据仍异常：${failureText}。保持 STILL_HANDLING；恢复确认还需连续 ${required} 组合规样本。`,
      }
    }
    return {
      ...empty,
      sampleEvaluations,
      validPostActionSampleCount: validCount,
      trailingPassCount,
      coreEvidenceSufficient: true,
      outcomeStatus: 'INSUFFICIENT_EVIDENCE',
      reason: `Action 后仅有 ${validCount} 组合规后验数据，尚不足以满足连续 ${required} 组的恢复规则。`,
    }
  }

  return {
    ...empty,
    sampleEvaluations,
    validPostActionSampleCount: validCount,
    trailingPassCount,
    coreEvidenceSufficient: true,
    outcomeStatus: 'STILL_HANDLING',
    reason:
      latest.pass === false
        ? `最新一组后验数据仍不满足恢复规则：${failureText}。保持 STILL_HANDLING，不能判定恢复。`
        : `最新数据已转为合规，但连续合规样本仅为 ${trailingPassCount}/${required}，尚不足以确认恢复。保持 STILL_HANDLING。`,
    limitations,
  }
}

export function describeChecks(checks: RecoveryCheck[]): string {
  return checks
    .map((check) => {
      const value =
        check.actual === null
          ? '—'
          : formatNumber(check.actual, METRIC_META[check.key].digits)
      return `${check.label} ${value} ${check.unit} / ≤ ${formatNumber(check.threshold, METRIC_META[check.key].digits)} ${check.unit}`
    })
    .join(' · ')
}

export function getThresholdChecks(
  thresholds: RecoveryThresholds,
): Array<{ key: MetricKey; label: string; threshold: number; unit: string }> {
  return CHECK_METRICS.map((metric) => ({
    key: metric,
    label: METRIC_META[metric].shortLabel,
    threshold: thresholds[metric],
    unit: METRIC_META[metric].unit,
  }))
}
