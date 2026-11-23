import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateEmployeePayslip,
  calculateProgressiveAnnualTax,
  computeProrationFactor,
  simulatePayrollRun,
} from './payrollEngine';
import {
  computeAuditEntryHash,
  generateTotpCode,
  generateTotpSecret,
  hashPassword,
  redactSensitiveData,
  signWebhookPayload,
  validateSafeWebhookUrl,
  verifyAuditHashChain,
  verifyPassword,
  verifyTotpCode,
} from './securityEngine';
import {
  calculateLeaveBusinessDays,
  evaluateAttendanceShift,
  evaluateWorkflowRules,
  type WorkflowRule,
} from './workflowEngine';

test('progressive tax engine calculates tiered marginal brackets accurately', () => {
  assert.equal(calculateProgressiveAnnualTax(14000), 0);
  assert.equal(calculateProgressiveAnnualTax(47150), 3906);
  // $120,000 -> 0% on 14,600 + 12% on 32,550 (3,906) + 22% on 53,375 (11,742.5) + 24% on 19,475 (4,674) = 20,322.5
  assert.equal(calculateProgressiveAnnualTax(120000), 20322.5);
});

test('payroll proration handles mid-month hires and exits accurately', () => {
  assert.equal(computeProrationFactor('2026-11-01', '2026-11-30', '2025-01-15'), 1);
  assert.equal(computeProrationFactor('2026-11-01', '2026-11-30', '2026-11-16'), 0.5);
  assert.equal(computeProrationFactor('2026-11-01', '2026-11-30', '2024-01-01', '2026-11-15'), 0.5);
});

test('statutory payslip respects pre-tax deductions, FICA cap, overtime, loans, and variance alerts', () => {
  const slip = calculateEmployeePayslip(
    {
      employeeId: 1,
      employeeCode: 'NX-1001',
      employeeName: 'Elena Vance',
      departmentName: 'People Operations',
      branchId: 1,
      branchName: 'Austin HQ',
      branchStateTaxRate: 0.0,
      annualSalary: 180000,
      hireDate: '2023-03-01',
      ytdGrossPrior: 170000, // Only $6,100 left under $176,100 Social Security cap
      preTaxBenefitsMonthly: 1000,
      postTaxDeductionsMonthly: 50,
      overtimeHours: 10,
      unpaidLeaveDays: 0,
      bonusAmount: 2000,
      expenseReimbursement: 250,
      loanInstallment: 300,
      priorPeriodNet: 9500,
    },
    '2026-11-01',
    '2026-11-30'
  );

  // Base monthly = 15,000; OT = 10 * (15000/176) * 1.5 = 1278.41; Bonus = 2000 -> Gross = 18278.41
  assert.equal(slip.baseMonthlySalary, 15000);
  assert.equal(slip.grossPay, 18278.41);
  assert.equal(slip.taxableGross, 17278.41);
  // Social Security capped at remaining $6,100 * 6.2% = $378.20
  assert.equal(slip.socialSecurityTax, 378.2);
  assert.equal(slip.stateTax, 0);
  assert.equal(slip.loanDeduction, 300);
  assert.equal(slip.expenseReimbursement, 250);
  assert.ok(slip.netPay > 10000);
  assert.ok(slip.anomalyFlags.some((f) => f.includes('variance')));

  const run = simulatePayrollRun(
    [
      {
        employeeId: 1,
        employeeCode: 'NX-1001',
        employeeName: 'Elena Vance',
        departmentName: 'People Operations',
        branchId: 1,
        branchName: 'Austin HQ',
        branchStateTaxRate: 0,
        annualSalary: 120000,
        hireDate: '2024-01-01',
        ytdGrossPrior: 100000,
        preTaxBenefitsMonthly: 500,
        postTaxDeductionsMonthly: 0,
        overtimeHours: 0,
        unpaidLeaveDays: 0,
        bonusAmount: 0,
        expenseReimbursement: 0,
        loanInstallment: 0,
        priorPeriodNet: 7000,
      },
    ],
    '2026-11-01',
    '2026-11-30',
    undefined,
    7000
  );
  assert.equal(run.employeeCount, 1);
  assert.equal(run.totalGross, 10000);
});

