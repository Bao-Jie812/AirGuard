import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type {
  ActionBaseline,
  ActionRecord,
  ActionType,
  EnvironmentEvent,
  EventEvidencePhoto,
  EventStatus,
  RecoveryEvaluation,
  RecoverySample,
  StoreState,
} from '../data/types'
import { getCleanState } from '../data/seed'
import { isActiveEventStatus } from '../data/events'
import {
  ACTION_TYPE_LABELS,
  METRIC_META,
  STORAGE_KEY,
  ZONE_STATUS_LABELS,
} from '../domain/constants'
import {
  evaluateRecovery,
  getLatestActionForEvent,
} from '../domain/recovery'
import { metricSeverity } from '../domain/priority'
import { createRecoveryRun } from '../data/runs'
import { getZone } from '../data/zones'

interface RecordActionInput {
  type: ActionType
  title: string
  note: string
  operator: string
  /** 不填时使用当前真实时间 */
  at?: string
}

export interface RemoteDispositionInput {
  zoneId: string
  eventId?: string
  type: ActionType
  actionAt: string
  operator: string
}

/** MQTT 实时读数（AppStore 用于触发事件与后验样本） */
export interface ReadingInput {
  zoneId: string
  pm25: number
  co2: number
  crowdLevel: number
  status: 'NORMAL' | 'WATCH' | 'ALERT' | 'CRITICAL'
  time: string
}

type ReadingSnapshot = Omit<ActionBaseline, 'source'>

/** 记录 Action 时取该区域最近一条 MQTT 读数作为前置快照 */
function actionBaselineFrom(
  readings: Record<string, ReadingSnapshot | undefined>,
  zoneId: string,
): ActionBaseline | undefined {
  const snapshot = readings[zoneId]
  return snapshot ? { ...snapshot, source: 'LIVE_READING' } : undefined
}

export type RecordActionResult =
  | { ok: true; actionId: string; actionAt: string }
  | { ok: false; message: string }

export type ReEvaluateResult =
  | {
      ok: true
      runId: string
      outcomeStatus: EventStatus
      reason: string
      evaluation: RecoveryEvaluation
    }
  | { ok: false; message: string }

/**
 * 人工核实证据挂载入参。
 * eventId 来自上报终端本地的事件库 —— 两端事件库独立（各自按 MQTT 读数
 * 自动建事件），跨端 eventId 不一定对得上，因此匹配策略为：
 * eventId 精确匹配 → 该区域未关闭事件兜底 → 都没有则失败（仅全局留档）。
 */
export interface AppendEventEvidenceInput {
  eventId?: string
  zoneId: string
  photo: EventEvidencePhoto
}

export type AppendEventEvidenceResult =
  | { ok: true; eventId: string }
  | { ok: false; message: string }

/** 每事件最多保留的人工核实照片数（压缩图 dataURL 随状态持久化，需控体积） */
const EVENT_EVIDENCE_PHOTO_MAX = 3

interface AppStoreValue {
  state: StoreState
  activeEventCount: number
  recordAction: (
    eventId: string,
    input: RecordActionInput,
  ) => RecordActionResult
  applyRemoteDisposition: (
    input: RemoteDispositionInput,
  ) => RecordActionResult
  /** 把现场取证照片挂入事件 evidencePhotos（本端上传或 MQTT 接收共用） */
  appendEventEvidence: (
    input: AppendEventEvidenceInput,
  ) => AppendEventEvidenceResult
  syncReading: (reading: ReadingInput) => void
  reEvaluateEvent: (eventId: string) => ReEvaluateResult
  resetDemoData: () => void
}

const AppStoreContext = createContext<AppStoreValue | null>(null)

/**
 * 演示基线：每次启动都覆盖旧业务快照，避免测试事件在刷新后继续累积。
 * 当前会话内的新事件仍正常写入 localStorage，但不会被下一次启动恢复。
 */
function loadState(): StoreState {
  const initialState = getCleanState()
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(initialState))
  } catch {
    // 存储不可用时仍可使用内存中的干净种子状态。
  }
  return initialState
}

