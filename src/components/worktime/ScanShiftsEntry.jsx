import React, { useRef, useState } from 'react';
import { Camera, Loader2, Check, X, Trash2, RotateCcw } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { calculateDurationHours, normalizeTimeString } from '@/lib/timeUtils';
import { buildStaffDirectoryText, resolveShiftMatch } from '@/lib/shiftMatching';

// Read a File as a downscaled JPEG data URL so we can send images straight to the
// FreeModel backend function — no Base44 UploadFile needed (saves 1 credit per photo).
function fileToScaledDataUrl(file, maxDim = 1280, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function ScanShiftsEntry({ business, staffConfig, todayIso, onConfirmAll, onBack }) {
  const [status, setStatus] = useState('idle'); // idle | processing | preview | error | success
  const [errorMsg, setErrorMsg] = useState('');
  const [rows, setRows] = useState([]);
  const fileInputRef = useRef(null);

  async function handleFiles(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setStatus('processing');
    setErrorMsg('');
    try {
      const directory = buildStaffDirectoryText(staffConfig);
      const images = await Promise.all(files.map(fileToScaledDataUrl));
      const result = await base44.functions.invoke('scanShiftsWithFreeModel', {
        business,
        todayIso,
        directory,
        images
      });

      const parsedRows = (result.shifts || []).map((item, idx) => {
        const match = resolveShiftMatch(item, staffConfig);
        let normStart = item.startTime;
        let normEnd = item.endTime;
        let duration = null;
        try {
          normStart = normalizeTimeString(item.startTime);
          normEnd = normalizeTimeString(item.endTime);
          duration = calculateDurationHours(normStart, normEnd);
        } catch {
          // keep raw values, user corrects in the preview table
        }
        return {
          _key: idx,
          business: match.business,
          department: match.department,
          employee: match.employee || item.employee,
          date: item.date,
          startTime: normStart,
          endTime: normEnd,
          duration
        };
      });

      if (parsedRows.length === 0) {
        setErrorMsg('Keine Schichten auf den Bildern erkannt.');
        setStatus('error');
        return;
      }

      setRows(parsedRows);
      setStatus('preview');
    } catch (err) {
      console.error('Scan error:', err);
      setErrorMsg('Konnte die Bilder nicht verarbeiten: ' + (err?.message || err));
      setStatus('error');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function updateRowField(key, field, value) {
    setRows((prev) => prev.map((row) => {
      if (row._key !== key) return row;
      const next = { ...row, [field]: value };
      if (field === 'business') {
        const depts = Object.keys(staffConfig[value] || {});
        next.department = depts[0] || '';
        const emps = (staffConfig[value] || {})[next.department] || [];
        next.employee = emps[0] || '';
      }
      if (field === 'department') {
        const emps = (staffConfig[next.business] || {})[value] || [];
        next.employee = emps[0] || '';
      }
      return next;
    }));
  }

  function updateRowTime(key, field, value) {
    setRows((prev) => prev.map((row) => {
      if (row._key !== key) return row;
      const next = { ...row, [field]: value };
      try {
        next.duration = calculateDurationHours(next.startTime, next.endTime);
      } catch {
        next.duration = null;
      }
      return next;
    }));
  }

  function handleRowTimeBlur(key, field) {
    setRows((prev) => prev.map((row) => {
      if (row._key !== key || !row[field]) return row;
      try {
        const normalized = normalizeTimeString(row[field]);
        const next = { ...row, [field]: normalized };
        try {
          next.duration = calculateDurationHours(next.startTime, next.endTime);
        } catch {
          next.duration = null;
        }
        return next;
      } catch {
        return row;
      }
    }));
  }

  function removeRow(key) {
    setRows((prev) => prev.filter((row) => row._key !== key));
  }

  async function handleConfirmAll() {
    const validRows = rows.filter((r) => r.duration !== null);
    if (validRows.length === 0) return;
    setStatus('processing');
    try {
      await onConfirmAll(validRows.map((r) => ({
        business: r.business,
        department: r.department,
        employee: r.employee,
        date: r.date,
        startTime: r.startTime,
        endTime: r.endTime,
        durationHours: r.duration
      })));
      setStatus('success');
      setTimeout(() => reset(), 1500);
    } catch (err) {
      setErrorMsg('Fehler beim Speichern: ' + err.message);
      setStatus('error');
    }
  }

  function reset() {
    setRows([]);
    setErrorMsg('');
    setStatus('idle');
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-center text-neutral-800">Schichtplan scannen — {business}</h2>

      {status === 'idle' && (
        <div className="space-y-3">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 py-8 rounded-2xl bg-blue-800 text-white font-bold text-lg shadow-lg hover:bg-blue-700 active:scale-[0.98] transition"
          >
            <Camera size={28} /> Foto(s) auswählen
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFiles}
          />
          <button
            onClick={onBack}
            className="w-full py-3 rounded-xl bg-neutral-200 text-neutral-700 font-medium hover:bg-neutral-300 transition"
          >
            Zurück
          </button>
        </div>
      )}

      {status === 'processing' && (
        <div className="w-full flex items-center justify-center gap-2 py-8 text-neutral-600 font-semibold">
          <Loader2 size={22} className="animate-spin" /> Wird verarbeitet...
        </div>
      )}

      {status === 'preview' && (
        <div className="space-y-3">
          <p className="text-xs text-neutral-500 text-center">Bitte prüfen und bei Bedarf korrigieren:</p>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            {rows.map((row) => {
              const departments = Object.keys(staffConfig[row.business] || {});
              const employees = (staffConfig[row.business] || {})[row.department] || [];
              return (
                <div key={row._key} className="bg-neutral-50 rounded-xl p-3 text-sm space-y-2 relative">
                  <button
                    onClick={() => removeRow(row._key)}
                    className="absolute top-2 right-2 text-red-500 hover:text-red-700"
                  >
                    <Trash2 size={16} />
                  </button>
                  <div className="pr-6">
                    <label className="block text-xs font-semibold text-neutral-500 mb-1">Abteilung</label>
                    <select
                      value={row.department}
                      onChange={(e) => updateRowField(row._key, 'department', e.target.value)}
                      className="w-full px-2 py-2 rounded-lg border border-neutral-200 bg-white text-neutral-900"
                    >
                      {departments.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-neutral-500 mb-1">Mitarbeiter</label>
                    <select
                      value={row.employee}
                      onChange={(e) => updateRowField(row._key, 'employee', e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-neutral-200 bg-white text-neutral-900"
                    >
                      {employees.map((e) => <option key={e} value={e}>{e}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-neutral-500 mb-1">Datum</label>
                    <input
                      type="date"
                      value={row.date}
                      onChange={(e) => setRows((prev) => prev.map((r) => r._key === row._key ? { ...r, date: e.target.value } : r))}
                      className="w-full px-3 py-2 rounded-lg border border-neutral-200 bg-white text-neutral-900"
                    />
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="block text-xs font-semibold text-neutral-500 mb-1">In</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={row.startTime}
                        onChange={(e) => updateRowTime(row._key, 'startTime', e.target.value)}
                        onBlur={() => handleRowTimeBlur(row._key, 'startTime')}
                        className="w-full px-3 py-2 rounded-lg border border-neutral-200 bg-white text-neutral-900 text-center"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs font-semibold text-neutral-500 mb-1">Out</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={row.endTime}
                        onChange={(e) => updateRowTime(row._key, 'endTime', e.target.value)}
                        onBlur={() => handleRowTimeBlur(row._key, 'endTime')}
                        className="w-full px-3 py-2 rounded-lg border border-neutral-200 bg-white text-neutral-900 text-center"
                      />
                    </div>
                  </div>
                  {row.duration !== null ? (
                    <div className="text-center font-bold text-emerald-700 pt-1">
                      Sum: {row.duration.toFixed(2)} Stunden
                    </div>
                  ) : (
                    <div className="text-center font-semibold text-red-500 pt-1 text-xs">
                      Ungültige Zeit — bitte korrigieren
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleConfirmAll}
              disabled={rows.length === 0 || rows.every((r) => r.duration === null)}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-800 text-white font-bold hover:bg-emerald-700 disabled:opacity-60 transition"
            >
              <Check size={18} /> Alle bestätigen ({rows.filter((r) => r.duration !== null).length})
            </button>
            <button
              onClick={reset}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-neutral-200 text-neutral-700 font-medium hover:bg-neutral-300 transition"
            >
              <RotateCcw size={18} /> Erneut
            </button>
          </div>
        </div>
      )}

      {status === 'success' && (
        <div className="text-center font-semibold text-green-600 py-4">Alle Schichten gespeichert ✅</div>
      )}

      {status === 'error' && (
        <div className="space-y-2">
          <div className="text-center font-semibold text-red-600 text-sm">{errorMsg}</div>
          <button
            onClick={reset}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-neutral-200 text-neutral-700 font-medium hover:bg-neutral-300 transition"
          >
            <X size={18} /> Abbrechen
          </button>
        </div>
      )}
    </div>
  );
}