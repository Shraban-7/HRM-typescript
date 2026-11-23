import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Bell,
  Briefcase,
  Building2,
  CalendarClock,
  Command,
  DollarSign,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Search,
  Shield,
  Sun,
  TrendingUp,
  Users,
  X,
} from 'lucide-react';
import { apiRequest, hasPerm } from '../../lib/api';
import type { AuthUser, Branch, NavSection } from '../../types/hrm';
import { Avatar } from '../ui/Primitives';

interface AppShellProps {
  user: AuthUser;
  branches: Branch[];
  activeSection: NavSection;
  selectedBranchId: number | null;
  darkMode: boolean;
  onSelectSection: (section: NavSection) => void;
  onSelectBranch: (branchId: number | null) => void;
  onToggleTheme: () => void;
  onSwitchRole: (role: 'super_admin' | 'hr_admin' | 'manager' | 'employee') => void;
  onOpenCareers: () => void;
  onLogout: () => void;
  children: React.ReactNode;
}

interface NavItem {
  id: NavSection;
  label: string;
  group: string;
  icon: React.ComponentType<{ className?: string }>;
  permission?: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Overview', group: 'Workspace', icon: LayoutDashboard },
  { id: 'people', label: 'People & Org', group: 'Core HR', icon: Users, permission: 'employees.view' },
  { id: 'attendance', label: 'Time & Leave', group: 'Core HR', icon: CalendarClock },
  { id: 'payroll', label: 'Payroll & Benefits', group: 'Compensation', icon: DollarSign, permission: 'payroll.view' },
  { id: 'recruitment', label: 'Recruitment ATS', group: 'Talent', icon: Briefcase, permission: 'recruitment.view' },
  { id: 'performance', label: 'Performance & OKRs', group: 'Talent', icon: TrendingUp, permission: 'performance.view' },
  { id: 'operations', label: 'Workplace Ops', group: 'Operations', icon: FolderKanban },
  { id: 'analytics', label: 'Analytics & Workflows', group: 'Intelligence', icon: BarChart3, permission: 'analytics.view' },
  { id: 'security', label: 'Security & API', group: 'Governance', icon: Shield },
];