function dateStamp(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

function nextId(items: { id: string }[], prefix: string): string {
  const max = items.reduce((current, item) => {
    if (!item.id.startsWith(prefix)) return current
    const suffix = Number(item.id.slice(prefix.length))
    return Number.isFinite(suffix) ? Math.max(current, suffix) : current
  }, 0)
  return `${prefix}${String(max + 1).padStart(3, '0')}`
}

function nextActionId(actions: ActionRecord[]): string {
  return nextId(
    actions.map((action) => ({ id: action.actionId })),
    `ACT-${dateStamp()}-`,
  )
}

function nextEventId(events: EnvironmentEvent[]): string {
  return nextId(
    events.map((event) => ({ id: event.eventId })),
    `EVT-${dateStamp()}-`,
  )
}

function nextRunId(runs: StoreState['runs']): string {
  return nextId(
    runs.map((run) => ({ id: run.runId })),
    `RUN-${dateStamp()}-`,
  )
}

function eventWithStatus(
  event: EnvironmentEvent,
  status: EventStatus,
  reason: string,
  at: string,
  runId?: string,
  closedAt?: string,
): EnvironmentEvent {
  return {
    ...event,
    status,
    closedAt:
      status === 'RECOVERED' ? (closedAt ?? event.closedAt ?? at) : undefined,
    statusHistory: [...event.statusHistory, { at, status, reason, runId }],
  }
}

function readingMetric(
  reading: ReadingInput,
  metric: 'pm25' | 'co2' | 'crowdDensity',
): number {
  if (metric === 'pm25') return reading.pm25
  if (metric === 'co2') return reading.co2
  return reading.crowdLevel
}

/** 由 MQTT 实时读数构建 OPEN 事件（阈值取各指标关注线） */
function buildEventFromReading(
  reading: ReadingInput,
  events: EnvironmentEvent[],
): EnvironmentEvent {
  const zone = getZone(reading.zoneId)
  const worstMetric = (['pm25', 'co2', 'crowdDensity'] as const).reduce(
    (best, metric) =>
      metricSeverity(metric, readingMetric(reading, metric)) >
      metricSeverity(best, readingMetric(reading, best))
        ? metric
        : best,
    'pm25' as const,
  )
  const meta = METRIC_META[worstMetric]
  const statusLabel = ZONE_STATUS_LABELS[reading.status]
  return {
    eventId: nextEventId(events),
    zoneId: reading.zoneId,
    title: `${zone.shortName}${meta.shortLabel}达${statusLabel}水平`,
    description: `MQTT 实时监测触发：${zone.name} ${meta.label} ${readingMetric(reading, worstMetric)} ${meta.unit}，区域状态 ${reading.status}。事件由实时数据自动创建。`,
    severity: reading.status === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
    status: 'OPEN',
    openedAt: reading.time,
    scenarioId: null,
    primaryMetric: worstMetric,
    thresholds: {
      pm25: METRIC_META.pm25.alert,
      co2: METRIC_META.co2.alert,
      crowdDensity: METRIC_META.crowdDensity.alert,
      consecutiveSamples: 2,
    },
    limitations: [],
    statusHistory: [
      {
        at: reading.time,
        status: 'OPEN',
        reason: `MQTT 实时数据触发：${meta.shortLabel} 达${statusLabel}水平，自动创建事件。`,
      },
    ],
  }
}

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StoreState>(() => loadState())
  // 每条 MQTT 读数都会更新；recordAction 时用它生成 Action 前快照。
  // 快照随 ActionRecord 一起持久化，MQTT 断线后仍可计算前后差值。
  const latestReadingsRef = useRef<
    Record<string, ReadingSnapshot | undefined>
  >({})

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // Local storage can be unavailable; the prototype still works in memory.
    }
  }, [state])

  const recordAction = useCallback(
    (eventId: string, input: RecordActionInput): RecordActionResult => {
      const event = state.events.find((item) => item.eventId === eventId)
      if (!event) return { ok: false, message: '未找到对应事件。' }
      if (event.status === 'RECOVERED') {
        return {
          ok: false,
          message: '该事件已恢复，不允许向已恢复事件追加 Action。',
        }
      }
      const title = input.title.trim()
      if (!title) return { ok: false, message: '请填写 Action 标题。' }

      const at = input.at ?? new Date().toISOString()
      const actionId = nextActionId(state.actions)
      const action: ActionRecord = {
        actionId,
        eventId,
        zoneId: event.zoneId,
        type: input.type,
        title,
        note: input.note.trim(),
        operator: input.operator.trim() || '现场值班组',
        actionAt: at,
        createdAt: at,
        executionMode: 'LOCAL_DEMO',
        baseline: actionBaselineFrom(latestReadingsRef.current, event.zoneId),
      }

      const updated = eventWithStatus(
        event,
        'HANDLING',
        `记录 Action ${actionId}：${title}。Action 完成只表示处置已登记，不代表事件恢复。`,
        at,
      )

      setState((previous) => ({
        ...previous,
        actions: [...previous.actions, action],
        events: previous.events.map((item) =>
          item.eventId === eventId ? updated : item,
        ),
      }))

      return { ok: true, actionId, actionAt: at }
    },
    [state],
  )

  const applyRemoteDisposition = useCallback(
    (input: RemoteDispositionInput): RecordActionResult => {
      const event =
        state.events.find(
          (item) =>
            item.eventId === input.eventId && item.status !== 'RECOVERED',
        ) ??
        state.events.find(
          (item) => item.zoneId === input.zoneId && item.status === 'OPEN',
        ) ??
        state.events.find(
          (item) =>
            item.zoneId === input.zoneId && item.status !== 'RECOVERED',
        )
      if (!event) {
        return { ok: false, message: '该区域当前没有可同步的未关闭事件。' }
      }

      const actionId = nextActionId(state.actions)
      const action: ActionRecord = {
        actionId,
        eventId: event.eventId,
        zoneId: event.zoneId,
        type: input.type,
        title: `多端同步处置：${ACTION_TYPE_LABELS[input.type]}`,
        note: '由其他终端通过 MQTT 同步的处置动作。',
        operator: input.operator,
        actionAt: input.actionAt,
        createdAt: input.actionAt,
        executionMode: 'LOCAL_DEMO',
        baseline: actionBaselineFrom(latestReadingsRef.current, event.zoneId),
      }

      const updated = eventWithStatus(
        event,
        'HANDLING',
        `收到 MQTT 同步处置（${actionId}），事件进入处置中。`,
        input.actionAt,
      )

      setState((previous) => ({
        ...previous,
        actions: [...previous.actions, action],
        events: previous.events.map((item) =>
          item.eventId === event.eventId ? updated : item,
        ),
      }))

      return { ok: true, actionId, actionAt: input.actionAt }
    },
    [state],
  )

  /**
   * 人工核实证据挂载：现场取证照片（H5 拍照 / Web 上传，含 MQTT 多端同步）
   * 追加到事件 evidencePhotos。不改动事件状态 —— 照片是佐证材料，
   * Recovery 判定仍只依据 Action 后的业务数据。
   */
  const appendEventEvidence = useCallback(
    (input: AppendEventEvidenceInput): AppendEventEvidenceResult => {
      const event =
        (input.eventId
          ? state.events.find((item) => item.eventId === input.eventId)
          : undefined) ??
        state.events.find(
          (item) =>
            item.zoneId === input.zoneId && isActiveEventStatus(item.status),
        )
      if (!event) {
        return {
          ok: false,
          message: '该区域当前没有未关闭事件，照片仅作全局留档。',
        }
      }
      // 幂等：QoS 1 重发 / 离线补发可能重复到达，同 id 照片不重复挂载
      if ((event.evidencePhotos ?? []).some((p) => p.id === input.photo.id)) {
        return { ok: true, eventId: event.eventId }
      }
      setState((previous) => ({
        ...previous,
        events: previous.events.map((item) => {
          if (item.eventId !== event.eventId) return item
          // 函数式更新内再查一次：连续快速到达时闭包里的 event 可能过期
          if ((item.evidencePhotos ?? []).some((p) => p.id === input.photo.id)) {
            return item
          }
          return {
            ...item,
            evidencePhotos: [
              ...(item.evidencePhotos ?? []),
              input.photo,
            ].slice(-EVENT_EVIDENCE_PHOTO_MAX),
          }
        }),
      }))
      return { ok: true, eventId: event.eventId }
    },
    [state],
  )

  /**
   * 每条 MQTT 实时读数驱动业务状态：
   * 1. 区域达 ALERT / CRITICAL 且无未关闭事件 → 自动创建 OPEN 事件；
   * 2. 处置中（HANDLING / STILL_HANDLING）的事件 → 追加真实后验样本，
   *    供 Recovery 重新评估使用。
   */
  const syncReading = useCallback((reading: ReadingInput) => {
    latestReadingsRef.current[reading.zoneId] = {
      ts: new Date(reading.time).getTime(),
      pm25: reading.pm25,
      co2: reading.co2,
      crowdDensity: reading.crowdLevel,
    }
    setState((previous) => {
      let next = previous

      if (reading.status === 'ALERT' || reading.status === 'CRITICAL') {
        const hasActive = next.events.some(
          (event) =>
            event.zoneId === reading.zoneId && event.status !== 'RECOVERED',
        )
        if (!hasActive) {
          next = {
            ...next,
            events: [...next.events, buildEventFromReading(reading, next.events)],
          }
        }
      }

      const handling = next.events.filter(
        (event) =>
          event.zoneId === reading.zoneId &&
          (event.status === 'HANDLING' ||
            event.status === 'STILL_HANDLING' ||
            event.status === 'INSUFFICIENT_EVIDENCE'),
      )
      if (handling.length === 0) return next

      const readingTs = new Date(reading.time).getTime()
      const newSamples: RecoverySample[] = []
      for (const event of handling) {
        const action = getLatestActionForEvent(event.eventId, next.actions)
        if (!action) continue
        if (readingTs <= new Date(action.actionAt).getTime()) continue
        const duplicated = next.recoverySamples.some(
          (sample) =>
            sample.eventId === event.eventId &&
            sample.timestamp === reading.time,
        )
        if (duplicated) continue
        newSamples.push({
          sampleId: `SMP-${event.eventId}-${readingTs}`,
          eventId: event.eventId,
          actionId: action.actionId,
          timestamp: reading.time,
          pm25: reading.pm25,
          co2: reading.co2,
          crowdDensity: reading.crowdLevel,
          source: 'SIMULATED',
          quality: 'VALID',
          note: 'MQTT 实时后验样本',
        })
      }
      if (newSamples.length === 0) return next

      const nextSamples = [...next.recoverySamples, ...newSamples].slice(-300)

      // 自动恢复状态机：每条新样本入库后立即运行恢复规则。
      // 连续 consecutiveSamples（2）组全部达标 → RECOVERED；
      // 中间出现任何异常样本 → 连续计数自动清零，保持 HANDLING。
      let nextEvents = next.events
      for (const event of handling) {
        const evaluation = evaluateRecovery(
          event,
          next.actions,
          nextSamples,
          reading.time,
        )
        if (
          evaluation.outcomeStatus === 'RECOVERED' &&
          event.status !== 'RECOVERED'
        ) {
          const updated = eventWithStatus(
            event,
            'RECOVERED',
            evaluation.reason,
            reading.time,
            undefined,
            evaluation.recoveredAt ?? reading.time,
          )
          nextEvents = nextEvents.map((item) =>
            item.eventId === event.eventId ? updated : item,
          )
        }
      }

      return {
        ...next,
        events: nextEvents,
        recoverySamples: nextSamples,
      }
    })
  }, [])

  const reEvaluateEvent = useCallback(
    (eventId: string): ReEvaluateResult => {
      const now = new Date().toISOString()
      const event = state.events.find((item) => item.eventId === eventId)
      if (!event) return { ok: false, message: '未找到对应事件。' }
      const action = getLatestActionForEvent(eventId, state.actions)
      if (!action) {
        return {
          ok: false,
          message: '事件尚无 Action。Recovery 必须在 Action 之后重新评估。',
        }
      }

      const evaluation = evaluateRecovery(
        event,
        state.actions,
        state.recoverySamples,
        now,
      )
      const runId = nextRunId(state.runs)
      const run = createRecoveryRun({
        runId,
        event,
        action,
        evaluation,
        createdAt: now,
      })
      const updated = eventWithStatus(
        event,
        evaluation.outcomeStatus,
        evaluation.reason,
        now,
        runId,
        evaluation.recoveredAt ?? undefined,
      )

      setState((previous) => ({
        ...previous,
        runs: [...previous.runs, run],
        events: previous.events.map((item) =>
          item.eventId === eventId ? updated : item,
        ),
      }))

      return {
        ok: true,
        runId,
        outcomeStatus: evaluation.outcomeStatus,
        reason: evaluation.reason,
        evaluation,
      }
    },
    [state],
  )

  // 一键清空历史记录：丢弃测试累积的事件 / Action / Run Trace，
  // 回到只保留 2 条已恢复示例的干净初始态（供重新录制演示）
  const resetDemoData = useCallback(() => {
    setState(getCleanState())
  }, [])

  const activeEventCount = state.events.filter(
    (event) => event.status !== 'RECOVERED',
  ).length

  const value: AppStoreValue = useMemo(
    () => ({
      state,
      activeEventCount,
      recordAction,
      applyRemoteDisposition,
      appendEventEvidence,
      syncReading,
      reEvaluateEvent,
      resetDemoData,
    }),
    [
      state,
      activeEventCount,
      recordAction,
      applyRemoteDisposition,
      appendEventEvidence,
      syncReading,
      reEvaluateEvent,
      resetDemoData,
    ],
  )

  return (
    <AppStoreContext.Provider value={value}>
      {children}
    </AppStoreContext.Provider>
  )
}

export function useAppStore(): AppStoreValue {
  const context = useContext(AppStoreContext)
  if (!context) {
    throw new Error('useAppStore must be used inside AppStoreProvider')
  }
  return context
}
