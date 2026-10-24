import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  ShieldCheck,
  Wrench,
  X,
} from 'lucide-react'
import { PageIntro } from '../components/ui/PageIntro'
import { SectionCard } from '../components/ui/Card'
import { Badge, RunStatusBadge, ScenarioBadge } from '../components/ui/Badge'
import { EmptyState } from '../components/ui/EmptyState'
import { buttonClass } from '../components/ui/Button'
import { useAppStore } from '../state/AppStore'
import { useToast } from '../state/ToastContext'
import { getEventById } from '../state/selectors'
import { getZone } from '../data/zones'
import {
  EVIDENCE_KIND_LABELS,
  RUN_KIND_LABELS,
  SCENARIO_LABELS,
} from '../domain/constants'
import { formatDateTime, formatNumber } from '../domain/format'
import type { EvidenceStatus, ToolStatus } from '../data/types'

const TOOL_TONE: Record<
  ToolStatus,
  'success' | 'warning' | 'danger' | 'neutral'
> = {
  SUCCESS: 'success',
  TIMEOUT: 'danger',
  ERROR: 'danger',
  NO_SOURCE: 'warning',
  SKIPPED: 'neutral',
}

const EVIDENCE_TONE: Record<
  EvidenceStatus,
  'success' | 'warning' | 'danger' | 'neutral'
> = {
  VALID: 'success',
  STALE: 'warning',
  TIMEOUT: 'danger',
  MISSING: 'neutral',
  ERROR: 'danger',
}

function RulePassIcon({ pass }: { pass?: boolean | null }) {
  if (pass === undefined || pass === null) {
    return <span className="rule-pass rule-pass--na">—</span>
  }
  return pass ? (
    <span className="rule-pass rule-pass--pass">
      <Check size={12} />
    </span>
  ) : (
    <span className="rule-pass rule-pass--fail">
      <X size={12} />
    </span>
  )
}

