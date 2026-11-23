import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import {
  type PayrollEmployeeInput,
  simulatePayrollRun,
  type TaxBracket,
} from '../domain/index';
import { type AuthedRequest, recordAuditLog, requireAuth, requirePermission } from '../middleware/auth';
import { dispatchWebhookEvent } from '../services/webhookService';

export const payrollRouter = Router();
payrollRouter.use(requireAuth);

async function loadTaxBrackets(): Promise<TaxBracket[]> {
  const rows = (await db
    .prepare('SELECT label, min_income, max_income, rate FROM tax_brackets ORDER BY sort_order ASC, min_income ASC')
    .all()) as Array<{ label: string; min_income: number; max_income: number | null; rate: number }>;
  return rows.map((r) => ({
    label: r.label,
    min: r.min_income,
    max: r.max_income,
    rate: r.rate,
  }));
}

async function buildPayrollInputs(
  periodStart: string,
  periodEnd: string,
  branchId: number | null
): Promise<PayrollEmployeeInput[]> {
  const employees = (await db
    .prepare(
      `SELECT e.*, b.name as branch_name, b.state_tax_rate, d.name as department_name
       FROM employees e
       JOIN branches b ON b.id = e.branch_id
       JOIN departments d ON d.id = e.department_id
       WHERE e.status = 'active' ${branchId ? 'AND e.branch_id = ?' : ''}
       ORDER BY e.employee_code ASC`
    )
    .all(...(branchId ? [branchId] : []))) as Array<{
    id: number;
    employee_code: string;
    full_name: string;
    department_name: string;
    branch_id: number;
    branch_name: string;
    state_tax_rate: number;
    annual_salary: number;
    pre_tax_401k_pct: number;
    hire_date: string;
    termination_date: string | null;
  }>;

  const inputs: PayrollEmployeeInput[] = [];

  for (const emp of employees) {
    const preTaxBenRow = (await db
      .prepare(
        `SELECT COALESCE(SUM(b.employee_monthly_cost), 0) as total
         FROM benefit_enrollments be JOIN benefits b ON b.id = be.benefit_id
         WHERE be.employee_id = ? AND be.status = 'active' AND b.tax_treatment = 'pre_tax'`
      )
      .get(emp.id)) as { total: number } | undefined;
    const preTaxBen = Number(preTaxBenRow?.total ?? 0);

    const postTaxBenRow = (await db
      .prepare(
        `SELECT COALESCE(SUM(b.employee_monthly_cost), 0) as total
         FROM benefit_enrollments be JOIN benefits b ON b.id = be.benefit_id
         WHERE be.employee_id = ? AND be.status = 'active' AND b.tax_treatment = 'post_tax'`
      )
      .get(emp.id)) as { total: number } | undefined;
    const postTaxBen = Number(postTaxBenRow?.total ?? 0);

    const monthly401k = Math.round(((emp.annual_salary / 12) * (emp.pre_tax_401k_pct / 100)) * 100) / 100;

    const overtimeRow = (await db
      .prepare(
        `SELECT COALESCE(SUM(overtime_hours), 0) as ot
         FROM attendances WHERE employee_id = ? AND work_date BETWEEN ? AND ?`
      )
      .get(emp.id, periodStart, periodEnd)) as { ot: number } | undefined;
    const overtimeHours = Number(overtimeRow?.ot ?? 0);

    const unpaidRow = (await db
      .prepare(
        `SELECT COALESCE(SUM(days), 0) as d
         FROM leave_requests
         WHERE employee_id = ? AND leave_type = 'unpaid' AND status = 'approved'
         AND start_date <= ? AND end_date >= ?`
      )
      .get(emp.id, periodEnd, periodStart)) as { d: number } | undefined;
    const unpaidDays = Number(unpaidRow?.d ?? 0);

    const approvedExpensesRow = (await db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) as amt
         FROM expenses
         WHERE employee_id = ? AND status = 'approved' AND reimbursed_in_payroll_id IS NULL`
      )
      .get(emp.id)) as { amt: number } | undefined;
    const approvedExpenses = Number(approvedExpensesRow?.amt ?? 0);

    const activeLoan = (await db
      .prepare(
        "SELECT monthly_installment, remaining_balance FROM loans WHERE employee_id = ? AND status = 'active' ORDER BY id ASC LIMIT 1"
      )
      .get(emp.id)) as { monthly_installment: number; remaining_balance: number } | undefined;

    const loanInstallment = activeLoan
      ? Math.min(activeLoan.monthly_installment, activeLoan.remaining_balance)
      : 0;

    const priorSlip = (await db
      .prepare(
        `SELECT ps.net_pay FROM payslips ps
         JOIN payrolls pr ON pr.id = ps.payroll_id
         WHERE ps.employee_id = ? AND pr.status = 'finalized'
         ORDER BY ps.id DESC LIMIT 1`
      )
      .get(emp.id)) as { net_pay: number } | undefined;

    const monthIndex = Math.max(0, Number(periodStart.slice(5, 7)) - 1);
    const ytdGrossPrior = Math.round((emp.annual_salary / 12) * monthIndex * 100) / 100;

    inputs.push({
      employeeId: emp.id,
      employeeCode: emp.employee_code,
      employeeName: emp.full_name,
      departmentName: emp.department_name,
      branchId: emp.branch_id,
      branchName: emp.branch_name,
      branchStateTaxRate: emp.state_tax_rate,
      annualSalary: emp.annual_salary,
      hireDate: emp.hire_date,
      terminationDate: emp.termination_date,
      ytdGrossPrior,
      preTaxBenefitsMonthly: preTaxBen + monthly401k,
      postTaxDeductionsMonthly: postTaxBen,
      overtimeHours,
      unpaidLeaveDays: unpaidDays,
      bonusAmount: 0,
      expenseReimbursement: approvedExpenses,
      loanInstallment,
      priorPeriodNet: priorSlip?.net_pay ?? null,
    });
  }

  return inputs;
}

// List payroll runs + tax brackets
payrollRouter.get('/payrolls', requirePermission('payroll.view'), async (req: AuthedRequest, res) => {
  const branchId = req.query.branchId ? Number(req.query.branchId) : null;
  const runs = await db
    .prepare(
      `SELECT p.*, b.name as branch_name, u.full_name as approver_name
       FROM payrolls p
       LEFT JOIN branches b ON b.id = p.branch_id
       LEFT JOIN users u ON u.id = p.approved_by
       ${branchId ? 'WHERE (p.branch_id = ? OR p.branch_id IS NULL)' : ''}
       ORDER BY p.id DESC`
    )
    .all(...(branchId ? [branchId] : []));

  const taxBrackets = await db
    .prepare('SELECT * FROM tax_brackets ORDER BY sort_order ASC, min_income ASC')
    .all();

  res.json({ payrolls: runs, taxBrackets });
});

// Create new Draft payroll run
payrollRouter.post('/payrolls', requirePermission('payroll.run'), async (req: AuthedRequest, res) => {
  const schema = z.object({
    branchId: z.number().int().positive().nullable().optional(),
    periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    payDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Provide valid period start, period end, and pay date.' });
    return;
  }

  const d = parsed.data;
  const suffix = String(Date.now()).slice(-4);
  const runCode = `PR-${d.periodStart.slice(0, 7)}-${suffix}`;
  const info = await db
    .prepare(
      `INSERT INTO payrolls (run_code, branch_id, period_start, period_end, pay_date, status, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)`
    )
    .run(runCode, d.branchId ?? null, d.periodStart, d.periodEnd, d.payDate, req.user!.id, new Date().toISOString());

  await recordAuditLog({
    user: req.user,
    action: 'payroll.created',
    resource: 'payrolls',
    resourceId: Number(info.lastInsertRowid),
    after: { runCode, ...d },
    ipAddress: req.ip,
  });

  res.status(201).json({ id: Number(info.lastInsertRowid), runCode });
});

// View payroll run details & itemized payslips
payrollRouter.get('/payrolls/:id', requirePermission('payroll.view'), async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const payroll = await db
    .prepare(
      `SELECT p.*, b.name as branch_name, u.full_name as approver_name
       FROM payrolls p
       LEFT JOIN branches b ON b.id = p.branch_id
       LEFT JOIN users u ON u.id = p.approved_by
       WHERE p.id = ?`
    )
    .get(id);

  if (!payroll) {
    res.status(404).json({ error: 'Payroll run not found.' });
    return;
  }

  const isPrivileged =
    req.user!.roles.includes('super_admin') || req.user!.roles.includes('hr_admin');

  const payslips = await db
    .prepare(
      `SELECT ps.*, e.employee_code, e.full_name as employee_name, e.designation,
              b.name as branch_name, d.name as department_name
       FROM payslips ps
       JOIN employees e ON e.id = ps.employee_id
       JOIN branches b ON b.id = e.branch_id
       JOIN departments d ON d.id = e.department_id
       WHERE ps.payroll_id = ? ${isPrivileged ? '' : 'AND ps.employee_id = ?'}
       ORDER BY e.employee_code ASC`
    )
    .all(...(isPrivileged ? [id] : [id, req.user!.employeeId ?? -1]));

  res.json({ payroll, payslips });
});

// Stage 1: Dry-Run Simulation with progressive statutory math + variance alerts
payrollRouter.post('/payrolls/:id/simulate', requirePermission('payroll.run'), async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const payroll = (await db.prepare('SELECT * FROM payrolls WHERE id = ?').get(id)) as
    | { id: number; status: string; period_start: string; period_end: string; branch_id: number | null; run_code: string }
    | undefined;

  if (!payroll) {
    res.status(404).json({ error: 'Payroll run not found.' });
    return;
  }
  if (payroll.status === 'finalized') {
    res.status(409).json({ error: 'Finalized payroll runs are locked and immutable.' });
    return;
  }

  const priorRun = (await db
    .prepare("SELECT total_net FROM payrolls WHERE status = 'finalized' AND id != ? ORDER BY id DESC LIMIT 1")
    .get(id)) as { total_net: number } | undefined;

  const inputs = await buildPayrollInputs(payroll.period_start, payroll.period_end, payroll.branch_id);
  const brackets = await loadTaxBrackets();
  const sim = simulatePayrollRun(inputs, payroll.period_start, payroll.period_end, brackets, priorRun?.total_net ?? null);

  await db.transaction(async (tx) => {
    await tx.prepare('DELETE FROM payslips WHERE payroll_id = ?').run(id);
    const now = new Date().toISOString();
    const insertSlip = tx.prepare(
      `INSERT INTO payslips (
        payroll_id, employee_id, base_monthly_salary, proration_factor, overtime_hours, overtime_pay,
        bonus_amount, unpaid_leave_deduction, gross_pay, pre_tax_deductions, taxable_gross,
        federal_tax, state_tax, social_security_tax, medicare_tax, total_taxes,
        post_tax_deductions, loan_deduction, expense_reimbursement, total_deductions,
        net_pay, employer_cost, variance_pct, anomaly_flags_json, is_locked, issued_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
    );

    for (const item of sim.items) {
      await insertSlip.run(
        id,
        item.employeeId,
        item.baseMonthlySalary,
        item.prorationFactor,
        item.overtimeHours,
        item.overtimePay,
        item.bonusAmount,
        item.unpaidLeaveDeduction,
        item.grossPay,
        item.preTaxDeductions,
        item.taxableGross,
        item.federalTax,
        item.stateTax,
        item.socialSecurityTax,
        item.medicareTax,
        item.totalTaxes,
        item.postTaxDeductions,
        item.loanDeduction,
        item.expenseReimbursement,
        item.totalDeductions,
        item.netPay,
        item.totalEmployerCost,
        item.variancePct,
        JSON.stringify(item.anomalyFlags),
        now
      );
    }

    await tx
      .prepare(
        `UPDATE payrolls
         SET status = 'simulated', employee_count = ?, total_gross = ?, total_pre_tax = ?, total_taxes = ?,
             total_net = ?, total_employer_taxes = ?, variance_pct = ?, anomaly_count = ?
         WHERE id = ?`
      )
      .run(
        sim.employeeCount,
        sim.totalGross,
        sim.totalPreTax,
        sim.totalTaxes,
        sim.totalNet,
        sim.totalEmployerTaxes,
        sim.runVariancePct,
        sim.anomalyCount,
        id
      );
  });

  await recordAuditLog({
    user: req.user,
    action: 'payroll.simulated',
    resource: 'payrolls',
    resourceId: id,
    after: {
      runCode: payroll.run_code,
      employeeCount: sim.employeeCount,
      totalGross: sim.totalGross,
      totalNet: sim.totalNet,
      anomalyCount: sim.anomalyCount,
    },
    ipAddress: req.ip,
  });

  res.json({ simulation: sim });
});

