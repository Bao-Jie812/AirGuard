import { cn } from '../../domain/format'

export function Skeleton({
  className,
  width,
  height,
}: {
  className?: string
  width?: string | number
  height?: number
}) {
  return (
    <span
      className={cn('skeleton', className)}
      style={{ width, height }}
      aria-hidden="true"
    />
  )
}

export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div className="skeleton-stack" aria-hidden="true">
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton
          key={index}
          height={12}
          width={index === lines - 1 ? '62%' : '100%'}
        />
      ))}
    </div>
  )
}

export function SkeletonChart({ height = 240 }: { height?: number }) {
  return (
    <div className="skeleton-chart" aria-hidden="true">
      <Skeleton height={height} />
      <div className="skeleton-chart__axis">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} width={34} height={9} />
        ))}
      </div>
    </div>
  )
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="skeleton-rows" aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div className="skeleton-row" key={index}>
          <Skeleton width={30} height={30} className="skeleton--round" />
          <div className="skeleton-row__copy">
            <Skeleton width="42%" height={12} />
            <Skeleton width="68%" height={10} />
          </div>
          <Skeleton width={54} height={20} className="skeleton--pill" />
        </div>
      ))}
    </div>
  )
}
