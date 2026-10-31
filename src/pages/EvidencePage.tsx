import { useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ArrowRight,
  Camera,
  CloudSun,
  Divide,
  Filter,
  Info,
  RefreshCw,
} from 'lucide-react'
import { EvidenceCard } from '../components/domain/EvidenceCard'
import { RuleVsMlCard } from '../components/domain/RuleVsMlCard'
import { PageIntro } from '../components/ui/PageIntro'
import { SectionCard } from '../components/ui/Card'
import { Notice } from '../components/ui/Notice'
import { SourceLegend } from '../components/ui/SourceLegend'
import { ZonePicker } from '../components/domain/ZonePicker'
import { EmptyState } from '../components/ui/EmptyState'
import { Button, buttonClass } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { useAppStore } from '../state/AppStore'
import {
  useLiveData,
  type ManualObservation,
  type WeatherState,
} from '../state/LiveDataContext'
import {
  useSelectedZone,
  useSyncZoneFromUrl,
} from '../state/SelectedZone'
import { useToast } from '../state/ToastContext'
import {
  getEvidenceConflicts,
  getEvidenceForZone,
} from '../data/evidence'
import { getZone } from '../data/zones'
import {
  SOURCE_DESCRIPTIONS,
  SOURCE_LABELS,
} from '../domain/constants'
import { formatDateTime } from '../domain/format'
import { getEventsForZone } from '../state/selectors'
import { cn } from '../domain/format'
import type {
  EvidenceItem,
  EvidenceKind,
  EvidenceStatus,
} from '../data/types'

function buildWeatherEvidence(
  zoneId: string,
  weather: WeatherState,
): EvidenceItem {
  const status: EvidenceStatus =
    weather.status === 'VALID'
      ? 'VALID'
      : weather.status === 'TIMEOUT'
        ? 'TIMEOUT'
        : weather.status === 'ERROR'
          ? 'ERROR'
          : 'STALE'
  const data = weather.data
  return {
    evidenceId: `ev-${zoneId}-weather-live`,
    zoneId,
    kind: 'EXTERNAL',
    source: 'PUBLIC',
    status,
    title: '高德天气 · 南京市实况',
    summary: data
      ? `南京实时天气：${data.text}，气温 ${data.temperature} °C${
          data.humidity !== null ? `，相对湿度 ${data.humidity}%` : ''
        }${data.windpower !== null ? `，风力 ${data.windpower}` : ''}。`
      : weather.status === 'LOADING'
        ? '正在请求高德天气接口…'
        : `高德天气不可用：${weather.message ?? '未知错误'} 已降级，不影响其他核心功能。`,
    fields: [
      {
        label: '温度',
        value: data ? `${data.temperature} °C` : '—',
      },
      {
        label: '天气现象',
        value: data ? data.text : '—',
      },
      {
        label: '相对湿度',
        value: data
          ? data.humidity !== null
            ? `${data.humidity}%`
            : '—（接口未返回）'
          : '—',
      },
      {
        label: '风力',
        value: data
          ? data.windpower !== null
            ? data.windpower
            : '—（接口未返回）'
          : '—',
      },
      { label: '接口', value: 'restapi.amap.com · weatherInfo' },
      {
        label: '状态',
        value:
          status === 'VALID'
            ? 'VALID · 实时获取'
            : status === 'TIMEOUT'
              ? 'TIMEOUT · 请求超时'
              : status === 'ERROR'
                ? 'ERROR · 请求失败'
                : 'LOADING · 请求中',
        tone: status === 'VALID' ? 'default' : 'warning',
      },
    ],
    observedAt: data?.observedAt ?? new Date().toISOString(),
    limitation: data
      ? '城市级公开天气只作室外对照，不能证明室内 PM2.5 / CO₂ 已恢复。'
      : `降级提示：${weather.message ?? '高德天气请求失败'} 仅失去室外气象对照，室内 Current、History 与 Action 后验数据仍有效；不得把接口失败解释为业务未恢复。`,
    demoNote: '阶段二真实外部接口（高德 Web 服务 API）。',
  }
}

