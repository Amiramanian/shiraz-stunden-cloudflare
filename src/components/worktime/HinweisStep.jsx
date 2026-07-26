import React, { useState, useRef } from 'react';
import { ArrowLeft, Save } from 'lucide-react';

export default function HinweisStep({ employee, todayIso, onSave, onBack, onDone }) {
  const [date, setDate] = useState(todayIso);
  const [text, setText] = useState('');
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  async function handleSave() {
    if (savingRef.current) return;
    if (!text.trim()) {
      setStatus({ type: 'error', text: 'Fehler: Bitte Hinweis-Text eingeben.' });
      return;
    }
    savingRef.current = true;
    setStatus({ type: 'success', text: 'Hinweis gespeichert ✅' });
    try {
      const savePromise = onSave({ date, text: text.trim() });
      if (onDone) onDone();
      await savePromise;
    } catch (e) {
      window.alert('Fehler beim Speichern: ' + e.message);
    } finally {
      savingRef.current = false;
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-center text-neutral-800">Hinweis speichern</h2>
      <div className="bg-neutral-50 rounded-xl p-3 text-sm">
        Mitarbeiter: <strong>{employee}</strong>
      </div>

      <div>
        <label className="block font-semibold text-sm text-neutral-700 mb-1">Datum</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full px-4 py-3 rounded-xl border border-neutral-200 bg-white text-base text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-400"
        />
      </div>

      <div>
        <label className="block font-semibold text-sm text-neutral-700 mb-1">Hinweis</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Hier Hinweis schreiben..."
          className="w-full px-4 py-3 rounded-xl border border-neutral-200 bg-white text-base text-neutral-900 min-h-[150px] resize-y focus:outline-none focus:ring-2 focus:ring-neutral-400"
        />
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-emerald-800 text-white font-bold text-lg shadow-lg hover:bg-emerald-700 disabled:opacity-60 transition"
      >
        <Save size={22} />
        {saving ? 'Wird gespeichert...' : 'Hinweis speichern'}
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