import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  Clock3,
  Info,
  Menu,
  RefreshCw,
  Smartphone,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { APP_NAME, ZONE_STATUS_LABELS } from '../../domain/constants'
import { formatDateTime } from '../../domain/format'
import { effectiveZoneStatus } from '../../domain/priority'
import { getZone } from '../../data/zones'
import { useAppStore } from '../../state/AppStore'
import { useLiveData } from '../../state/LiveDataContext'
import { getActiveEventForZone } from '../../state/selectors'
import { useToast } from '../../state/ToastContext'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { VoiceControl } from '../domain/VoiceControl'
import { getPageMeta } from './pageMeta'

interface TopbarProps {
  onOpenMenu: () => void
}

export function Topbar({ onOpenMenu }: TopbarProps) {
  const location = useLocation()
  const meta = getPageMeta(location.pathname)
  const { state, resetDemoData } = useAppStore()
  const { clearLiveData, priorities, readings, topZoneId } = useLiveData()
  const { toast } = useToast()
  const [resetOpen, setResetOpen] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const [speaking, setSpeaking] = useState(false)
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30000)
    return () => window.clearInterval(timer)
  }, [])

  // 卸载时停止播报，避免页面切换后声音继续。
  useEffect(() => {
    return () => {
      if (utteranceRef.current) {
        utteranceRef.current.onend = null
        utteranceRef.current.onerror = null
        utteranceRef.current = null
      }
      window.speechSynthesis?.cancel()
    }
  }, [])

  function stopSpeaking() {
    if (utteranceRef.current) {
      utteranceRef.current.onend = null
      utteranceRef.current.onerror = null
      utteranceRef.current = null
    }
    window.speechSynthesis?.cancel()
    setSpeaking(false)
  }

  /** 统一处理状态播报与语音控制反馈，避免新旧 TTS 排队重叠。 */
  function speakText(text: string) {
    if (!('speechSynthesis' in window)) {
      toast('当前浏览器不支持 Web Speech API，无法语音播报。', 'warning')
      return
    }
    stopSpeaking()

    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'zh-CN'
    utterance.rate = 1
    utterance.onend = () => {
      if (utteranceRef.current !== utterance) return
      utteranceRef.current = null
      setSpeaking(false)
    }
    utterance.onerror = () => {
      if (utteranceRef.current !== utterance) return
      utteranceRef.current = null
      setSpeaking(false)
    }
    utteranceRef.current = utterance
    window.speechSynthesis.speak(utterance)
    setSpeaking(true)
  }

  /** 语音播报：Web Speech API 朗读当前 Priority #1 区域状态 */
  function handleSpeak() {
    if (!('speechSynthesis' in window)) {
      toast('当前浏览器不支持 Web Speech API，无法语音播报。', 'warning')
      return
    }
    if (speaking) {
      stopSpeaking()
      return
    }
    const leading = priorities[0]
    const zoneId = topZoneId ?? leading?.zoneId
    const reading = zoneId ? readings[zoneId] : undefined
    if (!leading || !zoneId || !reading) {
      toast('暂无实时数据，等待 MQTT 推送后再播报。', 'warning')
      return
    }
    const zone = getZone(zoneId)
    // 与空间地图同源：未关闭事件覆盖瞬时指标档位，播报口径与地图颜色一致
    const activeEvent = getActiveEventForZone(state, zoneId)
    const spokenStatus = effectiveZoneStatus(
      leading.zoneStatus,
      activeEvent ? [activeEvent] : [],
    )
    const text =
      `当前优先关注${zone.name}。` +
      `PM2.5 为 ${Math.round(reading.pm25)} 微克每立方米，` +
      `二氧化碳为 ${Math.round(reading.co2)} ppm，` +
      `人流密度为 ${reading.crowdLevel.toFixed(2)} 人每平方米，` +
      `处于${ZONE_STATUS_LABELS[spokenStatus]}状态。` +
      (activeEvent ? '存在未关闭事件，请尽快处置。' : '')
    speakText(text)
  }

  function confirmReset() {
    resetDemoData()
    clearLiveData()
    setResetOpen(false)
    toast(
      '已清空全部历史事件、Action 与 Run Trace，仅保留 2 条已恢复示例；可以重新录制演示了。',
      'success',
    )
  }

  return (
    <header className="topbar">
      <div className="topbar__left">
        <button
          type="button"
          className="icon-button topbar__menu"
          onClick={onOpenMenu}
          aria-label="打开导航"
        >
          <Menu size={20} />
        </button>
        <div className="topbar__heading">
          <span className="topbar__section">{meta.section}</span>
          <span className="topbar__divider">/</span>
          <strong>{meta.title}</strong>
        </div>
      </div>

      <div className="topbar__right">
        <span className="demo-clock" title="系统本地时间">
          <Clock3 size={14} />
          <span className="demo-clock__label">本地时间</span>
          <span className="demo-clock__value">
            {formatDateTime(now.toISOString())}
          </span>
        </span>
        <VoiceControl onSpeak={speakText} onBeforeListen={stopSpeaking} />
        <button
          type="button"
          className="topbar__action"
          onClick={handleSpeak}
          title="朗读当前 Priority #1 区域状态（Web Speech API）"
          aria-pressed={speaking}
        >
          {speaking ? <VolumeX size={15} /> : <Volume2 size={15} />}
          <span className="topbar__speak-label">
            {speaking ? '停止播报' : '语音播报'}
          </span>
        </button>
        <Link
          to="/m"
          target="_blank"
          rel="noreferrer"
          className="topbar__action topbar__h5"
        >
          <Smartphone size={16} />
          <span>现场 H5</span>
        </Link>
        <button
          type="button"
          className="topbar__action"
          onClick={() => setResetOpen(true)}
          title="清空测试累积的历史记录，回到干净初始状态"
        >
          <RefreshCw size={15} />
          <span className="topbar__reset-label">清空历史记录</span>
        </button>
        <span className="topbar__app" aria-label={`${APP_NAME} 工作台`}>
          <Info size={14} />
          <span>阶段二 · 实时</span>
        </span>
        <span className="topbar__avatar" title="值班员 · 演示账号">
          值
        </span>
      </div>

      <Modal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title="清空历史记录？"
        description="清除浏览器中测试累积的事件、Action、Recovery 评估、Run Trace 与 MQTT 实时历史，仅保留 2 条已恢复示例事件作为演示基准，方便重新录制。"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setResetOpen(false)}>
              取消
            </Button>
            <Button
              variant="danger"
              icon={<RefreshCw size={15} />}
              onClick={confirmReset}
            >
              确认清空
            </Button>
          </>
        }
      >
        <div className="reset-summary">
          <p>将清空：</p>
          <ul>
            <li>测试累积的全部事件与处置 Action 记录</li>
            <li>全部 Recovery 评估与 Run Trace</li>
            <li>Action 后验样本、MQTT 实时历史与 ML 预警状态</li>
          </ul>
          <p>将保留：</p>
          <ul>
            <li>2 条已恢复示例事件（含 Action / 样本 / Run），页面不至全空</li>
          </ul>
          <p className="muted">
            此操作仅影响当前浏览器的 localStorage，不影响项目代码或文件。
          </p>
        </div>
      </Modal>
    </header>
  )
}
