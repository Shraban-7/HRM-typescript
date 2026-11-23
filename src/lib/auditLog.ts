import type { AuditLogEntry } from '../types/hrm';

export type AuditCategory = 'employee' | 'payroll' | 'system';
export type AuditCategoryFilter = 'all' | AuditCategory;
export type AuditSortOrder = 'desc' | 'asc';

const PAYROLL_PREFIXES = ['payroll', 'payslip', 'tax', 'loan', 'bonus', 'salary', 'compensation'];
const PAYROLL_RESOURCES = new Set([
  'payrolls',
  'payslips',
  'tax_brackets',
  'loans',
  'loan_repayments',
  'bonuses',
]);

const EMPLOYEE_PREFIXES = [
  'employee',
  'attendance',
  'leave',
  'expense',
  'goal',
  'review',
  'feedback',
  'applicant',
  'interview',
  'benefit',
  'onboarding',
  'exit',
  'ticket',
  'asset',
  'document',
];
const EMPLOYEE_RESOURCES = new Set([
  'employees',
  'attendance',
  'leave_requests',
  'expenses',
  'goals',
  'performance_reviews',
  'feedback',
  'applicants',
  'interviews',
  'benefit_enrollments',
  'exit_requests',
  'tickets',
  'assets',
  'employee_documents',
]);

const ACRONYMS = new Set(['mfa', 'rbac', 'api', 'totp', 'ip', 'hr', 'hrm', 'okr', 'id', 'sso', 'csv']);

export function classifyAuditCategory(action: string, resource: string): AuditCategory {
  const act = (action || '').toLowerCase().trim();
  const res = (resource || '').toLowerCase().trim();
  const actionDomain = act.split('.')[0] || '';

  if (PAYROLL_PREFIXES.includes(actionDomain) || PAYROLL_RESOURCES.has(res)) {
    return 'payroll';
  }
  if (EMPLOYEE_PREFIXES.includes(actionDomain) || EMPLOYEE_RESOURCES.has(res)) {
    return 'employee';
  }
  return 'system';
}

export function getAuditCategoryLabel(category: AuditCategory): string {
  if (category === 'payroll') return 'Payroll Modification';
  if (category === 'employee') return 'Employee Action';
  return 'System Change';
}

export function formatAuditActionLabel(action: string): string {
  const cleaned = (action || '').trim();
  if (!cleaned) return 'Recorded Event';
  return cleaned
    .split(/[._-]+/)
    .filter(Boolean)
    .map((segment) => {
      const lower = segment.toLowerCase();
      if (ACRONYMS.has(lower)) return lower.toUpperCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

export function formatResourceLabel(resource: string, resourceId: string | null): string {
  const base = (resource || 'system')
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
  return resourceId ? `${base} #${resourceId}` : base;
}

export function safeParseJsonRecord(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw || !raw.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    return null;
  }
}

function formatScalar(value: unknown): string {
  if (value === null || value === undefined) return 'none';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value.length > 48 ? `${value.slice(0, 45)}...` : value;
  const serialized = JSON.stringify(value);
  return serialized.length > 48 ? `${serialized.slice(0, 45)}...` : serialized;
}

export interface AuditDiffField {
  field: string;
  before: string | null;
  after: string | null;
}

export function extractAuditDiffFields(
  beforeData: string | null | undefined,
  afterData: string | null | undefined
): AuditDiffField[] {
  const beforeObj = safeParseJsonRecord(beforeData);
  const afterObj = safeParseJsonRecord(afterData);
  if (!beforeObj && !afterObj) return [];

  const keys = Array.from(
    new Set([...(beforeObj ? Object.keys(beforeObj) : []), ...(afterObj ? Object.keys(afterObj) : [])])
  );

  return keys.map((key) => ({
    field: key,
    before: beforeObj && key in beforeObj ? formatScalar(beforeObj[key]) : null,
    after: afterObj && key in afterObj ? formatScalar(afterObj[key]) : null,
  }));
}

export function summarizeAuditChanges(
  beforeData: string | null | undefined,
  afterData: string | null | undefined
): string {
  const fields = extractAuditDiffFields(beforeData, afterData);
  if (fields.length === 0) {
    if (afterData && afterData.trim()) return afterData.trim().slice(0, 96);
    return 'No field payload recorded';
  }

  const parts = fields.slice(0, 3).map((item) => {
    if (item.before !== null && item.after !== null && item.before !== item.after) {
      return `${item.field}: ${item.before} → ${item.after}`;
    }
    if (item.after !== null) {
      return `${item.field}: ${item.after}`;
    }
    return `${item.field}: removed`;
  });

  if (fields.length > 3) {
    parts.push(`+${fields.length - 3} more`);
  }

  return parts.join(' · ');
}

export function formatAuditTimestamp(iso: string): string {
  if (!iso) return '—';
  const normalized = iso.replace('T', ' ').replace('Z', '');
  return normalized.length >= 16 ? `${normalized.slice(0, 16)} UTC` : normalized;
}

export function computeAuditCategoryCounts(entries: AuditLogEntry[]): Record<AuditCategoryFilter, number> {
  const counts: Record<AuditCategoryFilter, number> = {
    all: entries.length,
    employee: 0,
    payroll: 0,
    system: 0,
  };
  for (const entry of entries) {
    const category = classifyAuditCategory(entry.action, entry.resource);
    counts[category] += 1;
  }
  return counts;
}

export function filterAuditEntries(
  entries: AuditLogEntry[],
  options: {
    category: AuditCategoryFilter;
    query: string;
    sortOrder: AuditSortOrder;
  }
): AuditLogEntry[] {
  const normalizedQuery = options.query.trim().toLowerCase();

  const filtered = entries.filter((entry) => {
    const category = classifyAuditCategory(entry.action, entry.resource);
    if (options.category !== 'all' && category !== options.category) {
      return false;
    }
    if (!normalizedQuery) return true;

    const searchable = [
      String(entry.id),
      entry.actor_email ?? 'system',
      entry.action,
      formatAuditActionLabel(entry.action),
      entry.resource,
      entry.resource_id ?? '',
      getAuditCategoryLabel(category),
      entry.before_data ?? '',
      entry.after_data ?? '',
    ]
      .join(' ')
      .toLowerCase();

    return searchable.includes(normalizedQuery);
  });

  filtered.sort((a, b) => {
    const timeDiff = a.created_at.localeCompare(b.created_at);
    const primary = timeDiff !== 0 ? timeDiff : a.id - b.id;
    return options.sortOrder === 'desc' ? -primary : primary;
  });

  return filtered;
}
