/** AtomForge's same-origin API client; credentials stay within this app. */
const TOKEN_KEY = 'atomforge.session.token';
const USER_KEY = 'atomforge.session.user';

export interface AfUser {
  id: string;
  email: string;
  display_name: string;
  username?: string;
  avatar_url?: string;
  has_password?: boolean;
  created_at?: string;
  last_login_at?: string;
}

export type AuthState = 'loading' | 'authenticated' | 'anonymous';

/** Extract a human readable message from any SDK / axios style error. */
export function errorMessage(error: unknown, fallback = '请求失败，请重试'): string {
  const err = error as {
    data?: { detail?: string };
    response?: { data?: { detail?: string } };
    message?: string;
  };
  return err?.data?.detail || err?.response?.data?.detail || err?.message || fallback;
}

/* ------------------------------------------------------------ session store */

export function readToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

function readCachedUser(): AfUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AfUser) : null;
  } catch {
    return null;
  }
}

function writeSession(token: string, user: AfUser): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* storage may be unavailable in private mode; session stays in memory */
  }
  currentUser = user;
  notify();
}

function clearSession(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    /* ignore */
  }
  currentUser = null;
  notify();
}

let currentUser: AfUser | null = readCachedUser();
const listeners = new Set<(user: AfUser | null) => void>();

function notify(): void {
  listeners.forEach((fn) => fn(currentUser));
}

/** Subscribe to sign-in / sign-out changes. Returns an unsubscribe function. */
export function onAuthChange(fn: (user: AfUser | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function cachedUser(): AfUser | null {
  return currentUser;
}

/* ---------------------------------------------------------------- API calls */

export class UnauthorizedError extends Error {
  constructor(message = '登录状态已失效，请重新登录') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

function statusOf(error: unknown): number {
  const err = error as { status?: number; response?: { status?: number } };
  return err?.response?.status ?? err?.status ?? 0;
}

interface InvokeOptions {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  data?: Record<string, unknown>;
  /** Attach the AtomForge session token (default true). */
  auth?: boolean;
  timeoutMs?: number;
}

/**
 * Call an AtomForge backend route. Authenticated requests carry the session
 * token in the `X-AtomForge-Token` header; a 401 clears the local session.
 */
export async function invoke<T>({
  url,
  method = 'GET',
  data = {},
  auth = true,
  timeoutMs = 20000,
}: InvokeOptions): Promise<T> {
  const headers: Record<string, string> = {};
  if (auth) {
    const token = readToken();
    if (!token) throw new UnauthorizedError('请先登录 AtomForge 账号');
    headers['X-AtomForge-Token'] = token;
  }

  try {
    if (!url.startsWith('/api/')) throw new Error('Invalid API path');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method, headers: {...headers, 'Content-Type': 'application/json'},
        body: ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? JSON.stringify(data) : undefined,
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = typeof payload.detail === 'string' ? payload.detail : '请求参数无效或服务暂不可用';
        throw Object.assign(new Error(detail), {status: response.status});
      }
      return payload as T;
    } finally { clearTimeout(timeout); }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('请求超时，请检查网络后重试');
    }
    if (auth && statusOf(error) === 401) {
      // A delayed failure from a previous login must not sign out its replacement.
      if (headers['X-AtomForge-Token'] === readToken()) clearSession();
      throw new UnauthorizedError(errorMessage(error, '登录状态已失效，请重新登录'));
    }
    throw error;
  }
}

/* --------------------------------------------------------------------- auth */

interface AuthPayload {
  user: AfUser;
  access_token: string;
  expires_at: string;
}

/**
 * Register a new AtomForge account. The account is usable immediately: the
 * backend returns a session token, so the caller lands signed in.
 */
export async function register(input: {
  email: string;
  password: string;
  displayName: string;
}): Promise<AfUser> {
  const payload = await invoke<AuthPayload>({
    url: '/api/v1/af-auth/register',
    method: 'POST',
    auth: false,
    data: {
      email: input.email,
      password: input.password,
      username: input.displayName,
    },
  });
  writeSession(payload.access_token, payload.user);
  return payload.user;
}

