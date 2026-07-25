export type Screen = 'home' | 'workspace'

export type Panel = 'preview' | 'code' | 'design' | 'deploy'

export type GenerationStatus = 'idle' | 'running' | 'ready' | 'failed' | 'cancelled'

export type StepStatus = 'done' | 'active' | 'pending'

export interface Template {
  id: string
  title: string
  category: 'apps' | 'landing' | 'components' | 'dashboard'
  prompt: string
  views: string
  likes: string
  image: 'row01' | 'row02' | 'ios'
}

export interface GenerationStep {
  id: string
  label: string
  detail: string
  status: StepStatus
}

export interface SnapshotFile {
  path: string
  content: string
  language: 'ts' | 'tsx' | 'css' | 'json' | 'html' | 'md'
}

export interface WorkspaceSnapshot {
  id: string
  summary: string
  files: SnapshotFile[]
  selectedFilePath: string | null
  packageJson: SnapshotPackageJson
  validation: SnapshotValidation
}

export interface SnapshotPackageJson {
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
  scripts: Record<string, string>
}

export interface SnapshotValidationCheck {
  name: 'install' | 'type-check' | 'build'
  command: string
  exitCode: number
  stdout: string
  stderr: string
  durationMs: number
}

export interface SnapshotValidation {
  status: 'passed' | 'failed' | 'skipped'
  checks: SnapshotValidationCheck[]
}

export interface SnapshotSummary {
  id: string
  summary: string
  fileCount: number
  isActive: boolean
  packageJson: SnapshotPackageJson
  validation: SnapshotValidation
  createdAt: string
}

export interface WorkspaceState {
  screen: Screen
  prompt: string
  selectedTemplateId: string | null
  activePanel: Panel
  generation: {
    status: GenerationStatus
    runId?: string
    error?: string
    steps: GenerationStep[]
  }
  snapshot?: WorkspaceSnapshot
  snapshots: SnapshotSummary[]
  runHistory: AgentRunSummary[]
}

export interface AgentRunSummary {
  _id: string
  status: 'queued' | 'running' | 'planning' | 'generating' | 'validating' | 'repairing' | 'persisting' | 'completed' | 'failed' | 'cancelled'
  resultSnapshotId?: string
  prompt?: string
  createdAt?: string
  completedAt?: string
  attempt?: number
  error?: {
    code?: string
    message?: string
    details?: SnapshotValidation
  }
}

export interface AgentEventSummary {
  type: string
  message: string
  sequence: number
  payload?: {
    path?: string
    [key: string]: unknown
  }
}

export interface AgentRunDetail {
  run: AgentRunSummary
  events: AgentEventSummary[]
  resultSnapshot?: {
    _id: string
    summary: string
    files: SnapshotFile[]
    packageJson: SnapshotPackageJson
    validation: SnapshotValidation
  } | null
}

export const suggestionPrompts = [
  'Contact Form',
  'Image Editor',
  'Mini Game',
  'Finance Calculator',
] as const

export const isCancellableRunId = (runId?: string): runId is string =>
  /^[a-f\d]{24}$/i.test(runId ?? '')

export const templates: Template[] = [
  {
    id: 'image-playground',
    title: 'Image Generation Playground',
    category: 'apps',
    prompt: 'Create an image generation playground with model controls, prompt history, upload slots, and a live result canvas.',
    views: '6.1K',
    likes: '684',
    image: 'row01',
  },
  {
    id: 'landing',
    title: 'Brillance SaaS Landing Page',
    category: 'landing',
    prompt: 'Build a polished SaaS landing page with a hero, feature proof, pricing, FAQ, and a Vercel-style deploy CTA.',
    views: '13.6K',
    likes: '2K',
    image: 'row02',
  },
  {
    id: 'gallery',
    title: '3D Gallery Photography Template',
    category: 'components',
    prompt: 'Create a dark 3D gallery component with cards, keyboard navigation, metadata, and responsive image previews.',
    views: '3.2K',
    likes: '823',
    image: 'row01',
  },
  {
    id: 'dashboard',
    title: 'Dashboard - M.O.N.K.Y',
    category: 'dashboard',
    prompt: 'Build a dashboard with charts, task cards, revenue stats, database tables, and team activity.',
    views: '10.8K',
    likes: '1.2K',
    image: 'row02',
  },
  {
    id: 'ios',
    title: 'Mobile App Builder',
    category: 'apps',
    prompt: 'Create a mobile-first app builder with prompt input, recent projects, push preview, and publish status.',
    views: '4.8K',
    likes: '512',
    image: 'ios',
  },
]

