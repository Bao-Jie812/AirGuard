import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Check,
  ClipboardCheck,
  Play,
  Plus,
  ShieldAlert,
  X,
} from 'lucide-react'
import type {
  ActionRecord,
  ActionType,
  EnvironmentEvent,
} from '../data/types'
import { PageIntro } from '../components/ui/PageIntro'
import { SectionCard } from '../components/ui/Card'
import { Button, buttonClass } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { Notice } from '../components/ui/Notice'
import { EmptyState } from '../components/ui/EmptyState'
import {
  EventStatusBadge,
  EvidenceStatusBadge,
  RunStatusBadge,
  ScenarioBadge,
  SeverityBadge,
  ZoneStatusBadge,
} from '../components/ui/Badge'
import {
  ChartMarkerLegend,
  MetricTrendChart,
  type ChartMarker,
} from '../components/charts/MetricTrendChart'
import { useAppStore } from '../state/AppStore'
import {
  useLiveData,
  type ManualObservation,
} from '../state/LiveDataContext'
import { useToast } from '../state/ToastContext'
import { DispositionButton } from '../components/domain/DispositionButton'
import { getZone } from '../data/zones'
import {
  ACTION_TYPE_LABELS,
  EVIDENCE_KIND_LABELS,
  METRIC_META,
  SCENARIO_LABELS,
  ZONE_STATUS_LABELS,
} from '../domain/constants'
import {
  formatDateTime,
  formatDuration,
  formatNumber,
  formatTime,
  cn,
} from '../domain/format'
import {
  evaluateRecovery,
  getThresholdChecks,
} from '../domain/recovery'
import { priorityForZone } from '../domain/priority'
import {
  getActionsForEvent,
  getEventById,
  getRunsForEvent,
  getSamplesForEvent,
} from '../state/selectors'
import { getEvidenceForZone } from '../data/evidence'
import { EVENT_STATUS_LABELS } from '../domain/constants'
import { prepareChartSeries } from '../domain/chartSeries'

const ACTION_TYPES: ActionType[] = [
  'VENTILATION',
  'WINDOW_OPEN',
  'INSPECTION',
  'CLEANING',
  'OTHER',
]

const STATUS_TONE: Record<
  EnvironmentEvent['status'],
  'success' | 'warning' | 'danger' | 'info' | 'neutral'
> = {
  OPEN: 'info',
  HANDLING: 'warning',
  STILL_HANDLING: 'danger',
  RECOVERED: 'success',
  INSUFFICIENT_EVIDENCE: 'neutral',
}

function defaultActionType(event: EnvironmentEvent): ActionType {
  if (event.primaryMetric === 'crowdDensity') return 'WINDOW_OPEN'
  if (event.primaryMetric === 'co2') return 'VENTILATION'
  return 'INSPECTION'
}

function ActionCard({
  action,
  latest,
}: {
  action: ActionRecord
  latest: boolean
}) {
  return (
    <article className="action-card">
      <div className="action-card__rail" />
      <div className="action-card__content">
        <div className="action-card__head">
          <div>
            <span className="action-card__type">
              {ACTION_TYPE_LABELS[action.type]}
            </span>
            <h3>{action.title}</h3>
          </div>
          {latest && <span className="tag">最近 Action</span>}
        </div>
        <p className="action-card__note">
          {action.note || '未填写备注。'}
        </p>
        <div className="action-card__meta">
          <span>{formatDateTime(action.actionAt)}</span>
          <span>{action.operator}</span>
          <span className="mono">{action.actionId}</span>
          <span>
            {action.executionMode === 'LOCAL_DEMO'
              ? '本地记录'
              : '种子演示记录'}
          </span>
        </div>
      </div>
    </article>
  )
}

function PassIcon({ pass }: { pass: boolean | null }) {
  if (pass === null) return <span className="pass-icon pass-icon--na">—</span>
  return pass ? (
    <span className="pass-icon pass-icon--pass">
      <Check size={13} />
    </span>
  ) : (
    <span className="pass-icon pass-icon--fail">
      <X size={13} />
    </span>
  )
}

