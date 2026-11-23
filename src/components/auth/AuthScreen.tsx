import React, { useEffect, useState } from 'react';
import { ArrowRight, Briefcase, KeyRound, Lock, ShieldCheck } from 'lucide-react';
import { apiRequest, ApiError } from '../../lib/api';
import type { AuthUser } from '../../types/hrm';
import { Avatar } from '../ui/Primitives';

interface AuthScreenProps {
  onAuthenticated: (token: string, user: AuthUser) => void;
  onOpenCareers: () => void;
}

const PERSONAS: Array<{
  role: 'super_admin' | 'hr_admin' | 'manager' | 'employee';
  name: string;
  title: string;
  email: string;
  scope: string;
  avatar: string | null;
}> = [
  {
    role: 'super_admin',
    name: 'Elena Vance',
    title: 'VP of People & Security',
    email: 'admin@nexushrm.io',
    scope: 'Super Admin · Full Governance & API',
    avatar: '/src/assets/images/avatar_vp_people_1795446546985.jpg',
  },
  {
    role: 'hr_admin',
    name: 'Claire Bennett',
    title: 'Head of Payroll & HR Ops',
    email: 'hr@nexushrm.io',
    scope: 'HR Admin · Payroll, Benefits & ATS',
    avatar: null,
  },
  {
    role: 'manager',
    name: 'Arjun Patel',
    title: 'Director of Engineering',
    email: 'manager@nexushrm.io',
    scope: 'Branch Manager · Austin HQ Approvals',
    avatar: '/src/assets/images/avatar_branch_manager_1795446547221.jpg',
  },
  {
    role: 'employee',
    name: 'Maya Lin',
    title: 'Staff Software Engineer',
    email: 'maya.lin@nexushrm.io',
    scope: 'Employee · Self-Service & Payslips',
    avatar: '/src/assets/images/avatar_senior_engineer_1795446544652.jpg',
  },
];

