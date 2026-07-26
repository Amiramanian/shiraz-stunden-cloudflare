import React from 'react';
import { useOutletContext } from 'react-router-dom';
import DepartmentStep from '@/components/worktime/DepartmentStep';
import { getDepartmentList } from '@/lib/staffConfig';

export default function DepartmentPage() {
  const { staffConfig, selectedBusiness, selectDepartment, goToMain } = useOutletContext();

  if (!staffConfig) return null;

  if (!selectedBusiness) {
    return (
      <div className="text-center py-8 space-y-4">
        <p className="text-neutral-500">Bitte zuerst ein Business auswählen.</p>
        <button onClick={goToMain} className="px-6 py-3 rounded-xl bg-neutral-200 text-neutral-700 font-medium hover:bg-neutral-300 transition">
          Zurück zum Start
        </button>
      </div>
    );
  }

  return (
    <DepartmentStep
      business={selectedBusiness}
      departments={getDepartmentList(selectedBusiness, staffConfig)}
      onSelectDepartment={selectDepartment}
      onBack={goToMain}
    />
  );
}