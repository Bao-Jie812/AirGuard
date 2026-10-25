import type { MetricKey } from '../../data/types'
import type { ChartSeriesPoint } from '../../domain/chartSeries'
import { BoardChart } from '../domain/LiveBoard'

interface H5TrendChartProps {
  data: ChartSeriesPoint[]
  metric: MetricKey
  color: string
  height?: number
}

/**
 * H5 现场端迷你趋势图。
 * 直接复用 Web 端 LiveBoard 的 BoardChart——Y 轴自适应 domain、
 * X 轴时间数值轴、浅灰网格、平滑曲线，两端渲染逻辑 100% 一致，
 * 仅容器高度不同（H5 默认 150px）。
 */
export function H5TrendChart({
  data,
  metric,
  color,
  height = 150,
}: H5TrendChartProps) {
  return (
    <div className="h5-trend-chart" style={{ height }}>
      <BoardChart
        rows={data}
        metric={metric}
        color={color}
        className="h5-trend-chart__inner"
      />
    </div>
  )
}
