import path from 'node:path';
import { Types } from 'mongoose';
import {
  FileOperation,
  ProjectFile,
  ProjectFileLanguage
} from './types';
import { ProfileError } from './profiles/errors';

const supportedExtensions: Record<string, ProjectFileLanguage> = {
  '.ts': 'ts',
  '.tsx': 'tsx',
  '.js': 'js',
  '.cjs': 'js',
  '.mjs': 'js',
  '.css': 'css',
  '.json': 'json',
  '.html': 'html',
  '.md': 'md',
  '.prisma': 'prisma',
  '.sql': 'sql'
};

const requiredTemplateFiles = new Set([
  'package.json',
  'index.html',
  'postcss.config.cjs',
  'tailwind.config.js',
  'src/main.tsx'
]);

export const inferProjectFileLanguage = (filePath: string): ProjectFileLanguage => {
  const extension = path.posix.extname(filePath);
  const language = supportedExtensions[extension];

  if (!language) {
    throw new ProfileError(
      'PROFILE_UNSUPPORTED_FILE_TYPE',
      `Unsupported file extension: ${filePath}`
    );
  }

  return language;
};

export const normalizeProjectPath = (rawPath: string): string => {
  const trimmedPath = rawPath.trim();
  if (
    trimmedPath.includes('\0') ||
    path.posix.isAbsolute(trimmedPath) ||
    path.win32.isAbsolute(trimmedPath)
  ) {
    throw new Error(`Project file path must be a relative path: ${rawPath}`);
  }

  const portablePath = trimmedPath.replace(/\\/g, '/');
  if (portablePath.split('/').includes('..')) {
    throw new Error(`Project file path cannot escape the project root: ${rawPath}`);
  }
  const normalized = path.posix.normalize(portablePath);

  if (normalized === '.' || normalized.startsWith('../') || normalized === '..') {
    throw new Error(`Project file path cannot escape the project root: ${rawPath}`);
  }

  return normalized;
};

export const isSupportedProjectPath = (rawPath: string): boolean => {
  try {
    inferProjectFileLanguage(normalizeProjectPath(rawPath));
    return true;
  } catch {
    return false;
  }
};

const assertTextContent = (filePath: string, content: string): void => {
  if (content.includes('\0')) {
    throw new Error(`Project file content cannot be binary: ${filePath}`);
  }
};

export const applyFileOperations = (
  baseFiles: ProjectFile[],
  operations: FileOperation[],
  generatedByRunId?: Types.ObjectId
): ProjectFile[] => {
  const filesByPath = new Map<string, ProjectFile>();

  for (const file of baseFiles) {
    const normalized = normalizeProjectPath(file.path);
    filesByPath.set(normalized, {
      ...file,
      path: normalized,
      language: inferProjectFileLanguage(normalized)
    });
  }

  for (const operation of operations) {
    const normalized = normalizeProjectPath(operation.path);
    inferProjectFileLanguage(normalized);

    if (operation.type === 'delete') {
      if (requiredTemplateFiles.has(normalized)) {
        throw new Error(`Cannot delete required file: ${normalized}`);
      }

      filesByPath.delete(normalized);
      continue;
    }

    assertTextContent(normalized, operation.content);
    filesByPath.set(normalized, {
      path: normalized,
      content: operation.content,
      language: inferProjectFileLanguage(normalized),
      generatedByRunId
    });
  }

  return [...filesByPath.values()].sort((left, right) => left.path.localeCompare(right.path));
};
