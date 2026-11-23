export interface TaxBracket {
  min: number;
  max: number | null;
  rate: number;
  label?: string;
}

export interface PayrollEmployeeInput {
  employeeId: number;
  employeeCode: string;
  employeeName: string;
  departmentName: string;
  branchId: number;
  branchName: string;
  branchStateTaxRate: number; // e.g. 0.0 for TX, 0.065 for NY, 0.05 for EMEA/APAC equivalent
  annualSalary: number;
  hireDate: string; // YYYY-MM-DD
  terminationDate?: string | null;
  ytdGrossPrior: number; // prior YTD gross for FICA Social Security wage cap
  preTaxBenefitsMonthly: number; // 401k + Section 125 medical/dental
  postTaxDeductionsMonthly: number; // vision/supplemental post-tax
  overtimeHours: number;
  overtimeMultiplier?: number; // default 1.5
  unpaidLeaveDays: number;
  bonusAmount: number;
  expenseReimbursement: number;
  loanInstallment: number;
  priorPeriodNet?: number | null;
}

export interface PayslipCalculation {
  employeeId: number;
  employeeCode: string;
  employeeName: string;
  departmentName: string;
  branchId: number;
  branchName: string;
  baseMonthlySalary: number;
  prorationFactor: number;
  proratedBasePay: number;
  overtimeHours: number;
  overtimePay: number;
  bonusAmount: number;
  unpaidLeaveDeduction: number;
  grossPay: number;
  preTaxDeductions: number;
  taxableGross: number;
  federalTax: number;
  stateTax: number;
  socialSecurityTax: number;
  medicareTax: number;
  totalTaxes: number;
  postTaxDeductions: number;
  loanDeduction: number;
  expenseReimbursement: number;
  totalDeductions: number;
  netPay: number;
  employerSocialSecurity: number;
  employerMedicare: number;
  employerFuta: number;
  totalEmployerCost: number;
  effectiveTaxRate: number;
  variancePct: number | null;
  anomalyFlags: string[];
}

export interface PayrollRunSimulation {
  periodStart: string;
  periodEnd: string;
  employeeCount: number;
  totalGross: number;
  totalPreTax: number;
  totalTaxes: number;
  totalNet: number;
  totalEmployerTaxes: number;
  totalCashOutlay: number;
  priorTotalNet: number | null;
  runVariancePct: number | null;
  anomalyCount: number;
  items: PayslipCalculation[];
}

export const DEFAULT_ANNUAL_TAX_BRACKETS: TaxBracket[] = [
  { min: 0, max: 14600, rate: 0.0, label: 'Standard Exemption' },
  { min: 14600, max: 47150, rate: 0.12, label: 'Tier 1 (12%)' },
  { min: 47150, max: 100525, rate: 0.22, label: 'Tier 2 (22%)' },
  { min: 100525, max: 191950, rate: 0.24, label: 'Tier 3 (24%)' },
  { min: 191950, max: null, rate: 0.32, label: 'Executive Tier (32%)' },
];

export const FICA_SOCIAL_SECURITY_RATE = 0.062;
export const FICA_SOCIAL_SECURITY_WAGE_CAP = 176100;
export const FICA_MEDICARE_RATE = 0.0145;
export const FICA_ADDITIONAL_MEDICARE_RATE = 0.009;
export const FICA_ADDITIONAL_MEDICARE_THRESHOLD = 200000;
export const FUTA_RATE = 0.006;
export const FUTA_WAGE_CAP = 7000;

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Calculate annualized progressive federal income tax from progressive marginal brackets.
 */
export function calculateProgressiveAnnualTax(
  annualTaxableIncome: number,
  brackets: TaxBracket[] = DEFAULT_ANNUAL_TAX_BRACKETS
): number {
  if (annualTaxableIncome <= 0) return 0;
  let tax = 0;
  const sorted = [...brackets].sort((a, b) => a.min - b.min);
  for (const bracket of sorted) {
    const upper = bracket.max === null ? Number.POSITIVE_INFINITY : bracket.max;
    if (annualTaxableIncome > bracket.min) {
      const taxableSlice = Math.min(annualTaxableIncome, upper) - bracket.min;
      if (taxableSlice > 0) {
        tax += taxableSlice * bracket.rate;
      }
    }
  }
  return round2(tax);
}

/**
 * Compute exact proration factor (0..1) for mid-period hires or terminations.
 */
