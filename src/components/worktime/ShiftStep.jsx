import React, { useState, useRef } from 'react';
import { ArrowLeft, Save, Clock } from 'lucide-react';
import { calculateDurationHours, normalizeTimeString } from '@/lib/timeUtils';

export default function ShiftStep({ business, department, employee, todayIso, onSave, onBack, onDone }) {
  const [date, setDate] = useState(todayIso);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [preview, setPreview] = useState(null);
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  function updatePreview(start, end) {
    if (!start || !end) {
      setPreview(null);
      return;
    }
    try {
      const hours = calculateDurationHours(start, end);
      setPreview(hours);
    } catch {
      setPreview(null);
    }
  }

  function handleStartChange(val) {
    setStartTime(val);
    updatePreview(val, endTime);
  }

  function handleEndChange(val) {
    setEndTime(val);
    updatePreview(startTime, val);
  }

  function normalizeOnBlur(setter, val) {
    if (!val.trim()) return;
    try {
      const normalized = normalizeTimeString(val);
      setter(normalized);
      updatePreview(
        setter === setStartTime ? normalized : startTime,
        setter === setEndTime ? normalized : endTime
      );
    } catch {
      // keep raw — validation on save
    }
  }

  async function handleSave() {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setStatus(null);
    try {
      const normStart = normalizeTimeString(startTime);
      const normEnd = normalizeTimeString(endTime);
      setStartTime(normStart);
      setEndTime(normEnd);

      const hours = calculateDurationHours(normStart, normEnd);

      await onSave({ date, startTime: normStart, endTime: normEnd, durationHours: hours });
      setStatus({ type: 'success', text: `Gespeichert ✅ Sum: ${hours.toFixed(2)} Stunden` });
      if (onDone) onDone();
    } catch (e) {
      window.alert('Fehler beim Speichern: ' + e.message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-center text-neutral-800">Arbeitszeit erfassen</h2>
      <div className="bg-neutral-50 rounded-xl p-3 text-sm space-y-1">
        <div>Auswahl: <strong>{business} / {department}</strong></div>
        <div>Mitarbeiter: <strong>{employee}</strong></div>
      </div>

      <div>
        <label className="block font-semibold text-sm text-neutral-700 mb-1">Datum</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full px-4 py-3 rounded-xl border border-neutral-200 bg-white text-base text-center text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-400"
        />
      </div>

      <div>
        <label className="block font-semibold text-sm text-neutral-700 mb-1">In</label>
        <input
          type="text"
          inputMode="numeric"
          value={startTime}
          onChange={(e) => handleStartChange(e.target.value)}
          onBlur={() => normalizeOnBlur(setStartTime, startTime)}
          placeholder="z.B. 11 oder 1130"
          className="w-full px-4 py-3 rounded-xl border border-neutral-200 bg-white text-base text-center text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-400"
        />
        <p className="text-xs text-neutral-500 mt-1 text-center">Beispiele: 11 = 11:00, 1130 = 11:30</p>
      </div>

      <div>
        <label className="block font-semibold text-sm text-neutral-700 mb-1">Out</label>
        <input
          type="text"
          inputMode="numeric"
          value={endTime}
          onChange={(e) => handleEndChange(e.target.value)}
          onBlur={() => normalizeOnBlur(setEndTime, endTime)}
          placeholder="z.B. 22 oder 2230"
          className="w-full px-4 py-3 rounded-xl border border-neutral-200 bg-white text-base text-center text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-400"
        />
        <p className="text-xs text-neutral-500 mt-1 text-center">Beispiele: 22 = 22:00, 2230 = 22:30</p>
      </div>

      {preview !== null && (
        <div className="bg-emerald-50 rounded-xl p-3 text-center font-bold text-emerald-800 flex items-center justify-center gap-2">
          <Clock size={18} />
          Sum: {preview.toFixed(2)} Stunden
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-emerald-800 text-white font-bold text-lg shadow-lg hover:bg-emerald-700 disabled:opacity-60 transition"
      >
        <Save size={22} />
        {saving ? 'Wird gespeichert...' : 'Speichern'}
      </button>
      <button
        onClick={onBack}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-neutral-200 text-neutral-700 font-medium hover:bg-neutral-300 transition"
      >
        <ArrowLeft size={18} /> Zurück
      </button>

      {status && (
        <div className={`text-center font-semibold text-sm ${status.type === 'error' ? 'text-red-600' : status.type === 'success' ? 'text-green-600' : 'text-neutral-600'}`}>
          {status.text}
        </div>
      )}
    </div>
  );
}