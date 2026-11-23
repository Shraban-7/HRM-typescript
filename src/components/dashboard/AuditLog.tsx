'use client';

import React, { useMemo, useState } from 'react';
import {
  ArrowDownUp,
  ChevronDown,
  ChevronRight,
  Lock,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  classifyAuditCategory,
  computeAuditCategoryCounts,
  extractAuditDiffFields,
  filterAuditEntries,
  formatAuditActionLabel,
  formatAuditTimestamp,
  formatResourceLabel,
  getAuditCategoryLabel,
  summarizeAuditChanges,
  type AuditCategory,
  type AuditCategoryFilter,
  type AuditSortOrder,
} from '../../lib/auditLog';
import type { AuditLogEntry } from '../../types/hrm';
import { SegmentedTabs } from '../ui/Primitives';

export interface AuditLogProps {
  entries: AuditLogEntry[];
  loading?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  onInspectFullChain?: () => void;
  title?: string;
  description?: string;
  pageSize?: number;
}

function CategoryLabel({ category }: { category: AuditCategory }) {
  const tone =
    category === 'payroll'
      ? 'text-blue-700 dark:text-blue-400'
      : category === 'employee'
        ? 'text-emerald-700 dark:text-emerald-400'
        : 'text-amber-700 dark:text-amber-400';

  return <span className={`text-xs font-medium whitespace-nowrap ${tone}`}>{getAuditCategoryLabel(category)}</span>;
}