export function computeProrationFactor(
  periodStart: string,
  periodEnd: string,
  hireDate: string,
  terminationDate?: string | null
): number {
  const startMs = Date.parse(periodStart + 'T00:00:00Z');
  const endMs = Date.parse(periodEnd + 'T00:00:00Z');
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) return 1;

  const totalDays = Math.floor((endMs - startMs) / 86400000) + 1;
  const hireMs = Date.parse(hireDate + 'T00:00:00Z');
  const termMs = terminationDate ? Date.parse(terminationDate + 'T00:00:00Z') : Number.POSITIVE_INFINITY;

  const effectiveStart = Math.max(startMs, Number.isNaN(hireMs) ? startMs : hireMs);
  const effectiveEnd = Math.min(endMs, Number.isNaN(termMs) ? endMs : termMs);

  if (effectiveEnd < effectiveStart) return 0;
  const activeDays = Math.floor((effectiveEnd - effectiveStart) / 86400000) + 1;
  return Math.min(1, Math.max(0, round2(activeDays / totalDays)));
}

/**
 * Compute monthly statutory payslip with pre-tax deductions, progressive federal tax,
 * branch/state tax, FICA with annual wage caps, overtime, proration, loans, and reimbursements.
 */
export function calculateEmployeePayslip(
  input: PayrollEmployeeInput,
  periodStart: string,
  periodEnd: string,
  brackets: TaxBracket[] = DEFAULT_ANNUAL_TAX_BRACKETS
): PayslipCalculation {
  const baseMonthlySalary = round2(input.annualSalary / 12);
  const prorationFactor = computeProrationFactor(
    periodStart,
    periodEnd,
    input.hireDate,
    input.terminationDate
  );
  const proratedBasePay = round2(baseMonthlySalary * prorationFactor);

  // Standard 22 working days / 176 hours monthly baseline for hourly & daily equivalents
  const hourlyRate = baseMonthlySalary / 176;
  const dailyRate = baseMonthlySalary / 22;
  const overtimeMultiplier = input.overtimeMultiplier ?? 1.5;

  const overtimePay = round2(Math.max(0, input.overtimeHours) * hourlyRate * overtimeMultiplier);
  const unpaidLeaveDeduction = round2(Math.max(0, input.unpaidLeaveDays) * dailyRate);
  const bonusAmount = round2(Math.max(0, input.bonusAmount));

  const grossPay = round2(Math.max(0, proratedBasePay + overtimePay + bonusAmount - unpaidLeaveDeduction));
  const preTaxDeductions = round2(Math.min(grossPay, Math.max(0, input.preTaxBenefitsMonthly)));
  const taxableGross = round2(Math.max(0, grossPay - preTaxDeductions));

  // Annualize taxable gross for progressive withholding accuracy
  const annualizedTaxable = taxableGross * 12;
  const federalTax = round2(calculateProgressiveAnnualTax(annualizedTaxable, brackets) / 12);
  const stateTax = round2(taxableGross * Math.max(0, input.branchStateTaxRate));

  // FICA Social Security subject to annual wage base cap
  const ssRemainingCap = Math.max(0, FICA_SOCIAL_SECURITY_WAGE_CAP - Math.max(0, input.ytdGrossPrior));
  const ssTaxable = Math.min(grossPay, ssRemainingCap);
  const socialSecurityTax = round2(ssTaxable * FICA_SOCIAL_SECURITY_RATE);

  // Medicare + Additional Medicare above $200k YTD
  const baseMedicare = grossPay * FICA_MEDICARE_RATE;
  const ytdAfter = Math.max(0, input.ytdGrossPrior) + grossPay;
  const additionalMedicareTaxable = Math.max(
    0,
    ytdAfter - Math.max(FICA_ADDITIONAL_MEDICARE_THRESHOLD, Math.max(0, input.ytdGrossPrior))
  );
  const medicareTax = round2(baseMedicare + additionalMedicareTaxable * FICA_ADDITIONAL_MEDICARE_RATE);

  const totalTaxes = round2(federalTax + stateTax + socialSecurityTax + medicareTax);
  const postTaxDeductions = round2(Math.max(0, input.postTaxDeductionsMonthly));
  const loanDeduction = round2(Math.max(0, input.loanInstallment));
  const expenseReimbursement = round2(Math.max(0, input.expenseReimbursement));

  const totalDeductions = round2(preTaxDeductions + totalTaxes + postTaxDeductions + loanDeduction);
  const netPay = round2(grossPay - totalDeductions + expenseReimbursement);

  // Employer statutory contributions
  const employerSocialSecurity = socialSecurityTax;
  const employerMedicare = round2(grossPay * FICA_MEDICARE_RATE);
  const futaRemainingCap = Math.max(0, FUTA_WAGE_CAP - Math.max(0, input.ytdGrossPrior));
  const employerFuta = round2(Math.min(grossPay, futaRemainingCap) * FUTA_RATE);
  const totalEmployerCost = round2(grossPay + employerSocialSecurity + employerMedicare + employerFuta + expenseReimbursement);

  const effectiveTaxRate = grossPay > 0 ? round2((totalTaxes / grossPay) * 100) : 0;

  let variancePct: number | null = null;
  const anomalyFlags: string[] = [];

  if (input.priorPeriodNet !== null && input.priorPeriodNet !== undefined && input.priorPeriodNet > 0) {
    variancePct = round2(((netPay - input.priorPeriodNet) / input.priorPeriodNet) * 100);
    if (Math.abs(variancePct) >= 15) {
      anomalyFlags.push(
        `Net pay variance ${variancePct > 0 ? '+' : ''}${variancePct}% vs prior cycle`
      );
    }
  }
  if (prorationFactor < 1 && prorationFactor > 0) {
    anomalyFlags.push(`Prorated period (${Math.round(prorationFactor * 100)}% active days)`);
  }
  if (input.overtimeHours >= 20) {
    anomalyFlags.push(`Elevated overtime (${input.overtimeHours}h)`);
  }
  if (netPay < 0) {
    anomalyFlags.push('Negative net pay — deductions exceed earnings');
  }

  return {
    employeeId: input.employeeId,
    employeeCode: input.employeeCode,
    employeeName: input.employeeName,
    departmentName: input.departmentName,
    branchId: input.branchId,
    branchName: input.branchName,
    baseMonthlySalary,
    prorationFactor,
    proratedBasePay,
    overtimeHours: input.overtimeHours,
    overtimePay,
    bonusAmount,
    unpaidLeaveDeduction,
    grossPay,
    preTaxDeductions,
    taxableGross,
    federalTax,
    stateTax,
    socialSecurityTax,
    medicareTax,
    totalTaxes,
    postTaxDeductions,
    loanDeduction,
    expenseReimbursement,
    totalDeductions,
    netPay,
    employerSocialSecurity,
    employerMedicare,
    employerFuta,
    totalEmployerCost,
    effectiveTaxRate,
    variancePct,
    anomalyFlags,
  };
}

