import type {
  AgentPlan,
  GenerationResult,
  ModelClient
} from '../types';

export interface FakeModelClient extends ModelClient {
  calls: {
    plan: number;
    generate: number;
    repair: number;
  };
}

const deterministicPlan: AgentPlan = {
  summary: 'Build a deterministic React application',
  steps: [{
    title: 'Create application files',
    intent: 'Create a minimal runnable React application',
    filesLikelyTouched: ['index.html', 'src/main.tsx', 'src/App.tsx', 'src/index.css']
  }],
  assumptions: []
};

const deterministicGeneration: GenerationResult = {
  message: 'Created the deterministic application',
  operations: [
    {
      type: 'create',
      path: 'index.html',
      content: '<div id="root"></div><script type="module" src="/src/main.tsx"></script>'
    },
    {
      type: 'create',
      path: 'src/main.tsx',
      content: "import React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport App from './App';\nimport './index.css';\ncreateRoot(document.getElementById('root')!).render(<App />);"
    },
    {
      type: 'create',
      path: 'src/App.tsx',
      content: "export default function App() { return <main data-testid=\"generated-app\">Generated app</main>; }"
    },
    {
      type: 'create',
      path: 'src/index.css',
      content: 'body { margin: 0; font-family: sans-serif; }'
    }
  ],
  dependencies: {},
  devDependencies: {}
};

const deterministicRepair: GenerationResult = {
  message: 'Repaired the deterministic application',
  operations: [{
    type: 'update',
    path: 'src/App.tsx',
    content: "export default function App() { return <main data-testid=\"generated-app\">Repaired app</main>; }"
  }],
  dependencies: {},
  devDependencies: {}
};

export const createFakeModelClient = (): FakeModelClient => {
  const calls = { plan: 0, generate: 0, repair: 0 };
  return {
    calls,
    generatePlan: async () => {
      calls.plan += 1;
      return { value: deterministicPlan };
    },
    generateFiles: async () => {
      calls.generate += 1;
      return { value: deterministicGeneration };
    },
    repairFiles: async () => {
      calls.repair += 1;
      return { value: deterministicRepair };
    }
  };
};
