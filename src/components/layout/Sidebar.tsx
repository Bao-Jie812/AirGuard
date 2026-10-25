import {
  ClipboardList,
  FileSearch,
  FileText,
  LayoutDashboard,
  LineChart,
  Map,
  Route,
  Smartphone,
  X,
  ArrowUpRight,
  Power,
} from 'lucide-react'
import { NavLink, Link } from 'react-router-dom'
import { APP_SUBTITLE, APP_VERSION } from '../../domain/constants'
import { useAppStore } from '../../state/AppStore'
import { cn } from '../../domain/format'
import { LogoMark } from '../ui/LogoMark'

interface SidebarProps {
  open: boolean
  onClose: () => void
}

const businessNav = [
  {
    to: '/overview',
    label: '区域总览',
    hint: '先看哪里',
    icon: LayoutDashboard,
  },
  {
    to: '/history',
    label: '历史趋势',
    hint: '为什么变化',
    icon: LineChart,
  },
  {
    to: '/evidence',
    label: '证据与知识',
    hint: '依据是否有效',
    icon: FileSearch,
  },
  {
    to: '/events',
    label: '事件与处置',
    hint: '处置后是否恢复',
    icon: ClipboardList,
  },
]

const runtimeNav = [
  {
    to: '/runs',
    label: 'Run Trace',
    hint: '判断可回查',
    icon: Route,
  },
  {
    to: '/map',
    label: '空间地图',
    hint: '3D 态势',
    icon: Map,
  },
]

function NavItem({
  to,
  label,
  hint,
  icon: Icon,
  badge,
  onClick,
}: {
  to: string
  label: string
  hint: string
  icon: typeof LayoutDashboard
  badge?: number
  onClick?: () => void
}) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        cn('nav-item', isActive && 'nav-item--active')
      }
    >
      <span className="nav-item__icon">
        <Icon size={18} strokeWidth={1.8} />
      </span>
      <span className="nav-item__copy">
        <span className="nav-item__label">{label}</span>
        <span className="nav-item__hint">{hint}</span>
      </span>
      {badge !== undefined && badge > 0 && (
        <span className="nav-item__badge">{badge}</span>
      )}
    </NavLink>
  )
}

