import React from 'react';
import { useOutletContext } from 'react-router';
import ManagementView from '@/components/worktime/ManagementView';

export default function ManagePage() {
  const { staffConfig, allStaff } = useOutletContext();
  return <ManagementView staffConfig={staffConfig} allStaff={allStaff} />;
}
