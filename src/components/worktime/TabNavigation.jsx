import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Clock, BarChart3, Database } from 'lucide-react';

export default function TabNavigation() {
  const location = useLocation();
  const navigate = useNavigate();

  const tabs = [
    { key: 'shift', label: 'Schicht erfassen', icon: Clock, active: location.pathname === '/', onClick: () => navigate('/') },
    { key: 'reports', label: 'Reports', icon: BarChart3, active: location.pathname === '/reports', onClick: () => navigate('/reports') },
    { key: 'manage', label: 'Verwalten', icon: Database, active: location.pathname === '/manage', onClick: () => navigate('/manage') }
  ];

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-40 bg-white/70 backdrop-blur-lg border-t border-neutral-200"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="max-w-2xl mx-auto flex items-stretch justify-around">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={tab.onClick}
              className={`flex-1 flex flex-col items-center justify-center gap-1 py-2.5 transition ${
                tab.active ? 'text-emerald-800' : 'text-neutral-400'
              }`}
            >
              <Icon size={22} />
              <span className="text-[11px] font-medium">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
