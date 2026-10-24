import { cn } from '../../domain/format'

interface ProgressBarProps {
  value: number
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'info'
  height?: number
  label?: string
}

export function ProgressBar({
  value,
  tone = 'default',
  height = 6,
  label,
}: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, value))
  return (
    <div
      className={cn('progress', `progress--${tone}`)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      aria-label={label}
      style={{ height }}
    >
      <span className="progress__fill" style={{ width: `${clamped}%` }} />
    </div>
  )
}
