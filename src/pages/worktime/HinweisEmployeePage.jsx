import React from 'react';
import { useOutletContext } from 'react-router';
import HinweisEmployeeStep from '@/components/worktime/HinweisEmployeeStep';

export default function HinweisEmployeePage() {
  const { allStaff, selectHinweisEmployee, goToMain } = useOutletContext();

  return (
    <HinweisEmployeeStep
      allStaff={allStaff}
      onSelectEmployee={selectHinweisEmployee}
      onBack={goToMain}
    />
  );
}
