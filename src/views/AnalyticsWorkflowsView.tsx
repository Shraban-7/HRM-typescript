import React, { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Download, GitBranch, Plus, Power } from 'lucide-react';
import { apiRequest, downloadCsv, formatCurrencyWhole, hasPerm } from '../lib/api';
import type { AuthUser, Branch } from '../types/hrm';
import {
  LoadingBlock,
  MetricStrip,
  Modal,
  PageHeader,
  SegmentedTabs,
  StatusText,
} from '../components/ui/Primitives';

type AnalyticsTab = 'analytics' | 'workflows';

interface AnalyticsPayload {
  branchMetrics: Array<{
    id: number;
    name: string;
    code: string;
    city: string;
    state_tax_rate: number;
    headcount: number;
    avg_salary: number;
    total_annual_comp: number;
  }>;
  departmentCost: Array<{
    name: string;
    branch_code: string;
    headcount: number;
    annual_comp: number;
    budget: number;
  }>;
  salaryBands: Array<{ band: string; count: number }>;
  overtimeByBranch: Array<{ branch_name: string; worked_hours: number; overtime_hours: number }>;
  leaveByType: Array<{ leave_type: string; requests: number; total_days: number }>;
  complianceSummary: {
    totalPolicies: number;
    totalAcks: number;
    activeEmployees: number;
    mfaEnrolled: number;
    totalUsers: number;
  };
}

interface WorkflowRuleRow {
  id: number;
  name: string;
  trigger_event: string;
  branch_id: number | null;
  branch_name: string | null;
  condition_field: string;
  condition_operator: string;
  condition_value: number;
  approver_roles_json: string;
  webhook_event: string | null;
  is_active: number;
}

const ROLE_OPTIONS = [
  { slug: 'manager', label: 'Branch Manager' },
  { slug: 'hr_admin', label: 'HR Admin' },
  { slug: 'super_admin', label: 'Super Admin' },
];

