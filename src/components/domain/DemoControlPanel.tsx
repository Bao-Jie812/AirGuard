import { useEffect, useRef, useState } from 'react'
import { FlaskConical, Siren, Undo2, X } from 'lucide-react'
import { CLIENT_ID } from '../../services/mqttClient'
import { useLiveData } from '../../state/LiveDataContext'
import { useToast } from '../../state/ToastContext'
import { ZONE_COLORS } from '../../domain/constants'
import { assessZoneAnomaly } from '../../domain/anomaly'
import { getZoneName } from '../../data/zones'
import { cn } from '../../domain/format'

function useDemoControl() {
  const { publishControl, mqttStatus, resetMlAlertForDemo, showDemoMlAlert, histories, readings } = useLiveData()
  const { toast } = useToast()
  const online = mqttStatus === 'online'
  const demoAlertTimersRef = useRef<Map<string, number>>(new Map())
  const initialResetSentRef = useRef(false)
  useEffect(() => () => {
    for (const timer of demoAlertTimersRef.current.values()) window.clearTimeout(timer)
    demoAlertTimersRef.current.clear()
  }, [])
  useEffect(() => {
    if (!online || initialResetSentRef.current) return
    initialResetSentRef.current = true
    // 新一轮页面演示从干净状态开始，避免上一次锁定的 850/1600 让建筑初始变黄或变红。
    publishControl({
      action: 'RESET',
      at: new Date().toISOString(),
      clientId: CLIENT_ID,
      source: 'DEMO_PANEL_INIT',
    })
  }, [online, publishControl])

  function triggerAlert(zoneId: string) {
    if (!online) {
      toast('MQTT 离线，指令未能发出。', 'info')
      return
    }
    // 网页只发控制指令；所有传感器读数与状态锁均由 simulator 统一管理。
    const previousTimer = demoAlertTimersRef.current.get(zoneId)
    if (previousTimer) window.clearTimeout(previousTimer)
    resetMlAlertForDemo(zoneId)
    // 使用触发前的真实历史作为基线，预先计算本轮 850/45 的 Z-score。
    const assessment = assessZoneAnomaly(zoneId, [
      ...(histories[zoneId] ?? []),
      {
        ts: Date.now(),
        pm25: 45,
        co2: 850,
        crowdLevel: readings[zoneId]?.crowdLevel ?? 0.3,
      },
    ], 1)
    publishControl({
      action: 'TRIGGER_ALERT',
      zoneId,
      isManual: true,
      at: new Date().toISOString(),
      clientId: CLIENT_ID,
    })
    const metrics = assessment.metrics.filter((item) => item.anomalous)
    if (metrics.length === 0) {
      toast('当前缺少正常基线，暂时无法形成 ML 异常；请先等待正常数据到达后再触发。', 'warning')
      return
    }
    const timer = window.setTimeout(() => {
      demoAlertTimersRef.current.delete(zoneId)
      showDemoMlAlert({
        zoneId,
        metrics,
        maxAbsZ: assessment.maxAbsZ ?? 0,
        sampleSize: assessment.sampleSize,
        detectedAt: Date.now(),
      })
    }, 3_000)
    demoAlertTimersRef.current.set(zoneId, timer)
    toast(
      `已下发${getZoneName(zoneId)} TRIGGER_ALERT：建筑已变为橙色，3 秒后弹出 ML 预警；忽略后 5 秒升至 1600。`,
      'info',
    )
  }

  function recoverAll() {
    for (const timer of demoAlertTimersRef.current.values()) window.clearTimeout(timer)
    demoAlertTimersRef.current.clear()
    publishControl({
      action: 'RESET',
      at: new Date().toISOString(),
      clientId: CLIENT_ID,
    })
    toast(
      online
        ? '已发送 RESET：全部区域解除状态锁并恢复正常随机数据。'
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

const TRIGGER_TITLE = '立即橙色建筑，3 秒后 ML 弹窗；忽略后 5 秒变红，处置或 RESET 恢复'

export function DemoControlBar() {
  const { online, triggerAlert, recoverAll } = useDemoControl()
  return (
    <div className="demo-bar" role="group" aria-label="演示控制面板">
      <span className="demo-bar__label"><FlaskConical size={14} />演示控制</span>
      {TRIGGER_BUTTONS.map((button) => (
        <button
          key={button.zoneId}
          type="button"
          className="demo-bar__btn demo-bar__btn--alert"
          style={{ ['--zone-color' as string]: ZONE_COLORS[button.zoneId] }}
          onClick={() => triggerAlert(button.zoneId)}
          disabled={!online}
          title={online ? TRIGGER_TITLE : 'MQTT 离线不可用'}
        >
          <Siren size={14} />{button.label}
        </button>
      ))}
      <button
        type="button"
        className="demo-bar__btn demo-bar__btn--recover"
        onClick={recoverAll}
        disabled={!online}
        title={online ? '发送 RESET，全部区域恢复正常' : 'MQTT 离线不可用'}
      >
        <Undo2 size={14} />一键恢复正常
      </button>
      <span className={cn('demo-bar__status', !online && 'is-offline')} title="MQTT 连接状态">
        {online ? '● 已连接' : '● 未连接'}
      </span>
    </div>
  )
}

export function DemoControlPanel() {
  const { online, triggerAlert, recoverAll } = useDemoControl()
  const [open, setOpen] = useState(false)
  return (
    <div className="demo-control">
      {open && (
        <div className="demo-control__panel" role="dialog" aria-label="演示控制面板">
          <div className="demo-control__head">
            <span className="demo-control__title"><FlaskConical size={14} />演示控制 · DEV</span>
            <button type="button" className="icon-button" onClick={() => setOpen(false)} aria-label="关闭演示控制面板"><X size={15} /></button>
          </div>
          <p className="demo-control__hint">橙色建筑 → 3 秒 ML 弹窗 → 忽略后 5 秒变红 → 处置恢复</p>
          <div className="demo-control__actions">
            {TRIGGER_BUTTONS.map((button) => (
              <button
                key={button.zoneId}
                type="button"
                className="demo-control__btn demo-control__btn--alert"
                style={{ ['--zone-color' as string]: ZONE_COLORS[button.zoneId] }}
                onClick={() => triggerAlert(button.zoneId)}
                disabled={!online}
                title={online ? TRIGGER_TITLE : 'MQTT 离线不可用'}
              >
                <Siren size={14} />{button.label}
              </button>
            ))}
            <button
              type="button"
              className="demo-control__btn demo-control__btn--recover"
              onClick={recoverAll}
              disabled={!online}
              title={online ? '发送 RESET，全部区域恢复正常' : 'MQTT 离线不可用'}
            >
              <Undo2 size={14} />一键恢复正常
            </button>
          </div>
          <p className={cn('demo-control__status', !online && 'is-offline')}>
            {online ? 'MQTT 已连接 · simulator 状态锁已启用' : 'MQTT 未连接 · 等待连接后可用'}
          </p>
        </div>
      )}
      <button
        type="button"
        className={cn('demo-control__fab', open && 'demo-control__fab--active')}
        onClick={() => setOpen((previous) => !previous)}
        aria-pressed={open}
        title="演示控制面板"
      >
        <FlaskConical size={20} />
      </button>
    </div>
  )
}
