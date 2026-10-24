import {
  EVIDENCE_KIND_LABELS,
  METRIC_META,
  ML_MODEL_VERSION,
  PRIORITY_LEVEL_LABELS,
  SOURCE_LABELS,
  ZONE_STATUS_LABELS,
} from '../domain/constants'
import {
  assessZoneAnomaly,
  formatZScore,
} from '../domain/anomaly'
import {
  formatDateTimeFromMs,
  formatDuration,
  formatNumber,
} from '../domain/format'
import type {
  DataSource,
  EvidenceCitation,
  EvidenceConflict,
  EvidenceItem,
  EvidenceStatus,
  PriorityAssessment,
} from './types'
import { ZONES, getZone } from './zones'

/**
 * 证据卡所需的实时上下文。
 * CURRENT / HISTORY / RULE 卡完全由 MQTT 实时数据构建；
 * RAG / ML / MANUAL 为演示知识条目，不伪装成传感器事实。
 */
export interface EvidenceLiveContext {
  reading?: {
    pm25: number
    co2: number
    crowdLevel: number
    time: string
    receivedAt: number
  }
  history: { ts: number; pm25: number; co2: number; crowdLevel: number }[]
  priority?: PriorityAssessment
}

interface RagProfile {
  status: EvidenceStatus
  relevance: number
  query: string
  citations: EvidenceCitation[]
  limitation?: string
}

const RAG_PROFILES: Record<string, RagProfile> = {
  'zone-w': {
    status: 'VALID',
    relevance: 0.86,
    query: '人员密集就餐区 CO₂ 持续偏高时应如何处理',
    citations: [
      {
        docId: 'DEMO-KB-VENT-04',
        title: '校园公共建筑通风与健康管理指引（演示知识库）',
        section: '§4.2 人员密集场所',
        snippet:
          '人员密集场所 CO₂ 浓度持续高于 1000 ppm 时，应优先加强机械通风、降低瞬时人流，并持续观察至少两个采样周期。',
        relevance: 0.86,
        note: '演示知识库条目，不是真实公开文献。',
      },
    ],
  },
  'zone-s': {
    status: 'VALID',
    relevance: 0.74,
    query: '教室课间 CO₂ 升高的通风建议',
    citations: [
      {
        docId: 'DEMO-KB-CLASS-07',
        title: '教学楼课间通风检查要点（演示知识库）',
        section: '§1.3 课间换气',
        snippet:
          '课间应结合门窗开启情况与实际人数进行短时换气，并观察下一周期 CO₂ 是否回落。',
        relevance: 0.74,
        note: '演示知识库条目。',
      },
    ],
  },
  'zone-n': {
    status: 'MISSING',
    relevance: 0,
    query: '宿舍区当前环境异常的解释依据',
    citations: [],
    limitation:
      '知识库无匹配来源（No-source）。系统不会用无来源知识为区域状态编写解释。',
  },
}

function sourceLabel(source: DataSource): string {
  return `${source} · ${SOURCE_LABELS[source]}`
}

function currentEvidence(
  zoneId: string,
  ctx: EvidenceLiveContext,
): EvidenceItem {
  const zone = getZone(zoneId)
  const reading = ctx.reading
  if (!reading) {
    return {
      evidenceId: `ev-${zoneId}-current`,
      zoneId,
      kind: 'CURRENT',
      source: 'SIMULATED',
      status: 'MISSING',
      title: '当前环境与人流快照',
      summary: '等待 MQTT 实时数据：尚未收到该区域的传感器推送。',
      fields: [
        { label: '状态', value: 'MISSING · 等待实时数据', tone: 'warning' },
        { label: '来源', value: 'MQTT · airguard/sensor/' + zoneId },
      ],
      observedAt: new Date().toISOString(),
      limitation:
        '启动模拟器（npm run simulator）后，此卡每 5 秒随实时数据更新。',
    }
  }
  const crowdCount = Math.round(reading.crowdLevel * zone.areaSqm)
  return {
    evidenceId: `ev-${zoneId}-current`,
    zoneId,
    kind: 'CURRENT',
    source: 'SIMULATED',
    status: 'VALID',
    title: '当前环境与人流快照',
    summary: `MQTT 实时快照：PM2.5 ${formatNumber(reading.pm25)} ${METRIC_META.pm25.unit}，CO₂ ${formatNumber(reading.co2)} ${METRIC_META.co2.unit}，人流约 ${formatNumber(crowdCount)} 人。`,
    fields: [
      {
        label: 'PM2.5',
        value: `${formatNumber(reading.pm25)} ${METRIC_META.pm25.unit}`,
      },
      {
        label: 'CO₂',
        value: `${formatNumber(reading.co2)} ${METRIC_META.co2.unit}`,
      },
      {
        label: '人流密度',
        value: `${formatNumber(reading.crowdLevel, 2)} ${METRIC_META.crowdDensity.unit}`,
      },
      { label: '估算人数', value: `${formatNumber(crowdCount)} 人` },
      { label: '来源', value: 'MQTT 实时流 · airguard/sensor/' + zoneId },
    ],
    observedAt: reading.time,
  }
}

