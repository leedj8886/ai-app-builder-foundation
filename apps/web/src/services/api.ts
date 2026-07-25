import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || '';

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
  projectId: string;
  prompt: string;
  status: 'queued' | 'running' | 'planning' | 'generating' | 'validating' | 'repairing' | 'persisting' | 'completed' | 'failed' | 'cancelled';
  mode: 'create' | 'edit';
  baseSnapshotId?: string;
  resultSnapshotId?: string;
  error?: {
    code?: string;
    message?: string;
    details?: ProjectSnapshot['validation'];
  };
  attempt?: number;
  maxRepairAttempts?: number;
  createdAt?: string;
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
  language: 'ts' | 'tsx' | 'css' | 'json' | 'html' | 'md';
}

export interface ProjectSnapshot {
  _id: string;
  summary: string;
  files: ProjectSnapshotFile[];
  packageJson: {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
    scripts: Record<string, string>;
  };
  validation: {
    status: 'passed' | 'failed' | 'skipped';
    checks: Array<{
      name: 'install' | 'type-check' | 'build';
      command: string;
      exitCode: number;
      stdout: string;
      stderr: string;
      durationMs: number;
    }>;
  };
}

export interface AgentRunDetailResponse {
  run: AgentRun;
  events: AgentEvent[];
  resultSnapshot?: ProjectSnapshot | null;
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
};

// Chat API
export const chatApi = {
  getAll: () => api.get('/api/chat'),
  getById: (id: string) => api.get(`/api/chat/${id}`),
  create: (initialMessage: string, projectId?: string) =>
    api.post('/api/chat', { initialMessage, projectId }),
  sendMessage: (id: string, content: string) =>
    api.post(`/api/chat/${id}/messages`, { content }),
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
    api.get<{ snapshots: Array<{
      id: string;
      summary: string;
      fileCount: number;
      createdAt: string;
      isActive: boolean;
      packageJson: ProjectSnapshot['packageJson'];
      validation: ProjectSnapshot['validation'];
    }> }>(`/api/projects/${id}/snapshots`),
  getSnapshot: (id: string, snapshotId: string) =>
    api.get<{ snapshot: ProjectSnapshot }>(`/api/projects/${id}/snapshots/${snapshotId}`),
  rollbackSnapshot: (id: string, snapshotId: string) =>
    api.post<{ snapshot: ProjectSnapshot }>(
      `/api/projects/${id}/snapshots/${snapshotId}/rollback`,
    ),
  delete: (id: string) => api.delete(`/api/projects/${id}`),
};
