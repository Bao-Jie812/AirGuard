import { SOURCE_DESCRIPTIONS, SOURCE_LABELS } from '../../domain/constants'
import type { DataSource } from '../../data/types'
import { SourceBadge } from './Badge'

const SOURCES: DataSource[] = [
  'SIMULATED',
  'PUBLIC',
  'MANUAL_OBSERVATION',
  'MODEL_OUTPUT',
]

export function SourceLegend({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? 'source-legend source-legend--compact' : 'source-legend'}>
      {SOURCES.map((source) => (
        <span
          className="source-legend__item"
          key={source}
          title={SOURCE_DESCRIPTIONS[source]}
        >
          <SourceBadge source={source} />
          <span>{SOURCE_LABELS[source]}</span>
        </span>
      ))}
    </div>
  )
}