/** 人工拍照留档 → MANUAL 证据卡（Web 上传与 H5 拍照共用同一数据结构） */
function buildManualEvidence(obs: ManualObservation): EvidenceItem {
  const zone = getZone(obs.zoneId)
  const originLabel = obs.origin === 'H5' ? 'H5 现场端' : 'Web 工作台'
  return {
    evidenceId: `ev-manual-${obs.id}`,
    zoneId: obs.zoneId,
    kind: 'MANUAL',
    source: 'MANUAL_OBSERVATION',
    status: 'VALID',
    title: `人工拍照留档（${originLabel}）`,
    summary: `${obs.operator} 在 ${zone.name} 拍摄的现场照片，${
      obs.viaMqtt
        ? '经 MQTT 从其他终端同步到本端。'
        : '由本端上传，压缩图经 MQTT 同步到其他终端。'
    }`,
    fields: [
      { label: '关联区域', value: `${zone.name}（${zone.zoneId}）` },
      { label: '上传终端', value: originLabel },
      { label: '文件名', value: obs.fileName },
      {
        label: '同步链路',
        value: obs.viaMqtt
          ? 'MQTT 接收 · airguard/evidence/upload'
          : '本地上传 + MQTT 发布 · airguard/evidence/upload',
      },
      {
        label: '图片',
        value: obs.imageUrl
          ? '已压缩为 640px JPEG 缩略图'
          : '浏览器无法解码该格式，仅保留元数据',
        tone: obs.imageUrl ? 'default' : 'warning',
      },
    ],
    observedAt: obs.observedAt,
    limitation:
      '人工观察只作现场佐证，不能替代传感器事实；照片仅保留在当前浏览器会话中，刷新后需重新上传。',
    image: obs.imageUrl
      ? {
          url: obs.imageUrl,
          alt: `${zone.shortName}现场照片（${obs.fileName}）`,
          caption: `${originLabel} · ${formatDateTime(obs.observedAt)}`,
        }
      : undefined,
    demoNote: '阶段二 Camera 能力：真实文件选择 / 拍照，压缩图经 MQTT 多端同步。',
  }
}

const GROUP_DEFINITIONS: {
  key: string
  title: string
  subtitle: string
  kinds: EvidenceKind[]
}[] = [
  {
    key: 'facts',
    title: '业务事实与规则',
    subtitle: 'Current、History 与规则判断；区分模拟事实与派生结论。',
    kinds: ['CURRENT', 'HISTORY', 'RULE'],
  },
  {
    key: 'external',
    title: '外部证据与知识',
    subtitle: '公开数据与知识引用；失败、过期和缺失均单独呈现。',
    kinds: ['EXTERNAL', 'RAG'],
  },
  {
    key: 'model',
    title: '模型与人工观察',
    subtitle: '模型输出只作辅助；人工观察不能替代传感器事实。',
    kinds: ['ML', 'MANUAL'],
  },
]

