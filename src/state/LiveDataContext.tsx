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
import {
  CLIENT_ID,
  CONTROL_TOPIC,
  EVENT_TOPIC,
  EVENT_TOPIC_PREFIX,
  EVIDENCE_TOPIC,
  EVIDENCE_TOPIC_PREFIX,
  SENSOR_TOPIC,
  SENSOR_TOPIC_PREFIX,
  getMqttClient,
} from '../services/mqttClient'
import { compressImageToDataUrl } from '../services/imageCompress'
import {
  fetchNanjingWeather,
  type NanjingWeather,
} from '../services/weather'
import type { ActionType, PriorityAssessment, ZoneStatus } from '../data/types'
import { isActiveEventStatus } from '../data/events'
import { getZoneName, ZONES } from '../data/zones'
import { assessZoneAnomaly, type MetricAnomaly } from '../domain/anomaly'
import { ACTION_TYPE_LABELS } from '../domain/constants'
import {
  assessAllZones,
  zoneStatusFromMetrics,
  type PriorityEventInfo,
} from '../domain/priority'
import { useAppStore } from './AppStore'
import { useToast } from './ToastContext'
import {
  appendLivePoint,
  clearLiveHistory,
  loadLiveHistory,
  saveLiveHistory,
  type LivePoint,
} from './liveStore'

export type { LivePoint } from './liveStore'

export interface LiveSensorReading {
  zoneId: string
  pm25: number
  co2: number
  /** 人流密度（人/㎡），与 METRIC_META.crowdDensity 同口径 */
  crowdLevel: number
  status: ZoneStatus
  time: string
  receivedAt: number
}

export type MqttStatus = 'connecting' | 'online' | 'reconnecting' | 'offline'

/**
 * ML 隐患预警：固定规则未达警戒（正常/关注），但轻量 ML（Z-score
 * 滑动窗口）判定 ANOMALY —— 读数虽未超标，却显著偏离近期历史分布，
 * 属于缓慢爬升早期或传感器漂移等潜在风险，需要人工复核。
 */
export interface MlHiddenAlert {
  zoneId: string
  /** z 超过阈值的异常指标明细（可能多个） */
  metrics: MetricAnomaly[]
  /** 各指标 |z| 最大值，用于多区域同时触发时排序 */
  maxAbsZ: number
  /** ML 基线窗口样本数（佐证判定可信度） */
  sampleSize: number
  /** 本次持续偏离的首次检测时间（弹窗展示期间保持不变） */
  detectedAt: number
}

/**
 * ML 隐患干预记录：规则尚未越限（无事件可挂）时登记的轻量 Action，
 * 不进入 AppStore 的 Event/Action 业务状态机，仅保存在当前会话。
 * 登记后持续跟踪该区域：ML verdict 回到 NORMAL → 隐患自动解除；
 * 规则越限（ALERT/CRITICAL）→ 移交常规事件流程，跟踪结束。
 */
export interface MlIntervention {
  id: string
  zoneId: string
  /** 干预动作类型（默认 VENTILATION = 开启新风系统） */
  type: ActionType
  label: string
  actionAt: string
  operator: string
  /** 干预时刻的异常指标快照（z 值等） */
  metrics: MetricAnomaly[]
  maxAbsZ: number
}

export interface WeatherState {
  status: 'LOADING' | 'VALID' | 'TIMEOUT' | 'ERROR'
  data: NanjingWeather | null
  message?: string
}

export interface DispositionPayload {
  zoneId: string
  eventId: string
  type: ActionType
  actionAt: string
  status: 'HANDLING'
  operator: string
  clientId: string
}

/** 人工拍照留档记录（Web 上传 / H5 拍照，经 MQTT 多端同步） */
export interface ManualObservation {
  id: string
  zoneId: string
  observedAt: string
  fileName: string
  /** 压缩后的 JPEG dataURL；图片无法解码时为 null（仅保留元数据，不伪造图片） */
  imageUrl: string | null
  origin: 'WEB' | 'H5'
  operator: string
  clientId: string
  /** true = 通过 MQTT 从其他终端接收 */
  viaMqtt: boolean
}

