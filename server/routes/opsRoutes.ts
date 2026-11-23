import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { evaluateWorkflowRules } from '../domain/index';
import { type AuthedRequest, recordAuditLog, requireAuth, requirePermission } from '../middleware/auth';
import { dispatchWebhookEvent } from '../services/webhookService';
import { loadWorkflowRules } from './coreRoutes';

export const opsRouter = Router();
opsRouter.use(requireAuth);

// ---------------------------------------------------------------------------
// Unified Workplace Operations (Assets, Policies, Expenses, Loans, Help Desk)
// ---------------------------------------------------------------------------
opsRouter.get('/operations', async (req: AuthedRequest, res) => {
  const branchId = req.query.branchId ? Number(req.query.branchId) : null;
  const canManage =
    req.user!.roles.includes('super_admin') ||
    req.user!.roles.includes('hr_admin') ||
    req.user!.roles.includes('manager');

  const assets = await db
    .prepare(
      `SELECT a.*, b.name as branch_name, e.full_name as assigned_employee_name, e.employee_code
       FROM assets a
       JOIN branches b ON b.id = a.branch_id
       LEFT JOIN employees e ON e.id = a.assigned_employee_id
       ${branchId ? 'WHERE a.branch_id = ?' : ''}
       ORDER BY a.id DESC`
    )
    .all(...(branchId ? [branchId] : []));

  const empId = req.user!.employeeId ?? -1;
  const policies = await db
    .prepare(
      `SELECT cp.*,
              (SELECT COUNT(*) FROM policy_acknowledgements pa WHERE pa.policy_id = cp.id) as ack_count,
              (SELECT COUNT(*) FROM employees WHERE status = 'active') as total_active_employees,
              EXISTS(SELECT 1 FROM policy_acknowledgements pa WHERE pa.policy_id = cp.id AND pa.employee_id = ?) as acknowledged_by_me
       FROM company_policies cp
       ORDER BY cp.id DESC`
    )
    .all(empId);

  const expenses = await db
    .prepare(
      `SELECT x.*, e.full_name as employee_name, e.employee_code, b.name as branch_name
       FROM expenses x
       JOIN employees e ON e.id = x.employee_id
       JOIN branches b ON b.id = x.branch_id
       WHERE 1=1
       ${branchId ? 'AND x.branch_id = ?' : ''}
       ${canManage ? '' : 'AND x.employee_id = ?'}
       ORDER BY x.id DESC`
    )
    .all(...[...(branchId ? [branchId] : []), ...(canManage ? [] : [empId])]);

  const loans = await db
    .prepare(
      `SELECT l.*, e.full_name as employee_name, e.employee_code, b.name as branch_name
       FROM loans l
       JOIN employees e ON e.id = l.employee_id
       JOIN branches b ON b.id = e.branch_id
       WHERE 1=1
       ${branchId ? 'AND e.branch_id = ?' : ''}
       ${canManage ? '' : 'AND l.employee_id = ?'}
       ORDER BY l.id DESC`
    )
    .all(...[...(branchId ? [branchId] : []), ...(canManage ? [] : [empId])]);

  const tickets = await db
    .prepare(
      `SELECT t.*, e.full_name as employee_name, e.employee_code,
              (SELECT COUNT(*) FROM ticket_comments tc WHERE tc.ticket_id = t.id) as comment_count
       FROM tickets t
       JOIN employees e ON e.id = t.employee_id
       ${canManage ? '' : 'WHERE t.employee_id = ?'}
       ORDER BY t.id DESC`
    )
    .all(...(canManage ? [] : [empId]));

  res.json({ assets, policies, expenses, loans, tickets });
});

