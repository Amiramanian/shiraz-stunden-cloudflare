import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileText,
  Loader2,
  Pencil,
  RefreshCw,
  Search,
  Trash2
} from 'lucide-react';
import { base44 } from '@/api/base44Client';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';

const PAGE_SIZE = 20;
const BUSINESSES = ['Shiraz', 'Djadoo'];
const fieldClass = 'w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 text-neutral-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100';

function formatDate(value) {
  if (!value) return '';
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
}

function durationHours(startTime, endTime) {
  if (!startTime || !endTime) return null;
  const [startHour, startMinute] = startTime.split(':').map(Number);
  const [endHour, endMinute] = endTime.split(':').map(Number);
  const start = startHour * 60 + startMinute;
  let end = endHour * 60 + endMinute;
  if (end < start) end += 24 * 60;
  const duration = (end - start) / 60;
  return duration > 0 && duration <= 24 ? Math.round(duration * 100) / 100 : null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export default function ManagementView({ staffConfig, allStaff }) {
  const [tab, setTab] = useState('shifts');
  const [shifts, setShifts] = useState([]);
  const [hinweise, setHinweise] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [shiftRows, hinweisRows] = await Promise.all([
        base44.entities.Shift.list(),
        base44.entities.Hinweis.list()
      ]);
      setShifts((shiftRows || []).sort((a, b) =>
        `${b.date} ${b.startTime}`.localeCompare(`${a.date} ${a.startTime}`)
      ));
      setHinweise((hinweisRows || []).sort((a, b) => b.date.localeCompare(a.date)));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [tab, search]);

  const records = tab === 'shifts' ? shifts : hinweise;
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('de-DE');
    if (!query) return records;
    return records.filter((record) => {
      const searchableValues = [...Object.values(record), formatDate(record.date)];
      return searchableValues.some((value) =>
        String(value ?? '').toLocaleLowerCase('de-DE').includes(query)
      );
    });
  }, [records, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function beginEdit(record) {
    setMessage('');
    setError('');
    setEditing({ type: tab === 'shifts' ? 'shift' : 'hinweis', values: { ...record } });
  }

  function updateEdit(field, value) {
    setEditing((current) => ({
      ...current,
      values: { ...current.values, [field]: value }
    }));
  }

  async function saveEdit(event) {
    event.preventDefault();
    if (!editing) return;
    setBusy(true);
    setMessage('');
    setError('');

    try {
      const entity = editing.type === 'shift'
        ? base44.entities.Shift
        : base44.entities.Hinweis;
      const result = await entity.update(editing.values.id, editing.values);
      setEditing(null);
      await load();
      setMessage(
        result.excelSynced === false
          ? `Gespeichert, aber Google Sheet konnte nicht synchronisiert werden: ${result.syncError || 'unbekannter Fehler'}`
          : 'Änderung gespeichert und Google Sheet aktualisiert.'
      );
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setBusy(true);
    setMessage('');
    setError('');

    try {
      const entity = deleteTarget.type === 'shift'
        ? base44.entities.Shift
        : base44.entities.Hinweis;
      const result = await entity.delete(deleteTarget.record.id);
      setDeleteTarget(null);
      await load();
      setMessage(
        result.excelSynced === false
          ? `Sicher gelöscht, aber Google Sheet konnte nicht synchronisiert werden: ${result.syncError || 'unbekannter Fehler'}`
          : 'Eintrag sicher gelöscht und Google Sheet aktualisiert.'
      );
    } catch (deleteError) {
      setDeleteTarget(null);
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      setBusy(false);
    }
  }

  const editingShift = editing?.type === 'shift' ? editing.values : null;
  const departments = editingShift
    ? unique([
        ...Object.keys(staffConfig?.[editingShift.business] || {}),
        editingShift.department
      ])
    : [];
  const employees = editingShift
    ? unique([
        ...(staffConfig?.[editingShift.business]?.[editingShift.department] || []),
        editingShift.employee
      ])
    : [];
  const hinweisEmployees = editing?.type === 'hinweis'
    ? unique([...(allStaff || []), editing.values.employee])
    : [];
  const duration = editingShift
    ? durationHours(editingShift.startTime, editingShift.endTime)
    : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-neutral-900">Daten verwalten</h2>
          <p className="text-xs text-neutral-500">Bearbeiten, sicher löschen und sofort synchronisieren</p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading || busy}
          aria-label="Daten aktualisieren"
          className="rounded-xl border border-neutral-200 p-2.5 text-neutral-600 hover:bg-neutral-100 disabled:opacity-50"
        >
          <RefreshCw size={19} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="grid grid-cols-2 rounded-xl bg-neutral-100 p-1">
        <button
          type="button"
          onClick={() => setTab('shifts')}
          className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
            tab === 'shifts' ? 'bg-white text-emerald-800 shadow-sm' : 'text-neutral-500'
          }`}
        >
          Schichten ({shifts.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('hinweise')}
          className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
            tab === 'hinweise' ? 'bg-white text-emerald-800 shadow-sm' : 'text-neutral-500'
          }`}
        >
          Hinweise ({hinweise.length})
        </button>
      </div>

      <label className="relative block">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={tab === 'shifts' ? 'Name, Datum, Betrieb oder Abteilung suchen' : 'Name, Datum oder Text suchen'}
          className="w-full rounded-xl border border-neutral-300 py-2.5 pl-10 pr-3 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
        />
      </label>

      {message && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {message}
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <AlertTriangle size={17} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-neutral-500">
          <Loader2 size={20} className="animate-spin" /> Daten werden geladen...
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl bg-neutral-50 py-10 text-center text-neutral-500">
          Keine Einträge gefunden.
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((record) => (
            <article key={record.id} className="rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="mt-1 rounded-lg bg-emerald-50 p-2 text-emerald-700">
                  {tab === 'shifts' ? <Clock3 size={18} /> : <FileText size={18} />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold text-neutral-900">{record.employee}</p>
                  {tab === 'shifts' ? (
                    <>
                      <p className="text-sm text-neutral-600">
                        {formatDate(record.date)} · {record.startTime}–{record.endTime} · {record.durationHours} Std.
                      </p>
                      <p className="text-xs text-neutral-400">{record.business} · {record.department}</p>
                    </>
                  ) : (
                    <>
                      <p className="text-xs text-neutral-400">{formatDate(record.date)}</p>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-neutral-700">{record.text}</p>
                    </>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => beginEdit(record)}
                    aria-label="Bearbeiten"
                    className="rounded-lg p-2 text-blue-700 hover:bg-blue-50"
                  >
                    <Pencil size={18} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget({
                      type: tab === 'shifts' ? 'shift' : 'hinweis',
                      record
                    })}
                    aria-label="Sicher löschen"
                    className="rounded-lg p-2 text-red-700 hover:bg-red-50"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {!loading && filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-between rounded-xl bg-neutral-50 px-3 py-2">
          <button
            type="button"
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={currentPage === 1}
            className="rounded-lg p-2 text-neutral-700 hover:bg-neutral-200 disabled:opacity-30"
            aria-label="Vorherige Seite"
          >
            <ChevronLeft size={19} />
          </button>
          <span className="text-sm text-neutral-600">
            Seite {currentPage} von {pageCount} · {filtered.length} Einträge
          </span>
          <button
            type="button"
            onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
            disabled={currentPage === pageCount}
            className="rounded-lg p-2 text-neutral-700 hover:bg-neutral-200 disabled:opacity-30"
            aria-label="Nächste Seite"
          >
            <ChevronRight size={19} />
          </button>
        </div>
      )}

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && !busy && setEditing(null)}>
        <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] overflow-y-auto rounded-2xl bg-white">
          <DialogHeader>
            <DialogTitle>{editing?.type === 'shift' ? 'Schicht bearbeiten' : 'Hinweis bearbeiten'}</DialogTitle>
            <DialogDescription>
              Nach dem Speichern wird das Google Sheet automatisch aktualisiert.
            </DialogDescription>
          </DialogHeader>

          {editing && (
            <form onSubmit={saveEdit} className="space-y-3">
              {editing.type === 'shift' ? (
                <>
                  <label className="block text-sm font-medium text-neutral-700">
                    Betrieb
                    <select
                      value={editing.values.business}
                      onChange={(event) => {
                        const business = event.target.value;
                        const department = Object.keys(staffConfig?.[business] || {})[0] || '';
                        const employee = staffConfig?.[business]?.[department]?.[0] || '';
                        setEditing((current) => ({
                          ...current,
                          values: { ...current.values, business, department, employee }
                        }));
                      }}
                      className={fieldClass}
                    >
                      {BUSINESSES.map((business) => <option key={business}>{business}</option>)}
                    </select>
                  </label>
                  <label className="block text-sm font-medium text-neutral-700">
                    Abteilung
                    <select
                      value={editing.values.department}
                      onChange={(event) => {
                        const department = event.target.value;
                        const employee = staffConfig?.[editing.values.business]?.[department]?.[0] || editing.values.employee;
                        setEditing((current) => ({
                          ...current,
                          values: { ...current.values, department, employee }
                        }));
                      }}
                      className={fieldClass}
                    >
                      {departments.map((department) => <option key={department}>{department}</option>)}
                    </select>
                  </label>
                  <label className="block text-sm font-medium text-neutral-700">
                    Mitarbeiter
                    <select
                      value={editing.values.employee}
                      onChange={(event) => updateEdit('employee', event.target.value)}
                      className={fieldClass}
                    >
                      {employees.map((employee) => <option key={employee}>{employee}</option>)}
                    </select>
                  </label>
                  <label className="block text-sm font-medium text-neutral-700">
                    Datum
                    <input
                      type="date"
                      required
                      value={editing.values.date}
                      onChange={(event) => updateEdit('date', event.target.value)}
                      className={fieldClass}
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block text-sm font-medium text-neutral-700">
                      Von
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="([01][0-9]|2[0-3]):[0-5][0-9]"
                        placeholder="HH:MM"
                        required
                        value={editing.values.startTime}
                        onChange={(event) => updateEdit('startTime', event.target.value)}
                        className={fieldClass}
                      />
                    </label>
                    <label className="block text-sm font-medium text-neutral-700">
                      Bis
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="([01][0-9]|2[0-3]):[0-5][0-9]"
                        placeholder="HH:MM"
                        required
                        value={editing.values.endTime}
                        onChange={(event) => updateEdit('endTime', event.target.value)}
                        className={fieldClass}
                      />
                    </label>
                  </div>
                  <p className={`rounded-xl px-3 py-2 text-sm ${
                    duration ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'
                  }`}>
                    Arbeitszeit: {duration ? `${duration} Stunden` : 'Start- und Endzeit prüfen'}
                  </p>
                </>
              ) : (
                <>
                  <label className="block text-sm font-medium text-neutral-700">
                    Mitarbeiter
                    <select
                      value={editing.values.employee}
                      onChange={(event) => updateEdit('employee', event.target.value)}
                      className={fieldClass}
                    >
                      {hinweisEmployees.map((employee) => <option key={employee}>{employee}</option>)}
                    </select>
                  </label>
                  <label className="block text-sm font-medium text-neutral-700">
                    Datum
                    <input
                      type="date"
                      required
                      value={editing.values.date}
                      onChange={(event) => updateEdit('date', event.target.value)}
                      className={fieldClass}
                    />
                  </label>
                  <label className="block text-sm font-medium text-neutral-700">
                    Hinweis
                    <textarea
                      required
                      rows={5}
                      value={editing.values.text}
                      onChange={(event) => updateEdit('text', event.target.value)}
                      className={fieldClass}
                    />
                  </label>
                </>
              )}

              <DialogFooter className="gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  disabled={busy}
                  className="rounded-xl border border-neutral-300 px-4 py-2.5 font-semibold text-neutral-700"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  disabled={busy || (editing.type === 'shift' && !duration)}
                  className="flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 font-bold text-white disabled:opacity-50"
                >
                  {busy && <Loader2 size={17} className="animate-spin" />}
                  Speichern
                </button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && !busy && setDeleteTarget(null)}>
        <AlertDialogContent className="w-[calc(100%-2rem)] rounded-2xl bg-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Eintrag sicher löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.type === 'shift'
                ? `Die Schicht von ${deleteTarget.record.employee} am ${formatDate(deleteTarget.record.date)} wird ausgeblendet.`
                : `Der Hinweis für ${deleteTarget?.record.employee} am ${formatDate(deleteTarget?.record.date)} wird ausgeblendet.`}
              {' '}Der Datensatz bleibt für die Nachvollziehbarkeit im System erhalten.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={busy}
              className="bg-red-700 text-white hover:bg-red-600"
            >
              {busy ? <Loader2 size={17} className="animate-spin" /> : <Trash2 size={17} />}
              Sicher löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
