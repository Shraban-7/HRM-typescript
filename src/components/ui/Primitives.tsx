import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Lock,
  X,
  XCircle,
} from 'lucide-react';

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between pb-5 border-b border-neutral-200 dark:border-neutral-800">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400 max-w-2xl">
            {description}
          </p>
        )}
      </div>
      {action && <div className="flex items-center gap-2.5 shrink-0">{action}</div>}
    </div>
  );
}

export function MetricStrip({
  items,
}: {
  items: Array<{
    label: string;
    value: string;
    detail?: string;
    tone?: 'default' | 'positive' | 'warning' | 'danger';
  }>;
}) {
  const toneClass = (t?: string) => {
    if (t === 'positive') return 'text-emerald-700 dark:text-emerald-400';
    if (t === 'warning') return 'text-amber-700 dark:text-amber-400';
    if (t === 'danger') return 'text-red-700 dark:text-red-400';
    return 'text-neutral-500 dark:text-neutral-400';
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg divide-y sm:divide-y-0 sm:divide-x divide-neutral-200 dark:divide-neutral-800">
      {items.map((item) => (
        <div key={item.label} className="px-5 py-4">
          <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
            {item.label}
          </div>
          <div className="mt-1.5 text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50 font-mono tabular-nums">
            {item.value}
          </div>
          {item.detail && (
            <div className={`mt-1 text-xs ${toneClass(item.tone)}`}>{item.detail}</div>
          )}
        </div>
      ))}
    </div>
  );
}

// Zero-Pill Semantic Status Text (always pairs color with explicit label and crisp small icon)
export function StatusText({ status }: { status: string }) {
  const s = status.toLowerCase();
  const label = status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  if (['active', 'approved', 'finalized', 'completed', 'present', 'hired', 'calibrated', 'elected', 'resolved', 'paid_off', 'open', 'delivered'].includes(s)) {
    const Icon = s === 'finalized' ? Lock : CheckCircle2;
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
        <Icon className="w-3.5 h-3.5 shrink-0" />
        <span>{label}</span>
      </span>
    );
  }

  if (['pending', 'simulated', 'draft', 'in_progress', 'in_clearance', 'late', 'screening', 'interview', 'offer', 'offered', 'submitted', 'scheduled', 'available'].includes(s)) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 whitespace-nowrap">
        <Clock className="w-3.5 h-3.5 shrink-0" />
        <span>{label}</span>
      </span>
    );
  }

  if (['rejected', 'terminated', 'locked', 'revoked', 'blocked', 'high'].includes(s)) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 dark:text-red-400 whitespace-nowrap">
        <XCircle className="w-3.5 h-3.5 shrink-0" />
        <span>{label}</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-600 dark:text-neutral-300 whitespace-nowrap">
      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
      <span>{label}</span>
    </span>
  );
}

export function SegmentedTabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<{ id: T; label: string; count?: number }>;
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div
      role="tablist"
      className="inline-flex items-center gap-1 p-1 bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-x-auto max-w-full"
    >
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              isActive
                ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-50 shadow-xs'
                : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200'
            }`}
          >
            <span>{tab.label}</span>
            {tab.count !== undefined && (
              <span className="ml-1.5 font-mono tabular-nums text-[11px] opacity-70">
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function Avatar({
  src,
  name,
  size = 'md',
}: {
  src?: string | null;
  name: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const [failed, setFailed] = useState(false);
  const dims = size === 'sm' ? 'w-7 h-7 text-[11px]' : size === 'lg' ? 'w-11 h-11 text-sm' : 'w-8 h-8 text-xs';
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

  if (src && !failed) {
    return (
      <img
        src={src}
        alt={name}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={`${dims} rounded-full object-cover border border-neutral-200 dark:border-neutral-700 shrink-0`}
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      className={`${dims} rounded-full bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-200 font-semibold flex items-center justify-center shrink-0`}
    >
      {initials || 'NX'}
    </div>
  );
}

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end no-print">
      <div
        className="fixed inset-0 bg-neutral-950/35 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative z-10 w-full max-w-2xl bg-white dark:bg-[#111827] border-l border-neutral-200 dark:border-neutral-800 h-full flex flex-col shadow-xl"
      >
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-neutral-200 dark:border-neutral-800">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-50 truncate">
              {title}
            </h2>
            {subtitle && (
              <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400 truncate">
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="p-1.5 rounded-md text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </aside>
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 no-print">
      <div
        className="fixed inset-0 bg-neutral-950/40 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative z-10 w-full max-w-lg bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg shadow-xl overflow-hidden"
      >
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-neutral-200 dark:border-neutral-800">
          <div>
            <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-50">{title}</h2>
            {description && (
              <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="p-1 rounded-md text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 max-h-[78vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

export function LoadingBlock({ rows = 5 }: { rows?: number }) {
  return (
    <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-9 bg-neutral-100 dark:bg-neutral-800/70 rounded animate-pulse"
        />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg px-6 py-12 text-center">
      <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{title}</p>
      <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400 max-w-md mx-auto">
        {description}
      </p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
