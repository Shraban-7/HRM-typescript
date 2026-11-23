import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import {
  type AuditChainEntry,
  evaluateAttendanceShift,
  sha256Hex,
  validateSafeWebhookUrl,
  verifyAuditHashChain,
} from '../domain/index';
import {
  type AuthedRequest,
  recordAuditLog,
  requireApiScope,
  requireAuth,
  requirePermission,
} from '../middleware/auth';
import { dispatchWebhookEvent } from '../services/webhookService';

export const platformRouter = Router();
export const publicApiV1Router = Router();

// ===========================================================================
// ADMIN SECURITY, RBAC MATRIX, TAMPER-EVIDENT AUDIT & DEVELOPER CONSOLE
// ===========================================================================
platformRouter.use(requireAuth);

// RBAC Roles & Permissions Matrix
platformRouter.get('/rbac', requirePermission('security.manage'), async (_req, res) => {
  const roles = (await db.prepare('SELECT * FROM roles ORDER BY id ASC').all()) as Array<{
    id: number;
    slug: string;
    name: string;
    description: string;
    require_mfa: number;
  }>;
  const permissions = await db.prepare('SELECT * FROM permissions ORDER BY module, slug').all();
  const mappings = (await db.prepare('SELECT role_id, permission_id FROM role_permissions').all()) as Array<{
    role_id: number;
    permission_id: number;
  }>;
  const users = await db
    .prepare(
      `SELECT u.id, u.email, u.full_name, u.status, u.mfa_enabled, u.failed_login_attempts, u.last_login_at,
              GROUP_CONCAT(r.name) as role_names
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       GROUP BY u.id ORDER BY u.id ASC`
    )
    .all();

  res.json({
    roles: roles.map((r) => ({
      ...r,
      permissionIds: mappings.filter((m) => m.role_id === r.id).map((m) => m.permission_id),
    })),
    permissions,
    users,
  });
});

platformRouter.post('/rbac/toggle-permission', requirePermission('security.manage'), async (req: AuthedRequest, res) => {
  const schema = z.object({
    roleId: z.number().int().positive(),
    permissionId: z.number().int().positive(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid role/permission selection.' });
    return;
  }
  const role = (await db.prepare('SELECT slug FROM roles WHERE id = ?').get(parsed.data.roleId)) as
    | { slug: string }
    | undefined;
  if (role?.slug === 'super_admin') {
    res.status(400).json({ error: 'Super Admin retains all permissions by enterprise policy.' });
    return;
  }

  const existing = await db
    .prepare('SELECT 1 FROM role_permissions WHERE role_id = ? AND permission_id = ?')
    .get(parsed.data.roleId, parsed.data.permissionId);

  let enabled = false;
  if (existing) {
    await db
      .prepare('DELETE FROM role_permissions WHERE role_id = ? AND permission_id = ?')
      .run(parsed.data.roleId, parsed.data.permissionId);
  } else {
    await db
      .prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)')
      .run(parsed.data.roleId, parsed.data.permissionId);
    enabled = true;
  }

  await recordAuditLog({
    user: req.user,
    action: 'rbac.permission_changed',
    resource: 'role_permissions',
    resourceId: `${parsed.data.roleId}:${parsed.data.permissionId}`,
    after: { enabled },
    ipAddress: req.ip,
  });
  res.json({ ok: true, enabled });
});

platformRouter.post('/rbac/toggle-mfa-policy', requirePermission('security.manage'), async (req: AuthedRequest, res) => {
  const schema = z.object({ roleId: z.number().int().positive() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid role ID.' });
    return;
  }
  const role = (await db.prepare('SELECT require_mfa, slug FROM roles WHERE id = ?').get(parsed.data.roleId)) as
    | { require_mfa: number; slug: string }
    | undefined;
  if (!role) {
    res.status(404).json({ error: 'Role not found.' });
    return;
  }
  const next = role.require_mfa ? 0 : 1;
  await db.prepare('UPDATE roles SET require_mfa = ? WHERE id = ?').run(next, parsed.data.roleId);
  await recordAuditLog({
    user: req.user,
    action: 'security.role_mfa_policy_updated',
    resource: 'roles',
    resourceId: role.slug,
    after: { requireMfa: Boolean(next) },
    ipAddress: req.ip,
  });
  res.json({ ok: true, requireMfa: Boolean(next) });
});

// Tamper-Evident Audit Log Viewer & Cryptographic Hash-Chain Verification
platformRouter.get('/audit', requirePermission('security.manage'), async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
  const allRows = (await db.prepare('SELECT * FROM audit_logs ORDER BY id ASC').all()) as Array<{
    id: number;
    user_id: number | null;
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
  }>;

  const chainEntries: AuditChainEntry[] = allRows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    action: r.action,
    resource: r.resource,
    resourceId: r.resource_id,
    beforeData: r.before_data,
    afterData: r.after_data,
    ipAddress: r.ip_address,
    createdAt: r.created_at,
    prevHash: r.prev_hash,
    entryHash: r.entry_hash,
  }));

  const integrity = verifyAuditHashChain(chainEntries);

  const filtered = [...allRows]
    .reverse()
    .filter((r) => {
      if (!q) return true;
      return `${r.actor_email ?? ''} ${r.action} ${r.resource} ${r.after_data ?? ''}`.toLowerCase().includes(q);
    })
    .slice(0, 120);

  res.json({ logs: filtered, integrity });
});

