import React, { useRef, useState } from 'react';
import { Mic, Square, Loader2, Check, X, RotateCcw } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { calculateDurationHours, normalizeTimeString } from '@/lib/timeUtils';
import { buildStaffDirectoryText, resolveShiftMatch } from '@/lib/shiftMatching';

export default function VoiceShiftEntry({ staffConfig, todayIso, onConfirm }) {
  const [status, setStatus] = useState('idle'); // idle | recording | processing | preview | error | success
  const [errorMsg, setErrorMsg] = useState('');
  const [parsed, setParsed] = useState(null);
  const [duration, setDuration] = useState(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const mimeTypeRef = useRef('audio/webm');

  async function startRecording() {
    setErrorMsg('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // iOS Safari doesn't support audio/webm — pick whatever the browser actually supports,
      // otherwise recording silently produces an unusable file and transcription fails.
      const candidates = ['audio/webm', 'audio/mp4', 'audio/aac', 'audio/ogg'];
      const supported = candidates.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t));
      mimeTypeRef.current = supported || '';
      const recorder = supported ? new MediaRecorder(stream, { mimeType: supported }) : new MediaRecorder(stream);
      mimeTypeRef.current = recorder.mimeType || supported || 'audio/webm';
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        processRecording();
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setStatus('recording');
    } catch (e) {
      setErrorMsg('Mikrofon-Zugriff nicht möglich.');
      setStatus('error');
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  }

  async function processRecording() {
    setStatus('processing');
    try {
      const mimeType = mimeTypeRef.current || 'audio/webm';
      const extension = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : mimeType.includes('aac') ? 'aac' : 'webm';
      const blob = new Blob(chunksRef.current, { type: mimeType });
      const file = new File([blob], `voice.${extension}`, { type: mimeType });
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      const transcript = await base44.integrations.Core.TranscribeAudio({ audio_url: file_url });

      const directory = buildStaffDirectoryText(staffConfig);
      const result = await base44.integrations.Core.InvokeLLM({
        model: 'claude_opus_4_8',
        prompt: `Extract a work shift entry from this voice transcript. The speaker may talk in German, Persian (Farsi) or English, and may mix languages, use informal speech, nicknames or mispronounce names.

Transcript: "${transcript}"

Today's date is ${todayIso} (YYYY-MM-DD, format: year-month-day). Day of week can be derived from this if needed.

Valid business/department/employee combinations (the ONLY valid values):
${directory}

Rules:
- business must be exactly "Shiraz" or "Djadoo" — infer it from the department/employee mentioned if not said explicitly.
- department must be one of the valid departments listed for that business.
- employee must be matched to the closest existing name from the list above — correct for accents, mispronunciation, nicknames, or partial names (e.g. only first name said). Never invent a name that isn't in the list.
- date: resolve to ISO format YYYY-MM-DD.
  - Relative words: "heute"/"امروز"/"today" -> ${todayIso}. "gestern"/"دیروز"/"yesterday" -> one day before. "morgen"/"فردا"/"tomorrow" -> one day after.
  - Weekday names (e.g. "Montag", "دوشنبه", "Monday") -> the most recent occurrence of that weekday on or before today, unless context implies future.
  - If only day.month is given (e.g. "7.7", "7 Juli"), use the current year from today's date.
  - If nothing about the date is said at all, default to ${todayIso}.
- startTime and endTime: resolve to 24h format "HH:MM".
  - Numbers like "1100" -> "11:00", "9" -> "09:00", "930" -> "09:30".
  - "halb elf" / "half past ten" -> "10:30". "viertel nach neun" -> "09:15". "viertel vor zehn" -> "09:45".
  - Phrases like "von 9 bis 17", "9 bis 17 Uhr", "bis 1200" define start and end times together.
  - Evening/afternoon hints ("abends", "nachmittags", "شب", "بعد از ظهر", "pm") push an ambiguous hour (1-7) into 24h afternoon/evening (e.g. "7 abends" -> "19:00"). Morning hints ("morgens", "صبح", "am") keep it as-is.
  - If endTime is earlier than startTime and there is no clear indication of an overnight shift, assume the times were meant in a way that endTime is after startTime (e.g. correct obvious speech-recognition slips).
- If the transcript is unclear, incomplete, or does not contain enough information to fill all required fields with reasonable confidence, do not guess wildly — pick the closest reasonable match, since the user will review and correct the result before saving.
- Read spoken numbers digit by digit carefully (e.g. "elf bis neunzehn" -> "11:00" to "19:00"); ignore filler words ("äh", "also", "یعنی") and don't let them shift the numbers.`,
        response_json_schema: {
          type: 'object',
          properties: {
            business: { type: 'string' },
            department: { type: 'string' },
            employee: { type: 'string' },
            date: { type: 'string' },
            startTime: { type: 'string' },
            endTime: { type: 'string' }
          },
          required: ['business', 'department', 'employee', 'date', 'startTime', 'endTime']
        }
      });

      // Don't let an odd/unparseable time from the LLM block the whole flow —
      // fall back to the raw value so the user can just fix it in the preview form.
      let normStart = result.startTime;
      let normEnd = result.endTime;
      let hours = null;
      try {
        normStart = normalizeTimeString(result.startTime);
        normEnd = normalizeTimeString(result.endTime);
        hours = calculateDurationHours(normStart, normEnd);
      } catch {
        // keep raw values, duration stays null until user corrects them
      }
      const match = resolveShiftMatch(result, staffConfig);

      setParsed({ ...result, business: match.business, department: match.department, employee: match.employee, startTime: normStart, endTime: normEnd });
      setDuration(hours);
      setStatus('preview');
    } catch (e) {
      setErrorMsg('Konnte die Aufnahme nicht verarbeiten: ' + e.message);
      setStatus('error');
    }
  }

  function updateField(field, value) {
    setParsed((prev) => {
      const next = { ...prev, [field]: value };
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
    });
  }

  function updateTime(field, value) {
    setParsed((prev) => {
      const next = { ...prev, [field]: value };
      try {
        const hours = calculateDurationHours(next.startTime, next.endTime);
        setDuration(hours);
      } catch {
        setDuration(null);
      }
      return next;
    });
  }

  function handleTimeBlur(field) {
    setParsed((prev) => {
      if (!prev[field]) return prev;
      try {
        const normalized = normalizeTimeString(prev[field]);
        const next = { ...prev, [field]: normalized };
        try {
          setDuration(calculateDurationHours(next.startTime, next.endTime));
        } catch {
          setDuration(null);
        }
        return next;
      } catch {
        return prev;
      }
    });
  }

  async function handleConfirm() {
    setStatus('processing');
    try {
      const normStart = normalizeTimeString(parsed.startTime);
      const normEnd = normalizeTimeString(parsed.endTime);
      const hours = calculateDurationHours(normStart, normEnd);
      await onConfirm({ ...parsed, startTime: normStart, endTime: normEnd, durationHours: hours });
      setStatus('success');
      setTimeout(() => reset(), 1500);
    } catch (e) {
      setErrorMsg('Fehler beim Speichern: ' + e.message);
      setStatus('error');
    }
  }

  function reset() {
    setParsed(null);
    setDuration(null);
    setErrorMsg('');
    setStatus('idle');
  }

  const businesses = Object.keys(staffConfig || {});
  const departments = parsed ? Object.keys(staffConfig[parsed.business] || {}) : [];
  const employees = parsed ? ((staffConfig[parsed.business] || {})[parsed.department] || []) : [];

  return (
    <div className="rounded-2xl border border-neutral-200 p-4 space-y-3">
      <h3 className="text-sm font-bold text-neutral-700 text-center">Per Sprache erfassen</h3>

      {status === 'idle' && (
        <button
          onClick={startRecording}
          className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-blue-800 text-white font-bold shadow-lg hover:bg-blue-700 active:scale-[0.98] transition"
        >
          <Mic size={22} /> Aufnahme starten
        </button>
      )}

      {status === 'recording' && (
        <button
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
          <p className="text-xs text-neutral-500 text-center">Bitte prüfen und bei Bedarf korrigieren:</p>
          <div className="bg-neutral-50 rounded-xl p-3 text-sm space-y-2">
            <div>
              <label className="block text-xs font-semibold text-neutral-500 mb-1">Business</label>
              <select
                value={parsed.business}
                onChange={(e) => updateField('business', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-neutral-200 bg-white text-neutral-900"
              >
                {businesses.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-neutral-500 mb-1">Abteilung</label>
              <select
                value={parsed.department}
                onChange={(e) => updateField('department', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-neutral-200 bg-white text-neutral-900"
              >
                {departments.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-neutral-500 mb-1">Mitarbeiter</label>
              <select
                value={parsed.employee}
                onChange={(e) => updateField('employee', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-neutral-200 bg-white text-neutral-900"
              >
                {employees.map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-neutral-500 mb-1">Datum</label>
              <input
                type="date"
                value={parsed.date}
                onChange={(e) => setParsed((p) => ({ ...p, date: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-neutral-200 bg-white text-neutral-900"
              />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-xs font-semibold text-neutral-500 mb-1">In</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={parsed.startTime}
                  onChange={(e) => updateTime('startTime', e.target.value)}
                  onBlur={() => handleTimeBlur('startTime')}
                  className="w-full px-3 py-2 rounded-lg border border-neutral-200 bg-white text-neutral-900 text-center"
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs font-semibold text-neutral-500 mb-1">Out</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={parsed.endTime}
                  onChange={(e) => updateTime('endTime', e.target.value)}
                  onBlur={() => handleTimeBlur('endTime')}
                  className="w-full px-3 py-2 rounded-lg border border-neutral-200 bg-white text-neutral-900 text-center"
                />
              </div>
            </div>
            {duration !== null && (
              <div className="text-center font-bold text-emerald-700 pt-1">
                Sum: {duration.toFixed(2)} Stunden
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleConfirm}
              disabled={duration === null}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-800 text-white font-bold hover:bg-emerald-700 disabled:opacity-60 transition"
            >
              <Check size={18} /> Bestätigen
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
        <div className="text-center font-semibold text-green-600 py-2">Gespeichert ✅</div>
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