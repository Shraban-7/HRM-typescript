import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { db, getDatabaseMode } from '../db';
import {
  generateRecoveryCodes,
  generateTotpCode,
  generateTotpSecret,
  hashPassword,
  sha256Hex,
  verifyPassword,
  verifyTotpCode,
} from '../domain/index';
import {
  type AuthedRequest,
  createSessionToken,
  loadUserContext,
  rateLimit,
  recordAuditLog,
  requireAuth,
  revokeSessionToken,
} from '../middleware/auth';
import {
  findOrProvisionSupabaseUser,
  isSupabaseConfigured,
  verifySupabaseAccessToken,
} from '../services/supabaseAuth';

export const authRouter = Router();

const loginSchema = z.object({
  identifier: z.string().min(2).max(120),
  password: z.string().min(4).max(128),
});

const claimSchema = z.object({
  newPassword: z.string().min(8).max(128),
});

authRouter.get('/status', async (_req, res) => {
  const claimed = await db
    .prepare("SELECT value FROM company_settings WHERE key = 'admin_claimed'")
    .get<{ value: string }>();
  const companyRow = await db
    .prepare("SELECT value FROM company_settings WHERE key = 'company_name'")
    .get<{ value: string }>();
  const envPasscodeSet = Boolean(
    process.env.HRM_ADMIN_PASSCODE && process.env.HRM_ADMIN_PASSCODE.trim().length > 0
  );
  res.json({
    adminClaimRequired: !envPasscodeSet && claimed?.value !== '1',
    supabaseEnabled: isSupabaseConfigured(),
    databaseMode: getDatabaseMode(),
    companyName: companyRow?.value ?? 'Nexus Technologies Inc.',
  });
});

// Exchange a verified Supabase Auth JWT for a linked Nexus HRM workspace profile
authRouter.post('/supabase-session', rateLimit(30, 60_000), async (req, res) => {
  if (!isSupabaseConfigured()) {
    res.status(503).json({
      error: 'Supabase authentication is not configured on the server. Set SUPABASE_URL and SUPABASE_ANON_KEY.',
    });
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Supabase access token required.' });
    return;
  }

  const rawToken = authHeader.slice(7).trim();
  const sbUser = await verifySupabaseAccessToken(rawToken);
  if (!sbUser) {
    res.status(401).json({ error: 'Invalid or expired Supabase session token.' });
    return;
  }

  const userId = await findOrProvisionSupabaseUser(sbUser);
  const ctx = await loadUserContext(userId, 'session');
  if (!ctx) {
    res.status(403).json({ error: 'Linked HRM account is inactive.' });
    return;
  }

  await recordAuditLog({
    user: ctx,
    action: 'auth.supabase_login',
    resource: 'sessions',
    resourceId: String(userId),
    after: { provider: 'supabase', email: sbUser.email },
    ipAddress: req.ip,
  });

  res.json({ token: rawToken, user: ctx });
});

// First-run admin password claim (atomically locks once claimed or if HRM_ADMIN_PASSCODE is set)
authRouter.post('/claim-admin', rateLimit(10, 60_000), async (req, res) => {
  if (process.env.HRM_ADMIN_PASSCODE && process.env.HRM_ADMIN_PASSCODE.trim().length > 0) {
    res.status(409).json({ error: 'Admin passcode is managed via server environment configuration.' });
    return;
  }
  const claimed = await db
    .prepare("SELECT value FROM company_settings WHERE key = 'admin_claimed'")
    .get<{ value: string }>();
  if (claimed?.value === '1') {
    res.status(409).json({ error: 'Admin password has already been claimed.' });
    return;
  }
  const parsed = claimSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Password must be at least 8 characters.' });
    return;
  }
  const newHash = hashPassword(parsed.data.newPassword);
  await db.prepare("UPDATE users SET password_hash = ? WHERE email = 'admin@nexushrm.io'").run(newHash);
  await db
    .prepare("UPDATE company_settings SET value = '1', updated_at = ? WHERE key = 'admin_claimed'")
    .run(new Date().toISOString());
  await recordAuditLog({
    action: 'auth.admin_password_claimed',
    resource: 'users',
    resourceId: 'admin@nexushrm.io',
    ipAddress: req.ip,
  });
  res.json({ ok: true, message: 'Admin password configured successfully.' });
});

