import React from 'react';
import { useOutletContext, useNavigate } from 'react-router';
import BusinessStep from '@/components/worktime/BusinessStep';

export default function BusinessPage() {
  const navigate = useNavigate();
  const { selectBusiness, openHinweiseEmployeePage, openScanShifts } = useOutletContext();

  return (
    <BusinessStep
      onSelectBusiness={selectBusiness}
      onOpenHinweise={openHinweiseEmployeePage}
      onOpenReports={() => navigate('/reports')}
      onOpenScanShifts={openScanShifts}
    />
  );
}
