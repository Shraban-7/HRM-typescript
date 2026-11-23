// Bearer session token is kept strictly in module memory (never localStorage or sessionStorage).
let authToken: string | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function apiRequest<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: unknown;
    bearerOverride?: string;
  } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'X-Requested-With': 'NexusHRM',
  };
  const tokenToUse = options.bearerOverride ?? authToken;
  if (tokenToUse) {
    headers['Authorization'] = `Bearer ${tokenToUse}`;
  }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(path, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const errMsg =
      (data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string'
        ? (data as { error: string }).error
        : null) || `Request failed (${res.status})`;
    throw new ApiError(errMsg, res.status);
  }

  return data as T;
}

export async function downloadCsv(path: string, filename: string): Promise<void> {
  const headers: Record<string, string> = { 'X-Requested-With': 'NexusHRM' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
  const res = await fetch(path, { headers });
  if (!res.ok) throw new ApiError('Failed to download report.', res.status);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function formatCurrency(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatCurrencyWhole(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso.includes('T') ? iso : `${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function hasPerm(permissions: string[], roles: string[], perm: string): boolean {
  return roles.includes('super_admin') || permissions.includes(perm);
}