export const createInitialWorkspaceState = (): WorkspaceState => ({
  screen: 'home',
  prompt: '',
  selectedTemplateId: null,
  activePanel: 'preview',
  generation: {
    status: 'idle',
    steps: [],
  },
  snapshots: [],
  runHistory: [],
})

const toWorkspaceSnapshot = (
  snapshot: NonNullable<AgentRunDetail['resultSnapshot']>,
): WorkspaceSnapshot => ({
  id: snapshot._id,
  summary: snapshot.summary,
  files: snapshot.files,
  selectedFilePath:
    snapshot.files.find((file) => file.path === 'src/App.tsx')?.path ??
    snapshot.files[0]?.path ??
    null,
  packageJson: snapshot.packageJson,
  validation: snapshot.validation,
})

export const applySnapshotList = (
  state: WorkspaceState,
  snapshots: SnapshotSummary[],
): WorkspaceState => ({
  ...state,
  snapshots,
})

export const applyRunHistory = (
  state: WorkspaceState,
  runs: AgentRunSummary[],
): WorkspaceState => ({
  ...state,
  runHistory: [...runs].sort((left, right) =>
    (right.createdAt ?? '').localeCompare(left.createdAt ?? ''),
  ),
})

export const applyWorkspaceSnapshot = (
  state: WorkspaceState,
  snapshot: NonNullable<AgentRunDetail['resultSnapshot']>,
): WorkspaceState => ({
  ...state,
  screen: 'workspace',
  snapshot: toWorkspaceSnapshot(snapshot),
  snapshots: state.snapshots.map((item) => ({
    ...item,
    isActive: item.id === snapshot._id,
  })),
})

export const selectTemplate = (
  state: WorkspaceState,
  templateId: string,
): WorkspaceState => {
  const template = templates.find((item) => item.id === templateId)

  if (!template) {
    return state
  }

  return {
    ...state,
    prompt: template.prompt,
    selectedTemplateId: template.id,
  }
}

export const submitPrompt = (
  state: WorkspaceState,
  rawPrompt: string,
): WorkspaceState => {
  const prompt = rawPrompt.trim()

  if (!prompt) {
    return state
  }

  return {
    ...state,
    screen: 'workspace',
    prompt,
    activePanel: 'preview',
    generation: {
      status: 'ready',
      steps: buildGenerationSteps(prompt),
    },
  }
}

export const startApiGeneration = (
  state: WorkspaceState,
  rawPrompt: string,
  runId?: string,
): WorkspaceState => {
  const prompt = rawPrompt.trim()

  if (!prompt) {
    return state
  }

  return {
    ...state,
    screen: 'workspace',
    prompt,
    activePanel: 'preview',
    generation: {
      status: 'running',
      runId,
      steps: [
        {
          id: 'run.created',
          label: 'Run queued',
          detail: 'Waiting for the TypeScript agent worker.',
          status: 'active',
        },
      ],
    },
  }
}

export const failApiGeneration = (
  state: WorkspaceState,
  error: string,
): WorkspaceState => ({
  ...state,
  generation: {
    ...state.generation,
    status: 'failed',
    error,
    steps: [
      ...state.generation.steps.map((step) => ({
        ...step,
        status: step.status === 'active' ? 'pending' as const : step.status,
      })),
      {
        id: 'run.failed',
        label: 'Generation failed',
        detail: error,
        status: 'active',
      },
    ],
  },
})

const eventTypeLabels: Record<string, string> = {
  'run.created': 'Run queued',
  'run.started': 'Worker started',
  'agent.plan': 'Plan ready',
  'file.changed': 'File changed',
  'validation.started': 'Validating generated project',
  'validation.failed': 'Validation failed',
  'validation.passed': 'Validation passed',
  'repair.started': 'Repairing generated project',
  'run.completed': 'Snapshot ready',
  'run.failed': 'Generation failed',
  'run.cancelled': 'Generation cancelled',
}

