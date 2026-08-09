import { lazy, Suspense } from 'react';
import { Toaster } from '@/components/ui/toaster';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClientInstance } from '@/lib/query-client';
import { BrowserRouter as Router, Route, Routes } from 'react-router';
import ScrollToTop from '@/components/ScrollToTop';
import Home from '@/pages/Home';
import PageNotFound from '@/lib/PageNotFound';
import AuthGate from '@/components/auth/AuthGate';

const BusinessPage = lazy(() => import('@/pages/worktime/BusinessPage'));
const DepartmentPage = lazy(() => import('@/pages/worktime/DepartmentPage'));
const EmployeePage = lazy(() => import('@/pages/worktime/EmployeePage'));
const ShiftPage = lazy(() => import('@/pages/worktime/ShiftPage'));
const HinweisEmployeePage = lazy(() => import('@/pages/worktime/HinweisEmployeePage'));
const HinweisPage = lazy(() => import('@/pages/worktime/HinweisPage'));
const ReportsPage = lazy(() => import('@/pages/worktime/ReportsPage'));
const ManagePage = lazy(() => import('@/pages/worktime/ManagePage'));
const ScanShiftsPage = lazy(() => import('@/pages/worktime/ScanShiftsPage'));

function RouteFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-500">
      Wird geladen…
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClientInstance}>
      <AuthGate>
        <Router>
          <ScrollToTop />
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<Home />}>
                <Route index element={<BusinessPage />} />
                <Route path="department" element={<DepartmentPage />} />
                <Route path="employee" element={<EmployeePage />} />
                <Route path="shift" element={<ShiftPage />} />
                <Route path="hinweis-employee" element={<HinweisEmployeePage />} />
                <Route path="hinweis" element={<HinweisPage />} />
                <Route path="reports" element={<ReportsPage />} />
                <Route path="manage" element={<ManagePage />} />
                <Route path="scan-shifts" element={<ScanShiftsPage />} />
              </Route>
              <Route path="*" element={<PageNotFound />} />
            </Routes>
          </Suspense>
        </Router>
      </AuthGate>
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;
