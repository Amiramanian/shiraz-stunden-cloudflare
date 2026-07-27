import React, { useRef, useState } from 'react';
import { Mic, Square, Loader2, Check, X, RotateCcw } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { calculateDurationHours, normalizeTimeString } from '@/lib/timeUtils';

const MAX_AUDIO_BYTES = 6_000_000;

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Audioaufnahme konnte nicht gelesen werden.'));
    reader.readAsDataURL(blob);
  });
}

export default function VoiceShiftEntry({ staffConfig, onConfirm }) {
  const [status, setStatus] = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [parsed, setParsed] = useState(null);
  const [duration, setDuration] = useState(null);
  const [transcript, setTranscript] = useState('');
  const [reviewReasons, setReviewReasons] = useState([]);
  const [voiceMeta, setVoiceMeta] = useState(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const mimeTypeRef = useRef('audio/webm');

  async function startRecording() {
    setErrorMsg('');
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setErrorMsg('Dieser Browser unterstützt keine Audioaufnahme.');
      setStatus('error');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac', 'audio/ogg'];
      const supported = candidates.find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = supported
        ? new MediaRecorder(stream, { mimeType: supported })
        : new MediaRecorder(stream);
      mimeTypeRef.current = recorder.mimeType || supported || 'audio/webm';
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        void processRecording();
      };
      recorder.onerror = () => {
        stream.getTracks().forEach((track) => track.stop());
        setErrorMsg('Audioaufnahme ist fehlgeschlagen.');
        setStatus('error');
      };
      mediaRecorderRef.current = recorder;
      recorder.start(500);
      setStatus('recording');
    } catch {
      setErrorMsg('Mikrofon-Zugriff nicht möglich. Bitte Browser-Berechtigung prüfen.');
      setStatus('error');
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current?.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  }

  async function processRecording() {
    setStatus('processing');
    try {
      const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current || 'audio/webm' });
      if (!blob.size) throw new Error('Die Aufnahme ist leer.');
      if (blob.size > MAX_AUDIO_BYTES) {
        throw new Error('Die Aufnahme ist zu lang. Bitte kürzer als etwa eine Minute aufnehmen.');
      }

      const audio = await blobToDataUrl(blob);
      const result = await base44.functions.invoke('voiceShift', { audio });
      const payload = result.data || result;
      const suggestion = payload.suggestion;
      if (!suggestion) throw new Error('Keine Schicht erkannt.');

      let hours = null;
      try {
        hours = calculateDurationHours(suggestion.startTime, suggestion.endTime);
      } catch {
        // The preview remains editable until both times are valid.
      }

      setParsed({
        business: suggestion.business,
        department: suggestion.department,
        employee: suggestion.employee,
        date: suggestion.date,
        startTime: suggestion.startTime,
        endTime: suggestion.endTime
      });
      setDuration(hours);
      setTranscript(payload.transcript || '');
      setReviewReasons(suggestion.reviewReasons || []);
      setVoiceMeta({
        scanId: payload.scanId,
        rawEmployee: suggestion.rawEmployee,
        rawDepartment: suggestion.rawDepartment,
        original: {
          employee: suggestion.employee,
          department: suggestion.department,
          date: suggestion.date,
          startTime: suggestion.startTime,
          endTime: suggestion.endTime
        }
      });
      setStatus('preview');
    } catch (error) {
      setErrorMsg('Konnte die Aufnahme nicht verarbeiten: ' + (error?.message || error));
      setStatus('error');
    }
  }

  function updateField(field, value) {
    setParsed((previous) => {
      const next = { ...previous, [field]: value };
      if (field === 'business') {
        const departments = Object.keys(staffConfig[value] || {});
        next.department = departments[0] || '';
        next.employee = (staffConfig[value]?.[next.department] || [])[0] || '';
      }
      if (field === 'department') {
        next.employee = (staffConfig[next.business]?.[value] || [])[0] || '';
      }
      return next;
    });
    setReviewReasons([]);
  }

  function updateTime(field, value) {
    setParsed((previous) => {
      const next = { ...previous, [field]: value };
      try {
        setDuration(calculateDurationHours(next.startTime, next.endTime));
        setReviewReasons([]);
      } catch {
        setDuration(null);
      }
      return next;
    });
  }

  function normalizeTime(field) {
    setParsed((previous) => {
      if (!previous?.[field]) return previous;
      try {
        const next = { ...previous, [field]: normalizeTimeString(previous[field]) };
        setDuration(calculateDurationHours(next.startTime, next.endTime));
        setReviewReasons([]);
        return next;
      } catch {
        return previous;
      }
    });
  }

  async function handleConfirm() {
    setStatus('processing');
    try {
      const startTime = normalizeTimeString(parsed.startTime);
      const endTime = normalizeTimeString(parsed.endTime);
      const durationHours = calculateDurationHours(startTime, endTime);
      await onConfirm(
        { ...parsed, startTime, endTime, durationHours },
        voiceMeta
      );
      setStatus('success');
      setTimeout(reset, 1500);
    } catch (error) {
      setErrorMsg('Fehler beim Speichern: ' + (error?.message || error));
      setStatus('error');
    }
  }

  function reset() {
    setParsed(null);
    setDuration(null);
    setTranscript('');
    setReviewReasons([]);
    setVoiceMeta(null);
    setErrorMsg('');
    setStatus('idle');
  }

  const businesses = Object.keys(staffConfig || {});
  const departments = parsed ? Object.keys(staffConfig[parsed.business] || {}) : [];
  const employees = parsed ? (staffConfig[parsed.business]?.[parsed.department] || []) : [];

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 space-y-3 text-neutral-900">
      <h3 className="text-sm font-bold text-neutral-700 text-center">Per Sprache erfassen</h3>

      {status === 'idle' && (
        <button
          type="button"
          onClick={startRecording}
          className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-blue-800 text-white font-bold shadow-lg hover:bg-blue-700 active:scale-[0.98] transition"
        >
          <Mic size={22} /> Aufnahme starten
        </button>
      )}

      {status === 'recording' && (
        <button
          type="button"
          onClick={stopRecording}
          className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-red-700 text-white font-bold shadow-lg animate-pulse transition"
        >
          <Square size={20} /> Aufnahme stoppen
        </button>
      )}

      {status === 'processing' && (
        <div className="w-full flex items-center justify-center gap-2 py-4 text-neutral-600 font-semibold">
          <Loader2 size={20} className="animate-spin" /> Wird verarbeitet...
        </div>
      )}

      {status === 'preview' && parsed && (
        <div className="space-y-3">
          {transcript && (
            <div className="rounded-xl bg-blue-50 p-3 text-xs text-blue-950">
              <span className="font-bold">Erkannt: </span>{transcript}
            </div>
          )}
          {reviewReasons.length > 0 && (
            <div className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
              Bitte prüfen: {reviewReasons.join(', ')}
            </div>
          )}

          <div className="bg-neutral-50 rounded-xl p-3 text-sm space-y-2">
            <label className="block text-xs font-semibold text-neutral-600">
              Business
              <select
                value={parsed.business}
                onChange={(event) => updateField('business', event.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-neutral-300 bg-white text-neutral-900"
              >
                {businesses.map((business) => <option key={business}>{business}</option>)}
              </select>
            </label>

            <label className="block text-xs font-semibold text-neutral-600">
              Abteilung
              <select
                value={parsed.department}
                onChange={(event) => updateField('department', event.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-neutral-300 bg-white text-neutral-900"
              >
                {departments.map((department) => <option key={department}>{department}</option>)}
              </select>
            </label>

            <label className="block text-xs font-semibold text-neutral-600">
              Mitarbeiter
              <select
                value={parsed.employee}
                onChange={(event) => updateField('employee', event.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-neutral-300 bg-white text-neutral-900"
              >
                {employees.map((employee) => <option key={employee}>{employee}</option>)}
              </select>
            </label>

            <label className="block text-xs font-semibold text-neutral-600">
              Datum
              <input
                type="date"
                value={parsed.date}
                onChange={(event) => {
                  setParsed((previous) => ({ ...previous, date: event.target.value }));
                  setReviewReasons([]);
                }}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-neutral-300 bg-white text-neutral-900"
              />
            </label>

            <div className="grid grid-cols-2 gap-2">
              {[
                ['startTime', 'Von'],
                ['endTime', 'Bis']
              ].map(([field, label]) => (
                <label key={field} className="block text-xs font-semibold text-neutral-600">
                  {label} (24h)
                  <input
                    type="text"
                    inputMode="numeric"
                    value={parsed[field]}
                    onChange={(event) => updateTime(field, event.target.value)}
                    onBlur={() => normalizeTime(field)}
                    placeholder="17:30"
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-neutral-300 bg-white text-neutral-900 text-center"
                  />
                </label>
              ))}
            </div>

            {duration !== null && (
              <div className="text-center font-bold text-emerald-800 pt-1">
                Summe: {duration.toFixed(2)} Stunden
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={handleConfirm}
              disabled={duration === null || !parsed.date || !parsed.employee || !parsed.department}
              className="flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-800 text-white font-bold hover:bg-emerald-700 disabled:opacity-50 transition"
            >
              <Check size={18} /> Bestätigen
            </button>
            <button
              type="button"
              onClick={reset}
              className="flex items-center justify-center gap-2 py-3 rounded-xl bg-neutral-200 text-neutral-800 font-medium hover:bg-neutral-300 transition"
            >
              <RotateCcw size={18} /> Erneut
            </button>
          </div>
        </div>
      )}

      {status === 'success' && (
        <div className="text-center font-semibold text-green-700 py-2">Gespeichert und synchronisiert.</div>
      )}

      {status === 'error' && (
        <div className="space-y-2">
          <div className="text-center font-semibold text-red-700 text-sm">{errorMsg}</div>
          <button
            type="button"
            onClick={reset}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-neutral-200 text-neutral-800 font-medium hover:bg-neutral-300 transition"
          >
            <X size={18} /> Zurücksetzen
          </button>
        </div>
      )}
    </div>
  );
}
