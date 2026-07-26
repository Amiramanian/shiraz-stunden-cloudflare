import React, { useRef, useState } from 'react';
import { Camera, Loader2, Check, X, Trash2, RotateCcw, AlertCircle, CheckCircle2 } from 'lucide-react';
import { calculateDurationHours, normalizeTimeString } from '@/lib/timeUtils';
import { buildEffectiveStaffConfig } from '@/lib/staffConfig';
import { preprocessImage, runLocalOCR, validateImage } from '@/lib/ocr';

export default function ScanShiftsEntry({ business, staffConfig, todayIso, onConfirmAll, onBack }) {
  const [status, setStatus] = useState('idle'); // idle | processing | preview | error | success
  const [errorMsg, setErrorMsg] = useState('');
  const [rows, setRows] = useState([]);
  const [selectedRows, setSelectedRows] = useState(new Set());
  const [processingDetails, setProcessingDetails] = useState('');
  const fileInputRef = useRef(null);

  // Map staffConfig to backend format
  const staffConfigForBackend = buildEffectiveStaffConfig(
    Object.entries(staffConfig[business] || {}).flatMap(([dept, employees]) =>
      employees.map(emp => ({
        business,
        department: dept,
        employee: emp,
        employeeKey: emp.toLowerCase().replace(/\s+/g, '').replace(/[.-]/g, '')
      }))
    )
  );

  async function handleFiles(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setStatus('processing');
    setErrorMsg('');
    setProcessingDetails('');
    setRows([]);
    setSelectedRows(new Set());

    try {
      setProcessingDetails('Bilder werden vorverarbeitet...');

      // Validate and preprocess images
      const processedImages = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const validError = validateImage(file);
        if (validError) {
          throw new Error(`${file.name}: ${validError}`);
        }

        setProcessingDetails(`Bild ${i + 1}/${files.length} wird vorverarbeitet...`);
        const preprocessed = await preprocessImage(file);
        processedImages.push(preprocessed);
      }

      setProcessingDetails('OCR wird ausgeführt (lokal)...');

      // Run local OCR
      const ocrResults = [];
      for (let i = 0; i < processedImages.length; i++) {
        setProcessingDetails(`OCR ${i + 1}/${processedImages.length}...`);
        const ocrText = await runLocalOCR(processedImages[i]);
        ocrResults.push(ocrText);
      }

      setProcessingDetails('KI-Analyse wird durchgeführt...');

      // Call backend with processed images
      const response = await fetch('/api/scan-shifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business,
          todayIso,
          staffConfig: staffConfigForBackend,
          images: processedImages
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `Server error: ${response.status}`);
      }

      const result = await response.json();

      if (!result.shifts || result.shifts.length === 0) {
        setErrorMsg('Keine Schichten auf den Bildern erkannt.');
        setStatus('error');
        return;
      }

      // Transform result for preview display
      const previewRows = result.shifts.map((item, idx) => ({
        _key: idx,
        _checked: true,
        _source: item.source || 'freemodel',
        _confidence: item.confidence || 0.8,
        business: item.matchedBusiness || business,
        department: item.matchedDepartment || item.department || '',
        employee: item.matchedEmployee || item.employee,
        date: item.date,
        startTime: item.normalizedStart,
        endTime: item.normalizedEnd,
        duration: calculateDurationHours(item.normalizedStart, item.normalizedEnd)
      }));

      setRows(previewRows);
      setSelectedRows(new Set(previewRows.map((_, idx) => idx)));
      setStatus('preview');
      setProcessingDetails('');
    } catch (err) {
      console.error('Scan error:', err);
      setErrorMsg('Verarbeitung fehlgeschlagen: ' + (err?.message || err));
      setStatus('error');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function updateRowField(key, field, value) {
    setRows((prev) =>
      prev.map((row) => {
        if (row._key !== key) return row;
        const next = { ...row, [field]: value };
        return next;
      })
    );
  }

  function deleteRow(key) {
    setRows((prev) => prev.filter((row) => row._key !== key));
    setSelectedRows((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }

  function toggleRow(key) {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function selectAll() {
    setSelectedRows(new Set(rows.map((row) => row._key)));
  }

  function deselectAll() {
    setSelectedRows(new Set());
  }

  function addRow() {
    const newKey = Math.max(...rows.map((r) => r._key), -1) + 1;
    setRows((prev) => [
      ...prev,
      {
        _key: newKey,
        _checked: true,
        _source: 'manual',
        _confidence: 1.0,
        business,
        department: '',
        employee: '',
        date: todayIso,
        startTime: '',
        endTime: '',
        duration: null
      }
    ]);
  }

  async function saveSelected() {
    const selectedShifts = rows.filter((row) => selectedRows.has(row._key));

    if (selectedShifts.length === 0) {
      setErrorMsg('Bitte wählen Sie mindestens eine Schicht aus.');
      return;
    }

    try {
      setStatus('processing');
      setProcessingDetails(`${selectedShifts.length} Schichten werden gespeichert...`);

      const response = await fetch('/api/shifts/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shifts: selectedShifts.map((row) => ({
            business: row.business,
            department: row.department,
            employee: row.employee,
            employeeKey: row.employee.toLowerCase().replace(/\s+/g, ''),
            date: row.date,
            startTime: row.startTime,
            endTime: row.endTime,
            durationHours: row.duration
          }))
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Fehler beim Speichern');
      }

      setStatus('success');
      setProcessingDetails(`${selectedShifts.length} Schichten gespeichert`);

      setTimeout(() => {
        onConfirmAll(selectedShifts);
      }, 1500);
    } catch (err) {
      setErrorMsg('Fehler beim Speichern: ' + (err?.message || err));
      setStatus('error');
    }
  }

  function getConfidenceColor(confidence) {
    if (confidence >= 0.9) return 'bg-green-100 text-green-800';
    if (confidence >= 0.7) return 'bg-yellow-100 text-yellow-800';
    return 'bg-red-100 text-red-800';
  }

  function getSourceLabel(source) {
    return source === 'manual' ? 'Manuell' : source === 'ocr' ? 'OCR' : 'KI';
  }

  if (status === 'idle' || status === 'processing') {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-6">
        {status === 'idle' ? (
          <>
            <div className="bg-blue-50 rounded-full p-6 mb-6">
              <Camera className="w-12 h-12 text-blue-600" />
            </div>
            <h2 className="text-2xl font-bold mb-2">Schichten scannen</h2>
            <p className="text-neutral-600 mb-6 text-center">
              Laden Sie Fotos von Schichtplänen hoch. Verwendet werden lokale OCR und KI-Analyse.
            </p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="bg-blue-600 text-white px-8 py-3 rounded-lg font-medium hover:bg-blue-700 transition"
            >
              Bilder auswählen
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*"
              onChange={handleFiles}
              className="hidden"
            />
          </>
        ) : (
          <>
            <Loader2 className="w-12 h-12 text-blue-600 animate-spin mb-4" />
            <p className="font-medium text-lg mb-2">Wird verarbeitet...</p>
            <p className="text-neutral-600">{processingDetails}</p>
          </>
        )}
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-6">
        <div className="bg-red-50 rounded-full p-6 mb-6">
          <AlertCircle className="w-12 h-12 text-red-600" />
        </div>
        <h2 className="text-2xl font-bold mb-2 text-red-900">Fehler</h2>
        <p className="text-red-700 mb-6 text-center">{errorMsg}</p>
        <div className="flex gap-3">
          <button
            onClick={() => {
              setStatus('idle');
              setErrorMsg('');
            }}
            className="bg-red-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-red-700 transition"
          >
            Zurück
          </button>
          <button
            onClick={onBack}
            className="bg-neutral-300 text-neutral-800 px-6 py-2 rounded-lg font-medium hover:bg-neutral-400 transition"
          >
            Abbrechen
          </button>
        </div>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-6">
        <div className="bg-green-50 rounded-full p-6 mb-6">
          <CheckCircle2 className="w-12 h-12 text-green-600" />
        </div>
        <h2 className="text-2xl font-bold mb-2 text-green-900">Erfolg!</h2>
        <p className="text-green-700 mb-6 text-center">{processingDetails}</p>
      </div>
    );
  }

  // Preview mode
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-6 pb-4 border-b">
        <h2 className="text-2xl font-bold">Vorschau ({rows.length} Schichten)</h2>
      </div>

      {errorMsg && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4 text-red-700">
          {errorMsg}
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap gap-2 mb-6 pb-6 border-b">
        <button
          onClick={selectAll}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition"
        >
          Alle auswählen
        </button>
        <button
          onClick={deselectAll}
          className="bg-neutral-300 text-neutral-800 px-4 py-2 rounded-lg text-sm font-medium hover:bg-neutral-400 transition"
        >
          Auswahl aufheben
        </button>
        <button
          onClick={addRow}
          className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 transition"
        >
          + Zeile hinzufügen
        </button>
        <button
          onClick={() => {
            setStatus('idle');
            setRows([]);
            setSelectedRows(new Set());
          }}
          className="bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-orange-700 transition"
        >
          Erneut scannen
        </button>
      </div>

      {/* Shifts table */}
      <div className="flex-1 overflow-auto mb-6">
        <div className="space-y-3">
          {rows.map((row) => (
            <div
              key={row._key}
              className="bg-white border border-neutral-200 rounded-lg p-4 flex items-center gap-4"
            >
              <input
                type="checkbox"
                checked={selectedRows.has(row._key)}
                onChange={() => toggleRow(row._key)}
                className="w-5 h-5 rounded accent-blue-600"
              />

              {/* Confidence badge */}
              <div
                className={`px-2 py-1 rounded text-xs font-medium whitespace-nowrap ${getConfidenceColor(row._confidence)}`}
              >
                {Math.round(row._confidence * 100)}%
              </div>

              {/* Source badge */}
              <div className="px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-800 whitespace-nowrap">
                {getSourceLabel(row._source)}
              </div>

              {/* Editable fields */}
              <div className="flex-1 grid grid-cols-4 gap-2 text-sm">
                <select
                  value={row.department}
                  onChange={(e) => updateRowField(row._key, 'department', e.target.value)}
                  className="border rounded px-2 py-1"
                >
                  <option value="">Abt. wählen</option>
                  {Object.keys(staffConfig[business] || {}).map((dept) => (
                    <option key={dept} value={dept}>
                      {dept}
                    </option>
                  ))}
                </select>

                <select
                  value={row.employee}
                  onChange={(e) => updateRowField(row._key, 'employee', e.target.value)}
                  className="border rounded px-2 py-1"
                >
                  <option value="">MA wählen</option>
                  {(staffConfig[business]?.[row.department] || []).map((emp) => (
                    <option key={emp} value={emp}>
                      {emp}
                    </option>
                  ))}
                </select>

                <input
                  type="date"
                  value={row.date}
                  onChange={(e) => updateRowField(row._key, 'date', e.target.value)}
                  className="border rounded px-2 py-1"
                />

                <div className="flex gap-1">
                  <input
                    type="time"
                    value={row.startTime}
                    onChange={(e) => updateRowField(row._key, 'startTime', e.target.value)}
                    className="border rounded px-2 py-1 flex-1"
                    placeholder="Start"
                  />
                  <input
                    type="time"
                    value={row.endTime}
                    onChange={(e) => updateRowField(row._key, 'endTime', e.target.value)}
                    className="border rounded px-2 py-1 flex-1"
                    placeholder="Ende"
                  />
                </div>
              </div>

              <button
                onClick={() => deleteRow(row._key)}
                className="text-red-600 hover:text-red-700 p-1"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Footer buttons */}
      <div className="flex gap-3 pt-4 border-t">
        <button
          onClick={saveSelected}
          disabled={selectedRows.size === 0}
          className="flex-1 bg-green-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-green-700 disabled:bg-neutral-300 transition"
        >
          <Check className="w-5 h-5 inline mr-2" />
          {selectedRows.size} Schichten speichern
        </button>
        <button
          onClick={onBack}
          className="bg-neutral-300 text-neutral-800 px-6 py-3 rounded-lg font-medium hover:bg-neutral-400 transition"
        >
          Abbrechen
        </button>
      </div>
    </div>
  );
}