function historyEvidence(
  zoneId: string,
  ctx: EvidenceLiveContext,
): EvidenceItem {
  const points = ctx.history
  if (points.length === 0) {
    return {
      evidenceId: `ev-${zoneId}-history`,
      zoneId,
      kind: 'HISTORY',
      source: 'SIMULATED',
      status: 'MISSING',
      title: '实时历史序列',
      summary: '实时历史为空：收到 MQTT 推送后开始累积（localStorage 持久化）。',
      fields: [
        { label: '样本数', value: '0 点' },
        { label: '来源', value: 'MQTT 实时流 · 本地持久化' },
      ],
      observedAt: new Date().toISOString(),
    }
  }
  const first = points[0]
  const latest = points[points.length - 1]
  return {
    evidenceId: `ev-${zoneId}-history`,
    zoneId,
    kind: 'HISTORY',
    source: 'SIMULATED',
    status: 'VALID',
    title: '实时历史序列（5 秒粒度）',
    summary: `已累积 ${points.length} 个实时采样点（${formatDateTimeFromMs(first.ts)} 起），供趋势、持续时间和 Action 前后对照使用。`,
    fields: [
      {
        label: '窗口',
        value: `${formatDateTimeFromMs(first.ts)} – ${formatDateTimeFromMs(latest.ts)}`,
      },
      { label: '采样间隔', value: '5 秒（MQTT 推送）' },
      { label: '样本数', value: `${points.length} 点` },
      {
        label: '最新点',
        value: `CO₂ ${formatNumber(latest.co2)} ppm · PM2.5 ${formatNumber(latest.pm25)} μg/m³`,
      },
      { label: '来源', value: 'MQTT 实时流 · localStorage 持久化' },
    ],
    observedAt: new Date(latest.ts).toISOString(),
  }
}

function ruleEvidence(
  zoneId: string,
  ctx: EvidenceLiveContext,
): EvidenceItem {
  const priority = ctx.priority
  if (!priority || priority.factors.length === 0) {
    return {
      evidenceId: `ev-${zoneId}-rule`,
      zoneId,
      kind: 'RULE',
      source: 'SIMULATED',
      status: 'MISSING',
      title: '规则判断：区域状态与 Priority',
      summary: '等待实时数据：收到 MQTT 推送后即时计算区域状态与 Priority。',
      fields: [
        { label: '状态', value: 'MISSING · 等待实时数据', tone: 'warning' },
      ],
      observedAt: new Date().toISOString(),
    }
  }
  const topFactors = [...priority.factors]
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 2)
  const primaryMeta = METRIC_META[priority.primaryMetric]
  const reading = ctx.reading
  return {
    evidenceId: `ev-${zoneId}-rule`,
    zoneId,
    kind: 'RULE',
    source: 'SIMULATED',
    status: 'VALID',
    title: '规则判断：区域状态与 Priority',
    summary: `区域状态 ${ZONE_STATUS_LABELS[priority.zoneStatus]}，Priority ${priority.score.toFixed(1)}（${PRIORITY_LEVEL_LABELS[priority.level]}），排名 #${priority.rank}。`,
    fields: [
      {
        label: '区域状态',
        value: ZONE_STATUS_LABELS[priority.zoneStatus],
      },
      {
        label: 'Priority',
        value: `${priority.score.toFixed(1)} · ${PRIORITY_LEVEL_LABELS[priority.level]}`,
      },
      {
        label: '主要指标',
        value: reading
          ? `${primaryMeta.shortLabel} ${formatNumber(reading[priority.primaryMetric === 'crowdDensity' ? 'crowdLevel' : priority.primaryMetric], primaryMeta.digits)} ${primaryMeta.unit}`
          : primaryMeta.label,
      },
      {
        label: '主要贡献',
        value: topFactors
          .map((factor) => `${factor.label} +${factor.contribution.toFixed(1)}`)
          .join('；'),
      },
      {
        label: '持续异常',
        value:
          priority.anomalyDurationMinutes === null
            ? '未形成'
            : formatDuration(priority.anomalyDurationMinutes),
      },
    ],
    observedAt: reading?.time ?? new Date().toISOString(),
    limitation: '规则输出完全由 MQTT 实时历史计算，在浏览器本地可复现。',
  }
}

