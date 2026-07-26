import React from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import BusinessStep from '@/components/worktime/BusinessStep';

export default function BusinessPage() {
  const navigate = useNavigate();
  const { selectBusiness, openHinweiseEmployeePage, staffConfig, todayIso, handleVoiceAddShift, openScanShifts } = useOutletContext();

  return (
    <BusinessStep
      onSelectBusiness={selectBusiness}
      onOpenHinweise={openHinweiseEmployeePage}
      onOpenReports={() => navigate('/reports')}
      onOpenScanShifts={openScanShifts}
      staffConfig={staffConfig}
      todayIso={todayIso}
      onVoiceConfirm={handleVoiceAddShift}
    />
  );
}