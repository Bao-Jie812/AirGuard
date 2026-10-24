import type {
  EnvironmentEvent,
  PriorityAssessment,
  ZoneStatus,
} from '../../data/types'
import { getZone } from '../../data/zones'
import {
  ZONE_COLORS,
  ZONE_STATUS_COLORS,
  ZONE_STATUS_LABELS,
} from '../../domain/constants'
import { cn } from '../../domain/format'

interface Map2DProps {
  priorities: PriorityAssessment[]
  activeEvents: EnvironmentEvent[]
  selectedZoneId: string
  onSelect: (zoneId: string) => void
}

/**
 * 2D 校园平面的锚点坐标（百分比）。
 * 与 SVG 背景中的建筑轮廓中心一一对应：
 *   教学区 A  → 西侧教学建筑
 *   第二食堂  → 南侧餐饮建筑
 *   东区宿舍  → 东北角宿舍楼
 */
const ZONE_POSITIONS: Record<string, { x: number; y: number }> = {
  'zone-s': { x: 30, y: 47 },
  'zone-w': { x: 56, y: 73 },
  'zone-n': { x: 77.5, y: 27 },
}

/**
 * 三栋建筑轮廓在 viewBox 400×300 中的包围矩形（百分比，比 SVG 轮廓外扩一圈）。
 * 告警状态时红色发光卡片按此矩形完全包围对应建筑。
 */
const ZONE_ALARM_RECTS: Record<
  string,
  { left: number; top: number; width: number; height: number }
> = {
  'zone-s': { left: 16.25, top: 35, width: 27.5, height: 24 },
  'zone-w': { left: 44, top: 62.33, width: 24.5, height: 21.33 },
  'zone-n': { left: 65.25, top: 15.67, width: 24.5, height: 22.67 },
}

/**
 * 2D 校园平面图。
 *
 * 关键约定：
 * 1. button 是 32×32 的点击热区，中心就是定位点本身；
 *    圆点、文字都相对这个中心定位，因此点与文字永不脱离。
 * 2. 告警视觉与 3D 地图三态联动一致：未关闭事件覆盖瞬时数据档位——
 *    OPEN=严重红、处置中=警戒橙；此时渲染覆盖整栋建筑的发光包围层与雷达扩散波，
 *    定位点与文字同步变红。NORMAL / WATCH 只显示一个小圆点，避免整张图被色斑覆盖。
 * 3. 名称、状态、Priority 得分全部来自同一份 priorities，
 *    与 3D 地图、优先级表格严格同源。
 */
