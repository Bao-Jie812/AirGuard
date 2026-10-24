/**
 * 图表序列预处理：
 * 1. 断档检测 —— 相邻点时间差超过阈值（默认 30 秒，即 6 个推送周期）时，
 *    在断档处插入 null 点，recharts 遇 null 自动断线，
 *    不会用直线强行连接两个相距甚远的点；
 * 2. 显示平滑 —— 每段连续数据内做尾部移动平均（默认 5 点 ≈ 25 秒窗口），
 *    抹掉单步抖动，让 5 秒粒度的密集序列呈现为连贯趋势。
 * 注意：平滑只影响图表展示，统计数值与 Recovery 判定仍使用原始数据。
 */

export interface SeriesPoint {
  ts: number
  pm25: number
  co2: number
  crowdDensity: number
}

/** 图表数据点：允许 null（断档），recharts 自动断线 */
export interface ChartSeriesPoint {
  ts: number
  pm25: number | null
  co2: number | null
  crowdDensity: number | null
  timestamp?: string
  timeLabel?: string
  crowdCount?: number
  source?: string
}

const DEFAULT_MAX_GAP_MS = 30_000
const DEFAULT_SMOOTH_WINDOW = 5

function movingAverage(points: SeriesPoint[], window: number): SeriesPoint[] {
  return points.map((point, index) => {
    const start = Math.max(0, index - window + 1)
    const slice = points.slice(start, index + 1)
    const mean = (pick: (p: SeriesPoint) => number) =>
      slice.reduce((sum, item) => sum + pick(item), 0) / slice.length
    return {
      ...point,
      pm25: Math.round(mean((p) => p.pm25) * 10) / 10,
      co2: Math.round(mean((p) => p.co2)),
      crowdDensity: Math.round(mean((p) => p.crowdDensity) * 100) / 100,
    }
  })
}

export function prepareChartSeries(
  points: SeriesPoint[],
  options: { maxGapMs?: number; smoothWindow?: number } = {},
): ChartSeriesPoint[] {
  const maxGapMs = options.maxGapMs ?? DEFAULT_MAX_GAP_MS
  const smoothWindow = options.smoothWindow ?? DEFAULT_SMOOTH_WINDOW
  if (points.length === 0) return []

  // 先按断档切分成连续段（移动平均绝不跨段，避免断网两侧互相污染）
  const segments: SeriesPoint[][] = [[points[0]]]
  for (let i = 1; i < points.length; i += 1) {
    if (points[i].ts - points[i - 1].ts > maxGapMs) {
      segments.push([])
    }
    segments[segments.length - 1].push(points[i])
  }

  const result: ChartSeriesPoint[] = []
  segments.forEach((segment, index) => {
    if (index > 0) {
      // 段间断点：recharts 在此处断开折线
      result.push({
        ts: segment[0].ts - 1,
        pm25: null,
        co2: null,
        crowdDensity: null,
      })
    }
    const smoothed =
      smoothWindow > 1 && segment.length >= smoothWindow
        ? movingAverage(segment, smoothWindow)
        : segment
    for (const point of smoothed) result.push({ ...point })
  })
  return result
}
