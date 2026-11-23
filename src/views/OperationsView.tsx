import React, { useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  FileCheck2,
  Laptop,
  LifeBuoy,
  Plus,
  Receipt,
  Send,
  Wallet,
  X,
} from 'lucide-react';
import { apiRequest, formatCurrency, formatDateShort, hasPerm } from '../lib/api';
import type { AuthUser, Branch, Employee } from '../types/hrm';
import {
  Drawer,
  LoadingBlock,
  MetricStrip,
  Modal,
  PageHeader,
  SegmentedTabs,
  StatusText,
} from '../components/ui/Primitives';

type OpsTab = 'expenses' | 'assets' | 'policies' | 'loans' | 'tickets';

interface AssetRow {
  id: number;
  asset_tag: string;
  category: string;
  name: string;
  serial_number: string;
  branch_name: string;
  assigned_employee_id: number | null;
  assigned_employee_name: string | null;
  cost: number;
  status: string;
}

interface PolicyRow {
  id: number;
  title: string;
  version: string;
  category: string;
  summary: string;
  effective_date: string;
  ack_count: number;
  total_active_employees: number;
  acknowledged_by_me: number;
}

interface ExpenseRow {
  id: number;
  employee_name: string;
  employee_code: string;
  branch_name: string;
  category: string;
  amount: number;
  claim_date: string;
  description: string;
  status: string;
  approval_chain_json: string;
  current_step: number;
}

interface LoanRow {
  id: number;
  employee_name: string;
  employee_code: string;
  branch_name: string;
  principal_amount: number;
  interest_rate: number;
  term_months: number;
  monthly_installment: number;
  remaining_balance: number;
  purpose: string;
  status: string;
}

interface TicketRow {
  id: number;
  ticket_number: string;
  employee_name: string;
  department: string;
  subject: string;
  description: string;
  priority: string;
  status: string;
  comment_count: number;
  created_at: string;
}

interface TicketCommentRow {
  id: number;
  author_name: string;
  comment: string;
  created_at: string;
}