export function EvidencePage() {
  const { state } = useAppStore()
  const {
    weather,
    refreshWeather,
    readings,
    histories,
    priorities,
    mqttStatus,
    manualObservations,
    addManualObservation,
  } = useLiveData()
  const [searchParams, setSearchParams] = useSearchParams()
  const { toast } = useToast()
  const { selectedZoneId, setSelectedZoneId } = useSelectedZone()
  useSyncZoneFromUrl()
  const onlyIssues = searchParams.get('issues') === '1'
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const zone = getZone(selectedZoneId)
  const liveReading = readings[selectedZoneId]
  // CURRENT / HISTORY / RULE 卡由 MQTT 实时上下文构建；高德天气卡插入外部证据组；
  // 人工拍照留档（本端上传 + MQTT 同步）追加为 MANUAL 卡
  const evidence = useMemo(() => {
    const items = getEvidenceForZone(selectedZoneId, {
      reading: liveReading,
      history: histories[selectedZoneId] ?? [],
      priority: priorities.find((item) => item.zoneId === selectedZoneId),
    })
    const weatherCard = buildWeatherEvidence(selectedZoneId, weather)
    const ragIndex = items.findIndex((item) => item.kind === 'RAG')
    if (ragIndex >= 0) items.splice(ragIndex, 0, weatherCard)
    else items.push(weatherCard)
    for (const obs of manualObservations) {
      if (obs.zoneId === selectedZoneId) items.push(buildManualEvidence(obs))
    }
    return items
  }, [
    selectedZoneId,
    weather,
    liveReading,
    histories,
    priorities,
    manualObservations,
  ])
  const counts = useMemo(() => {
    const result: Record<EvidenceStatus, number> = {
      VALID: 0,
      STALE: 0,
      MISSING: 0,
      TIMEOUT: 0,
      ERROR: 0,
    }
    for (const item of evidence) result[item.status] += 1
    return result
  }, [evidence])
  const conflicts = getEvidenceConflicts(selectedZoneId)
  const events = getEventsForZone(state, selectedZoneId)
  const visibleEvidence = onlyIssues
    ? evidence.filter((item) => item.status !== 'VALID')
    : evidence
  const activeEvent = events.find((event) => event.status !== 'RECOVERED')

  function selectZone(zoneId: string) {
    setSelectedZoneId(zoneId)
    const next = new URLSearchParams(searchParams)
    next.set('zone', zoneId)
    setSearchParams(next, { replace: true })
  }

  function toggleIssues() {
    const next = new URLSearchParams(searchParams)
    if (onlyIssues) next.delete('issues')
    else next.set('issues', '1')
    setSearchParams(next, { replace: true })
  }

  async function handlePhotoChange(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0]
    // 重置 input，允许连续选择同一文件
    event.target.value = ''
    if (!file) return
    setUploading(true)
    const result = await addManualObservation({
      zoneId: selectedZoneId,
      file,
      origin: 'WEB',
    })
    setUploading(false)
    if (!result.ok) {
      toast(result.message, 'warning')
      return
    }
    const syncText = result.synced
      ? '压缩图经 MQTT 同步到其他终端。'
      : 'MQTT 离线，已存待发队列，连接恢复后自动同步。'
    toast(
      result.eventId
        ? `已生成「人工观察」证据卡并挂入事件 ${result.eventId}（${zone.shortName}），${syncText}`
        : `已生成「人工观察」证据卡（${zone.shortName}，暂无未关闭事件可关联），${syncText}`,
      'success',
    )
  }

  const groups = GROUP_DEFINITIONS.map((group) => ({
    ...group,
    items: visibleEvidence.filter((item) => group.kinds.includes(item.kind)),
  }))
  const allVisible = groups.every((group) => group.items.length === 0)

  return (
    <div className="page-stack evidence-page">
      <PageIntro
        eyebrow="Evidence / 证据与知识"
        title="证据与知识"
        description="区分事实数据、外部证据、模型输出与解释文本；来源、时间、有效性和失败原因都可以逐项检查。"
        actions={
          <>
            <Button
              variant="subtle"
              icon={<RefreshCw size={16} />}
              onClick={refreshWeather}
              title="重新请求高德天气"
            >
              刷新天气
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="visually-hidden"
              onChange={handlePhotoChange}
              aria-label="上传现场照片"
            />
            <Button
              variant="subtle"
              icon={<Camera size={16} />}
              loading={uploading}
              onClick={() => fileInputRef.current?.click()}
              title={`从本机选择照片，生成「人工观察」证据卡${
                mqttStatus === 'online' ? '并经 MQTT 同步' : ''
              }`}
            >
              拍照留档
            </Button>
            <Link
              className={buttonClass('secondary', 'md')}
              to={`/history?zone=${selectedZoneId}`}
            >
              历史趋势
            </Link>
            {activeEvent && (
              <Link
                className={buttonClass('primary', 'md')}
                to={`/events/${activeEvent.eventId}`}
              >
                关联事件
                <ArrowRight size={15} />
              </Link>
            )}
          </>
        }
      />

      <div className="filter-card evidence-filter">
        <div className="filter-card__row">
          <ZonePicker
            selectedZoneId={selectedZoneId}
            onChange={selectZone}
          />
          <button
            type="button"
            className={cn(
              'filter-toggle',
              onlyIssues && 'filter-toggle--active',
            )}
            onClick={toggleIssues}
            aria-pressed={onlyIssues}
          >
            <Filter size={14} />
            仅看异常 / 失效
          </button>
        </div>
        <div className="filter-card__meta">
          <span className="filter-card__zone-meta">
            {zone.name} · 证据 {evidence.length} 项 ·{' '}
            {liveReading
              ? `MQTT 实时 · ${formatDateTime(liveReading.time)}`
              : '等待 MQTT 实时数据'}
          </span>
          <SourceLegend compact />
        </div>
      </div>

      <div className="evidence-summary">
        <div className="evidence-summary__item">
          <span className="status-dot status-dot--green" />
          <span>有效</span>
          <strong>{counts.VALID}</strong>
        </div>
        <div className="evidence-summary__item">
          <span className="status-dot status-dot--amber" />
          <span>过期 / 陈旧</span>
          <strong>{counts.STALE}</strong>
        </div>
        <div className="evidence-summary__item">
          <span className="status-dot status-dot--red" />
          <span>超时</span>
          <strong>{counts.TIMEOUT}</strong>
        </div>
        <div className="evidence-summary__item">
          <span className="status-dot status-dot--gray" />
          <span>缺失 / 错误</span>
          <strong>{counts.MISSING + counts.ERROR}</strong>
        </div>
        <div className="evidence-summary__note">
          <Info size={14} />
          技术失败只影响证据可用性，不改写已确认业务事实。
        </div>
      </div>

      <RuleVsMlCard zoneId={selectedZoneId} />

      {conflicts.length > 0 && (
        <div className="conflict-panel">
          {conflicts.map((conflict) => (
            <div key={conflict.title}>
              <div className="conflict-panel__head">
                <span className="conflict-panel__icon">
                  <Divide size={18} />
                </span>
                <div>
                  <h2>{conflict.title}</h2>
                  <p>系统保留分歧，不强行合并为单一“AI 事实”。</p>
                </div>
                <Badge tone="violet">证据分歧</Badge>
              </div>
              <div className="conflict-grid">
                {conflict.items.map((item) => (
                  <div className="conflict-item" key={item.label}>
                    <div className="conflict-item__head">
                      <strong>{item.label}</strong>
                      <Badge tone="neutral" mono>
                        {item.source}
                      </Badge>
                    </div>
                    <p className="conflict-item__verdict">{item.verdict}</p>
                    <p className="conflict-item__note">{item.note}</p>
                  </div>
                ))}
              </div>
              <div className="conflict-panel__resolution">
                <span>处理方式</span>
                <p>{conflict.resolution}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {allVisible ? (
        <SectionCard>
          <EmptyState
            title={onlyIssues ? '该区域没有异常证据' : '暂无证据'}
            description={
              onlyIssues
                ? '关闭“仅看异常 / 失效”可查看全部证据。'
                : '切换区域或检查数据源配置。'
            }
            action={
              onlyIssues ? (
                <Button variant="secondary" size="sm" onClick={toggleIssues}>
                  显示全部证据
                </Button>
              ) : undefined
            }
          />
        </SectionCard>
      ) : (
        groups.map((group) =>
          group.items.length === 0 ? null : (
            <SectionCard
              key={group.key}
              title={group.title}
              subtitle={group.subtitle}
            >
              {group.key === 'external' &&
                (weather.status === 'TIMEOUT' || weather.status === 'ERROR') && (
                  <Notice tone="warning" compact>
                    <span className="weather-degraded">
                      <CloudSun size={14} />
                      高德天气已降级（{weather.status}）：{weather.message}
                      仅失去室外气象对照，系统其他核心功能不受影响。
                    </span>
                  </Notice>
                )}
              <div className="evidence-grid">
                {group.items.map((item) => (
                  <EvidenceCard item={item} key={item.evidenceId} />
                ))}
              </div>
              {group.key === 'model' && (
                <div className="manual-boundary">
                  <Camera size={15} />
                  <p>
                    「拍照留档」上传真实照片并生成人工观察证据（压缩图经 MQTT
                    与 H5 现场端互同步）；人工观察只作现场佐证，不能替代传感器事实，照片仅保留在当前会话。
                  </p>
                </div>
              )}
            </SectionCard>
          ),
        )
      )}

      <Notice tone="info" title="证据口径">
        <p>
          当前页面同时展示{' '}
          {(['SIMULATED', 'PUBLIC', 'MANUAL_OBSERVATION', 'MODEL_OUTPUT'] as const)
            .map((source) => `${source}（${SOURCE_LABELS[source]}）`)
            .join('、')}
          。这些来源不可混写为真实传感器事实。
        </p>
        <p className="notice__secondary">
          {SOURCE_DESCRIPTIONS.MODEL_OUTPUT} ML 与 LLM 只能提供有边界的辅助分析，不修改已保存的 Priority、Event 或 Recovery。
        </p>
      </Notice>
    </div>
  )
}
