export type Screen = 'home' | 'workspace'

export type Panel = 'preview' | 'code' | 'design' | 'deploy'

export type GenerationStatus = 'idle' | 'ready'

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

export interface WorkspaceState {
  screen: Screen
  prompt: string
  selectedTemplateId: string | null
  activePanel: Panel
  generation: {
    status: GenerationStatus
    steps: GenerationStep[]
  }
}

export const suggestionPrompts = [
  'Contact Form',
  'Image Editor',
  'Mini Game',
  'Finance Calculator',
] as const

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