function ragEvidence(zoneId: string): EvidenceItem {
  const profile = RAG_PROFILES[zoneId]
  return {
    evidenceId: `ev-${zoneId}-rag`,
    zoneId,
    kind: 'RAG',
    source: 'PUBLIC',
    status: profile.status,
    title: '知识库检索与引用',
    summary:
      profile.status === 'MISSING'
        ? '检索无匹配来源，未生成引用。'
        : `命中 ${profile.citations.length} 条演示引用，最高相关度 ${profile.relevance.toFixed(2)}。`,
    fields: [
      { label: '查询', value: profile.query },
      { label: '命中引用', value: `${profile.citations.length} 条` },
      { label: '最高相关度', value: profile.relevance.toFixed(2) },
      { label: '使用阈值', value: '≥ 0.55' },
      { label: '来源', value: sourceLabel('PUBLIC') },
    ],
    observedAt: new Date().toISOString(),
    limitation: profile.limitation,
    citations: profile.citations,
    demoNote: '演示知识库内容为项目编写，不是真实文献或公开标准。',
  }
}

/**
 * ML 证据卡：Z-score 滑动窗口异常检测的真实输出（D5）。
 * 基线取自 localStorage 持久化的实时历史（当前点之前最近 N 点），
 * 与固定规则相互独立；判定只作辅助信号，不修改业务状态。
 */
function mlEvidence(zoneId: string, ctx: EvidenceLiveContext): EvidenceItem {
  const assessment = assessZoneAnomaly(zoneId, ctx.history)

  if (assessment.verdict === 'INSUFFICIENT_DATA') {
    return {
      evidenceId: `ev-${zoneId}-ml`,
      zoneId,
      kind: 'ML',
      source: 'MODEL_OUTPUT',
      status: 'STALE',
      title: '轻量 ML 异常检测（Z-score 滑动窗口）',
      summary: `样本积累中：已累积 ${assessment.sampleSize}/${assessment.minSamples} 个历史点，达到最小样本量后开始输出判定。`,
      fields: [
        { label: '任务', value: 'Z-score 滑动窗口异常检测（PM2.5 / CO₂ / 人流）' },
        { label: '判定', value: 'STALE · 样本不足', tone: 'warning' },
        {
          label: '基线窗口',
          value: `当前点之前最近 ${assessment.windowSize} 点（5 秒粒度）`,
        },
        { label: '判定阈值', value: `|z| > ${assessment.zThreshold}（标准差倍数）` },
        { label: '业务权限', value: '只读辅助，不修改 Priority / Event / Recovery' },
        { label: '模型版本', value: ML_MODEL_VERSION },
      ],
      observedAt: new Date().toISOString(),
      limitation: '样本不足时不输出判定，避免在基线未建立时伪造结论。',
      modelVersion: ML_MODEL_VERSION,
    }
  }

  const anomalous = assessment.metrics.filter((item) => item.anomalous)
  const worst = [...assessment.metrics].sort(
    (a, b) => Math.abs(b.zScore) - Math.abs(a.zScore),
  )[0]
  const spanMinutes = Math.max(1, Math.round(assessment.windowSpanMinutes ?? 0))
  const detected =
    assessment.verdict === 'ANOMALY'
      ? `检测到 ${anomalous.length} 项指标显著偏离历史分布：${anomalous
          .map(
            (item) =>
              `${item.label} z=${formatZScore(item.zScore)}（μ=${formatNumber(item.mean, item.digits)}，σ=${formatNumber(item.stddev, item.digits)}）`,
          )
          .join('；')}。判定：ANOMALY。`
      : `三项指标均符合最近约 ${spanMinutes} 分钟的历史分布（最大 |z| = ${formatZScore(assessment.maxAbsZ ?? 0)}，阈值 ±${assessment.zThreshold}）。判定：NORMAL。`
  return {
    evidenceId: `ev-${zoneId}-ml`,
    zoneId,
    kind: 'ML',
    source: 'MODEL_OUTPUT',
    status: 'VALID',
    title: '轻量 ML 异常检测（Z-score 滑动窗口）',
    summary: detected,
    fields: [
      { label: '任务', value: 'Z-score 滑动窗口异常检测（PM2.5 / CO₂ / 人流）' },
      {
        label: '判定',
        value:
          assessment.verdict === 'ANOMALY'
            ? 'ANOMALY · 偏离历史分布'
            : 'NORMAL · 符合历史规律',
        tone: assessment.verdict === 'ANOMALY' ? 'warning' : 'default',
      },
      {
        label: '基线窗口',
        value: `最近 ${assessment.sampleSize} 点（约 ${spanMinutes} 分钟 · 5 秒粒度）`,
      },
      {
        label: '偏离最大指标',
        value: worst
          ? `${worst.label} z=${formatZScore(worst.zScore)}（阈值 ±${assessment.zThreshold}）`
          : '—',
        tone: worst?.anomalous ? 'warning' : 'default',
      },
      { label: '业务权限', value: '只读辅助，不修改 Priority / Event / Recovery' },
      { label: '模型版本', value: ML_MODEL_VERSION },
    ],
    observedAt: new Date().toISOString(),
    limitation:
      '轻量统计检测只感知短期分布偏离：规则阈值未越限的缓慢爬升也可能被判为 ANOMALY；反之异常持续超过窗口时长后基线被污染，ML 会回落为 NORMAL。需与固定规则阈值对照判读（见「规则 vs ML 对照」卡）。',
    modelVersion: ML_MODEL_VERSION,
    demoNote: '阶段三前端统计算法：基线来自 localStorage 实时历史，非占位输出。',
  }
}

