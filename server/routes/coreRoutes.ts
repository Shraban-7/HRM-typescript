import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { evaluateWorkflowRules, maskBankAccount, type WorkflowRule } from '../domain/index';
import { type AuthedRequest, recordAuditLog, requireAuth, requirePermission } from '../middleware/auth';
import { dispatchWebhookEvent } from '../services/webhookService';

export const coreRouter = Router();
coreRouter.use(requireAuth);

// ---------------------------------------------------------------------------
// Role-Adaptive & Multi-Branch Dashboard Aggregates
// ---------------------------------------------------------------------------
coreRouter.get('/dashboard', (req: AuthedRequest, res) => {
  const branchId = req.query.branchId ? Number(req.query.branchId) : null;
  const branchFilter = branchId ? 'AND branch_id = ?' : '';
  const branchParams = branchId ? [branchId] : [];

  const totalEmployees = (
    db.prepare(`SELECT COUNT(*) as c FROM employees WHERE status = 'active' ${branchFilter}`).get(...branchParams) as {
      c: number;
    }
  ).c;

  const branchBreakdown = db
    .prepare(
      `SELECT b.id, b.code, b.name, b.city, b.country, b.state_tax_rate,
              COUNT(e.id) as headcount,
              COALESCE(SUM(e.annual_salary), 0) as annual_payroll
       FROM branches b
       LEFT JOIN employees e ON e.branch_id = b.id AND e.status = 'active'
       GROUP BY b.id
       ORDER BY b.is_headquarters DESC, b.name ASC`
    )
    .all();

  const deptBreakdown = db
    .prepare(
      `SELECT d.id, d.name, d.code, b.name as branch_name, COUNT(e.id) as headcount, COALESCE(SUM(e.annual_salary), 0) as annual_cost
       FROM departments d
       JOIN branches b ON b.id = d.branch_id
       LEFT JOIN employees e ON e.department_id = d.id AND e.status = 'active'
       ${branchId ? 'WHERE d.branch_id = ?' : ''}
       GROUP BY d.id
       ORDER BY headcount DESC`
    )
    .all(...branchParams);

  const pendingLeaves = (
    db.prepare(`SELECT COUNT(*) as c FROM leave_requests WHERE status = 'pending' ${branchFilter}`).get(...branchParams) as {
      c: number;
    }
  ).c;

  const pendingExpenses = (
    db.prepare(`SELECT COUNT(*) as c FROM expenses WHERE status = 'pending' ${branchFilter}`).get(...branchParams) as {
      c: number;
    }
  ).c;

  const openJobs = (
    db.prepare(`SELECT COUNT(*) as c FROM job_posts WHERE status = 'open' ${branchFilter}`).get(...branchParams) as {
      c: number;
    }
  ).c;

  const todayPresent = (
    db
      .prepare(
        `SELECT COUNT(*) as c FROM attendances WHERE work_date = '2026-11-23' ${branchFilter}`
      )
      .get(...branchParams) as { c: number }
  ).c;

  const latestFinalizedPayroll = db
    .prepare("SELECT * FROM payrolls WHERE status = 'finalized' ORDER BY id DESC LIMIT 1")
    .get();

  const draftPayroll = db
    .prepare("SELECT * FROM payrolls WHERE status IN ('draft', 'simulated', 'approved') ORDER BY id DESC LIMIT 1")
    .get();

  const pendingApprovals = [
    ...(db
      .prepare(
        `SELECT l.id, 'leave' as kind, e.full_name as employee_name, b.name as branch_name,
                l.leave_type || ' (' || l.days || 'd)' as summary, l.start_date as ref_date,
                l.approval_chain_json, l.current_step, l.created_at
         FROM leave_requests l
         JOIN employees e ON e.id = l.employee_id
         JOIN branches b ON b.id = l.branch_id
         WHERE l.status = 'pending' ${branchId ? 'AND l.branch_id = ?' : ''}
         ORDER BY l.id DESC LIMIT 6`
      )
      .all(...branchParams) as Array<Record<string, unknown>>),
    ...(db
      .prepare(
        `SELECT x.id, 'expense' as kind, e.full_name as employee_name, b.name as branch_name,
                x.category || ' ($' || printf('%.2f', x.amount) || ')' as summary, x.claim_date as ref_date,
                x.approval_chain_json, x.current_step, x.created_at
         FROM expenses x
         JOIN employees e ON e.id = x.employee_id
         JOIN branches b ON b.id = x.branch_id
         WHERE x.status = 'pending' ${branchId ? 'AND x.branch_id = ?' : ''}
         ORDER BY x.id DESC LIMIT 6`
      )
      .all(...branchParams) as Array<Record<string, unknown>>),
  ];

  // Employee self-service summary for logged-in user
  let selfService: Record<string, unknown> | null = null;
  if (req.user?.employeeId) {
    const todayAtt = db
      .prepare("SELECT * FROM attendances WHERE employee_id = ? AND work_date = '2026-11-23'")
      .get(req.user.employeeId);
    const usedAnnual = (
      db
        .prepare("SELECT COALESCE(SUM(days), 0) as d FROM leave_requests WHERE employee_id = ? AND leave_type = 'annual' AND status = 'approved'")
        .get(req.user.employeeId) as { d: number }
    ).d;
    const latestSlip = db
      .prepare(
        `SELECT ps.*, pr.run_code, pr.period_start, pr.period_end
         FROM payslips ps JOIN payrolls pr ON pr.id = ps.payroll_id
         WHERE ps.employee_id = ? ORDER BY ps.id DESC LIMIT 1`
      )
      .get(req.user.employeeId);
    const openGoals = db
      .prepare('SELECT * FROM goals WHERE employee_id = ? ORDER BY id DESC LIMIT 4')
      .all(req.user.employeeId);
    const unackedPolicies = (
      db
        .prepare(
          `SELECT COUNT(*) as c FROM company_policies cp
           WHERE cp.requires_acknowledgement = 1
           AND NOT EXISTS (SELECT 1 FROM policy_acknowledgements pa WHERE pa.policy_id = cp.id AND pa.employee_id = ?)`
        )
        .get(req.user.employeeId) as { c: number }
    ).c;

    selfService = {
      todayAttendance: todayAtt ?? null,
      annualLeaveRemaining: Math.max(0, 20 - usedAnnual),
      sickLeaveRemaining: 14,
      latestPayslip: latestSlip ?? null,
      goals: openGoals,
      unacknowledgedPolicies: unackedPolicies,
    };
  }

  const recentAudit = db
    .prepare('SELECT id, actor_email, action, resource, resource_id, created_at FROM audit_logs ORDER BY id DESC LIMIT 8')
    .all();

  const unreadNotifications = (
    db
      .prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0')
      .get(req.user!.id) as { c: number }
  ).c;

  const mfaEnrolledCount = (
    db.prepare('SELECT COUNT(*) as c FROM users WHERE mfa_enabled = 1').get() as { c: number }
  ).c;
  const totalUsersCount = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;

  // 6-month payroll trend for executive visualization
  const payrollTrend = [
    { month: 'Jun', gross: 126400, net: 86200, employerTax: 9670 },
    { month: 'Jul', gross: 129800, net: 88100, employerTax: 9930 },
    { month: 'Aug', gross: 134500, net: 91200, employerTax: 10290 },
    { month: 'Sep', gross: 138200, net: 93400, employerTax: 10572 },
    {
      month: 'Oct',
      gross: (latestFinalizedPayroll as { total_gross?: number } | undefined)?.total_gross ?? 141167,
      net: (latestFinalizedPayroll as { total_net?: number } | undefined)?.total_net ?? 94617,
      employerTax: (latestFinalizedPayroll as { total_employer_taxes?: number } | undefined)?.total_employer_taxes ?? 10799,
    },
    { month: 'Nov (Est)', gross: 152400, net: 102150, employerTax: 11658 },
  ];

  res.json({
    kpis: {
      totalEmployees,
      attendanceRate: totalEmployees > 0 ? Math.min(100, Math.round((todayPresent / totalEmployees) * 100)) : 100,
      todayPresent,
      pendingApprovalsCount: pendingLeaves + pendingExpenses,
      pendingLeaves,
      pendingExpenses,
      openJobs,
      mfaAdoptionPct: totalUsersCount > 0 ? Math.round((mfaEnrolledCount / totalUsersCount) * 100) : 0,
      unreadNotifications,
    },
    latestFinalizedPayroll,
    draftPayroll,
    branchBreakdown,
    deptBreakdown,
    payrollTrend,
    pendingApprovals,
    recentAudit,
    selfService,
  });
});