export function RunDetailPage() {
  const { runId } = useParams()
  const { state } = useAppStore()
  const { toast } = useToast()
  const [copied, setCopied] = useState(false)
  const run = state.runs.find((item) => item.runId === runId)

  if (!run) {
    return (
      <div className="page-stack">
        <PageIntro
          backTo="/runs"
          backLabel="返回 Run Trace"
          eyebrow="Run Trace / 404"
          title="运行记录不存在"
          description="该 run_id 不在当前本地演示状态中。"
        />
        <SectionCard>
          <EmptyState
            title="未找到运行快照"
            description={`run_id = ${runId ?? '—'}。请返回列表，或在事件详情页执行一次 Recovery 重新评估。`}
            action={
              <Link className={buttonClass('primary', 'md')} to="/runs">
                返回运行列表
              </Link>
            }
          />
        </SectionCard>
      </div>
    )
  }

  const zone = getZone(run.zoneId)
  const event = getEventById(state, run.eventId)
  const runMetaTone =
    run.status === 'SUCCESS'
      ? 'success'
      : run.status === 'PARTIAL'
        ? 'warning'
        : 'danger'

  async function copyRunId() {
    if (!run) return
    try {
      await navigator.clipboard.writeText(run.runId)
      setCopied(true)
      toast(`已复制 ${run.runId}`, 'success')
      window.setTimeout(() => setCopied(false), 2200)
    } catch {
      toast('复制失败，请手动选择 run_id。', 'warning')
    }
  }

  return (
    <div className="page-stack run-detail-page">
      <PageIntro
        backTo="/runs"
        backLabel="返回 Run Trace"
        eyebrow={`${run.runId} · ${zone.name}`}
        title="Run Trace 详情"
        description={run.trigger}
        actions={
          <>
            {run.scenarioId && (
              <ScenarioBadge
                scenarioId={run.scenarioId}
                label={SCENARIO_LABELS[run.scenarioId]}
              />
            )}
            <RunStatusBadge status={run.status} />
            <button
              type="button"
              className={buttonClass('secondary', 'sm')}
              onClick={copyRunId}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? '已复制' : '复制 run_id'}
            </button>
          </>
        }
      />

      <div className="snapshot-banner">
        <span className="snapshot-banner__icon">
          <ShieldCheck size={18} />
        </span>
        <div>
          <strong>这是一个已保存的运行快照</strong>
          <p>
            打开此页面不会重新调用 LLM、工具或模型，也不会改变历史结果。执行模式：
            {run.executionMode === 'SEEDED_DEMO'
              ? '种子演示快照'
              : '浏览器本地规则执行（LOCAL_DEMO）'}
            。
          </p>
        </div>
        <Badge tone="neutral" mono>
          {run.executionMode}
        </Badge>
      </div>

      <section className={`run-final run-final--${run.finalOutput.tone}`}>
        <div className="run-final__top">
          <div>
            <span className="run-final__eyebrow">最终输出 / FINAL OUTPUT</span>
            <h2>{run.finalOutput.label}</h2>
          </div>
          <div className="run-final__badges">
            <RunStatusBadge status={run.status} />
            <Badge tone="neutral">{RUN_KIND_LABELS[run.kind]}</Badge>
          </div>
        </div>
        <p className="run-final__summary">{run.finalOutput.summary}</p>
        {run.finalOutput.limitations.length > 0 && (
          <div className="run-final__limitations">
            <span>限制</span>
            <ul>
              {run.finalOutput.limitations.map((limitation) => (
                <li key={limitation}>{limitation}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <div className="run-detail-layout">
        <div className="run-detail-main">
          <SectionCard
            title="01 · 输入快照"
            subtitle={run.inputSnapshot.title}
          >
            <p className="run-section-description">
              {run.inputSnapshot.description}
            </p>
            <dl className="snapshot-fields">
              {run.inputSnapshot.fields.map((field) => (
                <div key={`${field.label}-${field.value}`}>
                  <dt>{field.label}</dt>
                  <dd>
                    {field.value}
                    {field.source && (
                      <Badge tone="neutral" mono className="snapshot-source">
                        {field.source}
                      </Badge>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </SectionCard>

          <SectionCard
            title="02 · 证据使用"
            subtitle={`${run.evidence.length} 项快照 · 来源与有效性在运行时已固定`}
          >
            {run.evidence.length === 0 ? (
              <EmptyState
                title="本运行未记录证据快照"
                description="请检查运行构建过程。"
                compact
              />
            ) : (
              <div className="run-evidence-list">
                {run.evidence.map((item) => (
                  <div className="run-evidence" key={item.evidenceId}>
                    <div className="run-evidence__top">
                      <span className="run-evidence__kind">
                        {EVIDENCE_KIND_LABELS[item.kind]}
                      </span>
                      <span className="run-evidence__badges">
                        <Badge
                          tone={
                            item.source === 'MODEL_OUTPUT'
                              ? 'violet'
                              : item.source === 'MANUAL_OBSERVATION'
                                ? 'teal'
                                : item.source === 'PUBLIC'
                                  ? 'info'
                                  : 'neutral'
                          }
                          mono
                        >
                          {item.source}
                        </Badge>
                        <Badge tone={EVIDENCE_TONE[item.status]} dot>
                          {item.status}
                        </Badge>
                      </span>
                    </div>
                    <p className="run-evidence__title">{item.title}</p>
                    <p className="run-evidence__summary">{item.summary}</p>
                    {item.limitation && (
                      <p className="run-evidence__limitation">
                        <AlertTriangle size={13} />
                        {item.limitation}
                      </p>
                    )}
                    <div className="run-evidence__foot">
                      <span className="mono">{item.evidenceId}</span>
                      <span>{formatDateTime(item.observedAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="03 · 工具调用"
            subtitle="记录调用参数、耗时、结果状态与输出摘要"
          >
            <p className="scroll-hint">工具调用表可左右滑动查看完整列</p>
            <div className="table-wrap">
              <table className="data-table tool-table">
                <thead>
                  <tr>
                    <th>工具</th>
                    <th>模式</th>
                    <th>状态</th>
                    <th>耗时</th>
                    <th>参数 / 输出</th>
                  </tr>
                </thead>
                <tbody>
                  {run.toolCalls.map((call) => (
                    <tr key={call.callId}>
                      <td>
                        <span className="mono tool-name">{call.tool}</span>
                        <span className="tool-call-id mono">{call.callId}</span>
                      </td>
                      <td>
                        <Badge
                          tone={
                            call.mode === 'LOCAL' ? 'teal' : 'neutral'
                          }
                          mono
                        >
                          {call.mode}
                        </Badge>
                      </td>
                      <td>
                        <Badge tone={TOOL_TONE[call.status]} dot>
                          {call.status}
                        </Badge>
                      </td>
                      <td>{call.durationMs} ms</td>
                      <td>
                        <span className="tool-params mono">
                          {call.params}
                        </span>
                        <span className="tool-output">
                          {call.outputSummary}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>

          <SectionCard
            title="04 · 规则与模型"
            subtitle="规则决定业务状态；ML 只提供辅助信号"
          >
            <div className="rule-model-grid">
              <div className="rule-panel">
                <div className="rule-panel__head">
                  <span className="rule-panel__label">RULE</span>
                  <Badge
                    tone={
                      run.ruleResult.passed === true
                        ? 'success'
                        : run.ruleResult.passed === false
                          ? 'danger'
                          : 'neutral'
                    }
                  >
                    {run.ruleResult.passed === true
                      ? '通过'
                      : run.ruleResult.passed === false
                        ? '未通过'
                        : '无法判定'}
                  </Badge>
                </div>
                <p className="rule-panel__outcome">
                  {run.ruleResult.outcome}
                </p>
                <p className="rule-panel__reason">
                  {run.ruleResult.reason}
                </p>
                <dl className="rule-details">
                  {run.ruleResult.details.map((detail) => (
                    <div
                      key={`${detail.label}-${detail.value}`}
                      className="rule-details__row"
                    >
                      <dt>
                        {detail.label}
                        <RulePassIcon pass={detail.pass} />
                      </dt>
                      <dd>{detail.value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="rule-panel__version mono">
                  {run.ruleResult.ruleId} · {run.ruleResult.version}
                </p>
              </div>

              <div className="model-panel">
                <div className="rule-panel__head">
                  <span className="rule-panel__label">ML</span>
                  <Badge tone="violet" mono>
                    MODEL_OUTPUT
                  </Badge>
                </div>
                {run.mlResult ? (
                  <>
                    <p className="model-panel__output">
                      {run.mlResult.output}
                    </p>
                    <p className="model-panel__task">
                      {run.mlResult.task}
                    </p>
                    <dl className="modal-meta-list">
                      <div>
                        <dt>模型版本</dt>
                        <dd className="mono">
                          {run.mlResult.modelVersion}
                        </dd>
                      </div>
                      <div>
                        <dt>置信说明</dt>
                        <dd>{run.mlResult.confidence}</dd>
                      </div>
                      <div>
                        <dt>执行方式</dt>
                        <dd>
                          {run.mlResult.simulated
                            ? '演示占位输出（未接入真实模型）'
                            : '真实推理'}
                        </dd>
                      </div>
                    </dl>
                    <p className="model-panel__note">
                      {run.mlResult.note}
                    </p>
                  </>
                ) : (
                  <EmptyState
                    title="本运行未使用 ML"
                    description="ML 只在需要辅助信号时参与；不参与的业务链保持为空。"
                    compact
                  />
                )}
              </div>
            </div>
          </SectionCard>

          <SectionCard
            title="05 · 解释（LLM Explain）"
            subtitle="解释文本只读；不得改写 Priority、Event 或 Recovery"
          >
            <div className="explain-panel">
              <div className="explain-panel__head">
                <span>EXPLAIN</span>
                <span className="explain-panel__badges">
                  <Badge tone="violet">{run.llmExplain.mode}</Badge>
                  <Badge tone="neutral" mono>
                    {run.llmExplain.modelVersion}
                  </Badge>
                </span>
              </div>
              <blockquote className="explain-text">
                {run.llmExplain.text}
              </blockquote>
              <div className="explain-based-on">
                <span>引用依据</span>
                <div>
                  {run.llmExplain.basedOn.map((item) => (
                    <span className="evidence-id-chip mono" key={item}>
                      {item}
                    </span>
                  ))}
                </div>
              </div>
              <p className="explain-panel__note">
                解释在运行生成时已固定保存。当前演示使用模板生成，未调用真实 LLM；
                解释文本不具备修改业务状态的权限。
              </p>
            </div>
          </SectionCard>

          <SectionCard
            title="06 · 失败与降级"
            subtitle="记录缺失证据、技术故障及其影响边界"
          >
            {run.failures.length === 0 ? (
              <div className="failure-empty">
                <CheckCircle2 size={18} />
                <div>
                  <strong>未记录关键链路失败</strong>
                  <p>本次运行的工具与证据链路未产生失败记录。</p>
                </div>
              </div>
            ) : (
              <div className="failure-list">
                {run.failures.map((failure) => (
                  <div className="failure-card" key={`${failure.code}-${failure.affectedEvidence}`}>
                    <div className="failure-card__head">
                      <span className="failure-card__icon">
                        <Wrench size={17} />
                      </span>
                      <div>
                        <span className="failure-card__code mono">
                          {failure.code}
                        </span>
                        <h3>{failure.location}</h3>
                      </div>
                      <Badge tone="danger">DEGRADED</Badge>
                    </div>
                    <p className="failure-card__message">{failure.message}</p>
                    <dl className="failure-details">
                      <div>
                        <dt>受影响证据</dt>
                        <dd className="mono">{failure.affectedEvidence}</dd>
                      </div>
                      <div>
                        <dt>影响</dt>
                        <dd>{failure.impact}</dd>
                      </div>
                      <div>
                        <dt>降级方式</dt>
                        <dd>{failure.degradation}</dd>
                      </div>
                    </dl>
                    <div className="failure-facts">
                      <span>未被改写的事实</span>
                      <ul>
                        {failure.unaffectedFacts.map((fact) => (
                          <li key={fact}>{fact}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <div className="run-detail-bottom-links">
            <Link to="/runs" className={buttonClass('secondary', 'md')}>
              返回运行列表
            </Link>
            {event && (
              <Link
                to={`/events/${event.eventId}`}
                className={buttonClass('primary', 'md')}
              >
                查看事件与处置
                <ArrowRight size={15} />
              </Link>
            )}
          </div>
        </div>

        <aside className="run-detail-side">
          <SectionCard title="运行元数据">
            <dl className="info-list">
              <div>
                <dt>run_id</dt>
                <dd className="mono">{run.runId}</dd>
              </div>
              <div>
                <dt>类型</dt>
                <dd>{RUN_KIND_LABELS[run.kind]}</dd>
              </div>
              <div>
                <dt>场景</dt>
                <dd>
                  {run.scenarioId
                    ? `${run.scenarioId} · ${SCENARIO_LABELS[run.scenarioId]}`
                    : '—'}
                </dd>
              </div>
              <div>
                <dt>区域</dt>
                <dd>{zone.name}</dd>
              </div>
              {run.eventId && (
                <div>
                  <dt>事件</dt>
                  <dd>
                    <Link
                      to={`/events/${run.eventId}`}
                      className="table-link mono"
                    >
                      {run.eventId}
                    </Link>
                  </dd>
                </div>
              )}
              {run.actionId && (
                <div>
                  <dt>Action</dt>
                  <dd className="mono">{run.actionId}</dd>
                </div>
              )}
              <div>
                <dt>创建时间</dt>
                <dd>{formatDateTime(run.createdAt)}</dd>
              </div>
              <div>
                <dt>耗时</dt>
                <dd>{formatNumber(run.durationMs)} ms</dd>
              </div>
              <div>
                <dt>总体状态</dt>
                <dd>
                  <Badge
                    tone={
                      runMetaTone === 'success'
                        ? 'success'
                        : runMetaTone === 'warning'
                          ? 'warning'
                          : 'danger'
                    }
                  >
                    {run.status}
                  </Badge>
                </dd>
              </div>
            </dl>
          </SectionCard>

          <SectionCard
            title="版本与可复现性"
            subtitle="保存时可复现的版本组合"
          >
            <dl className="version-list">
              <div>
                <dt>app</dt>
                <dd className="mono">{run.versions.app}</dd>
              </div>
              <div>
                <dt>config</dt>
                <dd className="mono">{run.versions.config}</dd>
              </div>
              <div>
                <dt>data</dt>
                <dd className="mono">{run.versions.data}</dd>
              </div>
              <div>
                <dt>rule</dt>
                <dd className="mono">{run.versions.rule}</dd>
              </div>
              <div>
                <dt>model</dt>
                <dd className="mono">{run.versions.model}</dd>
              </div>
            </dl>
            <p className="version-note">
              固定场景与版本下，规则结果应可重复。当前所有数据仍为本地模拟。
            </p>
          </SectionCard>

          <SectionCard title="关联入口">
            <div className="related-links">
              <Link to={`/history?zone=${run.zoneId}`}>
                历史趋势
                <ArrowRight size={14} />
              </Link>
              <Link to={`/evidence?zone=${run.zoneId}`}>
                证据与知识
                <ArrowRight size={14} />
              </Link>
              {event && (
                <Link to={`/events/${event.eventId}`}>
                  事件详情
                  <ArrowRight size={14} />
                </Link>
              )}
              <Link to="/runs">
                Run Trace 列表
                <ArrowRight size={14} />
              </Link>
            </div>
          </SectionCard>

          <div className="run-source-note">
            <ShieldCheck size={15} />
            <p>
              本快照中的外部工具结果来自固定演示数据；查看历史结果不会触发新的外部请求。
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}