export function EventDetailPage() {
  const { eventId } = useParams()
  const {
    state,
    recordAction,
    reEvaluateEvent,
  } = useAppStore()
  const { readings, histories, priorities, manualObservations } = useLiveData()
  const { toast } = useToast()
  const [actionOpen, setActionOpen] = useState(false)
  // 现场取证照片的放大查看（点击缩略图打开）
  const [zoomObservation, setZoomObservation] =
    useState<ManualObservation | null>(null)
  const [actionType, setActionType] = useState<ActionType>('INSPECTION')
  const [actionTitle, setActionTitle] = useState('')
  const [actionNote, setActionNote] = useState('')
  const [operator, setOperator] = useState('现场值班组')
  const [formError, setFormError] = useState('')

  const event = getEventById(state, eventId)

  if (!event) {
    return (
      <div className="page-stack">
        <PageIntro
          backTo="/events"
          backLabel="返回事件列表"
          eyebrow="Event / 404"
          title="事件不存在"
          description="该 event_id 不存在，或当前演示数据中已被重置。"
        />
        <SectionCard>
          <EmptyState
            icon={<ShieldAlert size={24} />}
            title="无法找到事件"
            description={`未找到 event_id = ${eventId ?? '—'}。请返回事件列表或重置演示数据。`}
            action={
              <Link className={buttonClass('primary', 'md')} to="/events">
                返回事件列表
              </Link>
            }
          />
        </SectionCard>
      </div>
    )
  }

  const zone = getZone(event.zoneId)
  // 现场人工取证：本会话内该区域（含 H5 拍照经 MQTT 回传）的全部人工观察。
  // 与主栏「人工核实证据」不同：这里按区域精准匹配、不依赖事件挂载 ——
  // ML 隐患阶段（规则未越限、尚无事件）拍的照片也能在本页看到。
  const zoneObservations = manualObservations.filter(
    (obs) => obs.zoneId === event.zoneId,
  )
  const liveReading = readings[event.zoneId]
  const priority = priorityForZone(priorities, event.zoneId) ?? {
    zoneId: event.zoneId,
    score: 0,
    level: 'LOW' as const,
    zoneStatus: 'NORMAL' as const,
    rank: 0,
    factors: [],
    primaryMetric: event.primaryMetric,
    primaryDelta: 0,
    anomalyDurationMinutes: null,
    summary: '等待 MQTT 实时数据接入，暂未形成评估。',
  }
  const actions = getActionsForEvent(state, event.eventId)
  const latestAction = actions[0] ?? null
  const samples = getSamplesForEvent(state, event.eventId)
  const evaluation = evaluateRecovery(
    event,
    state.actions,
    state.recoverySamples,
    new Date().toISOString(),
  )
  const recoveryRuns = getRunsForEvent(state, event.eventId).filter(
    (run) => run.kind === 'RECOVERY_EVALUATION',
  )
  const latestSavedRun = recoveryRuns[0]
  const allRuns = getRunsForEvent(state, event.eventId)
  const evidence = getEvidenceForZone(event.zoneId, {
    reading: liveReading,
    history: histories[event.zoneId] ?? [],
    priority: priorityForZone(priorities, event.zoneId),
  })
  const evidenceProblems = evidence.filter((item) => item.status !== 'VALID')
  // 趋势图仅使用 MQTT 实时历史；断档断线 + 移动平均去抖
  const chartPoints = prepareChartSeries(
    (histories[event.zoneId] ?? []).map((point) => ({
      ts: point.ts,
      pm25: point.pm25,
      co2: point.co2,
      crowdDensity: point.crowdLevel,
    })),
  )
  const mainMeta = METRIC_META[event.primaryMetric]
  const latestSample =
    evaluation.sampleEvaluations[
      evaluation.sampleEvaluations.length - 1
    ] ?? null

  const markers: ChartMarker[] = [
    {
      at: event.openedAt,
      type: 'event',
      label: `事件开启 ${formatTime(event.openedAt)}`,
    },
    ...actions.map((action) => ({
      at: action.actionAt,
      type: 'action' as const,
      label: `Action ${formatTime(action.actionAt)}`,
    })),
    ...(event.closedAt
      ? [
          {
            at: event.closedAt,
            type: 'recovery' as const,
            label: `恢复 ${formatTime(event.closedAt)}`,
          },
        ]
      : []),
  ]

  const savedEvaluationIsStale =
    latestSavedRun !== undefined &&
    latestAction !== null &&
    latestSavedRun.actionId !== latestAction.actionId

  const thresholdChecks = getThresholdChecks(event.thresholds)
  const resultTone = STATUS_TONE[evaluation.outcomeStatus]

  function openActionModal() {
    if (event?.status === 'RECOVERED') {
      toast('已恢复事件在阶段一不允许追加 Action，以免改写历史。', 'warning')
      return
    }
    if (!event) return
    setActionType(defaultActionType(event))
    setActionTitle('')
    setActionNote('')
    setOperator('现场值班组')
    setFormError('')
    setActionOpen(true)
  }

  function submitAction(formEvent: FormEvent) {
    formEvent.preventDefault()
    if (!event) return
    const result = recordAction(event.eventId, {
      type: actionType,
      title: actionTitle,
      note: actionNote,
      operator,
    })
    if (!result.ok) {
      setFormError(result.message)
      return
    }
    setActionOpen(false)
    toast(
      `Action ${result.actionId} 已记录。事件进入处置中；Action 完成不代表恢复。`,
      'success',
    )
  }

  function handleReEvaluate() {
    if (!event) return
    const result = reEvaluateEvent(event.eventId)
    if (!result.ok) {
      toast(result.message, 'warning')
      return
    }
    const tone =
      result.outcomeStatus === 'RECOVERED'
        ? 'success'
        : result.outcomeStatus === 'STILL_HANDLING'
          ? 'warning'
          : 'info'
    toast(
      `已生成 ${result.runId} · ${EVENT_STATUS_LABELS[result.outcomeStatus]}。运行记录已保存。`,
      tone,
    )
  }

  const canRecordAction = event.status !== 'RECOVERED'

  return (
    <div className="page-stack event-detail-page">
      <PageIntro
        backTo="/events"
        backLabel="返回事件列表"
        eyebrow={`${event.eventId} · ${zone.name}`}
        title={event.title}
        description={event.description}
        actions={
          <>
            <SeverityBadge severity={event.severity} />
            {event.scenarioId && (
              <ScenarioBadge
                scenarioId={event.scenarioId}
                label={SCENARIO_LABELS[event.scenarioId]}
              />
            )}
            <EventStatusBadge status={event.status} />
          </>
        }
      />

      <div className="event-detail-banner">
        <div className="event-detail-banner__metrics">
          <span>
            <strong>Priority #{priority.rank}</strong>
            <small>{priority.score.toFixed(1)} 分</small>
          </span>
          <span>
            <strong>
              {liveReading
                ? `${formatNumber(
                    event.primaryMetric === 'pm25'
                      ? liveReading.pm25
                      : event.primaryMetric === 'co2'
                        ? liveReading.co2
                        : liveReading.crowdLevel,
                    mainMeta.digits,
                  )} ${mainMeta.unit}`
                : '—'}
            </strong>
            <small>
              {mainMeta.label}当前值{liveReading ? '' : '（等待实时数据）'}
            </small>
          </span>
          <span>
            <strong>
              {priority.anomalyDurationMinutes !== null
                ? formatDuration(priority.anomalyDurationMinutes)
                : '未持续'}
            </strong>
            <small>主要指标持续异常</small>
          </span>
          <span>
            <strong>{actions.length}</strong>
            <small>Action 记录</small>
          </span>
          <span>
            <strong>{samples.length}</strong>
            <small>后验样本</small>
          </span>
        </div>
        <span className="event-detail-banner__zone">
          <ZoneStatusBadge status={priority.zoneStatus} />
          <DispositionButton event={event} />
          <Link
            className="inline-link"
            to={`/history?zone=${event.zoneId}`}
          >
            历史趋势
            <ArrowRight size={14} />
          </Link>
          <Link
            className="inline-link"
            to={`/evidence?zone=${event.zoneId}`}
          >
            证据
            <ArrowRight size={14} />
          </Link>
        </span>
      </div>

      <div className="event-detail-layout">
        <div className="event-detail-main">
          <SectionCard
            title="事件趋势与关键时间点"
            subtitle={`${mainMeta.label} · 近 6 小时 · 虚线标记事件 / Action / 恢复`}
            action={
              <span className={cn('card-meta', 'mono')}>
                当前 {event.status}
              </span>
            }
          >
            <ChartMarkerLegend markers={markers} />
            <MetricTrendChart
              data={chartPoints}
              metric={event.primaryMetric}
              color={
                event.primaryMetric === 'pm25'
                  ? '#56779a'
                  : event.primaryMetric === 'co2'
                    ? '#4f8988'
                    : '#b37a58'
              }
              markers={markers}
              height={230}
            />
            <p className="chart-footnote">
              图表数据来自 MQTT 实时流（5 秒粒度，localStorage 持久化）；
              与 Action 后验样本使用同一实时业务状态。
            </p>
          </SectionCard>

          {(event.evidencePhotos ?? []).length > 0 && (
            <SectionCard
              title="人工核实证据"
              subtitle="现场取证照片（H5 现场端拍照 / Web 上传，经 MQTT 取证 Topic 回传）；仅作现场佐证，不参与 Recovery 判定。"
              action={
                <span className="card-meta">
                  {(event.evidencePhotos ?? []).length} 张
                </span>
              }
            >
              <div className="event-evidence-grid">
                {(event.evidencePhotos ?? []).map((photo) => (
                  <figure className="evidence-card__photo" key={photo.id}>
                    {photo.imageUrl ? (
                      <img
                        src={photo.imageUrl}
                        alt={`${zone.shortName}现场取证照片（${photo.fileName}）`}
                        loading="lazy"
                      />
                    ) : (
                      <div className="event-evidence-grid__fallback">
                        拍摄端浏览器无法解码该格式，仅保留元数据（
                        {photo.fileName}）
                      </div>
                    )}
                    <figcaption>
                      {photo.origin === 'H5' ? 'H5 现场端' : 'Web 工作台'} ·{' '}
                      {photo.operator} · {formatDateTime(photo.observedAt)}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </SectionCard>
          )}

          {event.limitations.length > 0 && (
            <Notice tone="warning" title="证据与降级限制">
              <ul className="notice-list">
                {event.limitations.map((limitation) => (
                  <li key={limitation}>{limitation}</li>
                ))}
              </ul>
              <p className="notice__secondary">
                外部接口或工具失败表示失去某项佐证，不等于业务未恢复；Recovery
                仍只依据 Action 后的有效业务数据。
              </p>
            </Notice>
          )}

          <SectionCard
            title="处置动作 Action"
            subtitle="Action 只记录处置已执行，不直接改变 Recovery 结论。"
            action={
              <Button
                variant="secondary"
                size="sm"
                icon={<Plus size={15} />}
                onClick={openActionModal}
                disabled={!canRecordAction}
                title={
                  canRecordAction
                    ? '记录新的处置动作'
                    : '已恢复事件不允许追加 Action'
                }
              >
                记录 Action
              </Button>
            }
          >
            {actions.length === 0 ? (
              <EmptyState
                title="尚未记录 Action"
                description="记录处置动作后，系统才会开启该 Action 的 Recovery 评估窗口。"
                compact
                action={
                  canRecordAction ? (
                    <Button
                      variant="primary"
                      size="sm"
                      icon={<Plus size={15} />}
                      onClick={openActionModal}
                    >
                      记录第一个 Action
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <div className="action-list">
                {actions.map((action, index) => (
                  <ActionCard
                    action={action}
                    latest={index === 0}
                    key={action.actionId}
                  />
                ))}
              </div>
            )}
            <div className="business-rule-callout">
              <span className="business-rule-callout__icon">
                <AlertTriangle size={15} />
              </span>
              <div>
                <strong>Action Completed ≠ Recovery</strong>
                <p>
                  即使 Action 已执行，只要 Action 后没有足够的新业务数据，事件仍不能标记为
                  RECOVERED。
                </p>
              </div>
            </div>
          </SectionCard>

          <SectionCard
            title="Action 后验数据与 Recovery Rule"
            subtitle="仅使用最新 Action 之后的业务数据；每组样本逐项核验阈值。"
            action={
              latestSavedRun ? (
                <Link
                  className="inline-link mono"
                  to={`/runs/${latestSavedRun.runId}`}
                >
                  {latestSavedRun.runId}
                  <ArrowRight size={14} />
                </Link>
              ) : undefined
            }
          >
            <div className="recovery-rule">
              <div className="recovery-rule__head">
                <span className="recovery-rule__icon">
                  <ClipboardCheck size={17} />
                </span>
                <div>
                  <h3>Recovery Rule · {evaluation.ruleVersion}</h3>
                  <p>
                    需要连续 {event.thresholds.consecutiveSamples} 组有效后验样本满足全部阈值。
                  </p>
                </div>
              </div>
              <div className="threshold-chips">
                {thresholdChecks.map((check) => (
                  <span className="threshold-chip" key={check.key}>
                    {check.label} ≤ {formatNumber(check.threshold, METRIC_META[check.key].digits)}{' '}
                    {check.unit}
                  </span>
                ))}
                <span className="threshold-chip threshold-chip--count">
                  连续 {event.thresholds.consecutiveSamples} 组
                </span>
              </div>
              <p className="recovery-rule__window">
                {latestAction
                  ? `当前评估窗口：${latestAction.actionId} · ${formatDateTime(latestAction.actionAt)} 之后`
                  : '尚无 Action；没有可用的 Recovery 评估窗口。'}
              </p>
            </div>

            {savedEvaluationIsStale && (
              <Notice tone="warning" compact>
                最近一次已保存的 Recovery 评估（{latestSavedRun?.runId}）基于更早的
                Action。新的 Action 已记录，请重新评估以生成新的 run_id。
              </Notice>
            )}

            <p className="scroll-hint">样本表可左右滑动查看完整列</p>
            <div className="table-wrap">
              <table className="data-table sample-table">
                <thead>
                  <tr>
                    <th>采样时间</th>
                    <th>PM2.5</th>
                    <th>CO₂</th>
                    <th>人流密度</th>
                    <th>数据质量</th>
                    <th>样本判定</th>
                  </tr>
                </thead>
                <tbody>
                  {evaluation.sampleEvaluations.map((sampleEval) => (
                    <tr key={sampleEval.sample.sampleId}>
                      <td>
                        <span className="mono">
                          {formatDateTime(sampleEval.sample.timestamp)}
                        </span>
                      </td>
                      {sampleEval.checks.map((check) => (
                        <td key={check.key}>
                          <span className="check-value">
                            {formatNumber(
                              check.actual ?? 0,
                              METRIC_META[check.key].digits,
                            )}
                            <small>{check.unit}</small>
                            <PassIcon pass={check.pass} />
                          </span>
                        </td>
                      ))}
                      <td>
                        <EvidenceStatusBadge
                          status={sampleEval.sample.quality}
                        />
                      </td>
                      <td>
                        {sampleEval.pass === null ? (
                          <span className="muted">不可用</span>
                        ) : sampleEval.pass ? (
                          <span className="sample-result sample-result--pass">
                            满足阈值
                          </span>
                        ) : (
                          <span className="sample-result sample-result--fail">
                            仍异常
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {evaluation.sampleEvaluations.length === 0 && (
                    <tr>
                      <td colSpan={6}>
                        <EmptyState
                          title="没有 Action 后的新业务数据"
                          description={
                            latestAction
                              ? '当前最新 Action 之后暂无有效样本。Recovery 不会仅凭 Action 完成而判定恢复。'
                              : '先记录 Action，随后新的业务数据才会进入评估窗口。'
                          }
                          compact
                        />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="recovery-results">
              <div
                className={cn(
                  'recovery-result',
                  `recovery-result--${resultTone}`,
                )}
              >
                <div className="recovery-result__head">
                  <span>当前数据即时预览</span>
                  <EventStatusBadge status={evaluation.outcomeStatus} />
                </div>
                <p className="recovery-result__reason">{evaluation.reason}</p>
                <div className="recovery-result__meta">
                  <span>
                    有效后验样本 {evaluation.validPostActionSampleCount} 组
                  </span>
                  <span>
                    连续合规 {evaluation.trailingPassCount}/
                    {evaluation.requiredConsecutive}
                  </span>
                  {latestSample && (
                    <span>
                      最新样本 {formatDateTime(latestSample.sample.timestamp)}
                    </span>
                  )}
                </div>
                <p className="recovery-result__note">
                  即时预览不会自动写入运行记录；点击“执行 Recovery
                  重新评估”才会保存新的 run_id。
                </p>
              </div>

              {latestSavedRun ? (
                <div className="saved-evaluation">
                  <div className="saved-evaluation__head">
                    <span>最近保存结论</span>
                    <RunStatusBadge status={latestSavedRun.status} />
                  </div>
                  <p className="saved-evaluation__result">
                    {latestSavedRun.finalOutput.label}
                  </p>
                  <p className="saved-evaluation__reason">
                    {latestSavedRun.ruleResult.reason}
                  </p>
                  <div className="saved-evaluation__meta">
                    <span className="mono">{latestSavedRun.runId}</span>
                    <span>{formatDateTime(latestSavedRun.createdAt)}</span>
                    <Link
                      to={`/runs/${latestSavedRun.runId}`}
                      className="inline-link"
                    >
                      查看运行快照
                      <ArrowRight size={14} />
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="saved-evaluation saved-evaluation--empty">
                  <p>尚无已保存的 Recovery 评估。</p>
                  <p>执行重新评估后，将生成可回查的 Run Trace。</p>
                </div>
              )}
            </div>

            <div className="recovery-actions">
              <div>
                <strong>重新评估并保存</strong>
                <p>
                  使用最新 Action 后的数据重新运行 Recovery Rule，生成新的
                  run_id；历史运行记录不会被覆盖。
                </p>
              </div>
              <Button
                variant="primary"
                icon={<Play size={15} />}
                onClick={handleReEvaluate}
                disabled={actions.length === 0 || event.status === 'RECOVERED'}
                title={
                  actions.length === 0
                    ? '需要先记录 Action'
                    : event.status === 'RECOVERED'
                      ? '事件已自动恢复，无需重复评估'
                      : '执行 Recovery 重新评估'
                }
              >
                执行 Recovery 重新评估
              </Button>
            </div>
          </SectionCard>

          <SectionCard
            title="状态演化记录"
            subtitle="事件状态变化、原因与关联 run_id"
          >
            <ol className="timeline timeline--compact">
              {[...event.statusHistory]
                .sort(
                  (a, b) =>
                    new Date(b.at).getTime() - new Date(a.at).getTime(),
                )
                .map((entry) => (
                  <li
                    className="timeline__item"
                    key={`${entry.at}-${entry.status}-${entry.reason}`}
                  >
                    <span
                      className={`timeline__dot timeline__dot--${entry.status.toLowerCase()}`}
                    />
                    <div className="timeline__content">
                      <div className="timeline__head">
                        <EventStatusBadge status={entry.status} />
                        <time>{formatDateTime(entry.at)}</time>
                      </div>
                      <p className="timeline__reason">{entry.reason}</p>
                      {entry.runId && (
                        <Link
                          to={`/runs/${entry.runId}`}
                          className="inline-link mono"
                        >
                          {entry.runId}
                          <ArrowRight size={13} />
                        </Link>
                      )}
                    </div>
                  </li>
                ))}
            </ol>
          </SectionCard>
        </div>

        <aside className="event-detail-side">
          <SectionCard title="事件信息">
            <dl className="info-list">
              <div>
                <dt>Event ID</dt>
                <dd className="mono">{event.eventId}</dd>
              </div>
              <div>
                <dt>区域</dt>
                <dd>
                  {zone.name}
                  <small>（{event.zoneId}）</small>
                </dd>
              </div>
              <div>
                <dt>状态</dt>
                <dd>
                  <EventStatusBadge status={event.status} />
                </dd>
              </div>
              <div>
                <dt>严重度</dt>
                <dd>
                  <SeverityBadge severity={event.severity} />
                </dd>
              </div>
              <div>
                <dt>开启时间</dt>
                <dd>{formatDateTime(event.openedAt)}</dd>
              </div>
              {event.closedAt && (
                <div>
                  <dt>恢复时间</dt>
                  <dd>{formatDateTime(event.closedAt)}</dd>
                </div>
              )}
              <div>
                <dt>主要指标</dt>
                <dd>{METRIC_META[event.primaryMetric].label}</dd>
              </div>
              <div>
                <dt>场景</dt>
                <dd>
                  {event.scenarioId ? (
                    <>
                      {event.scenarioId} · {SCENARIO_LABELS[event.scenarioId]}
                    </>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
              <div>
                <dt>数据来源</dt>
                <dd>SIMULATED · 本地演示</dd>
              </div>
            </dl>
            <div className="event-info__disposition">
              <DispositionButton event={event} block />
            </div>
          </SectionCard>

          <SectionCard
            title="证据与限制"
            subtitle="失败原因与被保留的业务事实"
            action={
              <Link
                to={`/evidence?zone=${event.zoneId}`}
                className="inline-link"
              >
                全部证据
                <ArrowRight size={14} />
              </Link>
            }
          >
            {evidenceProblems.length === 0 ? (
              <div className="evidence-ok">
                <CheckCircle2 size={16} />
                当前没有关键证据链路失败。
              </div>
            ) : (
              <div className="evidence-problem-list">
                {evidenceProblems.map((item) => (
                  <div className="evidence-problem" key={item.evidenceId}>
                    <div className="evidence-problem__head">
                      <span>{EVIDENCE_KIND_LABELS[item.kind]}</span>
                      <EvidenceStatusBadge status={item.status} />
                    </div>
                    <p>{item.limitation ?? item.summary}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="preserved-facts">
              <p className="preserved-facts__title">仍然有效的业务事实</p>
              <ul>
                <li>Current / History 为 SIMULATED 但内部一致，可用于规则与趋势判断。</li>
                <li>
                  事件状态未被证据失败改写：当前为{' '}
                  {EVENT_STATUS_LABELS[event.status]}。
                </li>
                <li>技术故障 ≠ 业务未恢复。</li>
              </ul>
            </div>
          </SectionCard>

          <SectionCard
            title="现场人工取证"
            subtitle="H5 现场端拍照经 MQTT 回传，仅显示本区域；点击照片放大查看。"
          >
            {zoneObservations.length === 0 ? (
              <p className="field-evidence-empty">
                暂无现场取证照片，请在 H5 现场端拍照上传
              </p>
            ) : (
              <div className="field-evidence-list">
                {zoneObservations.map((obs) => (
                  <figure className="field-evidence-item" key={obs.id}>
                    <button
                      type="button"
                      className="field-evidence-item__button"
                      onClick={() => obs.imageUrl && setZoomObservation(obs)}
                      disabled={!obs.imageUrl}
                      title={obs.imageUrl ? '点击放大查看' : '无可用图片'}
                    >
                      {obs.imageUrl ? (
                        <img
                          src={obs.imageUrl}
                          alt={`${zone.shortName}现场取证照片（${obs.fileName}）`}
                          loading="lazy"
                        />
                      ) : (
                        <span className="field-evidence-item__fallback">
                          拍摄端浏览器无法解码，仅保留元数据（{obs.fileName}）
                        </span>
                      )}
                    </button>
                    <figcaption>
                      来自现场巡检员的取证记录 · {formatDateTime(obs.observedAt)}
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard title="关联运行" subtitle="按照保存时间倒序">
            {allRuns.length === 0 ? (
              <EmptyState
                title="暂无运行记录"
                description="执行 Recovery 评估后会在这里生成 trace。"
                compact
              />
            ) : (
              <div className="related-runs">
                {allRuns.map((run) => (
                  <Link
                    className="related-run"
                    to={`/runs/${run.runId}`}
                    key={run.runId}
                  >
                    <div className="related-run__top">
                      <span className="mono">{run.runId}</span>
                      <RunStatusBadge status={run.status} />
                    </div>
                    <p>{run.finalOutput.label}</p>
                    <span>{formatDateTime(run.createdAt)}</span>
                  </Link>
                ))}
              </div>
            )}
          </SectionCard>

          <div className="side-note">
            <ShieldAlert size={15} />
            <p>
              当前页面不连接真实工单、传感器或模型服务。所有操作仅更新本地演示状态。
            </p>
          </div>
        </aside>
      </div>

      <Modal
        open={actionOpen}
        onClose={() => setActionOpen(false)}
        title="记录处置 Action"
        description="Action 仅表示处置动作已登记；不会直接将事件设为 RECOVERED。"
        size="md"
      >
        <form className="action-form" onSubmit={submitAction}>
          <div className="form-grid">
            <label className="form-field">
              <span>动作类型</span>
              <select
                value={actionType}
                onChange={(event) => setActionType(event.target.value as ActionType)}
              >
                {ACTION_TYPES.map((type) => (
                  <option value={type} key={type}>
                    {ACTION_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>执行人 / 值班组</span>
              <input
                value={operator}
                onChange={(event) => setOperator(event.target.value)}
                placeholder="现场值班组"
              />
            </label>
          </div>
          <label className="form-field">
            <span>Action 标题 *</span>
            <input
              value={actionTitle}
              onChange={(event) => setActionTitle(event.target.value)}
              placeholder="例如：开启东侧排风并限制入口人流"
              required
            />
          </label>
          <label className="form-field">
            <span>备注</span>
            <textarea
              value={actionNote}
              onChange={(event) => setActionNote(event.target.value)}
              rows={3}
              placeholder="记录处置范围、设备操作或现场引导情况。"
            />
          </label>
          <div className="form-meta">
            <span>执行时间：{formatDateTime(new Date().toISOString())}（本地时间）</span>
            <span>事件：{event.eventId}</span>
          </div>
          {formError && (
            <Notice tone="danger" compact>
              {formError}
            </Notice>
          )}
          <div className="form-actions">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setActionOpen(false)}
            >
              取消
            </Button>
            <Button
              type="submit"
              variant="primary"
              icon={<Plus size={15} />}
            >
              保存 Action
            </Button>
          </div>
        </form>
      </Modal>

      {/* 现场取证照片放大查看：ESC / 点遮罩关闭 */}
      <Modal
        open={zoomObservation !== null}
        onClose={() => setZoomObservation(null)}
        title="现场取证照片"
        description={
          zoomObservation
            ? `${getZone(zoomObservation.zoneId).name} · ${formatDateTime(
                zoomObservation.observedAt,
              )} · ${zoomObservation.operator}`
            : undefined
        }
        size="lg"
      >
        {zoomObservation?.imageUrl && (
          <figure className="field-evidence-zoom">
            <img src={zoomObservation.imageUrl} alt="现场取证照片大图" />
            <figcaption>来自现场巡检员的取证记录</figcaption>
          </figure>
        )}
      </Modal>

      <div className="event-detail-footnote">
        <span>
          事件状态由规则与业务状态驱动；LLM 解释不能改写状态。
        </span>
        <span>
          当前区域状态：{ZONE_STATUS_LABELS[priority.zoneStatus]} · Priority #
          {priority.rank}
        </span>
      </div>
    </div>
  )
}
