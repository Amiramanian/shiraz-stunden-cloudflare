import React, { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, CheckCircle2, CircleAlert, Database, FileSpreadsheet, RefreshCw } from 'lucide-react';
import { base44 } from '@/api/base44Client';

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
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [linkResult, statusResult] = await Promise.all([
        base44.functions.invoke('getDriveFileLink', {}),
        base44.functions.invoke('getSetupStatus', {})
      ]);
      setLink(linkResult.data.webViewLink);
      setStatus(statusResult.data);
    } catch {
      setLink(null);
      setStatus(null);
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
      setMessage('Die Datei „کارکنان“ wurde aktualisiert.');
      await load();
    } catch (error) {
      setMessage(`Fehler: ${error.message}`);
    } finally {
      setRefreshing(false);
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
            label="Google Sheet کارکنان"
            detail={status?.googleSheet?.spreadsheetId || 'Spreadsheet-ID fehlt'}
          />
          <StatusRow
            ok={Boolean(status?.googleSheet?.serviceAccountConfigured)}
            label="Google-Schreibzugriff"
            detail={status?.googleSheet?.serviceAccountConfigured
              ? 'Service Account ist konfiguriert'
              : 'Service-Account-Secrets fehlen noch'}
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
          کارکنان öffnen
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
