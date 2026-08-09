import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarRange,
  Clock3,
  Download,
  FileDown,
  LoaderCircle,
  TrendingUp
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { base44 } from '@/api/base44Client';
import { buildMonthlyWeekdayRows, WEEKDAY_OPTIONS } from '@/lib/monthly-weekday';

function todayInBerlin() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function formatHours(value) {
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: Number(value) % 1 === 0 ? 0 : 1,
    maximumFractionDigits: 2
  }).format(Number(value || 0));
}

function formatDate(value) {
  return new Intl.DateTimeFormat('de-DE', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(`${value}T12:00:00Z`));
}

function shortDate(value) {
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC'
  }).format(new Date(`${value}T12:00:00Z`));
}

function Metric({ icon: Icon, label, value }) {
  return (
    <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-3 text-center">
      <Icon size={18} className="mx-auto text-blue-700" aria-hidden="true" />
      <p className="mt-1 text-xl font-bold text-neutral-900">{value}</p>
      <p className="text-[11px] font-medium text-neutral-500">{label}</p>
    </div>
  );
}

export default function MonthlyWeekdayComparison({ business, department }) {
  const currentDate = useMemo(todayInBerlin, []);
  const currentWeekday = useMemo(
    () => new Date(`${currentDate}T12:00:00Z`).getUTCDay(),
    [currentDate]
  );
  const [month, setMonth] = useState(currentDate.slice(0, 7));
  const [weekday, setWeekday] = useState(currentWeekday);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState('');
  const requestSequence = useRef(0);
  const exportRef = useRef(null);

  useEffect(() => {
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    setLoading(true);
    setError('');

    base44.functions.invoke('getAnalyticsReport', {
      period: 'month',
      anchor: month,
      business,
      department
    }).then((response) => {
      if (requestSequence.current === sequence) setReport(response.data);
    }).catch((loadError) => {
      if (requestSequence.current !== sequence) return;
      setReport(null);
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }).finally(() => {
      if (requestSequence.current === sequence) setLoading(false);
    });
  }, [business, department, month]);

  const rows = useMemo(
    () => buildMonthlyWeekdayRows(report?.byDateDepartment, month, weekday),
    [month, report, weekday]
  );
  const weekdayLabel = WEEKDAY_OPTIONS.find((item) => item.value === weekday)?.label || '';
  const totalHours = rows.reduce((sum, item) => sum + item.hours, 0);
  const totalShifts = rows.reduce((sum, item) => sum + item.shiftCount, 0);
  const averageHours = rows.length ? totalHours / rows.length : 0;
  const filterLabel = `${business === 'all' ? 'Alle Betriebe' : business}${department ? ` · ${department}` : ''}`;
  const chartRows = rows.map((item) => ({ ...item, label: shortDate(item.date) }));

  async function exportComparison(format) {
    if (!exportRef.current || !report) return;
    setExporting(format);
    setError('');

    try {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(exportRef.current, {
        backgroundColor: '#ffffff',
        scale: Math.min(2, window.devicePixelRatio || 1),
        useCORS: true,
        windowWidth: Math.max(820, exportRef.current.scrollWidth),
        onclone: (clonedDocument) => {
          const exportElement = clonedDocument.querySelector('[data-monthly-weekday-export]');
          if (!exportElement) return;
          exportElement.style.width = '800px';
          exportElement.style.maxWidth = 'none';
          exportElement.querySelectorAll('[data-export-scroll]').forEach((element) => {
            element.style.overflow = 'visible';
          });
        }
      });
      const baseName = `arbeitszeiten-${month}-${weekdayLabel.toLowerCase()}`;

      if (format === 'png') {
        const link = document.createElement('a');
        link.download = `${baseName}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
        return;
      }

      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const imageData = canvas.toDataURL('image/png');
      const pageWidth = 190;
      const pageHeight = 277;
      const imageHeight = canvas.height * pageWidth / canvas.width;
      let heightLeft = imageHeight;
      let position = 10;
      pdf.addImage(imageData, 'PNG', 10, position, pageWidth, imageHeight);
      heightLeft -= pageHeight;

      while (heightLeft > 0) {
        position = 10 - (imageHeight - heightLeft);
        pdf.addPage();
        pdf.addImage(imageData, 'PNG', 10, position, pageWidth, imageHeight);
        heightLeft -= pageHeight;
      }
      pdf.save(`${baseName}.pdf`);
    } catch (exportError) {
      setError(`Export fehlgeschlagen: ${exportError instanceof Error ? exportError.message : String(exportError)}`);
    } finally {
      setExporting('');
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border border-blue-200 bg-blue-50 p-4">
      <div>
        <h4 className="flex items-center gap-2 font-bold text-blue-950">
          <CalendarRange size={20} /> Wochentage im Monatsvergleich
        </h4>
        <p className="mt-1 text-xs text-blue-800">
          Zeigt alle gleichen Wochentage eines Monats mit ihren Arbeitsstunden.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-semibold text-neutral-800">
          Monat
          <input
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
            className="mt-1 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-base"
          />
        </label>

        <label className="text-sm font-semibold text-neutral-800">
          Wochentag
          <select
            value={weekday}
            onChange={(event) => setWeekday(Number(event.target.value))}
            className="mt-1 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-base"
          >
            {WEEKDAY_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>
      </div>

      <p className="rounded-lg bg-white/80 px-3 py-2 text-xs text-blue-900">
        Filter aus der Auswertung oben: <span className="font-bold">{filterLabel}</span>
      </p>

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl bg-white py-8 text-neutral-500">
          <LoaderCircle size={20} className="animate-spin" /> Vergleich wird geladen...
        </div>
      ) : report ? (
        <>
        <div
          ref={exportRef}
          data-monthly-weekday-export
          className="space-y-4 rounded-2xl bg-white p-4 shadow-sm"
        >
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">{weekdayLabel}</p>
            <h5 className="mt-1 text-lg font-bold text-neutral-900">{report.range.label}</h5>
            <p className="mt-1 text-xs text-neutral-500">
              {rows.length} {weekdayLabel}-Termine im ausgewählten Monat
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Metric icon={Clock3} label="Stunden gesamt" value={formatHours(totalHours)} />
            <Metric icon={TrendingUp} label="Ø pro Tag" value={formatHours(averageHours)} />
            <Metric icon={CalendarRange} label="Schichten" value={totalShifts} />
          </div>

          <div
            className="h-72 w-full"
            role="img"
            aria-label={`Liniendiagramm der Arbeitsstunden an allen ${weekdayLabel}en des Monats`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartRows} margin={{ top: 12, right: 16, left: -14, bottom: 2 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#dbeafe" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} interval={0} />
                <YAxis tick={{ fontSize: 11 }} width={46} allowDecimals />
                <Tooltip
                  formatter={(value) => [`${formatHours(value)} Std.`, 'Arbeitszeit']}
                  labelFormatter={(label) => `Datum: ${label}`}
                  contentStyle={{ borderRadius: 12, borderColor: '#bfdbfe' }}
                />
                <Line
                  type="monotone"
                  dataKey="hours"
                  name="Stunden"
                  stroke="#1d4ed8"
                  strokeWidth={3}
                  dot={{ r: 5, fill: '#1d4ed8' }}
                  activeDot={{ r: 7 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div data-export-scroll className="overflow-x-auto rounded-xl border border-neutral-200">
            <table className="w-full min-w-[520px] border-collapse text-left text-xs">
              <thead className="bg-neutral-100">
                <tr className="border-b border-neutral-300 text-neutral-600">
                  <th className="px-3 py-2">Nr.</th>
                  <th className="px-3 py-2">Datum</th>
                  <th className="px-3 py-2">Wochentag</th>
                  <th className="px-3 py-2 text-right">Schichten</th>
                  <th className="px-3 py-2 text-right">Stunden</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => (
                  <tr key={item.date} className="border-b border-neutral-100 last:border-0">
                    <td className="px-3 py-2 text-neutral-500">{item.occurrence}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-semibold text-neutral-800">
                      {formatDate(item.date)}
                    </td>
                    <td className="px-3 py-2 text-neutral-600">{weekdayLabel}</td>
                    <td className="px-3 py-2 text-right text-neutral-700">{item.shiftCount}</td>
                    <td className="px-3 py-2 text-right font-bold text-neutral-900">
                      {formatHours(item.hours)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-neutral-300 bg-neutral-100">
                <tr>
                  <td colSpan={4} className="px-3 py-2 font-bold text-neutral-800">Gesamt</td>
                  <td className="px-3 py-2 text-right font-bold text-neutral-900">
                    {formatHours(totalHours)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => exportComparison('png')}
            disabled={Boolean(exporting)}
            className="flex items-center justify-center gap-2 rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60"
          >
            {exporting === 'png' ? <LoaderCircle size={17} className="animate-spin" /> : <Download size={17} />}
            PNG herunterladen
          </button>
          <button
            type="button"
            onClick={() => exportComparison('pdf')}
            disabled={Boolean(exporting)}
            className="flex items-center justify-center gap-2 rounded-xl bg-neutral-800 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60"
          >
            {exporting === 'pdf' ? <LoaderCircle size={17} className="animate-spin" /> : <FileDown size={17} />}
            PDF herunterladen
          </button>
        </div>
        </>
      ) : null}

      {error && <p className="rounded-xl bg-red-100 px-3 py-2 text-sm text-red-800">Fehler: {error}</p>}
    </section>
  );
}
