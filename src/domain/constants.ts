import type {
  EvidenceKind,
  EvidenceStatus,
  EventStatus,
  MetricKey,
  PriorityLevel,
  RunKind,
  Severity,
  ZoneStatus,
  ActionType,
  DataSource,
} from '../data/types'

export const APP_NAME = 'AirGuard'
export const APP_SUBTITLE = '多区域环境与人流智能分析'
export const APP_VERSION = '0.1.0-phase1'
export const APP_BUILD = 'phase-1-prototype'
export const RULE_VERSION = 'recovery-rule/1.0.0'
export const RULE_ID = 'RECOVERY-CORE-METRICS'
export const ML_MODEL_VERSION = 'zscore-anomaly/1.0.0'
export const LLM_EXPLAIN_VERSION = 'explain-template-0.1 (未调用真实 LLM)'
export const CONFIG_VERSION = 'cfg-demo-20261019-a'
export const DATA_VERSION = 'sim-20261019-1430'
export const STORAGE_KEY = 'airguard.phase1.store'
/**
 * 业务状态 schema 版本。
 * 版本不匹配时 AppStore 直接回退到空种子状态 —— 这也是清除
 * 旧版本遗留在 localStorage 中的历史事件 / Action 的迁移手段。
 * v9：启动时注入经过业务校验的种子事件 / Action / Run Trace。
 */
export const SCHEMA_VERSION = 9
export const APP_TIMEZONE = 'Asia/Shanghai'

export const METRIC_META: Record<
  MetricKey,
  {
    label: string
    shortLabel: string
    unit: string
    watch: number
    alert: number
    critical: number
    digits: number
  }
> = {
  pm25: {
    label: 'PM2.5',
    shortLabel: 'PM2.5',
    unit: 'μg/m³',
    watch: 35,
    alert: 75,
    critical: 115,
    digits: 0,
  },
  co2: {
    label: 'CO₂ 浓度',
    shortLabel: 'CO₂',
    unit: 'ppm',
    watch: 800,
    alert: 1000,
    critical: 1500,
    digits: 0,
  },
  crowdDensity: {
    label: '人流密度',
    shortLabel: '人流',
    unit: '人/㎡',
    watch: 0.5,
    alert: 0.8,
    critical: 1,
    digits: 2,
  },
}

export const METRIC_ORDER: MetricKey[] = ['pm25', 'co2', 'crowdDensity']

/**
 * 实时环境指标进度条：max 为满刻度；超过 orange 变橙、超过 red 变红。
 * 区域总览关注卡与右栏分析面板共用同一份配置。
 */
export const METRIC_BAR_LIMITS: Record<
  MetricKey,
  { max: number; orange: number; red: number }
> = {
  pm25: { max: 150, orange: 75, red: 150 },
  co2: { max: 1500, orange: 1000, red: 1500 },
  crowdDensity: { max: 1.0, orange: 0.5, red: 0.8 },
}

export const SOURCE_LABELS: Record<DataSource, string> = {
  SIMULATED: '模拟数据',
  PUBLIC: '公开数据',
  MANUAL_OBSERVATION: '人工观察',
  MODEL_OUTPUT: '模型输出',
}

export const SOURCE_DESCRIPTIONS: Record<DataSource, string> = {
  SIMULATED: '由本地模拟器生成的演示数据，不代表真实传感器读数。',
  PUBLIC: '演示用外部公开数据快照，本阶段未连接真实外部 API。',
  MANUAL_OBSERVATION: '人工记录或现场观察，不等同于传感器事实。',
  MODEL_OUTPUT: '模型推断输出，属于辅助信号，不是已确认事实。',
}

export const EVIDENCE_KIND_LABELS: Record<EvidenceKind, string> = {
  CURRENT: '当前快照',
  HISTORY: '历史序列',
  EXTERNAL: '外部证据',
  RAG: '知识引用',
  RULE: '规则判断',
  ML: '模型输出',
  MANUAL: '人工观察',
}

export const EVIDENCE_STATUS_LABELS: Record<EvidenceStatus, string> = {
  VALID: '有效',
  STALE: '已过期',
  MISSING: '缺失',
  TIMEOUT: '超时',
  ERROR: '错误',
}

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  OPEN: '待处置',
  HANDLING: '处置中',
  STILL_HANDLING: '仍未恢复',
  RECOVERED: '已恢复',
  INSUFFICIENT_EVIDENCE: '证据不足',
}

export const ZONE_STATUS_LABELS: Record<ZoneStatus, string> = {
  NORMAL: '正常',
  WATCH: '关注',
  ALERT: '警戒',
  CRITICAL: '严重',
}

export const PRIORITY_LEVEL_LABELS: Record<PriorityLevel, string> = {
  LOW: '低',
  MEDIUM: '中',
  HIGH: '高',
  CRITICAL: '极高',
}

export const SEVERITY_LABELS: Record<Severity, string> = {
  LOW: '低',
  MEDIUM: '中',
  HIGH: '高',
  CRITICAL: '严重',
}

export const ACTION_TYPE_LABELS: Record<ActionType, string> = {
  VENTILATION: '通风调节',
  WINDOW_OPEN: '开窗通风',
  INSPECTION: '现场检查',
  CLEANING: '清洁处置',
  OTHER: '其他',
}

export const RUN_KIND_LABELS: Record<RunKind, string> = {
  PRIORITY_ANALYSIS: 'Priority 分析',
  EVIDENCE_ANALYSIS: '证据分析',
  RECOVERY_EVALUATION: 'Recovery 重新评估',
  EVENT_CREATION: 'Event 创建',
}

export const SCENARIO_LABELS: Record<string, string> = {
  S1: '多区域稳态基线',
  S2: '持续演化与关注跃迁',
  S3: '外部证据介入',
  S4: '多源证据分歧',
  S5: '处置后验与可信降级',
}

export const ZONE_COLORS: Record<string, string> = {
  'zone-s': '#6f8b70',
  'zone-w': '#b37a58',
  'zone-n': '#7a76a2',
}

/** 状态颜色：2D 定位点、3D 屋顶色条与图例共用同一套值 */
export const ZONE_STATUS_COLORS: Record<ZoneStatus, string> = {
  NORMAL: '#0d9b86',
  WATCH: '#e5a93c',
  ALERT: '#e2703a',
  CRITICAL: '#d9534f',
}