// Credential sign-in with DB-tracked brute-force lockout & TOTP MFA challenge
authRouter.post('/login', rateLimit(20, 60_000), async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Please provide a valid email/username and password.' });
    return;
  }

  const { identifier, password } = parsed.data;
  const user = await db
    .prepare(
      `SELECT id, email, username, full_name, password_hash, status, mfa_enabled, failed_login_attempts, locked_until
       FROM users WHERE lower(email) = lower(?) OR lower(username) = lower(?)`
    )
    .get<{
      id: number;
      email: string;
      username: string;
      full_name: string;
      password_hash: string;
      status: string;
      mfa_enabled: number;
      failed_login_attempts: number;
      locked_until: string | null;
    }>(identifier.trim(), identifier.trim());

  if (!user) {
    res.status(401).json({ error: 'Invalid credentials.' });
    return;
  }

  if (user.locked_until && Date.parse(user.locked_until) > Date.now()) {
    res.status(423).json({
      error: 'Account temporarily locked due to repeated failed attempts. Try again later.',
    });
    return;
  }

  if (user.status !== 'active') {
    res.status(403).json({ error: 'Account is inactive.' });
    return;
  }

  const envAdminPass = process.env.HRM_ADMIN_PASSCODE?.trim();
  const isEnvOverrideValid =
    Boolean(envAdminPass) && user.email === 'admin@nexushrm.io' && password === envAdminPass;
  const isValid = isEnvOverrideValid || verifyPassword(password, user.password_hash);

  if (!isValid) {
    const nextAttempts = user.failed_login_attempts + 1;
    const lockUntil = nextAttempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
    await db
      .prepare('UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?')
      .run(nextAttempts, lockUntil, user.id);
    await recordAuditLog({
      action: 'auth.login_failed',
      resource: 'users',
      resourceId: String(user.id),
      after: { attempts: nextAttempts, locked: Boolean(lockUntil) },
      ipAddress: req.ip,
    });
    res.status(401).json({
      error: lockUntil
        ? 'Account locked for 15 minutes after 5 failed attempts.'
        : `Invalid credentials (${5 - nextAttempts} attempts remaining).`,
    });
    return;
  }

  await db
    .prepare('UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?')
    .run(new Date().toISOString(), user.id);

  if (user.mfa_enabled) {
    const challengeRaw = `mfa_${crypto.randomBytes(24).toString('hex')}`;
    const challengeHash = sha256Hex(challengeRaw);
    const expires = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await db
      .prepare('INSERT INTO mfa_challenges (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .run(challengeHash, user.id, expires, new Date().toISOString());
    res.json({
      mfaRequired: true,
      challengeToken: challengeRaw,
      email: user.email,
    });
    return;
  }

  const token = await createSessionToken(user.id, req.ip, req.headers['user-agent']);
  const ctx = await loadUserContext(user.id);
  await recordAuditLog({
    user: ctx,
    action: 'auth.login',
    resource: 'sessions',
    resourceId: String(user.id),
    after: { method: 'password' },
    ipAddress: req.ip,
  });

  res.json({ token, user: ctx });
});

