import React from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import EmployeeStep from '@/components/worktime/EmployeeStep';

export default function EmployeePage() {
  const navigate = useNavigate();
  const {
    staffConfig, selectedBusiness, selectedDepartment,
    selectEmployee, handleAddEmployee, handleHideEmployee, goToMain
  } = useOutletContext();

  if (!staffConfig) return null;

  if (!selectedBusiness || !selectedDepartment) {
    return (
      <div className="text-center py-8 space-y-4">
        <p className="text-neutral-500">Bitte zuerst Business und Abteilung auswählen.</p>
        <button onClick={goToMain} className="px-6 py-3 rounded-xl bg-neutral-200 text-neutral-700 font-medium hover:bg-neutral-300 transition">
          Zurück zum Start
        </button>
      </div>
    );
  }

  return (
    <EmployeeStep
      business={selectedBusiness}
      department={selectedDepartment}
      employees={staffConfig[selectedBusiness]?.[selectedDepartment] || []}
      onSelectEmployee={selectEmployee}
      onAddEmployee={handleAddEmployee}
      onHideEmployee={handleHideEmployee}
      onBack={() => navigate(selectedBusiness === 'Catering' ? '/' : '/department')}
    />
  );
}