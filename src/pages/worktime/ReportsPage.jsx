import React from 'react';
import { useOutletContext } from 'react-router-dom';
import ReportsView from '@/components/worktime/ReportsView';

export default function ReportsPage() {
  const { goToMain } = useOutletContext();
  return <ReportsView onBack={goToMain} />;
}