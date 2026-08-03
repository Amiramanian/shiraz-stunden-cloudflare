import React, { useState, useEffect, useCallback } from 'react';
import { Outlet, useNavigate, useLocation, useNavigationType } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { base44 } from '@/api/base44Client';
import {
  buildEffectiveStaffConfig,
  getAllHinweisEmployees,
  normalizePersonName
} from '@/lib/staffConfig';
import TabNavigation from '@/components/worktime/TabNavigation';
import PullToRefresh from '@/components/PullToRefresh';
import { LogOut } from 'lucide-react';

const APP_TITLE = 'Arbeitszeiten Personal Shiraz';

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

  const todayIso = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
  const todayDisplay = new Date().toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });

  const loadStaffConfig = useCallback(async () => {
    setLoading(true);

    try {
      const additional = await base44.entities.StaffMember.list('-created_date', 5000);
      const config = buildEffectiveStaffConfig(additional || []);

      setStaffConfig(config);
      setAllStaff(getAllHinweisEmployees(config));
      setStaffMembers(additional || []);
    } catch (error) {
      console.warn('Mitarbeiter konnten nicht geladen werden:', error);

      const config = buildEffectiveStaffConfig([]);
      setStaffConfig(config);
      setAllStaff(getAllHinweisEmployees(config));
      setStaffMembers([]);
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
    setSelectedScanBusiness('');
    navigate('/');
  }

  function selectBusiness(business) {
    setSelectedBusiness(business);
    setSelectedDepartment('');
    setSelectedEmployee('');

    navigate('/department');
  }

  function selectDepartment(department) {
    setSelectedDepartment(department);
    setSelectedEmployee('');
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
  }

  async function handleHideEmployee(employee) {
    const employeeKey = normalizePersonName(employee);

    const record = staffMembers.find(
      (member) =>
        member.business === selectedBusiness &&
        member.department === selectedDepartment &&
        (member.employeeKey || normalizePersonName(member.employee)) === employeeKey
    );

    if (record?.hidden) return;

    if (record) {
      await base44.entities.StaffMember.update(record.id, {
        hidden: true
      });
    } else {
      await base44.entities.StaffMember.create({
        business: selectedBusiness,
        department: selectedDepartment,
        employee,
        employeeKey,
        hidden: true
      });
    }

    await loadStaffConfig();
  }

  async function handleSaveShift({
    date,
    startTime,
    endTime,
    durationHours
  }) {
    const employeeKey = normalizePersonName(selectedEmployee);

    const existing = await base44.entities.Shift.filter({
      business: selectedBusiness,
      department: selectedDepartment,
      employeeKey,
      date,
      startTime,
      endTime
    });

    if (existing?.length > 0) {
      throw new Error(
        'Diese Schicht wurde für diesen Mitarbeiter an diesem Tag bereits erfasst.'
      );
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
  }

  async function handleScanAddShifts(shifts) {
    const shiftsToCreate = [];

    for (const shift of shifts) {
      const employeeKey = normalizePersonName(shift.employee);

      const existing = await base44.entities.Shift.filter({
        business: shift.business,
        department: shift.department,
        employeeKey,
        date: shift.date,
        startTime: shift.startTime,
        endTime: shift.endTime
      });

      if (existing?.length > 0) continue;

      shiftsToCreate.push({
        ...shift,
        employeeKey
      });
    }

    if (shiftsToCreate.length === 0) {
      return {
        created: 0,
        skipped: shifts.length
      };
    }

    const result = await base44.entities.Shift.bulkCreate(shiftsToCreate);

    return result;
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
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-neutral-200 border-t-neutral-800 rounded-full animate-spin" />
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
          <button
            type="button"
            onClick={() => void base44.auth.logout()}
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-xl text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-800"
            aria-label="Abmelden"
            title="Abmelden"
          >
            <LogOut size={20} aria-hidden="true" />
          </button>
          <h1 className="text-2xl font-bold text-neutral-900">
            {APP_TITLE}
          </h1>

          <p className="text-neutral-500 mt-1">
            Datum: {todayDisplay}
          </p>
        </div>

        <div className="bg-white rounded-3xl p-6 shadow-md overflow-hidden">
          <PullToRefresh onRefresh={loadStaffConfig}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={location.pathname}
                initial={{
                  x: isPop ? '-100%' : '100%',
                  opacity: 0
                }}
                animate={{
                  x: 0,
                  opacity: 1
                }}
                exit={{
                  x: isPop ? '100%' : '-100%',
                  opacity: 0
                }}
                transition={{
                  duration: 0.25,
                  ease: 'easeInOut'
                }}
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
