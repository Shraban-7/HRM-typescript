import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import {
  calculateLeaveBusinessDays,
  evaluateAttendanceShift,
  evaluateWorkflowRules,
} from '../domain/index';
import { type AuthedRequest, recordAuditLog, requireAuth, requirePermission } from '../middleware/auth';
import { dispatchWebhookEvent } from '../services/webhookService';
import { loadWorkflowRules } from './coreRoutes';

export const workforceRouter = Router();

// ---------------------------------------------------------------------------
// Public Career Portal Routes (Unauthenticated for External Candidates)
// ---------------------------------------------------------------------------
workforceRouter.get('/public/careers', (_req, res) => {
  const jobs = db
    .prepare(
      `SELECT j.*, b.name as branch_name, b.city as branch_city, b.country as branch_country, d.name as department_name
       FROM job_posts j
       JOIN branches b ON b.id = j.branch_id
       JOIN departments d ON d.id = j.department_id
       WHERE j.status = 'open'
       ORDER BY j.id DESC`
    )
    .all();
  res.json({ jobs });
});

workforceRouter.post('/public/careers/:jobId/apply', (req, res) => {
  const jobId = Number(req.params.jobId);
  const job = db.prepare("SELECT id, title FROM job_posts WHERE id = ? AND status = 'open'").get(jobId) as
    | { id: number; title: string }
    | undefined;
  if (!job) {
    res.status(404).json({ error: 'Job posting is no longer open.' });
    return;
  }
  const schema = z.object({
    fullName: z.string().min(2).max(120),
    email: z.string().email(),
    phone: z.string().max(40).optional().default(''),
    notes: z.string().max(1000).optional().default(''),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Please provide your full name and valid email address.' });
    return;
  }
  const info = db
    .prepare(
      `INSERT INTO applicants (job_post_id, full_name, email, phone, source, stage, rating, notes, created_at)
       VALUES (?, ?, ?, ?, 'Career Portal', 'applied', 4, ?, ?)`
    )
    .run(jobId, parsed.data.fullName, parsed.data.email, parsed.data.phone, parsed.data.notes, new Date().toISOString());

  recordAuditLog({
    action: 'recruitment.public_application',
    resource: 'applicants',
    resourceId: Number(info.lastInsertRowid),
    after: { jobTitle: job.title, candidate: parsed.data.fullName },
    ipAddress: req.ip,
  });

  res.status(201).json({ id: Number(info.lastInsertRowid), message: 'Application submitted successfully.' });
});

// All remaining workforce routes require auth
workforceRouter.use(requireAuth);

// ---------------------------------------------------------------------------
// Attendance, Clock In/Out & Shifts
// ---------------------------------------------------------------------------
workforceRouter.get('/attendance', (req: AuthedRequest, res) => {
  const branchId = req.query.branchId ? Number(req.query.branchId) : null;
  const canViewAll =
    req.user!.roles.includes('super_admin') ||
    req.user!.roles.includes('hr_admin') ||
    req.user!.roles.includes('manager');

  const records = db
    .prepare(
      `SELECT a.*, e.employee_code, e.full_name as employee_name, b.name as branch_name, d.name as department_name
       FROM attendances a
       JOIN employees e ON e.id = a.employee_id
       JOIN branches b ON b.id = a.branch_id
       JOIN departments d ON d.id = e.department_id
       WHERE 1=1
       ${branchId ? 'AND a.branch_id = ?' : ''}
       ${canViewAll ? '' : 'AND a.employee_id = ?'}
       ORDER BY a.work_date DESC, a.id DESC LIMIT 100`
    )
    .all(
      ...[
        ...(branchId ? [branchId] : []),
        ...(canViewAll ? [] : [req.user!.employeeId ?? -1]),
      ]
    );

  const shifts = db
    .prepare(
      `SELECT s.*, b.name as branch_name
       FROM shifts s LEFT JOIN branches b ON b.id = s.branch_id
       ORDER BY s.id ASC`
    )
    .all();

  const myToday = req.user!.employeeId
    ? db
        .prepare("SELECT * FROM attendances WHERE employee_id = ? AND work_date = '2026-11-23'")
        .get(req.user!.employeeId)
    : null;

  res.json({ records, shifts, myToday: myToday ?? null });
});

workforceRouter.post('/attendance/clock-in', requirePermission('attendance.self'), (req: AuthedRequest, res) => {
  const empId = req.user!.employeeId;
  const branchId = req.user!.branchId ?? 1;
  if (!empId) {
    res.status(400).json({ error: 'No employee profile linked to this account.' });
    return;
  }
  const workDate = '2026-11-23';
  const nowIso = new Date().toISOString();
  const existing = db
    .prepare('SELECT id FROM attendances WHERE employee_id = ? AND work_date = ?')
    .get(empId, workDate) as { id: number } | undefined;
  if (existing) {
    res.status(409).json({ error: 'Already clocked in for today.' });
    return;
  }

  const evalRes = evaluateAttendanceShift(nowIso, null);
  db.prepare(
    `INSERT INTO attendances (employee_id, branch_id, work_date, clock_in, worked_hours, overtime_hours, status, source)
     VALUES (?, ?, ?, ?, 0, 0, ?, 'web')`
  ).run(empId, branchId, workDate, nowIso, evalRes.status);

  recordAuditLog({
    user: req.user,
    action: 'attendance.clock_in',
    resource: 'attendances',
    resourceId: `${empId}:${workDate}`,
    after: { clockIn: nowIso, status: evalRes.status },
    ipAddress: req.ip,
  });
  res.status(201).json({ ok: true, clockIn: nowIso, status: evalRes.status });
});

workforceRouter.post('/attendance/clock-out', requirePermission('attendance.self'), (req: AuthedRequest, res) => {
  const empId = req.user!.employeeId;
  if (!empId) {
    res.status(400).json({ error: 'No employee profile linked.' });
    return;
  }
  const workDate = '2026-11-23';
  const row = db
    .prepare('SELECT id, clock_in FROM attendances WHERE employee_id = ? AND work_date = ?')
    .get(empId, workDate) as { id: number; clock_in: string } | undefined;
  if (!row) {
    res.status(400).json({ error: 'Please clock in before clocking out.' });
    return;
  }
  const nowIso = new Date().toISOString();
  const evalRes = evaluateAttendanceShift(row.clock_in, nowIso);
  db.prepare('UPDATE attendances SET clock_out = ?, worked_hours = ?, overtime_hours = ?, status = ? WHERE id = ?').run(
    nowIso,
    evalRes.workedHours,
    evalRes.overtimeHours,
    evalRes.status,
    row.id
  );
  recordAuditLog({
    user: req.user,
    action: 'attendance.clock_out',
    resource: 'attendances',
    resourceId: row.id,
    after: evalRes,
    ipAddress: req.ip,
  });
  res.json({ ok: true, ...evalRes, clockOut: nowIso });
});

workforceRouter.post('/shifts', requirePermission('attendance.manage'), (req: AuthedRequest, res) => {
  const schema = z.object({
    branchId: z.number().int().positive().nullable().optional(),
    name: z.string().min(2).max(80),
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    endTime: z.string().regex(/^\d{2}:\d{2}$/),
    standardHours: z.number().min(4).max(12).default(8),
    overtimeMultiplier: z.number().min(1).max(3).default(1.5),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid shift definition.' });
    return;
  }
  const d = parsed.data;
  const info = db
    .prepare(
      'INSERT INTO shifts (branch_id, name, start_time, end_time, standard_hours, overtime_multiplier, grace_minutes) VALUES (?, ?, ?, ?, ?, ?, 15)'
    )
    .run(d.branchId ?? null, d.name, d.startTime, d.endTime, d.standardHours, d.overtimeMultiplier);
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

// ---------------------------------------------------------------------------
// Leave Requests & Workflow-Driven Multi-Step Approval
// ---------------------------------------------------------------------------
workforceRouter.get('/leaves', (req: AuthedRequest, res) => {
  const branchId = req.query.branchId ? Number(req.query.branchId) : null;
  const canViewAll =
    req.user!.roles.includes('super_admin') ||
    req.user!.roles.includes('hr_admin') ||
    req.user!.roles.includes('manager');

  const leaves = db
    .prepare(
      `SELECT l.*, e.employee_code, e.full_name as employee_name, b.name as branch_name, d.name as department_name
       FROM leave_requests l
       JOIN employees e ON e.id = l.employee_id
       JOIN branches b ON b.id = l.branch_id
       JOIN departments d ON d.id = e.department_id
       WHERE 1=1
       ${branchId ? 'AND l.branch_id = ?' : ''}
       ${canViewAll ? '' : 'AND l.employee_id = ?'}
       ORDER BY l.id DESC`
    )
    .all(
      ...[
        ...(branchId ? [branchId] : []),
        ...(canViewAll ? [] : [req.user!.employeeId ?? -1]),
      ]
    );

  // Compute logged-in user's leave balances
  const empId = req.user!.employeeId ?? 1;
  const used = db
    .prepare(
      "SELECT leave_type, COALESCE(SUM(days), 0) as total FROM leave_requests WHERE employee_id = ? AND status = 'approved' GROUP BY leave_type"
    )
    .all(empId) as Array<{ leave_type: string; total: number }>;
  const usedMap: Record<string, number> = {};
  for (const u of used) usedMap[u.leave_type] = u.total;

  res.json({
    leaves,
    balances: {
      annual: { quota: 20, used: usedMap.annual ?? 0, remaining: Math.max(0, 20 - (usedMap.annual ?? 0)) },
      sick: { quota: 14, used: usedMap.sick ?? 0, remaining: Math.max(0, 14 - (usedMap.sick ?? 0)) },
      parental: { quota: 30, used: usedMap.parental ?? 0, remaining: Math.max(0, 30 - (usedMap.parental ?? 0)) },
      unpaid: { quota: 30, used: usedMap.unpaid ?? 0, remaining: Math.max(0, 30 - (usedMap.unpaid ?? 0)) },
    },
  });
});

workforceRouter.post('/leaves', requirePermission('attendance.self'), async (req: AuthedRequest, res) => {
  const schema = z.object({
    leaveType: z.enum(['annual', 'sick', 'parental', 'unpaid']),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reason: z.string().min(3).max(400),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Please enter valid leave dates and reason.' });
    return;
  }

  const empId = req.user!.employeeId;
  const branchId = req.user!.branchId ?? 1;
  if (!empId) {
    res.status(400).json({ error: 'Employee record required to submit leave.' });
    return;
  }

  const holidays = (
    db
      .prepare('SELECT holiday_date FROM holidays WHERE branch_id IS NULL OR branch_id = ?')
      .all(branchId) as Array<{ holiday_date: string }>
  ).map((h) => h.holiday_date);

  const days = calculateLeaveBusinessDays(parsed.data.startDate, parsed.data.endDate, holidays);
  if (days <= 0) {
    res.status(400).json({ error: 'Selected range contains 0 working days.' });
    return;
  }

  const rules = loadWorkflowRules();
  const resolution = evaluateWorkflowRules(rules, {
    triggerEvent: 'leave.submitted',
    branchId,
    days,
  });

  const info = db
    .prepare(
      `INSERT INTO leave_requests (employee_id, branch_id, leave_type, start_date, end_date, days, reason, status, approval_chain_json, current_step, approvals_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, 0, '[]', ?)`
    )
    .run(
      empId,
      branchId,
      parsed.data.leaveType,
      parsed.data.startDate,
      parsed.data.endDate,
      days,
      parsed.data.reason,
      JSON.stringify(resolution.requiredApprovalSteps),
      new Date().toISOString()
    );

  const leaveId = Number(info.lastInsertRowid);
  recordAuditLog({
    user: req.user,
    action: 'leave.submitted',
    resource: 'leave_requests',
    resourceId: leaveId,
    after: { ...parsed.data, days, approvalChain: resolution.requiredApprovalSteps },
    ipAddress: req.ip,
  });

  for (const evt of resolution.webhookEvents) {
    await dispatchWebhookEvent(evt, { leaveId, employeeId: empId, days, leaveType: parsed.data.leaveType });
  }

  res.status(201).json({ id: leaveId, days, approvalChain: resolution.requiredApprovalSteps });
});

workforceRouter.post('/leaves/:id/decision', requirePermission('leave.approve'), async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const schema = z.object({ decision: z.enum(['approve', 'reject']) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid decision.' });
    return;
  }

  const row = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id) as
    | {
        id: number;
        employee_id: number;
        status: string;
        approval_chain_json: string;
        current_step: number;
        approvals_json: string;
      }
    | undefined;
  if (!row || row.status !== 'pending') {
    res.status(404).json({ error: 'Pending leave request not found.' });
    return;
  }

  const chain = JSON.parse(row.approval_chain_json) as string[];
  const approvals = JSON.parse(row.approvals_json) as Array<Record<string, unknown>>;
  const now = new Date().toISOString();

  if (parsed.data.decision === 'reject') {
    db.prepare("UPDATE leave_requests SET status = 'rejected', reviewed_by = ?, reviewed_at = ? WHERE id = ?").run(
      req.user!.id,
      now,
      id
    );
    recordAuditLog({
      user: req.user,
      action: 'leave.rejected',
      resource: 'leave_requests',
      resourceId: id,
      ipAddress: req.ip,
    });
    res.json({ ok: true, status: 'rejected' });
    return;
  }

  approvals.push({
    role: chain[row.current_step] ?? req.user!.roles[0],
    actor: req.user!.fullName,
    at: now,
  });

  // Super Admin can finalize multi-step directly; otherwise advance step
  const nextStep = req.user!.roles.includes('super_admin') ? chain.length : row.current_step + 1;
  const finalStatus = nextStep >= chain.length ? 'approved' : 'pending';

  db.prepare(
    'UPDATE leave_requests SET status = ?, current_step = ?, approvals_json = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?'
  ).run(finalStatus, nextStep, JSON.stringify(approvals), req.user!.id, now, id);

  recordAuditLog({
    user: req.user,
    action: finalStatus === 'approved' ? 'leave.approved' : 'leave.step_approved',
    resource: 'leave_requests',
    resourceId: id,
    after: { status: finalStatus, step: nextStep, totalSteps: chain.length },
    ipAddress: req.ip,
  });

  if (finalStatus === 'approved') {
    await dispatchWebhookEvent('leave.approved', { leaveId: id, employeeId: row.employee_id, approvedBy: req.user!.fullName });
  }

  res.json({ ok: true, status: finalStatus, currentStep: nextStep });
});

// ---------------------------------------------------------------------------
// Recruitment ATS (Jobs, Applicants Pipeline, Interviews, Hire-to-Employee)
// ---------------------------------------------------------------------------
workforceRouter.get('/recruitment', requirePermission('recruitment.view'), (req, res) => {
  const branchId = req.query.branchId ? Number(req.query.branchId) : null;
  const jobs = db
    .prepare(
      `SELECT j.*, b.name as branch_name, d.name as department_name,
              (SELECT COUNT(*) FROM applicants a WHERE a.job_post_id = j.id) as applicant_count
       FROM job_posts j
       JOIN branches b ON b.id = j.branch_id
       JOIN departments d ON d.id = j.department_id
       ${branchId ? 'WHERE j.branch_id = ?' : ''}
       ORDER BY j.id DESC`
    )
    .all(...(branchId ? [branchId] : []));

  const applicants = db
    .prepare(
      `SELECT a.*, j.title as job_title, j.branch_id, j.department_id, b.name as branch_name
       FROM applicants a
       JOIN job_posts j ON j.id = a.job_post_id
       JOIN branches b ON b.id = j.branch_id
       ${branchId ? 'WHERE j.branch_id = ?' : ''}
       ORDER BY a.id DESC`
    )
    .all(...(branchId ? [branchId] : []));

  const interviews = db
    .prepare(
      `SELECT i.*, a.full_name as applicant_name, j.title as job_title
       FROM interviews i
       JOIN applicants a ON a.id = i.applicant_id
       JOIN job_posts j ON j.id = a.job_post_id
       ORDER BY i.scheduled_at ASC`
    )
    .all();

  res.json({ jobs, applicants, interviews });
});

workforceRouter.post('/recruitment/jobs', requirePermission('recruitment.manage'), (req: AuthedRequest, res) => {
  const schema = z.object({
    branchId: z.number().int().positive(),
    departmentId: z.number().int().positive(),
    title: z.string().min(3).max(120),
    salaryRange: z.string().min(3).max(80),
    description: z.string().min(10).max(2000),
    requirements: z.string().min(5).max(2000),
    closingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid job post details.' });
    return;
  }
  const d = parsed.data;
  const info = db
    .prepare(
      `INSERT INTO job_posts (branch_id, department_id, title, employment_type, salary_range, description, requirements, status, closing_date, created_at)
       VALUES (?, ?, ?, 'full_time', ?, ?, ?, 'open', ?, ?)`
    )
    .run(d.branchId, d.departmentId, d.title, d.salaryRange, d.description, d.requirements, d.closingDate, new Date().toISOString());
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

workforceRouter.patch('/recruitment/applicants/:id/stage', requirePermission('recruitment.manage'), (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const schema = z.object({ stage: z.enum(['applied', 'screening', 'interview', 'offer', 'hired', 'rejected']) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid applicant stage.' });
    return;
  }
  db.prepare('UPDATE applicants SET stage = ? WHERE id = ?').run(parsed.data.stage, id);
  recordAuditLog({
    user: req.user,
    action: 'recruitment.stage_updated',
    resource: 'applicants',
    resourceId: id,
    after: { stage: parsed.data.stage },
    ipAddress: req.ip,
  });
  res.json({ ok: true });
});

workforceRouter.post('/recruitment/applicants/:id/hire', requirePermission('recruitment.manage'), (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const appRow = db
    .prepare(
      `SELECT a.*, j.title as job_title, j.branch_id, j.department_id
       FROM applicants a JOIN job_posts j ON j.id = a.job_post_id
       WHERE a.id = ?`
    )
    .get(id) as
    | { id: number; full_name: string; email: string; phone: string | null; job_title: string; branch_id: number; department_id: number }
    | undefined;
  if (!appRow) {
    res.status(404).json({ error: 'Applicant not found.' });
    return;
  }

  const maxId = (db.prepare('SELECT COALESCE(MAX(id), 1000) as m FROM employees').get() as { m: number }).m;
  const employeeCode = `NX-${1001 + maxId}`;
  const today = new Date().toISOString().slice(0, 10);
  const info = db
    .prepare(
      `INSERT INTO employees (branch_id, department_id, employee_code, full_name, email, phone, designation, employment_type, hire_date, annual_salary, pre_tax_401k_pct, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'full_time', ?, 145000, 4.0, 'active', ?)`
    )
    .run(
      appRow.branch_id,
      appRow.department_id,
      employeeCode,
      appRow.full_name,
      appRow.email.toLowerCase(),
      appRow.phone ?? '',
      appRow.job_title,
      today,
      new Date().toISOString()
    );
  db.prepare("UPDATE applicants SET stage = 'hired' WHERE id = ?").run(id);
  recordAuditLog({
    user: req.user,
    action: 'recruitment.candidate_hired',
    resource: 'employees',
    resourceId: Number(info.lastInsertRowid),
    after: { employeeCode, fullName: appRow.full_name, jobTitle: appRow.job_title },
    ipAddress: req.ip,
  });
  res.status(201).json({ employeeId: Number(info.lastInsertRowid), employeeCode });
});

// ---------------------------------------------------------------------------
// Performance Reviews, Calibration, OKR Goals & 360 Feedback
// ---------------------------------------------------------------------------
workforceRouter.get('/performance', requirePermission('performance.view'), (req, res) => {
  const branchId = req.query.branchId ? Number(req.query.branchId) : null;
  const reviews = db
    .prepare(
      `SELECT pr.*, e.employee_code, e.full_name as employee_name, e.designation, e.annual_salary,
              b.name as branch_name, d.name as department_name
       FROM performance_reviews pr
       JOIN employees e ON e.id = pr.employee_id
       JOIN branches b ON b.id = e.branch_id
       JOIN departments d ON d.id = e.department_id
       ${branchId ? 'WHERE e.branch_id = ?' : ''}
       ORDER BY pr.id DESC`
    )
    .all(...(branchId ? [branchId] : []));

  const goals = db
    .prepare(
      `SELECT g.*, e.full_name as employee_name, e.employee_code, b.name as branch_name
       FROM goals g
       JOIN employees e ON e.id = g.employee_id
       JOIN branches b ON b.id = e.branch_id
       ${branchId ? 'WHERE e.branch_id = ?' : ''}
       ORDER BY g.id DESC`
    )
    .all(...(branchId ? [branchId] : []));

  const feedback = db
    .prepare(
      `SELECT f.*, e.full_name as to_employee_name, e.designation
       FROM feedback_entries f JOIN employees e ON e.id = f.to_employee_id
       ORDER BY f.id DESC LIMIT 20`
    )
    .all();

  res.json({ reviews, goals, feedback });
});

workforceRouter.post('/performance/reviews/:id/calibrate', requirePermission('performance.manage'), (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const schema = z.object({ calibratedRating: z.number().min(1).max(5) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Rating must be between 1.0 and 5.0.' });
    return;
  }
  const r = parsed.data.calibratedRating;
  const bonusPct = r >= 4.7 ? 10 : r >= 4.2 ? 6 : r >= 3.5 ? 3 : 0;
  db.prepare("UPDATE performance_reviews SET calibrated_rating = ?, bonus_pct = ?, status = 'calibrated' WHERE id = ?").run(
    r,
    bonusPct,
    id
  );
  recordAuditLog({
    user: req.user,
    action: 'performance.calibrated',
    resource: 'performance_reviews',
    resourceId: id,
    after: { calibratedRating: r, bonusPct },
    ipAddress: req.ip,
  });
  res.json({ ok: true, bonusPct });
});

workforceRouter.post('/performance/goals', requirePermission('performance.view'), (req: AuthedRequest, res) => {
  const schema = z.object({
    employeeId: z.number().int().positive().optional(),
    title: z.string().min(3).max(200),
    category: z.string().min(2).max(60),
    targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid goal fields.' });
    return;
  }
  const empId = parsed.data.employeeId ?? req.user!.employeeId ?? 1;
  const info = db
    .prepare("INSERT INTO goals (employee_id, title, category, progress, target_date, status) VALUES (?, ?, ?, 15, ?, 'in_progress')")
    .run(empId, parsed.data.title, parsed.data.category, parsed.data.targetDate);
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

workforceRouter.patch('/performance/goals/:id', requirePermission('performance.view'), (req, res) => {
  const id = Number(req.params.id);
  const schema = z.object({ progress: z.number().min(0).max(100) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Progress must be 0–100.' });
    return;
  }
  const status = parsed.data.progress >= 100 ? 'completed' : 'in_progress';
  db.prepare('UPDATE goals SET progress = ?, status = ? WHERE id = ?').run(parsed.data.progress, status, id);
  res.json({ ok: true, status });
});

workforceRouter.post('/performance/feedback', requirePermission('performance.view'), (req: AuthedRequest, res) => {
  const schema = z.object({
    toEmployeeId: z.number().int().positive(),
    category: z.enum(['Recognition', 'Leadership', 'Collaboration', 'Growth']),
    message: z.string().min(5).max(600),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Provide a valid feedback message.' });
    return;
  }
  const info = db
    .prepare('INSERT INTO feedback_entries (from_name, to_employee_id, category, message, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(req.user!.fullName, parsed.data.toEmployeeId, parsed.data.category, parsed.data.message, new Date().toISOString());
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});