export function AuditLog({
  entries,
  loading = false,
  onRefresh,
  refreshing = false,
  onInspectFullChain,
  title = 'Audit Log',
  description = 'Read-only immutable ledger tracking employee actions, payroll modifications, and system configuration changes.',
  pageSize = 10,
}: AuditLogProps) {
  const [categoryFilter, setCategoryFilter] = useState<AuditCategoryFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<AuditSortOrder>('desc');
  const [expandedRowId, setExpandedRowId] = useState<number | null>(null);
  const [visibleLimit, setVisibleLimit] = useState<number>(pageSize);

  const counts = useMemo(() => computeAuditCategoryCounts(entries), [entries]);

  const filteredEntries = useMemo(
    () =>
      filterAuditEntries(entries, {
        category: categoryFilter,
        query: searchQuery,
        sortOrder,
      }),
    [entries, categoryFilter, searchQuery, sortOrder]
  );

  const visibleEntries = useMemo(
    () => filteredEntries.slice(0, visibleLimit),
    [filteredEntries, visibleLimit]
  );

  const hasActiveFilters = categoryFilter !== 'all' || searchQuery.trim().length > 0;

  function handleResetFilters() {
    setCategoryFilter('all');
    setSearchQuery('');
    setVisibleLimit(pageSize);
  }

  return (
    <section
      aria-label="Audit Log"
      className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden"
    >
      {/* Header Row */}
      <div className="px-5 py-4 border-b border-neutral-200 dark:border-neutral-800 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">{title}</h2>
            <span className="text-neutral-300 dark:text-neutral-700" aria-hidden="true">
              ·
            </span>
            <span className="inline-flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400 whitespace-nowrap">
              <Lock className="w-3 h-3 shrink-0" />
              <span>Read-only</span>
            </span>
          </div>
          <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{description}</p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-200 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span>{refreshing ? 'Refreshing...' : 'Refresh'}</span>
            </button>
          )}
          {onInspectFullChain && (
            <button
              type="button"
              onClick={onInspectFullChain}
              className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer whitespace-nowrap"
            >
              Inspect Hash Chain
            </button>
          )}
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="px-5 py-3 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50/60 dark:bg-neutral-900/40 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <SegmentedTabs<AuditCategoryFilter>
          active={categoryFilter}
          onChange={(next) => {
            setCategoryFilter(next);
            setVisibleLimit(pageSize);
          }}
          tabs={[
            { id: 'all', label: 'All Events', count: counts.all },
            { id: 'employee', label: 'Employee Actions', count: counts.employee },
            { id: 'payroll', label: 'Payroll Modifications', count: counts.payroll },
            { id: 'system', label: 'System Changes', count: counts.system },
          ]}
        />

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 sm:flex-initial sm:w-64">
            <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <label htmlFor="dashboard-audit-search" className="sr-only">
              Search audit log entries
            </label>
            <input
              id="dashboard-audit-search"
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setVisibleLimit(pageSize);
              }}
              placeholder="Search actor, event, or record..."
              className="w-full pl-8 pr-7 py-1.5 text-xs bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-700 rounded-md text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear audit search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'))}
            aria-label={sortOrder === 'desc' ? 'Sort oldest first' : 'Sort newest first'}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-300 bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-700 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors cursor-pointer whitespace-nowrap"
          >
            <ArrowDownUp className="w-3.5 h-3.5 text-neutral-500" />
            <span>{sortOrder === 'desc' ? 'Newest first' : 'Oldest first'}</span>
          </button>
        </div>
      </div>

      {/* Read-Only Table View */}
      {loading ? (
        <div className="p-5 space-y-2.5" aria-busy="true">
          {Array.from({ length: 5 }).map((_, idx) => (
            <div
              key={idx}
              className="h-10 bg-neutral-100 dark:bg-neutral-800/70 rounded animate-pulse"
            />
          ))}
        </div>
      ) : filteredEntries.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            {hasActiveFilters ? 'No audit events match your current filters' : 'No audit activity recorded yet'}
          </p>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400 max-w-md mx-auto">
            {hasActiveFilters
              ? 'Try clearing your search query or switching to All Events to view the full immutable ledger.'
              : 'Employee actions, payroll runs, and system setting updates will automatically appear here.'}
          </p>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleResetFilters}
              className="mt-4 px-3.5 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-200 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-neutral-200 dark:border-neutral-800 text-[11px] font-medium text-neutral-500 dark:text-neutral-400 bg-neutral-50/40 dark:bg-neutral-900/30">
                  <th className="px-5 py-2.5 whitespace-nowrap">Timestamp</th>
                  <th className="px-4 py-2.5 whitespace-nowrap">Category</th>
                  <th className="px-4 py-2.5 whitespace-nowrap">Event &amp; Target</th>
                  <th className="px-4 py-2.5 whitespace-nowrap">Actor</th>
                  <th className="px-4 py-2.5 whitespace-nowrap">Change Summary</th>
                  <th className="px-5 py-2.5 text-right whitespace-nowrap">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800 text-xs">
                {visibleEntries.map((entry) => {
                  const category = classifyAuditCategory(entry.action, entry.resource);
                  const isExpanded = expandedRowId === entry.id;
                  const diffFields = isExpanded
                    ? extractAuditDiffFields(entry.before_data, entry.after_data)
                    : [];
                  const actionLabel = formatAuditActionLabel(entry.action);
                  const resourceLabel = formatResourceLabel(entry.resource, entry.resource_id);
                  const summary = summarizeAuditChanges(entry.before_data, entry.after_data);

                  return (
                    <React.Fragment key={entry.id}>
                      <tr className="hover:bg-neutral-50/80 dark:hover:bg-neutral-800/40 transition-colors">
                        <td className="px-5 py-3 font-mono tabular-nums text-[11px] text-neutral-600 dark:text-neutral-400 whitespace-nowrap">
                          <div>{formatAuditTimestamp(entry.created_at)}</div>
                          <div className="text-[10px] text-neutral-400 dark:text-neutral-500">
                            Entry #{entry.id}
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <CategoryLabel category={category} />
                        </td>
                        <td className="px-4 py-3 min-w-[200px]">
                          <div className="font-medium text-neutral-900 dark:text-neutral-100">
                            {actionLabel}
                          </div>
                          <div className="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">
                            <span>{resourceLabel}</span>
                            <span className="mx-1.5 text-neutral-300 dark:text-neutral-700" aria-hidden="true">
                              ·
                            </span>
                            <span className="font-mono text-[10px]">{entry.action}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-neutral-700 dark:text-neutral-300">
                          <div>{entry.actor_email || 'system'}</div>
                          {entry.ip_address && (
                            <div className="font-mono tabular-nums text-[10px] text-neutral-400 dark:text-neutral-500">
                              {entry.ip_address}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 max-w-xs">
                          <div
                            title={summary}
                            className="text-neutral-600 dark:text-neutral-300 truncate font-mono text-[11px]"
                          >
                            {summary}
                          </div>
                        </td>
                        <td className="px-5 py-3 text-right whitespace-nowrap">
                          <button
                            type="button"
                            aria-expanded={isExpanded}
                            aria-label={`${isExpanded ? 'Hide' : 'Inspect'} details for audit entry #${entry.id}`}
                            onClick={() => setExpandedRowId(isExpanded ? null : entry.id)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-neutral-600 dark:text-neutral-300 hover:text-blue-600 dark:hover:text-blue-400 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
                          >
                            {isExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5" />
                            )}
                            <span>{isExpanded ? 'Hide' : 'Inspect'}</span>
                          </button>
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr className="bg-neutral-50/70 dark:bg-neutral-900/60">
                          <td colSpan={6} className="px-5 py-3.5">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div className="space-y-2 flex-1 min-w-0">
                                <div className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
                                  Recorded Change Details (Immutable Snapshot)
                                </div>
                                {diffFields.length > 0 ? (
                                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1.5 text-xs">
                                    {diffFields.map((item) => (
                                      <div key={item.field} className="min-w-0">
                                        <span className="font-mono text-[11px] text-neutral-500 dark:text-neutral-400">
                                          {item.field}:
                                        </span>{' '}
                                        {item.before !== null && item.after !== null && item.before !== item.after ? (
                                          <span className="font-mono text-[11px] text-neutral-900 dark:text-neutral-100 break-all">
                                            <span className="line-through text-neutral-400 mr-1">
                                              {item.before}
                                            </span>
                                            <span>→ {item.after}</span>
                                          </span>
                                        ) : (
                                          <span className="font-mono text-[11px] text-neutral-900 dark:text-neutral-100 break-all">
                                            {item.after ?? item.before ?? '—'}
                                          </span>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                                    No additional before/after field metadata was recorded for this event.
                                  </p>
                                )}
                              </div>

                              {entry.entry_hash && (
                                <div className="shrink-0 sm:text-right">
                                  <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
                                    SHA-256 Digest
                                  </div>
                                  <div className="mt-0.5 font-mono text-[11px] text-emerald-700 dark:text-emerald-400">
                                    {entry.entry_hash.slice(0, 20)}…
                                  </div>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Read-Only Footer Bar */}
          <div className="px-5 py-3 border-t border-neutral-200 dark:border-neutral-800 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500 dark:text-neutral-400">
            <span className="font-mono tabular-nums">
              Showing {visibleEntries.length} of {filteredEntries.length} matching{' '}
              {filteredEntries.length === 1 ? 'entry' : 'entries'}
            </span>
            {visibleLimit < filteredEntries.length && (
              <button
                type="button"
                onClick={() => setVisibleLimit((prev) => prev + pageSize)}
                className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
              >
                Show more entries ({filteredEntries.length - visibleLimit} remaining)
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