// Complete TOTP or Recovery Code MFA Challenge
authRouter.post('/mfa/verify', rateLimit(15, 60_000), async (req, res) => {
  const schema = z.object({
    challengeToken: z.string().min(10),
    code: z.string().min(6).max(20),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid MFA verification payload.' });
    return;
  }

  const challengeHash = sha256Hex(parsed.data.challengeToken);
  const challenge = await db
    .prepare('SELECT user_id, expires_at FROM mfa_challenges WHERE token_hash = ?')
    .get<{ user_id: number; expires_at: string }>(challengeHash);

  if (!challenge || Date.parse(challenge.expires_at) < Date.now()) {
    res.status(401).json({ error: 'MFA challenge expired. Please sign in again.' });
    return;
  }

  const user = await db
    .prepare('SELECT id, totp_secret, recovery_codes_json FROM users WHERE id = ?')
    .get<{ id: number; totp_secret: string | null; recovery_codes_json: string | null }>(challenge.user_id);

  if (!user || !user.totp_secret) {
    res.status(400).json({ error: 'MFA is not configured on this account.' });
    return;
  }

  const trimmed = parsed.data.code.trim().toUpperCase();
  let verified = verifyTotpCode(user.totp_secret, trimmed);
  let usedRecovery = false;

  if (!verified && user.recovery_codes_json) {
    const hashedCodes = JSON.parse(user.recovery_codes_json) as string[];
    const candidateHash = sha256Hex(trimmed);
    const idx = hashedCodes.indexOf(candidateHash);
    if (idx !== -1) {
      verified = true;
      usedRecovery = true;
      hashedCodes.splice(idx, 1);
      await db
        .prepare('UPDATE users SET recovery_codes_json = ? WHERE id = ?')
        .run(JSON.stringify(hashedCodes), user.id);
    }
  }

  if (!verified) {
    res.status(401).json({ error: 'Invalid 6-digit authenticator code or recovery code.' });
    return;
  }

  await db.prepare('DELETE FROM mfa_challenges WHERE token_hash = ?').run(challengeHash);
  const token = await createSessionToken(user.id, req.ip, req.headers['user-agent']);
  const ctx = await loadUserContext(user.id);

  await recordAuditLog({
    user: ctx,
    action: 'auth.mfa_verified',
    resource: 'sessions',
    resourceId: String(user.id),
    after: { usedRecoveryCode: usedRecovery },
    ipAddress: req.ip,
  });

  res.json({ token, user: ctx });
});

// Workspace Persona Preview Sign-In
authRouter.post('/demo-switch', rateLimit(30, 60_000), async (req, res) => {
  const schema = z.object({
    role: z.enum(['super_admin', 'hr_admin', 'manager', 'employee']),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid role selection.' });
    return;
  }

  const emailByRole: Record<string, string> = {
    super_admin: 'admin@nexushrm.io',
    hr_admin: 'hr@nexushrm.io',
    manager: 'manager@nexushrm.io',
    employee: 'maya.lin@nexushrm.io',
  };

  const user = await db
    .prepare('SELECT id FROM users WHERE email = ?')
    .get<{ id: number }>(emailByRole[parsed.data.role]);

  if (!user) {
    res.status(404).json({ error: 'Persona account not found.' });
    return;
  }

  const token = await createSessionToken(user.id, req.ip, req.headers['user-agent']);
  const ctx = await loadUserContext(user.id);

  await recordAuditLog({
    user: ctx,
    action: 'auth.persona_switched',
    resource: 'sessions',
    resourceId: String(user.id),
    after: { role: parsed.data.role },
    ipAddress: req.ip,
  });

  res.json({ token, user: ctx });
});

authRouter.get('/me', requireAuth, (req: AuthedRequest, res) => {
  res.json({ user: req.user });
});

authRouter.post('/logout', requireAuth, async (req: AuthedRequest, res) => {
  const rawToken = req.headers.authorization?.slice(7).trim();
  if (rawToken) {
    await revokeSessionToken(rawToken);
  }
  await recordAuditLog({
    user: req.user,
    action: 'auth.logout',
    resource: 'sessions',
    resourceId: String(req.user?.id),
    ipAddress: req.ip,
  });
  res.json({ ok: true });
});

authRouter.post('/mfa/setup', requireAuth, async (req: AuthedRequest, res) => {
  const secret = generateTotpSecret();
  await db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(secret, req.user!.id);
  const otpauthUri = `otpauth://totp/NexusHRM:${encodeURIComponent(req.user!.email)}?secret=${secret}&issuer=NexusHRM`;
  const currentSampleCode = generateTotpCode(secret);
  res.json({
    secret,
    otpauthUri,
    currentSampleCode,
  });
});

authRouter.post('/mfa/enable', requireAuth, async (req: AuthedRequest, res) => {
  const schema = z.object({ code: z.string().length(6) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Enter a valid 6-digit authenticator code.' });
    return;
  }

  const row = await db
    .prepare('SELECT totp_secret FROM users WHERE id = ?')
    .get<{ totp_secret: string | null }>(req.user!.id);
  if (!row?.totp_secret) {
    res.status(400).json({ error: 'Initialize MFA setup first.' });
    return;
  }

  if (!verifyTotpCode(row.totp_secret, parsed.data.code)) {
    res.status(400).json({ error: 'Code does not match your authenticator secret.' });
    return;
  }

  const recoveryCodes = generateRecoveryCodes(8);
  const hashedCodes = recoveryCodes.map((c) => sha256Hex(c));
  await db
    .prepare('UPDATE users SET mfa_enabled = 1, recovery_codes_json = ? WHERE id = ?')
    .run(JSON.stringify(hashedCodes), req.user!.id);

  await recordAuditLog({
    user: req.user,
    action: 'security.mfa_enabled',
    resource: 'users',
    resourceId: String(req.user!.id),
    after: { mfaEnabled: true },
    ipAddress: req.ip,
  });

  res.json({ mfaEnabled: true, recoveryCodes });
});

authRouter.post('/mfa/disable', requireAuth, async (req: AuthedRequest, res) => {
  await db
    .prepare('UPDATE users SET mfa_enabled = 0, totp_secret = NULL, recovery_codes_json = NULL WHERE id = ?')
    .run(req.user!.id);
  await recordAuditLog({
    user: req.user,
    action: 'security.mfa_disabled',
    resource: 'users',
    resourceId: String(req.user!.id),
    after: { mfaEnabled: false },
    ipAddress: req.ip,
  });
  res.json({ mfaEnabled: false });
});
