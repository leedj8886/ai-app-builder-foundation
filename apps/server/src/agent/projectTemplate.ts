import { ProjectFile } from './types';

export const createProjectTemplateFiles = (): ProjectFile[] => [
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

export const resolveProjectBaseFiles = (
  snapshotFiles: ProjectFile[] | undefined
): ProjectFile[] => snapshotFiles ?? createProjectTemplateFiles();
