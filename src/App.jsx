import { Toaster } from '@/components/ui/toaster';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClientInstance } from '@/lib/query-client';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import ScrollToTop from '@/components/ScrollToTop';
import Home from '@/pages/Home';
import BusinessPage from '@/pages/worktime/BusinessPage';
import DepartmentPage from '@/pages/worktime/DepartmentPage';
import EmployeePage from '@/pages/worktime/EmployeePage';
import ShiftPage from '@/pages/worktime/ShiftPage';
import HinweisEmployeePage from '@/pages/worktime/HinweisEmployeePage';
import HinweisPage from '@/pages/worktime/HinweisPage';
import ReportsPage from '@/pages/worktime/ReportsPage';
import ScanShiftsPage from '@/pages/worktime/ScanShiftsPage';
import PageNotFound from '@/lib/PageNotFound';

function App() {
  return (
    <QueryClientProvider client={queryClientInstance}>
      <Router>
        <ScrollToTop />
        <Routes>
          <Route path="/" element={<Home />}>
            <Route index element={<BusinessPage />} />
            <Route path="department" element={<DepartmentPage />} />
            <Route path="employee" element={<EmployeePage />} />
            <Route path="shift" element={<ShiftPage />} />
            <Route path="hinweis-employee" element={<HinweisEmployeePage />} />
            <Route path="hinweis" element={<HinweisPage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="scan-shifts" element={<ScanShiftsPage />} />
          </Route>
          <Route path="*" element={<PageNotFound />} />
        </Routes>
      </Router>
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;
