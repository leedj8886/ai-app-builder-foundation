import path from 'node:path';
import {
  ProjectFile,
  ValidationErrorCategory
} from '../types';

export interface StructureCheckResult {
  status: 'passed' | 'failed';
  category?: ValidationErrorCategory;
  stdout: string;
  stderr: string;
}

const requiredPaths = ['package.json', 'index.html', 'src/App.tsx'];
const acceptedMainPaths = new Set(['src/main.tsx', 'src/index.tsx']);

const failure = (
  category: ValidationErrorCategory,
  stderr: string
): StructureCheckResult => ({
  status: 'failed',
  category,
  stdout: '',
  stderr
});

export const validateProjectStructure = (
  files: ProjectFile[]
): StructureCheckResult => {
  const paths = new Set<string>();

  for (const file of files) {
    const normalized = path.posix.normalize(file.path.replace(/\\/g, '/'));
    if (
      path.posix.isAbsolute(normalized) ||
      normalized === '..' ||
      normalized.startsWith('../')
    ) {
      return failure('CODE_ERROR', `Unsafe project file path: ${file.path}`);
    }
    if (paths.has(normalized)) {
      return failure('CODE_ERROR', `Duplicate project file path: ${normalized}`);
    }
    paths.add(normalized);
  }

  const missing = requiredPaths.find(required => !paths.has(required));
  if (missing) {
    return failure('CODE_ERROR', `Required project file is missing: ${missing}`);
  }
  if (![...acceptedMainPaths].some(candidate => paths.has(candidate))) {
    return failure(
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
    return failure('DEPENDENCY_ERROR', 'package.json is not valid JSON');
  }

  for (const script of ['type-check', 'build']) {
    if (typeof packageJson.scripts?.[script] !== 'string') {
      return failure(
        'DEPENDENCY_ERROR',
        `package.json is missing the required ${script} script`
      );
    }
  }
  for (const dependency of ['react', 'react-dom']) {
    if (typeof packageJson.dependencies?.[dependency] !== 'string') {
      return failure(
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