// Stage 2: Approval Sign-Off
payrollRouter.post('/payrolls/:id/approve', requirePermission('payroll.run'), async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const payroll = (await db.prepare('SELECT id, status, run_code FROM payrolls WHERE id = ?').get(id)) as
    | { id: number; status: string; run_code: string }
    | undefined;
  if (!payroll) {
    res.status(404).json({ error: 'Payroll run not found.' });
    return;
  }
  if (payroll.status !== 'simulated') {
    res.status(400).json({ error: 'Payroll must be simulated before approval sign-off.' });
    return;
  }
  const now = new Date().toISOString();
  await db
    .prepare("UPDATE payrolls SET status = 'approved', approved_by = ?, approved_at = ? WHERE id = ?")
    .run(req.user!.id, now, id);
  await recordAuditLog({
    user: req.user,
    action: 'payroll.approved',
    resource: 'payrolls',
    resourceId: id,
    before: { status: 'simulated' },
    after: { status: 'approved', runCode: payroll.run_code },
    ipAddress: req.ip,
  });
  res.json({ ok: true, status: 'approved' });
});

// Stage 3: Finalize & Lock (Immutable Payslips, Loan Auto-Repayment, Expense Reimbursement Mark, Webhook Dispatch)
payrollRouter.post('/payrolls/:id/finalize', requirePermission('payroll.finalize'), async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const payroll = (await db.prepare('SELECT * FROM payrolls WHERE id = ?').get(id)) as
    | { id: number; status: string; run_code: string; employee_count: number; total_net: number; total_gross: number }
    | undefined;
  if (!payroll) {
    res.status(404).json({ error: 'Payroll run not found.' });
    return;
  }
  if (payroll.status !== 'approved') {
    res.status(400).json({ error: 'Payroll must be approved before finalization and lock.' });
    return;
  }

  const now = new Date().toISOString();
  await db.transaction(async (tx) => {
    await tx.prepare("UPDATE payrolls SET status = 'finalized', finalized_at = ? WHERE id = ?").run(now, id);
    await tx.prepare('UPDATE payslips SET is_locked = 1, issued_at = ? WHERE payroll_id = ?').run(now, id);

    // Apply loan deductions & mark approved expenses as reimbursed
    const slips = (await tx
      .prepare('SELECT employee_id, loan_deduction, expense_reimbursement FROM payslips WHERE payroll_id = ?')
      .all(id)) as Array<{ employee_id: number; loan_deduction: number; expense_reimbursement: number }>;

    for (const s of slips) {
      if (s.loan_deduction > 0) {
        const loan = (await tx
          .prepare("SELECT id, remaining_balance FROM loans WHERE employee_id = ? AND status = 'active' ORDER BY id ASC LIMIT 1")
          .get(s.employee_id)) as { id: number; remaining_balance: number } | undefined;
        if (loan) {
          const nextBal = Math.max(0, Math.round((loan.remaining_balance - s.loan_deduction) * 100) / 100);
          await tx
            .prepare('UPDATE loans SET remaining_balance = ?, status = ? WHERE id = ?')
            .run(nextBal, nextBal <= 0 ? 'paid_off' : 'active', loan.id);
        }
      }
      if (s.expense_reimbursement > 0) {
        await tx
          .prepare(
            "UPDATE expenses SET reimbursed_in_payroll_id = ? WHERE employee_id = ? AND status = 'approved' AND reimbursed_in_payroll_id IS NULL"
          )
          .run(id, s.employee_id);
      }
    }
  });

  await recordAuditLog({
    user: req.user,
    action: 'payroll.finalized',
    resource: 'payrolls',
    resourceId: id,
    before: { status: 'approved' },
    after: { status: 'finalized', runCode: payroll.run_code, totalNet: payroll.total_net },
    ipAddress: req.ip,
  });

  await dispatchWebhookEvent('payroll.finalized', {
    payrollId: id,
    runCode: payroll.run_code,
    employeeCount: payroll.employee_count,
    totalGross: payroll.total_gross,
    totalNet: payroll.total_net,
  });

  res.json({ ok: true, status: 'finalized' });
});