test('scrypt password hashing, TOTP MFA, webhook signing, URL guard, and audit hash chain work end-to-end', () => {
  const hash = hashPassword('Enterprise#2026!');
  assert.equal(verifyPassword('Enterprise#2026!', hash), true);
  assert.equal(verifyPassword('WrongPassword', hash), false);

  const secret = generateTotpSecret();
  const now = 1_795_446_546_000;
  const code = generateTotpCode(secret, now);
  assert.equal(code.length, 6);
  assert.equal(verifyTotpCode(secret, code, now), true);
  assert.equal(verifyTotpCode(secret, '000000', now), false);

  const sig = signWebhookPayload('{"event":"payroll.finalized"}', 'whsec_test', 1700000000);
  assert.ok(sig.startsWith('t=1700000000,v1='));

  assert.equal(validateSafeWebhookUrl('https://hooks.example.com/hrm').valid, true);
  assert.equal(validateSafeWebhookUrl('http://127.0.0.1:8080/internal').valid, false);
  assert.equal(validateSafeWebhookUrl('http://169.254.169.254/latest/meta-data').valid, false);
  assert.equal(validateSafeWebhookUrl('javascript:alert(1)').valid, false);

  const redacted = redactSensitiveData({
    email: 'a@b.com',
    password: 'secret',
    bank_account: '9876543210',
  }) as Record<string, string>;
  assert.equal(redacted.password, '[REDACTED]');
  assert.equal(redacted.bank_account, '••••3210');

  const e1Base = {
    userId: 1,
    action: 'payroll.finalized',
    resource: 'payrolls',
    resourceId: '1',
    beforeData: null,
    afterData: '{"status":"finalized"}',
    ipAddress: '10.0.0.1',
    createdAt: '2026-11-23T06:00:00Z',
    prevHash: 'GENESIS',
  };
  const e1Hash = computeAuditEntryHash(e1Base);
  const e2Base = {
    userId: 1,
    action: 'employee.updated',
    resource: 'employees',
    resourceId: '4',
    beforeData: '{"salary":120000}',
    afterData: '{"salary":130000}',
    ipAddress: '10.0.0.1',
    createdAt: '2026-11-23T06:05:00Z',
    prevHash: e1Hash,
  };
  const e2Hash = computeAuditEntryHash(e2Base);

  assert.equal(
    verifyAuditHashChain([
      { id: 1, ...e1Base, entryHash: e1Hash },
      { id: 2, ...e2Base, entryHash: e2Hash },
    ]).valid,
    true
  );

  // Tamper detection check
  assert.equal(
    verifyAuditHashChain([
      { id: 1, ...e1Base, afterData: '{"status":"tampered"}', entryHash: e1Hash },
      { id: 2, ...e2Base, entryHash: e2Hash },
    ]).valid,
    false
  );
});

test('workflow rule engine, leave business days, and attendance shift evaluator behave accurately', () => {
  const rules: WorkflowRule[] = [
    {
      id: 1,
      name: 'Extended Leave Dual Approval',
      triggerEvent: 'leave.submitted',
      branchId: null,
      conditionField: 'days',
      conditionOperator: 'gt',
      conditionValue: 5,
      approverRoles: ['manager', 'hr_admin'],
      webhookEvent: 'leave.escalated',
      isActive: true,
    },
    {
      id: 2,
      name: 'High Expense Finance Approval',
      triggerEvent: 'expense.submitted',
      branchId: 1,
      conditionField: 'amount',
      conditionOperator: 'gte',
      conditionValue: 500,
      approverRoles: ['manager', 'hr_admin'],
      webhookEvent: 'expense.escalated',
      isActive: true,
    },
  ];

  const longLeave = evaluateWorkflowRules(rules, {
    triggerEvent: 'leave.submitted',
    branchId: 2,
    days: 7,
  });
  assert.deepEqual(longLeave.requiredApprovalSteps, ['manager', 'hr_admin']);
  assert.deepEqual(longLeave.webhookEvents, ['leave.escalated']);

  const shortLeave = evaluateWorkflowRules(rules, {
    triggerEvent: 'leave.submitted',
    branchId: 2,
    days: 2,
  });
  assert.deepEqual(shortLeave.requiredApprovalSteps, ['manager']);

  // Mon Nov 23 to Fri Nov 27 with Thanksgiving Nov 26 excluded = 4 business days
  assert.equal(calculateLeaveBusinessDays('2026-11-23', '2026-11-27', ['2026-11-26']), 4);

  const shift = evaluateAttendanceShift('2026-11-23T09:05:00Z', '2026-11-23T19:05:00Z');
  assert.equal(shift.workedHours, 10);
  assert.equal(shift.overtimeHours, 2);
  assert.equal(shift.status, 'present');
});
