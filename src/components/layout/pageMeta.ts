export interface PageMeta {
  title: string
  section: string
}

export function getPageMeta(pathname: string): PageMeta {
  if (pathname === '/overview') {
    return { title: '区域总览', section: '业务工作台' }
  }
  if (pathname === '/history') {
    return { title: '历史趋势', section: '业务工作台' }
  }
  if (pathname === '/evidence') {
    return { title: '证据与知识', section: '业务工作台' }
  }
  if (pathname === '/events') {
    return { title: '事件与处置', section: '业务工作台' }
  }
  if (pathname.startsWith('/events/')) {
    return { title: '事件详情', section: '业务工作台' }
  }
  if (pathname === '/runs') {
    return { title: 'Run Trace', section: '运行与空间' }
  }
  if (pathname.startsWith('/runs/')) {
    return { title: 'Run Trace 详情', section: '运行与空间' }
  }
  if (pathname === '/map') {
    return { title: '空间地图', section: '运行与空间' }
  }
  return { title: 'AirGuard', section: '工作台' }
}