// Export Bank ACH Batch CSV or Statutory Tax Filing Summary CSV
payrollRouter.get('/payrolls/:id/export', requirePermission('payroll.view'), async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const type = req.query.type === 'statutory' ? 'statutory' : 'bank';
  const payroll = (await db
    .prepare('SELECT run_code, period_start, period_end FROM payrolls WHERE id = ?')
    .get(id)) as { run_code: string; period_start: string; period_end: string } | undefined;
  if (!payroll) {
    res.status(404).json({ error: 'Payroll not found.' });
    return;
  }

  const rows = (await db
    .prepare(
      `SELECT ps.*, e.employee_code, e.full_name, e.bank_name, b.name as branch_name, b.cost_center
       FROM payslips ps
       JOIN employees e ON e.id = ps.employee_id
       JOIN branches b ON b.id = e.branch_id
       WHERE ps.payroll_id = ? ORDER BY e.employee_code ASC`
    )
    .all(id)) as Array<Record<string, unknown>>;

  let csv = '';
  if (type === 'bank') {
    csv = 'RunCode,EmployeeCode,EmployeeName,Branch,CostCenter,BankName,NetDisbursementUSD\n';
    for (const r of rows) {
      csv += `${payroll.run_code},${r.employee_code},"${r.full_name}","${r.branch_name}",${r.cost_center},"${r.bank_name ?? 'Direct Deposit'}",${Number(r.net_pay).toFixed(2)}\n`;
    }
  } else {
    csv = 'RunCode,EmployeeCode,EmployeeName,Branch,GrossPay,PreTaxDeductions,TaxableGross,FederalTax,StateTax,SocialSecurity,Medicare,TotalTaxes,EmployerTotalCost\n';
    for (const r of rows) {
      csv += `${payroll.run_code},${r.employee_code},"${r.full_name}","${r.branch_name}",${Number(r.gross_pay).toFixed(2)},${Number(r.pre_tax_deductions).toFixed(2)},${Number(r.taxable_gross).toFixed(2)},${Number(r.federal_tax).toFixed(2)},${Number(r.state_tax).toFixed(2)},${Number(r.social_security_tax).toFixed(2)},${Number(r.medicare_tax).toFixed(2)},${Number(r.total_taxes).toFixed(2)},${Number(r.employer_cost).toFixed(2)}\n`;
    }
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${payroll.run_code}-${type}.csv"`);
  res.send(csv);
});

