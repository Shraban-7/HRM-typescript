-- =============================================================================
-- Nexus HRM — Supabase PostgreSQL Schema (35 Enterprise HRM Tables)
-- =============================================================================
-- Note: Nexus HRM automatically initializes and seeds this schema on first API
-- request when DATABASE_URL or SUPABASE_DB_URL is configured.
-- You can also execute this script directly in the Supabase SQL Editor if you
-- want to pre-provision all tables before deploying.
-- =============================================================================

CREATE TABLE IF NOT EXISTS company_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS branches (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  country TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Chicago',
  currency_code TEXT NOT NULL DEFAULT 'USD',
  state_tax_rate DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  cost_center TEXT NOT NULL,
  is_headquarters INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS departments (
  id SERIAL PRIMARY KEY,
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  parent_id INTEGER REFERENCES departments(id),
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  manager_employee_id INTEGER,
  budget DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  require_mfa INTEGER NOT NULL DEFAULT 0,
  is_system INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS permissions (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  module TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  avatar_url TEXT,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  mfa_enabled INTEGER NOT NULL DEFAULT 0,
  totp_secret TEXT,
  recovery_codes_json TEXT,
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mfa_verified INTEGER NOT NULL DEFAULT 1,
  ip_address TEXT,
  user_agent TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mfa_challenges (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY,
  user_id INTEGER UNIQUE REFERENCES users(id),
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  department_id INTEGER NOT NULL REFERENCES departments(id),
  manager_id INTEGER REFERENCES employees(id),
  employee_code TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  designation TEXT NOT NULL,
  employment_type TEXT NOT NULL DEFAULT 'full_time',
  hire_date TEXT NOT NULL,
  termination_date TEXT,
  annual_salary DOUBLE PRECISION NOT NULL,
  pre_tax_401k_pct DOUBLE PRECISION NOT NULL DEFAULT 4.0,
  bank_name TEXT,
  bank_account_number TEXT,
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  avatar_url TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tax_brackets (
  id SERIAL PRIMARY KEY,
  label TEXT NOT NULL,
  min_income DOUBLE PRECISION NOT NULL,
  max_income DOUBLE PRECISION,
  rate DOUBLE PRECISION NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payrolls (
  id SERIAL PRIMARY KEY,
  run_code TEXT NOT NULL UNIQUE,
  branch_id INTEGER REFERENCES branches(id),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  pay_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  employee_count INTEGER NOT NULL DEFAULT 0,
  total_gross DOUBLE PRECISION NOT NULL DEFAULT 0,
  total_pre_tax DOUBLE PRECISION NOT NULL DEFAULT 0,
  total_taxes DOUBLE PRECISION NOT NULL DEFAULT 0,
  total_net DOUBLE PRECISION NOT NULL DEFAULT 0,
  total_employer_taxes DOUBLE PRECISION NOT NULL DEFAULT 0,
  variance_pct DOUBLE PRECISION,
  anomaly_count INTEGER NOT NULL DEFAULT 0,
  approved_by INTEGER REFERENCES users(id),
  approved_at TEXT,
  finalized_at TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payslips (
  id SERIAL PRIMARY KEY,
  payroll_id INTEGER NOT NULL REFERENCES payrolls(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  base_monthly_salary DOUBLE PRECISION NOT NULL,
  proration_factor DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  overtime_hours DOUBLE PRECISION NOT NULL DEFAULT 0,
  overtime_pay DOUBLE PRECISION NOT NULL DEFAULT 0,
  bonus_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  unpaid_leave_deduction DOUBLE PRECISION NOT NULL DEFAULT 0,
  gross_pay DOUBLE PRECISION NOT NULL,
  pre_tax_deductions DOUBLE PRECISION NOT NULL DEFAULT 0,
  taxable_gross DOUBLE PRECISION NOT NULL,
  federal_tax DOUBLE PRECISION NOT NULL,
  state_tax DOUBLE PRECISION NOT NULL,
  social_security_tax DOUBLE PRECISION NOT NULL,
  medicare_tax DOUBLE PRECISION NOT NULL,
  total_taxes DOUBLE PRECISION NOT NULL,
  post_tax_deductions DOUBLE PRECISION NOT NULL DEFAULT 0,
  loan_deduction DOUBLE PRECISION NOT NULL DEFAULT 0,
  expense_reimbursement DOUBLE PRECISION NOT NULL DEFAULT 0,
  total_deductions DOUBLE PRECISION NOT NULL,
  net_pay DOUBLE PRECISION NOT NULL,
  employer_cost DOUBLE PRECISION NOT NULL,
  variance_pct DOUBLE PRECISION,
  anomaly_flags_json TEXT NOT NULL DEFAULT '[]',
  is_locked INTEGER NOT NULL DEFAULT 0,
  issued_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shifts (
  id SERIAL PRIMARY KEY,
  branch_id INTEGER REFERENCES branches(id),
  name TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  standard_hours DOUBLE PRECISION NOT NULL DEFAULT 8,
  overtime_multiplier DOUBLE PRECISION NOT NULL DEFAULT 1.5,
  grace_minutes INTEGER NOT NULL DEFAULT 15
);

CREATE TABLE IF NOT EXISTS attendances (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  work_date TEXT NOT NULL,
  clock_in TEXT,
  clock_out TEXT,
  worked_hours DOUBLE PRECISION NOT NULL DEFAULT 0,
  overtime_hours DOUBLE PRECISION NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'present',
  source TEXT NOT NULL DEFAULT 'web',
  notes TEXT,
  UNIQUE(employee_id, work_date)
);

CREATE TABLE IF NOT EXISTS holidays (
  id SERIAL PRIMARY KEY,
  branch_id INTEGER REFERENCES branches(id),
  name TEXT NOT NULL,
  holiday_date TEXT NOT NULL,
  is_recurring INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  leave_type TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  days DOUBLE PRECISION NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  approval_chain_json TEXT NOT NULL DEFAULT '["manager"]',
  current_step INTEGER NOT NULL DEFAULT 0,
  approvals_json TEXT NOT NULL DEFAULT '[]',
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_posts (
  id SERIAL PRIMARY KEY,
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  department_id INTEGER NOT NULL REFERENCES departments(id),
  title TEXT NOT NULL,
  employment_type TEXT NOT NULL DEFAULT 'full_time',
  salary_range TEXT NOT NULL,
  description TEXT NOT NULL,
  requirements TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  closing_date TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS applicants (
  id SERIAL PRIMARY KEY,
  job_post_id INTEGER NOT NULL REFERENCES job_posts(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  source TEXT NOT NULL DEFAULT 'Career Portal',
  stage TEXT NOT NULL DEFAULT 'applied',
  rating INTEGER NOT NULL DEFAULT 4,
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS interviews (
  id SERIAL PRIMARY KEY,
  applicant_id INTEGER NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
  interviewer_name TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  interview_type TEXT NOT NULL DEFAULT 'Technical Panel',
  status TEXT NOT NULL DEFAULT 'scheduled',
  notes TEXT
);

CREATE TABLE IF NOT EXISTS performance_reviews (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  reviewer_name TEXT NOT NULL,
  cycle TEXT NOT NULL,
  self_rating DOUBLE PRECISION,
  manager_rating DOUBLE PRECISION NOT NULL,
  calibrated_rating DOUBLE PRECISION,
  bonus_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
  summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS goals (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Delivery',
  progress INTEGER NOT NULL DEFAULT 0,
  target_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress'
);

CREATE TABLE IF NOT EXISTS feedback_entries (
  id SERIAL PRIMARY KEY,
  from_name TEXT NOT NULL,
  to_employee_id INTEGER NOT NULL REFERENCES employees(id),
  category TEXT NOT NULL DEFAULT 'Recognition',
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS benefits (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  provider TEXT NOT NULL,
  tax_treatment TEXT NOT NULL DEFAULT 'pre_tax',
  employee_monthly_cost DOUBLE PRECISION NOT NULL,
  employer_monthly_cost DOUBLE PRECISION NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS benefit_enrollments (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  benefit_id INTEGER NOT NULL REFERENCES benefits(id),
  coverage_tier TEXT NOT NULL DEFAULT 'Employee Only',
  status TEXT NOT NULL DEFAULT 'active',
  enrolled_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cobra_coverages (
  id SERIAL PRIMARY KEY,
  employee_name TEXT NOT NULL,
  qualifying_event TEXT NOT NULL,
  plan_name TEXT NOT NULL,
  monthly_premium DOUBLE PRECISION NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'offered'
);

CREATE TABLE IF NOT EXISTS onboarding_tasks (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  title TEXT NOT NULL,
  owner_role TEXT NOT NULL,
  due_date TEXT NOT NULL,
  is_completed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS exit_requests (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  last_working_day TEXT NOT NULL,
  reason TEXT NOT NULL,
  it_cleared INTEGER NOT NULL DEFAULT 0,
  finance_cleared INTEGER NOT NULL DEFAULT 0,
  hr_cleared INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'in_clearance',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  id SERIAL PRIMARY KEY,
  asset_tag TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  serial_number TEXT NOT NULL,
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  assigned_employee_id INTEGER REFERENCES employees(id),
  cost DOUBLE PRECISION NOT NULL,
  purchase_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available'
);

CREATE TABLE IF NOT EXISTS company_policies (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  version TEXT NOT NULL,
  summary TEXT NOT NULL,
  published_at TEXT NOT NULL,
  requires_acknowledgement INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS policy_acknowledgements (
  policy_id INTEGER NOT NULL REFERENCES company_policies(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  acknowledged_at TEXT NOT NULL,
  PRIMARY KEY (policy_id, employee_id)
);

CREATE TABLE IF NOT EXISTS expenses (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  branch_id INTEGER NOT NULL REFERENCES branches(id),
  category TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  claim_date TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  approval_chain_json TEXT NOT NULL DEFAULT '["manager"]',
  current_step INTEGER NOT NULL DEFAULT 0,
  reimbursed_in_payroll_id INTEGER REFERENCES payrolls(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS loans (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  principal_amount DOUBLE PRECISION NOT NULL,
  interest_rate DOUBLE PRECISION NOT NULL DEFAULT 3.5,
  term_months INTEGER NOT NULL DEFAULT 12,
  monthly_installment DOUBLE PRECISION NOT NULL,
  remaining_balance DOUBLE PRECISION NOT NULL,
  purpose TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tickets (
  id SERIAL PRIMARY KEY,
  ticket_number TEXT NOT NULL UNIQUE,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  department TEXT NOT NULL,
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ticket_comments (
  id SERIAL PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_name TEXT NOT NULL,
  comment TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_rules (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  trigger_event TEXT NOT NULL,
  branch_id INTEGER REFERENCES branches(id),
  condition_field TEXT NOT NULL DEFAULT 'none',
  condition_operator TEXT NOT NULL DEFAULT 'always',
  condition_value DOUBLE PRECISION NOT NULL DEFAULT 0,
  approver_roles_json TEXT NOT NULL,
  webhook_event TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  scopes_json TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  last_used_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhooks (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  target_url TEXT NOT NULL,
  events_json TEXT NOT NULL,
  signing_secret TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id SERIAL PRIMARY KEY,
  webhook_id INTEGER NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  signature_header TEXT NOT NULL,
  http_status INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL,
  delivery_mode TEXT NOT NULL DEFAULT 'simulated',
  response_summary TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'system',
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  actor_email TEXT,
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  resource_id TEXT,
  before_data TEXT,
  after_data TEXT,
  ip_address TEXT,
  prev_hash TEXT NOT NULL,
  entry_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
