import { useMemo } from 'react'
import { ListChecks, Scale, Sigma } from 'lucide-react'
import { getZone } from '../../data/zones'
import {
  ANOMALY_Z_THRESHOLD,
  compareRuleWithMl,
  formatZScore,
  METRIC_VALUE_KEY,
  type AnomalySeriesPoint,
  type MetricAnomaly,
} from '../../domain/anomaly'
import {
  METRIC_META,
  METRIC_ORDER,
  ML_MODEL_VERSION,
  RULE_VERSION,
  ZONE_STATUS_LABELS,
} from '../../domain/constants'
import { clamp, cn, formatNumber } from '../../domain/format'
import { metricStatus } from '../../domain/priority'
import { useLiveData } from '../../state/LiveDataContext'
import { Badge, SourceBadge, ZoneStatusBadge } from '../ui/Badge'

/**
 * D5「规则 vs ML 对照」卡片。
 * 左侧固定规则（阈值分级），右侧轻量 ML（Z-score 滑动窗口），
 * 底部组合裁决：分歧时显式标明处理策略，不合并为单一结论。
 */

/** z 值刻度尺：[-4σ, +4σ] 轴，中间绿色带为 ±2σ 正常区间，圆点为当前 z */
function ZScale({ z, anomalous }: { z: number; anomalous: boolean }) {
  const RANGE = 4
  const clamped = Number.isFinite(z)
    ? clamp(z, -RANGE, RANGE)
    : z > 0
      ? RANGE
      : -RANGE
  const pct = ((clamped + RANGE) / (RANGE * 2)) * 100
  return (
    <div
      className="zscale"
      role="img"
      aria-label={`z = ${formatZScore(z)}，阈值 ±${ANOMALY_Z_THRESHOLD}`}
    >
      <span className="zscale__safe" />
      <span className="zscale__limit" style={{ left: '25%' }} />
      <span className="zscale__limit zscale__limit--zero" style={{ left: '50%' }} />
      <span className="zscale__limit" style={{ left: '75%' }} />
      <span
        className={cn('zscale__dot', anomalous && 'zscale__dot--anomaly')}
        style={{ left: `${pct}%` }}
      />
    </div>
  )
}

function MlMetricRow({ item }: { item: MetricAnomaly }) {
  return (
    <div className="ruleml-metric">
      <div className="ruleml-metric__top">
        <span className="ruleml-metric__label">{item.label}</span>
        <span className="ruleml-metric__value mono">
          {formatNumber(item.value, item.digits)} {item.unit}
        </span>
        <span
          className={cn(
            'ruleml-metric__z mono',
            item.anomalous && 'ruleml-metric__z--anomaly',
          )}
        >
          z&nbsp;=&nbsp;{formatZScore(item.zScore)}
        </span>
        <Badge tone={item.anomalous ? 'danger' : 'success'}>
          {item.anomalous ? 'ANOMALY' : 'NORMAL'}
        </Badge>
      </div>
      <ZScale z={item.zScore} anomalous={item.anomalous} />
      <p className="ruleml-metric__baseline mono">
        μ&nbsp;{formatNumber(item.mean, item.digits)} {item.unit} · σ&nbsp;
        {formatNumber(item.stddev, item.digits)} · 阈值 |z| &gt;{' '}
        {ANOMALY_Z_THRESHOLD}
      </p>
    </div>
  )
}

/** 稳定的空数组引用：无历史区域不会让 useMemo 每次渲染都失效 */
const EMPTY_HISTORY: AnomalySeriesPoint[] = []

