import React, { useEffect, useState } from 'react';
import { Award, MessageSquarePlus, Plus, SlidersHorizontal, Target } from 'lucide-react';
import { apiRequest, formatCurrencyWhole, formatDateShort, hasPerm } from '../lib/api';
import type { AuthUser, Employee } from '../types/hrm';
import {
  LoadingBlock,
  MetricStrip,
  Modal,
  PageHeader,
  SegmentedTabs,
  StatusText,
} from '../components/ui/Primitives';

type PerfTab = 'reviews' | 'goals' | 'feedback';

interface ReviewRow {
  id: number;
  employee_id: number;
  employee_code: string;
  employee_name: string;
  designation: string;
  annual_salary: number;
  branch_name: string;
  department_name: string;
  cycle_name: string;
  self_rating: number;
  manager_rating: number;
  calibrated_rating: number | null;
  bonus_pct: number;
  status: string;
  summary: string | null;
}

interface GoalRow {
  id: number;
  employee_id: number;
  employee_name: string;
  employee_code: string;
  branch_name: string;
  title: string;
  category: string;
  progress: number;
  target_date: string;
  status: string;
}

interface FeedbackRow {
  id: number;
  from_name: string;
  to_employee_id: number;
  to_employee_name: string;
  designation: string;
  category: string;
  message: string;
  created_at: string;
}

