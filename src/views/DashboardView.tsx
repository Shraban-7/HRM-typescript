import React, { useEffect, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowRight, Check, Clock, Play, ShieldCheck, X } from 'lucide-react';
import { apiRequest, formatCurrency, formatCurrencyWhole, hasPerm } from '../lib/api';
import type { AuthUser, NavSection } from '../types/hrm';
import { LoadingBlock, MetricStrip, PageHeader, StatusText } from '../components/ui/Primitives';

interface DashboardData {
  kpis: {
    totalEmployees: number;
    attendanceRate: number;
    todayPresent: number;
    pendingApprovalsCount: number;
    pendingLeaves: number;
    pendingExpenses: number;
    openJobs: number;
    mfaAdoptionPct: number;
    unreadNotifications: number;
  };
  latestFinalizedPayroll: {
    id: number;
    run_code: string;
    total_gross: number;
    total_net: number;
    total_taxes: number;
    pay_date: string;
  } | null;
  draftPayroll: {
    id: number;
    run_code: string;
    status: string;
    period_start: string;
    period_end: string;
  } | null;
  branchBreakdown: Array<{
    id: number;
    code: string;
    name: string;
    city: string;
    state_tax_rate: number;
    headcount: number;
    annual_payroll: number;
  }>;
  payrollTrend: Array<{ month: string; gross: number; net: number; employerTax: number }>;
  pendingApprovals: Array<{
    id: number;
    kind: 'leave' | 'expense';
    employee_name: string;
    branch_name: string;
    summary: string;
    ref_date: string;
    approval_chain_json: string;
    current_step: number;
  }>;
  recentAudit: Array<{
    id: number;
    actor_email: string;
    action: string;
    resource: string;
    resource_id: string | null;
    created_at: string;
  }>;
  selfService: {
    todayAttendance: { clock_in: string; clock_out: string | null; worked_hours: number; status: string } | null;
    annualLeaveRemaining: number;
    sickLeaveRemaining: number;
    latestPayslip: { run_code: string; net_pay: number; gross_pay: number; total_taxes: number } | null;
    goals: Array<{ id: number; title: string; progress: number; status: string }>;
    unacknowledgedPolicies: number;
  } | null;
}