export interface AddObservationInput {
  zoneId: string
  file: File
  origin: 'WEB' | 'H5'
}

export type AddObservationResult =
  | { ok: true; synced: boolean }
  | { ok: false; message: string }

/** 会话内最多保留的人工观察条数（图片为 dataURL，需控制内存占用） */
const MAX_MANUAL_OBSERVATIONS = 30

/** 忽略公共 Broker 上过大的异常报文（正常压缩图 base64 远低于此值） */
const MAX_EVIDENCE_IMAGE_CHARS = 400_000

interface LiveDataValue {
  mqttStatus: MqttStatus
  readings: Record<string, LiveSensorReading>
  /** 持久化的实时历史序列（localStorage），所有图表与评估的唯一数据源 */
  histories: Record<string, LivePoint[]>
  /** 由实时历史计算的区域优先级 */
  priorities: PriorityAssessment[]
  /**
   * 当前首要关注区域：实时 Priority 排名第一。
   * 与优先级表格使用同一份 assessAllZones 排序结果，保证顶部与列表一致。
   */
  topZoneId: string | null
  weather: WeatherState
  refreshWeather: () => void
  publishDisposition: (zoneId: string, payload: DispositionPayload) => void
  /** 向 airguard/control 发送控制指令（联动演戏：通知模拟器进入恢复模式） */
  publishControl: (payload: Record<string, unknown>) => void
  /** 人工拍照留档（本端上传 + MQTT 接收的其他端记录），仅保存在当前会话 */
  manualObservations: ManualObservation[]
  /** 生成一条人工观察记录：本地入库并经 MQTT 同步压缩图到其他终端 */
  addManualObservation: (
    input: AddObservationInput,
  ) => Promise<AddObservationResult>
  /** 当前待处理的 ML 隐患预警；null = 无。由 MlAlertModal 全局渲染 */
  mlAlert: MlHiddenAlert | null
  /** 关掉预警（忽略 / 前往查看 / 记录干预 / ESC / 点遮罩）：该区域 3 分钟内不再重复弹窗 */
  dismissMlAlert: (zoneId: string) => void
  /** 未解除的 ML 隐患干预记录（轻量 Action，不关联事件，仅当前会话） */
  mlInterventions: MlIntervention[]
  /**
   * 记录一次 ML 隐患干预（默认动作「开启新风系统」）：
   * 关闭弹窗、抑制该区域再弹、经 airguard/control 联动模拟器恢复；
   * Z-score 回落至正常区间后隐患自动解除（toast 通知）。
   */
  recordMlIntervention: (
    zoneId: string,
    metrics: MetricAnomaly[],
    maxAbsZ: number,
  ) => void
  clearLiveData: () => void
}

const LiveDataContext = createContext<LiveDataValue | null>(null)

const WEATHER_REFRESH_MS = 10 * 60 * 1000

/** ML 隐患预警防抖：同一区域被关掉后 3 分钟内不再重复弹窗 */
const ML_ALERT_SNOOZE_MS = 3 * 60 * 1000

/**
 * 设备时间与浏览器时间的最大允许偏差。
 * 超过时仍接收读数（不因设备时钟不准而丢数据），
 * 但事件时间改用接收时间，避免出现 1970 年或隔夜事件。
 */
const SENSOR_CLOCK_SKEW_MS = 10 * 60 * 1000

/** 物理量合理范围：过滤掉损坏报文或公共 Broker 上其他客户端的乱数 */
const SENSOR_LIMITS = {
  pm25: { min: 0, max: 1000 },
  co2: { min: 300, max: 5000 },
  crowdLevel: { min: 0, max: 5 },
}

function isPlausibleReading(pm25: number, co2: number, crowdLevel: number): boolean {
  const within = (value: number, limit: { min: number; max: number }) =>
    value >= limit.min && value <= limit.max
  return (
    within(pm25, SENSOR_LIMITS.pm25) &&
    within(co2, SENSOR_LIMITS.co2) &&
    within(crowdLevel, SENSOR_LIMITS.crowdLevel)
  )
}

