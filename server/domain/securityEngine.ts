import crypto from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// ---------------------------------------------------------------------------
// Password Hashing (Server-side salted scrypt with constant-time comparison)
// ---------------------------------------------------------------------------

export function hashPassword(password: string, existingSalt?: string): string {
  const salt = existingSalt ?? crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;
  const actualBuf = crypto.scryptSync(password, salt, 64);
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  if (actualBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(actualBuf, expectedBuf);
}

// ---------------------------------------------------------------------------
// RFC 6238 TOTP Multi-Factor Authentication
// ---------------------------------------------------------------------------

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret(byteLength = 20): string {
  return base32Encode(crypto.randomBytes(byteLength));
}

export function generateTotpCode(secretBase32: string, timestampMs = Date.now(), stepSeconds = 30): string {
  const key = base32Decode(secretBase32);
  const counter = Math.floor(timestampMs / 1000 / stepSeconds);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuf.writeUInt32BE(counter >>> 0, 4);

  const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(binary % 1_000_000).padStart(6, '0');
}

export function verifyTotpCode(
  secretBase32: string,
  code: string,
  timestampMs = Date.now(),
  windowSteps = 1
): boolean {
  const normalized = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalized)) return false;

  const candidateBuf = Buffer.from(normalized, 'utf8');
  for (let delta = -windowSteps; delta <= windowSteps; delta++) {
    const expected = generateTotpCode(secretBase32, timestampMs + delta * 30_000);
    const expectedBuf = Buffer.from(expected, 'utf8');
    if (crypto.timingSafeEqual(candidateBuf, expectedBuf)) {
      return true;
    }
  }
  return false;
}

export function generateRecoveryCodes(count = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(4).toString('hex').toUpperCase();
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}`);
  }
  return codes;
}

export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// ---------------------------------------------------------------------------
// Signed Webhook Payloads & Safe Outbound URL Validation
// ---------------------------------------------------------------------------

export function signWebhookPayload(payload: string, secret: string, timestampSec: number): string {
  const signedBase = `${timestampSec}.${payload}`;
  const sig = crypto.createHmac('sha256', secret).update(signedBase).digest('hex');
  return `t=${timestampSec},v1=${sig}`;
}

export function validateSafeWebhookUrl(rawUrl: string): { valid: boolean; reason?: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { valid: false, reason: 'Invalid URL format' };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { valid: false, reason: 'Only http:// and https:// endpoints are permitted' };
  }

  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '[::1]' ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return { valid: false, reason: 'Loopback and local hostnames are blocked for outbound webhooks' };
  }

  // Block private / link-local IPv4 ranges
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [a, b] = [Number(ipv4Match[1]), Number(ipv4Match[2])];
    if (
      a === 127 ||
      a === 10 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    ) {
      return { valid: false, reason: 'Private and link-local IP addresses are blocked' };
    }
  }

  if (host.startsWith('[fe80:') || host.startsWith('[fc') || host.startsWith('[fd')) {
    return { valid: false, reason: 'Private IPv6 addresses are blocked' };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Tamper-Evident Audit Hash Chain & Sensitive Field Redaction
// ---------------------------------------------------------------------------

export interface AuditChainEntry {
  id?: number;
  userId: number | null;
  action: string;
  resource: string;
  resourceId: string | null;
  beforeData: string | null;
  afterData: string | null;
  ipAddress: string | null;
  createdAt: string;
  prevHash: string;
  entryHash?: string;
}

export function computeAuditEntryHash(entry: Omit<AuditChainEntry, 'entryHash' | 'id'>): string {
  const canonical = JSON.stringify([
    entry.prevHash,
    entry.userId ?? null,
    entry.action,
    entry.resource,
    entry.resourceId ?? null,
    entry.beforeData ?? null,
    entry.afterData ?? null,
    entry.ipAddress ?? null,
    entry.createdAt,
  ]);
  return sha256Hex(canonical);
}

export function verifyAuditHashChain(entries: AuditChainEntry[]): {
  valid: boolean;
  checkedCount: number;
  brokenAtId: number | null;
} {
  let expectedPrev = 'GENESIS';
  for (const entry of entries) {
    if (entry.prevHash !== expectedPrev) {
      return { valid: false, checkedCount: entries.length, brokenAtId: entry.id ?? null };
    }
    const recomputed = computeAuditEntryHash({
      userId: entry.userId,
      action: entry.action,
      resource: entry.resource,
      resourceId: entry.resourceId,
      beforeData: entry.beforeData,
      afterData: entry.afterData,
      ipAddress: entry.ipAddress,
      createdAt: entry.createdAt,
      prevHash: entry.prevHash,
    });
    if (recomputed !== entry.entryHash) {
      return { valid: false, checkedCount: entries.length, brokenAtId: entry.id ?? null };
    }
    expectedPrev = entry.entryHash;
  }
  return { valid: true, checkedCount: entries.length, brokenAtId: null };
}

const SENSITIVE_KEY_PATTERN = /(password|secret|token|totp|recovery|key_hash|passcode|ssn|tax_id)/i;
const BANK_KEY_PATTERN = /(bank_account|routing_number|iban|account_number)/i;

export function redactSensitiveData(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => redactSensitiveData(item));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(k)) {
        out[k] = '[REDACTED]';
      } else if (BANK_KEY_PATTERN.test(k) && typeof v === 'string' && v.length > 4) {
        out[k] = `••••${v.slice(-4)}`;
      } else {
        out[k] = redactSensitiveData(v);
      }
    }
    return out;
  }
  return value;
}

export function maskBankAccount(accountNumber: string | null | undefined): string {
  if (!accountNumber) return 'Not configured';
  const clean = accountNumber.trim();
  if (clean.length <= 4) return '••••';
  return `•••• •••• ${clean.slice(-4)}`;
}
