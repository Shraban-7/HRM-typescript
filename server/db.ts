import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  computeAuditEntryHash,
  DEFAULT_ANNUAL_TAX_BRACKETS,
  hashPassword,
  sha256Hex,
} from './domain/index';

const DB_PATH = process.env.HRM_DB_PATH || path.resolve(process.cwd(), 'data', 'nexus-hrm.sqlite');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS company_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS branches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      city TEXT NOT NULL,
      country TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'America/Chicago',
      currency_code TEXT NOT NULL DEFAULT 'USD',
      state_tax_rate REAL NOT NULL DEFAULT 0.0,
      cost_center TEXT NOT NULL,
      is_headquarters INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS departments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      branch_id INTEGER NOT NULL REFERENCES branches(id),
      parent_id INTEGER REFERENCES departments(id),
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      manager_employee_id INTEGER,
      budget REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      require_mfa INTEGER NOT NULL DEFAULT 0,
      is_system INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      annual_salary REAL NOT NULL,
      pre_tax_401k_pct REAL NOT NULL DEFAULT 4.0,
      bank_name TEXT,
      bank_account_number TEXT,
      emergency_contact_name TEXT,
      emergency_contact_phone TEXT,
      avatar_url TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tax_brackets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      min_income REAL NOT NULL,
      max_income REAL,
      rate REAL NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS payrolls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_code TEXT NOT NULL UNIQUE,
      branch_id INTEGER REFERENCES branches(id),
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      pay_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      employee_count INTEGER NOT NULL DEFAULT 0,
      total_gross REAL NOT NULL DEFAULT 0,
      total_pre_tax REAL NOT NULL DEFAULT 0,
      total_taxes REAL NOT NULL DEFAULT 0,
      total_net REAL NOT NULL DEFAULT 0,
      total_employer_taxes REAL NOT NULL DEFAULT 0,
      variance_pct REAL,
      anomaly_count INTEGER NOT NULL DEFAULT 0,
      approved_by INTEGER REFERENCES users(id),
      approved_at TEXT,
      finalized_at TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payslips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payroll_id INTEGER NOT NULL REFERENCES payrolls(id) ON DELETE CASCADE,
      employee_id INTEGER NOT NULL REFERENCES employees(id),
      base_monthly_salary REAL NOT NULL,
      proration_factor REAL NOT NULL DEFAULT 1.0,
      overtime_hours REAL NOT NULL DEFAULT 0,
      overtime_pay REAL NOT NULL DEFAULT 0,
      bonus_amount REAL NOT NULL DEFAULT 0,
      unpaid_leave_deduction REAL NOT NULL DEFAULT 0,
      gross_pay REAL NOT NULL,
      pre_tax_deductions REAL NOT NULL DEFAULT 0,
      taxable_gross REAL NOT NULL,
      federal_tax REAL NOT NULL,
      state_tax REAL NOT NULL,
      social_security_tax REAL NOT NULL,
      medicare_tax REAL NOT NULL,
      total_taxes REAL NOT NULL,
      post_tax_deductions REAL NOT NULL DEFAULT 0,
      loan_deduction REAL NOT NULL DEFAULT 0,
      expense_reimbursement REAL NOT NULL DEFAULT 0,
      total_deductions REAL NOT NULL,
      net_pay REAL NOT NULL,
      employer_cost REAL NOT NULL,
      variance_pct REAL,
      anomaly_flags_json TEXT NOT NULL DEFAULT '[]',
      is_locked INTEGER NOT NULL DEFAULT 0,
      issued_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      branch_id INTEGER REFERENCES branches(id),
      name TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      standard_hours REAL NOT NULL DEFAULT 8,
      overtime_multiplier REAL NOT NULL DEFAULT 1.5,
      grace_minutes INTEGER NOT NULL DEFAULT 15
    );

    CREATE TABLE IF NOT EXISTS attendances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL REFERENCES employees(id),
      branch_id INTEGER NOT NULL REFERENCES branches(id),
      work_date TEXT NOT NULL,
      clock_in TEXT,
      clock_out TEXT,
      worked_hours REAL NOT NULL DEFAULT 0,
      overtime_hours REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'present',
      source TEXT NOT NULL DEFAULT 'web',
      notes TEXT,
      UNIQUE(employee_id, work_date)
    );

    CREATE TABLE IF NOT EXISTS holidays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      branch_id INTEGER REFERENCES branches(id),
      name TEXT NOT NULL,
      holiday_date TEXT NOT NULL,
      is_recurring INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS leave_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL REFERENCES employees(id),
      branch_id INTEGER NOT NULL REFERENCES branches(id),
      leave_type TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      days REAL NOT NULL,
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
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      applicant_id INTEGER NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
      interviewer_name TEXT NOT NULL,
      scheduled_at TEXT NOT NULL,
      interview_type TEXT NOT NULL DEFAULT 'Technical Panel',
      status TEXT NOT NULL DEFAULT 'scheduled',
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS performance_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL REFERENCES employees(id),
      reviewer_name TEXT NOT NULL,
      cycle TEXT NOT NULL,
      self_rating REAL,
      manager_rating REAL NOT NULL,
      calibrated_rating REAL,
      bonus_pct REAL NOT NULL DEFAULT 0,
      summary TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'submitted',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL REFERENCES employees(id),
      title TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'Delivery',
      progress INTEGER NOT NULL DEFAULT 0,
      target_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'in_progress'
    );

    CREATE TABLE IF NOT EXISTS feedback_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_name TEXT NOT NULL,
      to_employee_id INTEGER NOT NULL REFERENCES employees(id),
      category TEXT NOT NULL DEFAULT 'Recognition',
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS benefits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      provider TEXT NOT NULL,
      tax_treatment TEXT NOT NULL DEFAULT 'pre_tax',
      employee_monthly_cost REAL NOT NULL,
      employer_monthly_cost REAL NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS benefit_enrollments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL REFERENCES employees(id),
      benefit_id INTEGER NOT NULL REFERENCES benefits(id),
      coverage_tier TEXT NOT NULL DEFAULT 'Employee Only',
      status TEXT NOT NULL DEFAULT 'active',
      enrolled_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cobra_coverages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_name TEXT NOT NULL,
      qualifying_event TEXT NOT NULL,
      plan_name TEXT NOT NULL,
      monthly_premium REAL NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'offered'
    );

    CREATE TABLE IF NOT EXISTS onboarding_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL REFERENCES employees(id),
      title TEXT NOT NULL,
      owner_role TEXT NOT NULL,
      due_date TEXT NOT NULL,
      is_completed INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS exit_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_tag TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      serial_number TEXT NOT NULL,
      branch_id INTEGER NOT NULL REFERENCES branches(id),
      assigned_employee_id INTEGER REFERENCES employees(id),
      cost REAL NOT NULL,
      purchase_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'available'
    );

    CREATE TABLE IF NOT EXISTS company_policies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL REFERENCES employees(id),
      branch_id INTEGER NOT NULL REFERENCES branches(id),
      category TEXT NOT NULL,
      amount REAL NOT NULL,
      claim_date TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      approval_chain_json TEXT NOT NULL DEFAULT '["manager"]',
      current_step INTEGER NOT NULL DEFAULT 0,
      reimbursed_in_payroll_id INTEGER REFERENCES payrolls(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS loans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL REFERENCES employees(id),
      principal_amount REAL NOT NULL,
      interest_rate REAL NOT NULL DEFAULT 3.5,
      term_months INTEGER NOT NULL DEFAULT 12,
      monthly_installment REAL NOT NULL,
      remaining_balance REAL NOT NULL,
      purpose TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      author_name TEXT NOT NULL,
      comment TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workflow_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      trigger_event TEXT NOT NULL,
      branch_id INTEGER REFERENCES branches(id),
      condition_field TEXT NOT NULL DEFAULT 'none',
      condition_operator TEXT NOT NULL DEFAULT 'always',
      condition_value REAL NOT NULL DEFAULT 0,
      approver_roles_json TEXT NOT NULL,
      webhook_event TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      target_url TEXT NOT NULL,
      events_json TEXT NOT NULL,
      signing_secret TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'system',
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  `);

  seedIfEmpty();
}

function appendSeedAudit(
  userId: number | null,
  actorEmail: string,
  action: string,
  resource: string,
  resourceId: string | null,
  afterObj: unknown,
  createdAt: string
) {
  const last = db
    .prepare('SELECT entry_hash FROM audit_logs ORDER BY id DESC LIMIT 1')
    .get() as { entry_hash: string } | undefined;
  const prevHash = last?.entry_hash ?? 'GENESIS';
  const afterData = JSON.stringify(afterObj);
  const entryHash = computeAuditEntryHash({
    userId,
    action,
    resource,
    resourceId,
    beforeData: null,
    afterData,
    ipAddress: '10.24.0.12',
    createdAt,
    prevHash,
  });
  db.prepare(
    `INSERT INTO audit_logs (user_id, actor_email, action, resource, resource_id, before_data, after_data, ip_address, prev_hash, entry_hash, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, '10.24.0.12', ?, ?, ?)`
  ).run(userId, actorEmail, action, resource, resourceId, afterData, prevHash, entryHash, createdAt);
}

function seedIfEmpty(): void {
  const count = db.prepare('SELECT COUNT(*) as c FROM branches').get() as { c: number };
  if (count.c > 0) return;

  const now = new Date().toISOString();

  // 1. Company Settings
  const settings: Array<[string, string, string]> = [
    ['company_name', 'Nexus Technologies Inc.', 'general'],
    ['company_email', 'people@nexushrm.io', 'general'],
    ['company_phone', '+1 (800) 555-0199', 'general'],
    ['company_address', '500 Innovation Parkway, Suite 1000, Austin, TX 78701', 'general'],
    ['company_website', 'https://nexustechnologies.io', 'general'],
    ['default_currency', 'USD', 'payroll'],
    ['pay_schedule', 'Monthly (Last Business Day)', 'payroll'],
    ['mfa_policy_admins', 'recommended', 'security'],
    ['max_login_attempts', '5', 'security'],
    ['admin_claimed', '0', 'security'],
  ];
  const insertSetting = db.prepare(
    'INSERT INTO company_settings (key, value, category, updated_at) VALUES (?, ?, ?, ?)'
  );
  for (const [k, v, cat] of settings) {
    insertSetting.run(k, v, cat, now);
  }

  // 2. Multi-Branch Locations
  const insertBranch = db.prepare(
    `INSERT INTO branches (code, name, city, country, timezone, currency_code, state_tax_rate, cost_center, is_headquarters, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`
  );
  const bAustin = Number(
    insertBranch.run('AUS-HQ', 'Austin HQ', 'Austin, TX', 'United States', 'America/Chicago', 'USD', 0.0, 'CC-100', 1, now).lastInsertRowid
  );
  const bNY = Number(
    insertBranch.run('NYC-EAST', 'New York East', 'New York, NY', 'United States', 'America/New_York', 'USD', 0.065, 'CC-200', 0, now).lastInsertRowid
  );
  const bLondon = Number(
    insertBranch.run('LDN-EMEA', 'London EMEA', 'London', 'United Kingdom', 'Europe/London', 'USD', 0.05, 'CC-300', 0, now).lastInsertRowid
  );
  const bSingapore = Number(
    insertBranch.run('SGP-APAC', 'Singapore APAC', 'Singapore', 'Singapore', 'Asia/Singapore', 'USD', 0.04, 'CC-400', 0, now).lastInsertRowid
  );

  // 3. Departments
  const insertDept = db.prepare(
    'INSERT INTO departments (branch_id, parent_id, name, code, budget, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const dPeople = Number(insertDept.run(bAustin, null, 'People & Talent', 'PPL', 680000, now).lastInsertRowid);
  const dEng = Number(insertDept.run(bAustin, null, 'Core Engineering', 'ENG', 2450000, now).lastInsertRowid);
  const dProduct = Number(insertDept.run(bAustin, null, 'Product & Design', 'PRD', 1120000, now).lastInsertRowid);
  const dFinance = Number(insertDept.run(bNY, null, 'Finance & Payroll', 'FIN', 940000, now).lastInsertRowid);
  const dSales = Number(insertDept.run(bNY, null, 'Enterprise Sales', 'SLS', 1850000, now).lastInsertRowid);
  const dEmea = Number(insertDept.run(bLondon, null, 'EMEA Operations', 'EMEA', 1220000, now).lastInsertRowid);
  const dApac = Number(insertDept.run(bSingapore, null, 'APAC Engineering', 'APAC', 1080000, now).lastInsertRowid);

  // 4. Permissions & Roles (Uniform RBAC)
  const perms: Array<[string, string, string]> = [
    ['dashboard.view', 'View Dashboards', 'dashboard'],
    ['employees.view', 'View Employee Directory', 'people'],
    ['employees.manage', 'Create & Edit Employees', 'people'],
    ['branches.manage', 'Manage Branches & Departments', 'people'],
    ['payroll.view', 'View Payroll Runs & Payslips', 'payroll'],
    ['payroll.run', 'Simulate & Approve Payroll', 'payroll'],
    ['payroll.finalize', 'Finalize & Lock Payroll', 'payroll'],
    ['tax.manage', 'Configure Tax Brackets', 'payroll'],
    ['benefits.view', 'View Benefits Catalog', 'benefits'],
    ['benefits.manage', 'Manage Benefits & COBRA', 'benefits'],
    ['attendance.view', 'View Team Attendance', 'attendance'],
    ['attendance.self', 'Clock In/Out & Self Leave', 'attendance'],
    ['attendance.manage', 'Manage Shifts & Biometric Sync', 'attendance'],
    ['leave.approve', 'Approve Leave Requests', 'attendance'],
    ['recruitment.view', 'View ATS Pipeline', 'recruitment'],
    ['recruitment.manage', 'Manage Jobs, Applicants & Hiring', 'recruitment'],
    ['performance.view', 'View Performance Reviews & OKRs', 'performance'],
    ['performance.manage', 'Manage Reviews & Calibration', 'performance'],
    ['ops.self', 'Submit Expenses, Loans & Tickets', 'operations'],
    ['ops.manage', 'Approve Expenses/Loans & Manage Assets', 'operations'],
    ['analytics.view', 'View Executive Analytics & Exports', 'analytics'],
    ['workflows.manage', 'Configure Custom Approval Workflows', 'analytics'],
    ['security.manage', 'Manage RBAC, MFA & Audit Logs', 'security'],
    ['developer.manage', 'Manage API Keys & Webhooks', 'developer'],
  ];

  const insertPerm = db.prepare('INSERT INTO permissions (slug, name, module) VALUES (?, ?, ?)');
  const permIds: Record<string, number> = {};
  for (const [slug, name, mod] of perms) {
    permIds[slug] = Number(insertPerm.run(slug, name, mod).lastInsertRowid);
  }

  const insertRole = db.prepare(
    'INSERT INTO roles (slug, name, description, require_mfa, is_system) VALUES (?, ?, ?, ?, 1)'
  );
  const rSuperAdmin = Number(
    insertRole.run('super_admin', 'Super Admin', 'Unrestricted enterprise governance, security, payroll, and API administration.', 1).lastInsertRowid
  );
  const rHrAdmin = Number(
    insertRole.run('hr_admin', 'HR & Payroll Admin', 'Full workforce lifecycle, statutory payroll, benefits, ATS, and analytics.', 1).lastInsertRowid
  );
  const rManager = Number(
    insertRole.run('manager', 'Branch Manager', 'Team directory, attendance oversight, leave/expense approvals, and reviews.', 0).lastInsertRowid
  );
  const rEmployee = Number(
    insertRole.run('employee', 'Employee', 'Employee self-service: clock-in, leave, payslips, benefits, expenses, and help desk.', 0).lastInsertRowid
  );

  const linkPerm = db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)');
  for (const pid of Object.values(permIds)) {
    linkPerm.run(rSuperAdmin, pid);
  }
  const hrPerms = perms
    .map((p) => p[0])
    .filter((s) => s !== 'security.manage' && s !== 'developer.manage');
  for (const slug of hrPerms) linkPerm.run(rHrAdmin, permIds[slug]);

  const managerPerms = [
    'dashboard.view',
    'employees.view',
    'attendance.view',
    'attendance.self',
    'leave.approve',
    'recruitment.view',
    'performance.view',
    'performance.manage',
    'benefits.view',
    'ops.self',
    'ops.manage',
    'analytics.view',
  ];
  for (const slug of managerPerms) linkPerm.run(rManager, permIds[slug]);

  const employeePerms = [
    'dashboard.view',
    'employees.view',
    'payroll.view',
    'benefits.view',
    'attendance.self',
    'performance.view',
    'ops.self',
  ];
  for (const slug of employeePerms) linkPerm.run(rEmployee, permIds[slug]);

  // 5. Users (salted scrypt hashes; default workspace credentials for preview + claimable override)
  const demoPassword = process.env.HRM_ADMIN_PASSCODE || 'NexusHR#2026';
  const pwHash = hashPassword(demoPassword);

  const insertUser = db.prepare(
    `INSERT INTO users (email, username, full_name, avatar_url, password_hash, status, mfa_enabled, created_at)
     VALUES (?, ?, ?, ?, ?, 'active', 0, ?)`
  );
  const uAdmin = Number(
    insertUser.run(
      'admin@nexushrm.io',
      'elena.vance',
      'Elena Vance',
      '/src/assets/images/avatar_vp_people_1795446546985.jpg',
      pwHash,
      now
    ).lastInsertRowid
  );
  const uHr = Number(
    insertUser.run('hr@nexushrm.io', 'claire.bennett', 'Claire Bennett', null, pwHash, now).lastInsertRowid
  );
  const uManager = Number(
    insertUser.run(
      'manager@nexushrm.io',
      'arjun.patel',
      'Arjun Patel',
      '/src/assets/images/avatar_branch_manager_1795446547221.jpg',
      pwHash,
      now
    ).lastInsertRowid
  );
  const uEmployee = Number(
    insertUser.run(
      'maya.lin@nexushrm.io',
      'maya.lin',
      'Maya Lin',
      '/src/assets/images/avatar_senior_engineer_1795446544652.jpg',
      pwHash,
      now
    ).lastInsertRowid
  );

  const linkRole = db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)');
  linkRole.run(uAdmin, rSuperAdmin);
  linkRole.run(uHr, rHrAdmin);
  linkRole.run(uManager, rManager);
  linkRole.run(uEmployee, rEmployee);

  // 6. Employees across 4 branches (12 realistic employees)
  const insertEmp = db.prepare(
    `INSERT INTO employees (
      user_id, branch_id, department_id, manager_id, employee_code, full_name, email, phone,
      designation, employment_type, hire_date, annual_salary, pre_tax_401k_pct,
      bank_name, bank_account_number, emergency_contact_name, emergency_contact_phone,
      avatar_url, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const eElena = Number(
    insertEmp.run(
      uAdmin, bAustin, dPeople, null, 'NX-1001', 'Elena Vance', 'admin@nexushrm.io', '+1 (512) 555-0101',
      'VP of People & Security', 'full_time', '2022-03-14', 198000, 6.0,
      'JPMorgan Chase', '440198237104', 'David Vance', '+1 (512) 555-0190',
      '/src/assets/images/avatar_vp_people_1795446546985.jpg', 'active', now
    ).lastInsertRowid
  );

  const eArjun = Number(
    insertEmp.run(
      uManager, bAustin, dEng, eElena, 'NX-1002', 'Arjun Patel', 'manager@nexushrm.io', '+1 (512) 555-0102',
      'Director of Engineering', 'full_time', '2022-07-01', 186000, 5.0,
      'Silicon Valley Commercial', '882104938219', 'Priya Patel', '+1 (512) 555-0191',
      '/src/assets/images/avatar_branch_manager_1795446547221.jpg', 'active', now
    ).lastInsertRowid
  );

  const eClaire = Number(
    insertEmp.run(
      uHr, bNY, dFinance, eElena, 'NX-1003', 'Claire Bennett', 'hr@nexushrm.io', '+1 (212) 555-0144',
      'Head of Payroll & HR Ops', 'full_time', '2023-01-16', 154000, 5.0,
      'Citibank NA', '771029384410', 'Martin Bennett', '+1 (212) 555-0192',
      null, 'active', now
    ).lastInsertRowid
  );

  const eMaya = Number(
    insertEmp.run(
      uEmployee, bAustin, dEng, eArjun, 'NX-1004', 'Maya Lin', 'maya.lin@nexushrm.io', '+1 (512) 555-0104',
      'Staff Software Engineer', 'full_time', '2023-06-05', 168000, 6.0,
      'Mercury Business', '310948271655', 'Grace Lin', '+1 (512) 555-0193',
      '/src/assets/images/avatar_senior_engineer_1795446544652.jpg', 'active', now
    ).lastInsertRowid
  );

  const eMarcus = Number(
    insertEmp.run(
      null, bAustin, dProduct, eElena, 'NX-1005', 'Marcus Holloway', 'marcus.h@nexushrm.io', '+1 (512) 555-0118',
      'Principal Product Designer', 'full_time', '2023-09-11', 152000, 4.0,
      'Bank of America', '501928374612', 'Tanya Holloway', '+1 (512) 555-0194',
      null, 'active', now
    ).lastInsertRowid
  );

  const eSofia = Number(
    insertEmp.run(
      null, bNY, dSales, eClaire, 'NX-1006', 'Sofia Alvarez', 'sofia.alvarez@nexushrm.io', '+1 (212) 555-0172',
      'Enterprise Account Executive', 'full_time', '2024-02-05', 142000, 4.0,
      'Chase Private', '661928374901', 'Carlos Alvarez', '+1 (212) 555-0195',
      null, 'active', now
    ).lastInsertRowid
  );

  const eOliver = Number(
    insertEmp.run(
      null, bLondon, dEmea, eElena, 'NX-1007', 'Oliver Grant', 'oliver.grant@nexushrm.io', '+44 20 7946 0912',
      'EMEA Operations Lead', 'full_time', '2024-04-22', 138000, 5.0,
      'Barclays UK', '209481726344', 'Hannah Grant', '+44 20 7946 0999',
      null, 'active', now
    ).lastInsertRowid
  );

  const eAmara = Number(
    insertEmp.run(
      null, bLondon, dEmea, eOliver, 'NX-1008', 'Amara Okafor', 'amara.okafor@nexushrm.io', '+44 20 7946 0921',
      'Compliance Counsel', 'full_time', '2024-08-12', 146000, 5.0,
      'HSBC UK', '904817263511', 'Chidi Okafor', '+44 20 7946 0991',
      null, 'active', now
    ).lastInsertRowid
  );

  const eKenji = Number(
    insertEmp.run(
      null, bSingapore, dApac, eArjun, 'NX-1009', 'Kenji Takahashi', 'kenji.t@nexushrm.io', '+65 6789 4310',
      'APAC Systems Architect', 'full_time', '2025-01-13', 162000, 4.0,
      'DBS Bank', '118293047561', 'Yumi Takahashi', '+65 6789 4399',
      null, 'active', now
    ).lastInsertRowid
  );

  const eLiam = Number(
    insertEmp.run(
      null, bAustin, dEng, eArjun, 'NX-1010', 'Liam O\'Connor', 'liam.oconnor@nexushrm.io', '+1 (512) 555-0163',
      'Backend Platform Engineer', 'full_time', '2026-11-10', 134000, 4.0,
      'Wells Fargo', '729104827361', 'Nora O\'Connor', '+1 (512) 555-0196',
      null, 'active', now
    ).lastInsertRowid
  );

  const eNadia = Number(
    insertEmp.run(
      null, bSingapore, dApac, eKenji, 'NX-1011', 'Nadia Rahman', 'nadia.rahman@nexushrm.io', '+65 6789 4355',
      'Security Reliability Engineer', 'full_time', '2025-05-19', 148000, 5.0,
      'OCBC Bank', '659012837412', 'Farid Rahman', '+65 6789 4390',
      null, 'active', now
    ).lastInsertRowid
  );

  const eDevon = Number(
    insertEmp.run(
      null, bNY, dFinance, eClaire, 'NX-1012', 'Devon Brooks', 'devon.brooks@nexushrm.io', '+1 (212) 555-0189',
      'Senior Financial Analyst', 'full_time', '2024-11-04', 118000, 4.0,
      'Capital One', '394857102938', 'Rachel Brooks', '+1 (212) 555-0197',
      null, 'active', now
    ).lastInsertRowid
  );

  db.prepare('UPDATE departments SET manager_employee_id = ? WHERE id = ?').run(eElena, dPeople);
  db.prepare('UPDATE departments SET manager_employee_id = ? WHERE id = ?').run(eArjun, dEng);
  db.prepare('UPDATE departments SET manager_employee_id = ? WHERE id = ?').run(eMarcus, dProduct);
  db.prepare('UPDATE departments SET manager_employee_id = ? WHERE id = ?').run(eClaire, dFinance);
  db.prepare('UPDATE departments SET manager_employee_id = ? WHERE id = ?').run(eSofia, dSales);
  db.prepare('UPDATE departments SET manager_employee_id = ? WHERE id = ?').run(eOliver, dEmea);
  db.prepare('UPDATE departments SET manager_employee_id = ? WHERE id = ?').run(eKenji, dApac);

  // 7. Tax Brackets
  const insertBracket = db.prepare(
    'INSERT INTO tax_brackets (label, min_income, max_income, rate, sort_order) VALUES (?, ?, ?, ?, ?)'
  );
  DEFAULT_ANNUAL_TAX_BRACKETS.forEach((b, idx) => {
    insertBracket.run(b.label ?? `Tier ${idx + 1}`, b.min, b.max, b.rate, idx + 1);
  });

  // 8. Benefits & Enrollments + COBRA
  const insertBenefit = db.prepare(
    `INSERT INTO benefits (name, category, provider, tax_treatment, employee_monthly_cost, employer_monthly_cost, is_active)
     VALUES (?, ?, ?, ?, ?, ?, 1)`
  );
  const benHealth = Number(insertBenefit.run('PPO Platinum Medical Plan', 'Health', 'Aetna Enterprise', 'pre_tax', 220, 680).lastInsertRowid);
  const benDental = Number(insertBenefit.run('Comprehensive Dental & Ortho', 'Dental', 'Delta Dental', 'pre_tax', 45, 95).lastInsertRowid);
  const benVision = Number(insertBenefit.run('Vision Plus Network', 'Vision', 'VSP Corporate', 'post_tax', 18, 28).lastInsertRowid);
  const ben401k = Number(insertBenefit.run('401(k) Safe Harbor 4% Match', 'Retirement', 'Fidelity NetBenefits', 'pre_tax', 0, 450).lastInsertRowid);

  const insertEnroll = db.prepare(
    'INSERT INTO benefit_enrollments (employee_id, benefit_id, coverage_tier, status, enrolled_at) VALUES (?, ?, ?, ?, ?)'
  );
  for (const eid of [eElena, eArjun, eClaire, eMaya, eMarcus, eSofia, eOliver, eAmara, eKenji, eLiam, eNadia, eDevon]) {
    insertEnroll.run(eid, benHealth, eid === eElena || eid === eArjun ? 'Family' : 'Employee Only', 'active', '2026-01-01');
    insertEnroll.run(eid, benDental, 'Employee Only', 'active', '2026-01-01');
    if (eid % 2 === 0) insertEnroll.run(eid, benVision, 'Employee Only', 'active', '2026-01-01');
    insertEnroll.run(eid, ben401k, 'Employee Only', 'active', '2026-01-01');
  }

  db.prepare(
    `INSERT INTO cobra_coverages (employee_name, qualifying_event, plan_name, monthly_premium, start_date, end_date, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run('Jordan Reyes', 'Voluntary Separation', 'PPO Platinum Medical Plan', 918.0, '2026-09-01', '2028-02-28', 'elected');

  // 9. Shifts, Holidays & Attendance
  const insertShift = db.prepare(
    'INSERT INTO shifts (branch_id, name, start_time, end_time, standard_hours, overtime_multiplier, grace_minutes) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  insertShift.run(bAustin, 'Austin Core Flex (CST)', '09:00', '17:30', 8, 1.5, 15);
  insertShift.run(bNY, 'New York Market Hours (EST)', '08:30', '17:00', 8, 1.5, 10);
  insertShift.run(bLondon, 'London EMEA Standard (GMT)', '09:00', '17:30', 8, 1.5, 15);
  insertShift.run(bSingapore, 'Singapore APAC Engineering (SGT)', '09:30', '18:00', 8, 2.0, 15);

  const insertHoliday = db.prepare(
    'INSERT INTO holidays (branch_id, name, holiday_date, is_recurring) VALUES (?, ?, ?, 1)'
  );
  insertHoliday.run(null, "New Year's Day", '2026-01-01');
  insertHoliday.run(bAustin, 'Thanksgiving Day (US)', '2026-11-26');
  insertHoliday.run(bNY, 'Thanksgiving Day (US)', '2026-11-26');
  insertHoliday.run(bLondon, 'Boxing Day (UK)', '2026-12-26');
  insertHoliday.run(bSingapore, 'Deepavali (SG)', '2026-11-08');
  insertHoliday.run(null, 'Christmas Day', '2026-12-25');

  const insertAtt = db.prepare(
    `INSERT INTO attendances (employee_id, branch_id, work_date, clock_in, clock_out, worked_hours, overtime_hours, status, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const recentDates = ['2026-11-18', '2026-11-19', '2026-11-20', '2026-11-23'];
  const attEmpList = [
    [eElena, bAustin], [eArjun, bAustin], [eClaire, bNY], [eMaya, bAustin],
    [eMarcus, bAustin], [eSofia, bNY], [eOliver, bLondon], [eKenji, bSingapore],
    [eLiam, bAustin], [eNadia, bSingapore],
  ];
  for (const d of recentDates) {
    for (const [eid, bid] of attEmpList) {
      const isToday = d === '2026-11-23';
      const extraOt = eid === eMaya && !isToday ? 2.5 : eid === eKenji && !isToday ? 1.5 : 0;
      const isLate = eid === eMarcus && d === '2026-11-20';
      const clockIn = isLate ? `${d}T09:28:00Z` : `${d}T08:55:00Z`;
      const clockOut = isToday && eid === eMaya ? null : `${d}T${extraOt > 0 ? '19:30' : '17:10'}:00Z`;
      const worked = clockOut ? 8 + extraOt : 0;
      insertAtt.run(
        eid, bid, d, clockIn, clockOut, worked, extraOt,
        isLate ? 'late' : 'present',
        bid === bSingapore ? 'biometric' : 'web'
      );
    }
  }

  // 10. Custom Approval Workflows
  const insertRule = db.prepare(
    `INSERT INTO workflow_rules (name, trigger_event, branch_id, condition_field, condition_operator, condition_value, approver_roles_json, webhook_event, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
  );
  insertRule.run('Extended Leave Dual Sign-Off (> 5 days)', 'leave.submitted', null, 'days', 'gt', 5, JSON.stringify(['manager', 'hr_admin']), 'leave.escalated', now);
  insertRule.run('High-Value Expense Finance Review (>= $500)', 'expense.submitted', null, 'amount', 'gte', 500, JSON.stringify(['manager', 'hr_admin']), 'expense.escalated', now);
  insertRule.run('Employee Loan Dual Approval (>= $2,500)', 'loan.submitted', null, 'amount', 'gte', 2500, JSON.stringify(['manager', 'hr_admin']), 'loan.escalated', now);
  insertRule.run('New Hire Onboarding & Provisioning Dispatch', 'employee.hired', null, 'none', 'always', 0, JSON.stringify(['hr_admin']), 'employee.hired', now);

  // 11. Leave Requests
  const insertLeave = db.prepare(
    `INSERT INTO leave_requests (employee_id, branch_id, leave_type, start_date, end_date, days, reason, status, approval_chain_json, current_step, approvals_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertLeave.run(eMaya, bAustin, 'annual', '2026-12-21', '2026-12-24', 4, 'Winter family travel to Seattle', 'pending', '["manager"]', 0, '[]', now);
  insertLeave.run(eSofia, bNY, 'annual', '2026-12-07', '2026-12-15', 7, 'Extended international holiday', 'pending', '["manager","hr_admin"]', 0, '[]', now);
  insertLeave.run(eKenji, bSingapore, 'sick', '2026-11-16', '2026-11-17', 2, 'Dental recovery and rest', 'approved', '["manager"]', 1, '[{"role":"manager","actor":"Arjun Patel","at":"2026-11-16T07:12:00Z"}]', now);

  // 12. Historical Finalized Payroll (October 2026) + Draft November 2026 Payroll
  const insertPayroll = db.prepare(
    `INSERT INTO payrolls (run_code, branch_id, period_start, period_end, pay_date, status, employee_count, total_gross, total_pre_tax, total_taxes, total_net, total_employer_taxes, variance_pct, anomaly_count, approved_by, approved_at, finalized_at, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const pOct = Number(
    insertPayroll.run(
      'PR-2026-10', null, '2026-10-01', '2026-10-31', '2026-10-30', 'finalized', 11,
      141166.67, 9491.67, 36842.18, 94616.82, 10799.25, 1.2, 0,
      uAdmin, '2026-10-28T15:30:00Z', '2026-10-29T18:00:00Z', uHr, '2026-10-25T09:00:00Z'
    ).lastInsertRowid
  );

  // Seed historical payslips for Oct 2026 (all employees except Liam who joined Nov 10)
  const insertSlip = db.prepare(
    `INSERT INTO payslips (
      payroll_id, employee_id, base_monthly_salary, proration_factor, overtime_hours, overtime_pay,
      bonus_amount, unpaid_leave_deduction, gross_pay, pre_tax_deductions, taxable_gross,
      federal_tax, state_tax, social_security_tax, medicare_tax, total_taxes,
      post_tax_deductions, loan_deduction, expense_reimbursement, total_deductions,
      net_pay, employer_cost, variance_pct, anomaly_flags_json, is_locked, issued_at
    ) VALUES (?, ?, ?, 1.0, 0, 0, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, 0.0, '[]', 1, '2026-10-29T18:00:00Z')`
  );
  const octEmps = db
    .prepare(`SELECT e.id, e.annual_salary, e.pre_tax_401k_pct, b.state_tax_rate FROM employees e JOIN branches b ON b.id = e.branch_id WHERE e.hire_date < '2026-11-01'`)
    .all() as Array<{ id: number; annual_salary: number; pre_tax_401k_pct: number; state_tax_rate: number }>;

  let octGross = 0;
  let octPre = 0;
  let octTax = 0;
  let octNet = 0;
  let octEmpTax = 0;

  for (const emp of octEmps) {
    const monthly = Math.round((emp.annual_salary / 12) * 100) / 100;
    const preTax = Math.round((265 + monthly * (emp.pre_tax_401k_pct / 100)) * 100) / 100;
    const taxable = Math.round((monthly - preTax) * 100) / 100;
    const fed = Math.round(taxable * 0.175 * 100) / 100;
    const st = Math.round(taxable * emp.state_tax_rate * 100) / 100;
    const ss = Math.round(monthly * 0.062 * 100) / 100;
    const med = Math.round(monthly * 0.0145 * 100) / 100;
    const totTax = Math.round((fed + st + ss + med) * 100) / 100;
    const post = emp.id % 2 === 0 ? 18 : 0;
    const totDed = Math.round((preTax + totTax + post) * 100) / 100;
    const net = Math.round((monthly - totDed) * 100) / 100;
    const empCost = Math.round((monthly + ss + med) * 100) / 100;
    insertSlip.run(pOct, emp.id, monthly, monthly, preTax, taxable, fed, st, ss, med, totTax, post, totDed, net, empCost);
    octGross += monthly;
    octPre += preTax;
    octTax += totTax;
    octNet += net;
    octEmpTax += ss + med;
  }
  db.prepare(
    'UPDATE payrolls SET employee_count = ?, total_gross = ?, total_pre_tax = ?, total_taxes = ?, total_net = ?, total_employer_taxes = ? WHERE id = ?'
  ).run(
    octEmps.length,
    Math.round(octGross * 100) / 100,
    Math.round(octPre * 100) / 100,
    Math.round(octTax * 100) / 100,
    Math.round(octNet * 100) / 100,
    Math.round(octEmpTax * 100) / 100,
    pOct
  );

  // Draft November 2026 cycle ready for simulation & approval
  insertPayroll.run(
    'PR-2026-11', null, '2026-11-01', '2026-11-30', '2026-11-30', 'draft', 0,
    0, 0, 0, 0, 0, null, 0, null, null, null, uHr, now
  );

  // 13. Recruitment Jobs, Applicants & Interviews
  const insertJob = db.prepare(
    `INSERT INTO job_posts (branch_id, department_id, title, employment_type, salary_range, description, requirements, status, closing_date, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`
  );
  const j1 = Number(
    insertJob.run(
      bAustin, dEng, 'Senior Distributed Systems Engineer', 'full_time', '$165,000 – $195,000',
      'Lead core payroll ledger and high-throughput workforce event services across multi-region clusters.',
      '6+ years TypeScript/Go/Node, distributed transactions, PostgreSQL/SQLite internals, security-first engineering.',
      '2026-12-31', now
    ).lastInsertRowid
  );
  const j2 = Number(
    insertJob.run(
      bLondon, dEmea, 'EMEA Payroll & Statutory Compliance Manager', 'full_time', '$125,000 – $145,000',
      'Own UK and European statutory reporting, payroll governance, and regional HR policy alignment.',
      'CIPP qualification or equivalent, 5+ years multi-jurisdiction payroll operations.',
      '2026-12-20', now
    ).lastInsertRowid
  );
  const j3 = Number(
    insertJob.run(
      bSingapore, dApac, 'Staff Security Infrastructure Engineer', 'full_time', '$155,000 – $180,000',
      'Architect zero-trust identity, SOC 2 controls, and webhook security pipelines.',
      'Hands-on IAM, WebAuthn/TOTP, audit cryptography, cloud security posture.',
      '2027-01-15', now
    ).lastInsertRowid
  );

  const insertApp = db.prepare(
    `INSERT INTO applicants (job_post_id, full_name, email, phone, source, stage, rating, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const a1 = Number(insertApp.run(j1, 'Hannah Lindqvist', 'hannah.lindqvist@example.com', '+1 (512) 555-0240', 'Career Portal', 'interview', 5, 'Strong systems design background in fintech ledgers.', now).lastInsertRowid);
  const a2 = Number(insertApp.run(j1, 'Mateo Rivera', 'mateo.rivera@example.com', '+1 (415) 555-0812', 'Employee Referral', 'offer', 5, 'Passed panel unanimously; offer drafted.', now).lastInsertRowid);
  insertApp.run(j2, 'Chloe Sterling', 'chloe.sterling@example.com', '+44 7700 900412', 'LinkedIn', 'screening', 4, 'CIPP certified, strong UK/EU statutory background.', now);
  insertApp.run(j3, 'Wei-Lin Tan', 'weilin.tan@example.com', '+65 9123 4418', 'Career Portal', 'applied', 4, 'Zero-trust IAM lead at regional fintech.', now);

  db.prepare(
    `INSERT INTO interviews (applicant_id, interviewer_name, scheduled_at, interview_type, status, notes)
     VALUES (?, ?, ?, ?, 'scheduled', ?)`
  ).run(a1, 'Arjun Patel', '2026-11-25T16:00:00Z', 'Architecture Deep Dive', 'Focus on idempotent payroll state transitions');
  db.prepare(
    `INSERT INTO interviews (applicant_id, interviewer_name, scheduled_at, interview_type, status, notes)
     VALUES (?, ?, ?, ?, 'completed', ?)`
  ).run(a2, 'Elena Vance', '2026-11-21T15:00:00Z', 'Executive Culture & Values', 'Strong hire recommendation');

  // 14. Performance Reviews, OKRs & 360 Feedback
  const insertRev = db.prepare(
    `INSERT INTO performance_reviews (employee_id, reviewer_name, cycle, self_rating, manager_rating, calibrated_rating, bonus_pct, summary, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertRev.run(eMaya, 'Arjun Patel', 'H2 2026', 4.6, 4.8, 4.8, 10.0, 'Led zero-downtime payroll engine migration and mentored 3 engineers.', 'calibrated', now);
  insertRev.run(eSofia, 'Claire Bennett', 'H2 2026', 4.3, 4.4, 4.2, 6.0, 'Exceeded enterprise ARR quota by 124% in Northeast territory.', 'calibrated', now);
  insertRev.run(eKenji, 'Arjun Patel', 'H2 2026', 4.5, 4.7, null, 8.0, 'Delivered APAC biometric sync gateway ahead of SLA.', 'submitted', now);
  insertRev.run(eMarcus, 'Elena Vance', 'H2 2026', 4.2, 4.3, null, 5.0, 'Shipped unified executive design system across all HR workflows.', 'submitted', now);

  const insertGoal = db.prepare(
    'INSERT INTO goals (employee_id, title, category, progress, target_date, status) VALUES (?, ?, ?, ?, ?, ?)'
  );
  insertGoal.run(eMaya, 'Achieve 99.99% Payroll Ledger Determinism & Audit Coverage', 'Engineering', 88, '2026-12-15', 'in_progress');
  insertGoal.run(eArjun, 'Scale Austin & APAC Engineering Velocity by 25%', 'Leadership', 74, '2026-12-31', 'in_progress');
  insertGoal.run(eClaire, 'Automate Q4 Multi-Branch Statutory Filing Exports', 'Compliance', 92, '2026-12-20', 'in_progress');
  insertGoal.run(eOliver, 'Complete EMEA ISO 27001 People Operations Audit', 'Compliance', 100, '2026-11-15', 'completed');

  db.prepare(
    'INSERT INTO feedback_entries (from_name, to_employee_id, category, message, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run('Arjun Patel', eMaya, 'Recognition', 'Exceptional clarity during the statutory tax edge-case review — caught the FICA wage cap boundary early.', now);
  db.prepare(
    'INSERT INTO feedback_entries (from_name, to_employee_id, category, message, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run('Elena Vance', eClaire, 'Leadership', 'Seamless rollout of branch-level holiday calendars across London and Singapore.', now);

  // 15. Onboarding & Exit Clearances
  const insertOnb = db.prepare(
    'INSERT INTO onboarding_tasks (employee_id, title, owner_role, due_date, is_completed) VALUES (?, ?, ?, ?, ?)'
  );
  insertOnb.run(eLiam, 'Verify Government ID & W-4 Tax Withholding', 'hr_admin', '2026-11-14', 1);
  insertOnb.run(eLiam, 'Provision MacBook Pro & Enroll Hardware MFA Key', 'it_ops', '2026-11-18', 1);
  insertOnb.run(eLiam, 'Acknowledge Information Security & Data Protection Policy', 'employee', '2026-11-26', 0);
  insertOnb.run(eLiam, 'Complete 30-Day Architecture Orientation with Arjun Patel', 'manager', '2026-12-05', 0);

  db.prepare(
    `INSERT INTO exit_requests (employee_id, last_working_day, reason, it_cleared, finance_cleared, hr_cleared, status, created_at)
     VALUES (?, ?, ?, 1, 0, 0, 'in_clearance', ?)`
  ).run(eDevon, '2026-12-15', 'Relocation for graduate studies', now);

  // 16. Assets, Policies, Expenses, Loans, Help Desk
  const insertAsset = db.prepare(
    `INSERT INTO assets (asset_tag, category, name, serial_number, branch_id, assigned_employee_id, cost, purchase_date, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertAsset.run('LAP-2026-001', 'Workstation', 'Apple MacBook Pro 16" M4 Max', 'C02NX991042', bAustin, eMaya, 3499, '2026-03-10', 'assigned');
  insertAsset.run('LAP-2026-002', 'Workstation', 'Apple MacBook Pro 14" M4 Pro', 'C02NX991088', bAustin, eLiam, 2499, '2026-11-05', 'assigned');
  insertAsset.run('MON-2026-014', 'Display', 'Dell UltraSharp 32" 6K USB-C Hub', 'DLU32K8821', bNY, eClaire, 1299, '2026-05-18', 'assigned');
  insertAsset.run('SEC-2026-041', 'Security Key', 'YubiKey 5C NFC Enterprise Pack', 'YK5C-883920', bSingapore, null, 85, '2026-09-02', 'available');
  insertAsset.run('LAP-2026-009', 'Workstation', 'Lenovo ThinkPad X1 Carbon Gen 12', 'PF4NX77219', bLondon, null, 2199, '2026-10-01', 'available');

  const insertPolicy = db.prepare(
    `INSERT INTO company_policies (title, category, version, summary, published_at, requires_acknowledgement)
     VALUES (?, ?, ?, ?, ?, 1)`
  );
  const pol1 = Number(insertPolicy.run('Information Security & Acceptable Use Policy', 'Security', 'v3.2', 'Mandatory MFA, encrypted workstation storage, zero-trust API credential handling, and incident SLA.', '2026-09-01').lastInsertRowid);
  const pol2 = Number(insertPolicy.run('Global Hybrid & Multi-Branch Work Policy', 'Workplace', 'v2.1', 'Branch core hours, travel reimbursement caps, and international work-from-anywhere compliance.', '2026-10-01').lastInsertRowid);
  const pol3 = Number(insertPolicy.run('Code of Ethics & Anti-Harassment Charter', 'Compliance', 'v4.0', 'Workplace conduct, whistleblower protections, and conflict-of-interest disclosure requirements.', '2026-01-15').lastInsertRowid);

  const insertAck = db.prepare(
    'INSERT INTO policy_acknowledgements (policy_id, employee_id, acknowledged_at) VALUES (?, ?, ?)'
  );
  for (const eid of [eElena, eArjun, eClaire, eMaya, eMarcus, eSofia, eOliver]) {
    insertAck.run(pol1, eid, '2026-09-10T14:00:00Z');
    insertAck.run(pol3, eid, '2026-02-01T10:30:00Z');
  }
  insertAck.run(pol2, eElena, '2026-10-04T09:00:00Z');

  const insertExpense = db.prepare(
    `INSERT INTO expenses (employee_id, branch_id, category, amount, claim_date, description, status, approval_chain_json, current_step, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertExpense.run(eMaya, bAustin, 'Software & Cloud', 189.0, '2026-11-18', 'Annual JetBrains & profiling license renewal', 'approved', '["manager"]', 1, now);
  insertExpense.run(eSofia, bNY, 'Business Travel', 845.5, '2026-11-20', 'Amtrak Acela + client dinner in Boston for Q4 renewal', 'pending', '["manager","hr_admin"]', 0, now);
  insertExpense.run(eOliver, bLondon, 'Client Hospitality', 320.0, '2026-11-21', 'EMEA partner advisory roundtable lunch', 'pending', '["manager"]', 0, now);

  const insertLoan = db.prepare(
    `INSERT INTO loans (employee_id, principal_amount, interest_rate, term_months, monthly_installment, remaining_balance, purpose, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertLoan.run(eMaya, 3000, 3.0, 12, 257.5, 2317.5, 'Home office ergonomic workstation upgrade', 'active', now);
  insertLoan.run(eLiam, 4000, 2.5, 16, 256.25, 4000, 'Austin relocation deposit advance', 'pending', now);

  const insertTicket = db.prepare(
    `INSERT INTO tickets (ticket_number, employee_id, department, subject, description, priority, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const t1 = Number(insertTicket.run('HD-2026-104', eMaya, 'Payroll', 'Confirm 401(k) pre-tax withholding on November cycle', 'Please verify my updated 6% 401(k) election will apply prior to federal withholding on PR-2026-11.', 'medium', 'in_progress', now).lastInsertRowid);
  insertTicket.run('HD-2026-105', eLiam, 'IT & Security', 'Request VPN certificate for Austin Staging Cluster', 'Need branch VPN profile enabled before sprint kickoff.', 'high', 'open', now);

  db.prepare('INSERT INTO ticket_comments (ticket_id, author_name, comment, created_at) VALUES (?, ?, ?, ?)').run(
    t1, 'Claire Bennett', 'Confirmed — your 6% pre-tax election is active on your profile and reflected in the PR-2026-11 simulation.', now
  );

  // 17. Developer Platform: Scoped API Keys & Webhooks
  const rawSeedKey = 'nxhrm_live_demo_read_9a4f2c8e1b7d3056';
  db.prepare(
    `INSERT INTO api_keys (name, key_prefix, key_hash, scopes_json, created_by, last_used_at, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
  ).run(
    'Workforce BI Sync Connector',
    'nxhrm_live_demo',
    sha256Hex(rawSeedKey),
    JSON.stringify(['employees:read', 'branches:read', 'attendance:read', 'payroll:read']),
    uAdmin,
    '2026-11-23T05:45:00Z',
    now
  );

  const whSecret = process.env.HRM_WEBHOOK_SIGNING_SECRET || `whsec_${crypto.randomBytes(16).toString('hex')}`;
  const wh1 = Number(
    db.prepare(
      `INSERT INTO webhooks (name, target_url, events_json, signing_secret, is_active, created_at)
       VALUES (?, ?, ?, ?, 1, ?)`
    ).run(
      'NetSuite ERP Payroll Sync',
      'https://erp-hooks.nexustechnologies.io/v1/payroll-ledger',
      JSON.stringify(['payroll.finalized', 'employee.hired', 'expense.approved']),
      whSecret,
      now
    ).lastInsertRowid
  );
  db.prepare(
    `INSERT INTO webhook_deliveries (webhook_id, event_name, payload_json, signature_header, http_status, latency_ms, delivery_mode, response_summary, created_at)
     VALUES (?, ?, ?, ?, 200, 118, 'delivered', ?, ?)`
  ).run(
    wh1,
    'payroll.finalized',
    JSON.stringify({ event: 'payroll.finalized', runCode: 'PR-2026-10', employeeCount: 11, totalNet: Math.round(octNet * 100) / 100 }),
    't=1761760800,v1=7f4b2c89e1a04d5c3b2f1098a7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8',
    '200 OK — Ledger batch accepted by ERP gateway',
    '2026-10-29T18:00:05Z'
  );

  // 18. Notifications
  const insertNotif = db.prepare(
    'INSERT INTO notifications (user_id, title, message, category, is_read, created_at) VALUES (?, ?, ?, ?, 0, ?)'
  );
  insertNotif.run(uAdmin, 'November Payroll Ready for Simulation', 'PR-2026-11 is drafted with 12 active employees including 1 prorated mid-month hire.', 'payroll', now);
  insertNotif.run(uAdmin, '2 Escalated Approvals Pending', 'Sofia Alvarez submitted a 7-day leave and an $845.50 travel claim requiring dual sign-off.', 'workflow', now);
  insertNotif.run(uManager, 'Team Leave & Expense Queue', 'Maya Lin and Sofia Alvarez have pending requests awaiting your review.', 'workflow', now);
  insertNotif.run(uEmployee, 'October Payslip Available', 'Your finalized payslip for PR-2026-10 is ready to view and download.', 'payroll', now);

  // 19. Tamper-Evident Seed Audit Chain
  appendSeedAudit(uAdmin, 'admin@nexushrm.io', 'system.initialized', 'company_settings', 'nexus', { branches: 4, employees: 12 }, '2026-10-01T08:00:00Z');
  appendSeedAudit(uHr, 'hr@nexushrm.io', 'payroll.finalized', 'payrolls', String(pOct), { runCode: 'PR-2026-10', status: 'finalized', employeeCount: octEmps.length }, '2026-10-29T18:00:00Z');
  appendSeedAudit(uAdmin, 'admin@nexushrm.io', 'employee.hired', 'employees', String(eLiam), { employeeCode: 'NX-1010', branch: 'Austin HQ', hireDate: '2026-11-10' }, '2026-11-10T09:15:00Z');
  appendSeedAudit(uAdmin, 'admin@nexushrm.io', 'workflow.rule_created', 'workflow_rules', '1', { name: 'Extended Leave Dual Sign-Off (> 5 days)' }, '2026-11-12T11:30:00Z');
}