function parseSensorMessage(raw: unknown): LiveSensorReading | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  // 兼容常见 MQTT 设备字段命名，避免因下划线/驼峰差异导致整条读数被丢弃。
  const zoneId = record.zoneId ?? record.zone_id ?? record.zone
  const pm25 = Number(record.pm25 ?? record.pm2_5 ?? record['pm2.5'])
  const co2 = Number(record.co2 ?? record.CO2 ?? record.co2_ppm)
  const crowdLevel = Number(
    record.crowdLevel ??
      record.crowd_level ??
      record.crowdDensity ??
      record.crowd_density,
  )
  if (typeof zoneId !== 'string') return null
  if (!ZONES.some((zone) => zone.zoneId === zoneId)) return null
  if (![pm25, co2, crowdLevel].every(Number.isFinite)) return null
  if (!isPlausibleReading(pm25, co2, crowdLevel)) return null

  const receivedAt = Date.now()
  let time = new Date(receivedAt).toISOString()
  if (typeof record.time === 'string') {
    const parsedTime = Date.parse(record.time)
    // 设备时间可信时沿用；偏差过大则仍接收数据，但以接收时间为准。
    if (
      Number.isFinite(parsedTime) &&
      Math.abs(receivedAt - parsedTime) <= SENSOR_CLOCK_SKEW_MS
    ) {
      time = new Date(parsedTime).toISOString()
    }
  }

  return {
    zoneId,
    pm25,
    co2,
    crowdLevel,
    // 不信任报文中的 status：统一按前端阈值从数值重新推导，
    // 避免旧版模拟器或其他客户端发来的过期状态直接触发告警。
    status: zoneStatusFromMetrics({ pm25, co2, crowdDensity: crowdLevel }),
    time,
    receivedAt,
  }
}

function parseDispositionMessage(raw: unknown): DispositionPayload | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  if (typeof record.zoneId !== 'string' || typeof record.type !== 'string') {
    return null
  }
  return {
    zoneId: record.zoneId,
    eventId: typeof record.eventId === 'string' ? record.eventId : '',
    type: record.type as ActionType,
    actionAt:
      typeof record.actionAt === 'string'
        ? record.actionAt
        : new Date().toISOString(),
    status: 'HANDLING',
    operator:
      typeof record.operator === 'string' ? record.operator : '远程终端',
    clientId: typeof record.clientId === 'string' ? record.clientId : '',
  }
}

/** MQTT 人工观察报文（airguard/evidence/<zoneId>） */
interface ObservationMessage {
  id: string
  zoneId: string
  observedAt: string
  fileName: string
  imageUrl: string | null
  origin: 'WEB' | 'H5'
  operator: string
  clientId: string
}

function parseObservationMessage(raw: unknown): ObservationMessage | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  if (record.kind !== 'MANUAL_OBSERVATION') return null
  if (typeof record.id !== 'string' || typeof record.clientId !== 'string') {
    return null
  }
  if (
    typeof record.zoneId !== 'string' ||
    !ZONES.some((zone) => zone.zoneId === record.zoneId)
  ) {
    return null
  }
  // 只接受合法的图片 dataURL，且限制大小：公共 Broker 上任何人都能发消息
  const imageUrl =
    typeof record.imageUrl === 'string' &&
    record.imageUrl.startsWith('data:image/') &&
    record.imageUrl.length <= MAX_EVIDENCE_IMAGE_CHARS
      ? record.imageUrl
      : null
  return {
    id: record.id,
    zoneId: record.zoneId,
    observedAt:
      typeof record.observedAt === 'string'
        ? record.observedAt
        : new Date().toISOString(),
    fileName:
      typeof record.fileName === 'string' && record.fileName
        ? record.fileName
        : '现场照片',
    imageUrl,
    origin: record.origin === 'H5' ? 'H5' : 'WEB',
    operator:
      typeof record.operator === 'string' && record.operator
        ? record.operator
        : '远程终端',
    clientId: record.clientId,
  }
}

