import test from 'node:test';
import assert from 'node:assert/strict';
import type { AuditLogEntry } from '../types/hrm';
import {
  classifyAuditCategory,
  computeAuditCategoryCounts,
  extractAuditDiffFields,
  filterAuditEntries,
  formatAuditActionLabel,
  formatAuditTimestamp,
  summarizeAuditChanges,
} from './auditLog';

const SAMPLE_ENTRIES: AuditLogEntry[] = [
  {
    id: 1,
    actor_email: 'admin@nexushrm.io',
    action: 'system.initialized',
    resource: 'company_settings',
    resource_id: 'nexus',
    before_data: null,
    after_data: JSON.stringify({ branches: 4, employees: 12 }),
    ip_address: '10.24.0.12',
    entry_hash: 'abcdef1234567890abcdef1234567890',
    created_at: '2026-10-01T08:00:00Z',
  },
  {
    id: 2,
    actor_email: 'hr@nexushrm.io',
    action: 'payroll.finalized',
    resource: 'payrolls',
    resource_id: '10',
    before_data: JSON.stringify({ status: 'approved' }),
    after_data: JSON.stringify({ runCode: 'PR-2026-10', status: 'finalized', employeeCount: 11 }),
    ip_address: '10.24.0.12',
    entry_hash: '1234567890abcdef1234567890abcdef',
    created_at: '2026-10-29T18:00:00Z',
  },
  {
    id: 3,
    actor_email: 'admin@nexushrm.io',
    action: 'employee.hired',
    resource: 'employees',
    resource_id: '10',
    before_data: null,
    after_data: JSON.stringify({ employeeCode: 'NX-1010', branch: 'Austin HQ', hireDate: '2026-11-10' }),
    ip_address: '10.24.0.12',
    entry_hash: 'fedcba0987654321fedcba0987654321',
    created_at: '2026-11-10T09:15:00Z',
  },
  {
    id: 4,
    actor_email: 'manager@nexushrm.io',
    action: 'leave.approved',
    resource: 'leave_requests',
    resource_id: '4',
    before_data: JSON.stringify({ status: 'pending' }),
    after_data: JSON.stringify({ status: 'approved' }),
    ip_address: '10.24.0.19',
    entry_hash: '9999999999abcdef1234567890abcdef',
    created_at: '2026-11-12T11:30:00Z',
  },
];

test('classifyAuditCategory routes employee, payroll, and system events accurately', () => {
  assert.equal(classifyAuditCategory('employee.hired', 'employees'), 'employee');
  assert.equal(classifyAuditCategory('leave.approved', 'leave_requests'), 'employee');
  assert.equal(classifyAuditCategory('attendance.clock_in', 'attendance'), 'employee');
  assert.equal(classifyAuditCategory('payroll.finalized', 'payrolls'), 'payroll');
  assert.equal(classifyAuditCategory('tax.brackets_updated', 'tax_brackets'), 'payroll');
  assert.equal(classifyAuditCategory('loan.approved', 'loans'), 'payroll');
  assert.equal(classifyAuditCategory('system.initialized', 'company_settings'), 'system');
  assert.equal(classifyAuditCategory('security.role_mfa_policy_updated', 'roles'), 'system');
  assert.equal(classifyAuditCategory('workflow.rule_created', 'workflow_rules'), 'system');
});

test('formatAuditActionLabel produces clean title case with proper acronyms', () => {
  assert.equal(formatAuditActionLabel('payroll.finalized'), 'Payroll Finalized');
  assert.equal(formatAuditActionLabel('security.role_mfa_policy_updated'), 'Security Role MFA Policy Updated');
  assert.equal(formatAuditActionLabel('api_key.created'), 'API Key Created');
});

test('extractAuditDiffFields and summarizeAuditChanges format diffs and tolerate malformed JSON', () => {
  const fields = extractAuditDiffFields(
    JSON.stringify({ status: 'approved', total: 100 }),
    JSON.stringify({ status: 'finalized', total: 100, locked: true })
  );
  assert.equal(fields.length, 3);
  assert.deepEqual(fields[0], { field: 'status', before: 'approved', after: 'finalized' });

  const summary = summarizeAuditChanges(
    JSON.stringify({ status: 'pending' }),
    JSON.stringify({ status: 'approved' })
  );
  assert.equal(summary, 'status: pending → approved');

  assert.equal(summarizeAuditChanges(null, '{not-valid-json'), '{not-valid-json');
  assert.equal(summarizeAuditChanges(null, null), 'No field payload recorded');
});

test('computeAuditCategoryCounts and filterAuditEntries handle category, search, and sort order', () => {
  const counts = computeAuditCategoryCounts(SAMPLE_ENTRIES);
  assert.deepEqual(counts, { all: 4, employee: 2, payroll: 1, system: 1 });

  const payrollOnly = filterAuditEntries(SAMPLE_ENTRIES, {
    category: 'payroll',
    query: '',
    sortOrder: 'desc',
  });
  assert.equal(payrollOnly.length, 1);
  assert.equal(payrollOnly[0].action, 'payroll.finalized');

  const queryMatches = filterAuditEntries(SAMPLE_ENTRIES, {
    category: 'all',
    query: 'NX-1010',
    sortOrder: 'desc',
  });
  assert.equal(queryMatches.length, 1);
  assert.equal(queryMatches[0].id, 3);

  const ascOrder = filterAuditEntries(SAMPLE_ENTRIES, {
    category: 'all',
    query: '',
    sortOrder: 'asc',
  });
  assert.deepEqual(
    ascOrder.map((e) => e.id),
    [1, 2, 3, 4]
  );

  const descOrder = filterAuditEntries(SAMPLE_ENTRIES, {
    category: 'all',
    query: '',
    sortOrder: 'desc',
  });
  assert.deepEqual(
    descOrder.map((e) => e.id),
    [4, 3, 2, 1]
  );
});

test('formatAuditTimestamp normalizes ISO timestamps cleanly', () => {
  assert.equal(formatAuditTimestamp('2026-10-29T18:00:00Z'), '2026-10-29 18:00 UTC');
  assert.equal(formatAuditTimestamp(''), '—');
});
