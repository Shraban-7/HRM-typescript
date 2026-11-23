import React, { useEffect, useState } from 'react';
import { Building2, CheckSquare, Plus, Search, Square, UserPlus } from 'lucide-react';
import {
  apiRequest,
  formatCurrency,
  formatCurrencyWhole,
  formatDateShort,
  hasPerm,
} from '../lib/api';
import type { AuthUser, Branch, Department, Employee } from '../types/hrm';
import {
  Avatar,
  Drawer,
  EmptyState,
  LoadingBlock,
  Modal,
  PageHeader,
  SegmentedTabs,
  StatusText,
} from '../components/ui/Primitives';

type PeopleTab = 'directory' | 'branches' | 'orgchart' | 'lifecycle';

interface OrgNode {
  id: number;
  employee_code: string;
  full_name: string;
  designation: string;
  manager_id: number | null;
  avatar_url: string | null;
  branch_name: string;
  branch_code: string;
  department_name: string;
}

export function PeopleView({
  user,
  branches,
  selectedBranchId,
  onBranchesUpdated,
  onToast,
}: {
  user: AuthUser;
  branches: Branch[];
  selectedBranchId: number | null;
  onBranchesUpdated: () => void;
  onToast: (msg: string) => void;
}) {
  const [tab, setTab] = useState<PeopleTab>('directory');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [orgNodes, setOrgNodes] = useState<OrgNode[]>([]);
  const [onboarding, setOnboarding] = useState<Array<Record<string, unknown>>>([]);
  const [exits, setExits] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // Detail Drawer
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailData, setDetailData] = useState<{
    employee: Employee;
    payslips: Array<Record<string, unknown>>;
    enrollments: Array<Record<string, unknown>>;
    assets: Array<Record<string, unknown>>;
    directReports: Array<{ id: number; employee_code: string; full_name: string; designation: string }>;
  } | null>(null);
  const [editSalary, setEditSalary] = useState('');
  const [editDesignation, setEditDesignation] = useState('');

  // Create Modals
  const [addEmpOpen, setAddEmpOpen] = useState(false);
  const [empForm, setEmpForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    branchId: branches[0]?.id ?? 1,
    departmentId: 1,
    designation: '',
    hireDate: '2026-11-23',
    annualSalary: 135000,
    preTax401kPct: 4,
  });

  const [addBranchOpen, setAddBranchOpen] = useState(false);
  const [branchForm, setBranchForm] = useState({
    code: '',
    name: '',
    city: '',
    country: 'United States',
    timezone: 'America/Los_Angeles',
    stateTaxRate: 0.055,
    costCenter: '',
  });

  const canManageEmp = hasPerm(user.permissions, user.roles, 'employees.manage');
  const canManageBranches = hasPerm(user.permissions, user.roles, 'branches.manage');

  async function loadAll() {
    setLoading(true);
    try {
      const qs = selectedBranchId ? `?branchId=${selectedBranchId}` : '';
      const [empRes, deptRes, orgRes, lifeRes] = await Promise.all([
        apiRequest<{ employees: Employee[] }>(`/api/employees${qs}`),
        apiRequest<{ departments: Department[] }>(`/api/departments${qs}`),
        apiRequest<{ nodes: OrgNode[] }>('/api/org-chart'),
        apiRequest<{ onboarding: Array<Record<string, unknown>>; exits: Array<Record<string, unknown>> }>(
          `/api/lifecycle${qs}`
        ),
      ]);
      setEmployees(empRes.employees);
      setDepartments(deptRes.departments);
      setOrgNodes(orgRes.nodes);
      setOnboarding(lifeRes.onboarding);
      setExits(lifeRes.exits);
      if (deptRes.departments.length > 0 && !deptRes.departments.some((d) => d.id === empForm.departmentId)) {
        setEmpForm((prev) => ({ ...prev, departmentId: deptRes.departments[0].id }));
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, [selectedBranchId]);

  async function openEmployeeDetail(id: number) {
    const res = await apiRequest<NonNullable<typeof detailData>>(`/api/employees/${id}`);
    setDetailData(res);
    setEditSalary(String(res.employee.annual_salary ?? ''));
    setEditDesignation(res.employee.designation);
    setDetailOpen(true);
  }

  async function handleSaveEmployeeUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (!detailData) return;
    await apiRequest(`/api/employees/${detailData.employee.id}`, {
      method: 'PUT',
      body: {
        designation: editDesignation,
        annualSalary: editSalary ? Number(editSalary) : undefined,
      },
    });
    onToast(`Updated profile for ${detailData.employee.full_name} (logged to audit chain).`);
    await openEmployeeDetail(detailData.employee.id);
    await loadAll();
  }

  async function handleCreateEmployee(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await apiRequest<{ employeeCode: string }>('/api/employees', {
        method: 'POST',
        body: {
          ...empForm,
          branchId: Number(empForm.branchId),
          departmentId: Number(empForm.departmentId),
          annualSalary: Number(empForm.annualSalary),
          preTax401kPct: Number(empForm.preTax401kPct),
        },
      });
      onToast(`Hired ${empForm.fullName} (${res.employeeCode}) & provisioned onboarding checklist.`);
      setAddEmpOpen(false);
      setEmpForm({
        fullName: '',
        email: '',
        phone: '',
        branchId: branches[0]?.id ?? 1,
        departmentId: departments[0]?.id ?? 1,
        designation: '',
        hireDate: '2026-11-23',
        annualSalary: 135000,
        preTax401kPct: 4,
      });
      await loadAll();
    } catch (err) {
      onToast((err as Error).message);
    }
  }

  async function handleCreateBranch(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiRequest('/api/branches', {
        method: 'POST',
        body: {
          ...branchForm,
          stateTaxRate: Number(branchForm.stateTaxRate),
        },
      });
      onToast(`Branch ${branchForm.name} added to enterprise topology.`);
      setAddBranchOpen(false);
      setBranchForm({
        code: '',
        name: '',
        city: '',
        country: 'United States',
        timezone: 'America/Los_Angeles',
        stateTaxRate: 0.055,
        costCenter: '',
      });
      onBranchesUpdated();
      await loadAll();
    } catch (err) {
      onToast((err as Error).message);
    }
  }

  async function toggleOnboardingTask(id: number) {
    await apiRequest(`/api/onboarding/${id}/toggle`, { method: 'POST' });
    await loadAll();
  }

  async function clearExitDepartment(exitId: number, department: 'it' | 'finance' | 'hr') {
    await apiRequest(`/api/exits/${exitId}/clear`, { method: 'POST', body: { department } });
    onToast(`Cleared ${department.toUpperCase()} offboarding checklist.`);
    await loadAll();
  }

  const filteredEmployees = employees.filter((emp) => {
    if (statusFilter !== 'all' && emp.status !== statusFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return `${emp.full_name} ${emp.employee_code} ${emp.designation} ${emp.department_name} ${emp.branch_name}`
        .toLowerCase()
        .includes(q);
    }
    return true;
  });

  function renderOrgSubtree(parentId: number | null, depth = 0): React.ReactNode {
    const children = orgNodes.filter((n) => n.manager_id === parentId);
    if (children.length === 0) return null;
    return (
      <div className={depth === 0 ? 'space-y-4' : 'mt-3 ml-6 pl-5 border-l border-neutral-200 dark:border-neutral-800 space-y-3'}>
        {children.map((node) => (
          <div key={node.id}>
            <button
              type="button"
              onClick={() => openEmployeeDetail(node.id)}
              className="w-full sm:w-auto min-w-[300px] text-left px-4 py-3 bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 hover:border-blue-500/60 rounded-lg flex items-center gap-3 transition-colors cursor-pointer"
            >
              <Avatar src={node.avatar_url} name={node.full_name} size="md" />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-neutral-900 dark:text-neutral-50">
                  {node.full_name}{' '}
                  <span className="font-mono text-[11px] font-normal text-neutral-400">
                    {node.employee_code}
                  </span>
                </div>
                <div className="text-xs text-neutral-600 dark:text-neutral-400">{node.designation}</div>
                <div className="text-[11px] text-neutral-500 dark:text-neutral-500 mt-0.5">
                  {node.department_name} · {node.branch_name}
                </div>
              </div>
            </button>
            {renderOrgSubtree(node.id, depth + 1)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="People, Branches & Organization"
        description="Unified multi-branch workforce directory, reporting hierarchy, and onboarding/exit clearance workflows."
        action={
          tab === 'branches' && canManageBranches ? (
            <button
              type="button"
              onClick={() => setAddBranchOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer whitespace-nowrap"
            >
              <Building2 className="w-3.5 h-3.5" />
              <span>Add Branch</span>
            </button>
          ) : canManageEmp ? (
            <button
              type="button"
              onClick={() => setAddEmpOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer whitespace-nowrap"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Hire Employee</span>
            </button>
          ) : null
        }
      />

      <SegmentedTabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'directory', label: 'Employee Directory', count: employees.length },
          { id: 'branches', label: 'Branches & Departments', count: branches.length },
          { id: 'orgchart', label: 'Org Chart', count: orgNodes.length },
          { id: 'lifecycle', label: 'Onboarding & Exits', count: onboarding.length + exits.length },
        ]}
      />

      {loading ? (
        <LoadingBlock rows={6} />
      ) : tab === 'directory' ? (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, code, designation, or branch..."
                aria-label="Search employees"
                className="w-full pl-9 pr-3 py-2 text-xs bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-md focus:outline-none focus:border-blue-600"
              />
            </div>
            <div className="flex items-center gap-1.5">
              {['all', 'active', 'on_leave', 'terminated'].map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                    statusFilter === st
                      ? 'bg-neutral-900 text-white border-neutral-900 dark:bg-neutral-100 dark:text-neutral-900'
                      : 'bg-white dark:bg-[#111827] text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-800'
                  }`}
                >
                  {st === 'all' ? 'All' : st.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>

          {filteredEmployees.length === 0 ? (
            <EmptyState
              title="No matching employees"
              description="Adjust your branch filter or search criteria to view matching records."
            />
          ) : (
            <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-neutral-200 dark:border-neutral-800 text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
                      <th className="px-5 py-2.5">Employee</th>
                      <th className="px-4 py-2.5">Branch & Dept</th>
                      <th className="px-4 py-2.5">Manager</th>
                      <th className="px-4 py-2.5">Hire Date</th>
                      <th className="px-4 py-2.5 text-right">Annual Salary</th>
                      <th className="px-5 py-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800 text-xs">
                    {filteredEmployees.map((emp) => (
                      <tr
                        key={emp.id}
                        onClick={() => openEmployeeDetail(emp.id)}
                        className="hover:bg-neutral-50 dark:hover:bg-neutral-800/40 cursor-pointer transition-colors"
                      >
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-3">
                            <Avatar src={emp.avatar_url} name={emp.full_name} size="md" />
                            <div className="min-w-0">
                              <div className="font-medium text-neutral-900 dark:text-neutral-50">
                                {emp.full_name}{' '}
                                <span className="font-mono text-[11px] text-neutral-400 ml-1">
                                  {emp.employee_code}
                                </span>
                              </div>
                              <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
                                {emp.designation}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-neutral-700 dark:text-neutral-300">
                          <div>{emp.branch_name}</div>
                          <div className="text-[11px] text-neutral-500">{emp.department_name}</div>
                        </td>
                        <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">
                          {emp.manager_name ?? 'Executive Board'}
                        </td>
                        <td className="px-4 py-3 font-mono tabular-nums text-neutral-600 dark:text-neutral-400">
                          {formatDateShort(emp.hire_date)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums font-medium text-neutral-900 dark:text-neutral-100">
                          {emp.annual_salary !== null ? formatCurrencyWhole(emp.annual_salary) : 'Restricted'}
                        </td>
                        <td className="px-5 py-3">
                          <StatusText status={emp.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      ) : tab === 'branches' ? (
        <div className="space-y-6">
          <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
            <div className="px-5 py-3.5 border-b border-neutral-200 dark:border-neutral-800 text-sm font-semibold">
              Enterprise Office Branches
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-neutral-200 dark:border-neutral-800 text-[11px] font-medium text-neutral-500">
                    <th className="px-5 py-2.5">Code / Name</th>
                    <th className="px-4 py-2.5">Location & Timezone</th>
                    <th className="px-4 py-2.5">Cost Center</th>
                    <th className="px-4 py-2.5 text-right">Regional Tax</th>
                    <th className="px-4 py-2.5 text-right">Headcount</th>
                    <th className="px-5 py-2.5 text-right">Annual Comp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
                  {branches.map((b) => (
                    <tr key={b.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/40">
                      <td className="px-5 py-3 font-medium text-neutral-900 dark:text-neutral-100">
                        <span className="font-mono text-neutral-500 mr-2">{b.code}</span>
                        {b.name}
                        {b.is_headquarters ? (
                          <span className="ml-2 text-[11px] text-blue-600 dark:text-blue-400">· HQ</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">
                        {b.city}, {b.country} · <span className="font-mono text-[11px]">{b.timezone}</span>
                      </td>
                      <td className="px-4 py-3 font-mono text-neutral-600 dark:text-neutral-400">{b.cost_center}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {(b.state_tax_rate * 100).toFixed(2)}%
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">{b.headcount ?? 0}</td>
                      <td className="px-5 py-3 text-right font-mono tabular-nums font-medium">
                        {formatCurrencyWhole(b.annual_payroll ?? 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
            <div className="px-5 py-3.5 border-b border-neutral-200 dark:border-neutral-800 text-sm font-semibold">
              Departments & Budget Allocation
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-neutral-200 dark:border-neutral-800 text-[11px] font-medium text-neutral-500">
                    <th className="px-5 py-2.5">Department</th>
                    <th className="px-4 py-2.5">Branch</th>
                    <th className="px-4 py-2.5">Lead</th>
                    <th className="px-4 py-2.5 text-right">Headcount</th>
                    <th className="px-5 py-2.5 text-right">Annual Budget</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
                  {departments.map((d) => (
                    <tr key={d.id}>
                      <td className="px-5 py-3 font-medium text-neutral-900 dark:text-neutral-100">
                        {d.name} <span className="font-mono text-[11px] text-neutral-400 ml-1">{d.code}</span>
                      </td>
                      <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">{d.branch_name}</td>
                      <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">{d.manager_name ?? 'Unassigned'}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">{d.headcount}</td>
                      <td className="px-5 py-3 text-right font-mono tabular-nums font-medium">
                        {formatCurrencyWhole(d.budget)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : tab === 'orgchart' ? (
        <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg p-6 overflow-x-auto">
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-5">
            Click any member in the reporting tree to inspect compensation, assigned assets, and direct reports.
          </p>
          {renderOrgSubtree(null, 0)}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
            <div className="px-5 py-3.5 border-b border-neutral-200 dark:border-neutral-800 text-sm font-semibold">
              Active Onboarding Checklists
            </div>
            <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {onboarding.map((t) => {
                const completed = Boolean(t.is_completed);
                return (
                  <div key={String(t.id)} className="px-5 py-3.5 flex items-start justify-between gap-3 text-xs">
                    <button
                      type="button"
                      disabled={!canManageEmp}
                      onClick={() => toggleOnboardingTask(Number(t.id))}
                      className="flex items-start gap-2.5 text-left cursor-pointer disabled:cursor-default"
                    >
                      {completed ? (
                        <CheckSquare className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      ) : (
                        <Square className="w-4 h-4 text-neutral-400 shrink-0 mt-0.5" />
                      )}
                      <div>
                        <div className={completed ? 'line-through text-neutral-400' : 'font-medium text-neutral-900 dark:text-neutral-100'}>
                          {String(t.title)}
                        </div>
                        <div className="text-[11px] text-neutral-500 mt-0.5">
                          {String(t.employee_name)} · {String(t.branch_name)} · Owner: {String(t.owner_role)} · Due {String(t.due_date)}
                        </div>
                      </div>
                    </button>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
            <div className="px-5 py-3.5 border-b border-neutral-200 dark:border-neutral-800 text-sm font-semibold">
              Offboarding & Department Exit Clearances
            </div>
            <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {exits.map((ex) => (
                <div key={String(ex.id)} className="px-5 py-4 space-y-3 text-xs">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-neutral-900 dark:text-neutral-100">
                        {String(ex.employee_name)} ({String(ex.employee_code)})
                      </div>
                      <div className="text-[11px] text-neutral-500">
                        {String(ex.branch_name)} · Last Working Day: {String(ex.last_working_day)}
                      </div>
                    </div>
                    <StatusText status={String(ex.status)} />
                  </div>
                  <p className="text-neutral-600 dark:text-neutral-400">{String(ex.reason)}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {(['it', 'finance', 'hr'] as const).map((dept) => {
                      const cleared = Boolean(ex[`${dept}_cleared`]);
                      return (
                        <button
                          key={dept}
                          type="button"
                          disabled={cleared || !canManageEmp}
                          onClick={() => clearExitDepartment(Number(ex.id), dept)}
                          className={`px-2.5 py-1 text-[11px] font-medium rounded border transition-colors ${
                            cleared
                              ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900'
                              : 'bg-white dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 border-neutral-200 dark:border-neutral-700 hover:border-blue-500 cursor-pointer'
                          }`}
                        >
                          {dept.toUpperCase()}: {cleared ? 'Cleared' : 'Mark Cleared'}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* Employee Detail Drawer */}
      <Drawer
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        title={detailData ? `${detailData.employee.full_name} (${detailData.employee.employee_code})` : ''}
        subtitle={detailData ? `${detailData.employee.designation} · ${detailData.employee.branch_name}` : ''}
      >
        {detailData && (
          <div className="space-y-6 text-xs">
            <div className="grid grid-cols-2 gap-4 pb-5 border-b border-neutral-200 dark:border-neutral-800">
              <div>
                <div className="text-neutral-500">Work Email</div>
                <div className="mt-0.5 font-medium text-neutral-900 dark:text-neutral-100">
                  {detailData.employee.email}
                </div>
              </div>
              <div>
                <div className="text-neutral-500">Department & Branch</div>
                <div className="mt-0.5 font-medium text-neutral-900 dark:text-neutral-100">
                  {detailData.employee.department_name} · {detailData.employee.branch_name}
                </div>
              </div>
              <div>
                <div className="text-neutral-500">Direct Deposit (Masked)</div>
                <div className="mt-0.5 font-mono text-neutral-900 dark:text-neutral-100">
                  {detailData.employee.bank_name ?? 'ACH'} · {detailData.employee.bank_account_masked}
                </div>
              </div>
              <div>
                <div className="text-neutral-500">Emergency Contact</div>
                <div className="mt-0.5 text-neutral-900 dark:text-neutral-100">
                  {detailData.employee.emergency_contact_name ?? 'Not listed'}
                </div>
              </div>
            </div>

            {canManageEmp && (
              <form onSubmit={handleSaveEmployeeUpdate} className="space-y-3 pb-5 border-b border-neutral-200 dark:border-neutral-800">
                <div className="font-semibold text-neutral-900 dark:text-neutral-100">
                  Update Role & Base Compensation
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-neutral-500 mb-1">Designation</label>
                    <input
                      value={editDesignation}
                      onChange={(e) => setEditDesignation(e.target.value)}
                      className="w-full px-3 py-1.5 bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-md"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-neutral-500 mb-1">Annual Salary (USD)</label>
                    <input
                      type="number"
                      value={editSalary}
                      onChange={(e) => setEditSalary(e.target.value)}
                      className="w-full px-3 py-1.5 font-mono bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-md"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  className="px-3.5 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer"
                >
                  Save Audited Changes
                </button>
              </form>
            )}

            <div>
              <div className="font-semibold text-neutral-900 dark:text-neutral-100 mb-2">
                Recent Payslips ({detailData.payslips.length})
              </div>
              {detailData.payslips.length === 0 ? (
                <p className="text-neutral-500">No payslips available or restricted by role scope.</p>
              ) : (
                <div className="divide-y divide-neutral-200 dark:divide-neutral-800 border border-neutral-200 dark:border-neutral-800 rounded-md">
                  {detailData.payslips.map((p) => (
                    <div key={String(p.id)} className="px-3.5 py-2.5 flex items-center justify-between">
                      <span>
                        <span className="font-mono font-medium">{String(p.run_code)}</span> · {String(p.period_start)}
                      </span>
                      <span className="font-mono tabular-nums font-semibold">
                        Net {formatCurrency(Number(p.net_pay))}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="font-semibold text-neutral-900 dark:text-neutral-100 mb-2">
                Assigned Hardware & Benefits
              </div>
              <div className="text-neutral-600 dark:text-neutral-400 space-y-1">
                {detailData.assets.map((a) => (
                  <div key={String(a.id)}>
                    Asset: <span className="font-mono">{String(a.asset_tag)}</span> — {String(a.name)}
                  </div>
                ))}
                {detailData.enrollments.map((b) => (
                  <div key={String(b.id)}>
                    Benefit: {String(b.benefit_name)} ({String(b.coverage_tier)} · {String(b.tax_treatment)})
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Drawer>

      {/* Hire Employee Modal */}
      <Modal
        open={addEmpOpen}
        onClose={() => setAddEmpOpen(false)}
        title="Hire New Employee"
        description="Creates employee profile, auto-provisions onboarding tasks, and dispatches employee.hired webhooks."
      >
        <form onSubmit={handleCreateEmployee} className="space-y-3.5 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium mb-1">Full Name</label>
              <input
                required
                value={empForm.fullName}
                onChange={(e) => setEmpForm({ ...empForm, fullName: e.target.value })}
                className="w-full px-3 py-2 bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-md"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">Work Email</label>
              <input
                type="email"
                required
                value={empForm.email}
                onChange={(e) => setEmpForm({ ...empForm, email: e.target.value })}
                className="w-full px-3 py-2 bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-md"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium mb-1">Office Branch</label>
              <select
                value={empForm.branchId}
                onChange={(e) => setEmpForm({ ...empForm, branchId: Number(e.target.value) })}
                className="w-full px-3 py-2 bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-md"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-medium mb-1">Department</label>
              <select
                value={empForm.departmentId}
                onChange={(e) => setEmpForm({ ...empForm, departmentId: Number(e.target.value) })}
                className="w-full px-3 py-2 bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-md"
              >
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name} ({d.branch_code})</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium mb-1">Job Title / Designation</label>
              <input
                required
                value={empForm.designation}
                onChange={(e) => setEmpForm({ ...empForm, designation: e.target.value })}
                className="w-full px-3 py-2 bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-md"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">Start Date</label>
              <input
                type="date"
                required
                value={empForm.hireDate}
                onChange={(e) => setEmpForm({ ...empForm, hireDate: e.target.value })}
                className="w-full px-3 py-2 bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-md"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium mb-1">Annual Salary (USD)</label>
              <input
                type="number"
                required
                min={20000}
                value={empForm.annualSalary}
                onChange={(e) => setEmpForm({ ...empForm, annualSalary: Number(e.target.value) })}
                className="w-full px-3 py-2 font-mono bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-md"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">Pre-Tax 401(k) %</label>
              <input
                type="number"
                min={0}
                max={25}
                value={empForm.preTax401kPct}
                onChange={(e) => setEmpForm({ ...empForm, preTax401kPct: Number(e.target.value) })}
                className="w-full px-3 py-2 font-mono bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-md"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3">
            <button
              type="button"
              onClick={() => setAddEmpOpen(false)}
              className="px-3.5 py-2 border border-neutral-200 dark:border-neutral-700 rounded-md cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer"
            >
              Confirm Hire
            </button>
          </div>
        </form>
      </Modal>

      {/* Add Branch Modal */}
      <Modal
        open={addBranchOpen}
        onClose={() => setAddBranchOpen(false)}
        title="Add Enterprise Branch"
        description="Configure regional office location, payroll cost center, and state/local withholding tax rate."
      >
        <form onSubmit={handleCreateBranch} className="space-y-3.5 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium mb-1">Branch Code</label>
              <input
                required
                placeholder="SFO-WEST"
                value={branchForm.code}
                onChange={(e) => setBranchForm({ ...branchForm, code: e.target.value })}
                className="w-full px-3 py-2 font-mono bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-md"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">Branch Name</label>
              <input
                required
                placeholder="San Francisco West"
                value={branchForm.name}
                onChange={(e) => setBranchForm({ ...branchForm, name: e.target.value })}
                className="w-full px-3 py-2 bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-md"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium mb-1">City</label>
              <input
                required
                placeholder="San Francisco, CA"
                value={branchForm.city}
                onChange={(e) => setBranchForm({ ...branchForm, city: e.target.value })}
                className="w-full px-3 py-2 bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-md"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">Cost Center</label>
              <input
                required
                placeholder="CC-500"
                value={branchForm.costCenter}
                onChange={(e) => setBranchForm({ ...branchForm, costCenter: e.target.value })}
                className="w-full px-3 py-2 font-mono bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-md"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium mb-1">Timezone</label>
              <input
                required
                value={branchForm.timezone}
                onChange={(e) => setBranchForm({ ...branchForm, timezone: e.target.value })}
                className="w-full px-3 py-2 bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-md"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">State/Local Tax Rate (decimal)</label>
              <input
                type="number"
                step="0.005"
                min={0}
                max={0.25}
                value={branchForm.stateTaxRate}
                onChange={(e) => setBranchForm({ ...branchForm, stateTaxRate: Number(e.target.value) })}
                className="w-full px-3 py-2 font-mono bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-md"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3">
            <button
              type="button"
              onClick={() => setAddBranchOpen(false)}
              className="px-3.5 py-2 border border-neutral-200 dark:border-neutral-700 rounded-md cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-4 py-2 font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create Branch</span>
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
