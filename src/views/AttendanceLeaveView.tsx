import React, { useEffect, useState } from 'react';
import { CalendarPlus, Check, Clock, Plus, X } from 'lucide-react';
import { apiRequest, hasPerm } from '../lib/api';
import type { AuthUser, Branch } from '../types/hrm';
import {
  LoadingBlock,
  MetricStrip,
  Modal,
  PageHeader,
  SegmentedTabs,
  StatusText,
} from '../components/ui/Primitives';

type TimeTab = 'attendance' | 'leaves' | 'shifts';

export function AttendanceLeaveView({
  user,
  branches,
  selectedBranchId,
  onToast,
}: {
  user: AuthUser;
  branches: Branch[];
  selectedBranchId: number | null;
  onToast: (msg: string) => void;
}) {
  const [tab, setTab] = useState<TimeTab>('attendance');
  const [records, setRecords] = useState<Array<Record<string, unknown>>>([]);
  const [shifts, setShifts] = useState<Array<Record<string, unknown>>>([]);
  const [myToday, setMyToday] = useState<Record<string, unknown> | null>(null);
  const [leaves, setLeaves] = useState<Array<Record<string, unknown>>>([]);
  const [balances, setBalances] = useState<
    Record<string, { quota: number; used: number; remaining: number }>
  >({});
  const [loading, setLoading] = useState(true);

  const [leaveModalOpen, setLeaveModalOpen] = useState(false);
  const [leaveForm, setLeaveForm] = useState({
    leaveType: 'annual',
    startDate: '2026-12-01',
    endDate: '2026-12-08',
    reason: '',
  });

  const [shiftModalOpen, setShiftModalOpen] = useState(false);
  const [shiftForm, setShiftForm] = useState({
    branchId: '',
    name: '',
    startTime: '09:00',
    endTime: '17:30',
    standardHours: 8,
    overtimeMultiplier: 1.5,
  });

  const canApproveLeave = hasPerm(user.permissions, user.roles, 'leave.approve');
  const canManageShifts = hasPerm(user.permissions, user.roles, 'attendance.manage');

  async function loadAll() {
    setLoading(true);
    try {
      const qs = selectedBranchId ? `?branchId=${selectedBranchId}` : '';
      const [attRes, leaveRes] = await Promise.all([
        apiRequest<{
          records: Array<Record<string, unknown>>;
          shifts: Array<Record<string, unknown>>;
          myToday: Record<string, unknown> | null;
        }>(`/api/attendance${qs}`),
        apiRequest<{
          leaves: Array<Record<string, unknown>>;
          balances: Record<string, { quota: number; used: number; remaining: number }>;
        }>(`/api/leaves${qs}`),
      ]);
      setRecords(attRes.records);
      setShifts(attRes.shifts);
      setMyToday(attRes.myToday);
      setLeaves(leaveRes.leaves);
      setBalances(leaveRes.balances);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, [selectedBranchId]);

  async function handleClock(action: 'clock-in' | 'clock-out') {
    try {
      await apiRequest(`/api/attendance/${action}`, { method: 'POST' });
      onToast(action === 'clock-in' ? 'Clock-in logged.' : 'Clock-out recorded with overtime evaluation.');
      await loadAll();
    } catch (err) {
      onToast((err as Error).message);
    }
  }

  async function handleSubmitLeave(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await apiRequest<{ days: number; approvalChain: string[] }>('/api/leaves', {
        method: 'POST',
        body: leaveForm,
      });
      onToast(
        `Leave submitted (${res.days} working days) — routed through ${res.approvalChain.join(' → ')}.`
      );
      setLeaveModalOpen(false);
      setLeaveForm({ leaveType: 'annual', startDate: '2026-12-01', endDate: '2026-12-08', reason: '' });
      setTab('leaves');
      await loadAll();
    } catch (err) {
      onToast((err as Error).message);
    }
  }

  async function handleLeaveDecision(id: number, decision: 'approve' | 'reject') {
    await apiRequest(`/api/leaves/${id}/decision`, { method: 'POST', body: { decision } });
    onToast(`Leave request ${decision === 'approve' ? 'approved' : 'rejected'}.`);
    await loadAll();
  }

  async function handleAddShift(e: React.FormEvent) {
    e.preventDefault();
    await apiRequest('/api/shifts', {
      method: 'POST',
      body: {
        ...shiftForm,
        branchId: shiftForm.branchId ? Number(shiftForm.branchId) : null,
        standardHours: Number(shiftForm.standardHours),
        overtimeMultiplier: Number(shiftForm.overtimeMultiplier),
      },
    });
    onToast(`Shift schedule "${shiftForm.name}" created.`);
    setShiftModalOpen(false);
    setShiftForm({ branchId: '', name: '', startTime: '09:00', endTime: '17:30', standardHours: 8, overtimeMultiplier: 1.5 });
    await loadAll();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Time, Shifts & Leave Management"
        description="Real-time attendance tracking, biometric sync telemetry, regional shift rules, and workflow-routed leave approvals."
        action={
          <div className="flex items-center gap-2">
            {!myToday ? (
              <button
                type="button"
                onClick={() => handleClock('clock-in')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-neutral-800 dark:text-neutral-100 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md hover:bg-neutral-50 cursor-pointer whitespace-nowrap"
              >
                <Clock className="w-3.5 h-3.5" />
                <span>Clock In</span>
              </button>
            ) : !myToday.clock_out ? (
              <button
                type="button"
                onClick={() => handleClock('clock-out')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-neutral-800 dark:text-neutral-100 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md hover:bg-neutral-50 cursor-pointer whitespace-nowrap"
              >
                <Clock className="w-3.5 h-3.5" />
                <span>Clock Out</span>
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setLeaveModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer whitespace-nowrap"
            >
              <CalendarPlus className="w-3.5 h-3.5" />
              <span>Request Leave</span>
            </button>
          </div>
        }
      />

      <MetricStrip
        items={[
          {
            label: 'Annual Leave Available',
            value: `${balances.annual?.remaining ?? 20}d`,
            detail: `${balances.annual?.used ?? 0} of ${balances.annual?.quota ?? 20} used`,
            tone: 'positive',
          },
          {
            label: 'Sick Leave Available',
            value: `${balances.sick?.remaining ?? 14}d`,
            detail: `${balances.sick?.used ?? 0} of ${balances.sick?.quota ?? 14} used`,
          },
          {
            label: 'Attendance Entries Logged',
            value: String(records.length),
            detail: 'Includes web & biometric terminal syncs',
          },
          {
            label: 'Active Branch Shifts',
            value: String(shifts.length),
            detail: 'With automatic 1.5x–2.0x overtime rules',
          },
        ]}
      />

      <SegmentedTabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'attendance', label: 'Attendance Log', count: records.length },
          { id: 'leaves', label: 'Leave Requests', count: leaves.length },
          { id: 'shifts', label: 'Branch Shifts', count: shifts.length },
        ]}
      />

      {loading ? (
        <LoadingBlock rows={5} />
      ) : tab === 'attendance' ? (
        <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-neutral-200 dark:border-neutral-800 text-[11px] font-medium text-neutral-500">
                  <th className="px-5 py-2.5">Date</th>
                  <th className="px-4 py-2.5">Employee & Branch</th>
                  <th className="px-4 py-2.5">Clock In / Out</th>
                  <th className="px-4 py-2.5 text-right">Worked</th>
                  <th className="px-4 py-2.5 text-right">Overtime</th>
                  <th className="px-4 py-2.5">Source</th>
                  <th className="px-5 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
                {records.map((r) => (
                  <tr key={String(r.id)} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/40">
                    <td className="px-5 py-3 font-mono tabular-nums">{String(r.work_date)}</td>
                    <td className="px-4 py-3">
                      <span className="font-medium text-neutral-900 dark:text-neutral-100">
                        {String(r.employee_name)}
                      </span>{' '}
                      <span className="text-neutral-500">· {String(r.branch_name)}</span>
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums text-neutral-600 dark:text-neutral-400">
                      {r.clock_in ? String(r.clock_in).slice(11, 16) : '—'} →{' '}
                      {r.clock_out ? String(r.clock_out).slice(11, 16) : 'Active'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {Number(r.worked_hours).toFixed(1)}h
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-blue-600 dark:text-blue-400">
                      {Number(r.overtime_hours) > 0 ? `+${Number(r.overtime_hours).toFixed(1)}h` : '—'}
                    </td>
                    <td className="px-4 py-3 text-neutral-500 capitalize">{String(r.source)}</td>
                    <td className="px-5 py-3">
                      <StatusText status={String(r.status)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : tab === 'leaves' ? (
        <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-neutral-200 dark:border-neutral-800 text-[11px] font-medium text-neutral-500">
                  <th className="px-5 py-2.5">Employee</th>
                  <th className="px-4 py-2.5">Type & Window</th>
                  <th className="px-4 py-2.5 text-right">Days</th>
                  <th className="px-4 py-2.5">Approval Chain</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-5 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
                {leaves.map((l) => {
                  const chain = JSON.parse(String(l.approval_chain_json || '["manager"]')) as string[];
                  return (
                    <tr key={String(l.id)}>
                      <td className="px-5 py-3">
                        <div className="font-medium text-neutral-900 dark:text-neutral-100">
                          {String(l.employee_name)}
                        </div>
                        <div className="text-[11px] text-neutral-500">{String(l.branch_name)}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="capitalize font-medium">{String(l.leave_type)} Leave</div>
                        <div className="text-[11px] font-mono text-neutral-500">
                          {String(l.start_date)} → {String(l.end_date)}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums font-medium">
                        {String(l.days)}d
                      </td>
                      <td className="px-4 py-3 text-[11px] text-neutral-600 dark:text-neutral-400">
                        {chain.join(' → ')} (step {Number(l.current_step)}/{chain.length})
                      </td>
                      <td className="px-4 py-3">
                        <StatusText status={String(l.status)} />
                      </td>
                      <td className="px-5 py-3 text-right">
                        {l.status === 'pending' && canApproveLeave ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleLeaveDecision(Number(l.id), 'approve')}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900 rounded hover:bg-emerald-50 cursor-pointer"
                            >
                              <Check className="w-3 h-3" />
                              <span>Approve</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleLeaveDecision(Number(l.id), 'reject')}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-red-700 dark:text-red-400 border border-red-200 dark:border-red-900 rounded hover:bg-red-50 cursor-pointer"
                            >
                              <X className="w-3 h-3" />
                              <span>Reject</span>
                            </button>
                          </div>
                        ) : (
                          <span className="text-neutral-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
            <span className="text-sm font-semibold">Branch Shift Rosters & Overtime Multipliers</span>
            {canManageShifts && (
              <button
                type="button"
                onClick={() => setShiftModalOpen(true)}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Shift</span>
              </button>
            )}
          </div>
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-neutral-200 dark:border-neutral-800 text-[11px] font-medium text-neutral-500">
                <th className="px-5 py-2.5">Shift Name</th>
                <th className="px-4 py-2.5">Branch</th>
                <th className="px-4 py-2.5">Hours</th>
                <th className="px-4 py-2.5 text-right">Standard</th>
                <th className="px-5 py-2.5 text-right">OT Multiplier</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {shifts.map((s) => (
                <tr key={String(s.id)}>
                  <td className="px-5 py-3 font-medium">{String(s.name)}</td>
                  <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">
                    {String(s.branch_name ?? 'Company-Wide')}
                  </td>
                  <td className="px-4 py-3 font-mono tabular-nums">
                    {String(s.start_time)} – {String(s.end_time)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">{String(s.standard_hours)}h</td>
                  <td className="px-5 py-3 text-right font-mono tabular-nums font-medium">
                    {Number(s.overtime_multiplier).toFixed(1)}x
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={leaveModalOpen}
        onClose={() => setLeaveModalOpen(false)}
        title="Submit Leave Request"
        description="Weekends and branch holidays are excluded automatically. Requests exceeding 5 days trigger dual approval."
      >
        <form onSubmit={handleSubmitLeave} className="space-y-3.5 text-xs">
          <div>
            <label className="block font-medium mb-1">Leave Type</label>
            <select
              value={leaveForm.leaveType}
              onChange={(e) => setLeaveForm({ ...leaveForm, leaveType: e.target.value })}
              className="w-full px-3 py-2 bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-md"
            >
              <option value="annual">Annual Leave</option>
              <option value="sick">Sick Leave</option>
              <option value="parental">Parental Leave</option>
              <option value="unpaid">Unpaid Leave</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium mb-1">Start Date</label>
              <input
                type="date"
                required
                value={leaveForm.startDate}
                onChange={(e) => setLeaveForm({ ...leaveForm, startDate: e.target.value })}
                className="w-full px-3 py-2 bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-md"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">End Date</label>
              <input
                type="date"
                required
                value={leaveForm.endDate}
                onChange={(e) => setLeaveForm({ ...leaveForm, endDate: e.target.value })}
                className="w-full px-3 py-2 bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-md"
              />
            </div>
          </div>
          <div>
            <label className="block font-medium mb-1">Reason / Coverage Notes</label>
            <textarea
              required
              rows={3}
              value={leaveForm.reason}
              onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
              className="w-full px-3 py-2 bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-md"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setLeaveModalOpen(false)}
              className="px-3.5 py-2 border border-neutral-200 dark:border-neutral-700 rounded-md cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer"
            >
              Submit Request
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={shiftModalOpen} onClose={() => setShiftModalOpen(false)} title="Create Branch Shift">
        <form onSubmit={handleAddShift} className="space-y-3.5 text-xs">
          <div>
            <label className="block font-medium mb-1">Shift Name</label>
            <input
              required
              value={shiftForm.name}
              onChange={(e) => setShiftForm({ ...shiftForm, name: e.target.value })}
              className="w-full px-3 py-2 bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-md"
            />
          </div>
          <div>
            <label className="block font-medium mb-1">Branch</label>
            <select
              value={shiftForm.branchId}
              onChange={(e) => setShiftForm({ ...shiftForm, branchId: e.target.value })}
              className="w-full px-3 py-2 bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-md"
            >
              <option value="">All Branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block font-medium mb-1">Start</label>
              <input
                type="time"
                value={shiftForm.startTime}
                onChange={(e) => setShiftForm({ ...shiftForm, startTime: e.target.value })}
                className="w-full px-2.5 py-2 bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-md"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">End</label>
              <input
                type="time"
                value={shiftForm.endTime}
                onChange={(e) => setShiftForm({ ...shiftForm, endTime: e.target.value })}
                className="w-full px-2.5 py-2 bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-md"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">OT Multiplier</label>
              <input
                type="number"
                step="0.25"
                value={shiftForm.overtimeMultiplier}
                onChange={(e) => setShiftForm({ ...shiftForm, overtimeMultiplier: Number(e.target.value) })}
                className="w-full px-2.5 py-2 font-mono bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-md"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setShiftModalOpen(false)} className="px-3.5 py-2 border border-neutral-200 dark:border-neutral-700 rounded-md cursor-pointer">
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer">
              Save Shift
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
