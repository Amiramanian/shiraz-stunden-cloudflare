import React from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import ShiftStep from '@/components/worktime/ShiftStep';

export default function ShiftPage() {
  const navigate = useNavigate();
  const { selectedBusiness, selectedDepartment, selectedEmployee, todayIso, handleSaveShift, goToMain } = useOutletContext();

  if (!selectedEmployee) {
    return (
      <div className="text-center py-8 space-y-4">
        <p className="text-neutral-500">Bitte zuerst einen Mitarbeiter auswählen.</p>
        <button onClick={goToMain} className="px-6 py-3 rounded-xl bg-neutral-200 text-neutral-700 font-medium hover:bg-neutral-300 transition">
          Zurück zum Start
        </button>
      </div>
    );
  }

  return (
    <ShiftStep
      business={selectedBusiness}
      department={selectedDepartment}
      employee={selectedEmployee}
      todayIso={todayIso}
      onSave={handleSaveShift}
      onBack={() => navigate('/employee')}
      onDone={goToMain}
    />
  );
}