import { useEffect, useRef, useState } from 'react'
import {
  Camera,
  ClipboardCheck,
  LayoutGrid,
  MapPin,
  RadioTower,
  Smartphone,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { LogoMark } from '../components/ui/LogoMark'
import { DispositionButton } from '../components/domain/DispositionButton'
import { useAppStore } from '../state/AppStore'
import { useLiveData } from '../state/LiveDataContext'
import { useToast } from '../state/ToastContext'
import { getZone, ZONES } from '../data/zones'
import { getActiveEvents, getEventsForZone } from '../state/selectors'
import { METRIC_META, ZONE_COLORS } from '../domain/constants'
import { formatNumber } from '../domain/format'
import { metricStatus } from '../domain/priority'
import {
  EventStatusBadge,
  ZoneStatusBadge,
} from '../components/ui/Badge'
import { EmptyState } from '../components/ui/EmptyState'

type H5Tab = 'overview' | 'handle' | 'scene'

const TABS: { key: H5Tab; label: string; icon: typeof LayoutGrid }[] = [
  { key: 'overview', label: '总览', icon: LayoutGrid },
  { key: 'handle', label: '处置', icon: ClipboardCheck },
  { key: 'scene', label: '现场', icon: Camera },
]

const MQTT_STATUS_TEXT = {
  online: '实时链路已连接',
  connecting: '实时链路连接中',
  reconnecting: '断线重连中',
  offline: '实时链路离线',
} as const

export function H5Page() {
  const { mqttStatus, readings, priorities, topZoneId } = useLiveData()
  const [tab, setTab] = useState<H5Tab>('overview')
  const stableTopZoneId =
    topZoneId ?? priorities[0]?.zoneId ?? ZONES[0].zoneId
  const [zoneId, setZoneId] = useState(stableTopZoneId)

  const priority =
    priorities.find((item) => item.zoneId === zoneId) ?? priorities[0]
  const reading = readings[zoneId]
  const metrics = {
    pm25: reading?.pm25 ?? null,
    co2: reading?.co2 ?? null,
    crowdLevel: reading?.crowdLevel ?? null,
  }

  return (
    <div className="h5-page">
      <div className="h5-frame">
        <header className="h5-header">
          <div className="h5-brand">
            <LogoMark size={34} />
            <div>
              <strong>AirGuard</strong>
              <span>现场端 · H5</span>
            </div>
          </div>
          <span className="h5-preview-badge">
            <Smartphone size={12} />
            H5
          </span>
        </header>

        <div className={`h5-sync h5-sync--${mqttStatus}`}>
          <span>
            <RadioTower size={13} />
            {MQTT_STATUS_TEXT[mqttStatus]}
          </span>
          <span className="h5-sync__hint">独立现场视图</span>
        </div>

        <main className="h5-content">
          {tab === 'overview' && (
            <OverviewTab
              zoneId={zoneId}
              onZoneChange={setZoneId}
              topZoneId={stableTopZoneId}
              metrics={metrics}
              priorityScore={priority?.score ?? 0}
              priorityRank={priority?.rank ?? 0}
            />
          )}
          {tab === 'handle' && (
            <HandleTab
              zoneId={zoneId}
              onZoneChange={setZoneId}
              onDone={() => setTab('overview')}
              metrics={metrics}
            />
          )}
          {tab === 'scene' && <SceneTab zoneId={zoneId} />}

          {/* 内容偏少时沉底的装饰提示，避免大屏下方出现"没加载完"式的空白 */}
          <div className="h5-content-foot" aria-hidden="true">
            <i />
            <span>MQTT 实时链路 · 每 5 秒刷新</span>
            <i />
          </div>
        </main>
      </div>

      <nav className="h5-tabbar" aria-label="H5 底部导航">
        {TABS.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.key}
              type="button"
              className={
                tab === item.key
                  ? 'h5-tabbar__item h5-tabbar__item--active'
                  : 'h5-tabbar__item'
              }
              onClick={() => setTab(item.key)}
              aria-pressed={tab === item.key}
            >
              <Icon size={19} />
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}

interface ZoneMetrics {
  pm25: number | null
  co2: number | null
  crowdLevel: number | null
}

function ZoneSwitcher({
  zoneId,
  onChange,
}: {
  zoneId: string
  onChange: (zoneId: string) => void
}) {
  return (
    <label className="h5-switcher">
      <span>切换区域</span>
      <select
        value={zoneId}
        onChange={(event) => onChange(event.target.value)}
        aria-label="切换区域"
      >
        {ZONES.map((zone) => (
          <option value={zone.zoneId} key={zone.zoneId}>
            {zone.shortName}（{zone.zoneId}）
          </option>
        ))}
      </select>
    </label>
  )
}

function MetricCells({ metrics }: { metrics: ZoneMetrics }) {
  return (
    <div className="h5-metrics">
      {(
        [
          ['pm25', metrics.pm25],
          ['co2', metrics.co2],
          ['crowdDensity', metrics.crowdLevel],
        ] as const
      ).map(([metric, value]) => {
        const meta = METRIC_META[metric]
        const status = value === null ? 'NORMAL' : metricStatus(metric, value)
        return (
          <div
            className={`h5-metric h5-metric--${status.toLowerCase()}`}
            key={metric}
          >
            <span>{meta.shortLabel}</span>
            <strong>
              {value === null ? '—' : formatNumber(value, meta.digits)}
            </strong>
            <small>{meta.unit}</small>
          </div>
        )
      })}
    </div>
  )
}

function OverviewTab({
  zoneId,
  onZoneChange,
  topZoneId,
  metrics,
  priorityScore,
  priorityRank,
}: {
  zoneId: string
  onZoneChange: (zoneId: string) => void
  topZoneId: string
  metrics: ZoneMetrics
  priorityScore: number
  priorityRank: number
}) {
  const { priorities } = useLiveData()
  const zone = getZone(zoneId)
  const priority = priorities.find((item) => item.zoneId === zoneId)
  const topZone = getZone(topZoneId)

  return (
    <>
      <section key={topZoneId} className="h5-topzone fade-swap">
        <span className="h5-eyebrow">当前 Priority 最高区域</span>
        <strong>{topZone.shortName}</strong>
        <small>
          {(() => {
            const top = priorities.find((item) => item.zoneId === topZoneId)
            return `Priority #${top?.rank ?? '—'} · ${top?.score.toFixed(1) ?? '—'} 分`
          })()}
        </small>
      </section>

      <ZoneSwitcher zoneId={zoneId} onChange={onZoneChange} />

      <section
        className="h5-focus"
        style={{ ['--zone-color' as string]: ZONE_COLORS[zoneId] }}
      >
        <div className="h5-focus__head">
          <span className="h5-eyebrow">选中区域</span>
          {priority && <ZoneStatusBadge status={priority.zoneStatus} />}
        </div>
        <h1>{zone.shortName}</h1>
        <p className="h5-focus__building">
          <MapPin size={13} />
          {zone.building} · Priority #{priorityRank} ·{' '}
          {priorityScore.toFixed(1)} 分
        </p>
        <MetricCells metrics={metrics} />
        {priority && <p className="h5-summary">{priority.summary}</p>}
      </section>
    </>
  )
}

function HandleTab({
  zoneId,
  onZoneChange,
  onDone,
  metrics,
}: {
  zoneId: string
  onZoneChange: (zoneId: string) => void
  onDone: () => void
  metrics: ZoneMetrics
}) {
  const { state } = useAppStore()
  const activeEvents = getActiveEvents(state)
  const event =
    activeEvents.find((item) => item.zoneId === zoneId) ??
    getEventsForZone(state, zoneId)[0]

  return (
    <>
      <ZoneSwitcher zoneId={zoneId} onChange={onZoneChange} />

      {event ? (
        <section className="h5-section h5-handle">
          <div className="h5-section__head">
            <h2>关联事件</h2>
            <EventStatusBadge status={event.status} />
          </div>
          <p className="h5-handle__title">{event.title}</p>
          <p className="h5-handle__meta">
            {event.eventId} · {getZone(event.zoneId).shortName}
          </p>
          <p className="h5-handle__data-label">当前实时数据</p>
          <MetricCells metrics={metrics} />
          {/* 关键：处置交互完全在 H5 内部完成，不跳转 Web 页面 */}
          <DispositionButton event={event} block onDone={onDone} />
          <p className="h5-disabled-note">
            确认后事件从「待处置」更新为「处置中」，并通过 MQTT
            同步到 Web 工作台与其他终端。
          </p>
        </section>
      ) : (
        <section className="h5-section">
          <EmptyState
            title="该区域暂无事件"
            description="切换到其他区域查看需要处置的事件。"
            compact
          />
        </section>
      )}

      <section className="h5-section h5-handle-guide">
        <div className="h5-section__head">
          <h2>处置流程</h2>
          <span>3 步</span>
        </div>
        <div className="h5-handle-steps">
          <div className="h5-handle-step">
            <span>1</span>
            <div>
              <strong>确认现场</strong>
              <small>核对区域、事件编号与当前实时数据</small>
            </div>
          </div>
          <div className="h5-handle-step">
            <span>2</span>
            <div>
              <strong>执行处置</strong>
              <small>点击上方按钮，记录 Action 并同步其他终端</small>
            </div>
          </div>
          <div className="h5-handle-step">
            <span>3</span>
            <div>
              <strong>观察恢复</strong>
              <small>等待后续 MQTT 样本满足恢复规则</small>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}

function SceneTab({ zoneId }: { zoneId: string }) {
  const { readings, priorities, addManualObservation } = useLiveData()
  const { toast } = useToast()
  const zone = getZone(zoneId)
  const reading = readings[zoneId]
  const priority = priorities.find((item) => item.zoneId === zoneId)
  const metrics = {
    pm25: reading?.pm25 ?? null,
    co2: reading?.co2 ?? null,
    crowdLevel: reading?.crowdLevel ?? null,
  }

  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [speaking, setSpeaking] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    return () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl)
      window.speechSynthesis?.cancel()
    }
    // 仅卸载时清理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handlePhotoChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // 重置 input，允许连续拍摄同一对象
    event.target.value = ''
    if (!file) return
    if (photoUrl) URL.revokeObjectURL(photoUrl)
    setPhotoUrl(URL.createObjectURL(file))
    // 生成人工观察证据并经 MQTT 同步压缩图到 Web 工作台
    const result = await addManualObservation({ zoneId, file, origin: 'H5' })
    if (!result.ok) {
      toast(result.message, 'warning')
      return
    }
    toast(
      result.synced
        ? '已生成「人工观察」证据，压缩图经 MQTT 同步到 Web 工作台。'
        : '已生成「人工观察」证据；MQTT 离线，仅本端可见。',
      'success',
    )
  }

  function handleSpeak() {
    if (!('speechSynthesis' in window)) {
      toast('当前浏览器不支持 Web Speech API，无法语音播报。', 'warning')
      return
    }
    if (speaking) {
      window.speechSynthesis.cancel()
      setSpeaking(false)
      return
    }
    if (
      metrics.pm25 === null ||
      metrics.co2 === null ||
      metrics.crowdLevel === null
    ) {
      toast('暂无实时数据，等待 MQTT 推送后再播报。', 'warning')
      return
    }
    const text =
      `${zone.name}当前环境数据播报。` +
      `PM2.5 为 ${Math.round(metrics.pm25)} 微克每立方米；` +
      `二氧化碳浓度为 ${Math.round(metrics.co2)} ppm；` +
      `人流密度为 ${metrics.crowdLevel.toFixed(2)} 人每平方米。`
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'zh-CN'
    utterance.rate = 1
    utterance.onend = () => setSpeaking(false)
    utterance.onerror = () => setSpeaking(false)
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
    setSpeaking(true)
  }

  return (
    <>
      <section className="h5-section h5-scene-summary">
        <div className="h5-section__head">
          <h2>现场记录</h2>
          <ZoneStatusBadge status={priority?.zoneStatus ?? 'NORMAL'} />
        </div>
        <p className="h5-scene-summary__name">{zone.name}</p>
        <p className="h5-scene-summary__meta">
          {zone.building} · Priority #{priority?.rank ?? '—'} ·{' '}
          {priority?.score.toFixed(1) ?? '—'} 分
        </p>
        <MetricCells metrics={metrics} />
      </section>

      <section className="h5-section">
        <div className="h5-section__head">
          <h2>拍照留档</h2>
          <span>{zone.shortName}</span>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="h5-photo-input"
          onChange={handlePhotoChange}
          aria-label="拍摄现场照片"
        />
        <button
          type="button"
          className="h5-camera-action h5-camera-action--wide"
          onClick={() => fileInputRef.current?.click()}
        >
          <span>
            <Camera size={18} />
          </span>
          <strong>调用摄像头拍照</strong>
          <small>移动端打开后置相机，桌面端选择本地图片；压缩图同步到 Web 证据页</small>
        </button>
        {photoUrl && (
          <figure className="h5-photo-preview">
            <img src={photoUrl} alt="现场照片预览" />
            <figcaption>现场照片预览 · 已同步 Web 工作台</figcaption>
          </figure>
        )}
      </section>

      <section className="h5-section">
        <div className="h5-section__head">
          <h2>语音播报</h2>
          <span>Web Speech API</span>
        </div>
        <button
          type="button"
          className="h5-camera-action h5-camera-action--wide"
          onClick={handleSpeak}
        >
          <span>
            {speaking ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </span>
          <strong>{speaking ? '停止播报' : '播报当前区域数据'}</strong>
          <small>TTS 朗读 {zone.shortName} 的 PM2.5 / CO₂ / 人流数据</small>
        </button>
      </section>

      <section className="h5-section h5-scene-note">
        <div className="h5-section__head">
          <h2>现场提示</h2>
          <span>本地演示</span>
        </div>
        <ul className="h5-scene-tips">
          <li>原图保留在本机；压缩缩略图经 MQTT 同步到 Web「证据与知识」页。</li>
          <li>语音播报使用浏览器 Web Speech API，可随时停止。</li>
          <li>环境数据来自 MQTT 实时链路，每 5 秒刷新一次。</li>
        </ul>
      </section>
    </>
  )
}
