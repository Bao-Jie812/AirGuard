/**
 * 实时历史记录库（localStorage 持久化）。
 *
 * 每收到一条 MQTT 传感器消息，就把数据点追加到对应区域的
 * 历史序列中并持久化；刷新页面后历史不丢失，
 * Action 前后对比、趋势图、Priority 评估全部以这里的数据为准。
 */

export interface LivePoint {
  ts: number
  pm25: number
  co2: number
  crowdLevel: number
}

/**
 * v2：旧版本（v1）曾把前几次演示的异常数据持久化下来，
 * 刷新后仍参与 Priority 计算，导致启动即报 3 个区域异常。
 * 提升键名版本即一次性丢弃这些旧历史。
 */
const STORAGE_KEY = 'airguard.live.history.v2'
const LEGACY_STORAGE_KEYS = ['airguard.live.history.v1']

/** 每区域最多保留 720 点（5 秒间隔 ≈ 最近 60 分钟） */
export const MAX_POINTS_PER_ZONE = 720

/**
 * localStorage 归档上限（每区域）。
 * 内存里的实时序列只保留最近 60 分钟；归档额外保留更早的连续片段，
 * 供「Action 前后对比」在 MQTT 断线 / 刷新后仍能取到前后数据。
 * 2880 点 ≈ 4 小时（5 秒粒度）。
 */
const MAX_ARCHIVE_POINTS_PER_ZONE = 2880

/**
 * 旧会话判定：最后一条数据距今超过 60 秒，说明应用/模拟器已经停止过，
 * 旧序列不再代表“当前会话”，启动时不恢复为实时历史，保证 Priority 从干净状态开始。
 * 数据仍保留在归档中，历史图表与 Action 前后对比可以继续使用。
 */
const SESSION_STALE_MS = 60_000

/** 相邻点间隔超过 30 秒视为断档：只保留最后一段连续数据 */
const SEGMENT_GAP_MS = 30_000

type LiveHistoryMap = Record<string, LivePoint[]>

function isLivePoint(value: unknown): value is LivePoint {
  if (!value || typeof value !== 'object') return false
  const point = value as Partial<LivePoint>
  return (
    typeof point.ts === 'number' &&
    Number.isFinite(point.pm25) &&
    Number.isFinite(point.co2) &&
    Number.isFinite(point.crowdLevel)
  )
}

function purgeLegacyStorage(): void {
  for (const key of LEGACY_STORAGE_KEYS) {
    try {
      window.localStorage.removeItem(key)
    } catch {
      // 忽略不可用的存储
    }
  }
}

/**
 * 合并两段按时间升序排列的序列，按 ts 去重。
 * 用于把内存实时序列与 localStorage 归档拼成完整历史。
 */
export function mergeLivePoints(a: LivePoint[], b: LivePoint[]): LivePoint[] {
  const merged: LivePoint[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    const takeA = j >= b.length || (i < a.length && a[i].ts <= b[j].ts)
    const next = takeA ? a[i] : b[j]
    if (takeA) i += 1
    else j += 1
    if (merged.length === 0 || next.ts > merged[merged.length - 1].ts) {
      merged.push(next)
    }
  }
  return merged
}

/** 读取 localStorage 中的全部有效历史（不做旧会话过滤，最多保留归档上限） */
function readStoredHistory(): LiveHistoryMap {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const result: LiveHistoryMap = {}
    for (const [zoneId, points] of Object.entries(parsed)) {
      if (!Array.isArray(points)) continue
      const valid = points
        .filter(isLivePoint)
        .sort((a, b) => a.ts - b.ts)
      if (valid.length === 0) continue
      result[zoneId] = mergeLivePoints([], valid).slice(
        -MAX_ARCHIVE_POINTS_PER_ZONE,
      )
    }
    return result
  } catch {
    return {}
  }
}

/**
 * 恢复「当前会话」的实时历史。
 * 旧会话数据不进入实时状态，避免启动瞬间用上一次的异常值把区域染红；
 * 这些数据仍保留在归档里，供历史图表与 Action 前后对比使用。
 */
export function loadLiveHistory(): LiveHistoryMap {
  purgeLegacyStorage()
  const stored = readStoredHistory()
  const now = Date.now()
  const result: LiveHistoryMap = {}
  for (const [zoneId, points] of Object.entries(stored)) {
    const latest = points[points.length - 1]
    if (now - latest.ts > SESSION_STALE_MS) continue

    // 只保留最后一段连续数据，避免断档前后的序列被当成实时连续曲线。
    let startIndex = 0
    for (let i = points.length - 1; i > 0; i -= 1) {
      if (points[i].ts - points[i - 1].ts > SEGMENT_GAP_MS) {
        startIndex = i
        break
      }
    }
    result[zoneId] = points.slice(startIndex).slice(-MAX_POINTS_PER_ZONE)
  }
  return result
}

/**
 * 读取 localStorage 完整历史归档（含已结束的旧会话）。
 * 仅供趋势图与 Action 前后对比兜底，不参与实时 Priority 评估。
 */
export function loadHistoryArchive(): LiveHistoryMap {
  purgeLegacyStorage()
  return readStoredHistory()
}

export function saveLiveHistory(histories: LiveHistoryMap): void {
  try {
    // 与已有归档合并后再写入：histories 只包含当前会话，
    // 直接覆盖会把刷新 / 断线前的历史快照丢掉。
    const archived = readStoredHistory()
    const merged: LiveHistoryMap = { ...archived }
    for (const [zoneId, points] of Object.entries(histories)) {
      if (points.length === 0) continue
      merged[zoneId] = mergeLivePoints(archived[zoneId] ?? [], points).slice(
        -MAX_ARCHIVE_POINTS_PER_ZONE,
      )
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
  } catch {
    // 存储不可用（隐私模式等）时退化为内存记录，不影响实时功能
  }
}

export function appendLivePoint(
  histories: LiveHistoryMap,
  zoneId: string,
  point: LivePoint,
): LiveHistoryMap {
  const points = histories[zoneId] ?? []
  // 只接受严格递增的时间戳：MQTT 重发、重复模拟器实例或乱序报文
  // 不会把序列写乱，也不会让旧值覆盖新值。
  if (points.length > 0 && point.ts <= points[points.length - 1].ts) {
    return histories
  }
  return {
    ...histories,
    [zoneId]: [...points, point].slice(-MAX_POINTS_PER_ZONE),
  }
}

export function clearLiveHistory(): void {
  purgeLegacyStorage()
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // 忽略
  }
}