function EventDonut() {
  const { state } = useAppStore()
  const events = state.events
  const handling = events.filter(
    (event) =>
      event.status === 'OPEN' ||
      event.status === 'HANDLING' ||
      event.status === 'STILL_HANDLING',
  ).length
  const insufficient = events.filter(
    (event) => event.status === 'INSUFFICIENT_EVIDENCE',
  ).length
  const recovered = events.filter(
    (event) => event.status === 'RECOVERED',
  ).length
  const total = events.length

  const segments = [
    { label: '未恢复', value: handling, color: '#e5a93c' },
    { label: '证据不足', value: insufficient, color: '#d96a55' },
    { label: '已恢复', value: recovered, color: '#0d9b86' },
  ].filter((segment) => segment.value > 0)

  const R = 15.9155
  let offset = 25

  return (
    <div className="sidebar__widget">
      <p className="sidebar__widget-title">事件状态分布</p>
      <div className="sidebar__widget-body">
        <svg
          className="sidebar-donut"
          width="64"
          height="64"
          viewBox="0 0 42 42"
          role="img"
          aria-label={`事件状态分布，共 ${total} 个事件`}
        >
          <circle
            cx="21"
            cy="21"
            r={R}
            fill="none"
            stroke="#eef3f1"
            strokeWidth="6"
          />
          {segments.map((segment) => {
            const pct = (segment.value / (total || 1)) * 100
            const node = (
              <circle
                key={segment.label}
                cx="21"
                cy="21"
                r={R}
                fill="none"
                stroke={segment.color}
                strokeWidth="6"
                strokeDasharray={`${pct} ${100 - pct}`}
                strokeDashoffset={offset}
                strokeLinecap="butt"
              />
            )
            offset -= pct
            return node
          })}
          <text x="21" y="20" textAnchor="middle" className="sidebar-donut__center-value">
            {total}
          </text>
          <text x="21" y="27" textAnchor="middle" className="sidebar-donut__center-label">
            事件
          </text>
        </svg>
        <ul className="sidebar__widget-legend">
          {segments.map((segment) => (
            <li key={segment.label}>
              <span className="dot" style={{ background: segment.color }} />
              {segment.label}
              <strong>{segment.value}</strong>
            </li>
          ))}
          {segments.length === 0 && (
            <li>暂无事件 · 指标达警戒线后自动生成</li>
          )}
        </ul>
      </div>
    </div>
  )
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const { activeEventCount } = useAppStore()

  return (
    <>
      <div
        className={cn('sidebar-scrim', open && 'sidebar-scrim--visible')}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside className={cn('sidebar', open && 'sidebar--open')}>
        <div className="sidebar__brand-row">
          <Link to="/overview" className="sidebar__brand" onClick={onClose}>
            <LogoMark size={36} />
            <span>
              <strong>AirGuard</strong>
              <small>{APP_SUBTITLE}</small>
            </span>
          </Link>
          <button
            type="button"
            className="icon-button sidebar__close"
            onClick={onClose}
            aria-label="关闭导航"
          >
            <X size={18} />
          </button>
        </div>

        <div className="sidebar__body">
          <nav aria-label="业务视图">
            <p className="sidebar__group-label">业务视图</p>
            <div className="sidebar__nav">
              {businessNav.map((item) => (
                <NavItem
                  key={item.to}
                  {...item}
                  badge={item.to === '/events' ? activeEventCount : undefined}
                  onClick={onClose}
                />
              ))}
            </div>
          </nav>

          <nav aria-label="运行与空间">
            <p className="sidebar__group-label">运行与空间</p>
            <div className="sidebar__nav">
              {runtimeNav.map((item) => (
                <NavItem key={item.to} {...item} onClick={onClose} />
              ))}
            </div>
          </nav>

          <nav aria-label="现场体验层">
            <p className="sidebar__group-label">体验层</p>
            <Link
              to="/m"
              target="_blank"
              rel="noreferrer"
              className="nav-item nav-item--secondary"
            >
              <span className="nav-item__icon">
                <Smartphone size={18} strokeWidth={1.8} />
              </span>
              <span className="nav-item__copy">
                <span className="nav-item__label">
                  现场 H5
                  <span className="nav-item__tag">预览</span>
                </span>
                <span className="nav-item__hint">与 Web 状态同源</span>
              </span>
              <ArrowUpRight size={15} className="nav-item__external" />
            </Link>
            <button
              type="button"
              className="nav-item nav-item--secondary"
              onClick={() => {
                window.open('/report.html', '_blank')
                onClose()
              }}
            >
              <span className="nav-item__icon">
                <FileText size={18} strokeWidth={1.8} />
              </span>
              <span className="nav-item__copy">
                <span className="nav-item__label">
                  离线分析报告
                  <span className="nav-item__tag">HTML</span>
                </span>
                <span className="nav-item__hint">查看历史数据复盘</span>
              </span>
              <ArrowUpRight size={15} className="nav-item__external" />
            </button>
          </nav>
        </div>

        <div className="sidebar__footer">
          <EventDonut />
          <div className="sidebar__user">
            <span className="sidebar__avatar">值</span>
            <span>
              <strong>值班员</strong>
              <small>SIMULATED · 本地演示数据</small>
            </span>
            <button
              type="button"
              className="icon-button"
              aria-label="演示账号，无登录态"
              title="演示账号，无登录态"
            >
              <Power size={16} />
            </button>
          </div>
          <div className="sidebar__version">
            <span>Phase 1</span>
            <span>v{APP_VERSION}</span>
          </div>
        </div>
      </aside>
    </>
  )
}
