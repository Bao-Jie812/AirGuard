import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { FlaskConical } from 'lucide-react'
import { DemoControlPanel } from '../domain/DemoControlPanel'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()

  useEffect(() => {
    setMenuOpen(false)
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [location.pathname])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
      <div className="app-main">
        <Topbar onOpenMenu={() => setMenuOpen(true)} />
        <div className="demo-strip">
          <span className="demo-strip__icon">
            <FlaskConical size={14} />
          </span>
          <span>
            阶段二实时链路：环境与人流数据来自 MQTT 模拟器实时推送，天气来自高德 API；
            事件、处置与恢复全部由真实交互驱动。
          </span>
          <span className="demo-strip__meta">
            实时历史与业务状态已持久化
          </span>
        </div>
        <main id="main-content" className="page-content">
          <Outlet />
        </main>
      </div>
      <DemoControlPanel />
    </div>
  )
}
