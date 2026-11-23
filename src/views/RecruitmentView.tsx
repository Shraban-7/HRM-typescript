import React, { useEffect, useState } from 'react';
import { Briefcase, ExternalLink, Plus, UserCheck } from 'lucide-react';
import { apiRequest, formatDateShort, hasPerm } from '../lib/api';
import type { AuthUser, Branch, Department } from '../types/hrm';
import {
  EmptyState,
  LoadingBlock,
  MetricStrip,
  Modal,
  PageHeader,
  SegmentedTabs,
  StatusText,
} from '../components/ui/Primitives';

type RecTab = 'pipeline' | 'jobs' | 'interviews';

const STAGES = ['applied', 'screening', 'interview', 'offer', 'hired', 'rejected'] as const;

interface JobRow {
  id: number;
  branch_id: number;
  department_id: number;
  title: string;
  employment_type: string;
  salary_range: string;
  description: string;
  requirements: string;
  status: string;
  closing_date: string;
  branch_name: string;
  department_name: string;
  applicant_count: number;
}

interface ApplicantRow {
  id: number;
  job_post_id: number;
  full_name: string;
  email: string;
  phone: string | null;
  source: string;
  stage: string;
  rating: number;
  notes: string | null;
  job_title: string;
  branch_name: string;
  created_at: string;
}

interface InterviewRow {
  id: number;
  applicant_id: number;
  applicant_name: string;
  job_title: string;
  interviewer_name: string;
  scheduled_at: string;
  mode: string;
  status: string;
  notes: string | null;
}

