import React from 'react';

export const Card = ({
  title,
  icon: Icon,
  children,
  action,
}: {
  title: string;
  icon?: any;
  children: React.ReactNode;
  action?: React.ReactNode;
}) => (
  <div className="bg-surf border border-border rounded-2xl shadow-soft overflow-hidden">
    <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-sub/30">
      <div className="flex items-center gap-2">
        {Icon && <Icon size={16} className="text-acc" />}
        <h3 className="text-[13px] font-semibold text-tx uppercase tracking-wider">{title}</h3>
      </div>
      {action && <div>{action}</div>}
    </div>
    <div className="p-6">{children}</div>
  </div>
);

export const MetricCard = ({
  label,
  value,
  sub,
  status,
}: {
  label: string;
  value: string | number;
  sub?: string;
  status?: 'ok' | 'warn' | 'err' | 'info';
}) => (
  <div className="bg-surf border border-border rounded-xl p-5 shadow-soft hover:shadow-md transition-shadow">
    <div className="flex items-center justify-between mb-3">
      <div className="font-mono text-[10px] tracking-[0.1em] uppercase text-tx3 font-semibold">{label}</div>
      {status && (
        <div
          className={`w-2 h-2 rounded-full ${
            status === 'ok' ? 'bg-ok' :
            status === 'warn' ? 'bg-warn' :
            status === 'err' ? 'bg-err' : 'bg-info'
          }`}
        />
      )}
    </div>
    <div className="text-[24px] font-bold tracking-tight text-tx leading-none">{value}</div>
    {sub && <div className="text-[11px] text-tx3 mt-2 font-medium">{sub}</div>}
  </div>
);