export function getEvidenceForZone(
  zoneId: string,
  ctx: EvidenceLiveContext,
): EvidenceItem[] {
  return [
    currentEvidence(zoneId, ctx),
    historyEvidence(zoneId, ctx),
    ragEvidence(zoneId),
    ruleEvidence(zoneId, ctx),
    mlEvidence(zoneId, ctx),
  ]
}

export function getAllEvidence(
  ctxByZone: Record<string, EvidenceLiveContext>,
): EvidenceItem[] {
  return ZONES.flatMap((zone) =>
    getEvidenceForZone(
      zone.zoneId,
      ctxByZone[zone.zoneId] ?? { history: [] },
    ),
  )
}

export function countEvidenceStatuses(
  ctxByZone: Record<string, EvidenceLiveContext>,
): Record<EvidenceStatus, number> {
  const counts: Record<EvidenceStatus, number> = {
    VALID: 0,
    STALE: 0,
    MISSING: 0,
    TIMEOUT: 0,
    ERROR: 0,
  }
  for (const item of getAllEvidence(ctxByZone)) counts[item.status] += 1
  return counts
}

export function getEvidenceExceptions(
  ctxByZone: Record<string, EvidenceLiveContext>,
): EvidenceItem[] {
  return getAllEvidence(ctxByZone).filter((item) => item.status !== 'VALID')
}

export function getEvidenceStatusCounts(
  zoneId: string,
  ctx: EvidenceLiveContext,
): Record<EvidenceStatus, number> {
  const counts: Record<EvidenceStatus, number> = {
    VALID: 0,
    STALE: 0,
    MISSING: 0,
    TIMEOUT: 0,
    ERROR: 0,
  }
  for (const item of getEvidenceForZone(zoneId, ctx)) counts[item.status] += 1
  return counts
}

export const EVIDENCE_CONFLICTS: EvidenceConflict[] = []

export function getEvidenceConflicts(zoneId: string): EvidenceConflict[] {
  return EVIDENCE_CONFLICTS.filter((conflict) => conflict.zoneId === zoneId)
}

export function evidenceKindLabel(kind: EvidenceItem['kind']): string {
  return EVIDENCE_KIND_LABELS[kind]
}
