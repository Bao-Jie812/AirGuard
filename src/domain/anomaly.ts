import type { MetricKey, ZoneStatus } from '../data/types'
import { METRIC_META, METRIC_ORDER } from './constants'

/**
 * 轻量机器学习异常检测（D5：规则与 ML 对照）。
 *
 * 算法：基于 Z-score 的滑动窗口异常检测。
 *   对每个指标，取「当前点之前」的最近 N 个历史点（来自 localStorage
 *   持久化的实时历史，经 LiveDataContext 注入），计算均值 μ 与标准差 σ；
 *   当前读数 x 的标准分数 z = (x − μ) / max(σ, 指标噪声地板)。
 *   |z| > 阈值（默认 2σ）→ 判定 ANOMALY（显著偏离历史分布），
 *   否则 NORMAL（符合历史规律）。
 *
 * 边界保护：长时间平稳运行时历史近乎恒定，σ→0。若直接除以 σ，
 * 1 个传感器分辨率的正常波动也会算出 |z|→∞ 的伪异常，导致误报弹窗。
 * 因此分母设有每指标的最小有效标准差（噪声地板，见 METRIC_MIN_STDEV）：
 * 微小波动永远判正常，显著偏离（数倍于噪声地板）依然能被检出。
 *
 * 与固定规则（domain/priority.ts 的阈值分级）相互独立：
 * 规则看「绝对值是否越限」，ML 看「是否偏离近期历史分布」，
 * 两者结论可能不一致 —— 分歧由本模块的裁决矩阵显式处理。
 */

/** 滑动窗口大小：当前点之前最近 60 个历史点（5 秒粒度 ≈ 5 分钟） */
export const ANOMALY_WINDOW_SIZE = 60
/** 至少累积 12 个历史点（≈1 分钟）才输出判定，否则为样本不足 */
export const ANOMALY_MIN_SAMPLES = 12
/** Z-score 判定阈值：|z| > 2 视为显著偏离历史分布 */
export const ANOMALY_Z_THRESHOLD = 2

/**
 * 各指标的最小有效标准差（噪声地板，与传感器分辨率 / 典型噪声同量级）。
 * 历史近乎恒定时 σ→0，z = (x−μ)/σ 会把正常量化噪声放大成无穷大；
 * 分母改取 max(σ, 噪声地板) 后：平稳期微小波动 |z|≪2 判正常，
 * 恒定基线上的真实突变（如 CO₂ 未越限但陡升几十 ppm）仍为大 z 值可检出。
 */
export const METRIC_MIN_STDEV: Record<MetricKey, number> = {
  /** PM2.5：整数分辨率 1 μg/m³ */
  pm25: 1,
  /** CO₂：典型传感器噪声地板 ±5 ppm */
  co2: 5,
  /** 人流密度：两位小数分辨率，噪声地板 0.05 人/㎡ */
  crowdDensity: 0.05,
}

/** 检测所需的时间序列点（与 liveStore 的 LivePoint 同构） */
export interface AnomalySeriesPoint {
  ts: number
  pm25: number
  co2: number
  crowdLevel: number
}

export type MlVerdict = 'NORMAL' | 'ANOMALY' | 'INSUFFICIENT_DATA'

export interface MetricAnomaly {
  metric: MetricKey
  label: string
  unit: string
  digits: number
  /** 当前读数 */
  value: number
  /** 历史窗口均值 μ */
  mean: number
  /** 历史窗口标准差 σ（总体标准差，÷N） */
  stddev: number
  /** 标准分数 z = (x − μ) / max(σ, 指标噪声地板)；恒为有限值 */
  zScore: number
  anomalous: boolean
}

export interface MlAnomalyAssessment {
  zoneId: string
  verdict: MlVerdict
  /** 参与基线计算的历史点数 */
  sampleSize: number
  /** 基线窗口实际跨度（分钟）；样本不足时为 null */
  windowSpanMinutes: number | null
  metrics: MetricAnomaly[]
  /** 各指标 |z| 的最大值；样本不足时为 null */
  maxAbsZ: number | null
  zThreshold: number
  windowSize: number
  minSamples: number
}

