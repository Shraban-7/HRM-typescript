import crypto from 'node:crypto';
import { db } from '../db';
import { hashPassword, sha256Hex } from '../domain/index';

export interface VerifiedSupabaseUser {
  id: string;
  email: string;
  fullName: string;
}

const tokenCache = new Map<string, { user: VerifiedSupabaseUser; expiresAt: number }>();

export function getSupabaseServerConfig(): { url: string; anonKey: string } | null {
  const rawUrl = (
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    ''
  )
    .trim()
    .replace(/\/+$/, '');
  const anonKey = (
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    ''
  ).trim();
  if (!rawUrl || !anonKey) return null;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return null;
    return { url: parsed.origin, anonKey };
  } catch {
    return null;
  }
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseServerConfig() !== null;
}

export async function verifySupabaseAccessToken(accessToken: string): Promise<VerifiedSupabaseUser | null> {
  const cfg = getSupabaseServerConfig();
  if (!cfg || !accessToken || accessToken.length < 20) return null;

  const cacheKey = sha256Hex(accessToken);
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.user;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${cfg.url}/auth/v1/user`, {
      method: 'GET',
      headers: {
        apikey: cfg.anonKey,
        Authorization: `Bearer ${accessToken}`,
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) return null;
    const data = (await res.json()) as {
      id?: string;
      email?: string;
      user_metadata?: { full_name?: string; name?: string };
    };
    if (!data.id || !data.email) return null;

    const verified: VerifiedSupabaseUser = {
      id: data.id,
      email: data.email.toLowerCase(),
      fullName:
        data.user_metadata?.full_name ||
        data.user_metadata?.name ||
        data.email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    };

    tokenCache.set(cacheKey, { user: verified, expiresAt: Date.now() + 60_000 });
    return verified;
  } catch {
    return null;
  }
}

export async function findOrProvisionSupabaseUser(sbUser: VerifiedSupabaseUser): Promise<number> {
  const existing = await db
    .prepare('SELECT id FROM users WHERE lower(email) = lower(?)')
    .get<{ id: number }>(sbUser.email);

  if (existing) {
    await db
      .prepare('UPDATE users SET last_login_at = ? WHERE id = ?')
      .run(new Date().toISOString(), existing.id);
    return existing.id;
  }

  const now = new Date().toISOString();
  const baseUsername = sbUser.email
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, 24);
  const uniqueUsername = `${baseUsername || 'user'}_${crypto.randomBytes(3).toString('hex')}`;
  const unusablePasswordHash = hashPassword(crypto.randomBytes(24).toString('hex'));

  const userInfo = await db
    .prepare(
      `INSERT INTO users (email, username, full_name, password_hash, status, mfa_enabled, failed_login_attempts, last_login_at, created_at)
       VALUES (?, ?, ?, ?, 'active', 0, 0, ?, ?)`
    )
    .run(sbUser.email, uniqueUsername, sbUser.fullName, unusablePasswordHash, now, now);

  const userId = Number(userInfo.lastInsertRowid);

  const configuredAdminEmail = process.env.HRM_ADMIN_EMAIL?.trim().toLowerCase();
  const existingOwner = await db
    .prepare("SELECT value FROM company_settings WHERE key = 'supabase_owner_email'")
    .get<{ value: string }>();

  let targetRoleSlug: 'super_admin' | 'employee' = 'employee';
  if (configuredAdminEmail && sbUser.email === configuredAdminEmail) {
    targetRoleSlug = 'super_admin';
  } else if (!configuredAdminEmail && !existingOwner) {
    targetRoleSlug = 'super_admin';
    await db
      .prepare(
        `INSERT INTO company_settings (key, value, category, updated_at)
         VALUES ('supabase_owner_email', ?, 'security', ?)
         ON CONFLICT (key) DO NOTHING`
      )
      .run(sbUser.email, now);
  }

  const roleRow = await db
    .prepare('SELECT id FROM roles WHERE slug = ?')
    .get<{ id: number }>(targetRoleSlug);
  if (roleRow) {
    await db
      .prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?) ON CONFLICT (user_id, role_id) DO NOTHING')
      .run(userId, roleRow.id);
  }

  const existingEmp = await db
    .prepare('SELECT id FROM employees WHERE lower(email) = lower(?)')
    .get<{ id: number }>(sbUser.email);

  if (existingEmp) {
    await db.prepare('UPDATE employees SET user_id = ? WHERE id = ?').run(userId, existingEmp.id);
  } else {
    const branch = await db
      .prepare('SELECT id FROM branches ORDER BY is_headquarters DESC, id ASC LIMIT 1')
      .get<{ id: number }>();
    const dept = await db
      .prepare('SELECT id FROM departments ORDER BY id ASC LIMIT 1')
      .get<{ id: number }>();
    const maxRow = await db
      .prepare('SELECT COALESCE(MAX(id), 1000) as m FROM employees')
      .get<{ m: number }>();
    const maxId = Number(maxRow?.m ?? 1000);
    if (branch && dept) {
      await db
        .prepare(
          `INSERT INTO employees (
            user_id, branch_id, department_id, employee_code, full_name, email, phone,
            designation, employment_type, hire_date, annual_salary, pre_tax_401k_pct, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, '', ?, 'full_time', ?, 135000, 4.0, 'active', ?)`
        )
        .run(
          userId,
          branch.id,
          dept.id,
          `NX-${1001 + maxId}`,
          sbUser.fullName,
          sbUser.email,
          targetRoleSlug === 'super_admin' ? 'Workspace Administrator' : 'Team Member',
          now.slice(0, 10),
          now
        );
    }
  }

  return userId;
}
