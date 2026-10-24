import { useState } from 'react'
import { Fan, MoreHorizontal, PanelTopOpen, Zap } from 'lucide-react'
import type { ActionType, EnvironmentEvent } from '../../data/types'
import { CLIENT_ID } from '../../services/mqttClient'
import { useAppStore } from '../../state/AppStore'
import { useLiveData } from '../../state/LiveDataContext'
import { useToast } from '../../state/ToastContext'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { cn } from '../../domain/format'

interface QuickOption {
  type: ActionType
  label: string
  hint: string
  icon: typeof Fan
}

const QUICK_OPTIONS: QuickOption[] = [
  {
    type: 'VENTILATION',
    label: '开启排风',
    hint: '启动区域机械通风 / 排风设备',
    icon: Fan,
  },
  {
    type: 'WINDOW_OPEN',
    label: '开窗通风',
    hint: '打开窗户自然通风，加速换气散热',
    icon: PanelTopOpen,
  },
  {
    type: 'OTHER',
    label: '其他',
    hint: '其他现场处置动作',
    icon: MoreHorizontal,
  },
]

interface DispositionButtonProps {
  event: EnvironmentEvent
  /** 触发按钮样式：Web 详情页用 primary，H5 用大号块按钮 */
  block?: boolean
  onDone?: () => void
}

/**
 * 【记录处置动作】快速按钮：
 * 确认后事件 OPEN → HANDLING，记录 action_at，
 * 并通过 MQTT 发布到 airguard/event/[zoneId] 供多端同步。
 */
export function DispositionButton({
  event,
  block = false,
  onDone,
}: DispositionButtonProps) {
  const { recordAction } = useAppStore()
  const { publishDisposition, publishControl, mqttStatus } = useLiveData()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<ActionType>('VENTILATION')

  const disabled = event.status === 'RECOVERED'

  function handleConfirm() {
    const option = QUICK_OPTIONS.find((item) => item.type === selected)
    const label = option?.label ?? '处置动作'
    const actionAt = new Date().toISOString()
    const result = recordAction(event.eventId, {
      type: selected,
      title: `快速处置：${label}`,
      note: '通过【记录处置动作】按钮登记。',
      operator: '现场值班组',
      at: actionAt,
    })
    if (!result.ok) {
      toast(result.message, 'warning')
      return
    }
    publishDisposition(event.zoneId, {
      zoneId: event.zoneId,
      eventId: event.eventId,
      type: selected,
      actionAt,
      status: 'HANDLING',
      operator: '现场值班组',
      clientId: CLIENT_ID,
    })
    // 联动演戏：通知模拟器该区域进入恢复模式，
    // 接下来的数据将强制达标，Recovery 评估即可判定恢复
    publishControl({
      action: 'START_RECOVERY',
      zoneId: event.zoneId,
      eventId: event.eventId,
      at: actionAt,
      clientId: CLIENT_ID,
    })
    setOpen(false)
    toast(
      mqttStatus === 'online'
        ? `已记录处置动作（${label}），事件进入处置中，并通过 MQTT 同步到其他终端。`
        : `已记录处置动作（${label}），事件进入处置中；MQTT 离线，暂无法多端同步。`,
      'success',
    )
    onDone?.()
  }

  return (
    <>
      <Button
        variant="primary"
        size={block ? 'lg' : 'md'}
        icon={<Zap size={16} />}
        className={cn(block && 'disposition-button--block')}
        onClick={() => {
          if (disabled) {
            toast('已恢复事件不需要再记录处置动作。', 'info')
            return
          }
          setSelected('VENTILATION')
          setOpen(true)
        }}
        disabled={disabled}
        title={disabled ? '事件已恢复' : '记录处置动作并多端同步'}
      >
        记录处置动作
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="记录处置动作"
        description={`确认后事件 ${event.eventId} 将从「待处置」更新为「处置中」，并通过 MQTT 同步到其他终端。`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={handleConfirm}>
              确认处置
            </Button>
          </>
        }
      >
        <div className="disposition-options">
          {QUICK_OPTIONS.map((option) => {
            const Icon = option.icon
            return (
              <button
                key={option.type}
                type="button"
                className={cn(
                  'disposition-option',
                  selected === option.type && 'disposition-option--active',
                )}
                onClick={() => setSelected(option.type)}
                aria-pressed={selected === option.type}
              >
                <span className="disposition-option__icon">
                  <Icon size={18} />
                </span>
                <span className="disposition-option__text">
                  <strong>{option.label}</strong>
                  <small>{option.hint}</small>
                </span>
              </button>
            )
          })}
        </div>
      </Modal>
    </>
  )
}
