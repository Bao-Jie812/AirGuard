import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'

interface PageIntroProps {
  eyebrow?: string
  title: string
  description?: ReactNode
  actions?: ReactNode
  backTo?: string
  backLabel?: string
}

export function PageIntro({
  eyebrow,
  title,
  description,
  actions,
  backTo,
  backLabel = '返回',
}: PageIntroProps) {
  return (
    <div className="page-intro">
      <div className="page-intro__copy">
        {backTo && (
          <Link className="back-link" to={backTo}>
            <ChevronLeft size={15} />
            {backLabel}
          </Link>
        )}
        {eyebrow && <p className="page-intro__eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="page-intro__description">{description}</p>}
      </div>
      {actions && <div className="page-intro__actions">{actions}</div>}
    </div>
  )
}