export function AppShell({
  user,
  branches,
  activeSection,
  selectedBranchId,
  darkMode,
  onSelectSection,
  onSelectBranch,
  onToggleTheme,
  onSwitchRole,
  onOpenCareers,
  onLogout,
  children,
}: AppShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmdQuery, setCmdQuery] = useState('');
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<
    Array<{ id: number; title: string; message: string; category: string; is_read: number; created_at: string }>
  >([]);

  const visibleNav = useMemo(
    () =>
      NAV_ITEMS.filter(
        (item) => !item.permission || hasPerm(user.permissions, user.roles, item.permission)
      ),
    [user]
  );

  const groupedNav = useMemo(() => {
    const groups: Record<string, NavItem[]> = {};
    for (const item of visibleNav) {
      if (!groups[item.group]) groups[item.group] = [];
      groups[item.group].push(item);
    }
    return Object.entries(groups);
  }, [visibleNav]);

  const activeNavMeta = visibleNav.find((n) => n.id === activeSection) ?? visibleNav[0];
  const activeBranch = branches.find((b) => b.id === selectedBranchId) ?? null;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdOpen((v) => !v);
      } else if (e.key === 'Escape') {
        setCmdOpen(false);
        setNotifOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  async function loadNotifications() {
    try {
      const res = await apiRequest<{ notifications: typeof notifications }>('/api/notifications');
      setNotifications(res.notifications);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    loadNotifications();
  }, [user.id]);

  async function markAllRead() {
    await apiRequest('/api/notifications/read-all', { method: 'POST' });
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: 1 })));
  }

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const cmdResults = visibleNav.filter((n) =>
    `${n.label} ${n.group}`.toLowerCase().includes(cmdQuery.trim().toLowerCase())
  );

  const roleLabel = user.roles.includes('super_admin')
    ? 'Super Admin'
    : user.roles.includes('hr_admin')
      ? 'HR Admin'
      : user.roles.includes('manager')
        ? 'Branch Manager'
        : 'Employee';

  const sidebarContent = (
    <div className="h-full flex flex-col bg-[#F4F5F7] dark:bg-[#0F1623] border-r border-neutral-200 dark:border-neutral-800">
      <div className="h-14 px-4 flex items-center justify-between border-b border-neutral-200 dark:border-neutral-800 shrink-0">
        <button
          type="button"
          onClick={() => onSelectSection('dashboard')}
          className="font-display font-bold text-sm tracking-tight text-neutral-900 dark:text-neutral-50 whitespace-nowrap cursor-pointer"
        >
          Nexus HRM
        </button>
        <button
          type="button"
          onClick={() => setMobileNavOpen(false)}
          aria-label="Close navigation"
          className="lg:hidden p-1 text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5" aria-label="Primary navigation">
        {groupedNav.map(([group, items]) => (
          <div key={group}>
            <div className="px-2.5 mb-1.5 text-[11px] font-medium text-neutral-500 dark:text-neutral-500">
              {group}
            </div>
            <ul className="space-y-0.5">
              {items.map((item) => {
                const Icon = item.icon;
                const isActive = item.id === activeSection;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelectSection(item.id);
                        setMobileNavOpen(false);
                      }}
                      className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                        isActive
                          ? 'bg-white dark:bg-neutral-800 text-blue-600 dark:text-blue-400 shadow-2xs border border-neutral-200/80 dark:border-neutral-700/80'
                          : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50 border border-transparent'
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Bottom Workspace Persona Switcher & Account */}
      <div className="p-3 border-t border-neutral-200 dark:border-neutral-800 space-y-2.5 shrink-0">
        <div className="flex items-center gap-2.5 px-1">
          <Avatar src={user.avatarUrl} name={user.fullName} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold text-neutral-900 dark:text-neutral-100 truncate">
              {user.fullName}
            </div>
            <div className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate">
              {roleLabel} {user.mfaEnabled ? '· MFA On' : ''}
            </div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            aria-label="Sign out"
            title="Sign out"
            className="p-1.5 rounded-md text-neutral-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-neutral-200/60 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <label htmlFor="persona-switch" className="sr-only">
            Switch preview role
          </label>
          <select
            id="persona-switch"
            aria-label="Switch active role"
            value={user.roles[0] ?? 'employee'}
            onChange={(e) =>
              onSwitchRole(e.target.value as 'super_admin' | 'hr_admin' | 'manager' | 'employee')
            }
            className="flex-1 text-[11px] px-2 py-1.5 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md text-neutral-700 dark:text-neutral-300 cursor-pointer"
          >
            <option value="super_admin">View as Super Admin</option>
            <option value="hr_admin">View as HR Admin</option>
            <option value="manager">View as Branch Manager</option>
            <option value="employee">View as Employee</option>
          </select>
          <button
            type="button"
            onClick={onOpenCareers}
            title="Open Public Career Portal"
            className="px-2 py-1.5 text-[11px] font-medium text-neutral-600 dark:text-neutral-300 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer whitespace-nowrap"
          >
            Careers
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-[#FAFAFB] dark:bg-[#0B0F17] text-neutral-900 dark:text-neutral-100">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-[248px] shrink-0 sticky top-0 h-screen no-print">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer Sidebar */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex no-print">
          <div
            className="fixed inset-0 bg-neutral-950/40"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden="true"
          />
          <div className="relative z-10 w-[260px] h-full">{sidebarContent}</div>
        </div>
      )}

      {/* Main Content Viewport */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Clean Single-Row Top Bar */}
        <header className="h-14 sticky top-0 z-30 px-4 sm:px-6 bg-white/95 dark:bg-[#111827]/95 backdrop-blur-xs border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between gap-4 no-print">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-1.5 rounded-md text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400 truncate">
              <span className="hidden sm:inline whitespace-nowrap">Nexus Technologies</span>
              <span className="hidden sm:inline text-neutral-300 dark:text-neutral-700">/</span>
              <span className="font-medium text-neutral-900 dark:text-neutral-100 whitespace-nowrap truncate">
                {activeNavMeta?.label ?? 'Overview'}
              </span>
              {activeBranch && (
                <>
                  <span className="text-neutral-300 dark:text-neutral-700">/</span>
                  <span className="text-blue-600 dark:text-blue-400 font-medium whitespace-nowrap">
                    {activeBranch.name}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Multi-Branch Scope Selector */}
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-md">
              <Building2 className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
              <select
                aria-label="Filter by office branch"
                value={selectedBranchId ?? ''}
                onChange={(e) => onSelectBranch(e.target.value ? Number(e.target.value) : null)}
                className="text-xs font-medium bg-transparent text-neutral-800 dark:text-neutral-200 focus:outline-none cursor-pointer"
              >
                <option value="">All Branches ({branches.length})</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.code})
                  </option>
                ))}
              </select>
            </div>

            {/* Cmd+K Quick Jump */}
            <button
              type="button"
              onClick={() => setCmdOpen(true)}
              aria-label="Open command palette"
              className="hidden sm:inline-flex items-center gap-2 px-2.5 py-1.5 text-xs text-neutral-500 dark:text-neutral-400 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-md hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors cursor-pointer whitespace-nowrap"
            >
              <Search className="w-3.5 h-3.5" />
              <span>Jump</span>
              <span className="font-mono text-[10px] text-neutral-400 flex items-center">
                <Command className="w-2.5 h-2.5 mr-0.5" />K
              </span>
            </button>

            {/* Notifications */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setNotifOpen((v) => !v);
                  if (!notifOpen) loadNotifications();
                }}
                aria-label="Notifications"
                className="relative p-2 rounded-md text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-blue-600 text-white font-mono text-[10px] font-semibold flex items-center justify-center">
                    {unreadCount}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 mt-2 w-80 bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg shadow-lg z-40 overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
                    <span className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">
                      Notifications
                    </span>
                    {unreadCount > 0 && (
                      <button
                        type="button"
                        onClick={markAllRead}
                        className="text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                      >
                        Mark all read
                      </button>
                    )}
                  </div>
                  <div className="max-h-72 overflow-y-auto divide-y divide-neutral-200 dark:divide-neutral-800">
                    {notifications.length === 0 ? (
                      <div className="px-4 py-6 text-xs text-neutral-500 text-center">
                        No notifications yet.
                      </div>
                    ) : (
                      notifications.map((n) => (
                        <div
                          key={n.id}
                          className={`px-4 py-3 text-xs ${
                            n.is_read ? 'opacity-70' : 'bg-blue-50/40 dark:bg-blue-950/20'
                          }`}
                        >
                          <div className="font-medium text-neutral-900 dark:text-neutral-100">
                            {n.title}
                          </div>
                          <p className="mt-0.5 text-neutral-500 dark:text-neutral-400">{n.message}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Light / Dark Theme Toggle */}
            <button
              type="button"
              onClick={onToggleTheme}
              aria-label={darkMode ? 'Switch to light theme' : 'Switch to dark theme'}
              className="p-2 rounded-md text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </header>

        <main className="flex-1 w-full max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {children}
        </main>
      </div>

      {/* Cmd+K Command Palette */}
      {cmdOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 p-4 no-print">
          <div
            className="fixed inset-0 bg-neutral-950/40 backdrop-blur-[1px]"
            onClick={() => setCmdOpen(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            className="relative z-10 w-full max-w-md bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg shadow-xl overflow-hidden"
          >
            <div className="flex items-center gap-2.5 px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
              <Search className="w-4 h-4 text-neutral-400" />
              <input
                type="text"
                autoFocus
                placeholder="Jump to workspace module or branch..."
                value={cmdQuery}
                onChange={(e) => setCmdQuery(e.target.value)}
                className="flex-1 text-sm bg-transparent text-neutral-900 dark:text-neutral-100 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setCmdOpen(false)}
                className="text-[11px] text-neutral-400 hover:text-neutral-700 cursor-pointer"
              >
                ESC
              </button>
            </div>
            <div className="max-h-72 overflow-y-auto py-2">
              {cmdResults.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onSelectSection(item.id);
                      setCmdOpen(false);
                      setCmdQuery('');
                    }}
                    className="w-full px-4 py-2.5 flex items-center justify-between text-sm text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
                  >
                    <span className="flex items-center gap-2.5">
                      <Icon className="w-4 h-4 text-neutral-500" />
                      <span>{item.label}</span>
                    </span>
                    <span className="text-xs text-neutral-400">{item.group}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
