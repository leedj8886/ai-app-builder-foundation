import axios from 'axios';

const API_URL = import.meta.env?.VITE_API_URL || '';

export const buildAgentEventStreamUrl = (apiBase: string, runId: string): string => {
  const path = `api/agent/runs/${encodeURIComponent(runId)}/events`;
  const normalizedBase = apiBase.replace(/\/+$/, '');
  return normalizedBase ? `${normalizedBase}/${path}` : `/${path}`;
};

export const agentEventStreamUrl = (runId: string): string =>
  buildAgentEventStreamUrl(API_URL, runId);

export const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle auth errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Auth API
export const authApi = {
  login: (email: string, password: string) =>
    api.post('/api/auth/login', { email, password }),
  register: (email: string, password: string, name: string) =>
    api.post('/api/auth/register', { email, password, name }),
  me: () => api.get('/api/auth/me'),
};

export interface AgentRun {
  _id: string;
  workspaceId?: string;
  projectId: string;
  branchId?: string;
  prompt: string;
  status: 'waiting_for_capacity' | 'queued' | 'running' | 'planning' | 'generating' | 'validating' | 'repairing' | 'persisting' | 'completed' | 'completed_with_conflict' | 'failed' | 'cancelled';
  mode: 'create' | 'edit';
  model?: string;
  baseSnapshotId?: string;
  baseHeadVersion?: number;
  resultSnapshotId?: string;
  retryOfRunId?: string;
  validationCandidateId?: string;
  retryable?: boolean;
  error?: {
    code?: string;
    message?: string;
    details?: ProjectSnapshot['validation'];
  };
  attempt?: number;
  maxRepairAttempts?: number;
  createdAt?: string;
  startedAt?: string;
  updatedAt?: string;
  completedAt?: string;
}

export interface AgentEvent {
  type: string;
  message: string;
  sequence: number;
  payload?: Record<string, unknown>;
}

export interface ProjectSnapshotFile {
  path: string;
  content: string;
  language: 'ts' | 'tsx' | 'js' | 'css' | 'json' | 'html' | 'md';
}

export interface StylingIssue {
  capability: 'plain-css' | 'tailwind' | 'css-modules' | 'styled-components';
  code: 'MISSING_DEPENDENCY' | 'MISSING_CONFIGURATION' | 'MISSING_ENTRY_IMPORT'
    | 'UNEXPANDED_DIRECTIVE' | 'MISSING_BUILD_OUTPUT' | 'METADATA_CONFLICT';
  phase: 'source-contract' | 'build-evidence';
  message: string;
  file?: string;
  previewRecoverable: boolean;
}

export interface ProjectSnapshot {
  _id: string;
  summary: string;
  files: ProjectSnapshotFile[];
  previewCss?: string;
  preview?: {
    kind: 'verified-build';
    verification: 'verified';
    url: string;
  };
  packageJson: {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
    scripts: Record<string, string>;
  };
  validation: {
    status: 'passed' | 'failed' | 'skipped';
    verification?: 'verified' | 'simulated';
    checks: Array<{
      name: 'structure' | 'install' | 'type-check' | 'build';
      phase?: 'structure' | 'dependencies' | 'type-check' | 'build';
      status?: 'passed' | 'failed' | 'retrying' | 'skipped';
      category?: 'CODE_ERROR' | 'DEPENDENCY_ERROR' | 'INFRA_ERROR' | 'STYLING_CONFIGURATION_ERROR';
      command?: string;
      exitCode?: number;
      stdout: string;
      stderr: string;
      durationMs: number;
      cache?: 'hit' | 'miss' | 'not-applicable';
      attempt?: number;
      stylingIssues?: StylingIssue[];
    }>;
    category?: 'CODE_ERROR' | 'DEPENDENCY_ERROR' | 'INFRA_ERROR' | 'STYLING_CONFIGURATION_ERROR';
    retryable?: boolean;
  };
}

export interface ProjectSnapshotSummary {
  id: string;
  summary: string;
  fileCount: number;
  createdAt: string;
  isActive: boolean;
  validation: ProjectSnapshot['validation'];
}

export interface AgentRunDetailResponse {
  run: AgentRun;
  events: AgentEvent[];
  resultSnapshot?: ProjectSnapshot | null;
}