export function simulatePayrollRun(
  employees: PayrollEmployeeInput[],
  periodStart: string,
  periodEnd: string,
  brackets: TaxBracket[] = DEFAULT_ANNUAL_TAX_BRACKETS,
  priorTotalNet: number | null = null
): PayrollRunSimulation {
  const items = employees.map((emp) =>
    calculateEmployeePayslip(emp, periodStart, periodEnd, brackets)
  );
  const totalGross = round2(items.reduce((acc, i) => acc + i.grossPay, 0));
  const totalPreTax = round2(items.reduce((acc, i) => acc + i.preTaxDeductions, 0));
  const totalTaxes = round2(items.reduce((acc, i) => acc + i.totalTaxes, 0));
  const totalNet = round2(items.reduce((acc, i) => acc + i.netPay, 0));
  const totalEmployerTaxes = round2(
    items.reduce((acc, i) => acc + i.employerSocialSecurity + i.employerMedicare + i.employerFuta, 0)
  );
  const totalCashOutlay = round2(items.reduce((acc, i) => acc + i.totalEmployerCost, 0));
  const runVariancePct =
    priorTotalNet && priorTotalNet > 0
      ? round2(((totalNet - priorTotalNet) / priorTotalNet) * 100)
      : null;
  const anomalyCount = items.filter((i) => i.anomalyFlags.length > 0).length;

  return {
    periodStart,
    periodEnd,
    employeeCount: items.length,
    totalGross,
    totalPreTax,
    totalTaxes,
    totalNet,
    totalEmployerTaxes,
    totalCashOutlay,
    priorTotalNet,
    runVariancePct,
    anomalyCount,
    items,
  };
}
