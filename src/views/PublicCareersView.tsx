import React, { useEffect, useState } from 'react';
import { ArrowLeft, Building2, CheckCircle2, MapPin, Send } from 'lucide-react';
import { apiRequest, ApiError } from '../lib/api';
import { Modal } from '../components/ui/Primitives';

interface PublicJob {
  id: number;
  title: string;
  branch_name: string;
  branch_city: string;
  branch_country: string;
  department_name: string;
  employment_type: string;
  salary_range: string;
  description: string;
  requirements: string;
  closing_date: string;
}

export function PublicCareersView({ onBack }: { onBack: () => void }) {
  const [jobs, setJobs] = useState<PublicJob[]>([]);
  const [branchFilter, setBranchFilter] = useState('all');
  const [selectedJob, setSelectedJob] = useState<PublicJob | null>(null);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submittedMsg, setSubmittedMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<{ jobs: PublicJob[] }>('/api/public/careers')
      .then((res) => setJobs(res.jobs))
      .catch(() => {});
  }, []);

  const branches = Array.from(new Set(jobs.map((j) => j.branch_name)));
  const filtered = branchFilter === 'all' ? jobs : jobs.filter((j) => j.branch_name === branchFilter);

  async function handleApply(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedJob) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiRequest(`/api/public/careers/${selectedJob.id}/apply`, {
        method: 'POST',
        body: { fullName, email, phone, notes },
      });
      setSubmittedMsg(`Application received for ${selectedJob.title}. Our recruiting team will follow up at ${email}.`);
      setSelectedJob(null);
      setFullName('');
      setEmail('');
      setPhone('');
      setNotes('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to submit application.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#FAFAFB] dark:bg-[#0B0F17] text-neutral-900 dark:text-neutral-100">
      <header className="h-14 px-6 lg:px-10 bg-white dark:bg-[#111827] border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between gap-8">
        <span className="font-display font-bold text-base tracking-tight whitespace-nowrap shrink-0">
          Nexus Technologies
        </span>
        <nav className="hidden md:flex items-center gap-6 text-sm text-neutral-600 dark:text-neutral-400">
          <span>Austin HQ</span>
          <span>New York East</span>
          <span>London EMEA</span>
          <span>Singapore APAC</span>
        </nav>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Return to HRM</span>
        </button>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12 space-y-8">
        <div className="max-w-2xl">
          <p className="text-xs font-medium text-blue-600 dark:text-blue-400">
            Open Positions across 4 Global Branches
          </p>
          <h1 className="mt-2 text-3xl sm:text-4xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
            Build high-trust infrastructure with Nexus Technologies
          </h1>
          <p className="mt-3 text-base text-neutral-600 dark:text-neutral-400">
            Every application flows directly into our live Recruitment ATS pipeline with branch-specific hiring teams.
          </p>
        </div>

        {submittedMsg && (
          <div className="px-4 py-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 rounded-lg flex items-center gap-2.5 text-sm text-emerald-800 dark:text-emerald-300">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{submittedMsg}</span>
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setBranchFilter('all')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
              branchFilter === 'all'
                ? 'bg-neutral-900 text-white border-neutral-900 dark:bg-neutral-100 dark:text-neutral-900'
                : 'bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-800'
            }`}
          >
            All Branches ({jobs.length})
          </button>
          {branches.map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => setBranchFilter(b)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                branchFilter === b
                  ? 'bg-neutral-900 text-white border-neutral-900 dark:bg-neutral-100 dark:text-neutral-900'
                  : 'bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-800'
              }`}
            >
              {b}
            </button>
          ))}
        </div>

        <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg divide-y divide-neutral-200 dark:divide-neutral-800">
          {filtered.map((job) => (
            <div key={job.id} className="p-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-5">
              <div className="space-y-2 max-w-2xl">
                <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
                  {job.title}
                </h2>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500 dark:text-neutral-400">
                  <span className="inline-flex items-center gap-1">
                    <Building2 className="w-3.5 h-3.5" />
                    {job.department_name}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5" />
                    {job.branch_name} ({job.branch_city})
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums text-neutral-800 dark:text-neutral-200">
                    {job.salary_range}
                  </span>
                </div>
                <p className="text-sm text-neutral-600 dark:text-neutral-300 leading-relaxed">
                  {job.description}
                </p>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  <strong className="font-medium text-neutral-700 dark:text-neutral-300">Requirements:</strong>{' '}
                  {job.requirements}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedJob(job)}
                className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer self-start"
              >
                Apply Now
              </button>
            </div>
          ))}
        </div>
      </main>

      <Modal
        open={Boolean(selectedJob)}
        onClose={() => setSelectedJob(null)}
        title={selectedJob ? `Apply — ${selectedJob.title}` : ''}
        description={selectedJob ? `${selectedJob.branch_name} · ${selectedJob.salary_range}` : ''}
      >
        <form onSubmit={handleApply} className="space-y-4">
          {error && (
            <div className="px-3 py-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-md">
              {error}
            </div>
          )}
          <div>
            <label htmlFor="cand-name" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
              Full Name
            </label>
            <input
              id="cand-name"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-md"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="cand-email" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                Email Address
              </label>
              <input
                id="cand-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-md"
              />
            </div>
            <div>
              <label htmlFor="cand-phone" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                Phone
              </label>
              <input
                id="cand-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-md"
              />
            </div>
          </div>
          <div>
            <label htmlFor="cand-notes" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
              Experience Summary / Portfolio Link
            </label>
            <textarea
              id="cand-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-md"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setSelectedJob(null)}
              className="px-3.5 py-2 text-xs font-medium text-neutral-600 border border-neutral-200 dark:border-neutral-700 rounded-md cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{submitting ? 'Submitting...' : 'Submit Application'}</span>
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
