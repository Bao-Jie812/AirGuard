import { useAppStore } from '../../state/AppStore'
import { useLiveData } from '../../state/LiveDataContext'
import { ZONES } from '../../data/zones'
import { ZONE_COLORS } from '../../domain/constants'
import { cn } from '../../domain/format'
import { getActiveEventForZone } from '../../state/selectors'

interface ZonePickerProps {
  selectedZoneId: string
  onChange: (zoneId: string) => void
  label?: string
}

export function ZonePicker({
  selectedZoneId,
  onChange,
  label = '选择区域',
}: ZonePickerProps) {
  const { state } = useAppStore()
  const { priorities } = useLiveData()

  return (
    <div className="zone-picker" role="group" aria-label={label}>
      {ZONES.map((zone) => {
        const priority = priorities.find((item) => item.zoneId === zone.zoneId)
        const activeEvent = getActiveEventForZone(state, zone.zoneId)
        return (
          <button
            type="button"
            key={zone.zoneId}
            className={cn(
              'zone-pill',
              selectedZoneId === zone.zoneId && 'zone-pill--active',
            )}
            onClick={() => onChange(zone.zoneId)}
            aria-pressed={selectedZoneId === zone.zoneId}
          >
            <span
              className="zone-pill__marker"
              style={{ backgroundColor: ZONE_COLORS[zone.zoneId] }}
            />
            <span className="zone-pill__name">{zone.shortName}</span>
            {priority && (
              <span className="zone-pill__rank">#{priority.rank}</span>
            )}
            {activeEvent && (
              <span
                className="zone-pill__event-dot"
                title={`存在未关闭事件：${activeEvent.title}`}
              />
            )}
          </button>
        )
      })}
    </div>
  )
}