// Update progressive tax bracket
payrollRouter.put('/tax-brackets/:id', requirePermission('tax.manage'), async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const schema = z.object({
    label: z.string().min(2).max(60),
    minIncome: z.number().min(0),
    maxIncome: z.number().nullable(),
    rate: z.number().min(0).max(0.6),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid tax bracket configuration.' });
    return;
  }
  const d = parsed.data;
  await db
    .prepare('UPDATE tax_brackets SET label = ?, min_income = ?, max_income = ?, rate = ? WHERE id = ?')
    .run(d.label, d.minIncome, d.maxIncome, d.rate, id);
  await recordAuditLog({
    user: req.user,
    action: 'tax.bracket_updated',
    resource: 'tax_brackets',
    resourceId: id,
    after: d,
    ipAddress: req.ip,
  });
  res.json({ ok: true });
});

// My Payslips (Self-service or Admin view)
payrollRouter.get('/payslips', requirePermission('payroll.view'), async (req: AuthedRequest, res) => {
  const isPrivileged =
    req.user!.roles.includes('super_admin') || req.user!.roles.includes('hr_admin');
  const slips = await db
    .prepare(
      `SELECT ps.*, pr.run_code, pr.period_start, pr.period_end, pr.pay_date, pr.status as payroll_status,
              e.employee_code, e.full_name as employee_name, e.designation, b.name as branch_name, d.name as department_name
       FROM payslips ps
       JOIN payrolls pr ON pr.id = ps.payroll_id
       JOIN employees e ON e.id = ps.employee_id
       JOIN branches b ON b.id = e.branch_id
       JOIN departments d ON d.id = e.department_id
       ${isPrivileged ? '' : 'WHERE ps.employee_id = ?'}
       ORDER BY ps.id DESC LIMIT 60`
    )
    .all(...(isPrivileged ? [] : [req.user!.employeeId ?? -1]));
  res.json({ payslips: slips });
});

