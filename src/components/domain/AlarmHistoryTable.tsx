import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import { getZone, ZONES } from '../../data/zones'
import { ZONE_STATUS_COLORS, ZONE_STATUS_LABELS } from '../../domain/constants'
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
  const rows = priorities.map((item) => ({
    item,
    status: effectiveZoneStatus(
      item.zoneStatus,
      activeEvents.filter((event) => event.zoneId === item.zoneId),
    ),
  }))
  // 高告警只对应真实危险：指标已达 ALERT/CRITICAL，或 Priority 达到危险分数线。
  // 读数回落后仅剩未关闭事件的区域仍显示“警戒”，但只计入“需警戒”，不再夸大为高告警。
  const high = rows.filter(({ item }) =>
    item.score >= 50 || item.zoneStatus === 'ALERT' || item.zoneStatus === 'CRITICAL',
  ).length
  const warning = rows.filter(({ item, status }) =>
    item.score < 50 &&
    item.zoneStatus !== 'ALERT' &&
    item.zoneStatus !== 'CRITICAL' &&
    status !== 'NORMAL',
  ).length
  return { total, high, warning }
}

export function DeviceAlarmSlider() {
  const { total, high, warning } = useDeviceAlarmStats()
  const count = high > 0 ? high : warning
  const label = high > 0 ? '高告警' : warning > 0 ? '需警戒' : '高告警'
  const color = high > 0
    ? ZONE_STATUS_COLORS.CRITICAL
    : warning > 0
      ? ZONE_STATUS_COLORS.ALERT
      : ZONE_STATUS_COLORS.NORMAL
  const ratio = Math.min(0.96, Math.max(0.04, count / (total || 1)))

  return (
    <div className="alarm-slider" role="img" aria-label={`${count} 个区域${label}`}>
      <span className="alarm-slider__tip" style={{ left: `${ratio * 100}%` }}>
        {count} 个区域{label}
      </span>
      <div className="alarm-slider__track">
        <span
          className="alarm-slider__marker"
          style={{ left: `${ratio * 100}%`, borderColor: color }}
        />
      </div>
      <div className="alarm-slider__scale">
        <span>正常</span>
        <span>{label}</span>
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
    const isStale = item.summary.startsWith('STALE')
    // 离线时不再用历史最后一点冒充当前值；在线但 readings 尚未恢复时才用历史兜底。
    const latest = isStale
      ? null
      : reading?.pm25 ?? (tail.length > 0 ? tail[tail.length - 1] : null)
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
      isStale,
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
                    title={row.isStale ? 'STALE · 数据离线' : ZONE_STATUS_LABELS[row.status]}
                  />
                  {row.name}
                </span>
              </td>
              <td>{row.isStale ? 'STALE · 数据离线' : ZONE_STATUS_LABELS[row.status]}</td>
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