export function Map2D({
  priorities,
  activeEvents,
  selectedZoneId,
  onSelect,
}: Map2DProps) {
  // 与 3D 地图 statusByZone 同语义：有未关闭事件时 OPEN 优先升级为严重红
  function effectiveStatusOf(zoneId: string, fallback: ZoneStatus): ZoneStatus {
    const zoneEvents = activeEvents.filter((event) => event.zoneId === zoneId)
    if (zoneEvents.length === 0) return fallback
    return zoneEvents.some((event) => event.status === 'OPEN')
      ? 'CRITICAL'
      : 'ALERT'
  }

  return (
    <div className="map2d">
      {/* 底图：校园道路、建筑轮廓与绿地（纯示意，非真实地理坐标） */}
      <svg
        className="map2d__bg"
        viewBox="0 0 400 300"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <pattern
            id="map2d-grid"
            width="20"
            height="20"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 20 0 L 0 0 0 20"
              fill="none"
              stroke="#e4ebe8"
              strokeWidth="0.6"
            />
          </pattern>
        </defs>

        <rect width="400" height="300" fill="#f4f7f5" />
        <rect width="400" height="300" fill="url(#map2d-grid)" />

        {/* 绿地 */}
        <rect x="24" y="208" width="112" height="66" rx="10" fill="#e5f0e1" />
        <rect x="192" y="78" width="54" height="66" rx="10" fill="#e7f0e3" />
        <rect x="352" y="206" width="34" height="50" rx="8" fill="#e7f0e3" />

        {/* 三栋建筑轮廓：定位点落在各自中心 */}
        <rect
          x="70"
          y="110"
          width="100"
          height="62"
          rx="8"
          fill="#e8eef1"
          stroke="#d3dee2"
          strokeWidth="1.2"
        />
        <rect
          x="181"
          y="192"
          width="88"
          height="54"
          rx="8"
          fill="#e8eef1"
          stroke="#d3dee2"
          strokeWidth="1.2"
        />
        <rect
          x="266"
          y="52"
          width="88"
          height="58"
          rx="8"
          fill="#e8eef1"
          stroke="#d3dee2"
          strokeWidth="1.2"
        />

        {/* 道路 */}
        <path d="M0 178 H400" stroke="#e0e6e3" strokeWidth="14" />
        <path
          d="M0 178 H400"
          stroke="#f9fbfa"
          strokeWidth="1.6"
          strokeDasharray="10 8"
        />
        <path d="M175 0 V300" stroke="#e0e6e3" strokeWidth="12" />
        <path
          d="M175 0 V300"
          stroke="#f9fbfa"
          strokeWidth="1.4"
          strokeDasharray="9 8"
        />

        {/* 运动场与树木 */}
        <rect
          x="36"
          y="220"
          width="88"
          height="42"
          rx="6"
          fill="none"
          stroke="#cfe3cd"
          strokeWidth="1.2"
        />
        <path d="M80 220 V262" stroke="#cfe3cd" strokeWidth="1" />
        {[
          [32, 48, 4],
          [54, 72, 3],
          [356, 196, 3.5],
          [366, 270, 4],
          [150, 250, 3],
          [248, 158, 3],
        ].map(([cx, cy, r], index) => (
          <circle
            key={index}
            cx={cx}
            cy={cy}
            r={r}
            fill="#bcd9b2"
          />
        ))}
      </svg>

      {/* 告警包围层：覆盖整栋建筑的半透明发光卡片 + 雷达扩散波（仅 ALERT / CRITICAL） */}
      {priorities.map((priority) => {
        const effectiveStatus = effectiveStatusOf(
          priority.zoneId,
          priority.zoneStatus,
        )
        if (effectiveStatus !== 'ALERT' && effectiveStatus !== 'CRITICAL') {
          return null
        }
        const rect = ZONE_ALARM_RECTS[priority.zoneId]
        if (!rect) return null
        return (
          <span
            key={`alarm-${priority.zoneId}`}
            aria-hidden="true"
            className={cn(
              'map2d__alarm',
              effectiveStatus === 'CRITICAL'
                ? 'map2d__alarm--critical'
                : 'map2d__alarm--alert',
            )}
            style={{
              left: `${rect.left}%`,
              top: `${rect.top}%`,
              width: `${rect.width}%`,
              height: `${rect.height}%`,
              ['--alarm-color' as string]: ZONE_STATUS_COLORS[effectiveStatus],
            }}
          >
            <i className="map2d__alarm-wave" />
            <i className="map2d__alarm-wave map2d__alarm-wave--late" />
          </span>
        )
      })}

      {priorities.map((priority) => {
        const position = ZONE_POSITIONS[priority.zoneId] ?? { x: 50, y: 50 }
        const zone = getZone(priority.zoneId)
        const status: ZoneStatus = priority.zoneStatus
        const effectiveStatus = effectiveStatusOf(priority.zoneId, status)
        const alarming =
          effectiveStatus === 'ALERT' || effectiveStatus === 'CRITICAL'
        const hasActiveEvent = activeEvents.some(
          (event) => event.zoneId === priority.zoneId,
        )
        const selected = priority.zoneId === selectedZoneId
        const summary = `${zone.name} · ${ZONE_STATUS_LABELS[status]} · Priority ${priority.score.toFixed(1)}`

        return (
          <button
            key={priority.zoneId}
            type="button"
            className={cn(
              'map2d__zone',
              selected && 'map2d__zone--selected',
            )}
            style={{
              left: `${position.x}%`,
              top: `${position.y}%`,
              ['--zone-color' as string]: ZONE_COLORS[priority.zoneId],
              ['--alarm-color' as string]: ZONE_STATUS_COLORS[effectiveStatus],
            }}
            onClick={() => onSelect(priority.zoneId)}
            aria-pressed={selected}
            aria-label={summary}
            title={summary}
          >
            {/* 锚点：圆点中心即定位坐标 */}
            <span className="map2d__pin">
              <span
                className="map2d__dot"
                style={{ backgroundColor: ZONE_STATUS_COLORS[effectiveStatus] }}
              >
                {hasActiveEvent && (
                  <span
                    className="map2d__event-dot"
                    title="存在未关闭事件"
                  />
                )}
              </span>
            </span>

            {/* 标签与圆点同属一个 button，位置始终跟随锚点 */}
            <span
              className={cn(
                'map2d__label',
                alarming && 'map2d__label--alarm',
              )}
            >
              <strong>{zone.shortName}</strong>
              <small>
                {ZONE_STATUS_LABELS[status]} · {priority.score.toFixed(1)}
              </small>
            </span>
          </button>
        )
      })}
    </div>
  )
}