export interface RoutedChat {
  _id: string;
  userId: string;
  projectId?: string;
  branchId?: string;
  title: string;
  messages: Array<{
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    createdAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface ChatListItem {
  _id: string;
  projectId?: string;
  branchId?: string;
  title: string;
  preview?: string;
  createdAt: string;
  updatedAt: string;
}

export type ChatTimelineStatus = AgentRun['status'];

export interface ChatTimelineEvent {
  type: string;
  sequence: number;
  message: string;
  payload?: Record<string, unknown>;
  createdAt: string;
}

export interface ChatTimelinePlan {
  summary: string;
  steps: Array<{
    title: string;
    intent: string;
    filesLikelyTouched: string[];
  }>;
  assumptions: string[];
}

export interface ChatTimelineTurn {
  runId: string;
  retryOfRunId?: string;
  userMessage: {
    content: string;
    createdAt: string;
  };
  agent: {
    status: ChatTimelineStatus;
    model: string;
    startedAt?: string;
    completedAt?: string;
    durationMs?: number;
    planningDurationMs?: number;
    summary?: string;
    plan?: ChatTimelinePlan;
    events: ChatTimelineEvent[];
    error?: {
      code?: string;
      message: string;
    };
    retryable?: boolean;
  };
  snapshot?: {
    id: string;
    summary: string;
    changedFiles: string[];
  };
}

export interface ChatTimelineResponse {
  chat: {
    id: string;
    title: string;
    projectId: string;
  };
  turns: ChatTimelineTurn[];
  pageInfo: {
    hasMore: boolean;
    nextBefore?: string;
  };
}

export const agentApi = {
  createRun: (data: {
    projectId: string;
    chatId?: string;
    prompt: string;
    mode?: 'create' | 'edit';
  }) => api.post<{ run: AgentRun }>('/api/agent/runs', data),
  getRun: (runId: string) =>
    api.get<AgentRunDetailResponse>(`/api/agent/runs/${runId}`),
  getRuns: (projectId: string, limit = 30) =>
    api.get<{ runs: AgentRun[] }>('/api/agent/runs', {
      params: { projectId, limit },
    }),
  cancelRun: (runId: string) =>
    api.post<{ run: AgentRun }>(`/api/agent/runs/${runId}/cancel`),
  retryValidation: (runId: string) =>
    api.post<{ run: AgentRun }>(
      `/api/agent/runs/${runId}/retry-validation`,
    ),
};

// Chat API
export const chatApi = {
  getAll: () => api.get<{ chats: ChatListItem[] }>('/api/chat'),
  getById: (id: string) => api.get<{ chat: RoutedChat }>(`/api/chat/${id}`),
  getTimeline: (
    id: string,
    options: { limit?: number; before?: string } = {},
  ) => api.get<ChatTimelineResponse>(`/api/chat/${id}/timeline`, {
    params: options,
  }),
  create: (titleSeed: string, projectId: string) =>
    api.post<{ chat: RoutedChat }>('/api/chat', { titleSeed, projectId }),
  sendMessage: (id: string, content: string) =>
    api.post<{ chat: RoutedChat }>(`/api/chat/${id}/messages`, { content }),
  update: (id: string, title: string) =>
    api.patch(`/api/chat/${id}`, { title }),
  delete: (id: string) => api.delete(`/api/chat/${id}`),
};

// Project API
export const projectApi = {
  getAll: () => api.get('/api/projects'),
  getById: (id: string) => api.get(`/api/projects/${id}`),
  create: (data: {
    name: string;
    description?: string;
    settings?: {
      framework?: 'react' | 'vue' | 'svelte';
      styling?: 'tailwind' | 'css-modules' | 'styled-components';
      uiLibrary?: 'shadcn' | 'mui' | 'antd' | 'none';
    };
  }) => api.post('/api/projects', data),
  update: (id: string, data: Partial<{
    name: string;
    description: string;
    settings: {
      framework: 'react' | 'vue' | 'svelte';
      styling: 'tailwind' | 'css-modules' | 'styled-components';
      uiLibrary: 'shadcn' | 'mui' | 'antd' | 'none';
    };
  }>) => api.patch(`/api/projects/${id}`, data),
  addChat: (id: string, chatId: string) =>
    api.post(`/api/projects/${id}/chats`, { chatId }),
  removeChat: (id: string, chatId: string) =>
    api.delete(`/api/projects/${id}/chats/${chatId}`),
  getSnapshots: (id: string) =>
    api.get<{ snapshots: ProjectSnapshotSummary[] }>(
      `/api/projects/${id}/snapshots`,
    ),
  getSnapshot: (id: string, snapshotId: string) =>
    api.get<{ snapshot: ProjectSnapshot }>(`/api/projects/${id}/snapshots/${snapshotId}`),
  rollbackSnapshot: (id: string, snapshotId: string) =>
    api.post<{ snapshot: ProjectSnapshot }>(
      `/api/projects/${id}/snapshots/${snapshotId}/rollback`,
    ),
  delete: (id: string) => api.delete(`/api/projects/${id}`),
};