// Scoped API Keys Management
platformRouter.get('/api-keys', requirePermission('developer.manage'), async (_req, res) => {
  const keys = await db
    .prepare(
      `SELECT id, name, key_prefix, scopes_json, last_used_at, is_active, created_at
       FROM api_keys ORDER BY id DESC`
    )
    .all();
  res.json({ keys });
});

platformRouter.post('/api-keys', requirePermission('developer.manage'), async (req: AuthedRequest, res) => {
  const schema = z.object({
    name: z.string().min(2).max(100),
    scopes: z
      .array(z.enum(['employees:read', 'branches:read', 'attendance:read', 'attendance:write', 'payroll:read']))
      .min(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Provide a key name and at least one API scope.' });
    return;
  }

  const rawKey = `nxhrm_live_${crypto.randomBytes(20).toString('hex')}`;
  const prefix = rawKey.slice(0, 18);
  const keyHash = sha256Hex(rawKey);
  const info = await db
    .prepare(
      `INSERT INTO api_keys (name, key_prefix, key_hash, scopes_json, created_by, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`
    )
    .run(parsed.data.name, prefix, keyHash, JSON.stringify(parsed.data.scopes), req.user!.id, new Date().toISOString());

  await recordAuditLog({
    user: req.user,
    action: 'developer.api_key_created',
    resource: 'api_keys',
    resourceId: Number(info.lastInsertRowid),
    after: { name: parsed.data.name, prefix, scopes: parsed.data.scopes },
    ipAddress: req.ip,
  });

  // Plaintext key returned strictly once upon creation
  res.status(201).json({
    id: Number(info.lastInsertRowid),
    name: parsed.data.name,
    keyPrefix: prefix,
    plaintextKey: rawKey,
    scopes: parsed.data.scopes,
  });
});

platformRouter.post('/api-keys/:id/revoke', requirePermission('developer.manage'), async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  await db.prepare('UPDATE api_keys SET is_active = 0 WHERE id = ?').run(id);
  await recordAuditLog({
    user: req.user,
    action: 'developer.api_key_revoked',
    resource: 'api_keys',
    resourceId: id,
    ipAddress: req.ip,
  });
  res.json({ ok: true });
});

// Outbound Webhooks & Signed Delivery Inspector
platformRouter.get('/webhooks', requirePermission('developer.manage'), async (_req, res) => {
  const webhooks = await db
    .prepare('SELECT id, name, target_url, events_json, is_active, created_at FROM webhooks ORDER BY id DESC')
    .all();
  const deliveries = await db
    .prepare(
      `SELECT wd.*, w.name as webhook_name, w.target_url
       FROM webhook_deliveries wd JOIN webhooks w ON w.id = wd.webhook_id
       ORDER BY wd.id DESC LIMIT 40`
    )
    .all();
  res.json({ webhooks, deliveries });
});

platformRouter.post('/webhooks', requirePermission('developer.manage'), async (req: AuthedRequest, res) => {
  const schema = z.object({
    name: z.string().min(2).max(100),
    targetUrl: z.string().url(),
    events: z.array(z.string().min(3)).min(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Provide a valid webhook name, URL, and at least one event.' });
    return;
  }

  const urlCheck = validateSafeWebhookUrl(parsed.data.targetUrl);
  if (!urlCheck.valid) {
    res.status(400).json({ error: urlCheck.reason });
    return;
  }

  const signingSecret = `whsec_${crypto.randomBytes(18).toString('hex')}`;
  const info = await db
    .prepare(
      `INSERT INTO webhooks (name, target_url, events_json, signing_secret, is_active, created_at)
       VALUES (?, ?, ?, ?, 1, ?)`
    )
    .run(parsed.data.name, parsed.data.targetUrl, JSON.stringify(parsed.data.events), signingSecret, new Date().toISOString());

  await recordAuditLog({
    user: req.user,
    action: 'developer.webhook_created',
    resource: 'webhooks',
    resourceId: Number(info.lastInsertRowid),
    after: { name: parsed.data.name, targetUrl: parsed.data.targetUrl, events: parsed.data.events },
    ipAddress: req.ip,
  });

  res.status(201).json({
    id: Number(info.lastInsertRowid),
    signingSecret, // shown once on creation
  });
});

platformRouter.post('/webhooks/:id/test', requirePermission('developer.manage'), async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const results = await dispatchWebhookEvent(
    'system.webhook_test',
    {
      triggeredBy: req.user!.email,
      message: 'Nexus HRM HMAC-SHA256 webhook verification event',
    },
    { webhookId: id, liveAttempt: false }
  );
  if (results.length === 0) {
    res.status(404).json({ error: 'Webhook endpoint not found.' });
    return;
  }
  res.json({ delivery: results[0] });
});

platformRouter.delete('/webhooks/:id', requirePermission('developer.manage'), async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  await db.prepare('DELETE FROM webhooks WHERE id = ?').run(id);
  await recordAuditLog({
    user: req.user,
    action: 'developer.webhook_deleted',
    resource: 'webhooks',
    resourceId: id,
    ipAddress: req.ip,
  });
  res.json({ ok: true });
});

// ===========================================================================
// PUBLIC VERSIONED REST API v1 (/api/v1/*)
// ===========================================================================
publicApiV1Router.get('/openapi.json', (_req, res) => {
  res.json({
    openapi: '3.1.0',
    info: {
      title: 'Nexus HRM Enterprise REST API',
      version: '1.0.0',
      description: 'Scoped Bearer API for workforce directory, multi-branch topology, attendance/biometric sync, and payroll ledger summaries.',
    },
    servers: [{ url: '/api/v1' }],
    components: {
      securitySchemes: {
        BearerAuth: { type: 'http', scheme: 'bearer' },
      },
    },
    security: [{ BearerAuth: [] }],
    paths: {
      '/employees': {
        get: { summary: 'List active employees with branch & department metadata', 'x-scope': 'employees:read' },
      },
      '/branches': {
        get: { summary: 'List enterprise office branches and tax jurisdictions', 'x-scope': 'branches:read' },
      },
      '/attendance/today': {
        get: { summary: 'Retrieve today attendance records across branches', 'x-scope': 'attendance:read' },
      },
      '/integrations/biometric-sync': {
        post: { summary: 'Ingest batch clock punches from physical biometric terminals', 'x-scope': 'attendance:write' },
      },
      '/payroll/summary': {
        get: { summary: 'Retrieve finalized and active payroll run totals', 'x-scope': 'payroll:read' },
      },
    },
  });
});

publicApiV1Router.get('/employees', requireApiScope('employees:read'), async (req, res) => {
  const branchCode = typeof req.query.branch === 'string' ? req.query.branch.toUpperCase() : null;
  const rows = await db
    .prepare(
      `SELECT e.id, e.employee_code, e.full_name, e.email, e.designation, e.employment_type,
              e.hire_date, e.status, b.code as branch_code, b.name as branch_name, d.name as department_name
       FROM employees e
       JOIN branches b ON b.id = e.branch_id
       JOIN departments d ON d.id = e.department_id
       ${branchCode ? 'WHERE b.code = ?' : ''}
       ORDER BY e.employee_code ASC`
    )
    .all(...(branchCode ? [branchCode] : []));
  res.json({ data: rows, meta: { count: rows.length, apiVersion: 'v1' } });
});

publicApiV1Router.get('/branches', requireApiScope('branches:read'), async (_req, res) => {
  const rows = await db
    .prepare('SELECT id, code, name, city, country, timezone, cost_center, state_tax_rate, is_headquarters FROM branches')
    .all();
  res.json({ data: rows, meta: { count: rows.length, apiVersion: 'v1' } });
});

publicApiV1Router.get('/attendance/today', requireApiScope('attendance:read'), async (_req, res) => {
  const rows = await db
    .prepare(
      `SELECT a.work_date, e.employee_code, e.full_name, b.code as branch_code,
              a.clock_in, a.clock_out, a.worked_hours, a.overtime_hours, a.status, a.source
       FROM attendances a
       JOIN employees e ON e.id = a.employee_id
       JOIN branches b ON b.id = a.branch_id
       WHERE a.work_date = '2026-11-23'
       ORDER BY e.employee_code ASC`
    )
    .all();
  res.json({ data: rows, meta: { date: '2026-11-23', count: rows.length } });
});

publicApiV1Router.get('/payroll/summary', requireApiScope('payroll:read'), async (_req, res) => {
  const rows = await db
    .prepare(
      `SELECT run_code, period_start, period_end, pay_date, status, employee_count,
              total_gross, total_pre_tax, total_taxes, total_net, total_employer_taxes
       FROM payrolls ORDER BY id DESC LIMIT 12`
    )
    .all();
  res.json({ data: rows, meta: { count: rows.length } });
});

publicApiV1Router.post('/integrations/biometric-sync', requireApiScope('attendance:write'), async (req: AuthedRequest, res) => {
  const schema = z.object({
    deviceId: z.string().min(2).max(60),
    punches: z
      .array(
        z.object({
          employeeCode: z.string().min(3),
          workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          clockIn: z.string(),
          clockOut: z.string().nullable().optional(),
        })
      )
      .min(1)
      .max(100),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid biometric punch batch payload.' });
    return;
  }

  let synced = 0;
  for (const punch of parsed.data.punches) {
    const emp = (await db
      .prepare('SELECT id, branch_id FROM employees WHERE employee_code = ?')
      .get(punch.employeeCode)) as { id: number; branch_id: number } | undefined;
    if (!emp) continue;
    const evalRes = evaluateAttendanceShift(punch.clockIn, punch.clockOut ?? null);
    await db
      .prepare(
        `INSERT INTO attendances (employee_id, branch_id, work_date, clock_in, clock_out, worked_hours, overtime_hours, status, source, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'biometric', ?)
         ON CONFLICT(employee_id, work_date) DO UPDATE SET
           clock_in = excluded.clock_in,
           clock_out = excluded.clock_out,
           worked_hours = excluded.worked_hours,
           overtime_hours = excluded.overtime_hours,
           status = excluded.status,
           source = 'biometric',
           notes = excluded.notes`
      )
      .run(
        emp.id,
        emp.branch_id,
        punch.workDate,
        punch.clockIn,
        punch.clockOut ?? null,
        evalRes.workedHours,
        evalRes.overtimeHours,
        evalRes.status,
        `Synced from device ${parsed.data.deviceId}`
      );
    synced += 1;
  }

  await recordAuditLog({
    user: req.user,
    action: 'integration.biometric_synced',
    resource: 'attendances',
    resourceId: parsed.data.deviceId,
    after: { syncedCount: synced },
    ipAddress: req.ip,
  });

  res.json({ synced, deviceId: parsed.data.deviceId });
});
