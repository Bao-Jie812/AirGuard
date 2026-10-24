import type { ReactNode } from 'react'
import { cn } from '../../domain/format'

interface SectionCardProps {
  title?: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  flush?: boolean
}

export function SectionCard({
  title,
  subtitle,
  action,
  children,
  className,
  bodyClassName,
  flush = false,
}: SectionCardProps) {
  return (
    <section className={cn('card', className)}>
      {(title || subtitle || action) && (
        <header className="card__header">
          <div className="card__heading">
            {title && <h2 className="card__title">{title}</h2>}
            {subtitle && <p className="card__subtitle">{subtitle}</p>}
          </div>
          {action && <div className="card__action">{action}</div>}
        </header>
      )}
      <div
        className={cn(
          'card__body',
          flush && 'card__body--flush',
          bodyClassName,
        )}
      >
        {children}
      </div>
    </section>
  )
}