export function RuleVsMlCard({ zoneId }: { zoneId: string }) {
  const { histories, priorities } = useLiveData()
  const history = histories[zoneId] ?? EMPTY_HISTORY
  const priority = priorities.find((item) => item.zoneId === zoneId)
  // factors 为空 = 该区域尚未收到 MQTT 数据，规则侧不参与对照
  const ruleStatus =
    priority && priority.factors.length > 0 ? priority.zoneStatus : null

  const comparison = useMemo(
    () => compareRuleWithMl(zoneId, ruleStatus, history),
    [zoneId, ruleStatus, history],
  )
  const { ml } = comparison
  const zone = getZone(zoneId)
  const current = history[history.length - 1]

  const headBadge =
    comparison.agreement === 'PENDING'
      ? { tone: 'neutral' as const, label: '等待数据' }
      : comparison.agreement === 'AGREE'
        ? comparison.arbitration === 'BOTH_ANOMALY'
          ? { tone: 'danger' as const, label: '双通道一致 · 异常' }
          : { tone: 'success' as const, label: '双通道一致 · 正常' }
        : { tone: 'violet' as const, label: '两者存在分歧' }

  return (
    <section
      className={cn(
        'ruleml-card',
        comparison.agreement === 'DISAGREE' && 'ruleml-card--disagree',
        comparison.arbitration === 'BOTH_ANOMALY' && 'ruleml-card--danger',
      )}
    >
      <div className="ruleml-card__head">
        <span className="ruleml-card__icon">
          <Scale size={18} />
        </span>
        <div className="ruleml-card__heading">
          <h2>规则 vs ML 对照</h2>
          <p>
            {zone.name} · 固定阈值规则与 Z-score
            滑动窗口检测独立判读；结论分歧时显式裁决，不合并为单一“AI 事实”。
          </p>
        </div>
        <Badge tone={headBadge.tone} dot>
          {headBadge.label}
        </Badge>
      </div>

      <div className="ruleml-grid">
        {/* 左：固定规则结果 */}
        <div className="ruleml-side">
          <div className="ruleml-side__head">
            <span className="ruleml-side__title">
              <ListChecks size={14} />
              固定规则结果
            </span>
            <SourceBadge source="SIMULATED" />
          </div>
          <div className="ruleml-side__verdict">
            {ruleStatus ? (
              <ZoneStatusBadge status={ruleStatus} />
            ) : (
              <Badge tone="neutral">等待实时数据</Badge>
            )}
            <span className="ruleml-side__verdict-note">
              区域状态 · 阈值分级
            </span>
          </div>
          <div className="ruleml-side__metrics">
            {METRIC_ORDER.map((metric) => {
              const meta = METRIC_META[metric]
              const value = current ? current[METRIC_VALUE_KEY[metric]] : null
              const status =
                value === null ? null : metricStatus(metric, value)
              return (
                <div className="ruleml-rule-row" key={metric}>
                  <span className="ruleml-metric__label">{meta.shortLabel}</span>
                  <span className="ruleml-metric__value mono">
                    {value === null
                      ? '—'
                      : `${formatNumber(value, meta.digits)} ${meta.unit}`}
                  </span>
                  <span className="ruleml-rule-row__thresholds mono">
                    关注 {formatNumber(meta.watch, meta.digits)} · 警戒{' '}
                    {formatNumber(meta.alert, meta.digits)}
                  </span>
                  {status ? (
                    <Badge
                      tone={status === 'NORMAL' ? 'success' : 'danger'}
                    >
                      {ZONE_STATUS_LABELS[status]}
                    </Badge>
                  ) : (
                    <Badge tone="neutral">—</Badge>
                  )}
                </div>
              )
            })}
          </div>
          <p className="ruleml-side__foot mono">
            规则版本 {RULE_VERSION} · 只看绝对阈值，不感知历史分布
          </p>
        </div>

        {/* 右：ML 模型结果 */}
        <div className="ruleml-side ruleml-side--ml">
          <div className="ruleml-side__head">
            <span className="ruleml-side__title">
              <Sigma size={14} />
              ML 模型结果
            </span>
            <SourceBadge source="MODEL_OUTPUT" />
          </div>
          <div className="ruleml-side__verdict">
            {ml.verdict === 'INSUFFICIENT_DATA' ? (
              <Badge tone="neutral">样本积累中</Badge>
            ) : ml.verdict === 'ANOMALY' ? (
              <Badge tone="danger" dot>
                ANOMALY · 偏离历史分布
              </Badge>
            ) : (
              <Badge tone="success" dot>
                NORMAL · 符合历史规律
              </Badge>
            )}
            <span className="ruleml-side__verdict-note">
              Z-score 滑动窗口 ·{' '}
              {ml.windowSpanMinutes !== null
                ? `最近 ${ml.sampleSize} 点（≈${Math.max(1, Math.round(ml.windowSpanMinutes))} 分钟）`
                : `${ml.sampleSize}/${ml.minSamples} 点`}
            </span>
          </div>
          {ml.verdict === 'INSUFFICIENT_DATA' ? (
            <div className="ruleml-ml-pending">
              <div className="ruleml-ml-pending__track">
                <span
                  style={{
                    width: `${clamp((ml.sampleSize / ml.minSamples) * 100, 0, 100)}%`,
                  }}
                />
              </div>
              <p>
                正在累积历史基线：{ml.sampleSize}/{ml.minSamples} 点（每 5 秒 1
                点，localStorage 持久化）。样本不足时 ML 不输出判定，避免伪造结论。
              </p>
            </div>
          ) : (
            <div className="ruleml-side__metrics">
              {ml.metrics.map((item) => (
                <MlMetricRow key={item.metric} item={item} />
              ))}
            </div>
          )}
          <p className="ruleml-side__foot mono">
            模型版本 {ML_MODEL_VERSION} · 只读辅助，不修改 Priority / Event /
            Recovery
          </p>
        </div>
      </div>

      <div
        className={cn(
          'ruleml-card__arbitration',
          `ruleml-card__arbitration--${comparison.arbitrationTone}`,
        )}
      >
        <span className="ruleml-card__arbitration-tag">组合裁决</span>
        <div>
          <strong>{comparison.arbitrationLabel}</strong>
          <p>{comparison.arbitrationDetail}</p>
        </div>
      </div>
    </section>
  )
}