export function OperationsView({
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
  const [tab, setTab] = useState<OpsTab>('expenses');
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [policies, setPolicies] = useState<PolicyRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [loans, setLoans] = useState<LoanRow[]>([]);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);

  const [expenseModal, setExpenseModal] = useState(false);
  const [expenseForm, setExpenseForm] = useState({
    category: 'Travel & Lodging',
    amount: 420,
    claimDate: '2026-11-23',
    description: '',
  });

  const [assetModal, setAssetModal] = useState(false);
  const [assetForm, setAssetForm] = useState({
    assetTag: 'NX-IT-409',
    category: 'Laptop',
    name: 'MacBook Pro 16" M4 Max',
    serialNumber: 'C02NX8820Q',
    branchId: branches[0]?.id ?? 1,
    cost: 3499,
  });

  const [loanModal, setLoanModal] = useState(false);
  const [loanForm, setLoanForm] = useState({
    principalAmount: 3000,
    termMonths: 12,
    purpose: '',
  });

  const [ticketModal, setTicketModal] = useState(false);
  const [ticketForm, setTicketForm] = useState({
    department: 'Payroll' as 'Payroll' | 'IT & Security' | 'Benefits' | 'People Ops',
    subject: '',
    description: '',
    priority: 'medium' as 'low' | 'medium' | 'high',
  });

  const [activeTicket, setActiveTicket] = useState<TicketRow | null>(null);
  const [ticketComments, setTicketComments] = useState<TicketCommentRow[]>([]);
  const [commentText, setCommentText] = useState('');
  const [commentStatus, setCommentStatus] = useState<'open' | 'in_progress' | 'resolved'>('in_progress');

  const canManage = hasPerm(user.permissions, user.roles, 'ops.manage');

  async function loadData() {
    setLoading(true);
    try {
      const qs = selectedBranchId ? `?branchId=${selectedBranchId}` : '';
      const [ops, empRes] = await Promise.all([
        apiRequest<{
          assets: AssetRow[];
          policies: PolicyRow[];
          expenses: ExpenseRow[];
          loans: LoanRow[];
          tickets: TicketRow[];
        }>(`/api/operations${qs}`),
        apiRequest<{ employees: Employee[] }>('/api/employees'),
      ]);
      setAssets(ops.assets);
      setPolicies(ops.policies);
      setExpenses(ops.expenses);
      setLoans(ops.loans);
      setTickets(ops.tickets);
      setEmployees(empRes.employees);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [selectedBranchId]);

  async function openTicketDrawer(ticket: TicketRow) {
    setActiveTicket(ticket);
    setCommentStatus(
      ticket.status === 'resolved' ? 'resolved' : ticket.status === 'in_progress' ? 'in_progress' : 'open'
    );
    const res = await apiRequest<{ comments: TicketCommentRow[] }>(`/api/tickets/${ticket.id}/comments`);
    setTicketComments(res.comments);
  }

  async function handleExpenseSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await apiRequest<{ approvalChain: string[] }>('/api/expenses', {
        method: 'POST',
        body: { ...expenseForm, amount: Number(expenseForm.amount) },
      });
      setExpenseModal(false);
      setExpenseForm((p) => ({ ...p, description: '' }));
      onToast(`Expense submitted · Routed via ${res.approvalChain.join(' → ')}.`);
      await loadData();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to submit expense.');
    }
  }

  async function handleExpenseDecision(id: number, decision: 'approve' | 'reject') {
    try {
      const res = await apiRequest<{ status: string }>(`/api/expenses/${id}/decision`, {
        method: 'POST',
        body: { decision },
      });
      onToast(
        decision === 'reject'
          ? 'Expense claim rejected.'
          : res.status === 'approved'
            ? 'Expense approved and queued for next payroll reimbursement.'
            : 'Approval step recorded; advanced to next approver.'
      );
      await loadData();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Action failed.');
    }
  }

  async function handleAddAsset(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiRequest('/api/assets', {
        method: 'POST',
        body: { ...assetForm, branchId: Number(assetForm.branchId), cost: Number(assetForm.cost) },
      });
      setAssetModal(false);
      onToast('Hardware asset registered.');
      await loadData();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to register asset.');
    }
  }

  async function handleAssetAssign(assetId: number, employeeId: number | null) {
    try {
      await apiRequest(`/api/assets/${assetId}/assign`, {
        method: 'POST',
        body: { employeeId },
      });
      onToast(employeeId ? 'Asset assigned to employee.' : 'Asset returned to branch pool.');
      await loadData();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to update assignment.');
    }
  }

  async function handleAckPolicy(policyId: number) {
    try {
      await apiRequest(`/api/policies/${policyId}/acknowledge`, { method: 'POST' });
      onToast('Policy acknowledgement cryptographically recorded.');
      await loadData();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to acknowledge policy.');
    }
  }

  async function handleLoanSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiRequest('/api/loans', {
        method: 'POST',
        body: {
          principalAmount: Number(loanForm.principalAmount),
          termMonths: Number(loanForm.termMonths),
          purpose: loanForm.purpose,
        },
      });
      setLoanModal(false);
      setLoanForm({ principalAmount: 3000, termMonths: 12, purpose: '' });
      onToast('Loan application submitted for review.');
      await loadData();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to submit loan.');
    }
  }

  async function handleLoanApprove(id: number) {
    try {
      await apiRequest(`/api/loans/${id}/approve`, { method: 'POST' });
      onToast('Loan activated — monthly EMI automatically linked to payroll deductions.');
      await loadData();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to approve loan.');
    }
  }

  async function handleTicketCreate(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await apiRequest<{ ticketNumber: string }>('/api/tickets', {
        method: 'POST',
        body: ticketForm,
      });
      setTicketModal(false);
      setTicketForm({ department: 'Payroll', subject: '', description: '', priority: 'medium' });
      onToast(`Help Desk ticket ${res.ticketNumber} created.`);
      await loadData();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to open ticket.');
    }
  }

  async function handlePostComment(e: React.FormEvent) {
    e.preventDefault();
    if (!activeTicket || !commentText.trim()) return;
    try {
      await apiRequest(`/api/tickets/${activeTicket.id}/comments`, {
        method: 'POST',
        body: { comment: commentText.trim(), status: canManage ? commentStatus : undefined },
      });
      setCommentText('');
      const res = await apiRequest<{ comments: TicketCommentRow[] }>(`/api/tickets/${activeTicket.id}/comments`);
      setTicketComments(res.comments);
      await loadData();
      onToast('Reply posted.');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to post comment.');
    }
  }

  const pendingExpensesTotal = expenses
    .filter((x) => x.status === 'pending')
    .reduce((acc, x) => acc + x.amount, 0);
  const openTicketsCount = tickets.filter((t) => t.status !== 'resolved').length;
  const activeLoansBalance = loans
    .filter((l) => l.status === 'active')
    .reduce((acc, l) => acc + l.remaining_balance, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workplace Operations"
        description="Workflow-routed expense reimbursements, hardware asset custody, digital policy sign-offs, payroll-linked loans, and HR Help Desk."
        action={
          tab === 'expenses' ? (
            <button
              type="button"
              onClick={() => setExpenseModal(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Submit Expense</span>
            </button>
          ) : tab === 'assets' && canManage ? (
            <button
              type="button"
              onClick={() => setAssetModal(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Register Asset</span>
            </button>
          ) : tab === 'loans' ? (
            <button
              type="button"
              onClick={() => setLoanModal(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Apply for Loan</span>
            </button>
          ) : tab === 'tickets' ? (
            <button
              type="button"
              onClick={() => setTicketModal(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Open Ticket</span>
            </button>
          ) : undefined
        }
      />

      <MetricStrip
        items={[
          {
            label: 'Pending Expenses',
            value: formatCurrency(pendingExpensesTotal),
            detail: `${expenses.filter((e) => e.status === 'pending').length} awaiting approval`,
          },
          {
            label: 'Tracked Hardware',
            value: String(assets.length),
            detail: `${assets.filter((a) => a.status === 'assigned').length} assigned to staff`,
          },
          {
            label: 'Active Loan Ledger',
            value: formatCurrency(activeLoansBalance),
            detail: `${loans.filter((l) => l.status === 'active').length} active EMI plans`,
          },
          {
            label: 'Open Help Desk',
            value: String(openTicketsCount),
            detail: `${tickets.length} total cases`,
            tone: openTicketsCount > 0 ? 'warning' : 'positive',
          },
        ]}
      />

      <SegmentedTabs<OpsTab>
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'expenses', label: 'Expenses', count: expenses.length },
          { id: 'assets', label: 'IT Assets', count: assets.length },
          { id: 'policies', label: 'Digital Policies', count: policies.length },
          { id: 'loans', label: 'Employee Loans', count: loans.length },
          { id: 'tickets', label: 'HR Help Desk', count: tickets.length },
        ]}
      />

      {loading ? (
        <LoadingBlock rows={5} />
      ) : tab === 'expenses' ? (
        <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-900/40 text-[11px] font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                  <th className="py-3 px-4">Employee</th>
                  <th className="py-3 px-4">Claim Details</th>
                  <th className="py-3 px-4">Approval Workflow</th>
                  <th className="py-3 px-4 text-right">Amount</th>
                  <th className="py-3 px-4">Status</th>
                  {canManage && <th className="py-3 px-4 text-right">Decision</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800 text-sm">
                {expenses.map((x) => {
                  const chain = JSON.parse(x.approval_chain_json || '["manager"]') as string[];
                  return (
                    <tr key={x.id} className="hover:bg-neutral-50/70 dark:hover:bg-neutral-800/30">
                      <td className="py-3 px-4">
                        <div className="font-medium text-neutral-900 dark:text-neutral-100">{x.employee_name}</div>
                        <div className="text-xs text-neutral-500 dark:text-neutral-400">
                          {x.branch_name} · {formatDateShort(x.claim_date)}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="text-xs font-medium text-neutral-800 dark:text-neutral-200 flex items-center gap-1.5">
                          <Receipt className="w-3.5 h-3.5 text-neutral-400" />
                          <span>{x.category}</span>
                        </div>
                        <div className="text-xs text-neutral-500 dark:text-neutral-400">{x.description}</div>
                      </td>
                      <td className="py-3 px-4 text-xs text-neutral-500 dark:text-neutral-400">
                        Step {Math.min(x.current_step, chain.length)}/{chain.length} · {chain.join(' → ')}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-neutral-900 dark:text-neutral-100">
                        {formatCurrency(x.amount)}
                      </td>
                      <td className="py-3 px-4">
                        <StatusText status={x.status} />
                      </td>
                      {canManage && (
                        <td className="py-3 px-4 text-right">
                          {x.status === 'pending' && (
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleExpenseDecision(x.id, 'approve')}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/70 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 rounded cursor-pointer"
                              >
                                <Check className="w-3 h-3" />
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => handleExpenseDecision(x.id, 'reject')}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800/70 hover:bg-red-50 dark:hover:bg-red-950/30 rounded cursor-pointer"
                              >
                                <X className="w-3 h-3" />
                                Reject
                              </button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : tab === 'assets' ? (
        <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-900/40 text-[11px] font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                  <th className="py-3 px-4">Asset</th>
                  <th className="py-3 px-4">Branch & Serial</th>
                  <th className="py-3 px-4 text-right">Value</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Custodian</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800 text-sm">
                {assets.map((a) => (
                  <tr key={a.id}>
                    <td className="py-3 px-4">
                      <div className="font-medium text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
                        <Laptop className="w-4 h-4 text-neutral-400 shrink-0" />
                        <span>{a.name}</span>
                      </div>
                      <div className="text-xs font-mono text-neutral-500 dark:text-neutral-400">
                        {a.asset_tag} · {a.category}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-xs text-neutral-600 dark:text-neutral-400">
                      <div>{a.branch_name}</div>
                      <div className="font-mono text-[11px] opacity-80">{a.serial_number}</div>
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-xs text-neutral-800 dark:text-neutral-200">
                      {formatCurrency(a.cost)}
                    </td>
                    <td className="py-3 px-4">
                      <StatusText status={a.status} />
                    </td>
                    <td className="py-3 px-4">
                      {canManage ? (
                        <select
                          aria-label={`Assign ${a.asset_tag}`}
                          value={a.assigned_employee_id ?? ''}
                          onChange={(e) =>
                            handleAssetAssign(a.id, e.target.value ? Number(e.target.value) : null)
                          }
                          className="text-xs px-2 py-1 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded cursor-pointer"
                        >
                          <option value="">Unassigned (Pool)</option>
                          {employees.map((e) => (
                            <option key={e.id} value={e.id}>
                              {e.full_name} ({e.employee_code})
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-xs text-neutral-600 dark:text-neutral-400">
                          {a.assigned_employee_name ?? 'Unassigned'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : tab === 'policies' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {policies.map((p) => {
            const pct =
              p.total_active_employees > 0
                ? Math.round((p.ack_count / p.total_active_employees) * 100)
                : 0;
            return (
              <div
                key={p.id}
                className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 flex flex-col justify-between gap-4"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-50 flex items-center gap-2">
                        <FileCheck2 className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                        <span>{p.title}</span>
                      </h3>
                      <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                        v{p.version} · {p.category} · Effective {formatDateShort(p.effective_date)}
                      </p>
                    </div>
                    {p.acknowledged_by_me ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Signed
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleAckPolicy(p.id)}
                        className="px-2.5 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded cursor-pointer whitespace-nowrap"
                      >
                        Acknowledge
                      </button>
                    )}
                  </div>
                  <p className="mt-3 text-xs text-neutral-600 dark:text-neutral-300 leading-relaxed">
                    {p.summary}
                  </p>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-neutral-500 dark:text-neutral-400">
                    <span>Enterprise Sign-Off Rate</span>
                    <span className="font-mono tabular-nums">
                      {p.ack_count}/{p.total_active_employees} ({pct}%)
                    </span>
                  </div>
                  <div className="h-1.5 bg-neutral-100 dark:bg-neutral-800 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-600 dark:bg-emerald-500" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : tab === 'loans' ? (
        <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-900/40 text-[11px] font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                  <th className="py-3 px-4">Employee</th>
                  <th className="py-3 px-4">Purpose & Terms</th>
                  <th className="py-3 px-4 text-right">Principal</th>
                  <th className="py-3 px-4 text-right">Monthly EMI</th>
                  <th className="py-3 px-4 text-right">Remaining</th>
                  <th className="py-3 px-4">Status</th>
                  {canManage && <th className="py-3 px-4 text-right">Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800 text-sm">
                {loans.map((l) => (
                  <tr key={l.id}>
                    <td className="py-3 px-4">
                      <div className="font-medium text-neutral-900 dark:text-neutral-100">{l.employee_name}</div>
                      <div className="text-xs text-neutral-500 dark:text-neutral-400">{l.branch_name}</div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="text-xs font-medium text-neutral-800 dark:text-neutral-200 flex items-center gap-1.5">
                        <Wallet className="w-3.5 h-3.5 text-neutral-400" />
                        <span>{l.purpose}</span>
                      </div>
                      <div className="text-xs text-neutral-500 dark:text-neutral-400 font-mono tabular-nums">
                        {l.term_months} mo · {l.interest_rate}% APR
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-xs">
                      {formatCurrency(l.principal_amount)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-xs font-semibold text-neutral-900 dark:text-neutral-100">
                      {formatCurrency(l.monthly_installment)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-xs">
                      {formatCurrency(l.remaining_balance)}
                    </td>
                    <td className="py-3 px-4">
                      <StatusText status={l.status} />
                    </td>
                    {canManage && (
                      <td className="py-3 px-4 text-right">
                        {l.status === 'pending' && (
                          <button
                            type="button"
                            onClick={() => handleLoanApprove(l.id)}
                            className="px-2.5 py-1 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded cursor-pointer"
                          >
                            Approve & Activate
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-900/40 text-[11px] font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                  <th className="py-3 px-4">Case</th>
                  <th className="py-3 px-4">Employee</th>
                  <th className="py-3 px-4">Desk & Priority</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Thread</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800 text-sm">
                {tickets.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => openTicketDrawer(t)}
                    className="hover:bg-neutral-50/70 dark:hover:bg-neutral-800/30 cursor-pointer"
                  >
                    <td className="py-3 px-4">
                      <div className="font-medium text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
                        <LifeBuoy className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                        <span>{t.subject}</span>
                      </div>
                      <div className="text-xs font-mono text-neutral-500 dark:text-neutral-400">
                        {t.ticket_number} · {formatDateShort(t.created_at)}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-xs text-neutral-700 dark:text-neutral-300">{t.employee_name}</td>
                    <td className="py-3 px-4 text-xs text-neutral-600 dark:text-neutral-400">
                      {t.department} · <span className="capitalize">{t.priority}</span>
                    </td>
                    <td className="py-3 px-4">
                      <StatusText status={t.status} />
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-xs text-blue-600 dark:text-blue-400">
                      {t.comment_count} replies →
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Expense Modal */}
      <Modal
        open={expenseModal}
        onClose={() => setExpenseModal(false)}
        title="Submit Expense Claim"
        description="Automatically routed through active approval workflows based on amount and branch."
      >
        <form onSubmit={handleExpenseSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="exp-cat" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                Category
              </label>
              <select
                id="exp-cat"
                value={expenseForm.category}
                onChange={(e) => setExpenseForm((p) => ({ ...p, category: e.target.value }))}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md"
              >
                <option value="Travel & Lodging">Travel & Lodging</option>
                <option value="Home Office Equipment">Home Office Equipment</option>
                <option value="Client Meals">Client Meals</option>
                <option value="Software & Learning">Software & Learning</option>
              </select>
            </div>
            <div>
              <label htmlFor="exp-amt" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                Amount (USD)
              </label>
              <input
                id="exp-amt"
                type="number"
                min={1}
                step="0.01"
                required
                value={expenseForm.amount}
                onChange={(e) => setExpenseForm((p) => ({ ...p, amount: Number(e.target.value) }))}
                className="w-full px-3 py-2 text-sm font-mono bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md"
              />
            </div>
          </div>
          <div>
            <label htmlFor="exp-date" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
              Receipt Date
            </label>
            <input
              id="exp-date"
              type="date"
              required
              value={expenseForm.claimDate}
              onChange={(e) => setExpenseForm((p) => ({ ...p, claimDate: e.target.value }))}
              className="w-full px-3 py-2 text-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md"
            />
          </div>
          <div>
            <label htmlFor="exp-desc" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
              Business Justification
            </label>
            <textarea
              id="exp-desc"
              required
              rows={2}
              value={expenseForm.description}
              onChange={(e) => setExpenseForm((p) => ({ ...p, description: e.target.value }))}
              placeholder="Include merchant and business context..."
              className="w-full px-3 py-2 text-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setExpenseModal(false)}
              className="px-3 py-2 text-xs font-medium text-neutral-600 dark:text-neutral-300 rounded-md cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer"
            >
              Submit Claim
            </button>
          </div>
        </form>
      </Modal>

      {/* Asset Modal */}
      <Modal open={assetModal} onClose={() => setAssetModal(false)} title="Register Hardware Asset">
        <form onSubmit={handleAddAsset} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="ast-tag" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                Asset Tag
              </label>
              <input
                id="ast-tag"
                required
                value={assetForm.assetTag}
                onChange={(e) => setAssetForm((p) => ({ ...p, assetTag: e.target.value }))}
                className="w-full px-3 py-2 text-sm font-mono bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md"
              />
            </div>
            <div>
              <label htmlFor="ast-cat" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                Category
              </label>
              <input
                id="ast-cat"
                required
                value={assetForm.category}
                onChange={(e) => setAssetForm((p) => ({ ...p, category: e.target.value }))}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md"
              />
            </div>
          </div>
          <div>
            <label htmlFor="ast-name" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
              Model / Device Name
            </label>
            <input
              id="ast-name"
              required
              value={assetForm.name}
              onChange={(e) => setAssetForm((p) => ({ ...p, name: e.target.value }))}
              className="w-full px-3 py-2 text-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label htmlFor="ast-sn" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                Serial Number
              </label>
              <input
                id="ast-sn"
                required
                value={assetForm.serialNumber}
                onChange={(e) => setAssetForm((p) => ({ ...p, serialNumber: e.target.value }))}
                className="w-full px-3 py-2 text-sm font-mono bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md"
              />
            </div>
            <div>
              <label htmlFor="ast-branch" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                Branch
              </label>
              <select
                id="ast-branch"
                value={assetForm.branchId}
                onChange={(e) => setAssetForm((p) => ({ ...p, branchId: Number(e.target.value) }))}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="ast-cost" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                Cost (USD)
              </label>
              <input
                id="ast-cost"
                type="number"
                required
                value={assetForm.cost}
                onChange={(e) => setAssetForm((p) => ({ ...p, cost: Number(e.target.value) }))}
                className="w-full px-3 py-2 text-sm font-mono bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setAssetModal(false)}
              className="px-3 py-2 text-xs font-medium text-neutral-600 dark:text-neutral-300 rounded-md cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer"
            >
              Save Asset
            </button>
          </div>
        </form>
      </Modal>

      {/* Loan Modal */}
      <Modal
        open={loanModal}
        onClose={() => setLoanModal(false)}
        title="Employee Salary Advance / Loan"
        description="3.0% fixed APR · Monthly installment automatically deducted once active."
      >
        <form onSubmit={handleLoanSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="loan-amt" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                Principal (USD)
              </label>
              <input
                id="loan-amt"
                type="number"
                min={200}
                max={25000}
                required
                value={loanForm.principalAmount}
                onChange={(e) => setLoanForm((p) => ({ ...p, principalAmount: Number(e.target.value) }))}
                className="w-full px-3 py-2 text-sm font-mono bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md"
              />
            </div>
            <div>
              <label htmlFor="loan-term" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                Term (Months)
              </label>
              <input
                id="loan-term"
                type="number"
                min={3}
                max={36}
                required
                value={loanForm.termMonths}
                onChange={(e) => setLoanForm((p) => ({ ...p, termMonths: Number(e.target.value) }))}
                className="w-full px-3 py-2 text-sm font-mono bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md"
              />
            </div>
          </div>
          <div className="p-3 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-md flex items-center justify-between text-xs">
            <span className="text-neutral-500 dark:text-neutral-400">Estimated Monthly Payroll Deduction</span>
            <span className="font-mono tabular-nums font-semibold text-neutral-900 dark:text-neutral-100">
              {formatCurrency(
                (loanForm.principalAmount * (1 + 0.03 * (loanForm.termMonths / 12))) /
                  Math.max(1, loanForm.termMonths)
              )}
              /mo
            </span>
          </div>
          <div>
            <label htmlFor="loan-purpose" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
              Purpose
            </label>
            <input
              id="loan-purpose"
              required
              value={loanForm.purpose}
              onChange={(e) => setLoanForm((p) => ({ ...p, purpose: e.target.value }))}
              placeholder="e.g., Relocation deposit assistance"
              className="w-full px-3 py-2 text-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setLoanModal(false)}
              className="px-3 py-2 text-xs font-medium text-neutral-600 dark:text-neutral-300 rounded-md cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer"
            >
              Submit Request
            </button>
          </div>
        </form>
      </Modal>

      {/* Ticket Modal */}
      <Modal open={ticketModal} onClose={() => setTicketModal(false)} title="Open HR Help Desk Case">
        <form onSubmit={handleTicketCreate} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="tk-dept" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                Support Desk
              </label>
              <select
                id="tk-dept"
                value={ticketForm.department}
                onChange={(e) =>
                  setTicketForm((p) => ({
                    ...p,
                    department: e.target.value as 'Payroll' | 'IT & Security' | 'Benefits' | 'People Ops',
                  }))
                }
                className="w-full px-3 py-2 text-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md"
              >
                <option value="Payroll">Payroll</option>
                <option value="IT & Security">IT & Security</option>
                <option value="Benefits">Benefits</option>
                <option value="People Ops">People Ops</option>
              </select>
            </div>
            <div>
              <label htmlFor="tk-prio" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                Priority
              </label>
              <select
                id="tk-prio"
                value={ticketForm.priority}
                onChange={(e) =>
                  setTicketForm((p) => ({ ...p, priority: e.target.value as 'low' | 'medium' | 'high' }))
                }
                className="w-full px-3 py-2 text-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="tk-sub" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
              Subject
            </label>
            <input
              id="tk-sub"
              required
              value={ticketForm.subject}
              onChange={(e) => setTicketForm((p) => ({ ...p, subject: e.target.value }))}
              placeholder="Summarize your inquiry..."
              className="w-full px-3 py-2 text-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md"
            />
          </div>
          <div>
            <label htmlFor="tk-desc" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
              Details
            </label>
            <textarea
              id="tk-desc"
              required
              rows={3}
              value={ticketForm.description}
              onChange={(e) => setTicketForm((p) => ({ ...p, description: e.target.value }))}
              className="w-full px-3 py-2 text-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setTicketModal(false)}
              className="px-3 py-2 text-xs font-medium text-neutral-600 dark:text-neutral-300 rounded-md cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer"
            >
              Create Case
            </button>
          </div>
        </form>
      </Modal>

      {/* Ticket Conversation Drawer */}
      <Drawer
        open={Boolean(activeTicket)}
        onClose={() => setActiveTicket(null)}
        title={activeTicket ? `${activeTicket.ticket_number} · ${activeTicket.subject}` : ''}
        subtitle={
          activeTicket
            ? `${activeTicket.department} · Opened by ${activeTicket.employee_name} · ${activeTicket.priority} priority`
            : undefined
        }
      >
        {activeTicket && (
          <div className="space-y-5">
            <div className="p-4 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-md text-sm text-neutral-700 dark:text-neutral-300">
              {activeTicket.description}
            </div>

            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                Case Thread ({ticketComments.length})
              </h3>
              {ticketComments.length === 0 ? (
                <p className="text-xs text-neutral-500">No replies yet.</p>
              ) : (
                ticketComments.map((c) => (
                  <div
                    key={c.id}
                    className="p-3.5 bg-white dark:bg-neutral-900/60 border border-neutral-200 dark:border-neutral-800 rounded-md space-y-1"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-neutral-900 dark:text-neutral-100">{c.author_name}</span>
                      <span className="text-neutral-400 font-mono text-[11px]">{formatDateShort(c.created_at)}</span>
                    </div>
                    <p className="text-sm text-neutral-700 dark:text-neutral-300">{c.comment}</p>
                  </div>
                ))
              )}
            </div>

            <form onSubmit={handlePostComment} className="space-y-3 pt-4 border-t border-neutral-200 dark:border-neutral-800">
              {canManage && (
                <div className="flex items-center gap-2">
                  <label htmlFor="tk-status-update" className="text-xs text-neutral-500">
                    Update status:
                  </label>
                  <select
                    id="tk-status-update"
                    value={commentStatus}
                    onChange={(e) =>
                      setCommentStatus(e.target.value as 'open' | 'in_progress' | 'resolved')
                    }
                    className="text-xs px-2 py-1 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded"
                  >
                    <option value="open">Open</option>
                    <option value="in_progress">In Progress</option>
                    <option value="resolved">Resolved</option>
                  </select>
                </div>
              )}
              <textarea
                rows={3}
                required
                placeholder="Write a response..."
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md"
              />
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Post Reply</span>
              </button>
            </form>
          </div>
        )}
      </Drawer>
    </div>
  );
}