/** LivePoint 字段名 → MetricKey 的映射（crowdLevel 即 crowdDensity 口径） */
export const METRIC_VALUE_KEY: Record<
  MetricKey,
  'pm25' | 'co2' | 'crowdLevel'
> = {
  pm25: 'pm25',
  co2: 'co2',
  crowdDensity: 'crowdLevel',
}

function meanOf(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/** 总体标准差（÷N）：描述窗口内历史分布的离散程度 */
function stddevOf(values: number[], mean: number): number {
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    values.length
  return Math.sqrt(variance)
}

/**
 * 带噪声地板的 z 值：分母取 max(σ, 指标最小有效标准差)。
 * σ≈0（历史恒定）时正常波动只得到远小于阈值的小 z 值；
 * 显著偏离（|x−μ| 数倍于噪声地板）仍得到大 z 值，检测能力不丢失。
 */
function zScoreOf(
  value: number,
  mean: number,
  stddev: number,
  minStddev: number,
): number {
  const effectiveStddev = Math.max(stddev, minStddev)
  return (value - mean) / effectiveStddev
}

/**
 * 对单个区域执行 Z-score 滑动窗口检测。
 * history 为按时间升序的实时历史（最后一点即当前读数）；
 * 基线窗口取「当前点之前」的最近 windowSize 个点，避免当前点污染自身基线。
 */
export function assessZoneAnomaly(
  zoneId: string,
  history: AnomalySeriesPoint[],
): MlAnomalyAssessment {
  const windowSize = ANOMALY_WINDOW_SIZE
  const zThreshold = ANOMALY_Z_THRESHOLD
  const minSamples = ANOMALY_MIN_SAMPLES
  const current = history[history.length - 1]
  const baseline = current ? history.slice(-(windowSize + 1), -1) : []

  if (!current || baseline.length < minSamples) {
    return {
      zoneId,
      verdict: 'INSUFFICIENT_DATA',
      sampleSize: baseline.length,
      windowSpanMinutes: null,
      metrics: [],
      maxAbsZ: null,
      zThreshold,
      windowSize,
      minSamples,
    }
  }

  const metrics: MetricAnomaly[] = METRIC_ORDER.map((metric) => {
    const meta = METRIC_META[metric]
    const key = METRIC_VALUE_KEY[metric]
    const values = baseline.map((point) => point[key])
    const mean = meanOf(values)
    const stddev = stddevOf(values, mean)
    const value = current[key]
    const zScore = zScoreOf(value, mean, stddev, METRIC_MIN_STDEV[metric])
    return {
      metric,
      label: meta.shortLabel,
      unit: meta.unit,
      digits: meta.digits,
      value,
      mean,
      stddev,
      zScore,
      anomalous: Math.abs(zScore) > zThreshold,
    }
  })

  const maxAbsZ = Math.max(...metrics.map((item) => Math.abs(item.zScore)))
  return {
    zoneId,
    verdict: metrics.some((item) => item.anomalous) ? 'ANOMALY' : 'NORMAL',
    sampleSize: baseline.length,
    windowSpanMinutes: (current.ts - baseline[0].ts) / 60000,
    metrics,
    maxAbsZ,
    zThreshold,
    windowSize,
    minSamples,
  }
}

/** z 值显示：±Infinity → ∞，绝对值过大时截断为 >99，避免撑破版面 */
export function formatZScore(z: number): string {
  if (!Number.isFinite(z)) return z > 0 ? '+∞' : '−∞'
  if (Math.abs(z) > 99) return z > 0 ? '>+99' : '<−99'
  const rounded = z.toFixed(2)
  return z > 0 ? `+${rounded}` : rounded
}

export type ComparisonAgreement = 'AGREE' | 'DISAGREE' | 'PENDING'

export type ArbitrationCode =
  | 'BOTH_NORMAL'
  | 'BOTH_ANOMALY'
  /** 规则正常 + ML 异常 → 交集从严：建议人工复核 */
  | 'STRICT_UNION'
  /** 规则异常 + ML 正常 → 规则优先：维持规则结论 */
  | 'RULE_PRIORITY'
  | 'PENDING'

export interface RuleMlComparison {
  zoneId: string
  /** 规则侧区域状态；null = 实时数据未就绪 */
  ruleStatus: ZoneStatus | null
  ruleAnomalous: boolean | null
  ml: MlAnomalyAssessment
  mlAnomalous: boolean | null
  agreement: ComparisonAgreement
  arbitration: ArbitrationCode
  arbitrationLabel: string
  arbitrationDetail: string
  arbitrationTone: 'success' | 'danger' | 'violet' | 'info' | 'neutral'
}

interface ArbitrationCopy {
  label: string
  detail: string
  tone: RuleMlComparison['arbitrationTone']
}

const ARBITRATION_COPY: Record<ArbitrationCode, ArbitrationCopy> = {
  BOTH_NORMAL: {
    label: '双通道一致 · 区域正常',
    detail:
      '固定规则未越限，ML 也未检测到分布偏离，两类证据相互印证，无需处置。',
    tone: 'success',
  },
  BOTH_ANOMALY: {
    label: '双通道一致 · 确认异常',
    detail:
      '规则阈值越限，且当前读数显著偏离近期历史分布，两类证据相互印证，按既有处置流程执行。',
    tone: 'danger',
  },
  STRICT_UNION: {
    label: '两者存在分歧 · 交集从严：建议人工复核',
    detail:
      '固定规则未越限，但 ML 检测到读数显著偏离近期历史分布（可能为缓慢爬升早期或传感器漂移）。按交集从严策略不直接放行，建议人工复核现场确认。',
    tone: 'violet',
  },
  RULE_PRIORITY: {
    label: '两者存在分歧 · 规则优先：维持规则结论',
    detail:
      '规则已越限，但当前读数仍处于近期历史分布之内（异常持续过久时滑动基线会被污染，ML 敏感性下降）。以规则结论为准继续处置，ML 不追加额外告警。',
    tone: 'info',
  },
  PENDING: {
    label: '等待数据 · 暂不裁决',
    detail:
      '实时历史样本不足或规则评估尚未就绪，累积足够 MQTT 数据后自动输出对照结论。',
    tone: 'neutral',
  },
}

/**
 * 规则与 ML 的对照裁决。
 * ruleStatus 来自固定规则（priority.zoneStatus）；null 表示规则侧无数据。
 */
export function compareRuleWithMl(
  zoneId: string,
  ruleStatus: ZoneStatus | null,
  history: AnomalySeriesPoint[],
): RuleMlComparison {
  const ml = assessZoneAnomaly(zoneId, history)
  const ruleAnomalous =
    ruleStatus === null ? null : ruleStatus !== 'NORMAL'
  const mlAnomalous =
    ml.verdict === 'INSUFFICIENT_DATA' ? null : ml.verdict === 'ANOMALY'

  let agreement: ComparisonAgreement
  let arbitration: ArbitrationCode
  if (ruleAnomalous === null || mlAnomalous === null) {
    agreement = 'PENDING'
    arbitration = 'PENDING'
  } else if (ruleAnomalous === mlAnomalous) {
    agreement = 'AGREE'
    arbitration = ruleAnomalous ? 'BOTH_ANOMALY' : 'BOTH_NORMAL'
  } else {
    agreement = 'DISAGREE'
    arbitration = mlAnomalous ? 'STRICT_UNION' : 'RULE_PRIORITY'
  }

  const copy = ARBITRATION_COPY[arbitration]
  return {
    zoneId,
    ruleStatus,
    ruleAnomalous,
    ml,
    mlAnomalous,
    agreement,
    arbitration,
    arbitrationLabel: copy.label,
    arbitrationDetail: copy.detail,
    arbitrationTone: copy.tone,
  }
}
