import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  BriefcaseBusiness,
  CalendarDays,
  Clock3,
  Download,
  FileDown,
  LoaderCircle,
  Users
} from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { base44 } from '@/api/base44Client';

const CHART_COLORS = [
  '#1d4ed8',
  '#059669',
  '#d97706',
  '#7c3aed',
  '#dc2626',
  '#0891b2',
  '#4f46e5',
  '#65a30d',
  '#db2777',
  '#475569'
];

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

function safeFilePart(value) {
  return String(value || '')
    .toLocaleLowerCase('de-DE')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function SummaryCard({ icon: Icon, label, value }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-3 text-center">
      <Icon size={19} className="mx-auto text-blue-700" aria-hidden="true" />
      <p className="mt-1 text-xl font-bold text-neutral-900">{value}</p>
      <p className="text-[11px] font-medium text-neutral-500">{label}</p>
    </div>
  );
}

export default function AnalyticsReport() {
  const currentDate = useMemo(todayInBerlin, []);
  const [period, setPeriod] = useState('week');
  const [weekAnchor, setWeekAnchor] = useState(currentDate);
  const [monthAnchor, setMonthAnchor] = useState(currentDate.slice(0, 7));
  const [business, setBusiness] = useState('all');
  const [department, setDepartment] = useState('');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState('');
  const exportRef = useRef(null);
  const requestSequence = useRef(0);

  const anchor = period === 'week' ? weekAnchor : monthAnchor;

  useEffect(() => {
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    setLoading(true);
    setError('');

    base44.functions.invoke('getAnalyticsReport', {
      period,
      anchor,
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
  }, [anchor, business, department, period]);

  const departmentOptions = useMemo(() => {
    const available = report?.filters?.availableDepartments || [];
    return [...new Set(
      available
        .filter((item) => business === 'all' || item.business === business)
        .map((item) => item.department)
    )].sort((a, b) => a.localeCompare(b, 'de'));
  }, [business, report]);

  useEffect(() => {
    if (department && !departmentOptions.includes(department)) setDepartment('');
  }, [department, departmentOptions]);

  const departmentChart = useMemo(() => (
    (report?.byDepartment || []).map((item) => ({
      ...item,
      label: business === 'all'
        ? `${item.business} · ${item.department}`
        : item.department
    }))
  ), [business, report]);

  const employeeRows = useMemo(() => {
    const rows = report?.byEmployee || [];
    if (rows.length <= 7) return rows;
    const visible = rows.slice(0, 7);
    const remaining = rows.slice(7);
    visible.push({
      business: '',
      employee: `${remaining.length} weitere`,
      employeeKey: 'remaining',
      departments: [],
      hours: remaining.reduce((sum, item) => sum + item.hours, 0),
      shiftCount: remaining.reduce((sum, item) => sum + item.shiftCount, 0),
      isOther: true
    });
    return visible;
  }, [report]);

  const maxEmployeeHours = Math.max(1, ...employeeRows.map((item) => item.hours));
  const totalHours = report?.summary?.totalHours || 0;

  async function exportReport(format) {
    if (!exportRef.current || !report) return;
    setExporting(format);
    setError('');
    try {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(exportRef.current, {
        backgroundColor: '#ffffff',
        scale: Math.min(2, window.devicePixelRatio || 1),
        useCORS: true
      });
      const baseName = `arbeitszeiten-${period}-${safeFilePart(report.range.startDate)}`;

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
    <section className="space-y-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
      <div>
        <h3 className="flex items-center gap-2 font-bold text-emerald-950">
          <BarChart3 size={20} /> Stunden-Auswertung
        </h3>
        <p className="mt-1 text-xs text-emerald-800">
          Wochen- oder Monatsbericht direkt aus den gespeicherten Schichten.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-xl bg-white p-1 shadow-sm">
        <button
          type="button"
          onClick={() => setPeriod('week')}
          className={`rounded-lg px-3 py-2 text-sm font-bold transition ${
            period === 'week' ? 'bg-emerald-700 text-white' : 'text-neutral-600 hover:bg-neutral-100'
          }`}
        >
          Woche
        </button>
        <button
          type="button"
          onClick={() => setPeriod('month')}
          className={`rounded-lg px-3 py-2 text-sm font-bold transition ${
            period === 'month' ? 'bg-emerald-700 text-white' : 'text-neutral-600 hover:bg-neutral-100'
          }`}
        >
          Monat
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-semibold text-neutral-800">
          {period === 'week' ? 'Datum in der Woche' : 'Monat'}
          <input
            type={period === 'week' ? 'date' : 'month'}
            value={anchor}
            onChange={(event) => (
              period === 'week'
                ? setWeekAnchor(event.target.value)
                : setMonthAnchor(event.target.value)
            )}
            className="mt-1 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-base"
          />
        </label>

        <label className="text-sm font-semibold text-neutral-800">
          Betrieb
          <select
            value={business}
            onChange={(event) => {
              setBusiness(event.target.value);
              setDepartment('');
            }}
            className="mt-1 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-base"
          >
            <option value="all">Alle Betriebe</option>
            <option value="Shiraz">Shiraz</option>
            <option value="Djadoo">Djadoo</option>
          </select>
        </label>

        <label className="text-sm font-semibold text-neutral-800 sm:col-span-2">
          Abteilung
          <select
            value={department}
            onChange={(event) => setDepartment(event.target.value)}
            className="mt-1 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-base"
          >
            <option value="">Alle Abteilungen</option>
            {departmentOptions.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl bg-white py-8 text-neutral-500">
          <LoaderCircle size={20} className="animate-spin" /> Bericht wird geladen...
        </div>
      ) : report ? (
        <>
          <div ref={exportRef} className="space-y-4 rounded-2xl bg-white p-4 shadow-sm">
            <div className="text-center">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                {period === 'week' ? 'Wochenbericht' : 'Monatsbericht'}
              </p>
              <h4 className="mt-1 text-lg font-bold text-neutral-900">{report.range.label}</h4>
              <p className="mt-1 text-xs text-neutral-500">
                {business === 'all' ? 'Alle Betriebe' : business}
                {department ? ` · ${department}` : ''}
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <SummaryCard icon={Clock3} label="Stunden" value={formatHours(totalHours)} />
              <SummaryCard icon={CalendarDays} label="Schichten" value={report.summary.shiftCount} />
              <SummaryCard icon={Users} label="Personen" value={report.summary.employeeCount} />
            </div>

            {departmentChart.length > 0 ? (
              <div>
                <h5 className="text-center text-sm font-bold text-neutral-800">Stunden nach Abteilung</h5>
                <div className="h-64 w-full" role="img" aria-label="Kreisdiagramm der Arbeitsstunden nach Abteilung">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={departmentChart}
                        dataKey="hours"
                        nameKey="label"
                        innerRadius={52}
                        outerRadius={88}
                        paddingAngle={2}
                        stroke="#ffffff"
                        strokeWidth={2}
                      >
                        {departmentChart.map((item, index) => (
                          <Cell key={`${item.business}-${item.department}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value) => [`${formatHours(value)} Std.`, 'Arbeitszeit']}
                        contentStyle={{ borderRadius: 12, borderColor: '#d4d4d4' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <div className="space-y-2">
                  {departmentChart.map((item, index) => (
                    <div key={`${item.business}-${item.department}`} className="flex items-center justify-between gap-3 text-xs">
                      <span className="flex min-w-0 items-center gap-2 text-neutral-700">
                        <span
                          className="h-3 w-3 shrink-0 rounded-full"
                          style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}
                        />
                        <span className="truncate">{item.label}</span>
                      </span>
                      <span className="shrink-0 font-bold text-neutral-900">
                        {formatHours(item.hours)} Std. · {totalHours > 0 ? Math.round(item.hours / totalHours * 100) : 0}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="rounded-xl bg-neutral-50 py-8 text-center text-sm text-neutral-500">
                Für diesen Zeitraum wurden keine Schichten gefunden.
              </p>
            )}

            {employeeRows.length > 0 && (
              <div className="space-y-3 border-t border-neutral-200 pt-4">
                <h5 className="flex items-center gap-2 text-sm font-bold text-neutral-800">
                  <Users size={17} /> Stunden nach Mitarbeiter
                </h5>
                {employeeRows.map((item) => (
                  <div key={`${item.business}-${item.employeeKey}`}>
                    <div className="mb-1 flex items-end justify-between gap-3 text-xs">
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-neutral-800">{item.employee}</span>
                        {!item.isOther && (
                          <span className="block truncate text-[10px] text-neutral-400">
                            {item.business} · {item.departments.join(', ')}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 font-bold text-neutral-800">{formatHours(item.hours)} Std.</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
                      <div
                        className="h-full rounded-full bg-blue-700"
                        style={{ width: `${Math.max(2, item.hours / maxEmployeeHours * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {(report.byEmployee || []).length > 0 && (
              <div className="border-t border-neutral-200 pt-4">
                <h5 className="mb-2 flex items-center gap-2 text-sm font-bold text-neutral-800">
                  <BriefcaseBusiness size={17} /> Genaue Liste
                </h5>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-neutral-300 text-neutral-500">
                        <th className="px-2 py-2">Mitarbeiter</th>
                        <th className="px-2 py-2">Betrieb</th>
                        <th className="px-2 py-2">Abteilung</th>
                        <th className="px-2 py-2 text-right">Schichten</th>
                        <th className="px-2 py-2 text-right">Stunden</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.byEmployee.map((item) => (
                        <tr key={`${item.business}-${item.employeeKey}`} className="border-b border-neutral-100">
                          <td className="px-2 py-2 font-semibold text-neutral-800">{item.employee}</td>
                          <td className="px-2 py-2 text-neutral-600">{item.business}</td>
                          <td className="px-2 py-2 text-neutral-600">{item.departments.join(', ')}</td>
                          <td className="px-2 py-2 text-right text-neutral-700">{item.shiftCount}</td>
                          <td className="px-2 py-2 text-right font-bold text-neutral-900">{formatHours(item.hours)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => exportReport('png')}
              disabled={Boolean(exporting)}
              className="flex items-center justify-center gap-2 rounded-xl bg-blue-800 px-3 py-3 text-sm font-bold text-white transition hover:bg-blue-700 disabled:opacity-50"
            >
              {exporting === 'png' ? <LoaderCircle size={17} className="animate-spin" /> : <Download size={17} />}
              PNG
            </button>
            <button
              type="button"
              onClick={() => exportReport('pdf')}
              disabled={Boolean(exporting)}
              className="flex items-center justify-center gap-2 rounded-xl bg-neutral-800 px-3 py-3 text-sm font-bold text-white transition hover:bg-neutral-700 disabled:opacity-50"
            >
              {exporting === 'pdf' ? <LoaderCircle size={17} className="animate-spin" /> : <FileDown size={17} />}
              PDF
            </button>
          </div>
        </>
      ) : null}

      {error && <p className="rounded-xl bg-red-100 px-3 py-2 text-sm text-red-800">Fehler: {error}</p>}
    </section>
  );
}