// ---------------------------------------------------------------------------
// Branches & Departments
// ---------------------------------------------------------------------------
coreRouter.get('/branches', (_req, res) => {
  const branches = db
    .prepare(
      `SELECT b.*, COUNT(e.id) as headcount, COALESCE(SUM(e.annual_salary), 0) as annual_payroll
       FROM branches b
       LEFT JOIN employees e ON e.branch_id = b.id AND e.status = 'active'
       GROUP BY b.id ORDER BY b.is_headquarters DESC, b.name ASC`
    )
    .all();
  res.json({ branches });
});

coreRouter.post('/branches', requirePermission('branches.manage'), (req: AuthedRequest, res) => {
  const schema = z.object({
    code: z.string().min(2).max(20),
    name: z.string().min(2).max(100),
    city: z.string().min(2).max(80),
    country: z.string().min(2).max(80),
    timezone: z.string().min(3).max(60),
    stateTaxRate: z.number().min(0).max(0.25),
    costCenter: z.string().min(2).max(30),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid branch details.' });
    return;
  }
  const d = parsed.data;
  try {
    const info = db
      .prepare(
        `INSERT INTO branches (code, name, city, country, timezone, currency_code, state_tax_rate, cost_center, is_headquarters, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'USD', ?, ?, 0, 'active', ?)`
      )
      .run(d.code.toUpperCase(), d.name, d.city, d.country, d.timezone, d.stateTaxRate, d.costCenter.toUpperCase(), new Date().toISOString());

    recordAuditLog({
      user: req.user,
      action: 'branch.created',
      resource: 'branches',
      resourceId: Number(info.lastInsertRowid),
      after: d,
      ipAddress: req.ip,
    });
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  } catch {
    res.status(409).json({ error: 'Branch code already exists.' });
  }
});

coreRouter.get('/departments', (req, res) => {
  const branchId = req.query.branchId ? Number(req.query.branchId) : null;
  const rows = db
    .prepare(
      `SELECT d.*, b.name as branch_name, b.code as branch_code,
              m.full_name as manager_name, COUNT(e.id) as headcount
       FROM departments d
       JOIN branches b ON b.id = d.branch_id
       LEFT JOIN employees m ON m.id = d.manager_employee_id
       LEFT JOIN employees e ON e.department_id = d.id AND e.status = 'active'
       ${branchId ? 'WHERE d.branch_id = ?' : ''}
       GROUP BY d.id ORDER BY b.name, d.name`
    )
    .all(...(branchId ? [branchId] : []));
  res.json({ departments: rows });
});

coreRouter.post('/departments', requirePermission('branches.manage'), (req: AuthedRequest, res) => {
  const schema = z.object({
    branchId: z.number().int().positive(),
    name: z.string().min(2).max(100),
    code: z.string().min(2).max(16),
    budget: z.number().min(0).default(0),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid department fields.' });
    return;
  }
  const d = parsed.data;
  const info = db
    .prepare('INSERT INTO departments (branch_id, name, code, budget, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(d.branchId, d.name, d.code.toUpperCase(), d.budget, new Date().toISOString());
  recordAuditLog({
    user: req.user,
    action: 'department.created',
    resource: 'departments',
    resourceId: Number(info.lastInsertRowid),
    after: d,
    ipAddress: req.ip,
  });
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

// ---------------------------------------------------------------------------
// Employees Directory, Detail Drawer, CRUD & Org Chart
// ---------------------------------------------------------------------------
coreRouter.get('/employees', requirePermission('employees.view'), (req: AuthedRequest, res) => {
  const branchId = req.query.branchId ? Number(req.query.branchId) : null;
  const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
  const status = typeof req.query.status === 'string' ? req.query.status : '';

  const rows = db
    .prepare(
      `SELECT e.*, b.name as branch_name, b.code as branch_code, b.city as branch_city,
              d.name as department_name, m.full_name as manager_name
       FROM employees e
       JOIN branches b ON b.id = e.branch_id
       JOIN departments d ON d.id = e.department_id
       LEFT JOIN employees m ON m.id = e.manager_id
       ${branchId ? 'WHERE e.branch_id = ?' : ''}
       ORDER BY e.employee_code ASC`
    )
    .all(...(branchId ? [branchId] : [])) as Array<Record<string, unknown>>;

  const canSeeSalary =
    req.user!.roles.includes('super_admin') ||
    req.user!.roles.includes('hr_admin') ||
    req.user!.roles.includes('manager');

  const filtered = rows
    .filter((r) => {
      if (status && status !== 'all' && r.status !== status) return false;
      if (q) {
        const hay = `${r.full_name} ${r.employee_code} ${r.designation} ${r.department_name} ${r.branch_name} ${r.email}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .map((r) => ({
      ...r,
      bank_account_masked: maskBankAccount(r.bank_account_number as string | null),
      bank_account_number: undefined,
      annual_salary: canSeeSalary || r.id === req.user?.employeeId ? r.annual_salary : null,
    }));

  res.json({ employees: filtered });
});

coreRouter.get('/employees/:id', requirePermission('employees.view'), (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const emp = db
    .prepare(
      `SELECT e.*, b.name as branch_name, b.city as branch_city, b.timezone, b.state_tax_rate,
              d.name as department_name, m.full_name as manager_name
       FROM employees e
       JOIN branches b ON b.id = e.branch_id
       JOIN departments d ON d.id = e.department_id
       LEFT JOIN employees m ON m.id = e.manager_id
       WHERE e.id = ?`
    )
    .get(id) as Record<string, unknown> | undefined;

  if (!emp) {
    res.status(404).json({ error: 'Employee not found.' });
    return;
  }

  const payslips = db
    .prepare(
      `SELECT ps.*, pr.run_code, pr.period_start, pr.period_end, pr.status as payroll_status
       FROM payslips ps JOIN payrolls pr ON pr.id = ps.payroll_id
       WHERE ps.employee_id = ? ORDER BY ps.id DESC LIMIT 6`
    )
    .all(id);
  const enrollments = db
    .prepare(
      `SELECT be.*, b.name as benefit_name, b.category, b.provider, b.tax_treatment, b.employee_monthly_cost, b.employer_monthly_cost
       FROM benefit_enrollments be JOIN benefits b ON b.id = be.benefit_id
       WHERE be.employee_id = ?`
    )
    .all(id);
  const assets = db.prepare('SELECT * FROM assets WHERE assigned_employee_id = ?').all(id);
  const directReports = db
    .prepare('SELECT id, employee_code, full_name, designation, status FROM employees WHERE manager_id = ?')
    .all(id);

  const canSeeComp =
    req.user!.roles.includes('super_admin') ||
    req.user!.roles.includes('hr_admin') ||
    req.user!.employeeId === id;

  res.json({
    employee: {
      ...emp,
      bank_account_masked: maskBankAccount(emp.bank_account_number as string | null),
      bank_account_number: undefined,
      annual_salary: canSeeComp ? emp.annual_salary : null,
    },
    payslips: canSeeComp ? payslips : [],
    enrollments,
    assets,
    directReports,
  });
});

coreRouter.post('/employees', requirePermission('employees.manage'), async (req: AuthedRequest, res) => {
  const schema = z.object({
    fullName: z.string().min(2).max(120),
    email: z.string().email(),
    phone: z.string().max(40).optional().default(''),
    branchId: z.number().int().positive(),
    departmentId: z.number().int().positive(),
    managerId: z.number().int().positive().nullable().optional(),
    designation: z.string().min(2).max(100),
    employmentType: z.enum(['full_time', 'contractor', 'part_time']).default('full_time'),
    hireDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    annualSalary: z.number().min(10000).max(2_000_000),
    preTax401kPct: z.number().min(0).max(25).default(4),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Please complete all required employee fields accurately.' });
    return;
  }

  const d = parsed.data;
  const maxId = (db.prepare('SELECT COALESCE(MAX(id), 1000) as m FROM employees').get() as { m: number }).m;
  const employeeCode = `NX-${1001 + maxId}`;
  const now = new Date().toISOString();

  try {
    const info = db
      .prepare(
        `INSERT INTO employees (
          branch_id, department_id, manager_id, employee_code, full_name, email, phone,
          designation, employment_type, hire_date, annual_salary, pre_tax_401k_pct, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`
      )
      .run(
        d.branchId,
        d.departmentId,
        d.managerId ?? null,
        employeeCode,
        d.fullName,
        d.email.toLowerCase(),
        d.phone,
        d.designation,
        d.employmentType,
        d.hireDate,
        d.annualSalary,
        d.preTax401kPct,
        now
      );
    const newId = Number(info.lastInsertRowid);

    // Auto-create standard enterprise onboarding tasks
    const due = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const insertTask = db.prepare(
      'INSERT INTO onboarding_tasks (employee_id, title, owner_role, due_date, is_completed) VALUES (?, ?, ?, ?, 0)'
    );
    insertTask.run(newId, 'Verify Government ID & Tax Withholding Forms', 'hr_admin', due);
    insertTask.run(newId, 'Allocate Workstation Asset & Provision MFA Security Key', 'it_ops', due);
    insertTask.run(newId, 'Acknowledge Information Security & Code of Ethics Policies', 'employee', due);

    recordAuditLog({
      user: req.user,
      action: 'employee.hired',
      resource: 'employees',
      resourceId: newId,
      after: { employeeCode, fullName: d.fullName, branchId: d.branchId, designation: d.designation },
      ipAddress: req.ip,
    });

    // Evaluate custom workflows & dispatch webhooks
    const rules = loadWorkflowRules();
    const resolved = evaluateWorkflowRules(rules, { triggerEvent: 'employee.hired', branchId: d.branchId });
    for (const evt of resolved.webhookEvents) {
      await dispatchWebhookEvent(evt, { employeeId: newId, employeeCode, fullName: d.fullName, branchId: d.branchId });
    }

    res.status(201).json({ id: newId, employeeCode });
  } catch {
    res.status(409).json({ error: 'An employee with this email already exists.' });
  }
});

coreRouter.put('/employees/:id', requirePermission('employees.manage'), (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM employees WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Employee not found.' });
    return;
  }

  const schema = z.object({
    designation: z.string().min(2).max(100).optional(),
    branchId: z.number().int().positive().optional(),
    departmentId: z.number().int().positive().optional(),
    annualSalary: z.number().min(10000).max(2_000_000).optional(),
    status: z.enum(['active', 'on_leave', 'terminated']).optional(),
    preTax401kPct: z.number().min(0).max(25).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid employee update payload.' });
    return;
  }

  const u = parsed.data;
  const termDate = u.status === 'terminated' ? new Date().toISOString().slice(0, 10) : (existing.termination_date as string | null);

  db.prepare(
    `UPDATE employees
     SET designation = ?, branch_id = ?, department_id = ?, annual_salary = ?, status = ?, pre_tax_401k_pct = ?, termination_date = ?
     WHERE id = ?`
  ).run(
    u.designation ?? String(existing.designation),
    u.branchId ?? Number(existing.branch_id),
    u.departmentId ?? Number(existing.department_id),
    u.annualSalary ?? Number(existing.annual_salary),
    u.status ?? String(existing.status),
    u.preTax401kPct ?? Number(existing.pre_tax_401k_pct),
    termDate,
    id
  );

  recordAuditLog({
    user: req.user,
    action: u.annualSalary && u.annualSalary !== existing.annual_salary ? 'employee.salary_changed' : 'employee.updated',
    resource: 'employees',
    resourceId: id,
    before: { designation: existing.designation, annualSalary: existing.annual_salary, status: existing.status },
    after: u,
    ipAddress: req.ip,
  });

  res.json({ ok: true });
});

// Org Chart Tree
coreRouter.get('/org-chart', (_req, res) => {
  const nodes = db
    .prepare(
      `SELECT e.id, e.employee_code, e.full_name, e.designation, e.manager_id, e.avatar_url, e.status,
              b.name as branch_name, b.code as branch_code, d.name as department_name
       FROM employees e
       JOIN branches b ON b.id = e.branch_id
       JOIN departments d ON d.id = e.department_id
       WHERE e.status != 'terminated'
       ORDER BY e.manager_id ASC NULLS FIRST, e.id ASC`
    )
    .all();
  res.json({ nodes });
});

// ---------------------------------------------------------------------------
// Onboarding & Exit Offboarding Clearances
// ---------------------------------------------------------------------------
coreRouter.get('/lifecycle', (req, res) => {
  const branchId = req.query.branchId ? Number(req.query.branchId) : null;
  const onboarding = db
    .prepare(
      `SELECT t.*, e.full_name as employee_name, e.employee_code, e.hire_date, b.name as branch_name
       FROM onboarding_tasks t
       JOIN employees e ON e.id = t.employee_id
       JOIN branches b ON b.id = e.branch_id
       ${branchId ? 'WHERE e.branch_id = ?' : ''}
       ORDER BY t.is_completed ASC, t.due_date ASC`
    )
    .all(...(branchId ? [branchId] : []));

  const exits = db
    .prepare(
      `SELECT x.*, e.full_name as employee_name, e.employee_code, e.designation, b.name as branch_name
       FROM exit_requests x
       JOIN employees e ON e.id = x.employee_id
       JOIN branches b ON b.id = e.branch_id
       ${branchId ? 'WHERE e.branch_id = ?' : ''}
       ORDER BY x.id DESC`
    )
    .all(...(branchId ? [branchId] : []));

  res.json({ onboarding, exits });
});

coreRouter.post('/onboarding/:id/toggle', requirePermission('employees.manage'), (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const task = db.prepare('SELECT * FROM onboarding_tasks WHERE id = ?').get(id) as { is_completed: number; title: string } | undefined;
  if (!task) {
    res.status(404).json({ error: 'Onboarding task not found.' });
    return;
  }
  const next = task.is_completed ? 0 : 1;
  db.prepare('UPDATE onboarding_tasks SET is_completed = ? WHERE id = ?').run(next, id);
  recordAuditLog({
    user: req.user,
    action: 'onboarding.task_toggled',
    resource: 'onboarding_tasks',
    resourceId: id,
    after: { title: task.title, completed: Boolean(next) },
    ipAddress: req.ip,
  });
  res.json({ ok: true, isCompleted: Boolean(next) });
});

coreRouter.post('/exits', requirePermission('employees.manage'), (req: AuthedRequest, res) => {
  const schema = z.object({
    employeeId: z.number().int().positive(),
    lastWorkingDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reason: z.string().min(3).max(300),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid exit request data.' });
    return;
  }
  const info = db
    .prepare(
      `INSERT INTO exit_requests (employee_id, last_working_day, reason, status, created_at)
       VALUES (?, ?, ?, 'in_clearance', ?)`
    )
    .run(parsed.data.employeeId, parsed.data.lastWorkingDay, parsed.data.reason, new Date().toISOString());
  recordAuditLog({
    user: req.user,
    action: 'exit.initiated',
    resource: 'exit_requests',
    resourceId: Number(info.lastInsertRowid),
    after: parsed.data,
    ipAddress: req.ip,
  });
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

coreRouter.post('/exits/:id/clear', requirePermission('employees.manage'), (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const schema = z.object({ department: z.enum(['it', 'finance', 'hr']) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid clearance department.' });
    return;
  }
  const col = parsed.data.department === 'it' ? 'it_cleared' : parsed.data.department === 'finance' ? 'finance_cleared' : 'hr_cleared';
  db.prepare(`UPDATE exit_requests SET ${col} = 1 WHERE id = ?`).run(id);
  const row = db.prepare('SELECT * FROM exit_requests WHERE id = ?').get(id) as
    | { it_cleared: number; finance_cleared: number; hr_cleared: number }
    | undefined;
  if (row && row.it_cleared && row.finance_cleared && row.hr_cleared) {
    db.prepare("UPDATE exit_requests SET status = 'completed' WHERE id = ?").run(id);
  }
  recordAuditLog({
    user: req.user,
    action: 'exit.department_cleared',
    resource: 'exit_requests',
    resourceId: id,
    after: { department: parsed.data.department },
    ipAddress: req.ip,
  });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Company Settings & Multi-Branch Holidays
// ---------------------------------------------------------------------------
coreRouter.get('/settings', (_req, res) => {
  const rows = db.prepare('SELECT key, value, category FROM company_settings').all() as Array<{
    key: string;
    value: string;
    category: string;
  }>;
  const settings: Record<string, string> = {};
  for (const r of rows) settings[r.key] = r.value;
  const holidays = db
    .prepare(
      `SELECT h.*, b.name as branch_name
       FROM holidays h LEFT JOIN branches b ON b.id = h.branch_id
       ORDER BY h.holiday_date ASC`
    )
    .all();
  res.json({ settings, holidays });
});

coreRouter.put('/settings', requirePermission('security.manage'), (req: AuthedRequest, res) => {
  const schema = z.record(z.string(), z.string().max(300));
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid settings payload.' });
    return;
  }
  const now = new Date().toISOString();
  const upsert = db.prepare(
    `INSERT INTO company_settings (key, value, category, updated_at) VALUES (?, ?, 'general', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  );
  for (const [k, v] of Object.entries(parsed.data)) {
    if (k === 'admin_claimed') continue;
    upsert.run(k, v, now);
  }
  recordAuditLog({
    user: req.user,
    action: 'settings.updated',
    resource: 'company_settings',
    after: parsed.data,
    ipAddress: req.ip,
  });
  res.json({ ok: true });
});

coreRouter.post('/holidays', requirePermission('branches.manage'), (req: AuthedRequest, res) => {
  const schema = z.object({
    branchId: z.number().int().positive().nullable().optional(),
    name: z.string().min(2).max(100),
    holidayDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid holiday data.' });
    return;
  }
  const info = db
    .prepare('INSERT INTO holidays (branch_id, name, holiday_date, is_recurring) VALUES (?, ?, ?, 1)')
    .run(parsed.data.branchId ?? null, parsed.data.name, parsed.data.holidayDate);
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

export function loadWorkflowRules(): WorkflowRule[] {
  const rows = db.prepare('SELECT * FROM workflow_rules').all() as Array<{
    id: number;
    name: string;
    trigger_event: WorkflowRule['triggerEvent'];
    branch_id: number | null;
    condition_field: WorkflowRule['conditionField'];
    condition_operator: WorkflowRule['conditionOperator'];
    condition_value: number;
    approver_roles_json: string;
    webhook_event: string | null;
    is_active: number;
  }>;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    triggerEvent: r.trigger_event,
    branchId: r.branch_id,
    conditionField: r.condition_field,
    conditionOperator: r.condition_operator,
    conditionValue: r.condition_value,
    approverRoles: JSON.parse(r.approver_roles_json) as string[],
    webhookEvent: r.webhook_event,
    isActive: Boolean(r.is_active),
  }));
}
