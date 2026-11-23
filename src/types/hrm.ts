export interface AuthUser {
  id: number;
  email: string;
  username: string;
  fullName: string;
  avatarUrl: string | null;
  mfaEnabled: boolean;
  roles: string[];
  permissions: string[];
  employeeId: number | null;
  branchId: number | null;
}

export interface Branch {
  id: number;
  code: string;
  name: string;
  city: string;
  country: string;
  timezone: string;
  currency_code: string;
  state_tax_rate: number;
  cost_center: string;
  is_headquarters: number;
  status: string;
  headcount?: number;
  annual_payroll?: number;
}

export interface Department {
  id: number;
  branch_id: number;
  name: string;
  code: string;
  branch_name: string;
  branch_code: string;
  manager_name: string | null;
  budget: number;
  headcount: number;
}

export interface Employee {
  id: number;
  user_id: number | null;
  branch_id: number;
  department_id: number;
  manager_id: number | null;
  employee_code: string;
  full_name: string;
  email: string;
  phone: string | null;
  designation: string;
  employment_type: string;
  hire_date: string;
  termination_date: string | null;
  annual_salary: number | null;
  pre_tax_401k_pct: number;
  bank_name: string | null;
  bank_account_masked: string;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  avatar_url: string | null;
  status: string;
  branch_name: string;
  branch_code: string;
  branch_city: string;
  department_name: string;
  manager_name: string | null;
}

export interface PayrollRun {
  id: number;
  run_code: string;
  branch_id: number | null;
  branch_name: string | null;
  period_start: string;
  period_end: string;
  pay_date: string;
  status: 'draft' | 'simulated' | 'approved' | 'finalized';
  employee_count: number;
  total_gross: number;
  total_pre_tax: number;
  total_taxes: number;
  total_net: number;
  total_employer_taxes: number;
  variance_pct: number | null;
  anomaly_count: number;
  approver_name: string | null;
  approved_at: string | null;
  finalized_at: string | null;
}

export interface Payslip {
  id: number;
  payroll_id: number;
  employee_id: number;
  run_code?: string;
  period_start?: string;
  period_end?: string;
  pay_date?: string;
  payroll_status?: string;
  employee_code: string;
  employee_name: string;
  designation: string;
  branch_name: string;
  department_name: string;
  base_monthly_salary: number;
  proration_factor: number;
  overtime_hours: number;
  overtime_pay: number;
  bonus_amount: number;
  unpaid_leave_deduction: number;
  gross_pay: number;
  pre_tax_deductions: number;
  taxable_gross: number;
  federal_tax: number;
  state_tax: number;
  social_security_tax: number;
  medicare_tax: number;
  total_taxes: number;
  post_tax_deductions: number;
  loan_deduction: number;
  expense_reimbursement: number;
  total_deductions: number;
  net_pay: number;
  employer_cost: number;
  variance_pct: number | null;
  anomaly_flags_json: string;
  is_locked: number;
  issued_at: string;
}

export interface TaxBracketRow {
  id: number;
  label: string;
  min_income: number;
  max_income: number | null;
  rate: number;
  sort_order: number;
}

export type NavSection =
  | 'dashboard'
  | 'people'
  | 'payroll'
  | 'attendance'
  | 'recruitment'
  | 'performance'
  | 'operations'
  | 'analytics'
  | 'security';
