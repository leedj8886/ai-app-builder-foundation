import path from 'node:path';
import type {
  ProjectFile,
  ProjectSnapshotPackageJson,
  ValidationErrorCategory
} from '../types';
import {
  createPostcssConfig,
  createTailwindConfig
} from '../styling/tailwindAdapter';
import type {
  ProfilePackageInput,
  ProfileRef,
  ProfileStructureResult,
  ProjectProfile
} from './types';

export const STATIC_REACT_PROFILE_REF = {
  id: 'static-react',
  version: 1
} as const satisfies ProfileRef;

const protectedDeletePaths = [
  'package.json',
  'index.html',
  'postcss.config.cjs',
  'tailwind.config.js',
  'src/main.tsx'
] as const;

const requiredDependencies = {
  react: '^18.2.0',
  'react-dom': '^18.2.0'
};

const requiredDevDependencies = {
  '@types/react': '^18.2.0',
  '@types/react-dom': '^18.2.0',
  '@vitejs/plugin-react': '^4.3.0',
  autoprefixer: '^10.4.20',
  postcss: '^8.4.49',
  tailwindcss: '^3.4.17',
  typescript: '^5.4.0',
  vite: '^5.4.0'
};

const sortRecord = (
  value: Record<string, string>
): Record<string, string> => Object.fromEntries(
  Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
);

const recordFrom = (
  value: Record<string, string> | Map<string, string> | undefined
): Record<string, string> => value instanceof Map
  ? Object.fromEntries(value)
  : value ?? {};

const createTemplate = (): ProjectFile[] => [
  {
    path: 'index.html',
    language: 'html',
    content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Generated App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`
  },
  {
    path: 'postcss.config.cjs',
    language: 'js',
    content: createPostcssConfig()
  },
  {
    path: 'src/App.tsx',
    language: 'tsx',
    content: `export default function App() {
  return <main>Start building your application.</main>;
}
`
  },
  {
    path: 'src/index.css',
    language: 'css',
    content: `@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  font-family: Inter, ui-sans-serif, system-ui, sans-serif;
  color: #171717;
  background: #ffffff;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-width: 320px;
  min-height: 100vh;
}
`
  },
  {
    path: 'src/main.tsx',
    language: 'tsx',
    content: `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`
  },
  {
    path: 'tailwind.config.js',
    language: 'js',
    content: createTailwindConfig()
  },
  {
    path: 'tsconfig.json',
    language: 'json',
    content: `{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Node",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx"
  },
  "include": ["src"]
}
`
  }
];

const mergePackageJson = (
  input: ProfilePackageInput
): ProjectSnapshotPackageJson => ({
  dependencies: sortRecord({
    ...requiredDependencies,
    ...recordFrom(input.base?.dependencies),
    ...input.generated.dependencies
  }),
  devDependencies: sortRecord({
    ...requiredDevDependencies,
    ...recordFrom(input.base?.devDependencies),
    ...input.generated.devDependencies
  }),
  scripts: {
    dev: 'vite',
    'type-check': 'tsc --noEmit',
    build: 'tsc && vite build'
  }
});

const requiredPaths = ['package.json', 'index.html', 'src/App.tsx'];
const acceptedMainPaths = new Set(['src/main.tsx', 'src/index.tsx']);

const structureFailure = (
  category: ValidationErrorCategory,
  stderr: string
): ProfileStructureResult => ({
  status: 'failed',
  category,
  stdout: '',
  stderr
});

const validateStructure = (files: ProjectFile[]): ProfileStructureResult => {
  const paths = new Set<string>();

  for (const file of files) {
    const normalized = path.posix.normalize(file.path.replace(/\\/g, '/'));
    if (
      path.posix.isAbsolute(normalized) ||
      normalized === '..' ||
      normalized.startsWith('../')
    ) {
      return structureFailure('CODE_ERROR', `Unsafe project file path: ${file.path}`);
    }
    if (paths.has(normalized)) {
      return structureFailure('CODE_ERROR', `Duplicate project file path: ${normalized}`);
    }
    paths.add(normalized);
  }

  const missing = requiredPaths.find(required => !paths.has(required));
  if (missing) {
    return structureFailure('CODE_ERROR', `Required project file is missing: ${missing}`);
  }
  if (![...acceptedMainPaths].some(candidate => paths.has(candidate))) {
    return structureFailure(
      'CODE_ERROR',
      'Required React entry is missing: src/main.tsx or src/index.tsx'
    );
  }

  const packageFile = files.find(file => file.path === 'package.json')!;
  let packageJson: {
    scripts?: Record<string, unknown>;
    dependencies?: Record<string, unknown>;
  };
  try {
    packageJson = JSON.parse(packageFile.content);
  } catch {
    return structureFailure('DEPENDENCY_ERROR', 'package.json is not valid JSON');
  }

  for (const script of ['type-check', 'build']) {
    if (typeof packageJson.scripts?.[script] !== 'string') {
      return structureFailure(
        'DEPENDENCY_ERROR',
        `package.json is missing the required ${script} script`
      );
    }
  }
  for (const dependency of ['react', 'react-dom']) {
    if (typeof packageJson.dependencies?.[dependency] !== 'string') {
      return structureFailure(
        'DEPENDENCY_ERROR',
        `package.json is missing the required ${dependency} dependency`
      );
    }
  }

  return {
    status: 'passed',
    stdout: 'Project structure is valid',
    stderr: ''
  };
};

export const staticReactProfile: ProjectProfile = {
  ref: STATIC_REACT_PROFILE_REF,
  createTemplate,
  editablePathPolicy: () => ({
    editablePathPatterns: ['**/*'],
    platformManagedPathPatterns: [],
    protectedDeletePaths: [...protectedDeletePaths]
  }),
  mergePackageJson,
  generationDescriptor: () => ({
    capabilities: [
      'React 18 functional components',
      'TypeScript and TSX browser code',
      'Tailwind CSS styling',
      'Vite static application build'
    ],
    instructions: [
      'Generate only React functional components written in TypeScript or TSX.',
      'Use Tailwind CSS for styling and target a Vite browser application.',
      'Do not generate server files, binary files, shell commands, or scripts.'
    ].join(' ')
  }),
  validateStructure,
  validationPipeline: () => [
    { id: 'structure', phase: 'structure' },
    { id: 'install', phase: 'dependencies' },
    { id: 'type-check', phase: 'type-check' },
    { id: 'build', phase: 'build' }
  ],
  runtimeDescriptor: () => ({
    kind: 'static-artifact',
    buildOutputDirectory: 'dist',
    entryPath: 'index.html'
  })
};
