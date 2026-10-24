export type DataSource =
  | 'SIMULATED'
  | 'PUBLIC'
  | 'MANUAL_OBSERVATION'
  | 'MODEL_OUTPUT'

export type EvidenceKind =
  | 'CURRENT'
  | 'HISTORY'
  | 'EXTERNAL'
  | 'RAG'
  | 'RULE'
  | 'ML'
  | 'MANUAL'

export type EvidenceStatus =
  | 'VALID'
  | 'STALE'
  | 'MISSING'
  | 'TIMEOUT'
  | 'ERROR'

export type ZoneStatus = 'NORMAL' | 'WATCH' | 'ALERT' | 'CRITICAL'

export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export type EventStatus =
  | 'OPEN'
  | 'HANDLING'
  | 'STILL_HANDLING'
  | 'RECOVERED'
  | 'INSUFFICIENT_EVIDENCE'

export type PriorityLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export type MetricKey = 'pm25' | 'co2' | 'crowdDensity'

export type ScenarioId = 'S1' | 'S2' | 'S3' | 'S4' | 'S5'

export type RunKind =
  | 'PRIORITY_ANALYSIS'
  | 'EVIDENCE_ANALYSIS'
  | 'RECOVERY_EVALUATION'
  | 'EVENT_CREATION'

export type RunStatus = 'SUCCESS' | 'PARTIAL' | 'FAILED'

export type ExecutionMode = 'SEEDED_DEMO' | 'LOCAL_DEMO'

export type ToolStatus =
  | 'SUCCESS'
  | 'TIMEOUT'
  | 'ERROR'
  | 'NO_SOURCE'
  | 'SKIPPED'

export interface SensorSnapshot {
  timestamp: string
  pm25: number
  co2: number
  crowdCount: number
  crowdDensity: number
  source: DataSource
}

export interface ZoneDefinition {
  zoneId: string
  name: string
  shortName: string
  building: string
  category: string
  description: string
  areaSqm: number
  map: {
    gridX: number
    gridY: number
  }
}

export interface HistoryPoint extends SensorSnapshot {
  ts: number
  timeLabel: string
}

export interface PriorityFactor {
  key: MetricKey | 'trend' | 'duration' | 'event'
  label: string
  contribution: number
  severity: number
  detail: string
}

export interface PriorityAssessment {
  zoneId: string
  score: number
  level: PriorityLevel
  zoneStatus: ZoneStatus
  rank: number
  factors: PriorityFactor[]
  primaryMetric: MetricKey
  primaryDelta: number
  anomalyDurationMinutes: number | null
  summary: string
}

export interface RecoveryThresholds {
  pm25: number
  co2: number
  crowdDensity: number
  consecutiveSamples: number
}

export interface RecoverySample {
  sampleId: string
  eventId: string
  actionId: string
  timestamp: string
  pm25: number
  co2: number
  crowdDensity: number
  source: DataSource
  quality: EvidenceStatus
  note?: string
}

export type ActionType =
  | 'VENTILATION'
  | 'WINDOW_OPEN'
  | 'INSPECTION'
  | 'CLEANING'
  | 'OTHER'

/**
 * Action 记录时刻的前置快照（最近一条 MQTT 读数）。
 * MQTT 实时历史被断线 / 刷新截断时，用它兜底计算「Action 前」数值。
 */
export interface ActionBaseline {
  ts: number
  pm25: number
  co2: number
  crowdDensity: number
  source: 'LIVE_READING' | 'SEED_DEMO'
}

export interface ActionRecord {
  actionId: string
  eventId: string
  zoneId: string
  type: ActionType
  title: string
  note: string
  operator: string
  actionAt: string
  createdAt: string
  executionMode: ExecutionMode
  /** 记录 Action 时的实时快照，随业务状态持久化到 localStorage */
  baseline?: ActionBaseline
}

export interface EventStatusEntry {
  at: string
  status: EventStatus
  reason: string
  runId?: string
}

export interface EnvironmentEvent {
  eventId: string
  zoneId: string
  title: string
  description: string
  severity: Severity
  status: EventStatus
  openedAt: string
  closedAt?: string
  scenarioId: ScenarioId | null
  primaryMetric: MetricKey
  thresholds: RecoveryThresholds
  limitations: string[]
  statusHistory: EventStatusEntry[]
}

