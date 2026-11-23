import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { db } from '../db';
import { computeAuditEntryHash, redactSensitiveData, sha256Hex } from '../domain/index';
import {
  findOrProvisionSupabaseUser,
  verifySupabaseAccessToken,
} from '../services/supabaseAuth';

export interface AuthUserContext {
  id: number;
  email: string;
  username: string;
  fullName: string;
  avatarUrl: string | null;
  mfaEnabled: boolean;
  roles: string[];
  permissions: string[];
  employeeId: number | null;
  branchId: number | null;
  authType: 'session' | 'api_key';
  apiScopes?: string[];
}

export interface AuthedRequest extends Request {
  user?: AuthUserContext;
}

// ---------------------------------------------------------------------------
// In-Memory Sliding Window Rate Limiter for Auth & Public Endpoints
// ---------------------------------------------------------------------------
const rateBuckets = new Map<string, number[]>();

export function rateLimit(maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.ip || 'local'}:${req.baseUrl}${req.path}`;
    const now = Date.now();
    const recent = (rateBuckets.get(key) ?? []).filter((ts) => now - ts < windowMs);
    if (recent.length >= maxRequests) {
      res.status(429).json({ error: 'Too many requests. Please try again shortly.' });
      return;
    }
    recent.push(now);
    rateBuckets.set(key, recent);
    next();
  };
}

// ---------------------------------------------------------------------------
// Load User + Roles + Permissions + Linked Employee
// ---------------------------------------------------------------------------
export function loadUserContext(userId: number, authType: 'session' | 'api_key' = 'session', apiScopes?: string[]): AuthUserContext | null {
  const user = db
    .prepare('SELECT id, email, username, full_name, avatar_url, status, mfa_enabled FROM users WHERE id = ?')
    .get(userId) as
    | {
        id: number;
        email: string;
        username: string;
        full_name: string;
        avatar_url: string | null;
        status: string;
        mfa_enabled: number;
      }
    | undefined;

  if (!user || user.status !== 'active') return null;

  const rolesRows = db
    .prepare(
      `SELECT r.slug FROM roles r
       JOIN user_roles ur ON ur.role_id = r.id
       WHERE ur.user_id = ?`
    )
    .all(userId) as Array<{ slug: string }>;

  const permRows = db
    .prepare(
      `SELECT DISTINCT p.slug FROM permissions p
       JOIN role_permissions rp ON rp.permission_id = p.id
       JOIN user_roles ur ON ur.role_id = rp.role_id
       WHERE ur.user_id = ?`
    )
    .all(userId) as Array<{ slug: string }>;

  const emp = db
    .prepare('SELECT id, branch_id FROM employees WHERE user_id = ?')
    .get(userId) as { id: number; branch_id: number } | undefined;

  return {
    id: user.id,
    email: user.email,
    username: user.username,
    fullName: user.full_name,
    avatarUrl: user.avatar_url,
    mfaEnabled: Boolean(user.mfa_enabled),
    roles: rolesRows.map((r) => r.slug),
    permissions: permRows.map((p) => p.slug),
    employeeId: emp?.id ?? null,
    branchId: emp?.branch_id ?? null,
    authType,
    apiScopes,
  };
}


const SESSION_SIGNING_KEY =
  process.env.HRM_SESSION_SECRET?.trim() || crypto.randomBytes(32).toString('hex');
const revokedTokenHashes = new Set<string>();

export function revokeSessionToken(rawToken: string): void {
  const tokenHash = sha256Hex(rawToken);
  revokedTokenHashes.add(tokenHash);
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
}

function signStatelessToken(userId: number, expiresAtMs: number): string {
  const payload = Buffer.from(
    JSON.stringify({ uid: userId, exp: expiresAtMs, jti: crypto.randomBytes(8).toString('hex') })
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', SESSION_SIGNING_KEY)
    .update(payload)
    .digest('base64url');
  return `nxs2.${payload}.${sig}`;
}

function verifyStatelessToken(rawToken: string): { uid: number; exp: number } | null {
  if (!rawToken.startsWith('nxs2.')) return null;
  const parts = rawToken.split('.');
  if (parts.length !== 3) return null;
  const [, payload, sig] = parts;
  const expected = crypto
    .createHmac('sha256', SESSION_SIGNING_KEY)
    .update(payload)
    .digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      uid?: unknown;
      exp?: unknown;
    };
    if (typeof parsed.uid !== 'number' || typeof parsed.exp !== 'number') return null;
    if (parsed.exp < Date.now()) return null;
    return { uid: parsed.uid, exp: parsed.exp };
  } catch {
    return null;
  }
}

export function createSessionToken(userId: number, ip: string | undefined, ua: string | undefined): string {
  const now = new Date();
  const expiresMs = now.getTime() + 12 * 60 * 60 * 1000; // 12h session
  const rawToken = signStatelessToken(userId, expiresMs);
  const tokenHash = sha256Hex(rawToken);
  db.prepare(
    `INSERT INTO sessions (token_hash, user_id, mfa_verified, ip_address, user_agent, expires_at, created_at)
     VALUES (?, ?, 1, ?, ?, ?, ?)`
  ).run(tokenHash, userId, ip ?? '127.0.0.1', ua ?? 'browser', new Date(expiresMs).toISOString(), now.toISOString());
  return rawToken;
}

async function resolveSessionUser(rawToken: string): Promise<AuthUserContext | null> {
  const tokenHash = sha256Hex(rawToken);
  if (revokedTokenHashes.has(tokenHash)) return null;

  // 1. Check active SQLite session table
  const session = db
    .prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?')
    .get(tokenHash) as { user_id: number; expires_at: string } | undefined;

  if (session) {
    if (Date.parse(session.expires_at) < Date.now()) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
      return null;
    }
    return loadUserContext(session.user_id, 'session');
  }

  // 2. Stateless HMAC fallback (supports Vercel serverless cold starts)
  const stateless = verifyStatelessToken(rawToken);
  if (stateless) {
    return loadUserContext(stateless.uid, 'session');
  }

  // 3. Supabase JWT verification fallback (works seamlessly across Vercel instances)
  const sbUser = await verifySupabaseAccessToken(rawToken);
  if (sbUser) {
    const userId = findOrProvisionSupabaseUser(sbUser);
    return loadUserContext(userId, 'session');
  }

  return null;
}

// ---------------------------------------------------------------------------
// Bearer Session Authentication Middleware
// ---------------------------------------------------------------------------
export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const rawToken = authHeader.slice(7).trim();
  const ctx = await resolveSessionUser(rawToken);
  if (!ctx) {
    res.status(401).json({ error: 'Session expired or invalid' });
    return;
  }

  req.user = ctx;
  next();
}

// ---------------------------------------------------------------------------
// Uniform Granular Permission Guard
// ---------------------------------------------------------------------------
export function requirePermission(permissionSlug: string) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (req.user.roles.includes('super_admin') || req.user.permissions.includes(permissionSlug)) {
      next();
      return;
    }
    res.status(403).json({ error: `Insufficient permission: ${permissionSlug} required` });
  };
}

// ---------------------------------------------------------------------------
// Scoped Public API v1 Key OR Authenticated Session Guard
// ---------------------------------------------------------------------------
export function requireApiScope(requiredScope: string) {
  return async (req: AuthedRequest, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Bearer API key required' });
      return;
    }
    const raw = authHeader.slice(7).trim();
    const hash = sha256Hex(raw);

    // 1. Check Scoped API Key
    const apiKey = db
      .prepare('SELECT id, scopes_json, created_by, is_active FROM api_keys WHERE key_hash = ?')
      .get(hash) as { id: number; scopes_json: string; created_by: number | null; is_active: number } | undefined;

    if (apiKey) {
      if (!apiKey.is_active) {
        res.status(401).json({ error: 'API key has been revoked' });
        return;
      }
      const scopes = JSON.parse(apiKey.scopes_json) as string[];
      if (!scopes.includes(requiredScope) && !scopes.includes('*')) {
        res.status(403).json({ error: `API key missing required scope: ${requiredScope}` });
        return;
      }
      db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(new Date().toISOString(), apiKey.id);
      const ctx = loadUserContext(apiKey.created_by ?? 1, 'api_key', scopes);
      if (ctx) req.user = ctx;
      next();
      return;
    }

    // 2. Fallback to active Super Admin / Developer session (including Supabase JWT)
    const ctx = await resolveSessionUser(raw);
    if (ctx && (ctx.roles.includes('super_admin') || ctx.permissions.includes('developer.manage'))) {
      req.user = ctx;
      next();
      return;
    }

    res.status(401).json({ error: 'Invalid API key or session token' });
  };
}

// ---------------------------------------------------------------------------
// Tamper-Evident Hash-Chained Audit Log Writer
// ---------------------------------------------------------------------------
export function recordAuditLog(params: {
  user?: AuthUserContext | null;
  action: string;
  resource: string;
  resourceId?: string | number | null;
  before?: unknown;
  after?: unknown;
  ipAddress?: string;
}): void {
  const last = db
    .prepare('SELECT entry_hash FROM audit_logs ORDER BY id DESC LIMIT 1')
    .get() as { entry_hash: string } | undefined;

  const prevHash = last?.entry_hash ?? 'GENESIS';
  const createdAt = new Date().toISOString();
  const beforeData = params.before !== undefined ? JSON.stringify(redactSensitiveData(params.before)) : null;
  const afterData = params.after !== undefined ? JSON.stringify(redactSensitiveData(params.after)) : null;
  const resourceId = params.resourceId !== undefined && params.resourceId !== null ? String(params.resourceId) : null;
  const ipAddress = params.ipAddress ?? '127.0.0.1';

  const entryHash = computeAuditEntryHash({
    userId: params.user?.id ?? null,
    action: params.action,
    resource: params.resource,
    resourceId,
    beforeData,
    afterData,
    ipAddress,
    createdAt,
    prevHash,
  });

  db.prepare(
    `INSERT INTO audit_logs (user_id, actor_email, action, resource, resource_id, before_data, after_data, ip_address, prev_hash, entry_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    params.user?.id ?? null,
    params.user?.email ?? 'system@nexushrm.io',
    params.action,
    params.resource,
    resourceId,
    beforeData,
    afterData,
    ipAddress,
    prevHash,
    entryHash,
    createdAt
  );
}
