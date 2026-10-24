import type { ReactNode } from 'react'
import type {
  DataSource,
  EvidenceStatus,
  EventStatus,
  PriorityLevel,
  RunStatus,
  Severity,
  ZoneStatus,
} from '../../data/types'
import {
  EVIDENCE_STATUS_LABELS,
  EVENT_STATUS_LABELS,
  PRIORITY_LEVEL_LABELS,
  SEVERITY_LABELS,
  SOURCE_LABELS,
  ZONE_STATUS_LABELS,
} from '../../domain/constants'
import { cn } from '../../domain/format'

export type BadgeTone =
  | 'neutral'
  | 'info'
  | 'success'
  | 'warning'
  | 'danger'
  | 'violet'
  | 'teal'

interface BadgeProps {
  tone?: BadgeTone
  children: ReactNode
  dot?: boolean
  mono?: boolean
  title?: string
  className?: string
}

export function Badge({
  tone = 'neutral',
  children,
  dot = false,
  mono = false,
  title,
  className,
}: BadgeProps) {
  return (
    <span
      className={cn(
        'badge',
        `badge--${tone}`,
        mono && 'badge--mono',
        className,
      )}
      title={title}
    >
      {dot && <span className="badge__dot" aria-hidden="true" />}
      {children}
    </span>
  )
}

const ZONE_STATUS_TONES: Record<ZoneStatus, BadgeTone> = {
  NORMAL: 'success',
  WATCH: 'warning',
  ALERT: 'danger',
  CRITICAL: 'danger',
}

export function ZoneStatusBadge({ status }: { status: ZoneStatus }) {
  return (
    <Badge tone={ZONE_STATUS_TONES[status]} dot>
      {ZONE_STATUS_LABELS[status]}
    </Badge>
  )
}

const EVENT_STATUS_TONES: Record<EventStatus, BadgeTone> = {
  OPEN: 'info',
  HANDLING: 'warning',
  STILL_HANDLING: 'danger',
  RECOVERED: 'success',
  INSUFFICIENT_EVIDENCE: 'neutral',
}

export function EventStatusBadge({ status }: { status: EventStatus }) {
  return (
    <Badge tone={EVENT_STATUS_TONES[status]} dot>
      {EVENT_STATUS_LABELS[status]}
    </Badge>
  )
}

const PRIORITY_TONES: Record<PriorityLevel, BadgeTone> = {
  LOW: 'neutral',
  MEDIUM: 'info',
  HIGH: 'warning',
  CRITICAL: 'danger',
}

export function PriorityLevelBadge({ level }: { level: PriorityLevel }) {
  return (
    <Badge tone={PRIORITY_TONES[level]}>
      {PRIORITY_LEVEL_LABELS[level]}
    </Badge>
  )
}

const SEVERITY_TONES: Record<Severity, BadgeTone> = {
  LOW: 'neutral',
  MEDIUM: 'warning',
  HIGH: 'danger',
  CRITICAL: 'danger',
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <Badge tone={SEVERITY_TONES[severity]} dot>
      {SEVERITY_LABELS[severity]}
    </Badge>
  )
}

const EVIDENCE_STATUS_TONES: Record<EvidenceStatus, BadgeTone> = {
  VALID: 'success',
  STALE: 'warning',
  MISSING: 'neutral',
  TIMEOUT: 'danger',
  ERROR: 'danger',
}

export function EvidenceStatusBadge({ status }: { status: EvidenceStatus }) {
  return (
    <Badge tone={EVIDENCE_STATUS_TONES[status]} dot>
      {status} · {EVIDENCE_STATUS_LABELS[status]}
    </Badge>
  )
}

const SOURCE_TONES: Record<DataSource, BadgeTone> = {
  SIMULATED: 'neutral',
  PUBLIC: 'info',
  MANUAL_OBSERVATION: 'teal',
  MODEL_OUTPUT: 'violet',
}

export function SourceBadge({
  source,
  withLabel = false,
}: {
  source: DataSource
  withLabel?: boolean
}) {
  return (
    <Badge
      tone={SOURCE_TONES[source]}
      mono
      title={`${source} · ${SOURCE_LABELS[source]}`}
      className="source-badge"
    >
      {source}
      {withLabel && (
        <span className="source-badge__label">{SOURCE_LABELS[source]}</span>
      )}
    </Badge>
  )
}

const RUN_STATUS_TONES: Record<RunStatus, BadgeTone> = {
  SUCCESS: 'success',
  PARTIAL: 'warning',
  FAILED: 'danger',
}

const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  SUCCESS: '成功',
  PARTIAL: '部分降级',
  FAILED: '失败',
}

export function RunStatusBadge({ status }: { status: RunStatus }) {
  return (
    <Badge tone={RUN_STATUS_TONES[status]} dot>
      {RUN_STATUS_LABELS[status]}
    </Badge>
  )
}

export function ScenarioBadge({
  scenarioId,
  label,
}: {
  scenarioId: string
  label?: string
}) {
  return (
    <Badge tone="neutral" mono className="scenario-badge" title={label}>
      {scenarioId}
    </Badge>
  )
}