// Assets
opsRouter.post('/assets', requirePermission('ops.manage'), async (req: AuthedRequest, res) => {
  const schema = z.object({
    assetTag: z.string().min(3).max(40),
    category: z.string().min(2).max(60),
    name: z.string().min(2).max(120),
    serialNumber: z.string().min(3).max(80),
    branchId: z.number().int().positive(),
    cost: z.number().min(0),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid asset details.' });
    return;
  }
  const d = parsed.data;
  try {
    const info = await db
      .prepare(
        `INSERT INTO assets (asset_tag, category, name, serial_number, branch_id, cost, purchase_date, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'available')`
      )
      .run(d.assetTag.toUpperCase(), d.category, d.name, d.serialNumber, d.branchId, d.cost, new Date().toISOString().slice(0, 10));
    await recordAuditLog({
      user: req.user,
      action: 'asset.created',
      resource: 'assets',
      resourceId: Number(info.lastInsertRowid),
      after: d,
      ipAddress: req.ip,
    });
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  } catch {
    res.status(409).json({ error: 'Asset tag already exists.' });
  }
});

opsRouter.post('/assets/:id/assign', requirePermission('ops.manage'), async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const schema = z.object({ employeeId: z.number().int().positive().nullable() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid employee selection.' });
    return;
  }
  const empId = parsed.data.employeeId;
  await db
    .prepare('UPDATE assets SET assigned_employee_id = ?, status = ? WHERE id = ?')
    .run(empId, empId ? 'assigned' : 'available', id);
  await recordAuditLog({
    user: req.user,
    action: empId ? 'asset.assigned' : 'asset.returned',
    resource: 'assets',
    resourceId: id,
    after: { employeeId: empId },
    ipAddress: req.ip,
  });
  res.json({ ok: true });
});

// Policies (standard ON CONFLICT works identically in PostgreSQL and SQLite)
opsRouter.post('/policies/:id/acknowledge', async (req: AuthedRequest, res) => {
  const policyId = Number(req.params.id);
  const empId = req.user!.employeeId;
  if (!empId) {
    res.status(400).json({ error: 'No employee profile linked.' });
    return;
  }
  await db
    .prepare(
      `INSERT INTO policy_acknowledgements (policy_id, employee_id, acknowledged_at)
       VALUES (?, ?, ?)
       ON CONFLICT (policy_id, employee_id) DO UPDATE SET acknowledged_at = excluded.acknowledged_at`
    )
    .run(policyId, empId, new Date().toISOString());
  await recordAuditLog({
    user: req.user,
    action: 'policy.acknowledged',
    resource: 'company_policies',
    resourceId: policyId,
    ipAddress: req.ip,
  });
  res.json({ ok: true });
});

// Expenses (Workflow-Driven)
opsRouter.post('/expenses', requirePermission('ops.self'), async (req: AuthedRequest, res) => {
  const schema = z.object({
    category: z.string().min(2).max(80),
    amount: z.number().positive().max(50000),
    claimDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    description: z.string().min(4).max(400),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Provide valid category, amount, date, and description.' });
    return;
  }
  const empId = req.user!.employeeId ?? 1;
  const branchId = req.user!.branchId ?? 1;
  const rules = await loadWorkflowRules();
  const resolved = evaluateWorkflowRules(rules, {
    triggerEvent: 'expense.submitted',
    branchId,
    amount: parsed.data.amount,
  });

  const info = await db
    .prepare(
      `INSERT INTO expenses (employee_id, branch_id, category, amount, claim_date, description, status, approval_chain_json, current_step, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, 0, ?)`
    )
    .run(
      empId,
      branchId,
      parsed.data.category,
      parsed.data.amount,
      parsed.data.claimDate,
      parsed.data.description,
      JSON.stringify(resolved.requiredApprovalSteps),
      new Date().toISOString()
    );

  const expId = Number(info.lastInsertRowid);
  await recordAuditLog({
    user: req.user,
    action: 'expense.submitted',
    resource: 'expenses',
    resourceId: expId,
    after: { ...parsed.data, approvalChain: resolved.requiredApprovalSteps },
    ipAddress: req.ip,
  });
  for (const evt of resolved.webhookEvents) {
    await dispatchWebhookEvent(evt, { expenseId: expId, amount: parsed.data.amount, category: parsed.data.category });
  }
  res.status(201).json({ id: expId, approvalChain: resolved.requiredApprovalSteps });
});

opsRouter.post('/expenses/:id/decision', requirePermission('ops.manage'), async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const schema = z.object({ decision: z.enum(['approve', 'reject']) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid decision.' });
    return;
  }
  const row = await db
    .prepare('SELECT * FROM expenses WHERE id = ?')
    .get<{ id: number; amount: number; approval_chain_json: string; current_step: number; status: string }>(id);
  if (!row || row.status !== 'pending') {
    res.status(404).json({ error: 'Pending expense not found.' });
    return;
  }
  if (parsed.data.decision === 'reject') {
    await db.prepare("UPDATE expenses SET status = 'rejected' WHERE id = ?").run(id);
    await recordAuditLog({ user: req.user, action: 'expense.rejected', resource: 'expenses', resourceId: id, ipAddress: req.ip });
    res.json({ ok: true, status: 'rejected' });
    return;
  }
  const chain = JSON.parse(row.approval_chain_json) as string[];
  const nextStep = req.user!.roles.includes('super_admin') ? chain.length : row.current_step + 1;
  const finalStatus = nextStep >= chain.length ? 'approved' : 'pending';
  await db.prepare('UPDATE expenses SET status = ?, current_step = ? WHERE id = ?').run(finalStatus, nextStep, id);
  await recordAuditLog({
    user: req.user,
    action: finalStatus === 'approved' ? 'expense.approved' : 'expense.step_approved',
    resource: 'expenses',
    resourceId: id,
    after: { status: finalStatus, step: nextStep },
    ipAddress: req.ip,
  });
  if (finalStatus === 'approved') {
    await dispatchWebhookEvent('expense.approved', { expenseId: id, amount: row.amount, approvedBy: req.user!.fullName });
  }
  res.json({ ok: true, status: finalStatus });
});

// Loans
opsRouter.post('/loans', requirePermission('ops.self'), async (req: AuthedRequest, res) => {
  const schema = z.object({
    principalAmount: z.number().min(200).max(25000),
    termMonths: z.number().int().min(3).max(36),
    purpose: z.string().min(4).max(250),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid loan request.' });
    return;
  }
  const empId = req.user!.employeeId ?? 1;
  const rate = 3.0;
  const totalRepayable = Math.round(parsed.data.principalAmount * (1 + (rate / 100) * (parsed.data.termMonths / 12)) * 100) / 100;
  const monthly = Math.round((totalRepayable / parsed.data.termMonths) * 100) / 100;
  const info = await db
    .prepare(
      `INSERT INTO loans (employee_id, principal_amount, interest_rate, term_months, monthly_installment, remaining_balance, purpose, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
    )
    .run(empId, parsed.data.principalAmount, rate, parsed.data.termMonths, monthly, totalRepayable, parsed.data.purpose, new Date().toISOString());
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

opsRouter.post('/loans/:id/approve', requirePermission('ops.manage'), async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  await db.prepare("UPDATE loans SET status = 'active' WHERE id = ? AND status = 'pending'").run(id);
  await recordAuditLog({ user: req.user, action: 'loan.approved', resource: 'loans', resourceId: id, ipAddress: req.ip });
  res.json({ ok: true });
});

// Help Desk Tickets & Comments
opsRouter.post('/tickets', requirePermission('ops.self'), async (req: AuthedRequest, res) => {
  const schema = z.object({
    department: z.enum(['Payroll', 'IT & Security', 'Benefits', 'People Ops']),
    subject: z.string().min(4).max(160),
    description: z.string().min(6).max(1000),
    priority: z.enum(['low', 'medium', 'high']).default('medium'),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid help desk ticket details.' });
    return;
  }
  const num = `HD-2026-${Math.floor(200 + Math.random() * 799)}`;
  const empId = req.user!.employeeId ?? 1;
  const info = await db
    .prepare(
      `INSERT INTO tickets (ticket_number, employee_id, department, subject, description, priority, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`
    )
    .run(num, empId, parsed.data.department, parsed.data.subject, parsed.data.description, parsed.data.priority, new Date().toISOString());
  res.status(201).json({ id: Number(info.lastInsertRowid), ticketNumber: num });
});

opsRouter.get('/tickets/:id/comments', async (req, res) => {
  const comments = await db
    .prepare('SELECT * FROM ticket_comments WHERE ticket_id = ? ORDER BY id ASC')
    .all(Number(req.params.id));
  res.json({ comments });
});

opsRouter.post('/tickets/:id/comments', async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const schema = z.object({ comment: z.string().min(2).max(800), status: z.enum(['open', 'in_progress', 'resolved']).optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Comment cannot be empty.' });
    return;
  }
  await db
    .prepare('INSERT INTO ticket_comments (ticket_id, author_name, comment, created_at) VALUES (?, ?, ?, ?)')
    .run(id, req.user!.fullName, parsed.data.comment, new Date().toISOString());
  if (parsed.data.status) {
    await db.prepare('UPDATE tickets SET status = ? WHERE id = ?').run(parsed.data.status, id);
  }
  res.status(201).json({ ok: true });
});

// ---------------------------------------------------------------------------
// Executive Analytics Workbench & Custom Approval Workflow Builder
// ---------------------------------------------------------------------------
opsRouter.get('/analytics', requirePermission('analytics.view'), async (req, res) => {
  const branchId = req.query.branchId ? Number(req.query.branchId) : null;
  const branchWhere = branchId ? 'AND e.branch_id = ?' : '';
  const params = branchId ? [branchId] : [];

  const branchMetricsRaw = await db
    .prepare(
      `SELECT b.id, b.name, b.code, b.city, b.state_tax_rate,
              COUNT(e.id) as headcount,
              AVG(e.annual_salary) as avg_salary,
              COALESCE(SUM(e.annual_salary), 0) as total_annual_comp
       FROM branches b
       LEFT JOIN employees e ON e.branch_id = b.id AND e.status = 'active'
       GROUP BY b.id ORDER BY total_annual_comp DESC`
    )
    .all<Record<string, unknown>>();

  const branchMetrics = branchMetricsRaw.map((r) => ({
    ...r,
    avg_salary: r.avg_salary ? Math.round(Number(r.avg_salary)) : 0,
  }));

  const departmentCost = await db
    .prepare(
      `SELECT d.name, b.code as branch_code, COUNT(e.id) as headcount,
              COALESCE(SUM(e.annual_salary), 0) as annual_comp, d.budget
       FROM departments d
       JOIN branches b ON b.id = d.branch_id
       LEFT JOIN employees e ON e.department_id = d.id AND e.status = 'active'
       ${branchId ? 'WHERE d.branch_id = ?' : ''}
       GROUP BY d.id, b.id ORDER BY annual_comp DESC`
    )
    .all(...params);

  const salaryBands = await db
    .prepare(
      `SELECT
         CASE
           WHEN annual_salary < 130000 THEN '$100k–$130k'
           WHEN annual_salary < 160000 THEN '$130k–$160k'
           WHEN annual_salary < 185000 THEN '$160k–$185k'
           ELSE '$185k+'
         END as band,
         COUNT(*) as count
       FROM employees e WHERE e.status = 'active' ${branchWhere}
       GROUP BY band`
    )
    .all(...params);

  const overtimeRaw = await db
    .prepare(
      `SELECT b.name as branch_name, COALESCE(SUM(a.worked_hours), 0) as worked_hours,
              COALESCE(SUM(a.overtime_hours), 0) as overtime_hours
       FROM attendances a JOIN branches b ON b.id = a.branch_id
       GROUP BY b.id`
    )
    .all<{ branch_name: string; worked_hours: number; overtime_hours: number }>();

  const overtimeByBranch = overtimeRaw.map((r) => ({
    branch_name: r.branch_name,
    worked_hours: Math.round(Number(r.worked_hours) * 10) / 10,
    overtime_hours: Math.round(Number(r.overtime_hours) * 10) / 10,
  }));

  const leaveByType = await db
    .prepare(
      `SELECT leave_type, COUNT(*) as requests, COALESCE(SUM(days), 0) as total_days
       FROM leave_requests GROUP BY leave_type`
    )
    .all();

  const complianceSummary = {
    totalPolicies: (await db.prepare('SELECT COUNT(*) as c FROM company_policies').get<{ c: number }>())?.c ?? 0,
    totalAcks: (await db.prepare('SELECT COUNT(*) as c FROM policy_acknowledgements').get<{ c: number }>())?.c ?? 0,
    activeEmployees: (await db.prepare("SELECT COUNT(*) as c FROM employees WHERE status = 'active'").get<{ c: number }>())?.c ?? 0,
    mfaEnrolled: (await db.prepare('SELECT COUNT(*) as c FROM users WHERE mfa_enabled = 1').get<{ c: number }>())?.c ?? 0,
    totalUsers: (await db.prepare('SELECT COUNT(*) as c FROM users').get<{ c: number }>())?.c ?? 0,
  };

  res.json({
    branchMetrics,
    departmentCost,
    salaryBands,
    overtimeByBranch,
    leaveByType,
    complianceSummary,
  });
});

opsRouter.get('/analytics/export', requirePermission('analytics.view'), async (_req, res) => {
  const rows = await db
    .prepare(
      `SELECT e.employee_code, e.full_name, e.designation, b.name as branch, b.cost_center,
              d.name as department, e.hire_date, e.annual_salary, e.status
       FROM employees e
       JOIN branches b ON b.id = e.branch_id
       JOIN departments d ON d.id = e.department_id
       ORDER BY e.employee_code ASC`
    )
    .all<Record<string, unknown>>();

  let csv = 'EmployeeCode,FullName,Designation,Branch,CostCenter,Department,HireDate,AnnualSalaryUSD,Status\n';
  for (const r of rows) {
    csv += `${r.employee_code},"${r.full_name}","${r.designation}","${r.branch}",${r.cost_center},"${r.department}",${r.hire_date},${r.annual_salary},${r.status}\n`;
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="nexus-hrm-workforce-report.csv"');
  res.send(csv);
});

// Custom Workflow Rules CRUD
opsRouter.get('/workflows', async (_req, res) => {
  const rules = await db
    .prepare(
      `SELECT wr.*, b.name as branch_name
       FROM workflow_rules wr LEFT JOIN branches b ON b.id = wr.branch_id
       ORDER BY wr.id DESC`
    )
    .all();
  res.json({ rules });
});

opsRouter.post('/workflows', requirePermission('workflows.manage'), async (req: AuthedRequest, res) => {
  const schema = z.object({
    name: z.string().min(3).max(120),
    triggerEvent: z.enum(['leave.submitted', 'expense.submitted', 'loan.submitted', 'employee.hired', 'payroll.ready']),
    branchId: z.number().int().positive().nullable().optional(),
    conditionField: z.enum(['days', 'amount', 'none']),
    conditionOperator: z.enum(['gt', 'gte', 'lt', 'eq', 'always']),
    conditionValue: z.number().min(0).default(0),
    approverRoles: z.array(z.string()).min(1),
    webhookEvent: z.string().max(60).nullable().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid workflow rule configuration.' });
    return;
  }
  const d = parsed.data;
  const info = await db
    .prepare(
      `INSERT INTO workflow_rules (name, trigger_event, branch_id, condition_field, condition_operator, condition_value, approver_roles_json, webhook_event, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
    )
    .run(
      d.name,
      d.triggerEvent,
      d.branchId ?? null,
      d.conditionField,
      d.conditionOperator,
      d.conditionValue,
      JSON.stringify(d.approverRoles),
      d.webhookEvent ?? null,
      new Date().toISOString()
    );
  await recordAuditLog({
    user: req.user,
    action: 'workflow.rule_created',
    resource: 'workflow_rules',
    resourceId: Number(info.lastInsertRowid),
    after: d,
    ipAddress: req.ip,
  });
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

opsRouter.patch('/workflows/:id/toggle', requirePermission('workflows.manage'), async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const row = await db
    .prepare('SELECT is_active, name FROM workflow_rules WHERE id = ?')
    .get<{ is_active: number; name: string }>(id);
  if (!row) {
    res.status(404).json({ error: 'Workflow rule not found.' });
    return;
  }
  const next = row.is_active ? 0 : 1;
  await db.prepare('UPDATE workflow_rules SET is_active = ? WHERE id = ?').run(next, id);
  await recordAuditLog({
    user: req.user,
    action: 'workflow.rule_toggled',
    resource: 'workflow_rules',
    resourceId: id,
    after: { name: row.name, isActive: Boolean(next) },
    ipAddress: req.ip,
  });
  res.json({ ok: true, isActive: Boolean(next) });
});

// Notifications
opsRouter.get('/notifications', async (req: AuthedRequest, res) => {
  const rows = await db
    .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 20')
    .all(req.user!.id);
  res.json({ notifications: rows });
});

opsRouter.post('/notifications/read-all', async (req: AuthedRequest, res) => {
  await db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user!.id);
  res.json({ ok: true });
});
