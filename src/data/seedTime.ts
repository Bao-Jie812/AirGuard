/**
 * 种子数据时间基准。
 *
 * 种子事件发生在「最近一个已经过去的 14:20 那一天」：
 * - 下午（>= 14:20）打开应用 → 使用今天；
 * - 上午打开应用 → 使用昨天，避免出现“未来事件”。
 * 所有种子记录共用同一天，时间线保持 10:15 → 10:40 → 14:20 的顺序。
 */
const LAST_EVENT_HOUR = 14
const LAST_EVENT_MINUTE = 20

function seedDay(): Date {
  const now = new Date()
  const day = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0,
    0,
    0,
    0,
  )
  const lastEvent = new Date(day)
  lastEvent.setHours(LAST_EVENT_HOUR, LAST_EVENT_MINUTE, 0, 0)
  if (now.getTime() < lastEvent.getTime()) {
    day.setDate(day.getDate() - 1)
  }
  return day
}

export function seedIsoAt(hour: number, minute: number): string {
  const date = seedDay()
  date.setHours(hour, minute, 0, 0)
  return date.toISOString()
}

export function seedDateStamp(): string {
  const day = seedDay()
  const year = day.getFullYear()
  const month = String(day.getMonth() + 1).padStart(2, '0')
  const date = String(day.getDate()).padStart(2, '0')
  return `${year}${month}${date}`
}
