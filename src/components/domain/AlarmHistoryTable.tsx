import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import { getZone, ZONES } from '../../data/zones'
import { ZONE_STATUS_LABELS } from '../../domain/constants'
import { formatNumber } from '../../domain/format'
import { effectiveZoneStatus } from '../../domain/priority'
import { useAppStore } from '../../state/AppStore'
import { useLiveData } from '../../state/LiveDataContext'
import { getActiveEvents } from '../../state/selectors'
import { MiniSparkline } from '../ui/MiniSparkline'
import { cn } from '../../domain/format'

const TREND_COLOR: Record<string, string> = {
  NORMAL: '#0d9b86',
  WATCH: '#e5a93c',
  ALERT: '#e2703a',
  CRITICAL: '#d9534f',
}

/** 区域实时告警概览：基于 MQTT 实时 Priority + 未关闭事件（无任何演示换算） */
export function useDeviceAlarmStats() {
  const { priorities } = useLiveData()
  const { state } = useAppStore()
  const activeEvents = getActiveEvents(state)
  const total = ZONES.length
  // 与 2D/3D 地图同一口径：未关闭事件把区域顶入高告警（OPEN=严重、处置中=警戒），
  // 即使瞬时指标已回落也计入——否则地图全红时这里仍显示「0 个区域高告警」。
  const high = priorities.filter((item) => {
    const status = effectiveZoneStatus(
      item.zoneStatus,
      activeEvents.filter((event) => event.zoneId === item.zoneId),
    )
    return status === 'ALERT' || status === 'CRITICAL'
  }).length
  return { total, high }
}

export function DeviceAlarmSlider() {
  const { total, high } = useDeviceAlarmStats()
  const ratio = Math.min(0.96, Math.max(0.04, high / (total || 1)))

  return (
    <div className="alarm-slider" role="img" aria-label={`${high} 个区域处于高告警`}>
      <span className="alarm-slider__tip" style={{ left: `${ratio * 100}%` }}>
        {high} 个区域高告警
      </span>
      <div className="alarm-slider__track">
        <span
          className="alarm-slider__marker"
          style={{ left: `${ratio * 100}%` }}
        />
      </div>
      <div className="alarm-slider__scale">
        <span>正常</span>
        <span>高告警</span>
      </div>
    </div>
  )
}

export function AlarmHistoryTable() {
  const { priorities, histories, readings } = useLiveData()

  const rows = priorities.map((item) => {
    const zone = getZone(item.zoneId)
    const tail = (histories[item.zoneId] ?? [])
      .slice(-12)
      .map((point) => point.pm25)
    const reading = readings[item.zoneId]
    // 刷新后 readings 可能尚未恢复，用同一份 MQTT 历史的最新点兜底
    const latest =
      reading?.pm25 ?? (tail.length > 0 ? tail[tail.length - 1] : null)
    const previous = tail.length >= 2 ? tail[tail.length - 2] : null
    const rising =
      latest !== null && previous !== null
        ? latest > previous
          ? 'up'
          : latest < previous
            ? 'down'
            : 'flat'
        : 'flat'
    return {
      zoneId: item.zoneId,
      name: zone.shortName,
      status: item.zoneStatus,
      latest,
      rising,
      tail,
    }
  })

  return (
    <div className="alarm-table-wrap">
      <table className="alarm-table">
        <thead>
          <tr>
            <th>区域</th>
            <th>状态</th>
            <th>PM2.5 实时</th>
            <th>趋势</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.zoneId}>
              <td>
                <span className="alarm-table__zone">
                  <span
                    className="alarm-table__dot"
                    style={{ background: TREND_COLOR[row.status] }}
                    title={ZONE_STATUS_LABELS[row.status]}
                  />
                  {row.name}
                </span>
              </td>
              <td>{ZONE_STATUS_LABELS[row.status]}</td>
              <td>
                <span className="alarm-table__count">
                  {row.latest === null ? '—' : formatNumber(row.latest)}
                  {row.rising === 'up' ? (
                    <ArrowUp size={13} className="alarm-table__arrow alarm-table__arrow--up" />
                  ) : row.rising === 'down' ? (
                    <ArrowDown size={13} className="alarm-table__arrow alarm-table__arrow--down" />
                  ) : (
                    <Minus size={13} className="alarm-table__arrow" />
                  )}
                </span>
              </td>
              <td>
                <MiniSparkline
                  values={row.tail}
                  color={TREND_COLOR[row.status]}
                  width={118}
                  height={30}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={cn('alarm-table__note')}>
        数据来自 MQTT 实时流 · 「—」表示等待模拟器推送
      </p>
    </div>
  )
}
