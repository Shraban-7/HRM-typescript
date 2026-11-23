import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Lock,
  Play,
  Plus,
  Printer,
  ShieldCheck,
} from 'lucide-react';
import {
  apiRequest,
  downloadCsv,
  formatCurrency,
  formatCurrencyWhole,
  hasPerm,
} from '../lib/api';
import type { AuthUser, Branch, PayrollRun, Payslip, TaxBracketRow } from '../types/hrm';
import {
  Drawer,
  LoadingBlock,
  MetricStrip,
  Modal,
  PageHeader,
  SegmentedTabs,
  StatusText,
} from '../components/ui/Primitives';

type PayrollTab = 'runs' | 'payslips' | 'tax' | 'benefits';

export function PayrollView({
  user,
  branches,
  selectedBranchId,
  onToast,
}: {
  user: AuthUser;
  branches: Branch[];
  selectedBranchId: number | null;
  onToast: (msg: string) => void;
}) {
  const [tab, setTab] = useState<PayrollTab>(
    hasPerm(user.permissions, user.roles, 'payroll.run') ? 'runs' : 'payslips'
  );
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [taxBrackets, setTaxBrackets] = useState<TaxBracketRow[]>([]);
  const [activeRun, setActiveRun] = useState<PayrollRun | null>(null);
  const [runPayslips, setRunPayslips] = useState<Payslip[]>([]);
  const [allPayslips, setAllPayslips] = useState<Payslip[]>([]);
  const [selectedSlip, setSelectedSlip] = useState<Payslip | null>(null);
  const [benefitsData, setBenefitsData] = useState<{
    plans: Array<Record<string, unknown>>;
    enrollments: Array<Record<string, unknown>>;
    cobra: Array<Record<string, unknown>>;
  }>({ plans: [], enrollments: [], cobra: [] });

  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const [newRunOpen, setNewRunOpen] = useState(false);
  const [newRunForm, setNewRunForm] = useState({
    branchId: '',
    periodStart: '2026-12-01',
    periodEnd: '2026-12-31',
    payDate: '2026-12-31',
  });

  const canRun = hasPerm(user.permissions, user.roles, 'payroll.run');
  const canFinalize = hasPerm(user.permissions, user.roles, 'payroll.finalize');
  const canManageTax = hasPerm(user.permissions, user.roles, 'tax.manage');

  async function loadData(focusRunId?: number) {
    setLoading(true);
    try {
      const qs = selectedBranchId ? `?branchId=${selectedBranchId}` : '';
      const [prRes, slipsRes, benRes] = await Promise.all([
        apiRequest<{ payrolls: PayrollRun[]; taxBrackets: TaxBracketRow[] }>(`/api/payrolls${qs}`),
        apiRequest<{ payslips: Payslip[] }>('/api/payslips'),
        apiRequest<typeof benefitsData>('/api/benefits'),
      ]);
      setRuns(prRes.payrolls);
      setTaxBrackets(prRes.taxBrackets);
      setAllPayslips(slipsRes.payslips);
      setBenefitsData(benRes);

      const targetId = focusRunId ?? activeRun?.id ?? prRes.payrolls[0]?.id;
      if (targetId) {
        const detail = await apiRequest<{ payroll: PayrollRun; payslips: Payslip[] }>(
          `/api/payrolls/${targetId}`
        );
        setActiveRun(detail.payroll);
        setRunPayslips(detail.payslips);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [selectedBranchId]);

  async function selectRun(id: number) {
    const detail = await apiRequest<{ payroll: PayrollRun; payslips: Payslip[] }>(`/api/payrolls/${id}`);
    setActiveRun(detail.payroll);
    setRunPayslips(detail.payslips);
  }

  async function handleCreateRun(e: React.FormEvent) {
    e.preventDefault();
    const res = await apiRequest<{ id: number; runCode: string }>('/api/payrolls', {
      method: 'POST',
      body: {
        branchId: newRunForm.branchId ? Number(newRunForm.branchId) : null,
        periodStart: newRunForm.periodStart,
        periodEnd: newRunForm.periodEnd,
        payDate: newRunForm.payDate,
      },
    });
    onToast(`Created draft payroll cycle ${res.runCode}.`);
    setNewRunOpen(false);
    await loadData(res.id);
  }

  async function runStageAction(action: 'simulate' | 'approve' | 'finalize') {
    if (!activeRun) return;
    setBusyAction(action);
    try {
      await apiRequest(`/api/payrolls/${activeRun.id}/${action}`, { method: 'POST' });
      const labels = {
        simulate: 'Dry-run simulation complete — statutory taxes, proration, overtime & variance computed.',
        approve: 'Payroll cycle approved and queued for final lock.',
        finalize: 'Payroll finalized & locked — payslips immutable, loans/expenses reconciled, webhook dispatched.',
      };
      onToast(labels[action]);
      await loadData(activeRun.id);
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleUpdateBracket(b: TaxBracketRow, nextRate: number) {
    await apiRequest(`/api/tax-brackets/${b.id}`, {
      method: 'PUT',
      body: {
        label: b.label,
        minIncome: b.min_income,
        maxIncome: b.max_income,
        rate: nextRate,
      },
    });
    onToast(`Updated ${b.label} marginal rate to ${(nextRate * 100).toFixed(1)}%.`);
    await loadData();
  }

  async function handleEnrollBenefit(benefitId: number, benefitName: string) {
    await apiRequest('/api/benefits/enroll', {
      method: 'POST',
      body: { benefitId, coverageTier: 'Employee Only' },
    });
    onToast(`Enrolled in ${benefitName} — pre-tax deduction will reflect in the next payroll simulation.`);
    await loadData();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Statutory Payroll, Tax & Benefits"
        description="Multi-stage payroll governance with progressive withholding, FICA caps, proration, variance alerts, and COBRA administration."
        action={
          canRun ? (
            <button
              type="button"
              onClick={() => setNewRunOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Payroll Cycle</span>
            </button>
          ) : null
        }
      />

      <SegmentedTabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'runs', label: 'Payroll Runs', count: runs.length },
          { id: 'payslips', label: 'Payslip Vault', count: allPayslips.length },
          { id: 'tax', label: 'Tax Brackets & FICA', count: taxBrackets.length },
          { id: 'benefits', label: 'Benefits & COBRA', count: benefitsData.plans.length },
        ]}
      />

      {loading ? (
        <LoadingBlock rows={6} />
      ) : tab === 'runs' ? (
        <div className="space-y-6">
          {/* Cycle Selector Strip */}
          <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-neutral-200 dark:border-neutral-800 text-[11px] font-medium text-neutral-500">
                    <th className="px-5 py-2.5">Cycle</th>
                    <th className="px-4 py-2.5">Period</th>
                    <th className="px-4 py-2.5">Scope</th>
                    <th className="px-4 py-2.5 text-right">Employees</th>
                    <th className="px-4 py-2.5 text-right">Total Gross</th>
                    <th className="px-4 py-2.5 text-right">Total Net</th>
                    <th className="px-5 py-2.5">Stage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
                  {runs.map((r) => (
                    <tr
                      key={r.id}
                      onClick={() => selectRun(r.id)}
                      className={`cursor-pointer transition-colors ${
                        activeRun?.id === r.id
                          ? 'bg-blue-50/50 dark:bg-blue-950/25'
                          : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/40'
                      }`}
                    >
                      <td className="px-5 py-3 font-mono font-semibold text-neutral-900 dark:text-neutral-50">
                        {r.run_code}
                      </td>
                      <td className="px-4 py-3 font-mono text-neutral-600 dark:text-neutral-400">
                        {r.period_start} → {r.period_end}
                      </td>
                      <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">
                        {r.branch_name ?? 'All Branches'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">{r.employee_count}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {formatCurrencyWhole(r.total_gross)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums font-medium">
                        {formatCurrencyWhole(r.total_net)}
                      </td>
                      <td className="px-5 py-3">
                        <StatusText status={r.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Active Payroll Run Governance Workbench */}
          {activeRun && (
            <div className="space-y-4">
              <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                <div>
                  <div className="flex items-center gap-3">
                    <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-50 font-mono">
                      {activeRun.run_code}
                    </h2>
                    <StatusText status={activeRun.status} />
                    {activeRun.variance_pct !== null && (
                      <span className="text-xs font-mono tabular-nums text-neutral-500">
                        · Variance vs prior: {activeRun.variance_pct > 0 ? '+' : ''}
                        {activeRun.variance_pct}%
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                    Stage pipeline: Draft → Dry-Run Simulation → Approval Sign-Off → Finalized & Locked
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
                  {canRun && activeRun.status !== 'finalized' && (
                    <button
                      type="button"
                      disabled={busyAction !== null}
                      onClick={() => runStageAction('simulate')}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-md cursor-pointer whitespace-nowrap"
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>{busyAction === 'simulate' ? 'Simulating...' : 'Run Dry-Run Simulation'}</span>
                    </button>
                  )}
                  {canRun && activeRun.status === 'simulated' && (
                    <button
                      type="button"
                      disabled={busyAction !== null}
                      onClick={() => runStageAction('approve')}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 rounded-md cursor-pointer whitespace-nowrap"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Approve Run</span>
                    </button>
                  )}
                  {canFinalize && activeRun.status === 'approved' && (
                    <button
                      type="button"
                      disabled={busyAction !== null}
                      onClick={() => runStageAction('finalize')}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-neutral-900 dark:bg-neutral-100 dark:text-neutral-900 hover:opacity-90 rounded-md cursor-pointer whitespace-nowrap"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      <span>Finalize & Lock</span>
                    </button>
                  )}
                  {runPayslips.length > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          downloadCsv(
                            `/api/payrolls/${activeRun.id}/export?type=bank`,
                            `${activeRun.run_code}-bank-ach.csv`
                          )
                        }
                        className="inline-flex items-center gap-1.5 px-2.5 py-2 text-xs font-medium text-neutral-700 dark:text-neutral-200 border border-neutral-200 dark:border-neutral-700 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer whitespace-nowrap"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Bank ACH</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          downloadCsv(
                            `/api/payrolls/${activeRun.id}/export?type=statutory`,
                            `${activeRun.run_code}-statutory-tax.csv`
                          )
                        }
                        className="inline-flex items-center gap-1.5 px-2.5 py-2 text-xs font-medium text-neutral-700 dark:text-neutral-200 border border-neutral-200 dark:border-neutral-700 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer whitespace-nowrap"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Tax CSV</span>
                      </button>
                    </>
                  )}
                </div>
              </div>

              <MetricStrip
                items={[
                  { label: 'Total Gross Earnings', value: formatCurrency(activeRun.total_gross) },
                  { label: 'Pre-Tax 401k & Benefits', value: formatCurrency(activeRun.total_pre_tax) },
                  {
                    label: 'Statutory Taxes Withheld',
                    value: formatCurrency(activeRun.total_taxes),
                    detail: `Employer FICA/FUTA: ${formatCurrency(activeRun.total_employer_taxes)}`,
                  },
                  {
                    label: 'Total Net Disbursement',
                    value: formatCurrency(activeRun.total_net),
                    detail:
                      activeRun.anomaly_count > 0
                        ? `${activeRun.anomaly_count} anomaly ${activeRun.anomaly_count === 1 ? 'alert' : 'alerts'} flagged`
                        : 'Zero variance anomalies',
                    tone: activeRun.anomaly_count > 0 ? 'warning' : 'positive',
                  },
                ]}
              />

              {/* Itemized Payslip Ledger */}
              <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
                <div className="px-5 py-3.5 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
                  <span className="text-sm font-semibold">
                    Itemized Employee Payroll Ledger ({runPayslips.length})
                  </span>
                  <span className="text-xs text-neutral-500">
                    Click any row for printable payslip breakdown
                  </span>
                </div>
                {runPayslips.length === 0 ? (
                  <div className="px-5 py-10 text-center text-xs text-neutral-500">
                    No simulation lines generated yet. Click <strong>Run Dry-Run Simulation</strong> above to compute statutory taxes, proration, overtime, loan deductions, and approved expense reimbursements.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-neutral-200 dark:border-neutral-800 text-[11px] font-medium text-neutral-500">
                          <th className="px-5 py-2.5">Employee</th>
                          <th className="px-3 py-2.5 text-right">Gross</th>
                          <th className="px-3 py-2.5 text-right">Pre-Tax</th>
                          <th className="px-3 py-2.5 text-right">Fed / State</th>
                          <th className="px-3 py-2.5 text-right">FICA</th>
                          <th className="px-3 py-2.5 text-right">Loans / Reimb</th>
                          <th className="px-4 py-2.5 text-right">Net Pay</th>
                          <th className="px-5 py-2.5">Flags</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
                        {runPayslips.map((slip) => {
                          const flags = JSON.parse(slip.anomaly_flags_json || '[]') as string[];
                          return (
                            <tr
                              key={slip.id}
                              onClick={() => setSelectedSlip({ ...slip, run_code: activeRun.run_code, period_start: activeRun.period_start, period_end: activeRun.period_end })}
                              className="hover:bg-neutral-50 dark:hover:bg-neutral-800/40 cursor-pointer"
                            >
                              <td className="px-5 py-3">
                                <div className="font-medium text-neutral-900 dark:text-neutral-100">
                                  {slip.employee_name}{' '}
                                  <span className="font-mono text-[11px] text-neutral-400">
                                    {slip.employee_code}
                                  </span>
                                </div>
                                <div className="text-[11px] text-neutral-500">
                                  {slip.branch_name}
                                  {slip.proration_factor < 1 ? ` · Prorated ${Math.round(slip.proration_factor * 100)}%` : ''}
                                  {slip.overtime_hours > 0 ? ` · OT ${slip.overtime_hours}h` : ''}
                                </div>
                              </td>
                              <td className="px-3 py-3 text-right font-mono tabular-nums">
                                {formatCurrency(slip.gross_pay)}
                              </td>
                              <td className="px-3 py-3 text-right font-mono tabular-nums text-neutral-600 dark:text-neutral-400">
                                -{formatCurrency(slip.pre_tax_deductions)}
                              </td>
                              <td className="px-3 py-3 text-right font-mono tabular-nums text-neutral-600 dark:text-neutral-400">
                                -{formatCurrency(slip.federal_tax + slip.state_tax)}
                              </td>
                              <td className="px-3 py-3 text-right font-mono tabular-nums text-neutral-600 dark:text-neutral-400">
                                -{formatCurrency(slip.social_security_tax + slip.medicare_tax)}
                              </td>
                              <td className="px-3 py-3 text-right font-mono tabular-nums text-neutral-600 dark:text-neutral-400">
                                {slip.loan_deduction > 0 ? `-${formatCurrency(slip.loan_deduction)}` : '—'}
                                {slip.expense_reimbursement > 0 ? ` / +${formatCurrency(slip.expense_reimbursement)}` : ''}
                              </td>
                              <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold text-neutral-900 dark:text-neutral-50">
                                {formatCurrency(slip.net_pay)}
                              </td>
                              <td className="px-5 py-3 text-[11px]">
                                {flags.length > 0 ? (
                                  <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                    <span className="truncate max-w-[160px]">{flags[0]}</span>
                                  </span>
                                ) : (
                                  <span className="text-neutral-400">Nominal</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ) : tab === 'payslips' ? (
        <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-neutral-200 dark:border-neutral-800 text-[11px] font-medium text-neutral-500">
                  <th className="px-5 py-2.5">Cycle</th>
                  <th className="px-4 py-2.5">Employee</th>
                  <th className="px-4 py-2.5 text-right">Gross Pay</th>
                  <th className="px-4 py-2.5 text-right">Taxes</th>
                  <th className="px-4 py-2.5 text-right">Net Pay</th>
                  <th className="px-5 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
                {allPayslips.map((slip) => (
                  <tr
                    key={slip.id}
                    onClick={() => setSelectedSlip(slip)}
                    className="hover:bg-neutral-50 dark:hover:bg-neutral-800/40 cursor-pointer"
                  >
                    <td className="px-5 py-3 font-mono font-medium">{slip.run_code}</td>
                    <td className="px-4 py-3">
                      {slip.employee_name} · <span className="text-neutral-500">{slip.branch_name}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">{formatCurrency(slip.gross_pay)}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">{formatCurrency(slip.total_taxes)}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold">
                      {formatCurrency(slip.net_pay)}
                    </td>
                    <td className="px-5 py-3">
                      <StatusText status={slip.is_locked ? 'finalized' : 'simulated'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : tab === 'tax' ? (
        <div className="space-y-6">
          <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
            <div className="px-5 py-3.5 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold">Progressive Annual Federal Income Tax Brackets</h2>
                <p className="text-xs text-neutral-500">
                  Applied to annualized taxable gross after Section 125 & 401(k) pre-tax deductions.
                </p>
              </div>
              <span className="text-xs font-mono text-neutral-500">
                FICA SS 6.2% (Cap $176,100) · Medicare 1.45%
              </span>
            </div>
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-neutral-200 dark:border-neutral-800 text-[11px] font-medium text-neutral-500">
                  <th className="px-5 py-2.5">Tier Label</th>
                  <th className="px-4 py-2.5 text-right">Annual Lower Bound</th>
                  <th className="px-4 py-2.5 text-right">Annual Upper Bound</th>
                  <th className="px-5 py-2.5 text-right">Marginal Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
                {taxBrackets.map((b) => (
                  <tr key={b.id}>
                    <td className="px-5 py-3 font-medium">{b.label}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">{formatCurrencyWhole(b.min_income)}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {b.max_income ? formatCurrencyWhole(b.max_income) : 'Unlimited'}
                    </td>
                    <td className="px-5 py-3 text-right font-mono tabular-nums">
                      {canManageTax ? (
                        <input
                          type="number"
                          step="1"
                          min={0}
                          max={50}
                          aria-label={`Marginal rate for ${b.label}`}
                          defaultValue={Math.round(b.rate * 100)}
                          onBlur={(e) => {
                            const next = Number(e.target.value) / 100;
                            if (!Number.isNaN(next) && next !== b.rate) {
                              handleUpdateBracket(b, next);
                            }
                          }}
                          className="w-20 px-2 py-1 text-right bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded"
                        />
                      ) : (
                        `${(b.rate * 100).toFixed(1)}%`
                      )}
                      {canManageTax && <span className="ml-1 text-neutral-400">%</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
            <div className="px-5 py-3.5 border-b border-neutral-200 dark:border-neutral-800 text-sm font-semibold">
              Corporate Benefits Catalog (Employer / Employee Split)
            </div>
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-neutral-200 dark:border-neutral-800 text-[11px] font-medium text-neutral-500">
                  <th className="px-5 py-2.5">Plan Name</th>
                  <th className="px-4 py-2.5">Provider & Category</th>
                  <th className="px-4 py-2.5">Tax Treatment</th>
                  <th className="px-4 py-2.5 text-right">Employee / mo</th>
                  <th className="px-4 py-2.5 text-right">Employer / mo</th>
                  <th className="px-5 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
                {benefitsData.plans.map((plan) => (
                  <tr key={String(plan.id)}>
                    <td className="px-5 py-3 font-medium text-neutral-900 dark:text-neutral-100">
                      {String(plan.name)}
                    </td>
                    <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">
                      {String(plan.provider)} · {String(plan.category)}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-neutral-600 dark:text-neutral-400">
                      {String(plan.tax_treatment) === 'pre_tax' ? 'Pre-Tax (Sec 125)' : 'Post-Tax'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {formatCurrency(Number(plan.employee_monthly_cost))}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {formatCurrency(Number(plan.employer_monthly_cost))}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleEnrollBenefit(Number(plan.id), String(plan.name))}
                        className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                      >
                        Enroll
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {benefitsData.cobra.length > 0 && (
            <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
              <div className="px-5 py-3.5 border-b border-neutral-200 dark:border-neutral-800 text-sm font-semibold">
                COBRA Continuation Coverage Compliance
              </div>
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-neutral-200 dark:border-neutral-800 text-[11px] font-medium text-neutral-500">
                    <th className="px-5 py-2.5">Former Employee</th>
                    <th className="px-4 py-2.5">Qualifying Event</th>
                    <th className="px-4 py-2.5">Plan & Window</th>
                    <th className="px-4 py-2.5 text-right">Monthly Premium</th>
                    <th className="px-5 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
                  {benefitsData.cobra.map((c) => (
                    <tr key={String(c.id)}>
                      <td className="px-5 py-3 font-medium">{String(c.employee_name)}</td>
                      <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">{String(c.qualifying_event)}</td>
                      <td className="px-4 py-3 font-mono text-[11px]">
                        {String(c.plan_name)} · {String(c.start_date)} → {String(c.end_date)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {formatCurrency(Number(c.monthly_premium))}
                      </td>
                      <td className="px-5 py-3">
                        <StatusText status={String(c.status)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Printable Itemized Payslip Statement Drawer */}
      <Drawer
        open={Boolean(selectedSlip)}
        onClose={() => setSelectedSlip(null)}
        title={selectedSlip ? `Payslip Statement — ${selectedSlip.run_code ?? ''}` : ''}
        subtitle={
          selectedSlip
            ? `${selectedSlip.employee_name} (${selectedSlip.employee_code}) · ${selectedSlip.branch_name}`
            : ''
        }
      >
        {selectedSlip && (
          <div className="space-y-6 text-xs">
            <div className="flex items-center justify-between pb-4 border-b border-neutral-200 dark:border-neutral-800">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span className="font-medium text-neutral-800 dark:text-neutral-200">
                  {selectedSlip.is_locked ? 'Finalized & Immutable Earnings Statement' : 'Dry-Run Simulation Preview'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-200 border border-neutral-200 dark:border-neutral-700 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print / Save PDF</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4 bg-neutral-50 dark:bg-neutral-900/60 border border-neutral-200 dark:border-neutral-800 rounded-lg p-4">
              <div>
                <div className="text-neutral-500">Net Disbursement</div>
                <div className="mt-1 text-2xl font-mono tabular-nums font-semibold text-neutral-900 dark:text-neutral-50">
                  {formatCurrency(selectedSlip.net_pay)}
                </div>
              </div>
              <div className="text-right">
                <div className="text-neutral-500">Total Employer Cost</div>
                <div className="mt-1 text-base font-mono tabular-nums font-medium text-neutral-700 dark:text-neutral-300">
                  {formatCurrency(selectedSlip.employer_cost)}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="font-semibold text-neutral-900 dark:text-neutral-100">Earnings</div>
              <div className="divide-y divide-neutral-200 dark:divide-neutral-800 border border-neutral-200 dark:border-neutral-800 rounded-md">
                <div className="px-3.5 py-2 flex justify-between">
                  <span>
                    Base Monthly Salary{' '}
                    {selectedSlip.proration_factor < 1
                      ? `(Prorated ${Math.round(selectedSlip.proration_factor * 100)}%)`
                      : ''}
                  </span>
                  <span className="font-mono tabular-nums">
                    {formatCurrency(selectedSlip.base_monthly_salary * selectedSlip.proration_factor)}
                  </span>
                </div>
                {selectedSlip.overtime_pay > 0 && (
                  <div className="px-3.5 py-2 flex justify-between">
                    <span>Overtime ({selectedSlip.overtime_hours}h @ 1.5x)</span>
                    <span className="font-mono tabular-nums">{formatCurrency(selectedSlip.overtime_pay)}</span>
                  </div>
                )}
                {selectedSlip.expense_reimbursement > 0 && (
                  <div className="px-3.5 py-2 flex justify-between text-emerald-700 dark:text-emerald-400">
                    <span>Approved Expense Reimbursement (Non-Taxable)</span>
                    <span className="font-mono tabular-nums">
                      +{formatCurrency(selectedSlip.expense_reimbursement)}
                    </span>
                  </div>
                )}
                <div className="px-3.5 py-2 flex justify-between font-semibold bg-neutral-50 dark:bg-neutral-900/50">
                  <span>Gross Earnings</span>
                  <span className="font-mono tabular-nums">{formatCurrency(selectedSlip.gross_pay)}</span>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="font-semibold text-neutral-900 dark:text-neutral-100">
                Pre-Tax, Statutory Taxes & Deductions
              </div>
              <div className="divide-y divide-neutral-200 dark:divide-neutral-800 border border-neutral-200 dark:border-neutral-800 rounded-md">
                <div className="px-3.5 py-2 flex justify-between">
                  <span>Pre-Tax 401(k) & Section 125 Benefits</span>
                  <span className="font-mono tabular-nums">-{formatCurrency(selectedSlip.pre_tax_deductions)}</span>
                </div>
                <div className="px-3.5 py-2 flex justify-between">
                  <span>Federal Income Tax (Progressive)</span>
                  <span className="font-mono tabular-nums">-{formatCurrency(selectedSlip.federal_tax)}</span>
                </div>
                <div className="px-3.5 py-2 flex justify-between">
                  <span>Branch State / Regional Withholding</span>
                  <span className="font-mono tabular-nums">-{formatCurrency(selectedSlip.state_tax)}</span>
                </div>
                <div className="px-3.5 py-2 flex justify-between">
                  <span>FICA Social Security (6.2% w/ Wage Cap)</span>
                  <span className="font-mono tabular-nums">-{formatCurrency(selectedSlip.social_security_tax)}</span>
                </div>
                <div className="px-3.5 py-2 flex justify-between">
                  <span>FICA Medicare (1.45% + Addl.)</span>
                  <span className="font-mono tabular-nums">-{formatCurrency(selectedSlip.medicare_tax)}</span>
                </div>
                {selectedSlip.post_tax_deductions > 0 && (
                  <div className="px-3.5 py-2 flex justify-between">
                    <span>Post-Tax Voluntary Benefits</span>
                    <span className="font-mono tabular-nums">-{formatCurrency(selectedSlip.post_tax_deductions)}</span>
                  </div>
                )}
                {selectedSlip.loan_deduction > 0 && (
                  <div className="px-3.5 py-2 flex justify-between">
                    <span>Employee Loan Installment</span>
                    <span className="font-mono tabular-nums">-{formatCurrency(selectedSlip.loan_deduction)}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </Drawer>

      {/* New Payroll Run Modal */}
      <Modal
        open={newRunOpen}
        onClose={() => setNewRunOpen(false)}
        title="Create Draft Payroll Cycle"
        description="Scope payroll to all branches or a specific regional office before running dry-run simulation."
      >
        <form onSubmit={handleCreateRun} className="space-y-3.5 text-xs">
          <div>
            <label className="block font-medium mb-1">Branch Scope</label>
            <select
              value={newRunForm.branchId}
              onChange={(e) => setNewRunForm({ ...newRunForm, branchId: e.target.value })}
              className="w-full px-3 py-2 bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-md"
            >
              <option value="">All Branches (Enterprise-Wide)</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.code})
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block font-medium mb-1">Period Start</label>
              <input
                type="date"
                required
                value={newRunForm.periodStart}
                onChange={(e) => setNewRunForm({ ...newRunForm, periodStart: e.target.value })}
                className="w-full px-2.5 py-2 bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-md"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">Period End</label>
              <input
                type="date"
                required
                value={newRunForm.periodEnd}
                onChange={(e) => setNewRunForm({ ...newRunForm, periodEnd: e.target.value })}
                className="w-full px-2.5 py-2 bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-md"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">Pay Date</label>
              <input
                type="date"
                required
                value={newRunForm.payDate}
                onChange={(e) => setNewRunForm({ ...newRunForm, payDate: e.target.value })}
                className="w-full px-2.5 py-2 bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-md"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3">
            <button
              type="button"
              onClick={() => setNewRunOpen(false)}
              className="px-3.5 py-2 border border-neutral-200 dark:border-neutral-700 rounded-md cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer"
            >
              Create Draft Run
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