export function LiveDataProvider({ children }: { children: ReactNode }) {
  const { state, applyRemoteDisposition, syncReading } = useAppStore()
  const { toast } = useToast()
  const [mqttStatus, setMqttStatus] = useState<MqttStatus>('connecting')
  const [readings, setReadings] = useState<Record<string, LiveSensorReading>>({})
  // 初始化时从 localStorage 恢复历史，刷新页面不丢失
  const [histories, setHistories] = useState<Record<string, LivePoint[]>>(() =>
    loadLiveHistory(),
  )
  const [weather, setWeather] = useState<WeatherState>({
    status: 'LOADING',
    data: null,
  })
  // 人工拍照留档：dataURL 体积大，只存当前会话，不写 localStorage
  const [manualObservations, setManualObservations] = useState<
    ManualObservation[]
  >([])
  // ML 隐患预警：当前展示中的弹窗（全局最多一个）
  const [mlAlert, setMlAlert] = useState<MlHiddenAlert | null>(null)
  // ML 隐患干预台账：仅当前会话，不落 localStorage
  const [mlInterventions, setMlInterventions] = useState<MlIntervention[]>([])
  // 预警防抖表：zoneId → 该时间点之前不再弹窗；用 ref 避免触发重渲染
  const mlAlertSnoozeRef = useRef<Record<string, number>>({})
  // 用 ref 持有最新回调，避免 MQTT 监听因依赖变化反复解绑
  const applyRemoteRef = useRef(applyRemoteDisposition)
  const syncReadingRef = useRef(syncReading)
  const toastRef = useRef(toast)
  useEffect(() => {
    applyRemoteRef.current = applyRemoteDisposition
    syncReadingRef.current = syncReading
    toastRef.current = toast
  })

  // 历史变化时持久化（localStorage），刷新后可恢复
  useEffect(() => {
    saveLiveHistory(histories)
  }, [histories])

  const refreshWeather = useCallback(() => {
    let cancelled = false
    setWeather((previous) =>
      previous.data ? previous : { status: 'LOADING', data: null },
    )
    fetchNanjingWeather()
      .then((result) => {
        if (cancelled) return
        if (result.ok) {
          setWeather({ status: 'VALID', data: result.data })
        } else {
          setWeather({
            status: result.status,
            data: null,
            message: result.message,
          })
        }
      })
      .catch(() => {
        if (!cancelled) {
          setWeather({
            status: 'ERROR',
            data: null,
            message: '高德天气请求发生未知异常。',
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const cancel = refreshWeather()
    const timer = window.setInterval(refreshWeather, WEATHER_REFRESH_MS)
    return () => {
      cancel()
      window.clearInterval(timer)
    }
  }, [refreshWeather])

  useEffect(() => {
    const client = getMqttClient()

    function onConnect() {
      setMqttStatus('online')
      client.subscribe([SENSOR_TOPIC, EVENT_TOPIC, EVIDENCE_TOPIC], (error) => {
        if (error) {
          console.error('[mqtt] subscribe failed:', error.message)
        }
      })
    }
    function onReconnect() {
      setMqttStatus('reconnecting')
    }
    function onClose() {
      setMqttStatus((previous) => (previous === 'online' ? 'reconnecting' : previous))
    }
    function onOffline() {
      setMqttStatus('offline')
    }
    function onMessage(topic: string, payload: Uint8Array) {
      let parsed: unknown
      try {
        parsed = JSON.parse(new TextDecoder().decode(payload))
      } catch {
        return
      }
      if (topic.startsWith(SENSOR_TOPIC_PREFIX)) {
        const reading = parseSensorMessage(parsed)
        if (!reading) return
        setReadings((previous) => ({ ...previous, [reading.zoneId]: reading }))
        setHistories((previous) =>
          appendLivePoint(previous, reading.zoneId, {
            ts: reading.receivedAt,
            pm25: reading.pm25,
            co2: reading.co2,
            crowdLevel: reading.crowdLevel,
          }),
        )
        // 驱动业务状态机：自动建事件、追加 Action 后验样本
        syncReadingRef.current({
          zoneId: reading.zoneId,
          pm25: reading.pm25,
          co2: reading.co2,
          crowdLevel: reading.crowdLevel,
          status: reading.status,
          time: reading.time,
        })
        return
      }
      if (topic.startsWith(EVENT_TOPIC_PREFIX)) {
        const message = parseDispositionMessage(parsed)
        if (!message || message.clientId === CLIENT_ID) return
        const result = applyRemoteRef.current({
          zoneId: message.zoneId,
          eventId: message.eventId || undefined,
          type: message.type,
          actionAt: message.actionAt,
          operator: message.operator,
        })
        if (result.ok) {
          toastRef.current(
            `收到多端同步处置（${message.zoneId} · ${ACTION_TYPE_LABELS[message.type]}），事件已进入处置中。`,
            'info',
          )
        }
        return
      }
      if (topic.startsWith(EVIDENCE_TOPIC_PREFIX)) {
        const message = parseObservationMessage(parsed)
        if (!message || message.clientId === CLIENT_ID) return
        setManualObservations((previous) => {
          // 按 id 去重：QoS 0 下仍可能因重连收到重复报文
          if (previous.some((item) => item.id === message.id)) return previous
          return [...previous, { ...message, viaMqtt: true }].slice(
            -MAX_MANUAL_OBSERVATIONS,
          )
        })
        const zoneName =
          ZONES.find((zone) => zone.zoneId === message.zoneId)?.shortName ??
          message.zoneId
        toastRef.current(
          `收到${message.origin === 'H5' ? ' H5 现场端' : '其他终端'}的人工拍照留档（${zoneName}），已生成「人工观察」证据卡。`,
          'info',
        )
      }
    }

    if (client.connected) onConnect()
    client.on('connect', onConnect)
    client.on('reconnect', onReconnect)
    client.on('close', onClose)
    client.on('offline', onOffline)
    client.on('message', onMessage)

    return () => {
      client.off('connect', onConnect)
      client.off('reconnect', onReconnect)
      client.off('close', onClose)
      client.off('offline', onOffline)
      client.off('message', onMessage)
    }
  }, [])

  const publishDisposition = useCallback(
    (zoneId: string, payload: DispositionPayload) => {
      const client = getMqttClient()
      if (!client.connected) return
      client.publish(
        `${EVENT_TOPIC_PREFIX}${zoneId}`,
        JSON.stringify(payload),
        { qos: 0 },
      )
    },
    [],
  )

  const publishControl = useCallback((payload: Record<string, unknown>) => {
    const client = getMqttClient()
    if (!client.connected) return
    client.publish(CONTROL_TOPIC, JSON.stringify(payload), { qos: 0 })
  }, [])

  const addManualObservation = useCallback(
    async (input: AddObservationInput): Promise<AddObservationResult> => {
      const { zoneId, file, origin } = input
      if (!file.type.startsWith('image/')) {
        return { ok: false, message: '请选择图片文件（image/*）。' }
      }
      let imageUrl: string | null = null
      try {
        imageUrl = await compressImageToDataUrl(file)
      } catch {
        // 浏览器无法解码（如桌面端 HEIC）：仍生成证据元数据，不伪造图片
      }
      const observation: ManualObservation = {
        id: `MO-${Date.now().toString(36)}-${Math.random()
          .toString(36)
          .slice(2, 7)}`,
        zoneId,
        observedAt: new Date().toISOString(),
        fileName: file.name || '现场照片',
        imageUrl,
        origin,
        operator: origin === 'H5' ? 'H5 现场端' : 'Web 工作台',
        clientId: CLIENT_ID,
        viaMqtt: false,
      }
      setManualObservations((previous) =>
        [...previous, observation].slice(-MAX_MANUAL_OBSERVATIONS),
      )
      const client = getMqttClient()
      const synced = client.connected
      if (synced) {
        client.publish(
          `${EVIDENCE_TOPIC_PREFIX}${zoneId}`,
          JSON.stringify({ kind: 'MANUAL_OBSERVATION', ...observation }),
          { qos: 0 },
        )
      }
      return { ok: true, synced }
    },
    [],
  )

  const clearLiveData = useCallback(() => {
    clearLiveHistory()
    setHistories({})
    setReadings({})
    setManualObservations([])
    setMlAlert(null)
    setMlInterventions([])
    mlAlertSnoozeRef.current = {}
  }, [])

  // 未关闭事件参与 Priority：当前数据正常但存在 HANDLING 等事件时，
  // 该区域仍应被顶到高优先级；RECOVERED 历史事件不参与。
  const activeEventsByZone = useMemo(() => {
    const map: Record<string, PriorityEventInfo> = {}
    for (const event of state.events) {
      if (!isActiveEventStatus(event.status)) continue
      map[event.zoneId] = {
        status: event.status,
        title: event.title,
      }
    }
    return map
  }, [state.events])

  // Priority 由 MQTT 实时历史 + 未关闭事件共同计算；无数据的区域得到空评估
  const priorities = useMemo(() => {
    const seriesByZone = Object.fromEntries(
      ZONES.map((zone) => [
        zone.zoneId,
        (histories[zone.zoneId] ?? []).map((point) => ({
          ts: point.ts,
          pm25: point.pm25,
          co2: point.co2,
          crowdDensity: point.crowdLevel,
        })),
      ]),
    )
    return assessAllZones(seriesByZone, activeEventsByZone)
  }, [histories, activeEventsByZone])

  // ── ML 隐患预警与干预跟踪 ─────────────────────────────────────
  // 触发条件严格限定为分歧状态：规则恰好 NORMAL 且 Z-score ML 判定
  // ANOMALY（即仲裁矩阵的 STRICT_UNION）。规则已到 WATCH/ALERT/CRITICAL
  // 的区域不弹此窗 —— 越限走常规事件流（ALERT 起自动建事件）。
  // 干预：recordMlIntervention 登记后该区域停止弹窗并持续跟踪；
  //   ML verdict 回到 NORMAL（Z-score 回落至 ±阈值内）→ 隐患自动解除；
  //   跟踪期间规则越限（ALERT/CRITICAL）→ 主事件流程接管，跟踪结束。
  // 弹窗：全局同时只弹一个（取 |z| 最大者），其余区域等当前弹窗被处理后
  //   在下一轮数据到达时轮候；同一区域被关掉后 3 分钟内防抖不再弹。
  useEffect(() => {
    const now = Date.now()

    // 每个区域只计算一次规则状态 + ML 判定，两个阶段共用
    const scans = ZONES.map((zone) => {
      const history = histories[zone.zoneId]
      const priority = priorities.find((item) => item.zoneId === zone.zoneId)
      // 与 RuleVsMlCard 同口径：无实时数据（factors 为空）时规则侧不参与
      const ruleStatus =
        priority && priority.factors.length > 0 ? priority.zoneStatus : null
      const ml =
        history && history.length > 0
          ? assessZoneAnomaly(zone.zoneId, history)
          : null
      return { zoneId: zone.zoneId, ruleStatus, ml }
    })

    // 阶段一：已登记干预的解除 / 移交判定
    if (mlInterventions.length > 0) {
      const resolved: string[] = []
      const escalated: string[] = []
      for (const item of mlInterventions) {
        const scan = scans.find((entry) => entry.zoneId === item.zoneId)
        if (!scan) continue
        if (scan.ruleStatus === 'ALERT' || scan.ruleStatus === 'CRITICAL') {
          escalated.push(item.zoneId)
        } else if (scan.ml && scan.ml.verdict === 'NORMAL') {
          resolved.push(item.zoneId)
        }
      }
      if (resolved.length > 0 || escalated.length > 0) {
        setMlInterventions((previous) =>
          previous.filter(
            (item) =>
              !resolved.includes(item.zoneId) &&
              !escalated.includes(item.zoneId),
          ),
        )
        for (const zoneId of resolved) {
          toastRef.current(
            `ML 隐患已解除：${getZoneName(zoneId)} Z-score 已回落至正常区间，干预生效。`,
            'success',
          )
        }
        for (const zoneId of escalated) {
          toastRef.current(
            `${getZoneName(zoneId)} 规则已越限，ML 隐患移交常规事件处置流程。`,
            'info',
          )
        }
      }
    }

    // 阶段二：新隐患检测（仅 规则 NORMAL + ML ANOMALY 的分歧状态）
    let candidate: MlHiddenAlert | null = null
    for (const scan of scans) {
      if (scan.ruleStatus !== 'NORMAL') continue
      if (!scan.ml || scan.ml.verdict !== 'ANOMALY') continue
      if ((mlAlertSnoozeRef.current[scan.zoneId] ?? 0) > now) continue
      // 已登记干预的区域在隐患解除前不再弹窗
      if (mlInterventions.some((item) => item.zoneId === scan.zoneId)) continue
      const metrics = scan.ml.metrics.filter((item) => item.anomalous)
      if (metrics.length === 0) continue
      const maxAbsZ = scan.ml.maxAbsZ ?? 0
      if (!candidate || maxAbsZ > candidate.maxAbsZ) {
        candidate = {
          zoneId: scan.zoneId,
          metrics,
          maxAbsZ,
          sampleSize: scan.ml.sampleSize,
          detectedAt: now,
        }
      }
    }
    if (!candidate) return
    const next: MlHiddenAlert = candidate
    setMlAlert((previous) => {
      // 已有其他区域的弹窗在展示时不抢占，等用户处理后再轮候
      if (previous && previous.zoneId !== next.zoneId) return previous
      // 同区域持续偏离：刷新指标读数，但保留首次检测时间
      return previous ? { ...next, detectedAt: previous.detectedAt } : next
    })
  }, [histories, priorities, mlInterventions])

  const dismissMlAlert = useCallback((zoneId: string) => {
    mlAlertSnoozeRef.current[zoneId] = Date.now() + ML_ALERT_SNOOZE_MS
    setMlAlert((previous) =>
      previous && previous.zoneId === zoneId ? null : previous,
    )
  }, [])

  const recordMlIntervention = useCallback(
    (zoneId: string, metrics: MetricAnomaly[], maxAbsZ: number) => {
      const actionAt = new Date().toISOString()
      const intervention: MlIntervention = {
        id: `MLI-${Date.now().toString(36)}-${Math.random()
          .toString(36)
          .slice(2, 7)}`,
        zoneId,
        type: 'VENTILATION',
        label: '开启新风系统',
        actionAt,
        operator: 'Web 工作台',
        metrics,
        maxAbsZ,
      }
      // 同区域重复登记时以最新一次干预为准
      setMlInterventions((previous) => [
        ...previous.filter((item) => item.zoneId !== zoneId),
        intervention,
      ])
      // 关闭弹窗；干预期间由 mlInterventions 抑制再弹，snooze 做双保险
      dismissMlAlert(zoneId)
      // 联动演戏：通知模拟器进入恢复模式，读数平滑回落 → Z-score 回归 → 自动解除
      publishControl({
        action: 'START_RECOVERY',
        zoneId,
        at: actionAt,
        clientId: CLIENT_ID,
        source: 'ML_HIDDEN_ALERT',
      })
    },
    [dismissMlAlert, publishControl],
  )

  // 当前首要关注 = 实时 Priority #1。
  // 顶部关注区与「区域关注优先级」表格始终使用同一份排序结果，
  // 不再额外维护一个可能落后于表格的稳定状态。
  const topZoneId = priorities[0]?.zoneId ?? null

  const value = useMemo<LiveDataValue>(
    () => ({
      mqttStatus,
      readings,
      histories,
      priorities,
      topZoneId,
      weather,
      refreshWeather,
      publishDisposition,
      publishControl,
      manualObservations,
      addManualObservation,
      mlAlert,
      dismissMlAlert,
      mlInterventions,
      recordMlIntervention,
      clearLiveData,
    }),
    [
      mqttStatus,
      readings,
      histories,
      priorities,
      topZoneId,
      weather,
      refreshWeather,
      publishDisposition,
      publishControl,
      manualObservations,
      addManualObservation,
      mlAlert,
      dismissMlAlert,
      mlInterventions,
      recordMlIntervention,
      clearLiveData,
    ],
  )

  return (
    <LiveDataContext.Provider value={value}>
      {children}
    </LiveDataContext.Provider>
  )
}

export function useLiveData(): LiveDataValue {
  const context = useContext(LiveDataContext)
  if (!context) {
    throw new Error('useLiveData 必须在 LiveDataProvider 内使用')
  }
  return context
}
