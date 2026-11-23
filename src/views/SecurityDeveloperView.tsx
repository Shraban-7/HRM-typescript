import React, { useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  KeyRound,
  Lock,
  Play,
  Plus,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Webhook,
} from 'lucide-react';
import { apiRequest, formatDateShort, hasPerm } from '../lib/api';
import type { AuthUser, Branch } from '../types/hrm';
import {
  LoadingBlock,
  Modal,
  PageHeader,
  SegmentedTabs,
  StatusText,
} from '../components/ui/Primitives';

type SecTab = 'mfa' | 'rbac' | 'audit' | 'api' | 'webhooks';

interface RbacRole {
  id: number;
  slug: string;
  name: string;
  description: string;
  require_mfa: number;
  permissionIds: number[];
}

interface RbacPerm {
  id: number;
  slug: string;
  name: string;
  module: string;
}

interface RbacUserRow {
  id: number;
  email: string;
  full_name: string;
  status: string;
  mfa_enabled: number;
  failed_login_attempts: number;
  last_login_at: string | null;
  role_names: string;
}

interface AuditLogRow {
  id: number;
  actor_email: string | null;
  action: string;
  resource: string;
  resource_id: string | null;
  before_data: string | null;
  after_data: string | null;
  ip_address: string | null;
  prev_hash: string;
  entry_hash: string;
  created_at: string;
}

interface AuditIntegrity {
  valid: boolean;
  checkedCount: number;
  brokenAtId: number | null;
}

interface ApiKeyRow {
  id: number;
  name: string;
  key_prefix: string;
  scopes_json: string;
  last_used_at: string | null;
  is_active: number;
  created_at: string;
}

interface WebhookRow {
  id: number;
  name: string;
  target_url: string;
  events_json: string;
  is_active: number;
  created_at: string;
}

interface WebhookDeliveryRow {
  id: number;
  webhook_id: number;
  webhook_name: string;
  target_url: string;
  event_name: string;
  signature_header: string;
  response_status: number;
  status: string;
  delivered_at: string;
}

interface HolidayRow {
  id: number;
  branch_id: number | null;
  branch_name: string | null;
  name: string;
  holiday_date: string;
}

const API_SCOPES = [
  'employees:read',
  'branches:read',
  'attendance:read',
  'attendance:write',
  'payroll:read',
] as const;

const WEBHOOK_EVENTS = [
  'payroll.finalized',
  'leave.approved',
  'expense.approved',
  'employee.hired',
  'system.webhook_test',
];

const API_ENDPOINTS = [
  { id: 'employees', method: 'GET' as const, path: '/api/v1/employees', scope: 'employees:read' },
  { id: 'branches', method: 'GET' as const, path: '/api/v1/branches', scope: 'branches:read' },
  { id: 'attendance', method: 'GET' as const, path: '/api/v1/attendance/today', scope: 'attendance:read' },
  { id: 'payroll', method: 'GET' as const, path: '/api/v1/payroll/summary', scope: 'payroll:read' },
  { id: 'biometric', method: 'POST' as const, path: '/api/v1/integrations/biometric-sync', scope: 'attendance:write' },
];

