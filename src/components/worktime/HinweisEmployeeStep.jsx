import React, { useState } from 'react';
import { ArrowLeft, Search } from 'lucide-react';
import { normalizeSearchText } from '@/lib/staffConfig';

export default function HinweisEmployeeStep({ allStaff, onSelectEmployee, onBack }) {
  const [search, setSearch] = useState('');

  const filtered = allStaff.filter((emp) =>
    normalizeSearchText(emp).includes(normalizeSearchText(search))
  );

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-center text-neutral-800">Mitarbeiter für Hinweis auswählen</h2>

      <div className="relative">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Name suchen..."
          className="w-full pl-10 pr-4 py-3 rounded-xl border border-neutral-200 bg-white text-base text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-400"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {filtered.map((emp) => (
          <button
            key={emp}
            onClick={() => onSelectEmployee(emp)}
            className="py-5 rounded-2xl bg-neutral-900 text-white font-bold text-base shadow hover:bg-neutral-700 active:scale-[0.98] transition"
          >
            {emp}
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full text-center text-neutral-500 py-4">
            Keine Mitarbeiter gefunden.
          </div>
        )}
      </div>

      <button
        onClick={onBack}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-neutral-200 text-neutral-700 font-medium hover:bg-neutral-300 transition"
      >
        <ArrowLeft size={18} /> Zurück
      </button>
    </div>
  );
}