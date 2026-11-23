export type WorkflowTrigger =
  | 'leave.submitted'
  | 'expense.submitted'
  | 'loan.submitted'
  | 'employee.hired'
  | 'payroll.ready';

export interface WorkflowRule {
  id: number;
  name: string;
  triggerEvent: WorkflowTrigger;
  branchId: number | null; // null = applies to all branches
  conditionField: 'days' | 'amount' | 'none';
  conditionOperator: 'gt' | 'gte' | 'lt' | 'eq' | 'always';
  conditionValue: number;
  approverRoles: string[]; // ordered approval chain e.g. ['manager', 'hr_admin']
  webhookEvent: string | null;
  isActive: boolean;
}

export interface WorkflowEvaluationInput {
  triggerEvent: WorkflowTrigger;
  branchId: number;
  days?: number;
  amount?: number;
}

export interface WorkflowResolution {
  matchedRuleIds: number[];
  matchedRuleNames: string[];
  requiredApprovalSteps: string[];
  webhookEvents: string[];
}

export function evaluateWorkflowRules(
  rules: WorkflowRule[],
  input: WorkflowEvaluationInput
): WorkflowResolution {
  const active = rules.filter((r) => r.isActive && r.triggerEvent === input.triggerEvent);
  const matched: WorkflowRule[] = [];

  for (const rule of active) {
    if (rule.branchId !== null && rule.branchId !== input.branchId) {
      continue;
    }

    let conditionMet = false;
    if (rule.conditionOperator === 'always' || rule.conditionField === 'none') {
      conditionMet = true;
    } else {
      const actual =
        rule.conditionField === 'days'
          ? (input.days ?? 0)
          : rule.conditionField === 'amount'
            ? (input.amount ?? 0)
            : 0;

      switch (rule.conditionOperator) {
        case 'gt':
          conditionMet = actual > rule.conditionValue;
          break;
        case 'gte':
          conditionMet = actual >= rule.conditionValue;
          break;
        case 'lt':
          conditionMet = actual < rule.conditionValue;
          break;
        case 'eq':
          conditionMet = actual === rule.conditionValue;
          break;
      }
    }

    if (conditionMet) {
      matched.push(rule);
    }
  }

  // Merge ordered approval chain preserving order without duplicates
  const steps: string[] = [];
  const webhooks = new Set<string>();
  for (const rule of matched) {
    for (const role of rule.approverRoles) {
      if (!steps.includes(role)) {
        steps.push(role);
      }
    }
    if (rule.webhookEvent) {
      webhooks.add(rule.webhookEvent);
    }
  }

  if (steps.length === 0 && input.triggerEvent !== 'employee.hired') {
    steps.push('manager');
  }

  return {
    matchedRuleIds: matched.map((r) => r.id),
    matchedRuleNames: matched.map((r) => r.name),
    requiredApprovalSteps: steps,
    webhookEvents: Array.from(webhooks),
  };
}

/**
 * Count working weekdays (Mon-Fri) between two YYYY-MM-DD dates inclusive, excluding holiday dates.
 */
export function calculateLeaveBusinessDays(
  startDate: string,
  endDate: string,
  holidayDates: string[] = []
): number {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0;

  const holidaySet = new Set(holidayDates);
  let days = 0;
  const cursor = new Date(start.getTime());

  while (cursor <= end) {
    const dow = cursor.getUTCDay();
    const iso = cursor.toISOString().slice(0, 10);
    if (dow !== 0 && dow !== 6 && !holidaySet.has(iso)) {
      days += 1;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/**
 * Calculate worked hours, overtime hours, and attendance status from clock-in/clock-out timestamps.
 */
export function evaluateAttendanceShift(
  clockInIso: string,
  clockOutIso: string | null,
  shiftStartHour = 9,
  standardDailyHours = 8,
  graceMinutes = 15
): {
  workedHours: number;
  overtimeHours: number;
  status: 'present' | 'late' | 'half_day';
} {
  const clockIn = new Date(clockInIso);
  const inMinutes = clockIn.getUTCHours() * 60 + clockIn.getUTCMinutes();
  const shiftStartMinutes = shiftStartHour * 60 + graceMinutes;
  const isLate = inMinutes > shiftStartMinutes;

  if (!clockOutIso) {
    return {
      workedHours: 0,
      overtimeHours: 0,
      status: isLate ? 'late' : 'present',
    };
  }

  const clockOut = new Date(clockOutIso);
  const diffHours = Math.max(0, (clockOut.getTime() - clockIn.getTime()) / 3_600_000);
  const workedHours = Math.round(diffHours * 100) / 100;
  const overtimeHours = Math.max(0, Math.round((workedHours - standardDailyHours) * 100) / 100);

  let status: 'present' | 'late' | 'half_day' = isLate ? 'late' : 'present';
  if (workedHours > 0 && workedHours < standardDailyHours / 2) {
    status = 'half_day';
  }

  return { workedHours, overtimeHours, status };
}
