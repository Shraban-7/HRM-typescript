'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { apiRequest, setAuthToken } from './lib/api';
import { signOutSupabase } from './lib/supabase';
import type { AuthUser, Branch, NavSection } from './types/hrm';
import { AuthScreen } from './components/auth/AuthScreen';
import { AppShell } from './components/layout/AppShell';
import { PublicCareersView } from './views/PublicCareersView';
import { DashboardView } from './views/DashboardView';
import { PeopleView } from './views/PeopleView';
import { PayrollView } from './views/PayrollView';
import { AttendanceLeaveView } from './views/AttendanceLeaveView';
import { RecruitmentView } from './views/RecruitmentView';
import { PerformanceView } from './views/PerformanceView';
import { OperationsView } from './views/OperationsView';
import { AnalyticsWorkflowsView } from './views/AnalyticsWorkflowsView';
import { SecurityDeveloperView } from './views/SecurityDeveloperView';

export function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [activeSection, setActiveSection] = useState<NavSection>('dashboard');
  const [selectedBranchId, setSelectedBranchId] = useState<number | null>(null);
  const [showCareers, setShowCareers] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  const loadBranches = useCallback(async () => {
    try {
      const res = await apiRequest<{ branches: Branch[] }>('/api/branches');
      setBranches(res.branches);
    } catch {
      // ignore if logged out
    }
  }, []);

  const handleAuthenticated = useCallback(
    async (token: string, authedUser: AuthUser) => {
      setAuthToken(token);
      setUser(authedUser);
      setShowCareers(false);
      await loadBranches();
    },
    [loadBranches]
  );

  // Support ?autostart=1 for automated inspection & fast demo entry
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1' && !user) {
      apiRequest<{ token: string; user: AuthUser }>('/api/auth/demo-switch', {
        method: 'POST',
        body: { role: 'super_admin' },
      })
        .then((res) => handleAuthenticated(res.token, res.user))
        .catch(() => {});
    }
  }, [handleAuthenticated, user]);

  async function handleSwitchRole(role: 'super_admin' | 'hr_admin' | 'manager' | 'employee') {
    try {
      const res = await apiRequest<{ token: string; user: AuthUser }>('/api/auth/demo-switch', {
        method: 'POST',
        body: { role },
      });
      setAuthToken(res.token);
      setUser(res.user);
      setActiveSection('dashboard');
      setSelectedBranchId(null);
      await loadBranches();
      showToast(`Switched active workspace persona to ${res.user.fullName}.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to switch persona.');
    }
  }

  async function handleRefreshUser() {
    try {
      const res = await apiRequest<{ user: AuthUser }>('/api/auth/me');
      setUser(res.user);
    } catch {
      // ignore
    }
  }

  async function handleLogout() {
    try {
      await Promise.all([
        apiRequest('/api/auth/logout', { method: 'POST' }),
        signOutSupabase(),
      ]);
    } catch {
      // ignore
    }
    setAuthToken(null);
    setUser(null);
    setBranches([]);
    setSelectedBranchId(null);
    setActiveSection('dashboard');
  }

  if (showCareers) {
    return <PublicCareersView onBack={() => setShowCareers(false)} />;
  }

  if (!user) {
    return (
      <AuthScreen
        onAuthenticated={handleAuthenticated}
        onOpenCareers={() => setShowCareers(true)}
      />
    );
  }

  return (
    <>
      <AppShell
        user={user}
        branches={branches}
        activeSection={activeSection}
        selectedBranchId={selectedBranchId}
        darkMode={darkMode}
        onSelectSection={setActiveSection}
        onSelectBranch={setSelectedBranchId}
        onToggleTheme={() => setDarkMode((v) => !v)}
        onSwitchRole={handleSwitchRole}
        onOpenCareers={() => setShowCareers(true)}
        onLogout={handleLogout}
      >
        {activeSection === 'dashboard' && (
          <DashboardView
            user={user}
            selectedBranchId={selectedBranchId}
            onNavigate={setActiveSection}
            onToast={showToast}
          />
        )}
        {activeSection === 'people' && (
          <PeopleView
            user={user}
            branches={branches}
            selectedBranchId={selectedBranchId}
            onBranchesUpdated={loadBranches}
            onToast={showToast}
          />
        )}
        {activeSection === 'payroll' && (
          <PayrollView
            user={user}
            branches={branches}
            selectedBranchId={selectedBranchId}
            onToast={showToast}
          />
        )}
        {activeSection === 'attendance' && (
          <AttendanceLeaveView
            user={user}
            branches={branches}
            selectedBranchId={selectedBranchId}
            onToast={showToast}
          />
        )}
        {activeSection === 'recruitment' && (
          <RecruitmentView
            user={user}
            branches={branches}
            selectedBranchId={selectedBranchId}
            onOpenCareers={() => setShowCareers(true)}
            onToast={showToast}
          />
        )}
        {activeSection === 'performance' && (
          <PerformanceView
            user={user}
            selectedBranchId={selectedBranchId}
            onToast={showToast}
          />
        )}
        {activeSection === 'operations' && (
          <OperationsView
            user={user}
            branches={branches}
            selectedBranchId={selectedBranchId}
            onToast={showToast}
          />
        )}
        {activeSection === 'analytics' && (
          <AnalyticsWorkflowsView
            user={user}
            branches={branches}
            selectedBranchId={selectedBranchId}
            onToast={showToast}
          />
        )}
        {activeSection === 'security' && (
          <SecurityDeveloperView
            user={user}
            branches={branches}
            onRefreshUser={handleRefreshUser}
            onToast={showToast}
          />
        )}
      </AppShell>

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-5 right-5 z-50 max-w-md flex items-center gap-2.5 px-4 py-3 bg-neutral-900 dark:bg-neutral-100 text-neutral-50 dark:text-neutral-900 rounded-lg shadow-lg text-xs font-medium no-print"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-400 dark:text-emerald-600 shrink-0" />
          <span className="flex-1">{toast}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label="Dismiss notification"
            className="opacity-70 hover:opacity-100 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </>
  );
}

export default App;
