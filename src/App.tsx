import { Route, Routes } from 'react-router-dom'
import { Header } from '@/components/Header'
import { SyncBanner } from '@/components/SyncBanner'
import { ArbiterPage } from '@/pages/Arbiter'
import { Jobs } from '@/pages/Jobs'
import { PostJob } from '@/pages/PostJob'
import { JobDetail } from '@/pages/JobDetail'
import { Dashboard } from '@/pages/Dashboard'
import { ProfilePage } from '@/pages/Profile'
import { NotFound } from '@/pages/NotFound'

export default function App() {
  return (
    <>
      <Header />
      <SyncBanner />
      <main>
        <Routes>
          <Route path="/" element={<Jobs />} />
          <Route path="/post" element={<PostJob />} />
          <Route path="/jobs/:id" element={<JobDetail />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/arbiter" element={<ArbiterPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/profile/:address" element={<ProfilePage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </>
  )
}
