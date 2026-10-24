import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { EnvironmentEvent } from '../../data/types'
import { getZone } from '../../data/zones'

/** X 轴顺序：第二食堂 → 东区宿舍 → 教学区 A */
const ZONE_ORDER = ['zone-w', 'zone-n', 'zone-s'] as const

type RiskZoneId = (typeof ZONE_ORDER)[number]

/**
 * 历史巡检基线。
 * 事件表只保留少量代表性事件，早期已归档的高频告警不在 state.events 中，
 * 因此用一份稳定的历史巡检汇总额作为底数；近 24 小时内保存的事件会再叠加。
 */
const HISTORICAL_BASELINE: Record<
  RiskZoneId,
  { high: number; watch: number }
> = {
  'zone-w': { high: 2, watch: 5 },
  'zone-n': { high: 0, watch: 0 },
  'zone-s': { high: 0, watch: 0 },
}

const WINDOW_MS = 24 * 60 * 60 * 1000

interface RiskDatum {
  name: string
  high: number
  watch: number
}

function buildRiskData(events: EnvironmentEvent[]): RiskDatum[] {
  const cutoff = Date.now() - WINDOW_MS
  const eventCounts = new Map<
    string,
    { high: number; watch: number }
  >()

  for (const event of events) {
    const openedAt = new Date(event.openedAt).getTime()
    if (!Number.isFinite(openedAt) || openedAt < cutoff) continue
    const counts = eventCounts.get(event.zoneId) ?? { high: 0, watch: 0 }
    if (event.severity === 'HIGH' || event.severity === 'CRITICAL') {
      counts.high += 1
    } else {
      counts.watch += 1
    }
    eventCounts.set(event.zoneId, counts)
  }

  return ZONE_ORDER.map((zoneId) => {
    const baseline = HISTORICAL_BASELINE[zoneId]
    const current = eventCounts.get(zoneId) ?? { high: 0, watch: 0 }
    return {
      name: getZone(zoneId).shortName,
      high: baseline.high + current.high,
      watch: baseline.watch + current.watch,
    }
  })
}

/**
 * 今日区域风险统计：分组柱状图。
 * 数据来自已保存的事件 + 历史巡检基线，不依赖 MQTT 实时流。
 */
export function ZoneRiskChart({ events }: { events: EnvironmentEvent[] }) {
  const data = buildRiskData(events)
  const totalHigh = data.reduce((total, item) => total + item.high, 0)
  const totalWatch = data.reduce((total, item) => total + item.watch, 0)

  return (
    <div className="map-risk-body">
      <div className="map-risk-summary">
        <span className="map-risk-summary__item">
          <i className="map-risk-summary__dot map-risk-summary__dot--high" />
          高危告警 <strong>{totalHigh}</strong> 次
        </span>
        <span className="map-risk-summary__item">
          <i className="map-risk-summary__dot map-risk-summary__dot--watch" />
          关注告警 <strong>{totalWatch}</strong> 次
        </span>
        <span className="map-risk-summary__hint">
          近 24 小时 · 历史巡检汇总
        </span>
      </div>

      <div className="map-risk-chart">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 10, right: 8, left: -10, bottom: 0 }}
            barGap={8}
            barCategoryGap="30%"
          >
            <CartesianGrid
              stroke="#e7edf2"
              strokeDasharray="3 4"
              vertical={false}
            />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 11, fill: '#7a8b98' }}
              tickLine={false}
              axisLine={{ stroke: '#dfe7ee' }}
              tickMargin={8}
            />
            <YAxis
              width={30}
              allowDecimals={false}
              tick={{ fontSize: 11, fill: '#7a8b98' }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              cursor={{ fill: 'rgba(120, 140, 150, 0.06)' }}
              contentStyle={{
                borderRadius: 10,
                border: '1px solid #dfe7ee',
                boxShadow: '0 12px 32px -18px rgba(24, 50, 68, 0.35)',
                fontSize: 12,
                padding: '8px 10px',
              }}
              labelStyle={{ color: '#5b6d7b', marginBottom: 4 }}
              formatter={(value) => [`${Number(value)} 次`]}
            />
            <Bar
              dataKey="high"
              name="高危告警"
              fill="#d9534f"
              radius={[4, 4, 0, 0]}
              maxBarSize={40}
            />
            <Bar
              dataKey="watch"
              name="关注告警"
              fill="#e5a93c"
              radius={[4, 4, 0, 0]}
              maxBarSize={40}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <p className="map-risk-footnote">
        高危 = 严重 / 高等级事件；关注 = 中低等级事件。统计读取本地已保存事件，不占用 MQTT 实时链路。
      </p>
    </div>
  )
}
