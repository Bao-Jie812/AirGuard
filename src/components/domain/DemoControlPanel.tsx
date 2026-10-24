import { useState } from 'react'
import { FlaskConical, Siren, Undo2, X } from 'lucide-react'
import { CLIENT_ID } from '../../services/mqttClient'
import { useLiveData } from '../../state/LiveDataContext'
import { useToast } from '../../state/ToastContext'
import { ZONE_COLORS } from '../../domain/constants'
import { cn } from '../../domain/format'

function useDemoControl() {
  const { publishControl, mqttStatus } = useLiveData()
  const { toast } = useToast()
  const online = mqttStatus === 'online'

  function triggerAlert(zoneId: string) {
    if (!online) {
      toast('MQTT 离线，指令未能发出。', 'info')
      return
    }
    publishControl({
      action: 'TRIGGER_ALERT',
      zoneId,
      at: new Date().toISOString(),
      clientId: CLIENT_ID,
    })
    // 不在前端伪造状态或事件：点击只负责发送控制指令。
    // 模拟器收到后会立即推送一条 ALERT 级读数，事件由 syncReading
    // 在真实 MQTT 数据达到阈值时自动创建。
    toast(
      `已向 ${zoneId} 发送异常指令，等待 MQTT 数据确认后自动创建事件；若 5 秒内无变化，请确认模拟器正在运行。`,
      'info',
    )
  }

  function recoverAll() {
    publishControl({
      action: 'TRIGGER_RECOVERY',
      at: new Date().toISOString(),
      clientId: CLIENT_ID,
    })
    toast(
      online
        ? '已发送恢复指令：全部区域立即恢复发送正常数据。'
        : 'MQTT 离线，指令未能发出。',
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
          title={online ? `让 ${button.zoneId} 进入异常模式（3 次发送）` : 'MQTT 离线不可用'}
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
        title={online ? '全部区域立即恢复发送正常数据' : 'MQTT 离线不可用'}
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
            通过 MQTT 指令控制模拟器场景（airguard/control）
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
                title={online ? button.label : 'MQTT 离线不可用'}
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
              title={online ? '全部区域恢复正常' : 'MQTT 离线不可用'}
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
