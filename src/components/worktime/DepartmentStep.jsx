import React from 'react';
import { ArrowLeft } from 'lucide-react';

export default function DepartmentStep({ business, departments, onSelectDepartment, onBack }) {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-center text-neutral-800">Bereich auswählen</h2>
      <p className="text-center text-sm text-neutral-500">{business}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {departments.map((dept) => (
          <button
            key={dept}
            onClick={() => onSelectDepartment(dept)}
            className="py-6 rounded-2xl bg-neutral-900 text-white font-bold text-lg shadow-lg hover:bg-neutral-700 active:scale-[0.98] transition"
          >
            {dept}
          </button>
        ))}
      </div>
      <button
        onClick={onBack}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-neutral-200 text-neutral-700 font-medium hover:bg-neutral-300 transition"
      >
        <ArrowLeft size={18} />
        Zurück
      </button>
    </div>
  );
}