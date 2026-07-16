/** 后端 API 客户端:统一信封 { ok, data, error },token 管理与 401 自动刷新 */

export interface ApiUser {
  id: string;
  email: string;
  role: string;
  runnerEnabled: boolean;
  createdAt: string;
}

interface AuthResult {
  user: ApiUser;
  accessToken: string;
  refreshToken: string;
}

const ACCESS_KEY = 'tp_access_token';
const REFRESH_KEY = 'tp_refresh_token';

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
    // fetch 层失败 = 后端不可达,与业务错误明确区分
    throw new ApiError(0, '连接不上服务器:请确认本地服务已启动(pm2 status)');
  }

  if (res.status === 401 && retryOn401 && tokenStore.refresh) {
    const refreshed = await tryRefresh();
    if (refreshed) return request<T>(path, { method, body, retryOn401: false });
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
    const payload = (await res.json()) as { ok: boolean; data?: AuthResult };
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

export interface ApiProject {
  id: string;
  name: string;
  targetUrl: string;
  createdAt: string;
  runCount: number;
}

export interface ApiFinding {
  id: string;
  detector: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  pageUrl: string;
  stepSeq: number;
  screenshotFile: string;
  evidence: Record<string, unknown>;
}

export interface ApiStep {
  seq: number;
  description: string;
  pageUrl: string;
  screenshotFile: string;
}

export interface ApiRunReport {
  visitedUrls: string[];
  steps: ApiStep[];
  findings: ApiFinding[];
}

export interface ApiRun {
  id: string;
  projectId: string;
  mode: 'heuristic' | 'ai' | 'cli';
  executor: 'cloud' | 'runner';
  status: 'queued' | 'running' | 'done' | 'failed';
  goal: string | null;
  stepBudget: number;
  error: string | null;
  findingsCount: number;
  criticalCount: number;
  stepsTaken: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  report: ApiRunReport | null;
}

export interface ApiRunnerToken {
  id: string;
  name: string;
  lastSeenAt: string | null;
  createdAt: string;
}

export type IssueStatus = 'open' | 'confirmed' | 'fixing' | 'closed' | 'false_positive';

export interface ApiIssue {
  id: string;
  projectId: string;
  fingerprint: string;
  detector: string;
  severity: ApiFinding['severity'];
  title: string;
  status: IssueStatus;
  occurrences: number;
  firstRunId: string;
  lastRunId: string;
  firstSeenAt: string;
  lastSeenAt: string;
  finding: ApiFinding | null;
}

/** 平台模型配置(仅管理员可见;Key 永不回传) */
export interface ApiPlatformModel {
  baseUrl: string;
  modelName: string;
  vlMode: string;
  hasApiKey: boolean;
}

export interface ApiAdminStats {
  users: number;
  activeUsers: number;
  projects: number;
  runsTotal: number;
  runsActive: number;
  issuesOpen: number;
  issuesTotal: number;
}

export interface ApiAdminUser {
  id: string;
  email: string;
  role: string;
  status: 'active' | 'disabled';
  runnerEnabled: boolean;
  createdAt: string;
  projectCount: number;
  runCount: number;
}

export interface ApiAdminRun {
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

export const api = {
  async register(email: string, password: string): Promise<ApiUser> {
    const data = await request<AuthResult>('/api/auth/register', {
      method: 'POST',
      body: { email, password },
      retryOn401: false,
    });
    tokenStore.save(data);
    return data.user;
  },

  async login(email: string, password: string): Promise<ApiUser> {
    const data = await request<AuthResult>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
      retryOn401: false,
    });
    tokenStore.save(data);
    return data.user;
  },

  async me(): Promise<ApiUser> {
    const data = await request<{ user: ApiUser }>('/api/auth/me');
    return data.user;
  },

  logout() {
    tokenStore.clear();
  },

  listProjects: () =>
    request<{ projects: ApiProject[] }>('/api/projects').then((d) => d.projects),

  createProject: (name: string, targetUrl: string) =>
    request<{ project: ApiProject }>('/api/projects', {
      method: 'POST',
      body: { name, targetUrl },
    }).then((d) => d.project),

  getProject: (id: string) =>
    request<{ project: ApiProject }>(`/api/projects/${id}`).then((d) => d.project),

  deleteProject: (id: string) =>
    request<{ deleted: boolean }>(`/api/projects/${id}`, { method: 'DELETE' }),

  listRuns: (projectId: string) =>
    request<{ runs: ApiRun[] }>(`/api/projects/${projectId}/runs`).then((d) => d.runs),

  createRun: (
    projectId: string,
    input: { mode: string; executor?: string; goal?: string; stepBudget: number },
  ) =>
    request<{ run: ApiRun }>(`/api/projects/${projectId}/runs`, {
      method: 'POST',
      body: input,
    }).then((d) => d.run),

  getRun: (id: string) => request<{ run: ApiRun }>(`/api/runs/${id}`).then((d) => d.run),

  listIssues: (projectId: string, filters: { status?: string; severity?: string } = {}) => {
    const params = new URLSearchParams(
      Object.entries(filters).filter(([, v]) => Boolean(v)) as [string, string][],
    );
    const suffix = params.size ? `?${params}` : '';
    return request<{ issues: ApiIssue[] }>(`/api/projects/${projectId}/issues${suffix}`).then(
      (d) => d.issues,
    );
  },

  getIssue: (id: string) => request<{ issue: ApiIssue }>(`/api/issues/${id}`).then((d) => d.issue),

  updateIssueStatus: (id: string, status: IssueStatus) =>
    request<{ issue: ApiIssue }>(`/api/issues/${id}`, {
      method: 'PATCH',
      body: { status },
    }).then((d) => d.issue),

  adminGetModelConfig: () =>
    request<{ model: ApiPlatformModel | null }>('/api/admin/model-config').then((d) => d.model),

  adminSaveModelConfig: (input: { apiKey?: string; baseUrl: string; modelName: string; vlMode: string }) =>
    request<{ model: ApiPlatformModel }>('/api/admin/model-config', { method: 'PUT', body: input }).then(
      (d) => d.model,
    ),

  adminGetRegistration: () =>
    request<{ enabled: boolean }>('/api/admin/registration').then((d) => d.enabled),

  adminSetRegistration: (enabled: boolean) =>
    request<{ enabled: boolean }>('/api/admin/registration', { method: 'PUT', body: { enabled } }),

  listRunnerTokens: () =>
    request<{ tokens: ApiRunnerToken[] }>('/api/settings/runner-tokens').then((d) => d.tokens),

  createRunnerToken: (name: string) =>
    request<{ token: ApiRunnerToken; plaintext: string }>('/api/settings/runner-tokens', {
      method: 'POST',
      body: { name },
    }),

  deleteRunnerToken: (id: string) =>
    request<{ deleted: boolean }>(`/api/settings/runner-tokens/${id}`, { method: 'DELETE' }),

  adminStats: () => request<{ stats: ApiAdminStats }>('/api/admin/stats').then((d) => d.stats),

  adminUsers: () => request<{ users: ApiAdminUser[] }>('/api/admin/users').then((d) => d.users),

  adminPatchUser: (id: string, patch: { status?: 'active' | 'disabled'; runnerEnabled?: boolean }) =>
    request<{ user: { id: string; status: string; runnerEnabled: boolean } }>(`/api/admin/users/${id}`, {
      method: 'PATCH',
      body: patch,
    }),

  adminRuns: () => request<{ runs: ApiAdminRun[] }>('/api/admin/runs').then((d) => d.runs),

  /** 截图需带鉴权,取回 blob URL(调用方负责 revoke) */
  async fetchArtifact(runId: string, screenshotFile: string): Promise<string> {
    const name = screenshotFile.split('/').pop() ?? screenshotFile;
    const res = await fetch(`/api/runs/${runId}/artifacts/${name}`, {
      headers: tokenStore.access ? { authorization: `Bearer ${tokenStore.access}` } : {},
    });
    if (!res.ok) throw new ApiError(res.status, '截图加载失败');
    return URL.createObjectURL(await res.blob());
  },
};