const phaseLabels: Record<string, string> = {
  planning: 'Planning project changes',
  generating: 'Generating application files',
  validating: 'Validating generated project',
  repairing: 'Repairing generated project',
  persisting: 'Saving generated snapshot',
}

const mapEventToStep = (event: AgentEventSummary): GenerationStep => {
  const phase = typeof event.payload?.phase === 'string'
    ? event.payload.phase
    : undefined
  const label = event.type === 'file.changed'
    ? event.message
    : phase
      ? phaseLabels[phase] ?? event.message
      : eventTypeLabels[event.type] ?? event.message

  return {
    id: `${event.sequence}:${event.type}`,
    label,
    detail: event.payload?.path ? String(event.payload.path) : event.message,
    status: 'active',
  }
}

const conciseEventMessage = (message: string): string =>
  message.split('\n').map((line) => line.trim()).find(Boolean) ?? 'Generation failed'

export const applyAgentEvent = (
  state: WorkspaceState,
  runId: string,
  event: AgentEventSummary,
): WorkspaceState => {
  if (state.generation.runId !== runId) return state

  const step = mapEventToStep(event)
  if (state.generation.steps.some((existing) => existing.id === step.id)) return state

  const isFailed = event.type === 'run.failed'
  const status: GenerationStatus = event.type === 'run.completed'
    ? 'ready'
    : event.type === 'run.cancelled'
      ? 'cancelled'
      : isFailed
        ? 'failed'
        : 'running'
  const previousSteps = state.generation.steps.map((existing) => ({
    ...existing,
    status: existing.status === 'active' ? 'done' as const : existing.status,
  }))

  return {
    ...state,
    generation: {
      ...state.generation,
      status,
      error: isFailed ? conciseEventMessage(event.message) : undefined,
      steps: [...previousSteps, step],
    },
  }
}

export const applyAgentRunDetail = (
  state: WorkspaceState,
  detail: AgentRunDetail,
): WorkspaceState => {
  if (
    state.generation.runId &&
    state.generation.runId !== detail.run._id
  ) {
    return state
  }

  const terminal = ['completed', 'failed', 'cancelled'].includes(detail.run.status)
  const snapshot = detail.resultSnapshot
    ? toWorkspaceSnapshot(detail.resultSnapshot)
    : state.snapshot

  const failedCheck = detail.run.error?.details?.checks.find(
    (check) => check.exitCode !== 0,
  )
  const diagnostic = [failedCheck?.stderr, failedCheck?.stdout]
    .flatMap((output) => output?.split('\n') ?? [])
    .map((line) => line.trim())
    .find(Boolean)
  const isCancelled = detail.run.status === 'cancelled'

  return {
    ...state,
    generation: {
      ...state.generation,
      status: detail.run.status === 'completed'
        ? 'ready'
        : isCancelled
          ? 'cancelled'
        : terminal
          ? 'failed'
          : 'running',
      runId: detail.run._id,
      error: detail.run.status === 'failed'
        ? diagnostic ?? detail.run.error?.message ?? 'Generation failed'
        : undefined,
      steps: detail.events.length > 0
        ? detail.events.map(mapEventToStep)
        : state.generation.steps,
    },
    snapshot,
  }
}

export const switchPanel = (
  state: WorkspaceState,
  activePanel: Panel,
): WorkspaceState => ({
  ...state,
  activePanel,
})

const buildGenerationSteps = (prompt: string): GenerationStep[] => [
  {
    id: 'plan',
    label: 'Plan the app',
    detail: `Read prompt: "${prompt.slice(0, 72)}${prompt.length > 72 ? '...' : ''}"`,
    status: 'done',
  },
  {
    id: 'ui',
    label: 'Compose UI',
    detail: 'Scaffold responsive React screens with Tailwind tokens and shadcn-style controls.',
    status: 'done',
  },
  {
    id: 'data',
    label: 'Connect data',
    detail: 'Create realistic mock data, API contracts, and database-ready resource names.',
    status: 'done',
  },
  {
    id: 'review',
    label: 'Run diagnostics',
    detail: 'Check layout, accessibility states, copy, imports, and preview rendering.',
    status: 'done',
  },
  {
    id: 'publish',
    label: 'Ready to publish',
    detail: 'Preview, code, design mode, repo sync, and deploy actions are available.',
    status: 'active',
  },
]
