import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Route,
  Search,
  ShieldCheck,
} from 'lucide-react'
import { PageIntro } from '../components/ui/PageIntro'
import { SectionCard } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { Notice } from '../components/ui/Notice'
import { buttonClass } from '../components/ui/Button'
import {
  Badge,
  RunStatusBadge,
  ScenarioBadge,
} from '../components/ui/Badge'
import { getZone } from '../data/zones'
import {
  RUN_KIND_LABELS,
  SCENARIO_LABELS,
} from '../domain/constants'
import { formatDateTime } from '../domain/format'
import { useAppStore } from '../state/AppStore'
import type { RunStatus } from '../data/types'

type StatusFilter = RunStatus | 'ALL'

const RUN_STATUSES: RunStatus[] = ['SUCCESS', 'PARTIAL', 'FAILED']
const SCENARIO_IDS = ['S1', 'S2', 'S3', 'S4', 'S5']

export function RunsPage() {
  const { state } = useAppStore()
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')
  const [scenarioFilter, setScenarioFilter] = useState('ALL')
  const [query, setQuery] = useState('')

  const runs = useMemo(() => {
    return [...state.runs]
      .filter((run) => {
        if (statusFilter !== 'ALL' && run.status !== statusFilter) return false
        if (
          scenarioFilter !== 'ALL' &&
          run.scenarioId !== scenarioFilter
        ) {
          return false
        }
        const normalized = query.trim().toLowerCase()
        if (normalized) {
          const zoneName = getZone(run.zoneId).name
          const haystack =
            `${run.runId} ${run.eventId ?? ''} ${zoneName} ${run.finalOutput.label} ${run.trigger}`.toLowerCase()
          if (!haystack.includes(normalized)) return false
        }
        return true
      })
      .sort((a, b) => {
        const diff =
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        return diff !== 0 ? diff : b.runId.localeCompare(a.runId)
      })
  }, [state.runs, statusFilter, scenarioFilter, query])

  const failureCount = state.runs.reduce(
    (total, run) => total + run.failures.length,
    0,
  )
  const latestRun = [...state.runs].sort((a, b) =>
    b.runId.localeCompare(a.runId),
  )[0]

  return (
    <div className="page-stack runs-page">
      <PageIntro
        eyebrow="Run Trace / 可回查运行"
        title="Run Trace"
        description="按 run_id 查看输入、证据、工具调用、规则 / ML 输出、解释、失败记录和最终结果。已保存快照不会因打开页面而重新生成。"
        actions={
          <Link className={buttonClass('secondary', 'md')} to="/events">
            返回事件
          </Link>
        }
      />

      <Notice tone="info" title="快照稳定性">
        <p>
          列表与详情直接读取已保存的运行快照，不重新调用 LLM、外部接口或规则引擎。
          重新评估会新增一个 run_id，而不会覆盖历史记录。
        </p>
      </Notice>

      <div className="run-summary-strip">
        <div>
          <span className="run-summary-strip__icon">
            <Route size={17} />
          </span>
          <strong>{state.runs.length}</strong>
          <span>运行快照</span>
        </div>
        <div>
          <span className="status-dot status-dot--green" />
          <strong>
            {state.runs.filter((run) => run.status === 'SUCCESS').length}
          </strong>
          <span>成功</span>
        </div>
        <div>
          <span className="status-dot status-dot--amber" />
          <strong>
            {state.runs.filter((run) => run.status === 'PARTIAL').length}
          </strong>
          <span>部分降级</span>
        </div>
        <div>
          <span className="status-dot status-dot--red" />
          <strong>{failureCount}</strong>
          <span>失败 / 缺失记录</span>
        </div>
        <div>
          <span className="status-dot status-dot--violet" />
          <strong className="mono">{latestRun?.runId ?? '—'}</strong>
          <span>最新快照</span>
        </div>
      </div>

      <SectionCard
        title="全部运行记录"
        subtitle="Priority / Event / Recovery 运行快照，按时间倒序排列"
        action={<span className="card-meta">{runs.length} 条结果</span>}
      >
        <div className="list-toolbar">
          <div className="segmented" role="group" aria-label="运行状态筛选">
            <button
              type="button"
              className={
                statusFilter === 'ALL'
                  ? 'segmented__item segmented__item--active'
                  : 'segmented__item'
              }
              onClick={() => setStatusFilter('ALL')}
            >
              全部状态
            </button>
            {RUN_STATUSES.map((status) => (
              <button
                type="button"
                key={status}
                className={
                  statusFilter === status
                    ? 'segmented__item segmented__item--active'
                    : 'segmented__item'
                }
                onClick={() => setStatusFilter(status)}
              >
                {status === 'SUCCESS'
                  ? '成功'
                  : status === 'PARTIAL'
                    ? '部分降级'
                    : '失败'}
              </button>
            ))}
          </div>
          <div className="toolbar-spacer" />
          <label className="select-field">
            <span>场景</span>
            <select
              value={scenarioFilter}
              onChange={(event) => setScenarioFilter(event.target.value)}
            >
              <option value="ALL">全部场景</option>
              {SCENARIO_IDS.map((scenarioId) => (
                <option value={scenarioId} key={scenarioId}>
                  {scenarioId} · {SCENARIO_LABELS[scenarioId]}
                </option>
              ))}
            </select>
          </label>
          <label className="search-field">
            <Search size={15} />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索 run_id / 事件 / 区域"
              aria-label="搜索 Run Trace"
            />
          </label>
        </div>

        {runs.length === 0 ? (
          <EmptyState
            title="没有匹配的运行记录"
            description="调整状态、场景或搜索条件后再试。"
            action={
              <button
                type="button"
                className={buttonClass('secondary', 'sm')}
                onClick={() => {
                  setStatusFilter('ALL')
                  setScenarioFilter('ALL')
                  setQuery('')
                }}
              >
                清除筛选
              </button>
            }
          />
        ) : (
          <>
            <p className="scroll-hint">表格可左右滑动查看完整列</p>
            <div className="table-wrap">
              <table className="data-table run-table">
              <thead>
                <tr>
                  <th>run_id</th>
                  <th>场景</th>
                  <th>类型</th>
                  <th>区域 / 事件</th>
                  <th>最终输出</th>
                  <th>状态</th>
                  <th>执行模式</th>
                  <th>时间</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.runId}>
                    <td>
                      <Link
                        className="mono table-link"
                        to={`/runs/${run.runId}`}
                      >
                        {run.runId}
                      </Link>
                    </td>
                    <td>
                      {run.scenarioId ? (
                        <ScenarioBadge
                          scenarioId={run.scenarioId}
                          label={SCENARIO_LABELS[run.scenarioId]}
                        />
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>{RUN_KIND_LABELS[run.kind]}</td>
                    <td>
                      <span className="run-table__zone">
                        {getZone(run.zoneId).shortName}
                      </span>
                      {run.eventId && (
                        <Link
                          to={`/events/${run.eventId}`}
                          className="mono table-sub-link"
                        >
                          {run.eventId}
                        </Link>
                      )}
                    </td>
                    <td>
                      <span className="run-table__output">
                        {run.finalOutput.label}
                      </span>
                    </td>
                    <td>
                      <RunStatusBadge status={run.status} />
                    </td>
                    <td>
                      <Badge tone="neutral">
                        {run.executionMode === 'SEEDED_DEMO'
                          ? '种子快照'
                          : '本地执行'}
                      </Badge>
                    </td>
                    <td>
                      <span className="table-date">
                        {formatDateTime(run.createdAt)}
                      </span>
                    </td>
                    <td>
                      <Link
                        to={`/runs/${run.runId}`}
                        className="table-row-link"
                        aria-label={`查看 ${run.runId}`}
                      >
                        查看
                        <ArrowRight size={14} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </SectionCard>

      <div className="run-footnote">
        <ShieldCheck size={15} />
        <span>
          Run Trace 中的外部工具调用为演示快照；本地重新评估仅使用浏览器内规则与模拟数据。
        </span>
      </div>
    </div>
  )
}
