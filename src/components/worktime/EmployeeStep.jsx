import React, { useState } from 'react';
import { ArrowLeft, UserPlus, Search, EyeOff } from 'lucide-react';
import { normalizeSearchText } from '@/lib/staffConfig';

export default function EmployeeStep({
  business,
  department,
  employees,
  onSelectEmployee,
  onAddEmployee,
  onHideEmployee,
  onBack
}) {
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [status, setStatus] = useState(null);
  const [hiding, setHiding] = useState('');

  const filtered = employees.filter((emp) =>
    normalizeSearchText(emp).includes(normalizeSearchText(search))
  );

  async function handleAdd() {
    const name = newName.trim();
    if (!name || name.length < 2) {
      setStatus({ type: 'error', text: 'Bitte gültigen Namen eingeben.' });
      return;
    }
    setAdding(true);
    setStatus({ type: 'info', text: 'Mitarbeiter wird hinzugefügt...' });
    try {
      await onAddEmployee(name);
      setNewName('');
      setStatus({ type: 'success', text: 'Mitarbeiter hinzugefügt ✅' });
    } catch (e) {
      setStatus({ type: 'error', text: 'Fehler: ' + e.message });
    } finally {
      setAdding(false);
    }
  }

  async function handleHide(emp) {
    if (!window.confirm(`${emp} aus der App ausblenden?\n(Der Name bleibt aber im Excel-Report erhalten.)`)) return;
    setHiding(emp);
    try {
      await onHideEmployee(emp);
      setStatus({ type: 'success', text: `${emp} ausgeblendet ✅` });
    } catch (e) {
      setStatus({ type: 'error', text: 'Fehler: ' + e.message });
    } finally {
      setHiding('');
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-center text-neutral-800">Mitarbeiter auswählen</h2>
      <div className="bg-neutral-50 rounded-xl p-3 text-sm">
        Auswahl: <strong>{business} / {department}</strong>
      </div>

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
        {filtered.map((emp) => {
          return (
            <div key={emp} className="relative">
              <button
                onClick={() => onSelectEmployee(emp)}
                className="w-full py-5 pr-12 rounded-2xl bg-neutral-900 text-white font-bold text-base shadow hover:bg-neutral-700 active:scale-[0.98] transition"
              >
                {emp}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleHide(emp); }}
                disabled={hiding === emp}
                className="absolute top-1.5 right-1.5 w-7 h-7 flex items-center justify-center rounded-full bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-60 transition"
                title="Namen aus der App ausblenden (bleibt im Excel)"
              >
                <EyeOff size={16} />
              </button>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="col-span-full text-center text-neutral-500 py-4">
            Keine Mitarbeiter gefunden.
          </div>
        )}
      </div>

      <div className="border-t border-neutral-200 pt-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-neutral-600">
          <UserPlus size={18} /> Neuen Mitarbeiter hinzufügen
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Name..."
            className="flex-1 px-4 py-3 rounded-xl border border-neutral-200 bg-white text-base text-neutral-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
          <button
            onClick={handleAdd}
            disabled={adding}
            className="px-6 py-3 rounded-xl bg-amber-700 text-white font-bold hover:bg-amber-600 disabled:opacity-60 transition whitespace-nowrap"
          >
            {adding ? '...' : 'Hinzufügen'}
          </button>
        </div>
      </div>

      {status && (
        <div className={`text-center font-semibold text-sm ${status.type === 'error' ? 'text-red-600' : status.type === 'success' ? 'text-green-600' : 'text-neutral-600'}`}>
          {status.text}
        </div>
      )}

      <button
        onClick={onBack}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-neutral-200 text-neutral-700 font-medium hover:bg-neutral-300 transition"
      >
        <ArrowLeft size={18} /> Zurück
      </button>
    </div>
  );
}