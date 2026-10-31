import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { MlAlertModal } from './components/domain/MlAlertModal'
import { AppStoreProvider } from './state/AppStore'
import { LiveDataProvider } from './state/LiveDataContext'
import { SelectedZoneProvider } from './state/SelectedZone'
import { ToastProvider } from './state/ToastContext'
import { OverviewPage } from './pages/OverviewPage'
import { HistoryPage } from './pages/HistoryPage'
import { EvidencePage } from './pages/EvidencePage'
import { EventsPage } from './pages/EventsPage'
import { EventDetailPage } from './pages/EventDetailPage'
import { RunsPage } from './pages/RunsPage'
import { RunDetailPage } from './pages/RunDetailPage'
import { SpaceMapPage } from './pages/SpaceMapPage'
import { H5Page } from './pages/H5Page'
import { NotFoundPage } from './pages/NotFoundPage'

export default function App() {
  return (
    <AppStoreProvider>
      <ToastProvider>
        <LiveDataProvider>
        <SelectedZoneProvider>
          <BrowserRouter>
          {/* 全局 ML 隐患预警：覆盖所有路由（含 H5 /m），自行判定有无预警 */}
          <MlAlertModal />
          <Routes>
            <Route path="/m" element={<H5Page />} />
            <Route element={<AppShell />}>
              <Route index element={<Navigate to="/overview" replace />} />
              <Route path="/overview" element={<OverviewPage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/evidence" element={<EvidencePage />} />
              <Route path="/events" element={<EventsPage />} />
              <Route path="/events/:eventId" element={<EventDetailPage />} />
              <Route path="/runs" element={<RunsPage />} />
              <Route path="/runs/:runId" element={<RunDetailPage />} />
              <Route path="/map" element={<SpaceMapPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
          </BrowserRouter>
        </SelectedZoneProvider>
        </LiveDataProvider>
      </ToastProvider>
    </AppStoreProvider>
  )
}