export function SecurityDeveloperView({
  user,
  branches,
  onRefreshUser,
  onToast,
}: {
  user: AuthUser;
  branches: Branch[];
  onRefreshUser: () => Promise<void>;
  onToast: (msg: string) => void;
}) {
  const canSecurity = hasPerm(user.permissions, user.roles, 'security.manage');
  const canDeveloper = hasPerm(user.permissions, user.roles, 'developer.manage');

  const [tab, setTab] = useState<SecTab>('mfa');

  // MFA enrollment state
  const [mfaSetup, setMfaSetup] = useState<{
    secret: string;
    otpauthUri: string;
    currentSampleCode: string;
  } | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [mfaBusy, setMfaBusy] = useState(false);

  // RBAC state
  const [roles, setRoles] = useState<RbacRole[]>([]);
  const [permissions, setPermissions] = useState<RbacPerm[]>([]);
  const [secUsers, setSecUsers] = useState<RbacUserRow[]>([]);
  const [loadingRbac, setLoadingRbac] = useState(false);

  // Audit state
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [integrity, setIntegrity] = useState<AuditIntegrity | null>(null);
  const [auditQuery, setAuditQuery] = useState('');
  const [loadingAudit, setLoadingAudit] = useState(false);

  // API Keys & Explorer state
  const [apiKeys, setApiKeys] = useState<ApiKeyRow[]>([]);
  const [newKeyModal, setNewKeyModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyScopes, setNewKeyScopes] = useState<string[]>([
    'employees:read',
    'branches:read',
    'attendance:read',
  ]);
  const [createdKeyPlaintext, setCreatedKeyPlaintext] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  const [explorerEndpoint, setExplorerEndpoint] = useState(API_ENDPOINTS[0].id);
  const [explorerKey, setExplorerKey] = useState('');
  const [explorerResponse, setExplorerResponse] = useState<string | null>(null);
  const [explorerBusy, setExplorerBusy] = useState(false);

  // Webhooks & Company Settings state
  const [webhooks, setWebhooks] = useState<WebhookRow[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDeliveryRow[]>([]);
  const [whModal, setWhModal] = useState(false);
  const [whForm, setWhForm] = useState({
    name: '',
    targetUrl: 'https://hooks.enterprise.example/nexus-events',
    events: ['payroll.finalized', 'leave.approved'],
  });
  const [createdWhSecret, setCreatedWhSecret] = useState<string | null>(null);

  const [settings, setSettings] = useState<Record<string, string>>({});
  const [holidays, setHolidays] = useState<HolidayRow[]>([]);
  const [holidayForm, setHolidayForm] = useState({
    name: '',
    holidayDate: '2026-12-25',
    branchId: '',
  });

  async function loadRbac() {
    if (!canSecurity) return;
    setLoadingRbac(true);
    try {
      const res = await apiRequest<{ roles: RbacRole[]; permissions: RbacPerm[]; users: RbacUserRow[] }>(
        '/api/platform/rbac'
      );
      setRoles(res.roles);
      setPermissions(res.permissions);
      setSecUsers(res.users);
    } finally {
      setLoadingRbac(false);
    }
  }

  async function loadAudit(q = auditQuery) {
    if (!canSecurity) return;
    setLoadingAudit(true);
    try {
      const qs = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
      const res = await apiRequest<{ logs: AuditLogRow[]; integrity: AuditIntegrity }>(
        `/api/platform/audit${qs}`
      );
      setAuditLogs(res.logs);
      setIntegrity(res.integrity);
    } finally {
      setLoadingAudit(false);
    }
  }

  async function loadApiKeys() {
    if (!canDeveloper) return;
    const res = await apiRequest<{ keys: ApiKeyRow[] }>('/api/platform/api-keys');
    setApiKeys(res.keys);
  }

  async function loadWebhooksAndSettings() {
    const [sRes, whRes] = await Promise.all([
      apiRequest<{ settings: Record<string, string>; holidays: HolidayRow[] }>('/api/settings'),
      canDeveloper
        ? apiRequest<{ webhooks: WebhookRow[]; deliveries: WebhookDeliveryRow[] }>('/api/platform/webhooks')
        : Promise.resolve({ webhooks: [], deliveries: [] }),
    ]);
    setSettings(sRes.settings);
    setHolidays(sRes.holidays);
    setWebhooks(whRes.webhooks);
    setDeliveries(whRes.deliveries);
  }

  useEffect(() => {
    if (tab === 'mfa' || tab === 'rbac') loadRbac();
    if (tab === 'audit') loadAudit();
    if (tab === 'api') loadApiKeys();
    if (tab === 'webhooks') loadWebhooksAndSettings();
  }, [tab]);

  // MFA handlers
  async function handleStartMfa() {
    setMfaBusy(true);
    try {
      const res = await apiRequest<{ secret: string; otpauthUri: string; currentSampleCode: string }>(
        '/api/auth/mfa/setup',
        { method: 'POST' }
      );
      setMfaSetup(res);
      setMfaCode(res.currentSampleCode);
      setRecoveryCodes(null);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to initialize TOTP enrollment.');
    } finally {
      setMfaBusy(false);
    }
  }

  async function handleEnableMfa(e: React.FormEvent) {
    e.preventDefault();
    setMfaBusy(true);
    try {
      const res = await apiRequest<{ ok: boolean; recoveryCodes: string[] }>('/api/auth/mfa/enable', {
        method: 'POST',
        body: { code: mfaCode.trim() },
      });
      setRecoveryCodes(res.recoveryCodes);
      setMfaSetup(null);
      await onRefreshUser();
      await loadRbac();
      onToast('Two-Factor Authenticator (TOTP) enabled on your account.');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Invalid verification code.');
    } finally {
      setMfaBusy(false);
    }
  }

  async function handleDisableMfa() {
    setMfaBusy(true);
    try {
      await apiRequest('/api/auth/mfa/disable', { method: 'POST' });
      setRecoveryCodes(null);
      setMfaSetup(null);
      await onRefreshUser();
      await loadRbac();
      onToast('TOTP MFA disabled for your account.');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to disable MFA.');
    } finally {
      setMfaBusy(false);
    }
  }

  // RBAC handlers
  async function handleTogglePerm(roleId: number, permissionId: number) {
    try {
      await apiRequest('/api/platform/rbac/toggle-permission', {
        method: 'POST',
        body: { roleId, permissionId },
      });
      await loadRbac();
      onToast('Role permission matrix updated and logged.');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to update permission.');
    }
  }

  async function handleToggleMfaPolicy(roleId: number) {
    try {
      await apiRequest('/api/platform/rbac/toggle-mfa-policy', {
        method: 'POST',
        body: { roleId },
      });
      await loadRbac();
      onToast('Role MFA enforcement policy updated.');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to update MFA policy.');
    }
  }

  // API Key handlers
  async function handleCreateApiKey(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await apiRequest<{ plaintextKey: string }>('/api/platform/api-keys', {
        method: 'POST',
        body: { name: newKeyName, scopes: newKeyScopes },
      });
      setCreatedKeyPlaintext(res.plaintextKey);
      setExplorerKey(res.plaintextKey);
      setNewKeyModal(false);
      setNewKeyName('');
      await loadApiKeys();
      onToast('Scoped API key generated. Copy it now — it will not be shown again.');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to create API key.');
    }
  }

  async function handleRevokeKey(id: number) {
    try {
      await apiRequest(`/api/platform/api-keys/${id}/revoke`, { method: 'POST' });
      await loadApiKeys();
      onToast('API key revoked.');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to revoke API key.');
    }
  }

  async function handleRunExplorer() {
    const ep = API_ENDPOINTS.find((x) => x.id === explorerEndpoint) ?? API_ENDPOINTS[0];
    setExplorerBusy(true);
    try {
      const body =
        ep.id === 'biometric'
          ? {
              deviceId: 'BIO-AUSTIN-GATE-01',
              punches: [
                {
                  employeeCode: 'NX-1004',
                  workDate: '2026-11-23',
                  clockIn: '2026-11-23T08:52:00.000Z',
                  clockOut: '2026-11-23T17:38:00.000Z',
                },
              ],
            }
          : undefined;
      const res = await apiRequest<unknown>(ep.path, {
        method: ep.method,
        body,
        bearerOverride: explorerKey.trim() || undefined,
      });
      setExplorerResponse(JSON.stringify(res, null, 2));
      onToast(`${ep.method} ${ep.path} succeeded (200 OK).`);
    } catch (err) {
      setExplorerResponse(
        JSON.stringify({ error: err instanceof Error ? err.message : 'Request failed' }, null, 2)
      );
    } finally {
      setExplorerBusy(false);
    }
  }

  // Webhook handlers
  async function handleCreateWebhook(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await apiRequest<{ signingSecret: string }>('/api/platform/webhooks', {
        method: 'POST',
        body: whForm,
      });
      setCreatedWhSecret(res.signingSecret);
      setWhModal(false);
      setWhForm((p) => ({ ...p, name: '' }));
      await loadWebhooksAndSettings();
      onToast('Webhook endpoint registered with HMAC-SHA256 signing secret.');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Invalid webhook endpoint.');
    }
  }

  async function handleTestWebhook(id: number) {
    try {
      const res = await apiRequest<{ delivery: { signature: string; status: string } }>(
        `/api/platform/webhooks/${id}/test`,
        { method: 'POST' }
      );
      await loadWebhooksAndSettings();
      onToast(`Signed webhook test dispatched (${res.delivery.status}).`);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Test dispatch failed.');
    }
  }

  async function handleDeleteWebhook(id: number) {
    await apiRequest(`/api/platform/webhooks/${id}`, { method: 'DELETE' });
    await loadWebhooksAndSettings();
    onToast('Webhook endpoint deleted.');
  }

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiRequest('/api/settings', { method: 'PUT', body: settings });
      onToast('Company configuration saved.');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to save settings.');
    }
  }

  async function handleAddHoliday(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiRequest('/api/holidays', {
        method: 'POST',
        body: {
          name: holidayForm.name,
          holidayDate: holidayForm.holidayDate,
          branchId: holidayForm.branchId ? Number(holidayForm.branchId) : null,
        },
      });
      setHolidayForm({ name: '', holidayDate: '2026-12-25', branchId: '' });
      await loadWebhooksAndSettings();
      onToast('Holiday added to branch calendar.');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Unable to add holiday.');
    }
  }

  function copyText(val: string) {
    navigator.clipboard?.writeText(val).catch(() => {});
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 1800);
  }

  const tabs: Array<{ id: SecTab; label: string }> = [
    { id: 'mfa', label: 'MFA & Account Security' },
    ...(canSecurity ? [{ id: 'rbac' as const, label: 'RBAC Matrix' }] : []),
    ...(canSecurity ? [{ id: 'audit' as const, label: 'Audit Hash Chain' }] : []),
    ...(canDeveloper ? [{ id: 'api' as const, label: 'Public API v1 & Keys' }] : []),
    { id: 'webhooks', label: canDeveloper ? 'Webhooks & Settings' : 'Company Calendar' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Security, Governance & Developer API"
        description="RFC 6238 TOTP MFA enrollment, uniform role-based access control, SHA-256 tamper-evident audit logs, versioned REST API v1, and HMAC-signed webhooks."
      />

      <SegmentedTabs<SecTab> active={tab} onChange={setTab} tabs={tabs} />

      {/* TAB 1: MFA & ACCOUNT SECURITY */}
      {tab === 'mfa' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg p-6 space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-50 flex items-center gap-2">
                  <Lock className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <span>Two-Factor Authentication (TOTP)</span>
                </h2>
                <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                  Protect {user.email} with a standards-compliant RFC 6238 authenticator app and 8 single-use recovery codes.
                </p>
              </div>
              <StatusText status={user.mfaEnabled ? 'active' : 'pending'} />
            </div>

            {!user.mfaEnabled && !mfaSetup && (
              <div className="p-4 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-md flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="text-xs text-neutral-600 dark:text-neutral-300">
                  TOTP MFA is not yet active on your profile. Enroll now to harden sign-in and payroll approvals.
                </div>
                <button
                  type="button"
                  disabled={mfaBusy}
                  onClick={handleStartMfa}
                  className="px-3.5 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer shrink-0 whitespace-nowrap"
                >
                  Enroll Authenticator
                </button>
              </div>
            )}

            {mfaSetup && (
              <form
                onSubmit={handleEnableMfa}
                className="p-4 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-md space-y-4"
              >
                <div className="space-y-1.5">
                  <div className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">
                    Step 1 — Add Secret to Your Authenticator App
                  </div>
                  <div className="p-2.5 bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-700 rounded font-mono text-xs text-neutral-800 dark:text-neutral-200 break-all">
                    Secret: {mfaSetup.secret}
                  </div>
                  <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
                    Current live TOTP verification code for testing:{' '}
                    <span className="font-mono font-semibold text-blue-600 dark:text-blue-400">
                      {mfaSetup.currentSampleCode}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row gap-2.5">
                  <input
                    type="text"
                    required
                    maxLength={6}
                    aria-label="6-digit authenticator code"
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value)}
                    placeholder="Enter 6-digit code"
                    className="flex-1 px-3 py-2 text-sm font-mono tracking-widest bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-700 rounded-md"
                  />
                  <button
                    type="submit"
                    disabled={mfaBusy}
                    className="px-4 py-2 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-md cursor-pointer whitespace-nowrap"
                  >
                    Verify & Activate MFA
                  </button>
                </div>
              </form>
            )}

            {recoveryCodes && (
              <div className="p-4 bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/60 rounded-md space-y-2.5">
                <div className="text-xs font-semibold text-emerald-900 dark:text-emerald-300">
                  Save Your 8 Single-Use Recovery Codes (Shown Once)
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-xs text-neutral-800 dark:text-neutral-200">
                  {recoveryCodes.map((code) => (
                    <div
                      key={code}
                      className="px-2 py-1.5 bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded text-center"
                    >
                      {code}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {user.mfaEnabled && (
              <div className="pt-2 flex items-center justify-between border-t border-neutral-200 dark:border-neutral-800">
                <span className="text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5 font-medium">
                  <CheckCircle2 className="w-4 h-4" />
                  Authenticator verified and protecting sign-ins
                </span>
                <button
                  type="button"
                  disabled={mfaBusy}
                  onClick={handleDisableMfa}
                  className="px-3 py-1.5 text-xs font-medium text-red-700 dark:text-red-400 border border-red-200 dark:border-red-900/60 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-md cursor-pointer"
                >
                  Disable MFA
                </button>
              </div>
            )}
          </div>

          {canSecurity && (
            <div className="lg:col-span-5 bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg p-6 space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                  Role-Level MFA Policy
                </h2>
                <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                  Enforce authenticator verification policies across enterprise roles.
                </p>
              </div>
              <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
                {roles.map((r) => (
                  <div key={r.id} className="py-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">{r.name}</div>
                      <div className="text-[11px] text-neutral-500 dark:text-neutral-400">{r.description}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleToggleMfaPolicy(r.id)}
                      className={`px-2.5 py-1 text-xs font-medium rounded border cursor-pointer whitespace-nowrap ${
                        r.require_mfa
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-300 border-neutral-200 dark:border-neutral-700'
                      }`}
                    >
                      {r.require_mfa ? 'MFA Required' : 'Optional'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: RBAC PERMISSION MATRIX */}
      {tab === 'rbac' && canSecurity && (
        <div className="space-y-6">
          {loadingRbac ? (
            <LoadingBlock rows={6} />
          ) : (
            <>
              <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
                <div className="px-5 py-4 border-b border-neutral-200 dark:border-neutral-800">
                  <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                    Uniform Permission Matrix
                  </h2>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    Click any permission cell for HR Admin, Branch Manager, or Employee to grant or revoke live server-side authorization.
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-900/40 text-[11px] font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                        <th className="py-3 px-4">Permission</th>
                        <th className="py-3 px-4">Module</th>
                        {roles.map((r) => (
                          <th key={r.id} className="py-3 px-4 text-center">
                            {r.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800 text-xs">
                      {permissions.map((perm) => (
                        <tr key={perm.id} className="hover:bg-neutral-50/70 dark:hover:bg-neutral-800/30">
                          <td className="py-2.5 px-4">
                            <div className="font-medium text-neutral-900 dark:text-neutral-100">{perm.name}</div>
                            <div className="font-mono text-[11px] text-neutral-500">{perm.slug}</div>
                          </td>
                          <td className="py-2.5 px-4 text-neutral-500 dark:text-neutral-400">{perm.module}</td>
                          {roles.map((role) => {
                            const has = role.permissionIds.includes(perm.id);
                            const locked = role.slug === 'super_admin';
                            return (
                              <td key={role.id} className="py-2.5 px-4 text-center">
                                <button
                                  type="button"
                                  disabled={locked}
                                  aria-label={`Toggle ${perm.slug} for ${role.name}`}
                                  onClick={() => handleTogglePerm(role.id, perm.id)}
                                  className={`w-7 h-7 inline-flex items-center justify-center rounded border transition-colors ${
                                    has
                                      ? 'bg-blue-600 border-blue-600 text-white'
                                      : 'bg-white dark:bg-neutral-900 border-neutral-300 dark:border-neutral-700 text-transparent'
                                  } ${locked ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:border-blue-500'}`}
                                >
                                  <Check className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
                <div className="px-5 py-3.5 border-b border-neutral-200 dark:border-neutral-800">
                  <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                    Identity Accounts & Lockout Telemetry
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-900/40 text-[11px] uppercase tracking-wider text-neutral-500">
                        <th className="py-2.5 px-4">Account</th>
                        <th className="py-2.5 px-4">Role</th>
                        <th className="py-2.5 px-4">MFA</th>
                        <th className="py-2.5 px-4 text-right">Failed Attempts</th>
                        <th className="py-2.5 px-4">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
                      {secUsers.map((u) => (
                        <tr key={u.id}>
                          <td className="py-2.5 px-4">
                            <div className="font-medium text-neutral-900 dark:text-neutral-100">{u.full_name}</div>
                            <div className="text-neutral-500">{u.email}</div>
                          </td>
                          <td className="py-2.5 px-4 text-neutral-700 dark:text-neutral-300">{u.role_names}</td>
                          <td className="py-2.5 px-4">
                            <StatusText status={u.mfa_enabled ? 'active' : 'pending'} />
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums">{u.failed_login_attempts}</td>
                          <td className="py-2.5 px-4">
                            <StatusText status={u.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB 3: TAMPER-EVIDENT AUDIT LOG */}
      {tab === 'audit' && canSecurity && (
        <div className="space-y-4">
          {integrity && (
            <div
              className={`p-4 rounded-lg border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                integrity.valid
                  ? 'bg-emerald-50/70 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/60'
                  : 'bg-red-50/70 dark:bg-red-950/20 border-red-200 dark:border-red-900/60'
              }`}
            >
              <div className="flex items-center gap-2.5">
                {integrity.valid ? (
                  <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                ) : (
                  <ShieldAlert className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0" />
                )}
                <div>
                  <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                    {integrity.valid
                      ? 'SHA-256 Cryptographic Audit Hash Chain Verified'
                      : `Hash Chain Break Detected at Entry #${integrity.brokenAtId}`}
                  </div>
                  <div className="text-xs text-neutral-600 dark:text-neutral-400 font-mono tabular-nums">
                    {integrity.checkedCount} immutable audit entries verified end-to-end
                  </div>
                </div>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  loadAudit(auditQuery);
                }}
                className="flex items-center gap-2"
              >
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={auditQuery}
                    onChange={(e) => setAuditQuery(e.target.value)}
                    placeholder="Filter action or actor..."
                    className="pl-8 pr-3 py-1.5 text-xs bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-700 rounded-md"
                  />
                </div>
                <button
                  type="submit"
                  className="px-3 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-200 bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-700 rounded-md cursor-pointer"
                >
                  Search
                </button>
              </form>
            </div>
          )}

          {loadingAudit ? (
            <LoadingBlock rows={6} />
          ) : (
            <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-900/40 text-[11px] uppercase tracking-wider text-neutral-500">
                      <th className="py-3 px-4">ID & Time</th>
                      <th className="py-3 px-4">Actor</th>
                      <th className="py-3 px-4">Action & Resource</th>
                      <th className="py-3 px-4">Change Payload</th>
                      <th className="py-3 px-4">SHA-256 Chain Hash</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
                    {auditLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-neutral-50/70 dark:hover:bg-neutral-800/30">
                        <td className="py-2.5 px-4 font-mono tabular-nums whitespace-nowrap text-neutral-500">
                          <div>#{log.id}</div>
                          <div className="text-[10px]">{log.created_at.replace('T', ' ').slice(0, 19)}</div>
                        </td>
                        <td className="py-2.5 px-4 text-neutral-800 dark:text-neutral-200">
                          {log.actor_email ?? 'system'}
                        </td>
                        <td className="py-2.5 px-4">
                          <div className="font-mono font-medium text-neutral-900 dark:text-neutral-100">
                            {log.action}
                          </div>
                          <div className="text-[11px] text-neutral-500">
                            {log.resource}
                            {log.resource_id ? ` · #${log.resource_id}` : ''}
                          </div>
                        </td>
                        <td className="py-2.5 px-4 max-w-xs truncate font-mono text-[11px] text-neutral-600 dark:text-neutral-400">
                          {log.after_data ?? '—'}
                        </td>
                        <td className="py-2.5 px-4 font-mono text-[11px] text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                          {log.entry_hash.slice(0, 16)}…
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: PUBLIC REST API v1 & KEY MANAGER */}
      {tab === 'api' && canDeveloper && (
        <div className="space-y-6">
          {createdKeyPlaintext && (
            <div className="p-4 bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/60 rounded-lg space-y-2">
              <div className="text-xs font-semibold text-blue-900 dark:text-blue-200">
                New Scoped API Key Created — Copy & Store Securely (Shown Once)
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 bg-white dark:bg-[#111827] border border-blue-200 dark:border-blue-800 rounded font-mono text-xs break-all text-neutral-900 dark:text-neutral-100">
                  {createdKeyPlaintext}
                </code>
                <button
                  type="button"
                  onClick={() => copyText(createdKeyPlaintext)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>{copiedKey ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>
          )}

          <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-neutral-200 dark:border-neutral-800 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                  Scoped API Keys (/api/v1/*)
                </h2>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  OpenAPI 3.1 schema available at{' '}
                  <a
                    href="/api/v1/openapi.json"
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    /api/v1/openapi.json
                  </a>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setNewKeyModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Generate API Key</span>
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-900/40 text-[11px] uppercase tracking-wider text-neutral-500">
                    <th className="py-3 px-4">Key Name</th>
                    <th className="py-3 px-4">Prefix</th>
                    <th className="py-3 px-4">Scopes</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
                  {apiKeys.map((k) => {
                    const scopes = JSON.parse(k.scopes_json || '[]') as string[];
                    return (
                      <tr key={k.id}>
                        <td className="py-3 px-4 font-medium text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
                          <KeyRound className="w-3.5 h-3.5 text-neutral-400" />
                          <span>{k.name}</span>
                        </td>
                        <td className="py-3 px-4 font-mono text-neutral-600 dark:text-neutral-300">
                          {k.key_prefix}••••••••
                        </td>
                        <td className="py-3 px-4 font-mono text-[11px] text-neutral-500 dark:text-neutral-400">
                          {scopes.join(' · ')}
                        </td>
                        <td className="py-3 px-4">
                          <StatusText status={k.is_active ? 'active' : 'revoked'} />
                        </td>
                        <td className="py-3 px-4 text-right">
                          {k.is_active ? (
                            <button
                              type="button"
                              onClick={() => handleRevokeKey(k.id)}
                              className="text-xs font-medium text-red-600 dark:text-red-400 hover:underline cursor-pointer"
                            >
                              Revoke
                            </button>
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

          {/* Interactive Live Public API v1 Explorer */}
          <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                Interactive Public REST API v1 Explorer
              </h2>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Test live versioned endpoints using a newly generated scoped key or your current Super Admin session.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
              <select
                aria-label="Select API endpoint"
                value={explorerEndpoint}
                onChange={(e) => setExplorerEndpoint(e.target.value)}
                className="md:col-span-5 px-3 py-2 text-xs font-mono bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md"
              >
                {API_ENDPOINTS.map((ep) => (
                  <option key={ep.id} value={ep.id}>
                    {ep.method} {ep.path} ({ep.scope})
                  </option>
                ))}
              </select>
              <input
                type="text"
                aria-label="Optional API Bearer key"
                value={explorerKey}
                onChange={(e) => setExplorerKey(e.target.value)}
                placeholder="Optional: paste nxhrm_live_... key (defaults to admin session)"
                className="md:col-span-5 px-3 py-2 text-xs font-mono bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md"
              />
              <button
                type="button"
                disabled={explorerBusy}
                onClick={handleRunExplorer}
                className="md:col-span-2 inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer"
              >
                <Play className="w-3.5 h-3.5" />
                <span>{explorerBusy ? 'Running...' : 'Send Request'}</span>
              </button>
            </div>

            {explorerResponse && (
              <pre className="p-4 bg-neutral-950 text-neutral-100 rounded-md font-mono text-[11px] overflow-x-auto max-h-80 leading-relaxed">
                {explorerResponse}
              </pre>
            )}
          </div>
        </div>
      )}

      {/* TAB 5: OUTBOUND WEBHOOKS & COMPANY SETTINGS */}
      {tab === 'webhooks' && (
        <div className="space-y-6">
          {canDeveloper && (
            <>
              {createdWhSecret && (
                <div className="p-4 bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/60 rounded-lg text-xs space-y-1">
                  <div className="font-semibold text-blue-900 dark:text-blue-200">
                    Webhook Signing Secret (HMAC-SHA256 — Shown Once)
                  </div>
                  <code className="block font-mono text-neutral-900 dark:text-neutral-100">
                    {createdWhSecret}
                  </code>
                </div>
              )}

              <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
                <div className="px-5 py-4 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                      Signed Outbound Webhooks
                    </h2>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                      All events include an <code className="font-mono">X-Nexus-Signature</code> HMAC-SHA256 header and reject private/loopback URLs.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setWhModal(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Webhook</span>
                  </button>
                </div>
                <div className="divide-y divide-neutral-200 dark:divide-neutral-800">
                  {webhooks.map((wh) => {
                    const evts = JSON.parse(wh.events_json || '[]') as string[];
                    return (
                      <div key={wh.id} className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
                            <Webhook className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                            <span>{wh.name}</span>
                          </div>
                          <div className="text-xs font-mono text-neutral-500 truncate mt-0.5">{wh.target_url}</div>
                          <div className="text-[11px] font-mono text-neutral-500 mt-1">{evts.join(' · ')}</div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleTestWebhook(wh.id)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-200 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer"
                          >
                            <Send className="w-3.5 h-3.5" />
                            <span>Dispatch Signed Test</span>
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete ${wh.name}`}
                            onClick={() => handleDeleteWebhook(wh.id)}
                            className="p-1.5 text-neutral-400 hover:text-red-600 rounded cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Delivery Inspector */}
              <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
                <div className="px-5 py-3.5 border-b border-neutral-200 dark:border-neutral-800">
                  <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                    Recent Webhook Deliveries
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-900/40 text-[11px] uppercase tracking-wider text-neutral-500">
                        <th className="py-2.5 px-4">Endpoint</th>
                        <th className="py-2.5 px-4">Event</th>
                        <th className="py-2.5 px-4">HMAC Signature</th>
                        <th className="py-2.5 px-4">Status</th>
                        <th className="py-2.5 px-4">Delivered</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
                      {deliveries.map((d) => (
                        <tr key={d.id}>
                          <td className="py-2.5 px-4 font-medium text-neutral-900 dark:text-neutral-100">
                            {d.webhook_name}
                          </td>
                          <td className="py-2.5 px-4 font-mono text-neutral-600 dark:text-neutral-300">
                            {d.event_name}
                          </td>
                          <td className="py-2.5 px-4 font-mono text-[11px] text-neutral-500">
                            {d.signature_header.slice(0, 22)}…
                          </td>
                          <td className="py-2.5 px-4">
                            <StatusText status={d.status} />
                          </td>
                          <td className="py-2.5 px-4 font-mono text-neutral-500">
                            {formatDateShort(d.delivered_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* Company Settings & Branch Holidays */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {canSecurity && (
              <form
                onSubmit={handleSaveSettings}
                className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 space-y-4"
              >
                <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                  Enterprise Organization Settings
                </h3>
                <div className="space-y-3">
                  <div>
                    <label htmlFor="set-company" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                      Legal Company Name
                    </label>
                    <input
                      id="set-company"
                      value={settings.company_name ?? ''}
                      onChange={(e) => setSettings((p) => ({ ...p, company_name: e.target.value }))}
                      className="w-full px-3 py-2 text-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="set-ein" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                        Federal EIN / Tax ID
                      </label>
                      <input
                        id="set-ein"
                        value={settings.tax_ein ?? ''}
                        onChange={(e) => setSettings((p) => ({ ...p, tax_ein: e.target.value }))}
                        className="w-full px-3 py-2 text-sm font-mono bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md"
                      />
                    </div>
                    <div>
                      <label htmlFor="set-pay" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                        Default Pay Cycle
                      </label>
                      <input
                        id="set-pay"
                        value={settings.pay_frequency ?? 'Monthly'}
                        onChange={(e) => setSettings((p) => ({ ...p, pay_frequency: e.target.value }))}
                        className="w-full px-3 py-2 text-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md"
                      />
                    </div>
                  </div>
                </div>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer"
                >
                  Save Organization Profile
                </button>
              </form>
            )}

            <div className="bg-white dark:bg-[#111827] border border-neutral-200 dark:border-neutral-800 rounded-lg p-5 space-y-4">
              <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                Multi-Branch Holiday Calendar
              </h3>
              <div className="divide-y divide-neutral-200 dark:divide-neutral-800 max-h-52 overflow-y-auto text-xs">
                {holidays.map((h) => (
                  <div key={h.id} className="py-2 flex items-center justify-between gap-2">
                    <div>
                      <span className="font-medium text-neutral-900 dark:text-neutral-100">{h.name}</span>
                      <span className="text-neutral-500 ml-2">· {h.branch_name ?? 'All Branches'}</span>
                    </div>
                    <span className="font-mono tabular-nums text-neutral-500">{formatDateShort(h.holiday_date)}</span>
                  </div>
                ))}
              </div>
              {hasPerm(user.permissions, user.roles, 'branches.manage') && (
                <form onSubmit={handleAddHoliday} className="grid grid-cols-12 gap-2 pt-2 border-t border-neutral-200 dark:border-neutral-800">
                  <input
                    required
                    placeholder="Holiday name"
                    value={holidayForm.name}
                    onChange={(e) => setHolidayForm((p) => ({ ...p, name: e.target.value }))}
                    className="col-span-5 px-2.5 py-1.5 text-xs bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded"
                  />
                  <input
                    type="date"
                    required
                    value={holidayForm.holidayDate}
                    onChange={(e) => setHolidayForm((p) => ({ ...p, holidayDate: e.target.value }))}
                    className="col-span-3 px-2 py-1.5 text-xs bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded"
                  />
                  <select
                    value={holidayForm.branchId}
                    onChange={(e) => setHolidayForm((p) => ({ ...p, branchId: e.target.value }))}
                    className="col-span-2 px-2 py-1.5 text-xs bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded"
                  >
                    <option value="">All</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.code}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    className="col-span-2 px-2 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded cursor-pointer"
                  >
                    Add
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* New API Key Modal */}
      <Modal open={newKeyModal} onClose={() => setNewKeyModal(false)} title="Generate Scoped API Key">
        <form onSubmit={handleCreateApiKey} className="space-y-4">
          <div>
            <label htmlFor="ak-name" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
              Integration Name
            </label>
            <input
              id="ak-name"
              required
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="e.g., NetSuite GL Sync"
              className="w-full px-3 py-2 text-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md"
            />
          </div>
          <div>
            <span className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-2">
              Authorized Scopes
            </span>
            <div className="flex flex-wrap gap-2">
              {API_SCOPES.map((sc) => {
                const active = newKeyScopes.includes(sc);
                return (
                  <button
                    key={sc}
                    type="button"
                    onClick={() =>
                      setNewKeyScopes((prev) =>
                        prev.includes(sc)
                          ? prev.length > 1
                            ? prev.filter((x) => x !== sc)
                            : prev
                          : [...prev, sc]
                      )
                    }
                    className={`px-2.5 py-1.5 text-xs font-mono rounded border cursor-pointer ${
                      active
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 border-neutral-200 dark:border-neutral-700'
                    }`}
                  >
                    {sc}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setNewKeyModal(false)}
              className="px-3 py-2 text-xs font-medium text-neutral-600 dark:text-neutral-300 rounded-md cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer"
            >
              Generate Key
            </button>
          </div>
        </form>
      </Modal>

      {/* New Webhook Modal */}
      <Modal
        open={whModal}
        onClose={() => setWhModal(false)}
        title="Register Outbound Webhook"
        description="Must use a public HTTPS/HTTP endpoint. Private IP ranges and localhost targets are blocked."
      >
        <form onSubmit={handleCreateWebhook} className="space-y-4">
          <div>
            <label htmlFor="wh-name" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
              Webhook Label
            </label>
            <input
              id="wh-name"
              required
              value={whForm.name}
              onChange={(e) => setWhForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="e.g., Slack Finance Alerts"
              className="w-full px-3 py-2 text-sm bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md"
            />
          </div>
          <div>
            <label htmlFor="wh-url" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
              Target URL
            </label>
            <input
              id="wh-url"
              type="url"
              required
              value={whForm.targetUrl}
              onChange={(e) => setWhForm((p) => ({ ...p, targetUrl: e.target.value }))}
              className="w-full px-3 py-2 text-sm font-mono bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-md"
            />
          </div>
          <div>
            <span className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-2">
              Subscribed Events
            </span>
            <div className="flex flex-wrap gap-2">
              {WEBHOOK_EVENTS.map((ev) => {
                const active = whForm.events.includes(ev);
                return (
                  <button
                    key={ev}
                    type="button"
                    onClick={() =>
                      setWhForm((p) => ({
                        ...p,
                        events: p.events.includes(ev)
                          ? p.events.length > 1
                            ? p.events.filter((x) => x !== ev)
                            : p.events
                          : [...p.events, ev],
                      }))
                    }
                    className={`px-2.5 py-1.5 text-xs font-mono rounded border cursor-pointer ${
                      active
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 border-neutral-200 dark:border-neutral-700'
                    }`}
                  >
                    {ev}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setWhModal(false)}
              className="px-3 py-2 text-xs font-medium text-neutral-600 dark:text-neutral-300 rounded-md cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer"
            >
              Register Endpoint
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
