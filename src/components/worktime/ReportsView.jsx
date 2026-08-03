import React, { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft,
  CalendarPlus,
  CheckCircle2,
  CircleAlert,
  Database,
  ExternalLink,
  FileSpreadsheet,
  RefreshCw
} from 'lucide-react';
import { base44 } from '@/api/base44Client';
import AnalyticsReport from '@/components/worktime/AnalyticsReport';

function nextMonthValue() {
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(value) {
  if (!/^\d{4}-\d{2}$/.test(value)) return value;
  return new Intl.DateTimeFormat('de-DE', {
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Berlin'
  }).format(new Date(`${value}-01T12:00:00Z`));
}

function suggestedFileName(value) {
  return `Arbeitszeiten – ${monthLabel(value)}`;
}

function StatusRow({ ok, label, detail }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-3">
      {ok ? (
        <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-emerald-600" />
      ) : (
        <CircleAlert size={20} className="mt-0.5 shrink-0 text-amber-600" />
      )}
      <div className="min-w-0">
        <p className="font-semibold text-neutral-800">{label}</p>
        {detail && <p className="mt-0.5 break-words text-xs text-neutral-500">{detail}</p>}
      </div>
    </div>
  );
}

export default function ReportsView({ onBack }) {
  const [link, setLink] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [monthlyReports, setMonthlyReports] = useState([]);
  const [monthlyCreating, setMonthlyCreating] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(nextMonthValue);
  const [monthlyFileName, setMonthlyFileName] = useState(() =>
    suggestedFileName(nextMonthValue())
  );
  const [createdMonthlyReport, setCreatedMonthlyReport] = useState(null);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [linkResult, statusResult, monthlyResult] = await Promise.all([
        base44.functions.invoke('getDriveFileLink', {}),
        base44.functions.invoke('getSetupStatus', {}),
        base44.functions.invoke('listMonthlyReports', {})
      ]);
      setLink(linkResult.data.webViewLink);
      setStatus(statusResult.data);
      setMonthlyReports(Array.isArray(monthlyResult.data) ? monthlyResult.data : []);
    } catch {
      setLink(null);
      setStatus(null);
      setMonthlyReports([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function refreshNow() {
    setRefreshing(true);
    setMessage('');
    try {
      await base44.functions.invoke('exportToGoogleDrive', {});
      setMessage('Die Datei „Arbeitszeiten – Shiraz & Djadoo“ wurde aktualisiert.');
      await load();
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      setMessage(
        /429|RESOURCE_EXHAUSTED|Quota exceeded/i.test(rawMessage)
          ? 'Google-Limit wurde kurz erreicht. Die Anwendung versucht es automatisch erneut; bitte nicht mehrfach klicken.'
          : `Fehler: ${rawMessage}`
      );
      await load();
    } finally {
      setRefreshing(false);
    }
  }

  function changeSelectedMonth(event) {
    const month = event.target.value;
    setSelectedMonth(month);
    setMonthlyFileName(suggestedFileName(month));
    setCreatedMonthlyReport(null);
    setMessage('');
  }

  async function createMonthFile() {
    setMonthlyCreating(true);
    setCreatedMonthlyReport(null);
    setMessage('');
    try {
      const response = await base44.functions.invoke('createMonthlyReport', {
        month: selectedMonth,
        fileName: monthlyFileName
      });
      setCreatedMonthlyReport(response.data);
      setMessage(
        `Monatsdatei erstellt: ${response.data.shiftCount} Schichten und ` +
        `${response.data.hinweisCount} Hinweise für ${monthLabel(selectedMonth)}.`
      );
      await load();
    } catch (error) {
      setMessage(`Fehler: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setMonthlyCreating(false);
    }
  }

  const tableCount = status?.database?.tables?.length || 0;
  const lastExport = status?.lastExport;

  return (
    <div className="space-y-4">
      <h2 className="flex items-center justify-center gap-2 text-center text-xl font-bold text-neutral-800">
        <FileSpreadsheet size={24} /> Reports
      </h2>

      {loading ? (
        <div className="py-8 text-center text-neutral-500">Verbindungen werden geprüft...</div>
      ) : (
        <div className="space-y-2">
          <StatusRow
            ok={Boolean(status?.database?.connected && tableCount >= 6)}
            label="Cloudflare D1"
            detail={status ? `${tableCount} Tabellen verbunden` : 'Nicht erreichbar'}
          />
          <StatusRow
            ok={Boolean(status?.googleSheet?.spreadsheetId)}
            label="Google Sheet: Arbeitszeiten – Shiraz & Djadoo"
            detail={status?.googleSheet?.spreadsheetId || 'Spreadsheet-ID fehlt'}
          />
          <StatusRow
            ok={Boolean(status?.googleSheet?.serviceAccountConfigured)}
            label="Google-Schreibzugriff"
            detail={status?.googleSheet?.serviceAccountConfigured
              ? 'Service Account ist konfiguriert'
              : 'Service-Account-Secrets fehlen noch'}
          />
          <StatusRow
            ok={Boolean(status?.googleSheet?.monthlyDriveConfigured)}
            label="Monatsdateien in Google Drive"
            detail={status?.googleSheet?.monthlyDriveConfigured
              ? status?.googleSheet?.monthlyDriveFolderConfigured
                ? 'OAuth verbunden · Zielordner konfiguriert'
                : 'OAuth verbunden · Speicherung im Drive-Hauptordner'
              : 'Einmalige Google-OAuth-Verbindung fehlt noch'}
          />
          {lastExport && (
            <StatusRow
              ok={lastExport.status === 'success'}
              label="Letzte Aktualisierung"
              detail={`${lastExport.status} · ${lastExport.finished_at || lastExport.started_at}`}
            />
          )}
        </div>
      )}

      {link ? (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-800 py-4 text-lg font-bold text-white shadow-lg transition hover:bg-blue-700"
        >
          <FileSpreadsheet size={22} />
          Arbeitszeiten öffnen
        </a>
      ) : (
        !loading && <div className="py-5 text-center text-neutral-500">Google Sheet ist noch nicht verbunden.</div>
      )}

      <button
        onClick={refreshNow}
        disabled={refreshing || !status?.googleSheet?.serviceAccountConfigured}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 py-3 font-bold text-white transition hover:bg-emerald-600 disabled:opacity-50"
      >
        <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />
        {refreshing ? 'Wird aktualisiert...' : 'Jetzt aktualisieren'}
      </button>

      <AnalyticsReport />

      <section className="space-y-3 rounded-2xl border border-blue-200 bg-blue-50 p-4">
        <div>
          <h3 className="flex items-center gap-2 font-bold text-blue-950">
            <CalendarPlus size={20} /> Monatsdatei erstellen
          </h3>
          <p className="mt-1 text-xs text-blue-800">
            Erstellt eine neue, private Datei mit demselben Aufbau und nur den Daten des gewählten Monats.
          </p>
        </div>

        <label className="block text-sm font-semibold text-neutral-800">
          Monat
          <input
            type="month"
            value={selectedMonth}
            onChange={changeSelectedMonth}
            className="mt-1 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-base"
          />
        </label>

        <label className="block text-sm font-semibold text-neutral-800">
          Dateiname
          <input
            type="text"
            value={monthlyFileName}
            maxLength={120}
            onChange={(event) => setMonthlyFileName(event.target.value)}
            className="mt-1 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-base"
            placeholder="Arbeitszeiten – August 2026"
          />
        </label>

        <button
          onClick={createMonthFile}
          disabled={
            monthlyCreating ||
            !status?.googleSheet?.monthlyDriveConfigured ||
            !selectedMonth ||
            !monthlyFileName.trim() ||
            monthlyReports.some((report) => report.reportMonth === selectedMonth)
          }
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-800 py-3 font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <CalendarPlus size={18} />
          {monthlyCreating ? 'Datei wird erstellt...' : 'Datei für diesen Monat erstellen'}
        </button>

        {!status?.googleSheet?.monthlyDriveConfigured && (
          <p className="rounded-xl bg-amber-100 px-3 py-2 text-sm text-amber-900">
            Die Funktion ist vorbereitet. Für die Aktivierung muss Google Drive einmalig über OAuth verbunden werden.
          </p>
        )}

        {monthlyReports.some((report) => report.reportMonth === selectedMonth) && (
          <p className="text-sm font-medium text-amber-800">
            Für diesen Monat wurde bereits eine Datei erstellt.
          </p>
        )}

        {createdMonthlyReport?.webViewLink && (
          <a
            href={createdMonthlyReport.webViewLink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded-xl bg-emerald-700 py-3 font-bold text-white"
          >
            <ExternalLink size={18} /> Neue Monatsdatei öffnen
          </a>
        )}
      </section>

      {monthlyReports.length > 0 && (
        <section className="space-y-2 rounded-2xl border border-neutral-200 bg-white p-4">
          <h3 className="font-bold text-neutral-800">Vorhandene Monatsdateien</h3>
          {monthlyReports.map((report) => (
            <a
              key={report.id}
              href={report.webViewLink}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-3 rounded-xl bg-neutral-50 px-3 py-2 text-sm text-blue-800 hover:bg-blue-50"
            >
              <span className="min-w-0 truncate">
                {monthLabel(report.reportMonth)} · {report.fileName}
              </span>
              <ExternalLink size={16} className="shrink-0" />
            </a>
          ))}
        </section>
      )}

      {message && <p className="text-center text-sm text-neutral-600">{message}</p>}

      <p className="flex items-center justify-center gap-1 text-center text-xs text-neutral-500">
        <Database size={13} /> Daten werden sofort in D1 gespeichert; die Datei wird jede Nacht aktualisiert.
      </p>

      <button
        onClick={onBack}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-neutral-200 py-3 font-medium text-neutral-700 transition hover:bg-neutral-300"
      >
        <ArrowLeft size={18} /> Zurück
      </button>
    </div>
  );
}
