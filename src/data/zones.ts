import type { ZoneDefinition } from './types'

/**
 * 区域元数据（位置、面积、建筑信息）。
 * 不包含任何传感器读数 —— 所有环境与人流数据均来自 MQTT 实时流，
 * 历史序列由 src/state/liveStore.ts 持久化。
 */
export const ZONES: ZoneDefinition[] = [
  {
    zoneId: 'zone-s',
    name: '教学区 A 栋',
    shortName: '教学区 A',
    building: '教学楼 A',
    category: '教学空间',
    description: '常规教室与走廊混合区域，课间人流明显。',
    areaSqm: 600,
    map: { gridX: 1, gridY: 1 },
  },
  {
    zoneId: 'zone-w',
    name: '第二食堂就餐区',
    shortName: '第二食堂',
    building: '第二食堂',
    category: '餐饮空间',
    description: '午餐高峰人流密集，东侧排风系统近期维护。',
    areaSqm: 500,
    map: { gridX: 0, gridY: 1 },
  },
  {
    zoneId: 'zone-n',
    name: '东区宿舍 3 号楼',
    shortName: '东区宿舍',
    building: '东区 3 号楼',
    category: '住宿空间',
    description: '宿舍公共区域，午后人员流动较低。',
    areaSqm: 700,
    map: { gridX: 1, gridY: 0 },
  },
]

const zoneMap = new Map(ZONES.map((zone) => [zone.zoneId, zone]))

export function getZone(zoneId: string): ZoneDefinition {
  const zone = zoneMap.get(zoneId)
  if (!zone) throw new Error(`Unknown zone: ${zoneId}`)
  return zone
}

export function getZoneName(zoneId: string): string {
  return zoneMap.get(zoneId)?.name ?? zoneId
}

export const DEFAULT_ZONE_ID = 'zone-w'
