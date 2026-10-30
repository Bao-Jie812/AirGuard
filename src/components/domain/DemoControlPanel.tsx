import { useEffect, useRef, useState } from 'react'
import { FlaskConical, Siren, Undo2, X } from 'lucide-react'
import {
  CLIENT_ID,
  getMqttClient,
  SENSOR_TOPIC_PREFIX,
} from '../../services/mqttClient'
import { useLiveData } from '../../state/LiveDataContext'
import { useToast } from '../../state/ToastContext'
import { ZONE_COLORS } from '../../domain/constants'
import { getZoneName } from '../../data/zones'
import { cn } from '../../domain/format'

const ESCALATION_DELAY_MS = 8_000

// 两项指标均低于当前 WATCH 阈值（PM2.5 35、CO₂ 800），
// 保证第一阶段是「规则 NORMAL + ML ANOMALY」，而不是直接触发规则告警。
const HIDDEN_RISK_READING = { pm25: 34, co2: 799 } as const
const SEVERE_READING = { pm25: 150, co2: 1600 } as const

interface PendingEscalation {
  timer: number
  triggeredAt: number
}

/** 发布真实 MQTT 演示读数；前端状态和事件仍统一由收到的 MQTT 数据驱动。 */
function publishDemoReading(
  zoneId: string,
  values: { pm25: number; co2: number; crowdLevel: number },
): boolean {
  const client = getMqttClient()
  if (!client.connected) return false
  client.publish(
    `${SENSOR_TOPIC_PREFIX}${zoneId}`,
    JSON.stringify({
      zoneId,
      ...values,
      time: new Date().toISOString(),
      isManual: true,
      source: 'DEMO_CONTROL_PANEL',
    }),
    { qos: 0 },
  )
  return true
}

function useDemoControl() {
  const { publishControl, mqttStatus, mlInterventions, readings } = useLiveData()
  const { toast } = useToast()
  const online = mqttStatus === 'online'
  const pendingEscalationsRef = useRef<Map<string, PendingEscalation>>(new Map())
  const interventionsRef = useRef(mlInterventions)
  const readingsRef = useRef(readings)
  useEffect(() => {
    interventionsRef.current = mlInterventions
    readingsRef.current = readings
  }, [mlInterventions, readings])

  function cancelEscalation(zoneId: string) {
    const pending = pendingEscalationsRef.current.get(zoneId)
    if (!pending) return
    window.clearTimeout(pending.timer)
    pendingEscalationsRef.current.delete(zoneId)
  }

  function cancelAllEscalations() {
    for (const pending of pendingEscalationsRef.current.values()) {
      window.clearTimeout(pending.timer)
    }
    pendingEscalationsRef.current.clear()
  }

  // 面板卸载后不再补发第二阶段数据，避免离开页面后演示仍在后台恶化。
  useEffect(
    () => () => {
      for (const pending of pendingEscalationsRef.current.values()) {
        window.clearTimeout(pending.timer)
      }
      pendingEscalationsRef.current.clear()
    },
    [],
  )

  function triggerAlert(zoneId: string) {
    if (!online) {
      toast('MQTT 离线，指令未能发出。', 'info')
      return
    }

    // 同一区域重复点击时重新开始剧本，不保留上一次未执行的恶化定时器。
    cancelEscalation(zoneId)
    const triggeredAt = Date.now()
    const crowdLevel = readingsRef.current[zoneId]?.crowdLevel ?? 0.3
    const published = publishDemoReading(zoneId, {
      ...HIDDEN_RISK_READING,
      crowdLevel,
    })
    if (!published) {
      toast('MQTT 连接已断开，临界数据未能发出。', 'info')
      return
    }

    const timer = window.setTimeout(() => {
      const pending = pendingEscalationsRef.current.get(zoneId)
      // 只执行当前这一轮剧本，忽略已被重复点击替换的旧定时器。
      if (!pending || pending.triggeredAt !== triggeredAt) return
      pendingEscalationsRef.current.delete(zoneId)

      // 只认本轮触发之后新增的干预，避免历史干预记录误取消本次演示。
      const intervened = interventionsRef.current.some(
        (item) =>
          item.zoneId === zoneId &&
          Date.parse(item.actionAt) >= pending.triggeredAt,
      )
      if (intervened) return

      const latestCrowdLevel =
        readingsRef.current[zoneId]?.crowdLevel ?? crowdLevel
      const escalated = publishDemoReading(zoneId, {
        ...SEVERE_READING,
        crowdLevel: latestCrowdLevel,
      })
      toast(
        escalated
          ? `${getZoneName(zoneId)} 在 8 秒内未记录干预，已发布严重超标数据，等待 MQTT 确认后转入红色报警。`
          : 'MQTT 连接已断开，严重超标数据未能发出。',
        'info',
      )
    }, ESCALATION_DELAY_MS)
    pendingEscalationsRef.current.set(zoneId, { timer, triggeredAt })

    toast(
      `已发布${getZoneName(zoneId)}临界数据（CO₂ ${HIDDEN_RISK_READING.co2} ppm，PM2.5 ${HIDDEN_RISK_READING.pm25} μg/m³）。请先处理 ML 隐患预警；8 秒内未记录干预将自动恶化。`,
      'info',
    )
  }

  function recoverAll() {
    // 恢复操作同时终止所有待执行的第二阶段，防止恢复后再次自动超标。
    cancelAllEscalations()
    publishControl({
      action: 'TRIGGER_RECOVERY',
      at: new Date().toISOString(),
      clientId: CLIENT_ID,
    })
    toast(
      online
        ? '已取消待执行的自动恶化，并发送恢复指令：全部区域恢复发送正常数据。'
        : 'MQTT 离线，恢复指令未能发出。',
      'info',
    )
  }

  return { online, triggerAlert, recoverAll }
}

