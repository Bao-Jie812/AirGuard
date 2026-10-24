import { useId } from 'react'

interface MiniSparklineProps {
  values: number[]
  color?: string
  width?: number
  height?: number
}

export function MiniSparkline({
  values,
  color = '#56779a',
  width = 104,
  height = 32,
}: MiniSparklineProps) {
  const gradientId = useId().replace(/:/g, '')
  if (values.length < 2) {
    return <span className="sparkline sparkline--empty">—</span>
  }

  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const step = width / (values.length - 1)
  const points = values.map((value, index) => {
    const x = index * step
    const y = height - 4 - ((value - min) / span) * (height - 8)
    return { x, y }
  })
  const line = points.map((point) => `${point.x},${point.y}`).join(' ')
  const area = `0,${height} ${line} ${width},${height}`

  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label="近期指标迷你趋势"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gradientId})`} />
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={points[points.length - 1].x}
        cy={points[points.length - 1].y}
        r="2.2"
        fill={color}
      />
    </svg>
  )
}
