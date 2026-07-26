import React, { useState, useEffect, useCallback } from 'react';
import { Outlet, useNavigate, useLocation, useNavigationType } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { base44 } from '@/api/base44Client';
import {
  buildEffectiveStaffConfig,
  getAllHinweisEmployees,
  normalizePersonName
} from '@/lib/staffConfig';
import TabNavigation from '@/components/worktime/TabNavigation';
import PullToRefresh from '@/components/PullToRefresh';

const APP_TITLE = 'Arbeitszeiten Personal Shiraz';

function syncThenExport() {
  // Data is stored immediately in D1. The single Google Sheet is refreshed nightly
  // by the Cloudflare Cron Trigger; a manual refresh is available in Reports.
}

export default function Home() {
  const navigate = useNavigate();
  const location = useLocation();
  const navigationType = useNavigationType();
  const [staffConfig, setStaffConfig] = useState(null);
  const [allStaff, setAllStaff] = useState([]);
  const [staffMembers, setStaffMembers] = useState([]);
  const [selectedBusiness, setSelectedBusiness] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [selectedHinweisEmployee, setSelectedHinweisEmployee] = useState('');
  const [selectedScanBusiness, setSelectedScanBusiness] = useState('');
  const [loading, setLoading] = useState(true);

  const todayIso = new Date().toISOString().slice(0, 10);
  const todayDisplay = new Date().toLocaleDateString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  });

  const loadStaffConfig = useCallback(async () => {
    setLoading(true);
    try {
      const additional = await base44.entities.StaffMember.list('-created_date', 5000);
      const config = buildEffectiveStaffConfig(additional || []);
      setStaffConfig(config);
      setAllStaff(getAllHinweisEmployees(config));
      setStaffMembers(additional || []);
    } catch (e) {
      // fallback to base config
      const config = buildEffectiveStaffConfig([]);
      setStaffConfig(config);
      setAllStaff(getAllHinweisEmployees(config));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStaffConfig();
  }, [loadStaffConfig]);

  function goToMain() {
    setSelectedBusiness('');
    setSelectedDepartment('');
    setSelectedEmployee('');
    setSelectedHinweisEmployee('');
    navigate('/');
  }

  function selectBusiness(business) {
    setSelectedBusiness(business);
    if (business === 'Catering') {
      setSelectedDepartment('Catering');
      navigate('/employee');
    } else {
      navigate('/department');
    }
  }

  function selectDepartment(department) {
    setSelectedDepartment(department);
    navigate('/employee');
  }

  function selectEmployee(employee) {
    setSelectedEmployee(employee);
    navigate('/shift');
  }

  async function handleAddEmployee(name) {
    await base44.entities.StaffMember.create({
      business: selectedBusiness,
      department: selectedDepartment,
      employee: name,
      employeeKey: normalizePersonName(name)
    });
    await loadStaffConfig();
    syncThenExport();
  }

  async function handleHideEmployee(employee) {
    const empKey = normalizePersonName(employee);
    const record = staffMembers.find((m) =>
      m.business === selectedBusiness &&
      m.department === selectedDepartment &&
      (m.employeeKey || normalizePersonName(m.employee)) === empKey
    );
    if (record && record.hidden) return; // already hidden
    if (record) {
      await base44.entities.StaffMember.update(record.id, { hidden: true });
    } else {
      await base44.entities.StaffMember.create({
        business: selectedBusiness,
        department: selectedDepartment,
        employee,
        employeeKey: empKey,
        hidden: true
      });
    }
    await loadStaffConfig();
    syncThenExport();
  }

  async function handleSaveShift({ date, startTime, endTime, durationHours }) {
    const employeeKey = normalizePersonName(selectedEmployee);
    const existing = await base44.entities.Shift.filter({
      employeeKey, date, startTime, endTime, business: selectedBusiness, department: selectedDepartment
    });
    if (existing && existing.length > 0) {
      throw new Error('Diese Schicht wurde für diesen Mitarbeiter an diesem Tag bereits erfasst.');
    }
    await base44.entities.Shift.create({
      business: selectedBusiness,
      department: selectedDepartment,
      employee: selectedEmployee,
      employeeKey,
      date,
      startTime,
      endTime,
      durationHours
    });
    syncThenExport();
  }

  async function handleVoiceAddShift({ business, department, employee, date, startTime, endTime, durationHours }) {
    const employeeKey = normalizePersonName(employee);
    const existing = await base44.entities.Shift.filter({ employeeKey, date, startTime, endTime, business, department });
    if (existing && existing.length > 0) {
      throw new Error('Diese Schicht wurde für diesen Mitarbeiter an diesem Tag bereits erfasst.');
    }
    await base44.entities.Shift.create({
      business,
      department,
      employee,
      employeeKey,
      date,
      startTime,
      endTime,
      durationHours
    });
    syncThenExport();
  }

  async function handleScanAddShifts(shifts) {
    const toCreate = [];
    for (const shift of shifts) {
      const employeeKey = normalizePersonName(shift.employee);
      const existing = await base44.entities.Shift.filter({
        employeeKey, date: shift.date, startTime: shift.startTime, endTime: shift.endTime,
        business: shift.business, department: shift.department
      });
      if (existing && existing.length > 0) continue; // skip duplicates, don't fail the whole batch
      toCreate.push({ ...shift, employeeKey });
    }
    if (toCreate.length > 0) {
      await base44.entities.Shift.bulkCreate(toCreate);
      syncThenExport();
    }
  }

  function openScanShifts(business) {
    setSelectedScanBusiness(business);
    navigate('/scan-shifts');
  }

  function openHinweiseEmployeePage() {
    setSelectedHinweisEmployee('');
    navigate('/hinweis-employee');
  }

  function selectHinweisEmployee(employee) {
    setSelectedHinweisEmployee(employee);
    navigate('/hinweis');
  }

  async function handleSaveHinweis({ date, text }) {
    await base44.entities.Hinweis.create({
      employee: selectedHinweisEmployee,
      employeeKey: normalizePersonName(selectedHinweisEmployee),
      date,
      text
    });
    syncThenExport();
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-neutral-200 border-t-neutral-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  const outletContext = {
    staffConfig,
    allStaff,
    staffMembers,
    selectedBusiness,
    selectedDepartment,
    selectedEmployee,
    selectedHinweisEmployee,
    selectedScanBusiness,
    todayIso,
    selectBusiness,
    selectDepartment,
    selectEmployee,
    handleAddEmployee,
    handleHideEmployee,
    handleSaveShift,
    handleVoiceAddShift,
    handleScanAddShifts,
    openScanShifts,
    openHinweiseEmployeePage,
    selectHinweisEmployee,
    handleSaveHinweis,
    goToMain
  };

  const isPop = navigationType === 'POP';

  return (
    <div
      className="min-h-screen bg-neutral-100 px-4"
      style={{
        paddingTop: 'calc(env(safe-area-inset-top) + 1.5rem)',
        paddingBottom: 'calc(env(safe-area-inset-bottom) + 5.5rem)'
      }}
    >
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-3xl p-6 shadow-md mb-5 text-center relative">
          <h1 className="text-2xl font-bold text-neutral-900">{APP_TITLE}</h1>
          <p className="text-neutral-500 mt-1">Datum: {todayDisplay}</p>
        </div>

        <div className="bg-white rounded-3xl p-6 shadow-md overflow-hidden">
          <PullToRefresh onRefresh={loadStaffConfig}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={location.pathname}
                initial={{ x: isPop ? '-100%' : '100%', opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: isPop ? '100%' : '-100%', opacity: 0 }}
                transition={{ duration: 0.25, ease: 'easeInOut' }}
              >
                <Outlet context={outletContext} />
              </motion.div>
            </AnimatePresence>
          </PullToRefresh>
        </div>
      </div>

      <TabNavigation />
    </div>
  );
}