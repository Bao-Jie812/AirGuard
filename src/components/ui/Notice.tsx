import type { ReactNode } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
} from 'lucide-react'
import { cn } from '../../domain/format'

export type NoticeTone = 'info' | 'warning' | 'danger' | 'success'

interface NoticeProps {
  tone?: NoticeTone
  title?: ReactNode
  children: ReactNode
  className?: string
  compact?: boolean
}

function NoticeIcon({ tone }: { tone: NoticeTone }) {
  if (tone === 'danger') return <AlertCircle size={18} />
  if (tone === 'warning') return <AlertTriangle size={18} />
  if (tone === 'success') return <CheckCircle2 size={18} />
  return <Info size={18} />
}

export function Notice({
  tone = 'info',
  title,
  children,
  className,
  compact = false,
}: NoticeProps) {
  return (
    <div
      className={cn(
        'notice',
        `notice--${tone}`,
        compact && 'notice--compact',
        className,
      )}
    >
      <span className="notice__icon" aria-hidden="true">
        <NoticeIcon tone={tone} />
      </span>
      <div className="notice__content">
        {title && <p className="notice__title">{title}</p>}
        <div className="notice__body">{children}</div>
      </div>
    </div>
  )
}
