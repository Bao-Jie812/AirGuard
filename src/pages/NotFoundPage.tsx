import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { PageIntro } from '../components/ui/PageIntro'
import { SectionCard } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { buttonClass } from '../components/ui/Button'

export function NotFoundPage() {
  return (
    <div className="page-stack">
      <PageIntro
        eyebrow="404"
        title="页面不存在"
        description="该路径不属于 AirGuard 工作台，或链接已失效。"
      />
      <SectionCard>
        <EmptyState
          icon={<Compass size={24} />}
          title="没有找到这个页面"
          description="返回区域总览，或从左侧导航进入核心业务视图。"
          action={
            <Link className={buttonClass('primary', 'md')} to="/overview">
              返回区域总览
            </Link>
          }
        />
      </SectionCard>
    </div>
  )
}