const TRIGGER_BUTTONS = [
  { zoneId: 'zone-w', label: '触发食堂异常' },
  { zoneId: 'zone-s', label: '触发教学区异常' },
  { zoneId: 'zone-n', label: '触发宿舍异常' },
] as const

const TRIGGER_TITLE = '先发布临界数据触发 ML 预警；8 秒未干预后自动发布严重超标数据'

/**
 * 演示控制条（常驻可见版）：
 * 放置在区域总览页右上角，文字按钮直接可见可点。
 */
export function DemoControlBar() {
  const { online, triggerAlert, recoverAll } = useDemoControl()

  return (
    <div className="demo-bar" role="group" aria-label="演示控制面板">
      <span className="demo-bar__label">
        <FlaskConical size={14} />
        演示控制
      </span>
      {TRIGGER_BUTTONS.map((button) => (
        <button
          key={button.zoneId}
          type="button"
          className="demo-bar__btn demo-bar__btn--alert"
          style={{
            ['--zone-color' as string]: ZONE_COLORS[button.zoneId],
          }}
          onClick={() => triggerAlert(button.zoneId)}
          disabled={!online}
          title={online ? TRIGGER_TITLE : 'MQTT 离线不可用'}
        >
          <Siren size={14} />
          {button.label}
        </button>
      ))}
      <button
        type="button"
        className="demo-bar__btn demo-bar__btn--recover"
        onClick={recoverAll}
        disabled={!online}
        title={online ? '取消自动恶化，全部区域立即恢复发送正常数据' : 'MQTT 离线不可用'}
      >
        <Undo2 size={14} />
        一键恢复正常
      </button>
      <span
        className={cn('demo-bar__status', !online && 'is-offline')}
        title="MQTT 连接状态"
      >
        {online ? '● 已连接' : '● 未连接'}
      </span>
    </div>
  )
}

/**
 * 演示控制面板（悬浮版）：右下角悬浮按钮展开，
 * 在非总览页面也能随时控制演示场景。
 */
export function DemoControlPanel() {
  const { online, triggerAlert, recoverAll } = useDemoControl()
  const [open, setOpen] = useState(false)

  return (
    <div className="demo-control">
      {open && (
        <div className="demo-control__panel" role="dialog" aria-label="演示控制面板">
          <div className="demo-control__head">
            <span className="demo-control__title">
              <FlaskConical size={14} />
              演示控制 · DEV
            </span>
            <button
              type="button"
              className="icon-button"
              onClick={() => setOpen(false)}
              aria-label="关闭演示控制面板"
            >
              <X size={15} />
            </button>
          </div>
          <p className="demo-control__hint">
            递进剧本：临界数据 → ML 预警 → 8 秒未干预则严重超标
          </p>
          <div className="demo-control__actions">
            {TRIGGER_BUTTONS.map((button) => (
              <button
                key={button.zoneId}
                type="button"
                className="demo-control__btn demo-control__btn--alert"
                style={{
                  ['--zone-color' as string]: ZONE_COLORS[button.zoneId],
                }}
                onClick={() => triggerAlert(button.zoneId)}
                disabled={!online}
                title={online ? TRIGGER_TITLE : 'MQTT 离线不可用'}
              >
                <Siren size={14} />
                {button.label}
              </button>
            ))}
            <button
              type="button"
              className="demo-control__btn demo-control__btn--recover"
              onClick={recoverAll}
              disabled={!online}
              title={online ? '取消自动恶化，全部区域恢复正常' : 'MQTT 离线不可用'}
            >
              <Undo2 size={14} />
              一键恢复正常
            </button>
          </div>
          <p className={cn('demo-control__status', !online && 'is-offline')}>
            {online
              ? 'MQTT 已连接 · 指令即点即发'
              : 'MQTT 未连接 · 等待连接后可用'}
          </p>
        </div>
      )}
      <button
        type="button"
        className={cn(
          'demo-control__fab',
          open && 'demo-control__fab--active',
        )}
        onClick={() => setOpen((previous) => !previous)}
        aria-pressed={open}
        title="演示控制面板"
      >
        <FlaskConical size={20} />
      </button>
    </div>
  )
}
