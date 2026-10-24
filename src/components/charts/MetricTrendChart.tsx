import { useId } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { MetricKey } from '../../data/types'
import type { ChartSeriesPoint } from '../../domain/chartSeries'
import { METRIC_META } from '../../domain/constants'
import {
  formatDateTimeFromMs,
  formatNumber,
  formatTime,
} from '../../domain/format'

export interface ChartMarker {
  at: string
  type: 'event' | 'action' | 'recovery' | 'evaluation'
  label: string
}

interface MetricTrendChartProps {
  data: ChartSeriesPoint[]
  metric: MetricKey
  color: string
  markers?: ChartMarker[]
  height?: number
  syncId?: string
  showThresholds?: boolean
}

const MARKER_COLORS = {
  event: '#b7791f',
  action: '#3b6e8f',
  recovery: '#2f7a5f',
  evaluation: '#7a76a2',
}

export function MetricTrendChart({
  data,
  metric,
  color,
  markers = [],
  height = 220,
  syncId,
  showThresholds = true,
}: MetricTrendChartProps) {
  const rawId = useId()
  const gradientId = `chart-gradient-${rawId.replace(/:/g, '')}`
  const meta = METRIC_META[metric]
  const firstTs = data[0]?.ts ?? 0
  const lastTs = data[data.length - 1]?.ts ?? 0
  const visibleMarkers = markers
    .map((marker) => ({
      ...marker,
      ts: new Date(marker.at).getTime(),
    }))
    .filter((marker) => marker.ts >= firstTs && marker.ts <= lastTs)

  return (
    <div className="chart-wrap" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 12, right: 14, bottom: 2, left: 0 }}
          syncId={syncId}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.22" />
              <stop offset="100%" stopColor={color} stopOpacity="0.01" />
            </linearGradient>
          </defs>
          <CartesianGrid
            stroke="#e7edf2"
            strokeDasharray="3 4"
            vertical={false}
          />
          <XAxis
            dataKey="ts"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(value) => formatTime(new Date(Number(value)).toISOString())}
            tick={{ fontSize: 11, fill: '#7a8b98' }}
            tickLine={false}
            axisLine={{ stroke: '#dfe7ee' }}
            minTickGap={48}
            tickCount={7}
          />
          <YAxis
            width={48}
            domain={[0, 'auto']}
            tick={{ fontSize: 11, fill: '#7a8b98' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) =>
              formatNumber(Number(value), meta.digits === 2 ? 1 : 0)
            }
          />
          <Tooltip
            cursor={{ stroke: '#9fb2c0', strokeDasharray: '3 3' }}
            contentStyle={{
              borderRadius: 10,
              border: '1px solid #dfe7ee',
              boxShadow: '0 12px 32px -18px rgba(24, 50, 68, 0.35)',
              fontSize: 12,
              padding: '8px 10px',
            }}
            labelStyle={{ color: '#5b6d7b', marginBottom: 4 }}
            formatter={(value) => [
              `${formatNumber(Number(value), meta.digits)} ${meta.unit}`,
              meta.shortLabel,
            ]}
            labelFormatter={(label) =>
              formatDateTimeFromMs(Number(label))
            }
          />
          {showThresholds && (
            <ReferenceLine
              y={meta.alert}
              stroke="#d5b98f"
              strokeDasharray="5 4"
              strokeWidth={1}
            />
          )}
          {visibleMarkers.map((marker) => (
            <ReferenceLine
              key={`${marker.type}-${marker.at}`}
              x={marker.ts}
              stroke={MARKER_COLORS[marker.type]}
              strokeDasharray="4 4"
              strokeWidth={1.2}
            />
          ))}
          <Area
            type="monotone"
            dataKey={metric}
            stroke={color}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={false}
            connectNulls={false}
            activeDot={{ r: 3.5, strokeWidth: 2, fill: '#fff' }}
            isAnimationActive
            animationDuration={420}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export function ChartMarkerLegend({ markers }: { markers: ChartMarker[] }) {
  const unique = Array.from(
    new Map(markers.map((marker) => [`${marker.type}-${marker.at}`, marker])).values(),
  )
  if (unique.length === 0) return null
  return (
    <div className="marker-legend">
      <span className="marker-legend__label">时间标记</span>
      {unique.map((marker) => (
        <span
          className="marker-legend__item"
          key={`${marker.type}-${marker.at}`}
        >
          <span
            className="marker-legend__line"
            style={{
              borderTopColor: MARKER_COLORS[marker.type],
            }}
          />
          {marker.label}
        </span>
      ))}
      <span className="marker-legend__item marker-legend__item--static">
        <span className="marker-legend__line marker-legend__line--static" />
        警戒阈值
      </span>
    </div>
  )
}
