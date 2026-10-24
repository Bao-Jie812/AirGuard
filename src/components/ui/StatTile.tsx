import type { ReactNode } from 'react'
import { cn } from '../../domain/format'

interface StatTileProps {
  label: string
  value: ReactNode
  unit?: string
  hint?: ReactNode
  icon?: ReactNode
  tone?: 'default' | 'info' | 'warning' | 'danger' | 'success'
  accessory?: ReactNode
  className?: string
}

export function StatTile({
  label,
  value,
  unit,
  hint,
  icon,
  tone = 'default',
  accessory,
  className,
}: StatTileProps) {
  return (
    <div className={cn('stat-tile', `stat-tile--${tone}`, className)}>
      <div className="stat-tile__top">
        <span className="stat-tile__label">{label}</span>
        {icon && (
          <span className="stat-tile__icon" aria-hidden="true">
            {icon}
          </span>
        )}
      </div>
      <div className="stat-tile__value-row">
        <span className="stat-tile__value">{value}</span>
        {unit && <span className="stat-tile__unit">{unit}</span>}
        {accessory && <span className="stat-tile__accessory">{accessory}</span>}
      </div>
      {hint && <p className="stat-tile__hint">{hint}</p>}
    </div>
  )
}