export function RecruitmentView({
  user,
  branches,
  selectedBranchId,
  onOpenCareers,
  onToast,
}: {
  user: AuthUser;
  branches: Branch[];
  selectedBranchId: number | null;
  onOpenCareers: () => void;
  onToast: (msg: string) => void;
}) {
  const [tab, setTab] = useState<RecTab>('pipeline');
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [applicants, setApplicants] = useState<ApplicantRow[]>([]);
  const [interviews, setInterviews] = useState<InterviewRow[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [stageFilter, setStageFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);

  const [jobModalOpen, setJobModalOpen] = useState(false);
  const [jobForm, setJobForm] = useState({
    branchId: branches[0]?.id ?? 1,
    departmentId: 1,
    title: '',
    salaryRange: '$140,000 – $175,000',
    description: '',
    requirements: '',
    closingDate: '2027-01-31',
  });

  const canManage = hasPerm(user.permissions, user.roles, 'recruitment.manage');

  async function loadData() {
    setLoading(true);
    try {
      const qs = selectedBranchId ? `?branchId=${selectedBranchId}` : '';
      const [rec, depts] = await Promise.all([
        apiRequest<{ jobs: JobRow[]; applicants: ApplicantRow[]; interviews: InterviewRow[] }>(
          `/api/recruitment${qs}`
        ),
        apiRequest<{ departments: Department[] }>('/api/departments'),
      ]);
      setJobs(rec.jobs);
      setApplicants(rec.applicants);
      setInterviews(rec.interviews);
      setDepartments(depts.departments);
      if (depts.departments.length > 0 && !depts.departments.some((d) => d.id === jobForm.departmentId)) {
        setJobForm((prev) => ({
          ...prev,
          branchId: depts.departments[0].branch_id,
          departmentId: depts.departments[0].id,
        }));
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [selectedBranchId]);

  async function handleStageChange(applicantId: number, stage: string) {
    setBusyId(applicantId);
    try {
      await apiRequest(`/api/recruitment/applicants/${applicantId}/stage`, {
        method: 'PATCH',
        body: { stage },
      });
      onToast(`Candidate moved to ${stage}.`);
      await loadData();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to update stage.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleHire(applicant: ApplicantRow) {
    setBusyId(applicant.id);
    try {
      const res = await apiRequest<{ employeeId: number; employeeCode: string }>(
        `/api/recruitment/applicants/${applicant.id}/hire`,
        { method: 'POST' }
      );
      onToast(`Hired ${applicant.full_name} as ${res.employeeCode}. Employee record created.`);
      await loadData();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to hire candidate.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleCreateJob(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiRequest('/api/recruitment/jobs', {
        method: 'POST',
        body: {
          ...jobForm,
          branchId: Number(jobForm.branchId),
          departmentId: Number(jobForm.departmentId),
        },
      });
      setJobModalOpen(false);
      setJobForm((prev) => ({ ...prev, title: '', description: '', requirements: '' }));
      onToast('Requisition published to the Public Career Portal.');
      await loadData();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to publish requisition.');
    }
  }

  const filteredApplicants =
    stageFilter === 'all' ? applicants : applicants.filter((a) => a.stage === stageFilter);

  const openJobs = jobs.filter((j) => j.status === 'open').length;
  const offerCount = applicants.filter((a) => a.stage === 'offer').length;
  const interviewCount = applicants.filter((a) => a.stage === 'interview').length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recruitment & ATS"
        description="Manage multi-branch requisitions, advance candidate pipelines, and convert accepted offers into employee records."
        action={
          <>
            <button
              type="button"
              onClick={onOpenCareers}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-neutral-700 dark:text-neutral-200 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer whitespace-nowrap"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Public Career Portal</span>
            </button>
            {canManage && (
              <button
                type="button"
                onClick={() => setJobModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Post Requisition</span>
              </button>
            )}
          </>
        }
      />

      <MetricStrip
        items={[
          { label: 'Open Requisitions', value: String(openJobs), detail: `${jobs.length} total posted` },
          { label: 'Active Candidates', value: String(applicants.length), detail: 'Across all stages' },
          { label: 'In Interview', value: String(interviewCount), detail: `${interviews.length} scheduled panels` },
          {
            label: 'Offers Extended',
            value: String(offerCount),
            detail: 'Ready for one-click hire',
            tone: offerCount > 0 ? 'positive' : 'default',
          },
        ]}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedTabs<RecTab>
          active={tab}
          onChange={setTab}
          tabs={[
            { id: 'pipeline', label: 'Candidate Pipeline', count: applicants.length },
            { id: 'jobs', label: 'Job Requisitions', count: jobs.length },
            { id: 'interviews', label: 'Interviews', count: interviews.length },
          ]}
        />

        {tab === 'pipeline' && (
          <div className="flex items-center gap-2">
            <label htmlFor="stage-filter" className="text-xs text-neutral-500">
              Stage
            </label>
            <select
              id="stage-filter"
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value)}
              className="text-xs px-2.5 py-1.5 bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-700 rounded-md text-neutral-800 dark:text-neutral-200 cursor-pointer"
            >
              <option value="all">All Stages ({applicants.length})</option>
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0).toUpperCase() + s.slice(1)} ({applicants.filter((a) => a.stage === s).length})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {loading ? (
        <LoadingBlock rows={5} />
      ) : tab === 'pipeline' ? (
        filteredApplicants.length === 0 ? (
          <EmptyState
            title="No candidates in this stage"
            description="Adjust the stage filter or publish a new role on the Public Career Portal to attract applicants."
          />
        ) : (
          <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-900/40 text-[11px] font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                    <th className="py-3 px-4">Candidate</th>
                    <th className="py-3 px-4">Role & Branch</th>
                    <th className="py-3 px-4">Source</th>
                    <th className="py-3 px-4">Rating</th>
                    <th className="py-3 px-4">Stage</th>
                    {canManage && <th className="py-3 px-4 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800 text-sm">
                  {filteredApplicants.map((a) => (
                    <tr
                      key={a.id}
                      className="hover:bg-neutral-50/70 dark:hover:bg-neutral-800/30 transition-colors"
                    >
                      <td className="py-3 px-4">
                        <div className="font-medium text-neutral-900 dark:text-neutral-100">{a.full_name}</div>
                        <div className="text-xs text-neutral-500 dark:text-neutral-400">
                          {a.email} {a.phone ? `· ${a.phone}` : ''}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="text-neutral-800 dark:text-neutral-200 font-medium text-xs">{a.job_title}</div>
                        <div className="text-xs text-neutral-500 dark:text-neutral-400">{a.branch_name}</div>
                      </td>
                      <td className="py-3 px-4 text-xs text-neutral-600 dark:text-neutral-400">
                        {a.source} · {formatDateShort(a.created_at)}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-xs text-neutral-800 dark:text-neutral-200">
                        {a.rating.toFixed(1)} / 5.0
                      </td>
                      <td className="py-3 px-4">
                        <StatusText status={a.stage} />
                      </td>
                      {canManage && (
                        <td className="py-3 px-4 text-right">
                          <div className="inline-flex items-center gap-2 justify-end">
                            {a.stage !== 'hired' && (
                              <select
                                aria-label={`Stage for ${a.full_name}`}
                                disabled={busyId === a.id}
                                value={a.stage}
                                onChange={(e) => handleStageChange(a.id, e.target.value)}
                                className="text-xs px-2 py-1 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded text-neutral-700 dark:text-neutral-200 cursor-pointer"
                              >
                                {STAGES.filter((s) => s !== 'hired').map((s) => (
                                  <option key={s} value={s}>
                                    {s.charAt(0).toUpperCase() + s.slice(1)}
                                  </option>
                                ))}
                              </select>
                            )}
                            {a.stage !== 'hired' && a.stage !== 'rejected' && (
                              <button
                                type="button"
                                disabled={busyId === a.id}
                                onClick={() => handleHire(a)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded cursor-pointer disabled:opacity-50 whitespace-nowrap"
                              >
                                <UserCheck className="w-3.5 h-3.5" />
                                <span>Hire</span>
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      ) : tab === 'jobs' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {jobs.map((job) => (
            <div
              key={job.id}
              className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 flex flex-col justify-between gap-4"
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-50 flex items-center gap-2">
                      <Briefcase className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                      <span>{job.title}</span>
                    </h3>
                    <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                      {job.branch_name} · {job.department_name} · {job.salary_range}
                    </p>
                  </div>
                  <StatusText status={job.status} />
                </div>
                <p className="mt-3 text-xs text-neutral-600 dark:text-neutral-300 leading-relaxed">
                  {job.description}
                </p>
                <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                  Requirements: {job.requirements}
                </p>
              </div>
              <div className="pt-3 border-t border-neutral-200 dark:border-neutral-800 flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
                <span className="font-mono tabular-nums">{job.applicant_count} applicants</span>
                <span>Closes {formatDateShort(job.closing_date)}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-900/40 text-[11px] font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                  <th className="py-3 px-4">Candidate</th>
                  <th className="py-3 px-4">Position</th>
                  <th className="py-3 px-4">Interviewer</th>
                  <th className="py-3 px-4">Schedule & Mode</th>
                  <th className="py-3 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800 text-sm">
                {interviews.map((iv) => (
                  <tr key={iv.id}>
                    <td className="py-3 px-4 font-medium text-neutral-900 dark:text-neutral-100">
                      {iv.applicant_name}
                    </td>
                    <td className="py-3 px-4 text-xs text-neutral-600 dark:text-neutral-300">{iv.job_title}</td>
                    <td className="py-3 px-4 text-xs text-neutral-700 dark:text-neutral-300">{iv.interviewer_name}</td>
                    <td className="py-3 px-4 text-xs font-mono tabular-nums text-neutral-600 dark:text-neutral-400">
                      {iv.scheduled_at.replace('T', ' ').slice(0, 16)} · {iv.mode}
                    </td>
                    <td className="py-3 px-4">
                      <StatusText status={iv.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal
        open={jobModalOpen}
        onClose={() => setJobModalOpen(false)}
        title="Post Job Requisition"
        description="Published roles immediately appear on the external Nexus Career Portal."
      >
        <form onSubmit={handleCreateJob} className="space-y-4">
          <div>
            <label htmlFor="job-title" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
              Job Title
            </label>
            <input
              id="job-title"
              required
              value={jobForm.title}
              onChange={(e) => setJobForm((p) => ({ ...p, title: e.target.value }))}
              placeholder="e.g., Principal Infrastructure Engineer"
              className="w-full px-3 py-2 text-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="job-branch" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                Office Branch
              </label>
              <select
                id="job-branch"
                value={jobForm.branchId}
                onChange={(e) => {
                  const bid = Number(e.target.value);
                  const firstDept = departments.find((d) => d.branch_id === bid);
                  setJobForm((p) => ({ ...p, branchId: bid, departmentId: firstDept?.id ?? p.departmentId }));
                }}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="job-dept" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                Department
              </label>
              <select
                id="job-dept"
                value={jobForm.departmentId}
                onChange={(e) => setJobForm((p) => ({ ...p, departmentId: Number(e.target.value) }))}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md"
              >
                {departments
                  .filter((d) => d.branch_id === Number(jobForm.branchId))
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="job-salary" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                Salary Band
              </label>
              <input
                id="job-salary"
                required
                value={jobForm.salaryRange}
                onChange={(e) => setJobForm((p) => ({ ...p, salaryRange: e.target.value }))}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md"
              />
            </div>
            <div>
              <label htmlFor="job-closing" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                Closing Date
              </label>
              <input
                id="job-closing"
                type="date"
                required
                value={jobForm.closingDate}
                onChange={(e) => setJobForm((p) => ({ ...p, closingDate: e.target.value }))}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md"
              />
            </div>
          </div>
          <div>
            <label htmlFor="job-desc" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
              Role Summary
            </label>
            <textarea
              id="job-desc"
              required
              rows={2}
              value={jobForm.description}
              onChange={(e) => setJobForm((p) => ({ ...p, description: e.target.value }))}
              placeholder="Outline core responsibilities and team impact..."
              className="w-full px-3 py-2 text-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md"
            />
          </div>
          <div>
            <label htmlFor="job-req" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
              Key Requirements
            </label>
            <textarea
              id="job-req"
              required
              rows={2}
              value={jobForm.requirements}
              onChange={(e) => setJobForm((p) => ({ ...p, requirements: e.target.value }))}
              placeholder="List experience, technical skills, and domain qualifications..."
              className="w-full px-3 py-2 text-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setJobModalOpen(false)}
              className="px-3 py-2 text-xs font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-md cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer"
            >
              Publish Requisition
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