// ---------------------------------------------------------------------------
// Benefits Catalog, Enrollments & COBRA Compliance
// ---------------------------------------------------------------------------
payrollRouter.get('/benefits', requirePermission('benefits.view'), async (req: AuthedRequest, res) => {
  const plans = await db.prepare('SELECT * FROM benefits ORDER BY category, name').all();
  const isPrivileged =
    req.user!.roles.includes('super_admin') || req.user!.roles.includes('hr_admin');
  const enrollments = await db
    .prepare(
      `SELECT be.*, b.name as benefit_name, b.category, b.provider, b.tax_treatment,
              b.employee_monthly_cost, b.employer_monthly_cost,
              e.full_name as employee_name, e.employee_code
       FROM benefit_enrollments be
       JOIN benefits b ON b.id = be.benefit_id
       JOIN employees e ON e.id = be.employee_id
       ${isPrivileged ? '' : 'WHERE be.employee_id = ?'}
       ORDER BY be.id DESC`
    )
    .all(...(isPrivileged ? [] : [req.user!.employeeId ?? -1]));
  const cobra = isPrivileged
    ? await db.prepare('SELECT * FROM cobra_coverages ORDER BY id DESC').all()
    : [];
  res.json({ plans, enrollments, cobra });
});

payrollRouter.post('/benefits/enroll', requirePermission('benefits.view'), async (req: AuthedRequest, res) => {
  const schema = z.object({
    benefitId: z.number().int().positive(),
    employeeId: z.number().int().positive().optional(),
    coverageTier: z.enum(['Employee Only', 'Employee + Spouse', 'Family']).default('Employee Only'),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid enrollment data.' });
    return;
  }
  const targetEmp = parsed.data.employeeId ?? req.user!.employeeId;
  if (!targetEmp) {
    res.status(400).json({ error: 'No employee profile linked.' });
    return;
  }
  const info = await db
    .prepare(
      `INSERT INTO benefit_enrollments (employee_id, benefit_id, coverage_tier, status, enrolled_at)
       VALUES (?, ?, ?, 'active', ?)`
    )
    .run(targetEmp, parsed.data.benefitId, parsed.data.coverageTier, new Date().toISOString().slice(0, 10));
  await recordAuditLog({
    user: req.user,
    action: 'benefits.enrolled',
    resource: 'benefit_enrollments',
    resourceId: Number(info.lastInsertRowid),
    after: { employeeId: targetEmp, benefitId: parsed.data.benefitId, coverageTier: parsed.data.coverageTier },
    ipAddress: req.ip,
  });
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

payrollRouter.post('/cobra', requirePermission('benefits.manage'), async (req: AuthedRequest, res) => {
  const schema = z.object({
    employeeName: z.string().min(2).max(120),
    qualifyingEvent: z.string().min(2).max(120),
    planName: z.string().min(2).max(120),
    monthlyPremium: z.number().positive(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid COBRA record.' });
    return;
  }
  const d = parsed.data;
  const info = await db
    .prepare(
      `INSERT INTO cobra_coverages (employee_name, qualifying_event, plan_name, monthly_premium, start_date, end_date, status)
       VALUES (?, ?, ?, ?, ?, ?, 'offered')`
    )
    .run(d.employeeName, d.qualifyingEvent, d.planName, d.monthlyPremium, d.startDate, d.endDate);
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});