export interface RecoveryCheck {
  key: MetricKey
  label: string
  threshold: number
  unit: string
  actual: number | null
  pass: boolean | null
}

export interface SampleEvaluation {
  sample: RecoverySample
  checks: RecoveryCheck[]
  pass: boolean | null
}

export interface RecoveryEvaluation {
  ruleId: string
  ruleVersion: string
  evaluatedAt: string
  action: ActionRecord | null
  actionAt: string | null
  validPostActionSampleCount: number
  requiredConsecutive: number
  trailingPassCount: number
  sampleEvaluations: SampleEvaluation[]
  outcomeStatus: EventStatus
  recoveredAt: string | null
  reason: string
  limitations: string[]
  coreEvidenceSufficient: boolean
}

export interface EvidenceCitation {
  docId: string
  title: string
  section: string
  snippet: string
  relevance: number
  note: string
}

export interface EvidenceField {
  label: string
  value: string
  tone?: 'default' | 'warning' | 'danger'
}

/** 证据卡附图（人工拍照留档）：压缩后的 dataURL，可随 MQTT 多端同步 */
export interface EvidenceImage {
  url: string
  alt: string
  caption?: string
}

export interface EvidenceItem {
  evidenceId: string
  zoneId: string
  kind: EvidenceKind
  source: DataSource
  status: EvidenceStatus
  title: string
  summary: string
  fields: EvidenceField[]
  observedAt: string
  validUntil?: string
  limitation?: string
  citations?: EvidenceCitation[]
  modelVersion?: string
  demoNote?: string
  /** 人工拍照留档的现场照片（压缩图） */
  image?: EvidenceImage
}

export interface EvidenceConflict {
  zoneId: string
  title: string
  items: {
    label: string
    verdict: string
    source: DataSource
    note: string
  }[]
  resolution: string
}

export interface RunVersionSet {
  app: string
  config: string
  data: string
  rule: string
  model: string
}

export interface RunEvidenceSnapshot {
  evidenceId: string
  kind: EvidenceKind
  source: DataSource
  status: EvidenceStatus
  title: string
  summary: string
  observedAt: string
  limitation?: string
}

export interface ToolCallRecord {
  callId: string
  tool: string
  mode: 'LOCAL' | 'SIMULATED'
  params: string
  status: ToolStatus
  startedAt: string
  durationMs: number
  outputSummary: string
}

export interface FailureRecord {
  code: string
  location: string
  affectedEvidence: string
  message: string
  impact: string
  degradation: string
  unaffectedFacts: string[]
}

export interface RuleResultDetail {
  label: string
  value: string
  pass?: boolean | null
}

export interface RuleResult {
  ruleId: string
  version: string
  outcome: string
  passed: boolean | null
  reason: string
  details: RuleResultDetail[]
}

export interface MlResult {
  modelVersion: string
  task: string
  output: string
  score: number | null
  confidence: string
  simulated: boolean
  note: string
}

export interface LlmExplain {
  generatedAt: string
  modelVersion: string
  mode: string
  text: string
  basedOn: string[]
  simulated: boolean
}

export interface FinalOutput {
  label: string
  tone: 'success' | 'warning' | 'danger' | 'neutral' | 'info'
  summary: string
  limitations: string[]
}

export interface RunTrace {
  runId: string
  kind: RunKind
  scenarioId: ScenarioId | null
  zoneId: string
  eventId?: string
  actionId?: string
  createdAt: string
  executionMode: ExecutionMode
  status: RunStatus
  trigger: string
  durationMs: number
  versions: RunVersionSet
  inputSnapshot: {
    title: string
    description: string
    fields: { label: string; value: string; source?: DataSource }[]
  }
  evidence: RunEvidenceSnapshot[]
  toolCalls: ToolCallRecord[]
  ruleResult: RuleResult
  mlResult: MlResult | null
  llmExplain: LlmExplain
  failures: FailureRecord[]
  finalOutput: FinalOutput
}

export interface StoreState {
  schemaVersion: number
  events: EnvironmentEvent[]
  actions: ActionRecord[]
  recoverySamples: RecoverySample[]
  runs: RunTrace[]
}