export function AuthScreen({ onAuthenticated, onOpenCareers }: AuthScreenProps) {
  const [identifier, setIdentifier] = useState('admin@nexushrm.io');
  const [password, setPassword] = useState('NexusHR#2026');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // MFA challenge state
  const [mfaChallengeToken, setMfaChallengeToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');

  // First-run admin password claim disclosure
  const [adminClaimRequired, setAdminClaimRequired] = useState(false);
  const [showClaimForm, setShowClaimForm] = useState(false);
  const [claimPassword, setClaimPassword] = useState('');
  const [claimSuccess, setClaimSuccess] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<{ adminClaimRequired: boolean }>('/api/auth/status')
      .then((res) => setAdminClaimRequired(res.adminClaimRequired))
      .catch(() => {});
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiRequest<
        | { mfaRequired: true; challengeToken: string; email: string }
        | { token: string; user: AuthUser }
      >('/api/auth/login', {
        method: 'POST',
        body: { identifier, password },
      });

      if ('mfaRequired' in res && res.mfaRequired) {
        setMfaChallengeToken(res.challengeToken);
      } else if ('token' in res) {
        onAuthenticated(res.token, res.user);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to sign in.');
    } finally {
      setLoading(false);
    }
  }

  async function handleMfaVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!mfaChallengeToken) return;
    setError(null);
    setLoading(true);
    try {
      const res = await apiRequest<{ token: string; user: AuthUser }>('/api/auth/mfa/verify', {
        method: 'POST',
        body: { challengeToken: mfaChallengeToken, code: mfaCode },
      });
      onAuthenticated(res.token, res.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Invalid verification code.');
    } finally {
      setLoading(false);
    }
  }

  async function handlePersonaSignIn(role: 'super_admin' | 'hr_admin' | 'manager' | 'employee') {
    setError(null);
    setLoading(true);
    try {
      const res = await apiRequest<{ token: string; user: AuthUser }>('/api/auth/demo-switch', {
        method: 'POST',
        body: { role },
      });
      onAuthenticated(res.token, res.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to switch role.');
    } finally {
      setLoading(false);
    }
  }

  async function handleClaimAdmin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setClaimSuccess(null);
    try {
      await apiRequest('/api/auth/claim-admin', {
        method: 'POST',
        body: { newPassword: claimPassword },
      });
      setPassword(claimPassword);
      setClaimPassword('');
      setAdminClaimRequired(false);
      setShowClaimForm(false);
      setClaimSuccess('Admin password configured. You may now sign in with your new credentials.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update admin password.');
    }
  }

  return (
    <div className="min-h-screen bg-[#FAFAFB] dark:bg-[#0B0F17] flex flex-col">
      {/* Clean 3-Zone Top Bar Contract */}
      <header className="h-14 px-6 lg:px-10 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#111827] flex items-center justify-between gap-8">
        <span className="font-display font-bold text-base tracking-tight text-neutral-900 dark:text-neutral-50 whitespace-nowrap shrink-0">
          Nexus HRM
        </span>
        <nav className="hidden md:flex items-center gap-6 text-sm text-neutral-600 dark:text-neutral-400">
          <span className="whitespace-nowrap shrink-0">Multi-Branch Workforce</span>
          <span className="whitespace-nowrap shrink-0">Statutory Payroll</span>
          <span className="whitespace-nowrap shrink-0">RBAC & Audit</span>
          <button
            type="button"
            onClick={onOpenCareers}
            className="text-neutral-900 dark:text-neutral-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors font-medium whitespace-nowrap shrink-0 cursor-pointer"
          >
            Career Portal
          </button>
        </nav>
        <button
          type="button"
          onClick={onOpenCareers}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-neutral-800 dark:text-neutral-100 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Briefcase className="w-3.5 h-3.5" />
          <span>Open Roles</span>
        </button>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-10 lg:py-14 grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
        {/* Left: Credential & MFA Sign-In */}
        <section className="lg:col-span-5 bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg p-7">
          <div className="mb-6">
            <p className="text-xs font-medium text-blue-600 dark:text-blue-400">
              Nexus Technologies Inc.
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
              {mfaChallengeToken ? 'Two-Factor Verification' : 'Sign in to Nexus HRM'}
            </h1>
            <p className="mt-1.5 text-sm text-neutral-500 dark:text-neutral-400">
              {mfaChallengeToken
                ? 'Enter the 6-digit code from your authenticator app or one of your backup recovery codes.'
                : 'Enterprise people operations, multi-branch payroll, and compliance governance.'}
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-4 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded-md"
            >
              {error}
            </div>
          )}

          {claimSuccess && (
            <div className="mb-4 px-3.5 py-2.5 text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 rounded-md">
              {claimSuccess}
            </div>
          )}

          {!mfaChallengeToken ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label
                  htmlFor="login-identifier"
                  className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5"
                >
                  Work Email or Username
                </label>
                <input
                  id="login-identifier"
                  type="text"
                  required
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-md text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-600/30 focus:border-blue-600"
                />
              </div>

              <div>
                <label
                  htmlFor="login-password"
                  className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5"
                >
                  Password
                </label>
                <input
                  id="login-password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-md text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-600/30 focus:border-blue-600"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-md transition-colors cursor-pointer"
              >
                <Lock className="w-4 h-4" />
                <span>{loading ? 'Signing in...' : 'Sign In'}</span>
              </button>
            </form>
          ) : (
            <form onSubmit={handleMfaVerify} className="space-y-4">
              <div>
                <label
                  htmlFor="mfa-code"
                  className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5"
                >
                  Authenticator or Recovery Code
                </label>
                <input
                  id="mfa-code"
                  type="text"
                  required
                  autoFocus
                  placeholder="123456 or XXXX-XXXX"
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono tracking-wider bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-md text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-600/30 focus:border-blue-600"
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-md transition-colors cursor-pointer"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>{loading ? 'Verifying...' : 'Verify & Continue'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMfaChallengeToken(null);
                    setMfaCode('');
                  }}
                  className="px-3.5 py-2.5 text-xs font-medium text-neutral-600 dark:text-neutral-300 border border-neutral-200 dark:border-neutral-700 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer"
                >
                  Back
                </button>
              </div>
            </form>
          )}

          {adminClaimRequired && !mfaChallengeToken && (
            <div className="mt-6 pt-5 border-t border-neutral-200 dark:border-neutral-800">
              {!showClaimForm ? (
                <button
                  type="button"
                  onClick={() => setShowClaimForm(true)}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 cursor-pointer"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>First-run setup: Set custom Super Admin password</span>
                </button>
              ) : (
                <form onSubmit={handleClaimAdmin} className="space-y-2.5">
                  <label
                    htmlFor="claim-pw"
                    className="block text-xs font-medium text-neutral-700 dark:text-neutral-300"
                  >
                    New Super Admin Password (min. 8 characters)
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="claim-pw"
                      type="password"
                      minLength={8}
                      required
                      value={claimPassword}
                      onChange={(e) => setClaimPassword(e.target.value)}
                      className="flex-1 px-3 py-1.5 text-xs bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-md"
                    />
                    <button
                      type="submit"
                      className="px-3 py-1.5 text-xs font-medium text-white bg-neutral-900 dark:bg-neutral-100 dark:text-neutral-900 rounded-md cursor-pointer"
                    >
                      Save
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </section>

        {/* Right: Enterprise Role Personas & Platform Overview */}
        <section className="lg:col-span-7 space-y-6">
          <div>
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
              Explore by Enterprise Role
            </h2>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              Select a workspace persona to inspect role-adaptive dashboards, branch-scoped permissions, and self-service workflows immediately.
            </p>
          </div>

          <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg divide-y divide-neutral-200 dark:divide-neutral-800">
            {PERSONAS.map((p) => (
              <button
                key={p.role}
                type="button"
                disabled={loading}
                onClick={() => handlePersonaSignIn(p.role)}
                className="w-full px-5 py-4 flex items-center justify-between gap-4 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors cursor-pointer group"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <Avatar src={p.avatar} name={p.name} size="lg" />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-50 truncate">
                      {p.name}
                      <span className="mx-2 text-neutral-300 dark:text-neutral-700 font-normal">·</span>
                      <span className="text-xs font-normal text-neutral-500 dark:text-neutral-400">
                        {p.title}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400 truncate">
                      {p.scope}
                    </div>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-neutral-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 group-hover:translate-x-0.5 transition-all shrink-0" />
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-2 text-xs text-neutral-600 dark:text-neutral-400">
            <div>
              <div className="font-semibold text-neutral-900 dark:text-neutral-100">
                4 Global Branches
              </div>
              <p className="mt-1">
                Austin HQ, New York East, London EMEA, and Singapore APAC with local tax rates and holidays.
              </p>
            </div>
            <div>
              <div className="font-semibold text-neutral-900 dark:text-neutral-100">
                Statutory Payroll Governance
              </div>
              <p className="mt-1">
                Dry-run variance checks, progressive brackets, FICA caps, proration, and locked payslips.
              </p>
            </div>
            <div>
              <div className="font-semibold text-neutral-900 dark:text-neutral-100">
                Tamper-Evident Audit & API
              </div>
              <p className="mt-1">
                SHA-256 hash-chained audit logs, RFC 6238 TOTP MFA, scoped API keys, and signed webhooks.
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