export function AnalyticsWorkflowsView({
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
  const [tab, setTab] = useState<AnalyticsTab>('analytics');
  const [analytics, setAnalytics] = useState<AnalyticsPayload | null>(null);
  const [rules, setRules] = useState<WorkflowRuleRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [ruleModal, setRuleModal] = useState(false);
  const [ruleForm, setRuleForm] = useState({
    name: '',
    triggerEvent: 'expense.submitted',
    branchId: '',
    conditionField: 'amount',
    conditionOperator: 'gte',
    conditionValue: 1000,
    approverRoles: ['manager', 'hr_admin'],
    webhookEvent: 'expense.escalated',
  });

  const canManageWorkflows = hasPerm(user.permissions, user.roles, 'workflows.manage');

  async function loadData() {
    setLoading(true);
    try {
      const qs = selectedBranchId ? `?branchId=${selectedBranchId}` : '';
      const [an, wf] = await Promise.all([
        apiRequest<AnalyticsPayload>(`/api/analytics${qs}`),
        apiRequest<{ rules: WorkflowRuleRow[] }>('/api/workflows'),
      ]);
      setAnalytics(an);
      setRules(wf.rules);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [selectedBranchId]);

  async function handleExportCsv() {
    try {
      await downloadCsv('/api/analytics/export', 'nexus-hrm-workforce-report.csv');
      onToast('Workforce CSV report exported.');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to export report.');
    }
  }

  async function handleToggleRule(id: number) {
    try {
      const res = await apiRequest<{ isActive: boolean }>(`/api/workflows/${id}/toggle`, {
        method: 'PATCH',
      });
      onToast(res.isActive ? 'Workflow rule enabled.' : 'Workflow rule paused.');
      await loadData();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to toggle workflow rule.');
    }
  }

  async function handleCreateRule(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiRequest('/api/workflows', {
        method: 'POST',
        body: {
          name: ruleForm.name,
          triggerEvent: ruleForm.triggerEvent,
          branchId: ruleForm.branchId ? Number(ruleForm.branchId) : null,
          conditionField: ruleForm.conditionField,
          conditionOperator: ruleForm.conditionOperator,
          conditionValue: Number(ruleForm.conditionValue),
          approverRoles: ruleForm.approverRoles,
          webhookEvent: ruleForm.webhookEvent.trim() || null,
        },
      });
      setRuleModal(false);
      setRuleForm((p) => ({ ...p, name: '' }));
      onToast('Custom approval workflow rule created and activated.');
      await loadData();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to create rule.');
    }
  }

  function toggleApproverRole(slug: string) {
    setRuleForm((prev) => {
      const exists = prev.approverRoles.includes(slug);
      if (exists && prev.approverRoles.length === 1) return prev;
      return {
        ...prev,
        approverRoles: exists
          ? prev.approverRoles.filter((r) => r !== slug)
          : [...prev.approverRoles, slug],
      };
    });
  }

  const totalComp = analytics
    ? analytics.branchMetrics.reduce((acc, b) => acc + b.total_annual_comp, 0)
    : 0;
  const totalHeadcount = analytics
    ? analytics.branchMetrics.reduce((acc, b) => acc + b.headcount, 0)
    : 0;
  const mfaPct = analytics && analytics.complianceSummary.totalUsers > 0
    ? Math.round((analytics.complianceSummary.mfaEnrolled / analytics.complianceSummary.totalUsers) * 100)
    : 0;
  const policyCompliancePct =
    analytics &&
    analytics.complianceSummary.totalPolicies * analytics.complianceSummary.activeEmployees > 0
      ? Math.round(
          (analytics.complianceSummary.totalAcks /
            (analytics.complianceSummary.totalPolicies * analytics.complianceSummary.activeEmployees)) *
            100
        )
      : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Executive Analytics & Workflows"
        description="Cross-branch compensation intelligence, department budget utilization, compliance posture, and declarative approval routing."
        action={
          tab === 'analytics' ? (
            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-neutral-700 dark:text-neutral-200 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Workforce CSV</span>
            </button>
          ) : canManageWorkflows ? (
            <button
              type="button"
              onClick={() => setRuleModal(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create Workflow Rule</span>
            </button>
          ) : undefined
        }
      />

      <MetricStrip
        items={[
          {
            label: 'Annualized Run-Rate Comp',
            value: formatCurrencyWhole(totalComp),
            detail: `${totalHeadcount} active employees across ${branches.length} branches`,
          },
          {
            label: 'Policy Compliance',
            value: `${policyCompliancePct}%`,
            detail: `${analytics?.complianceSummary.totalAcks ?? 0} verified sign-offs`,
            tone: policyCompliancePct >= 80 ? 'positive' : 'warning',
          },
          {
            label: 'MFA Enforcement Posture',
            value: `${mfaPct}%`,
            detail: `${analytics?.complianceSummary.mfaEnrolled ?? 0}/${analytics?.complianceSummary.totalUsers ?? 0} accounts enrolled`,
          },
          {
            label: 'Active Workflow Rules',
            value: String(rules.filter((r) => r.is_active).length),
            detail: `${rules.length} total routing rules`,
          },
        ]}
      />

      <SegmentedTabs<AnalyticsTab>
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'analytics', label: 'Executive Analytics' },
          { id: 'workflows', label: 'Approval Workflow Builder', count: rules.length },
        ]}
      />

      {loading || !analytics ? (
        <LoadingBlock rows={6} />
      ) : tab === 'analytics' ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Branch Compensation Bar Chart */}
            <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5">
              <div className="mb-4">
                <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                  Annual Compensation by Office Branch
                </h2>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Total active base salary obligation per cost center
                </p>
              </div>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={analytics.branchMetrics.map((b) => ({
                      branch: b.code,
                      annualComp: Math.round(b.total_annual_comp / 1000),
                      headcount: b.headcount,
                    }))}
                    margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#9CA3AF" strokeOpacity={0.22} vertical={false} />
                    <XAxis dataKey="branch" tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                    <YAxis
                      tick={{ fontSize: 11, fill: '#6B7280' }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => `$${v}k`}
                    />
                    <Tooltip
                      formatter={(val) => [`$${Number(val ?? 0).toLocaleString()}k`, 'Annual Base']}
                      contentStyle={{
                        backgroundColor: '#111827',
                        border: '1px solid #374151',
                        borderRadius: '6px',
                        fontSize: '12px',
                        color: '#F9FAFB',
                      }}
                    />
                    <Bar dataKey="annualComp" fill="#2563EB" radius={[4, 4, 0, 0]} maxBarSize={48} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Salary Band Distribution */}
            <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5">
              <div className="mb-4">
                <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                  Salary Band Distribution
                </h2>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Active employee distribution across base compensation tiers
                </p>
              </div>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={analytics.salaryBands} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#9CA3AF" strokeOpacity={0.22} vertical={false} />
                    <XAxis dataKey="band" tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                    <Tooltip
                      formatter={(val) => [`${Number(val ?? 0)} employees`, 'Headcount']}
                      contentStyle={{
                        backgroundColor: '#111827',
                        border: '1px solid #374151',
                        borderRadius: '6px',
                        fontSize: '12px',
                        color: '#F9FAFB',
                      }}
                    />
                    <Bar dataKey="count" fill="#0F766E" radius={[4, 4, 0, 0]} maxBarSize={48} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Department Budget vs Actual Table */}
          <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-neutral-200 dark:border-neutral-800">
              <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                Department Compensation vs. Annual Budget
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-900/40 text-[11px] font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                    <th className="py-3 px-4">Department</th>
                    <th className="py-3 px-4">Branch</th>
                    <th className="py-3 px-4 text-right">Headcount</th>
                    <th className="py-3 px-4 text-right">Annual Base</th>
                    <th className="py-3 px-4 text-right">Budget</th>
                    <th className="py-3 px-4 w-48">Utilization</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800 text-sm">
                  {analytics.departmentCost.map((d) => {
                    const util = d.budget > 0 ? Math.min(100, Math.round((d.annual_comp / d.budget) * 100)) : 0;
                    return (
                      <tr key={`${d.branch_code}-${d.name}`}>
                        <td className="py-3 px-4 font-medium text-neutral-900 dark:text-neutral-100">{d.name}</td>
                        <td className="py-3 px-4 font-mono text-xs text-neutral-500 dark:text-neutral-400">{d.branch_code}</td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-xs">{d.headcount}</td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-xs font-medium text-neutral-900 dark:text-neutral-100">
                          {formatCurrencyWhole(d.annual_comp)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-xs text-neutral-500 dark:text-neutral-400">
                          {formatCurrencyWhole(d.budget)}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-neutral-100 dark:bg-neutral-800 rounded-full overflow-hidden">
                              <div
                                className={`h-full ${util > 90 ? 'bg-amber-500' : 'bg-blue-600'}`}
                                style={{ width: `${util}%` }}
                              />
                            </div>
                            <span className="font-mono tabular-nums text-xs text-neutral-600 dark:text-neutral-400 w-9 text-right">
                              {util}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {rules.map((r) => {
            const chain = JSON.parse(r.approver_roles_json || '[]') as string[];
            return (
              <div
                key={r.id}
                className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2.5">
                    <GitBranch className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                    <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">{r.name}</h3>
                    <StatusText status={r.is_active ? 'active' : 'inactive'} />
                  </div>
                  <p className="text-xs text-neutral-600 dark:text-neutral-300">
                    Trigger: <span className="font-mono">{r.trigger_event}</span> · Scope:{' '}
                    <span className="font-medium">{r.branch_name ?? 'All Branches'}</span> · Condition:{' '}
                    <span className="font-mono">
                      {r.condition_operator === 'always'
                        ? 'Always'
                        : `${r.condition_field} ${r.condition_operator} ${r.condition_value}`}
                    </span>
                  </p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    Approval Chain: <span className="font-mono text-neutral-800 dark:text-neutral-200">{chain.join(' → ')}</span>
                    {r.webhook_event && (
                      <>
                        {' '}
                        · Webhook: <span className="font-mono">{r.webhook_event}</span>
                      </>
                    )}
                  </p>
                </div>

                {canManageWorkflows && (
                  <button
                    type="button"
                    onClick={() => handleToggleRule(r.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-200 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer shrink-0"
                  >
                    <Power className="w-3.5 h-3.5" />
                    <span>{r.is_active ? 'Pause Rule' : 'Activate Rule'}</span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={ruleModal}
        onClose={() => setRuleModal(false)}
        title="Create Custom Approval Workflow"
        description="Declarative routing rules evaluate automatically whenever leave or expense requests are submitted."
      >
        <form onSubmit={handleCreateRule} className="space-y-4">
          <div>
            <label htmlFor="wf-name" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
              Rule Name
            </label>
            <input
              id="wf-name"
              required
              value={ruleForm.name}
              onChange={(e) => setRuleForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="e.g., Executive Review for Expenses ≥ $1,000"
              className="w-full px-3 py-2 text-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="wf-trigger" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                Trigger Event
              </label>
              <select
                id="wf-trigger"
                value={ruleForm.triggerEvent}
                onChange={(e) => setRuleForm((p) => ({ ...p, triggerEvent: e.target.value }))}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md"
              >
                <option value="expense.submitted">expense.submitted</option>
                <option value="leave.submitted">leave.submitted</option>
                <option value="loan.submitted">loan.submitted</option>
                <option value="employee.hired">employee.hired</option>
                <option value="payroll.ready">payroll.ready</option>
              </select>
            </div>
            <div>
              <label htmlFor="wf-branch" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                Branch Scope
              </label>
              <select
                id="wf-branch"
                value={ruleForm.branchId}
                onChange={(e) => setRuleForm((p) => ({ ...p, branchId: e.target.value }))}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md"
              >
                <option value="">All Branches</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label htmlFor="wf-field" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                Field
              </label>
              <select
                id="wf-field"
                value={ruleForm.conditionField}
                onChange={(e) => setRuleForm((p) => ({ ...p, conditionField: e.target.value }))}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md"
              >
                <option value="amount">amount</option>
                <option value="days">days</option>
                <option value="none">none</option>
              </select>
            </div>
            <div>
              <label htmlFor="wf-op" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                Operator
              </label>
              <select
                id="wf-op"
                value={ruleForm.conditionOperator}
                onChange={(e) => setRuleForm((p) => ({ ...p, conditionOperator: e.target.value }))}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md"
              >
                <option value="gte">≥ (gte)</option>
                <option value="gt">&gt; (gt)</option>
                <option value="lt">&lt; (lt)</option>
                <option value="eq">= (eq)</option>
                <option value="always">always</option>
              </select>
            </div>
            <div>
              <label htmlFor="wf-val" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                Threshold
              </label>
              <input
                id="wf-val"
                type="number"
                min={0}
                value={ruleForm.conditionValue}
                onChange={(e) => setRuleForm((p) => ({ ...p, conditionValue: Number(e.target.value) }))}
                className="w-full px-3 py-2 text-sm font-mono bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md"
              />
            </div>
          </div>
          <div>
            <span className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
              Ordered Approval Chain
            </span>
            <div className="flex flex-wrap gap-2">
              {ROLE_OPTIONS.map((ro) => {
                const active = ruleForm.approverRoles.includes(ro.slug);
                return (
                  <button
                    key={ro.slug}
                    type="button"
                    onClick={() => toggleApproverRole(ro.slug)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md border cursor-pointer ${
                      active
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 border-neutral-200 dark:border-neutral-700'
                    }`}
                  >
                    {ro.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label htmlFor="wf-wh" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
              Outbound Webhook Event (Optional)
            </label>
            <input
              id="wf-wh"
              value={ruleForm.webhookEvent}
              onChange={(e) => setRuleForm((p) => ({ ...p, webhookEvent: e.target.value }))}
              placeholder="e.g., expense.escalated"
              className="w-full px-3 py-2 text-sm font-mono bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setRuleModal(false)}
              className="px-3 py-2 text-xs font-medium text-neutral-600 dark:text-neutral-300 rounded-md cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer"
            >
              Activate Rule
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
