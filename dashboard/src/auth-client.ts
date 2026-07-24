// Standalone auth + HTTP client for the FastAPI backend. Intentionally free of
// any dashboard-module imports so the lean /login and /signup pages (and the
// dashboard guard) can reuse it without dragging in the dashboard graph — which
// also avoids a circular-import break during prerender.
//
// Auth is an httponly `token` cookie set by the backend (samesite=lax reaches
// :8000 because localhost ports are same-site). JS can't read it, so we keep a
// local "signed in" flag for optimistic UI — the browser carries the cookie via
// credentials:'include'.

const LS_TOKEN = 'IntervieHire_auth_token';

// Base URL: env override (NEXT_PUBLIC_API_URL) → default local FastAPI.
// NOTE: reference process.env.NEXT_PUBLIC_API_URL DIRECTLY so Next.js inlines the
// configured value into the browser bundle. A `typeof process` guard here gets
// dead-code-eliminated in the client build (process is undefined in the browser),
// which silently dropped the configured URL and fell back to localhost in prod.
function resolveApiBase(): string {
  let base = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api').trim().replace(/\/+$/, '');
  if (base && /^https?:\/\//i.test(base) && !base.endsWith('/api')) {
    base += '/api';
  }
  return base;
}
export const API_BASE = resolveApiBase();

function setAuthed(v: unknown) { try { v ? localStorage.setItem(LS_TOKEN, '1') : localStorage.removeItem(LS_TOKEN); } catch {} }
export const isAuthed = () => { try { return localStorage.getItem(LS_TOKEN) === '1'; } catch { return false; } };
// Lets the guard clear the optimistic flag when /me rejects.
export function clearAuthed() { setAuthed(false); }

// Options accepted by request(). body is any JSON-serialisable value (or omitted
// for GET/DELETE-without-payload). Returns the parsed JSON (any) or throws on !ok.
export interface RequestOptions {
  method?: string;
  body?: unknown;
}
export async function request(path: string, { method = 'GET', body }: RequestOptions = {}): Promise<any> {
  const headers = { 'Content-Type': 'application/json' };
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, { method, headers, credentials: 'include', body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  } catch (err) {
    throw new Error(`Network error reaching backend (${API_BASE}). Is FastAPI running on :8000? ${err.message}`);
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = (data && (data.detail || data.error || data.message)) || `${res.status} ${res.statusText}`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return data;
}

export async function apiLogin(email: string, password: string) {
  const data = await request('/auth/login', { method: 'POST', body: { email, password } });
  setAuthed(true);
  return { user: data?.user || null, onboardingRequired: !!data?.onboarding_required };
}

export async function apiSignup({ name, email, password }: { name: string; email: string; password: string }) {
  const data = await request('/auth/signup', { method: 'POST', body: { name, email, password } });
  setAuthed(true);
  return { user: data?.user || null, onboardingRequired: !!data?.onboarding_required };
}

// Authoritative session check — returns the user profile, or throws on 401.
export async function apiMe() {
  return request('/auth/me');
}

export async function apiLogout() {
  try { await request('/auth/logout', { method: 'POST' }); } catch {}
  setAuthed(false);
}

// ── Onboarding + super-admin org context ───────────────────────────────────
// New signups land org-less (onboarding_required); this creates their workspace.
export async function apiOnboarding(payload: unknown) {
  return request('/auth/onboarding', { method: 'POST', body: payload });
}
// Super-admin only (backend 403s everyone else): list every organisation.
export async function apiListOrganisations() {
  return request('/auth/organisations');
}
// Super-admin only: set the active_org_id cookie so list routes scope to `organisationId`.
export async function apiSwitchContext(organisationId: string) {
  return request('/auth/switch-context', { method: 'POST', body: { organisation_id: organisationId } });
}
