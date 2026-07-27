import React, { useEffect, useRef, useState } from 'react';
import { Camera, Loader2, Check, Trash2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { calculateDurationHours, normalizeTimeString } from '@/lib/timeUtils';
import { buildEffectiveStaffConfig } from '@/lib/staffConfig';
import {
  prepareImageForCloud,
  preprocessImage,
  runLocalOCRBatch,
  validateImage,
  validateImages
} from '@/lib/ocr';

function validateShiftRow(row) {
  const errors = [];
  let duration = null;

  if (!String(row.department || '').trim()) errors.push('Abteilung fehlt');
  if (!String(row.employee || '').trim()) errors.push('Name fehlt');

  const date = String(row.date || '');
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? new Date(`${date}T00:00:00Z`)
    : null;
  if (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
    errors.push('Datum prüfen');
  }

  const startTime = String(row.startTime || '');
  const endTime = String(row.endTime || '');
  if (!/^\d{2}:\d{2}$/.test(startTime)) errors.push('Startzeit im Format HH:MM');
  if (!/^\d{2}:\d{2}$/.test(endTime)) errors.push('Endzeit im Format HH:MM');

  if (errors.length === 0) {
    try {
      duration = calculateDurationHours(startTime, endTime);
    } catch {
      errors.push('Uhrzeiten prüfen');
    }
  }

  return { valid: errors.length === 0, errors, duration };
}

export default function ScanShiftsEntry({ business, staffConfig, todayIso, onConfirmAll, onBack }) {
  const [status, setStatus] = useState('idle'); // idle | processing | preview | error | success
  const [errorMsg, setErrorMsg] = useState('');
  const [warningMsg, setWarningMsg] = useState('');
  const [rows, setRows] = useState([]);
  const [selectedRows, setSelectedRows] = useState(new Set());
  const [scanId, setScanId] = useState('');
  const [processingDetails, setProcessingDetails] = useState('');
  const fileInputRef = useRef(null);
  const lastScanRef = useRef(null);

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

  function createManualRow(key = 0) {
    return {
      _key: key,
      _checked: false,
      _source: 'manual',
      _confidence: 1,
      _needsReview: true,
      _reviewReasons: ['Bitte Angaben vervollständigen und bestätigen'],
      _validationErrors: [],
      _rawEmployee: '',
      _rawDepartment: '',
      _suggestedEmployee: '',
      business,
      department: '',
      employee: '',
      date: '',
      startTime: '',
      endTime: '',
      duration: null
    };
  }

  async function requestScan(scanInput, ocrTexts = []) {
    const response = await fetch('/api/scan-shifts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        business,
        todayIso,
        staffConfig: staffConfigForBackend,
        images: scanInput.cloudImages,
        // Filenames are display/audit labels only. They never drive extraction.
        imageNames: scanInput.files.map((file) => file.name),
        ocrTexts
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `Server error: ${response.status}`);
    }

    return response.json();
  }

  function shouldRunDetailedScan(result) {
    return (
      result?.manualFallback ||
      !Array.isArray(result?.shifts) ||
      result.shifts.length === 0 ||
      result?.requiresDetailedScan === true ||
      result?.detailedScanRecommended === true ||
      result?.retryWithOcr === true
    );
  }

  function presentScanResult(result) {
    setScanId(result?.scanId || '');
    const warningText = Array.isArray(result?.warnings)
      ? result.warnings.join(' ')
      : '';
    setWarningMsg(warningText);

    if (!Array.isArray(result?.shifts) || result.shifts.length === 0) {
      const manualRows = [createManualRow(0)];
      setRows(manualRows);
      setSelectedRows(new Set());
      setWarningMsg(
        [warningText, 'Keine sichere Zeile erkannt. Bitte manuell ergänzen oder erneut genauer scannen.']
          .filter(Boolean)
          .join(' ')
      );
      setStatus('preview');
      setProcessingDetails('');
      return;
    }

    const previewRows = result.shifts.map((item, idx) => {
      const startTime = item.normalizedStart || item.startTime || '';
      const endTime = item.normalizedEnd || item.endTime || '';
      const baseRow = {
        _key: idx,
        _checked: !item.needsReview,
        _source: item.source || result.provider || 'gemini',
        _confidence: Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : 0.5,
        _needsReview: Boolean(item.needsReview),
        _reviewReasons: Array.isArray(item.reviewReasons) ? item.reviewReasons : [],
        _imageName: item.imageName || '',
        _evidence: item.evidence || '',
        _writtenHours: item.writtenHours || '',
        _rawEmployee: item.rawEmployee || item.employee || '',
        _rawDepartment: item.department || '',
        _suggestedEmployee: item.matchedEmployee || item.employee || '',
        business: item.matchedBusiness || business,
        department: item.matchedDepartment || item.department || '',
        employee: item.matchedEmployee || item.employee || '',
        date: item.date || '',
        startTime,
        endTime,
        duration: null,
        _original: {
          employee: item.matchedEmployee || item.employee || '',
          department: item.matchedDepartment || item.department || '',
          date: item.date || '',
          startTime,
          endTime
        }
      };
      const validation = validateShiftRow(baseRow);
      return {
        ...baseRow,
        duration: validation.duration,
        _validationErrors: validation.errors,
        _needsReview: baseRow._needsReview || !validation.valid,
        _reviewReasons: validation.valid ? baseRow._reviewReasons : validation.errors
      };
    });

    setRows(previewRows);
    setSelectedRows(new Set(
      previewRows
        .filter((row) => !row._needsReview && validateShiftRow(row).valid)
        .map((row) => row._key)
    ));
    setStatus('preview');
    setProcessingDetails('');
  }

  async function runDetailedScan(scanInput, fallbackResult = null) {
    setStatus('processing');
    setErrorMsg('');
    setProcessingDetails('Genauer Scan: Bilder für lokale OCR vorbereiten...');

    try {
      const localOcrImages = [];
      for (let index = 0; index < scanInput.files.length; index += 1) {
        setProcessingDetails(
          `Genauer Scan: Bild ${index + 1}/${scanInput.files.length} vorbereiten...`
        );
        localOcrImages.push(await preprocessImage(scanInput.files[index]));
      }

      const ocrTexts = await runLocalOCRBatch(localOcrImages, (progress) => {
        const percent = Math.round((progress.progress || 0) * 100);
        setProcessingDetails(
          `Lokale OCR ${progress.imageIndex + 1}/${progress.imageCount}: ${percent}%`
        );
      });

      if (!ocrTexts.some((text) => String(text || '').trim())) {
        if (fallbackResult) presentScanResult(fallbackResult);
        setWarningMsg(
          'Die lokale OCR konnte keinen zusätzlichen Text lesen. Es wurde kein zweiter KI-Aufruf verbraucht.'
        );
        setStatus(fallbackResult || rows.length > 0 ? 'preview' : 'error');
        if (!fallbackResult && rows.length === 0) {
          setErrorMsg('Die lokale OCR konnte keinen Text erkennen.');
        }
        return;
      }

      setProcessingDetails('Genauer Scan: KI-Analyse mit OCR-Hinweisen...');
      const result = await requestScan(scanInput, ocrTexts);
      scanInput.latestResult = result;
      presentScanResult(result);
    } catch (error) {
      console.warn('Detailed OCR scan failed:', error);
      if (fallbackResult) {
        presentScanResult(fallbackResult);
        setWarningMsg(
          `Der schnelle Scan wurde angezeigt. Der genauere OCR-Scan ist fehlgeschlagen: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        return;
      }
      setErrorMsg('Genauer Scan fehlgeschlagen: ' + (error?.message || error));
      setStatus(rows.length > 0 ? 'preview' : 'error');
    }
  }

  async function requestDetailedScan() {
    if (!lastScanRef.current) return;
    await runDetailedScan(lastScanRef.current);
  }

  async function handleFiles(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setStatus('processing');
    setErrorMsg('');
    setWarningMsg('');
    setProcessingDetails('');
    setRows([]);
    setSelectedRows(new Set());
    setScanId('');

    try {
      const selectionError = validateImages(files);
      if (selectionError) throw new Error(selectionError);

      const cloudImages = [];
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const validError = validateImage(file);
        if (validError) throw new Error(`${file.name}: ${validError}`);

        setProcessingDetails(`Schneller Scan: Bild ${index + 1}/${files.length} vorbereiten...`);
        cloudImages.push(await prepareImageForCloud(file));
      }

      const scanInput = { files, cloudImages, latestResult: null };
      lastScanRef.current = scanInput;
      setProcessingDetails('Schneller Cloud-Scan läuft...');
      const result = await requestScan(scanInput);
      scanInput.latestResult = result;

      if (shouldRunDetailedScan(result)) {
        await runDetailedScan(scanInput, result);
      } else {
        presentScanResult(result);
      }
    } catch (err) {
      console.error('Scan error:', err);
      setErrorMsg('Verarbeitung fehlgeschlagen: ' + (err?.message || err));
      setStatus('error');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function commitRowChange(key, changes, { confirmWhenValid = true } = {}) {
    const current = rows.find((row) => row._key === key);
    if (!current) return;

    const candidate = { ...current, ...changes };
    const validation = validateShiftRow(candidate);
    const next = {
      ...candidate,
      duration: validation.duration,
      _validationErrors: validation.errors
    };

    if (validation.valid && confirmWhenValid) {
      next._needsReview = false;
      next._reviewReasons = [];
      next._confidence = Math.max(Number(next._confidence) || 0, 0.9);
      next._correctionConfirmed = true;
    } else if (!validation.valid) {
      next._needsReview = true;
      next._reviewReasons = validation.errors;
      next._correctionConfirmed = false;
    }

    setRows((prev) => prev.map((row) => (row._key === key ? next : row)));
    setSelectedRows((prev) => {
      const selected = new Set(prev);
      if (validation.valid && confirmWhenValid) selected.add(key);
      if (!validation.valid) selected.delete(key);
      return selected;
    });
    if (validation.valid) setErrorMsg('');
  }

  function updateRowField(key, field, value) {
    commitRowChange(key, { [field]: value });
  }

  function normalizeRowTime(key, field) {
    const row = rows.find((item) => item._key === key);
    if (!row || !String(row[field] || '').trim()) return;

    try {
      commitRowChange(key, { [field]: normalizeTimeString(row[field]) });
    } catch {
      commitRowChange(key, { [field]: row[field] });
    }
  }

  function confirmReviewedRow(key) {
    const row = rows.find((item) => item._key === key);
    if (!row) return;
    const validation = validateShiftRow(row);
    if (!validation.valid) {
      commitRowChange(key, {}, { confirmWhenValid: false });
      return;
    }
    commitRowChange(key, {}, { confirmWhenValid: true });
  }

  useEffect(() => {
    if (
      status === 'preview' &&
      rows.length > 0 &&
      rows.every((row) => !row._needsReview && validateShiftRow(row).valid)
    ) {
      setWarningMsg('');
    }
  }, [rows, status]);

  function deleteRow(key) {
    setRows((prev) => prev.filter((row) => row._key !== key));
    setSelectedRows((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }

  function toggleRow(key) {
    const row = rows.find((item) => item._key === key);
    if (!row) return;
    const validation = validateShiftRow(row);

    if (!selectedRows.has(key) && !validation.valid) {
      commitRowChange(key, {}, { confirmWhenValid: false });
      return;
    }

    if (!selectedRows.has(key) && row._needsReview) {
      confirmReviewedRow(key);
      return;
    }

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
    const validRows = rows.filter((row) => validateShiftRow(row).valid);
    setRows((prev) =>
      prev.map((row) => {
        if (!validRows.some((validRow) => validRow._key === row._key)) return row;
        return {
          ...row,
          _needsReview: false,
          _reviewReasons: [],
          _correctionConfirmed: row._correctionConfirmed || row._needsReview
        };
      })
    );
    setSelectedRows(new Set(validRows.map((row) => row._key)));
  }

  function deselectAll() {
    setSelectedRows(new Set());
  }

  function addRow() {
    const newKey = Math.max(...rows.map((r) => r._key), -1) + 1;
    setRows((prev) => [
      ...prev,
      createManualRow(newKey)
    ]);
  }

  async function saveSelected() {
    const selectedShifts = rows.filter((row) => selectedRows.has(row._key));

    if (selectedShifts.length === 0) {
      setErrorMsg('Bitte wählen Sie mindestens eine Schicht aus.');
      return;
    }

    const incompleteShift = selectedShifts.find((row) =>
      !row.department ||
      !row.employee ||
      !row.date ||
      !row.startTime ||
      !row.endTime ||
      row.duration == null
    );
    if (incompleteShift) {
      setErrorMsg('Bitte alle ausgewählten Schichten vollständig ausfüllen und die Uhrzeiten prüfen.');
      return;
    }

    try {
      setStatus('processing');
      setProcessingDetails(`${selectedShifts.length} Schichten werden gespeichert...`);

      const learnedCorrections = selectedShifts
        .filter((row) => {
          if (!scanId || !row._rawEmployee || !row._original) return false;
          return ['employee', 'department', 'date', 'startTime', 'endTime']
            .some((field) => String(row[field] || '') !== String(row._original[field] || ''));
        })
        .map((row) => ({
          rawEmployee: row._rawEmployee,
          suggestedEmployee: row._suggestedEmployee || undefined,
          rawDepartment: row._rawDepartment || row._original.department,
          original: row._original,
          final: {
            employee: row.employee,
            department: row.department,
            date: row.date,
            startTime: row.startTime,
            endTime: row.endTime
          }
        }));

      const response = await fetch('/api/shifts/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scanId: scanId || undefined,
          corrections: learnedCorrections,
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

      const saveResult = await response.json();
      setStatus('success');
      const syncMessage = saveResult.excelSynced
        ? 'Direkt mit Excel synchronisiert.'
        : `Gespeichert, aber Excel-Synchronisierung fehlgeschlagen: ${saveResult.syncError || 'unbekannter Fehler'}`;
      const learningMessage = saveResult.learnedCorrections > 0
        ? ` ${saveResult.learnedCorrections} Korrektur(en) gelernt.`
        : '';
      setProcessingDetails(
        `${saveResult.created ?? selectedShifts.length} Schichten gespeichert. ${syncMessage}${learningMessage}`
      );

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
    if (source === 'manual') return 'Manuell';
    if (source === 'ocr') return 'OCR';
    if (source === 'gemini') return 'Gemini';
    return 'KI';
  }

  const selectedDuration = rows
    .filter((row) => selectedRows.has(row._key))
    .reduce(
      (total, row) => total + (Number.isFinite(Number(row.duration)) ? Number(row.duration) : 0),
      0
    );
  const formattedSelectedDuration = selectedDuration.toLocaleString('de-DE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });

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
              Laden Sie ein oder mehrere Fotos hoch. Zuerst läuft der schnelle Cloud-Scan;
              lokale OCR wird nur bei Bedarf nachgeladen.
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
        <div className="flex flex-wrap justify-center gap-3">
          {lastScanRef.current && (
            <button
              onClick={requestDetailedScan}
              className="bg-indigo-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-indigo-700 transition"
            >
              Genauer scannen
            </button>
          )}
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
    <div className="flex h-full min-w-0 flex-col overflow-x-hidden">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <h2 className="text-2xl font-bold">Vorschau ({rows.length} Schichten)</h2>
        <div
          className="rounded-lg bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-900"
          aria-live="polite"
        >
          Ausgewählt: {selectedRows.size} · Gesamt: {formattedSelectedDuration} Std.
        </div>
      </div>

      {errorMsg && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4 text-red-700">
          {errorMsg}
        </div>
      )}

      {warningMsg && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4 text-amber-800">
          {warningMsg}
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
        {lastScanRef.current && (
          <button
            onClick={requestDetailedScan}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition"
          >
            Genauer scannen
          </button>
        )}
        <button
          onClick={() => {
            setStatus('idle');
            setRows([]);
            setSelectedRows(new Set());
            setWarningMsg('');
            setScanId('');
            lastScanRef.current = null;
          }}
          className="bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-orange-700 transition"
        >
          Erneut scannen
        </button>
      </div>

      {/* Shifts table */}
      <div className="mb-6 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="space-y-3">
          {rows.map((row) => (
            <div
              key={row._key}
              className="min-w-0 rounded-lg border border-neutral-300 bg-white p-3 text-neutral-900 sm:p-4"
            >
              <div className="flex min-w-0 items-start gap-3">
                <input
                  type="checkbox"
                  checked={selectedRows.has(row._key)}
                  onChange={() => toggleRow(row._key)}
                  className="mt-1 h-5 w-5 shrink-0 rounded accent-blue-600"
                  aria-label={`${row.employee || 'Schicht'} auswählen`}
                />

                <div className="min-w-0 flex-1">
                  <div className="mb-3 flex min-w-0 flex-wrap items-center gap-2 text-xs text-neutral-700">
                    <span
                      className={`whitespace-nowrap rounded px-2 py-1 font-medium ${getConfidenceColor(row._confidence)}`}
                    >
                      {Math.round(row._confidence * 100)}%
                    </span>
                    <span className="whitespace-nowrap rounded bg-blue-100 px-2 py-1 font-medium text-blue-800">
                      {getSourceLabel(row._source)}
                    </span>
                  {row._correctionConfirmed && (
                    <span className="rounded bg-emerald-100 px-2 py-1 font-semibold text-emerald-800">
                      Korrigiert und bestätigt
                    </span>
                  )}
                  {row._imageName && (
                    <span className="rounded bg-neutral-100 px-2 py-1">
                      Bild: {row._imageName}
                    </span>
                  )}
                  {row._needsReview && (
                    <>
                      <span className="rounded bg-red-100 px-2 py-1 font-medium text-red-800">
                        Prüfen: {row._reviewReasons.join(', ')}
                      </span>
                      {validateShiftRow(row).valid && (
                        <button
                          type="button"
                          onClick={() => confirmReviewedRow(row._key)}
                          className="rounded bg-emerald-600 px-3 py-1 font-semibold text-white hover:bg-emerald-700"
                        >
                          Korrektur bestätigen
                        </button>
                      )}
                    </>
                  )}
                  {row._evidence && (
                    <span className="min-w-0 max-w-full break-words" title={row._evidence}>
                      Gelesen: {row._evidence}
                    </span>
                  )}
                  {row._writtenHours && (
                    <span className="rounded bg-neutral-100 px-2 py-1">
                      Summe: {row._writtenHours}
                    </span>
                  )}
                    <span className="ml-auto whitespace-nowrap rounded bg-emerald-50 px-2 py-1 font-semibold text-emerald-900">
                      {row.duration == null ? 'Std.: –' : `Std.: ${Number(row.duration).toLocaleString('de-DE', { maximumFractionDigits: 2 })}`}
                    </span>
                    <button
                      onClick={() => deleteRow(row._key)}
                      className="shrink-0 rounded p-1 text-red-600 hover:bg-red-50 hover:text-red-700"
                      aria-label={`${row.employee || 'Schicht'} löschen`}
                    >
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </div>

                  <div
                    className="grid min-w-0 gap-2 text-sm"
                    style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 9rem), 1fr))' }}
                  >
                    <label className="min-w-0">
                      <span className="mb-1 block text-xs font-medium text-neutral-600">Abteilung</span>
                      <select
                        value={row.department}
                        onChange={(e) => updateRowField(row._key, 'department', e.target.value)}
                        className="w-full min-w-0 rounded border border-neutral-300 bg-white px-2 py-2 text-neutral-900 [color-scheme:light]"
                      >
                        <option value="">Abt. wählen</option>
                        {Object.keys(staffConfig[business] || {}).map((dept) => (
                          <option key={dept} value={dept}>
                            {dept}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="min-w-0">
                      <span className="mb-1 block text-xs font-medium text-neutral-600">Name</span>
                      <input
                        list={`staff-${row._key}`}
                        value={row.employee}
                        onChange={(e) => updateRowField(row._key, 'employee', e.target.value)}
                        placeholder={row._rawEmployee || 'MA wählen'}
                        className="w-full min-w-0 rounded border border-neutral-300 bg-white px-2 py-2 text-neutral-900 [color-scheme:light]"
                      />
                      <datalist id={`staff-${row._key}`}>
                        {(staffConfig[business]?.[row.department] || []).map((emp) => (
                          <option key={emp} value={emp} />
                        ))}
                      </datalist>
                    </label>

                    <label className="min-w-0">
                      <span className="mb-1 block text-xs font-medium text-neutral-600">Datum</span>
                      <input
                        type="date"
                        value={row.date}
                        onChange={(e) => updateRowField(row._key, 'date', e.target.value)}
                        className="w-full min-w-0 rounded border border-neutral-300 bg-white px-2 py-2 text-neutral-900 [color-scheme:light]"
                      />
                    </label>

                    <label className="min-w-0">
                      <span className="mb-1 block text-xs font-medium text-neutral-600">Von (24 Std.)</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        value={row.startTime}
                        onChange={(e) => updateRowField(row._key, 'startTime', e.target.value)}
                        onBlur={() => normalizeRowTime(row._key, 'startTime')}
                        className="w-full min-w-0 rounded border border-neutral-300 bg-white px-2 py-2 text-center text-neutral-900 [color-scheme:light]"
                        placeholder="HH:MM"
                      />
                    </label>

                    <label className="min-w-0">
                      <span className="mb-1 block text-xs font-medium text-neutral-600">Bis (24 Std.)</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        value={row.endTime}
                        onChange={(e) => updateRowField(row._key, 'endTime', e.target.value)}
                        onBlur={() => normalizeRowTime(row._key, 'endTime')}
                        className="w-full min-w-0 rounded border border-neutral-300 bg-white px-2 py-2 text-center text-neutral-900 [color-scheme:light]"
                        placeholder="HH:MM"
                      />
                    </label>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer buttons */}
      <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row">
        <button
          onClick={saveSelected}
          disabled={selectedRows.size === 0}
          className="flex-1 bg-green-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-green-700 disabled:bg-neutral-300 transition"
        >
          <Check className="w-5 h-5 inline mr-2" />
          {selectedRows.size} Schichten · {formattedSelectedDuration} Std. speichern
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