export function PerformanceView({
  user,
  selectedBranchId,
  onToast,
}: {
  user: AuthUser;
  selectedBranchId: number | null;
  onToast: (msg: string) => void;
}) {
  const [tab, setTab] = useState<PerfTab>('reviews');
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [goals, setGoals] = useState<GoalRow[]>([]);
  const [feedback, setFeedback] = useState<FeedbackRow[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [draftRatings, setDraftRatings] = useState<Record<number, number>>({});

  const [goalModalOpen, setGoalModalOpen] = useState(false);
  const [goalForm, setGoalForm] = useState({
    title: '',
    category: 'Platform Engineering',
    targetDate: '2026-12-31',
  });

  const [fbModalOpen, setFbModalOpen] = useState(false);
  const [fbForm, setFbForm] = useState({
    toEmployeeId: 1,
    category: 'Recognition' as 'Recognition' | 'Leadership' | 'Collaboration' | 'Growth',
    message: '',
  });

  const canManage = hasPerm(user.permissions, user.roles, 'performance.manage');

  async function loadData() {
    setLoading(true);
    try {
      const qs = selectedBranchId ? `?branchId=${selectedBranchId}` : '';
      const [perf, empRes] = await Promise.all([
        apiRequest<{ reviews: ReviewRow[]; goals: GoalRow[]; feedback: FeedbackRow[] }>(
          `/api/performance${qs}`
        ),
        apiRequest<{ employees: Employee[] }>('/api/employees'),
      ]);
      setReviews(perf.reviews);
      setGoals(perf.goals);
      setFeedback(perf.feedback);
      setEmployees(empRes.employees);
      const nextRatings: Record<number, number> = {};
      for (const r of perf.reviews) {
        nextRatings[r.id] = r.calibrated_rating ?? r.manager_rating;
      }
      setDraftRatings(nextRatings);
      if (empRes.employees.length > 0) {
        setFbForm((prev) => ({
          ...prev,
          toEmployeeId: empRes.employees[0].id,
        }));
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [selectedBranchId]);

  async function handleCalibrate(reviewId: number) {
    const rating = draftRatings[reviewId];
    if (!rating) return;
    try {
      const res = await apiRequest<{ bonusPct: number }>(
        `/api/performance/reviews/${reviewId}/calibrate`,
        { method: 'POST', body: { calibratedRating: Number(rating) } }
      );
      onToast(`Calibrated at ${rating.toFixed(1)} · Recommended bonus updated to ${res.bonusPct}%.`);
      await loadData();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to calibrate rating.');
    }
  }

  async function handleGoalProgress(goalId: number, progress: number) {
    setGoals((prev) =>
      prev.map((g) =>
        g.id === goalId ? { ...g, progress, status: progress >= 100 ? 'completed' : 'in_progress' } : g
      )
    );
    try {
      await apiRequest(`/api/performance/goals/${goalId}`, {
        method: 'PATCH',
        body: { progress },
      });
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to update OKR progress.');
    }
  }

  async function handleCreateGoal(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiRequest('/api/performance/goals', {
        method: 'POST',
        body: goalForm,
      });
      setGoalModalOpen(false);
      setGoalForm({ title: '', category: 'Platform Engineering', targetDate: '2026-12-31' });
      onToast('OKR goal created.');
      await loadData();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to create goal.');
    }
  }

  async function handleSendFeedback(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiRequest('/api/performance/feedback', {
        method: 'POST',
        body: { ...fbForm, toEmployeeId: Number(fbForm.toEmployeeId) },
      });
      setFbModalOpen(false);
      setFbForm((p) => ({ ...p, message: '' }));
      onToast('360 feedback shared.');
      await loadData();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to submit feedback.');
    }
  }

  const avgRating =
    reviews.length > 0
      ? reviews.reduce((acc, r) => acc + (r.calibrated_rating ?? r.manager_rating), 0) / reviews.length
      : 0;
  const calibratedCount = reviews.filter((r) => r.status === 'calibrated').length;
  const avgGoalProgress =
    goals.length > 0 ? Math.round(goals.reduce((acc, g) => acc + g.progress, 0) / goals.length) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Performance & OKRs"
        description="Run H2 calibration cycles with automated bonus tier calculation, track quarterly OKRs, and share 360 recognition."
        action={
          <>
            <button
              type="button"
              onClick={() => setFbModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-neutral-700 dark:text-neutral-200 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer whitespace-nowrap"
            >
              <MessageSquarePlus className="w-3.5 h-3.5" />
              <span>Give 360 Feedback</span>
            </button>
            <button
              type="button"
              onClick={() => setGoalModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New OKR Goal</span>
            </button>
          </>
        }
      />

      <MetricStrip
        items={[
          { label: 'Active Cycle Average', value: `${avgRating.toFixed(2)} / 5`, detail: 'H2 2026 review cycle' },
          {
            label: 'Calibration Progress',
            value: `${calibratedCount} / ${reviews.length}`,
            detail: 'Reviews calibrated & bonus-linked',
            tone: calibratedCount === reviews.length && reviews.length > 0 ? 'positive' : 'default',
          },
          { label: 'Mean OKR Attainment', value: `${avgGoalProgress}%`, detail: `${goals.length} tracked objectives` },
          { label: '360 Recognitions', value: String(feedback.length), detail: 'Peer & leadership notes' },
        ]}
      />

      <SegmentedTabs<PerfTab>
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'reviews', label: 'Reviews & Calibration', count: reviews.length },
          { id: 'goals', label: 'OKR Goals', count: goals.length },
          { id: 'feedback', label: '360 Feedback', count: feedback.length },
        ]}
      />

      {loading ? (
        <LoadingBlock rows={5} />
      ) : tab === 'reviews' ? (
        <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-900/40 text-[11px] font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                  <th className="py-3 px-4">Employee</th>
                  <th className="py-3 px-4">Cycle</th>
                  <th className="py-3 px-4">Self / Manager</th>
                  <th className="py-3 px-4">Calibrated Rating</th>
                  <th className="py-3 px-4">Bonus Pool</th>
                  <th className="py-3 px-4">Status</th>
                  {canManage && <th className="py-3 px-4 text-right">Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800 text-sm">
                {reviews.map((r) => {
                  const estBonus = (r.annual_salary * r.bonus_pct) / 100;
                  return (
                    <tr key={r.id} className="hover:bg-neutral-50/70 dark:hover:bg-neutral-800/30">
                      <td className="py-3 px-4">
                        <div className="font-medium text-neutral-900 dark:text-neutral-100">{r.employee_name}</div>
                        <div className="text-xs text-neutral-500 dark:text-neutral-400">
                          {r.designation} · {r.branch_name}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs text-neutral-600 dark:text-neutral-400">{r.cycle_name}</td>
                      <td className="py-3 px-4 font-mono tabular-nums text-xs text-neutral-700 dark:text-neutral-300">
                        {r.self_rating.toFixed(1)} / {r.manager_rating.toFixed(1)}
                      </td>
                      <td className="py-3 px-4">
                        {canManage ? (
                          <input
                            type="number"
                            aria-label={`Calibrated rating for ${r.employee_name}`}
                            min={1}
                            max={5}
                            step={0.1}
                            value={draftRatings[r.id] ?? r.manager_rating}
                            onChange={(e) =>
                              setDraftRatings((p) => ({ ...p, [r.id]: Number(e.target.value) }))
                            }
                            className="w-20 px-2 py-1 text-xs font-mono tabular-nums bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded"
                          />
                        ) : (
                          <span className="font-mono tabular-nums text-xs font-medium text-neutral-900 dark:text-neutral-100">
                            {(r.calibrated_rating ?? r.manager_rating).toFixed(1)}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-xs">
                        <span className="font-semibold text-neutral-900 dark:text-neutral-100">{r.bonus_pct}%</span>
                        <span className="text-neutral-500 dark:text-neutral-400 ml-1.5">
                          ({formatCurrencyWhole(estBonus)})
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <StatusText status={r.status} />
                      </td>
                      {canManage && (
                        <td className="py-3 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => handleCalibrate(r.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800/70 hover:bg-blue-50 dark:hover:bg-blue-950/30 rounded cursor-pointer whitespace-nowrap"
                          >
                            <SlidersHorizontal className="w-3 h-3" />
                            <span>Calibrate</span>
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : tab === 'goals' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {goals.map((g) => (
            <div
              key={g.id}
              className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 space-y-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
                    <Target className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                    <span className="truncate">{g.title}</span>
                  </div>
                  <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                    {g.employee_name} · {g.category} · Due {formatDateShort(g.target_date)}
                  </div>
                </div>
                <StatusText status={g.status} />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-neutral-500 dark:text-neutral-400">Completion</span>
                  <span className="font-mono tabular-nums font-semibold text-neutral-900 dark:text-neutral-100">
                    {g.progress}%
                  </span>
                </div>
                <div className="w-full h-1.5 bg-neutral-100 dark:bg-neutral-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-600 dark:bg-blue-500 transition-all"
                    style={{ width: `${g.progress}%` }}
                  />
                </div>
                <input
                  type="range"
                  aria-label={`Progress for ${g.title}`}
                  min={0}
                  max={100}
                  step={5}
                  value={g.progress}
                  onChange={(e) => handleGoalProgress(g.id, Number(e.target.value))}
                  className="w-full accent-blue-600 cursor-pointer"
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {feedback.map((f) => (
            <div
              key={f.id}
              className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 space-y-2.5"
            >
              <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
                <span className="inline-flex items-center gap-1.5 font-medium text-neutral-800 dark:text-neutral-200">
                  <Award className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  {f.category}
                </span>
                <span>{formatDateShort(f.created_at)}</span>
              </div>
              <p className="text-sm text-neutral-800 dark:text-neutral-200 leading-relaxed">{f.message}</p>
              <div className="pt-2 border-t border-neutral-200 dark:border-neutral-800 text-xs text-neutral-500 dark:text-neutral-400">
                From <span className="text-neutral-800 dark:text-neutral-200 font-medium">{f.from_name}</span> to{' '}
                <span className="text-neutral-800 dark:text-neutral-200 font-medium">{f.to_employee_name}</span> ·{' '}
                {f.designation}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={goalModalOpen} onClose={() => setGoalModalOpen(false)} title="Create OKR Objective">
        <form onSubmit={handleCreateGoal} className="space-y-4">
          <div>
            <label htmlFor="okr-title" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
              Objective Title
            </label>
            <input
              id="okr-title"
              required
              value={goalForm.title}
              onChange={(e) => setGoalForm((p) => ({ ...p, title: e.target.value }))}
              placeholder="e.g., Reduce payroll close time from 3 days to 4 hours"
              className="w-full px-3 py-2 text-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="okr-cat" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                Category
              </label>
              <input
                id="okr-cat"
                required
                value={goalForm.category}
                onChange={(e) => setGoalForm((p) => ({ ...p, category: e.target.value }))}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md"
              />
            </div>
            <div>
              <label htmlFor="okr-date" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                Target Date
              </label>
              <input
                id="okr-date"
                type="date"
                required
                value={goalForm.targetDate}
                onChange={(e) => setGoalForm((p) => ({ ...p, targetDate: e.target.value }))}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setGoalModalOpen(false)}
              className="px-3 py-2 text-xs font-medium text-neutral-600 dark:text-neutral-300 rounded-md cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer"
            >
              Save OKR
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={fbModalOpen} onClose={() => setFbModalOpen(false)} title="Send 360 Feedback">
        <form onSubmit={handleSendFeedback} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="fb-to" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                Colleague
              </label>
              <select
                id="fb-to"
                value={fbForm.toEmployeeId}
                onChange={(e) => setFbForm((p) => ({ ...p, toEmployeeId: Number(e.target.value) }))}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md"
              >
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.full_name} ({e.employee_code})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="fb-cat" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                Category
              </label>
              <select
                id="fb-cat"
                value={fbForm.category}
                onChange={(e) =>
                  setFbForm((p) => ({
                    ...p,
                    category: e.target.value as 'Recognition' | 'Leadership' | 'Collaboration' | 'Growth',
                  }))
                }
                className="w-full px-3 py-2 text-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md"
              >
                <option value="Recognition">Recognition</option>
                <option value="Leadership">Leadership</option>
                <option value="Collaboration">Collaboration</option>
                <option value="Growth">Growth</option>
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="fb-msg" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
              Note
            </label>
            <textarea
              id="fb-msg"
              required
              rows={3}
              value={fbForm.message}
              onChange={(e) => setFbForm((p) => ({ ...p, message: e.target.value }))}
              placeholder="Share specific, constructive recognition or growth feedback..."
              className="w-full px-3 py-2 text-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setFbModalOpen(false)}
              className="px-3 py-2 text-xs font-medium text-neutral-600 dark:text-neutral-300 rounded-md cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer"
            >
              Post Feedback
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
