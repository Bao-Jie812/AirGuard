/**
 * 图表序列预处理：
 * 1. 断档检测 —— 相邻点时间差超过阈值（默认 30 秒，即 6 个推送周期）时，
 *    在断档处插入 null 点，recharts 遇 null 自动断线，
 *    不会用直线强行连接两个相距甚远的点；
 * 2. 中值去尖刺 —— 窗口 3 的中值滤波，单点突跳（两侧邻居平稳、唯独本点
 *    直上直下）被局部中值替换；真实的持续越限（≥2 个连续高点）完整保留；
 * 3. 居中滑动平均 —— 每段连续数据内做窗口 7（≈35 秒）的居中均值，
 *    把瞬时阶跃展开为物理上合理的爬坡 / 回落曲线，抹掉单步抖动。
 *    居中窗口无相位滞后，峰位置不偏移；段首段尾用可用点自适应收窄。
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
const DEFAULT_SMOOTH_WINDOW = 7

function median3(a: number, b: number, c: number): number {
  return a + b + c - Math.min(a, b, c) - Math.max(a, b, c)
}

/** 单点尖刺替换为 (前, 本, 后) 的中值；首尾点无双侧邻居，保持原值 */
function medianDespike(points: SeriesPoint[]): SeriesPoint[] {
  return points.map((point, index) => {
    if (index === 0 || index === points.length - 1) return point
    const prev = points[index - 1]
    const next = points[index + 1]
    return {
      ...point,
      pm25: median3(prev.pm25, point.pm25, next.pm25),
      co2: median3(prev.co2, point.co2, next.co2),
      crowdDensity: median3(prev.crowdDensity, point.crowdDensity, next.crowdDensity),
    }
  })
}

/** 居中滑动平均：窗口不足时按可用点收窄，实时尾部不会产生滞后 */
function centeredMovingAverage(
  points: SeriesPoint[],
  window: number,
): SeriesPoint[] {
  const half = Math.floor(window / 2)
  return points.map((point, index) => {
    const start = Math.max(0, index - half)
    const end = Math.min(points.length - 1, index + half)
    const slice = points.slice(start, end + 1)
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
    // 先去尖刺再居中平滑：尖刺不进入均值窗口，避免污染两侧走势
    const despiked = medianDespike(segment)
    const smoothed =
      smoothWindow > 1 && segment.length >= smoothWindow
        ? centeredMovingAverage(despiked, smoothWindow)
        : despiked
    for (const point of smoothed) result.push({ ...point })
  })
  return result
}