export function DashboardView({
  user,
  selectedBranchId,
  onNavigate,
  onToast,
}: {
  user: AuthUser;
  selectedBranchId: number | null;
  onNavigate: (section: NavSection) => void;
  onToast: (msg: string) => void;
}) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const isExecutive =
    user.roles.includes('super_admin') ||
    user.roles.includes('hr_admin') ||
    user.roles.includes('manager');

  async function fetchDashboard() {
    setLoading(true);
    try {
      const qs = selectedBranchId ? `?branchId=${selectedBranchId}` : '';
      const res = await apiRequest<DashboardData>(`/api/dashboard${qs}`);
      setData(res);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchDashboard();
  }, [selectedBranchId, user.id]);

  async function handleClockAction(action: 'clock-in' | 'clock-out') {
    setBusyKey(action);
    try {
      await apiRequest(`/api/attendance/${action}`, { method: 'POST' });
      onToast(action === 'clock-in' ? 'Clocked in successfully.' : 'Clocked out — worked hours recorded.');
      await fetchDashboard();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setBusyKey(null);
    }
  }

  async function handleDecision(kind: 'leave' | 'expense', id: number, decision: 'approve' | 'reject') {
    setBusyKey(`${kind}-${id}`);
    try {
      const url = kind === 'leave' ? `/api/leaves/${id}/decision` : `/api/expenses/${id}/decision`;
      await apiRequest(url, { method: 'POST', body: { decision } });
      onToast(`${kind === 'leave' ? 'Leave request' : 'Expense claim'} ${decision === 'approve' ? 'approved' : 'rejected'}.`);
      await fetchDashboard();
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setBusyKey(null);
    }
  }

  if (loading || !data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Workspace Overview" description="Loading multi-branch workforce and payroll telemetry..." />
        <LoadingBlock rows={6} />
      </div>
    );
  }

  const canApproveLeave = hasPerm(user.permissions, user.roles, 'leave.approve');
  const canManageOps = hasPerm(user.permissions, user.roles, 'ops.manage');

  return (
    <div className="space-y-6">
      <PageHeader
        title={isExecutive ? 'Executive People & Payroll Overview' : `Welcome back, ${user.fullName.split(' ')[0]}`}
        description={
          isExecutive
            ? 'Live multi-branch headcount, statutory payroll governance, workflow approvals, and security posture.'
            : 'Your daily attendance clock, leave accruals, latest itemized payslip, and active OKRs.'
        }
        action={
          isExecutive && data.draftPayroll ? (
            <button
              type="button"
              onClick={() => onNavigate('payroll')}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors whitespace-nowrap cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Run {data.draftPayroll.run_code} Payroll</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onNavigate('attendance')}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors whitespace-nowrap cursor-pointer"
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Request Time Off</span>
            </button>
          )
        }
      />

      {/* Top 4-Metric Strip */}
      {isExecutive ? (
        <MetricStrip
          items={[
            {
              label: 'Active Workforce',
              value: String(data.kpis.totalEmployees),
              detail: `${data.kpis.todayPresent} present today (${data.kpis.attendanceRate}%)`,
              tone: 'positive',
            },
            {
              label: 'Last Finalized Net Payroll',
              value: formatCurrencyWhole(data.latestFinalizedPayroll?.total_net ?? 0),
              detail: data.latestFinalizedPayroll
                ? `${data.latestFinalizedPayroll.run_code} · Gross ${formatCurrencyWhole(data.latestFinalizedPayroll.total_gross)}`
                : 'No finalized cycles',
            },
            {
              label: 'Workflow Approvals Queue',
              value: String(data.kpis.pendingApprovalsCount),
              detail: `${data.kpis.pendingLeaves} leave · ${data.kpis.pendingExpenses} expense claims`,
              tone: data.kpis.pendingApprovalsCount > 0 ? 'warning' : 'positive',
            },
            {
              label: 'Open Requisitions & Security',
              value: `${data.kpis.openJobs} roles`,
              detail: `MFA enrolled: ${data.kpis.mfaAdoptionPct}% of accounts`,
              tone: data.kpis.mfaAdoptionPct >= 50 ? 'positive' : 'default',
            },
          ]}
        />
      ) : (
        <MetricStrip
          items={[
            {
              label: 'Annual Leave Balance',
              value: `${data.selfService?.annualLeaveRemaining ?? 20} days`,
              detail: `${data.selfService?.sickLeaveRemaining ?? 14} sick days remaining`,
              tone: 'positive',
            },
            {
              label: 'Latest Net Payslip',
              value: formatCurrency(data.selfService?.latestPayslip?.net_pay ?? 0),
              detail: data.selfService?.latestPayslip
                ? `${data.selfService.latestPayslip.run_code} · Taxes ${formatCurrency(data.selfService.latestPayslip.total_taxes)}`
                : 'No payslip issued yet',
            },
            {
              label: 'Today Attendance',
              value: data.selfService?.todayAttendance
                ? data.selfService.todayAttendance.clock_out
                  ? `${data.selfService.todayAttendance.worked_hours}h`
                  : 'Clocked In'
                : 'Not Clocked In',
              detail: data.selfService?.todayAttendance?.clock_in
                ? `In at ${data.selfService.todayAttendance.clock_in.slice(11, 16)} UTC`
                : 'Click below to start shift',
              tone: data.selfService?.todayAttendance ? 'positive' : 'warning',
            },
            {
              label: 'Policy Compliance',
              value:
                (data.selfService?.unacknowledgedPolicies ?? 0) === 0
                  ? 'All Signed'
                  : `${data.selfService?.unacknowledgedPolicies} Pending`,
              detail: 'Corporate security & hybrid policies',
              tone: (data.selfService?.unacknowledgedPolicies ?? 0) === 0 ? 'positive' : 'warning',
            },
          ]}
        />
      )}

      {/* Employee Self-Service Shift Station (always accessible for logged-in employees) */}
      {data.selfService && (
        <section className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-0.5">
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
              Self-Service Attendance Clock
            </h2>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {!data.selfService.todayAttendance
                ? 'Start your shift to record attendance and automatic overtime calculation.'
                : data.selfService.todayAttendance.clock_out
                  ? `Shift completed (${data.selfService.todayAttendance.worked_hours}h logged today).`
                  : `Currently clocked in since ${data.selfService.todayAttendance.clock_in.slice(11, 16)} UTC.`}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!data.selfService.todayAttendance ? (
              <button
                type="button"
                disabled={busyKey === 'clock-in'}
                onClick={() => handleClockAction('clock-in')}
                className="px-3.5 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer"
              >
                {busyKey === 'clock-in' ? 'Recording...' : 'Clock In'}
              </button>
            ) : !data.selfService.todayAttendance.clock_out ? (
              <button
                type="button"
                disabled={busyKey === 'clock-out'}
                onClick={() => handleClockAction('clock-out')}
                className="px-3.5 py-2 text-xs font-medium text-white bg-neutral-900 dark:bg-neutral-100 dark:text-neutral-900 hover:opacity-90 rounded-md cursor-pointer"
              >
                {busyKey === 'clock-out' ? 'Saving...' : 'Clock Out'}
              </button>
            ) : (
              <StatusText status="completed" />
            )}
            <button
              type="button"
              onClick={() => onNavigate('payroll')}
              className="px-3.5 py-2 text-xs font-medium text-neutral-700 dark:text-neutral-200 border border-neutral-200 dark:border-neutral-700 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer"
            >
              My Payslips
            </button>
          </div>
        </section>
      )}

      {/* Executive Charts & Approval Inbox */}
      {isExecutive && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* 6-Month Payroll Outlay Chart */}
          <section className="lg:col-span-7 bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                  Monthly Gross vs. Net Payroll Trend
                </h2>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  6-month disbursement & statutory employer tax trajectory (USD)
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('analytics')}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
              >
                <span>Full Analytics</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.payrollTrend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#9CA3AF" strokeOpacity={0.22} vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#6B7280' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `$${Math.round(v / 1000)}k`}
                  />
                  <Tooltip
                    formatter={(val) => formatCurrencyWhole(Number(val ?? 0))}
                    contentStyle={{
                      fontSize: 12,
                      borderRadius: 6,
                      backgroundColor: '#111827',
                      border: '1px solid #374151',
                      color: '#F9FAFB',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="gross"
                    name="Gross Pay"
                    stroke="#2563EB"
                    fill="#2563EB"
                    fillOpacity={0.12}
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="net"
                    name="Net Disbursement"
                    stroke="#16A34A"
                    fill="#16A34A"
                    fillOpacity={0.08}
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* Unified Workflow Approval Inbox */}
          <section className="lg:col-span-5 bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg flex flex-col">
            <div className="px-5 py-4 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                  Workflow Approval Inbox
                </h2>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Multi-step leave & expense requests routed by custom rules
                </p>
              </div>
              <span className="font-mono tabular-nums text-xs text-neutral-500">
                {data.pendingApprovals.length} open
              </span>
            </div>

            <div className="flex-1 divide-y divide-neutral-200 dark:divide-neutral-800 overflow-y-auto max-h-[340px]">
              {data.pendingApprovals.length === 0 ? (
                <div className="px-5 py-10 text-center text-xs text-neutral-500">
                  All leave and expense requests are caught up.
                </div>
              ) : (
                data.pendingApprovals.map((item) => {
                  const chain = JSON.parse(item.approval_chain_json) as string[];
                  const canAct = item.kind === 'leave' ? canApproveLeave : canManageOps;
                  const busy = busyKey === `${item.kind}-${item.id}`;
                  return (
                    <div key={`${item.kind}-${item.id}`} className="px-5 py-3.5 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-neutral-900 dark:text-neutral-100 truncate">
                          {item.employee_name}
                          <span className="mx-1.5 text-neutral-300 dark:text-neutral-700 font-normal">·</span>
                          <span className="font-normal text-neutral-500">{item.branch_name}</span>
                        </div>
                        <div className="mt-0.5 text-xs text-neutral-700 dark:text-neutral-300">
                          {item.summary}
                        </div>
                        <div className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                          Chain: {chain.join(' → ')} · Step {item.current_step + 1}/{chain.length}
                        </div>
                      </div>
                      {canAct && (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleDecision(item.kind, item.id, 'approve')}
                            aria-label={`Approve ${item.employee_name} ${item.kind}`}
                            className="p-1.5 rounded-md text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/60 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleDecision(item.kind, item.id, 'reject')}
                            aria-label={`Reject ${item.employee_name} ${item.kind}`}
                            className="p-1.5 rounded-md text-red-700 dark:text-red-400 border border-red-200 dark:border-red-900/60 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </div>
      )}

      {/* Multi-Branch Operations Table & Recent Audit Ledger */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-7 bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                Multi-Branch Footprint
              </h2>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Headcount, regional withholding rate, and annualized payroll run-rate
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('people')}
              className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
            >
              Manage Branches
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-neutral-200 dark:border-neutral-800 text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
                  <th className="px-5 py-2.5">Branch</th>
                  <th className="px-4 py-2.5">Location</th>
                  <th className="px-4 py-2.5 text-right">Headcount</th>
                  <th className="px-4 py-2.5 text-right">State/Local Tax</th>
                  <th className="px-5 py-2.5 text-right">Annualized Comp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800 text-xs">
                {data.branchBreakdown.map((b) => (
                  <tr key={b.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/40">
                    <td className="px-5 py-3 font-medium text-neutral-900 dark:text-neutral-100">
                      {b.name}{' '}
                      <span className="font-mono text-[11px] text-neutral-400 ml-1">{b.code}</span>
                    </td>
                    <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">{b.city}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-neutral-900 dark:text-neutral-100">
                      {b.headcount}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-neutral-600 dark:text-neutral-400">
                      {(b.state_tax_rate * 100).toFixed(1)}%
                    </td>
                    <td className="px-5 py-3 text-right font-mono tabular-nums font-medium text-neutral-900 dark:text-neutral-100">
                      {formatCurrencyWhole(b.annual_payroll)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="lg:col-span-5 bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                Recent Audit Trail
              </h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('security')}
              className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
            >
              Inspect Chain
            </button>
          </div>
          <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {data.recentAudit.slice(0, 6).map((log) => (
              <div key={log.id} className="px-5 py-2.5 flex items-center justify-between gap-3 text-xs">
                <div className="min-w-0">
                  <div className="font-mono text-[11px] font-medium text-neutral-900 dark:text-neutral-100 truncate">
                    {log.action}
                  </div>
                  <div className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate">
                    {log.actor_email ?? 'system'} · {log.resource}
                    {log.resource_id ? ` #${log.resource_id}` : ''}
                  </div>
                </div>
                <span className="font-mono tabular-nums text-[11px] text-neutral-400 shrink-0">
                  {log.created_at.slice(5, 16).replace('T', ' ')}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
