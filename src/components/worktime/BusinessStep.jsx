import React from 'react';
import { ClipboardList, StickyNote, ScanLine } from 'lucide-react';
import VoiceShiftEntry from '@/components/worktime/VoiceShiftEntry';

export default function BusinessStep({ onSelectBusiness, onOpenHinweise, onOpenScanShifts, staffConfig, todayIso, onVoiceConfirm }) {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-center text-neutral-800">Auswahl</h2>
      {staffConfig && (
        <VoiceShiftEntry staffConfig={staffConfig} todayIso={todayIso} onConfirm={onVoiceConfirm} />
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <button
          onClick={() => onSelectBusiness('Shiraz')}
          className="flex flex-col items-center gap-2 py-8 rounded-2xl bg-neutral-900 text-white font-bold text-xl shadow-lg hover:bg-neutral-700 active:scale-[0.98] transition"
        >
          <ClipboardList size={32} />
          Shiraz
        </button>
        <button
          onClick={() => onSelectBusiness('Djadoo')}
          className="flex flex-col items-center gap-2 py-8 rounded-2xl bg-neutral-900 text-white font-bold text-xl shadow-lg hover:bg-neutral-700 active:scale-[0.98] transition"
        >
          <ClipboardList size={32} />
          Djadoo
        </button>
        <button
          onClick={() => onSelectBusiness('Catering')}
          className="flex flex-col items-center gap-2 py-8 rounded-2xl bg-neutral-900 text-white font-bold text-xl shadow-lg hover:bg-neutral-700 active:scale-[0.98] transition sm:col-span-2"
        >
          <ClipboardList size={32} />
          Catering
        </button>
      </div>
      <button
        onClick={onOpenHinweise}
        className="w-full flex items-center justify-center gap-2 py-5 rounded-2xl bg-emerald-800 text-white font-bold text-lg shadow-lg hover:bg-emerald-700 active:scale-[0.98] transition"
      >
        <StickyNote size={24} />
        Hinweise
      </button>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <button
          onClick={() => onOpenScanShifts('Shiraz')}
          className="flex items-center justify-center gap-2 py-5 rounded-2xl bg-indigo-800 text-white font-bold text-lg shadow-lg hover:bg-indigo-700 active:scale-[0.98] transition"
        >
          <ScanLine size={24} />
          Shiraz scannen
        </button>
        <button
          onClick={() => onOpenScanShifts('Djadoo')}
          className="flex items-center justify-center gap-2 py-5 rounded-2xl bg-indigo-800 text-white font-bold text-lg shadow-lg hover:bg-indigo-700 active:scale-[0.98] transition"
        >
          <ScanLine size={24} />
          Djadoo scannen
        </button>
      </div>
    </div>
  );
}