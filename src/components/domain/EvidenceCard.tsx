import {
  Activity,
  BookOpen,
  Brain,
  Camera,
  CloudSun,
  History,
  ListChecks,
} from 'lucide-react'
import type { EvidenceItem, EvidenceKind } from '../../data/types'
import {
  EVIDENCE_KIND_LABELS,
  SOURCE_LABELS,
} from '../../domain/constants'
import { formatDateTime } from '../../domain/format'
import { EvidenceStatusBadge, SourceBadge } from '../ui/Badge'
import { cn } from '../../domain/format'

const KIND_ICONS: Record<
  EvidenceKind,
  typeof Activity
> = {
  CURRENT: Activity,
  HISTORY: History,
  EXTERNAL: CloudSun,
  RAG: BookOpen,
  RULE: ListChecks,
  ML: Brain,
  MANUAL: Camera,
}

interface EvidenceCardProps {
  item: EvidenceItem
  className?: string
}

export function EvidenceCard({ item, className }: EvidenceCardProps) {
  const Icon = KIND_ICONS[item.kind]
  return (
    <article
      className={cn(
        'evidence-card',
        `evidence-card--${item.status.toLowerCase()}`,
        className,
      )}
    >
      <header className="evidence-card__header">
        <span className="evidence-card__kind">
          <span className="evidence-card__kind-icon">
            <Icon size={15} />
          </span>
          {EVIDENCE_KIND_LABELS[item.kind]}
        </span>
        <span className="evidence-card__badges">
          <SourceBadge source={item.source} />
          <EvidenceStatusBadge status={item.status} />
        </span>
      </header>

      <div className="evidence-card__titles">
        <h3>{item.title}</h3>
        <p>{item.summary}</p>
      </div>

      {item.image && (
        <figure className="evidence-card__photo">
          <img src={item.image.url} alt={item.image.alt} loading="lazy" />
          {item.image.caption && (
            <figcaption>{item.image.caption}</figcaption>
          )}
        </figure>
      )}

      <dl className="evidence-fields">
        {item.fields.map((field) => (
          <div
            className={cn(
              'evidence-fields__row',
              field.tone === 'warning' && 'is-warning',
              field.tone === 'danger' && 'is-danger',
            )}
            key={`${item.evidenceId}-${field.label}`}
          >
            <dt>{field.label}</dt>
            <dd>{field.value}</dd>
          </div>
        ))}
      </dl>

      {item.citations && item.citations.length > 0 && (
        <div className="citation-list">
          {item.citations.map((citation) => (
            <blockquote className="citation" key={citation.docId}>
              <div className="citation__head">
                <span className="citation__doc">{citation.docId}</span>
                <span className="citation__relevance">
                  相关度 {citation.relevance.toFixed(2)}
                </span>
              </div>
              <p className="citation__title">
                {citation.title} · {citation.section}
              </p>
              <p className="citation__snippet">“{citation.snippet}”</p>
              <p className="citation__note">{citation.note}</p>
            </blockquote>
          ))}
        </div>
      )}

      {item.limitation && (
        <div className="evidence-card__limitation">
          <span>限制</span>
          <p>{item.limitation}</p>
        </div>
      )}

      <footer className="evidence-card__footer">
        <span className="evidence-card__time">
          观测 {formatDateTime(item.observedAt)}
          {item.validUntil
            ? ` · 有效至 ${formatDateTime(item.validUntil)}`
            : ''}
        </span>
        <span className="evidence-card__ids">
          {item.evidenceId}
          <span aria-hidden="true"> · </span>
          {item.modelVersion ?? SOURCE_LABELS[item.source]}
        </span>
        {item.demoNote && (
          <span className="evidence-card__demo">{item.demoNote}</span>
        )}
      </footer>
    </article>
  )
}
