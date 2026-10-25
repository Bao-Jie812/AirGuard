import { APP_TIMEZONE } from './constants'

const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: APP_TIMEZONE,
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const fullDateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: APP_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: APP_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const timeWithSecondsFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: APP_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: APP_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function formatDateTime(iso: string): string {
  return dateTimeFormatter.format(new Date(iso)).replace(/\//g, '-')
}

export function formatFullDateTime(iso: string): string {
  return fullDateTimeFormatter.format(new Date(iso)).replace(/\//g, '-')
}

export function formatTime(iso: string): string {
  return timeFormatter.format(new Date(iso))
}

export function formatDate(iso: string): string {
  return dateFormatter.format(new Date(iso)).replace(/\//g, '-')
}

export function formatTimeFromMs(ts: number): string {
  return timeFormatter.format(new Date(ts))
}

export function formatTimeWithSecondsFromMs(ts: number): string {
  return timeWithSecondsFormatter.format(new Date(ts))
}

export function formatDateTimeFromMs(ts: number): string {
  return dateTimeFormatter.format(new Date(ts)).replace(/\//g, '-')
}

export function formatNumber(value: number, digits = 0): string {
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function formatMetricValue(value: number, digits: number): string {
  return formatNumber(value, digits)
}

export function formatDelta(value: number, digits = 0): string {
  if (Math.abs(value) < Math.pow(10, -digits) / 2) return '0'
  const rounded = Number(value.toFixed(digits))
  return `${rounded > 0 ? '+' : ''}${formatNumber(rounded, digits)}`
}

export function formatDuration(minutes: number): string {
  if (minutes < 1) return '不足 1 分钟'
  const total = Math.round(minutes)
  const hours = Math.floor(total / 60)
  const rest = total % 60
  if (hours === 0) return `${rest} 分钟`
  if (rest === 0) return `${hours} 小时`
  return `${hours} 小时 ${rest} 分钟`
}

export function minutesBetween(fromIso: string, toIso: string): number {
  return Math.round(
    (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60000,
  )
}

export function formatRelativeToNow(iso: string): string {
  const minutes = Math.round(
    (Date.now() - new Date(iso).getTime()) / 60000,
  )
  if (minutes <= 0) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} 小时前` : `${hours} 小时 ${rest} 分钟前`
}

export function isoToTs(iso: string): number {
  return new Date(iso).getTime()
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ')
}
