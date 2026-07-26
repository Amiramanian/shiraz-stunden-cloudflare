import React from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import HinweisStep from '@/components/worktime/HinweisStep';

export default function HinweisPage() {
  const navigate = useNavigate();
  const { selectedHinweisEmployee, todayIso, handleSaveHinweis, goToMain } = useOutletContext();

  if (!selectedHinweisEmployee) {
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
    <HinweisStep
      employee={selectedHinweisEmployee}
      todayIso={todayIso}
      onSave={handleSaveHinweis}
      onBack={() => navigate('/hinweis-employee')}
      onDone={goToMain}
    />
  );
}