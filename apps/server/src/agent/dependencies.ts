import { ProjectSnapshotPackageJson } from './types';

interface GeneratedDependencies {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

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

export const mergeProjectPackageJson = (
  base: ProjectSnapshotPackageJson | undefined,
  generated: GeneratedDependencies
): ProjectSnapshotPackageJson => ({
  dependencies: sortRecord({
    ...requiredDependencies,
    ...recordFrom(base?.dependencies),
    ...generated.dependencies
  }),
  devDependencies: sortRecord({
    ...requiredDevDependencies,
    ...recordFrom(base?.devDependencies),
    ...generated.devDependencies
  }),
  scripts: {
    dev: 'vite',
    'type-check': 'tsc --noEmit',
    build: 'tsc && vite build'
  }
});