export async function signIn(identifier: string, password: string): Promise<AfUser> {
  const payload = await invoke<AuthPayload>({
    url: '/api/v1/af-auth/login',
    method: 'POST',
    auth: false,
    data: { identifier, password },
  });
  writeSession(payload.access_token, payload.user);
  return payload.user;
}

/**
 * Resolve the signed-in account. Returns null when anonymous or when the stored
 * token is no longer valid, so callers can render a login entry instead.
 */
let currentUserRequest: {token: string; promise: Promise<AfUser | null>} | undefined;

export function fetchCurrentUser(): Promise<AfUser | null> {
  const token = readToken();
  if (!token) {
    if (currentUser) clearSession();
    return Promise.resolve(null);
  }
  if (currentUserRequest?.token === token) return currentUserRequest.promise;
  const request: Promise<AfUser | null> = (async () => {
    try {
      const payload = await invoke<{ user: AfUser }>({ url: '/api/v1/af-auth/me' });
      // A response from a replaced login cannot restore or overwrite identity.
      if (readToken() !== token) return currentUser;
      currentUser = payload.user;
      try {
        localStorage.setItem(USER_KEY, JSON.stringify(payload.user));
      } catch {
        /* ignore */
      }
      notify();
      return payload.user;
    } catch (error) {
      if (readToken() !== token) return currentUser;
      if (error instanceof UnauthorizedError || statusOf(error) === 401) return null;
      // Network hiccup: fall back to the cached profile instead of forcing logout.
      return currentUser;
    }
  })().finally(() => {
    if (currentUserRequest?.promise === request) currentUserRequest = undefined;
  });
  currentUserRequest = {token, promise: request};
  return request;
}

export async function signOut(): Promise<void> {
  const token = readToken();
  if (token) {
    try {
      await invoke({ url: '/api/v1/af-auth/logout', method: 'POST' });
    } catch {
      /* logout is stateless server-side; dropping the token is enough */
    }
  }
  clearSession();
}

export interface OAuthTransfer {status:'confirmation_required';provider:string;login:string;target_name:string}
const oauthExchanges=new Map<string,Promise<string|OAuthTransfer>>();
export function completeOAuth(ticket:string):Promise<string|OAuthTransfer>{
  const existing=oauthExchanges.get(ticket);if(existing)return existing;
  const exchange=invoke<(AuthPayload&{redirect:string})|OAuthTransfer>({url:'/api/v1/af-auth/oauth/exchange',method:'POST',auth:!!readToken(),data:{ticket}}).then(payload=>{
    if('status' in payload)return payload;
    writeSession(payload.access_token,payload.user);
    return payload.redirect.startsWith('/')&&!payload.redirect.startsWith('//')&&!payload.redirect.includes('\\')?payload.redirect:'/dashboard';
  });
  oauthExchanges.set(ticket,exchange);
  return exchange;
}

export async function resolveOAuthTransfer(ticket:string,confirm:boolean):Promise<string>{
  const result=await invoke<{redirect:string;transferred:boolean}>({url:'/api/v1/af-auth/oauth/transfer',method:'POST',data:{ticket,confirm}});
  oauthExchanges.delete(ticket);
  return result.redirect;
}

export async function updateAccount(input: {username: string; email: string; avatar?: string}): Promise<AfUser> {
  const payload = await invoke<{user: AfUser}>({url: '/api/v1/af-auth/me', method: 'PATCH', data: input});
  writeSession(readToken(), payload.user);
  return payload.user;
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const token = readToken();
  const payload = await invoke<AuthPayload>({url: '/api/v1/af-auth/password', method: 'POST', data: {current_password: currentPassword, new_password: newPassword}});
  if (readToken() !== token) throw new Error('登录账号已变化，请使用新密码重新登录');
  writeSession(payload.access_token, payload.user);
}
