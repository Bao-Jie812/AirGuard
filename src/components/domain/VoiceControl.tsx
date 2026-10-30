import { useEffect, useRef, useState } from 'react'
import { Mic } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { ActionType } from '../../data/types'
import { getZone } from '../../data/zones'
import { CLIENT_ID } from '../../services/mqttClient'
import { useAppStore } from '../../state/AppStore'
import { useLiveData } from '../../state/LiveDataContext'
import { useSelectedZone } from '../../state/SelectedZone'
import { getActiveEventForZone } from '../../state/selectors'
import { useToast } from '../../state/ToastContext'

/** TypeScript DOM 类型尚未覆盖 SpeechRecognition，这里仅声明用到的原生接口。 */
interface VoiceRecognitionResult {
  readonly 0: { readonly transcript: string }
}

interface VoiceRecognitionEvent {
  readonly resultIndex: number
  readonly results: {
    readonly length: number
    readonly [index: number]: VoiceRecognitionResult
  }
}

interface VoiceRecognitionErrorEvent {
  readonly error: string
}

interface VoiceRecognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onstart: (() => void) | null
  onend: (() => void) | null
  onresult: ((event: VoiceRecognitionEvent) => void) | null
  onerror: ((event: VoiceRecognitionErrorEvent) => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type VoiceRecognitionConstructor = new () => VoiceRecognition

type VoiceIntent =
  | { type: 'SWITCH_ZONE'; zoneId: string }
  | { type: 'QUERY_PRIORITY' }
  | {
      type: 'DISPOSE'
      zoneId: string | null
      actionType: ActionType
      actionLabel: string
    }
  | { type: 'OPEN_REPORT' }

interface IntentExecutionResult {
  ok: boolean
  response: string
}

interface VoiceControlProps {
  /** 复用 Topbar 的 TTS，避免状态播报和指令反馈同时播放。 */
  onSpeak: (text: string) => void
  /** 开始聆听前停止当前 TTS，避免识别到应用自己的声音。 */
  onBeforeListen: () => void
}

const ZONE_COMMANDS = [
  { zoneId: 'zone-s', keywords: ['教学区', '教学'] },
  { zoneId: 'zone-w', keywords: ['食堂'] },
  { zoneId: 'zone-n', keywords: ['宿舍'] },
] as const

const PRIORITY_QUERY_KEYWORDS = ['最危险', '先看哪里', '重点']
const REPORT_KEYWORDS = ['离线报告', '历史报告']
const ACTION_COMMANDS: Array<{
  actionType: ActionType
  actionLabel: string
  keywords: string[]
}> = [
  {
    actionType: 'VENTILATION',
    actionLabel: '开启排风',
    keywords: ['开启排风'],
  },
  {
    actionType: 'WINDOW_OPEN',
    actionLabel: '开窗通风',
    keywords: ['开窗通风'],
  },
]

const VOICE_ERROR_MESSAGES: Record<string, string> = {
  'not-allowed': '麦克风权限被拒绝，请在浏览器中允许麦克风访问。',
  'service-not-allowed': '语音识别服务不可用，请检查浏览器权限设置。',
  'audio-capture': '未检测到可用麦克风，请检查设备连接。',
  'no-speech': '没有听到语音，请点击麦克风后重试。',
  network: '语音识别服务连接失败，请检查网络后重试。',
}

const ACKNOWLEDGEMENT = '收到指令，正在为您执行。'
const UNKNOWN_COMMAND_RESPONSE = '抱歉，请再说一遍。'

function getVoiceRecognitionConstructor(): VoiceRecognitionConstructor | null {
  const speechWindow = window as unknown as {
    SpeechRecognition?: VoiceRecognitionConstructor
    webkitSpeechRecognition?: VoiceRecognitionConstructor
  }
  return (
    speechWindow.SpeechRecognition ??
    speechWindow.webkitSpeechRecognition ??
    null
  )
}

function matchZone(text: string): (typeof ZONE_COMMANDS)[number] | undefined {
  return ZONE_COMMANDS.find((command) =>
    command.keywords.some((keyword) => text.includes(keyword)),
  )
}

/**
 * 轻量意图匹配：先识别明确动作，再处理查询与场景切换。
 * 因此「食堂开启排风」会执行处置，而不会仅切换到食堂。
 */
function matchIntent(transcript: string): VoiceIntent | null {
  const text = transcript.replace(/\s+/g, '')
  if (REPORT_KEYWORDS.some((keyword) => text.includes(keyword))) {
    return { type: 'OPEN_REPORT' }
  }

  const action = ACTION_COMMANDS.find((command) =>
    command.keywords.some((keyword) => text.includes(keyword)),
  )
  if (action) {
    return {
      type: 'DISPOSE',
      zoneId: matchZone(text)?.zoneId ?? null,
      actionType: action.actionType,
      actionLabel: action.actionLabel,
    }
  }

  if (PRIORITY_QUERY_KEYWORDS.some((keyword) => text.includes(keyword))) {
    return { type: 'QUERY_PRIORITY' }
  }

  const zone = matchZone(text)
  if (zone) return { type: 'SWITCH_ZONE', zoneId: zone.zoneId }
  return null
}

export function VoiceControl({ onSpeak, onBeforeListen }: VoiceControlProps) {
  const navigate = useNavigate()
  const { state, recordAction } = useAppStore()
  const {
    priorities,
    publishDisposition,
    publishControl,
    mqttStatus,
  } = useLiveData()
  const { selectedZoneId, setSelectedZoneId } = useSelectedZone()
  const { toast } = useToast()
  const [listening, setListening] = useState(false)
  const recognitionRef = useRef<VoiceRecognition | null>(null)
  const onSpeakRef = useRef(onSpeak)
  const executeIntentRef = useRef<
    (intent: VoiceIntent) => IntentExecutionResult
  >(() => ({ ok: false, response: '语音控制尚未就绪，请重试。' }))

  useEffect(() => {
    return () => {
      const recognition = recognitionRef.current
      if (!recognition) return
      recognition.onstart = null
      recognition.onend = null
      recognition.onresult = null
      recognition.onerror = null
      recognition.abort()
      recognitionRef.current = null
    }
  }, [])

  function executeIntent(intent: VoiceIntent): IntentExecutionResult {
    if (intent.type === 'SWITCH_ZONE') {
      const zone = getZone(intent.zoneId)
      setSelectedZoneId(intent.zoneId)
      navigate(`/map?zone=${intent.zoneId}`)
      toast(`语音控制：已切换至${zone.shortName}。`, 'success')
      return { ok: true, response: ACKNOWLEDGEMENT }
    }

    if (intent.type === 'QUERY_PRIORITY') {
      const leading = priorities[0]
      if (!leading || leading.factors.length === 0) {
        const message = '暂无足够的实时数据计算 Priority，请稍后重试。'
        toast(message, 'warning')
        return { ok: false, response: message }
      }
      const zone = getZone(leading.zoneId)
      const reasons = [...leading.factors]
        .filter((factor) => factor.contribution > 0)
        .sort((a, b) => b.contribution - a.contribution)
        .slice(0, 2)
        .map((factor) => factor.detail)
      const reason = reasons.length > 0 ? reasons.join('；') : leading.summary
      setSelectedZoneId(leading.zoneId)
      navigate(`/overview?zone=${leading.zoneId}`)
      toast(`已定位 Priority #1：${zone.shortName}。`, 'info')
      return {
        ok: true,
        response:
          `${ACKNOWLEDGEMENT}当前 Priority 第一的区域是${zone.name}，` +
          `优先级评分 ${leading.score} 分。主要原因：${reason}`,
      }
    }

    if (intent.type === 'DISPOSE') {
      const zoneId = intent.zoneId ?? selectedZoneId
      const zone = getZone(zoneId)
      const activeEvent = getActiveEventForZone(state, zoneId)
      if (!activeEvent) {
        const message = `${zone.shortName}当前没有未关闭事件，无法登记处置 Action。`
        toast(message, 'warning')
        return { ok: false, response: message }
      }

      const actionAt = new Date().toISOString()
      const operator = 'Web 语音控制'
      const result = recordAction(activeEvent.eventId, {
        type: intent.actionType,
        title: `语音处置：${intent.actionLabel}`,
        note: '通过 Web 顶部语音控制下发。',
        operator,
        at: actionAt,
      })
      if (!result.ok) {
        toast(result.message, 'warning')
        return { ok: false, response: result.message }
      }

      publishDisposition(zoneId, {
        zoneId,
        eventId: activeEvent.eventId,
        type: intent.actionType,
        actionAt,
        status: 'HANDLING',
        operator,
        clientId: CLIENT_ID,
      })
      publishControl({
        action: 'START_RECOVERY',
        zoneId,
        eventId: activeEvent.eventId,
        at: actionAt,
        clientId: CLIENT_ID,
      })
      setSelectedZoneId(zoneId)
      toast(
        mqttStatus === 'online'
          ? `${zone.shortName}已执行「${intent.actionLabel}」，事件进入处置中并通过 MQTT 同步。`
          : `${zone.shortName}已执行「${intent.actionLabel}」，事件进入处置中；MQTT 离线，暂未同步。`,
        'success',
      )
      return { ok: true, response: ACKNOWLEDGEMENT }
    }

    const reportWindow = window.open('/report.html', '_blank')
    if (reportWindow) reportWindow.opener = null
    else {
      const message = '报告页面被浏览器拦截，请允许弹出窗口后重试。'
      toast(message, 'warning')
      return { ok: false, response: message }
    }
    toast('已打开离线报告页面。', 'success')
    return { ok: true, response: ACKNOWLEDGEMENT }
  }

  // ASR 回调只注册一次，但每次识别都执行最新的业务状态与 TTS 回调。
  useEffect(() => {
    onSpeakRef.current = onSpeak
    executeIntentRef.current = executeIntent
  })

  function handleVoiceControl() {
    const activeRecognition = recognitionRef.current
    if (activeRecognition) {
      activeRecognition.stop()
      return
    }

    const Recognition = getVoiceRecognitionConstructor()
    if (!Recognition) {
      toast('当前浏览器不支持语音识别，请使用最新版 Chrome 或 Edge。', 'warning')
      return
    }

    onBeforeListen()
    const recognition = new Recognition()
    recognition.lang = 'zh-CN'
    recognition.continuous = false
    recognition.interimResults = false
    recognition.maxAlternatives = 1
    recognition.onstart = () => setListening(true)
    recognition.onend = () => {
      setListening(false)
      if (recognitionRef.current === recognition) recognitionRef.current = null
    }
    recognition.onerror = (event) => {
      setListening(false)
      if (event.error === 'aborted') return
      toast(
        VOICE_ERROR_MESSAGES[event.error] ?? '语音识别失败，请稍后重试。',
        'warning',
      )
      if (event.error === 'no-speech') {
        onSpeakRef.current(UNKNOWN_COMMAND_RESPONSE)
      }
    }
    recognition.onresult = (event) => {
      let transcript = ''
      for (
        let index = event.resultIndex;
        index < event.results.length;
        index += 1
      ) {
        transcript += event.results[index][0]?.transcript ?? ''
      }
      const text = transcript.trim()
      if (!text) return

      recognition.stop()
      const intent = matchIntent(text)
      if (!intent) {
        toast(`未识别出可执行指令：${text}`, 'warning')
        onSpeakRef.current(UNKNOWN_COMMAND_RESPONSE)
        return
      }

      const result = executeIntentRef.current(intent)
      onSpeakRef.current(result.response)
    }

    recognitionRef.current = recognition
    try {
      recognition.start()
    } catch {
      recognitionRef.current = null
      setListening(false)
      toast('语音识别启动失败，请稍后重试。', 'warning')
    }
  }

  return (
    <button
      type="button"
      className="topbar__action"
      onClick={handleVoiceControl}
      title={
        listening
          ? '停止聆听'
          : '语音控制：切换场景、查询重点、语音处置或打开历史报告'
      }
      aria-label={listening ? '停止语音控制' : '开始语音控制'}
      aria-pressed={listening}
    >
      <Mic
        size={15}
        aria-hidden="true"
        style={
          listening
            ? {
                color: 'var(--danger)',
                animation: 'live-dot-pulse 0.8s ease-in-out infinite',
              }
            : undefined
        }
      />
      <span className="topbar__speak-label">
        {listening ? '聆听中' : '语音控制'}
      </span>
    </button>
  )
}
