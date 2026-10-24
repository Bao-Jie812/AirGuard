import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useSearchParams } from 'react-router-dom'
import { ZONES } from '../data/zones'
import { useLiveData } from './LiveDataContext'

interface SelectedZoneValue {
  /** 全局当前选中区域；Overview / Evidence / History / SpaceMap 共用 */
  selectedZoneId: string
  setSelectedZoneId: (zoneId: string) => void
}

const SelectedZoneContext = createContext<SelectedZoneValue | null>(null)

function isValidZoneId(zoneId: string): boolean {
  return ZONES.some((zone) => zone.zoneId === zoneId)
}

export function SelectedZoneProvider({ children }: { children: ReactNode }) {
  const { priorities, topZoneId } = useLiveData()
  // 默认选中滞回稳定后的首要关注区域（仅初始化时取一次，之后以用户选择为准）
  const [selectedZoneId, setSelectedZoneIdState] = useState(
    () => topZoneId ?? priorities[0]?.zoneId ?? ZONES[0].zoneId,
  )

  const setSelectedZoneId = useCallback((zoneId: string) => {
    if (isValidZoneId(zoneId)) setSelectedZoneIdState(zoneId)
  }, [])

  const value = useMemo(
    () => ({ selectedZoneId, setSelectedZoneId }),
    [selectedZoneId, setSelectedZoneId],
  )

  return (
    <SelectedZoneContext.Provider value={value}>
      {children}
    </SelectedZoneContext.Provider>
  )
}

export function useSelectedZone(): SelectedZoneValue {
  const context = useContext(SelectedZoneContext)
  if (!context) {
    throw new Error('useSelectedZone 必须在 SelectedZoneProvider 内使用')
  }
  return context
}

/**
 * 把 URL 上的 ?zone= 同步进全局选中状态（处理直链与前进后退）。
 * 页面内主动切换时应同时 setSelectedZoneId 与 setSearchParams，
 * 此时 urlZone 与全局状态一致，本 hook 不会反向覆盖。
 */
export function useSyncZoneFromUrl() {
  const [searchParams] = useSearchParams()
  const { selectedZoneId, setSelectedZoneId } = useSelectedZone()
  const urlZone = searchParams.get('zone')

  useEffect(() => {
    if (urlZone && urlZone !== selectedZoneId && isValidZoneId(urlZone)) {
      setSelectedZoneId(urlZone)
    }
    // 只在 URL 参数变化时同步；页面内切换会同步更新 URL，不会形成回环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlZone])
}
