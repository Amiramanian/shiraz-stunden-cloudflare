import React from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import ScanShiftsEntry from '@/components/worktime/ScanShiftsEntry';

export default function ScanShiftsPage() {
  const navigate = useNavigate();
  const { staffConfig, selectedScanBusiness, todayIso, handleScanAddShifts } = useOutletContext();

  if (!selectedScanBusiness || !staffConfig || !staffConfig[selectedScanBusiness]) {
    navigate('/');
    return null;
  }

  const scopedStaffConfig = { [selectedScanBusiness]: staffConfig[selectedScanBusiness] };

  return (
    <ScanShiftsEntry
      business={selectedScanBusiness}
      staffConfig={scopedStaffConfig}
      todayIso={todayIso}
      onConfirmAll={handleScanAddShifts}
      onBack={() => navigate('/')}
    />
  );
}