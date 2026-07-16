/** 管理后台 API 客户端:仅认证 + /api/admin 系列 */

export interface AdminMe {
  id: string;
  email: string;
  role: string;
}

export interface PlatformStats {
  users: number;
  activeUsers: number;
  projects: number;
  runsTotal: number;
  runsActive: number;
  issuesOpen: number;
  issuesTotal: number;
}

export interface AdminUser {
  id: string;
  email: string;
  role: string;
  status: 'active' | 'disabled';
  runnerEnabled: boolean;
  quota: number;
  createdAt: string;
  projectCount: number;
  runCount: number;
}

export interface AdminRun {
  id: string;
  userEmail: string;
  projectName: string;
  mode: string;
  executor: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  findingsCount: number;
  stepsTaken: number;
  createdAt: string;
}

export interface PlatformModel {
  baseUrl: string;
  modelName: string;
  vlMode: string;
  hasApiKey: boolean;
}

const ACCESS_KEY = 'tpa_access_token';
const REFRESH_KEY = 'tpa_refresh_token';

export const tokenStore = {
  get access() {
    return localStorage.getItem(ACCESS_KEY);
  },
  get refresh() {
    return localStorage.getItem(REFRESH_KEY);
  },
  save(tokens: { accessToken: string; refreshToken: string }) {
    localStorage.setItem(ACCESS_KEY, tokens.accessToken);
    localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; retryOn401?: boolean } = {},
): Promise<T> {
  const { method = 'GET', body, retryOn401 = true } = options;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (tokenStore.access) headers.authorization = `Bearer ${tokenStore.access}`;

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, '连接不上服务器,请确认 API 服务已启动');
  }

  if (res.status === 401 && retryOn401 && tokenStore.refresh) {
    const ok = await tryRefresh();
    if (ok) return request<T>(path, { method, body, retryOn401: false });
  }

  const payload = (await res.json().catch(() => null)) as
    | { ok: boolean; data?: T; error?: string }
    | null;
  if (!res.ok || !payload?.ok) {
    throw new ApiError(res.status, payload?.error ?? `请求失败(HTTP ${res.status})`);
  }
  return payload.data as T;
}

async function tryRefresh(): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: tokenStore.refresh }),
    });
    const payload = (await res.json()) as {
      ok: boolean;
      data?: { accessToken: string; refreshToken: string };
    };
    if (!res.ok || !payload.ok || !payload.data) {
      tokenStore.clear();
      return false;
    }
    tokenStore.save(payload.data);
    return true;
  } catch {
    tokenStore.clear();
    return false;
  }
}

export const api = {
  /** 管理员登录:非 admin 角色直接拒绝并清除会话 */
  async login(email: string, password: string): Promise<AdminMe> {
    const data = await request<{
      user: AdminMe;
      accessToken: string;
      refreshToken: string;
    }>('/api/auth/login', { method: 'POST', body: { email, password }, retryOn401: false });
    if (data.user.role !== 'admin') {
      throw new ApiError(403, '该账号不是管理员,无法登录管理后台');
    }
    tokenStore.save(data);
    return data.user;
  },

  me: () => request<{ user: AdminMe }>('/api/auth/me').then((d) => d.user),

  logout() {
    tokenStore.clear();
  },

  stats: () => request<{ stats: PlatformStats }>('/api/admin/stats').then((d) => d.stats),

  users: () => request<{ users: AdminUser[] }>('/api/admin/users').then((d) => d.users),

  patchUser: (
    id: string,
    patch: { status?: 'active' | 'disabled'; runnerEnabled?: boolean; quota?: number },
  ) => request<{ user: AdminUser }>(`/api/admin/users/${id}`, { method: 'PATCH', body: patch }),

  runs: () => request<{ runs: AdminRun[] }>('/api/admin/runs').then((d) => d.runs),

  resetPassword: (id: string) =>
    request<{ tempPassword: string }>(`/api/admin/users/${id}/reset-password`, { method: 'POST' }).then(
      (d) => d.tempPassword,
    ),

  getModelConfig: () =>
    request<{ model: PlatformModel | null }>('/api/admin/model-config').then((d) => d.model),

  saveModelConfig: (input: { apiKey?: string; baseUrl: string; modelName: string; vlMode: string }) =>
    request<{ model: PlatformModel }>('/api/admin/model-config', { method: 'PUT', body: input }).then(
      (d) => d.model,
    ),

  getRegistration: () => request<{ enabled: boolean }>('/api/admin/registration').then((d) => d.enabled),

  setRegistration: (enabled: boolean) =>
    request<{ enabled: boolean }>('/api/admin/registration', { method: 'PUT', body: { enabled } }),

  getQuota: () => request<{ defaultFreeRuns: number }>('/api/admin/quota').then((d) => d.defaultFreeRuns),

  setQuota: (defaultFreeRuns: number) =>
    request<{ defaultFreeRuns: number }>('/api/admin/quota', {
      method: 'PUT',
      body: { defaultFreeRuns },
    }),
};
