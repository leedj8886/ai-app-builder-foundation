import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  applyFileOperations,
  inferProjectFileLanguage,
  normalizeProjectPath
} from '../fileOperations';
import type { FileOperation, ProjectFile } from '../types';
import { ProfileError } from './errors';
import type { EditablePathPolicy, ProjectProfile } from './types';

const matchesPattern = (filePath: string, pattern: string): boolean => {
  if (pattern === '**/*') return true;
  if (pattern.endsWith('/**')) {
    const prefixPattern = pattern.slice(0, -3);
    const prefixSegments = prefixPattern.split('/').length;
    const fileSegments = filePath.split('/');
    return fileSegments.length > prefixSegments && matchesPattern(
      fileSegments.slice(0, prefixSegments).join('/'),
      prefixPattern
    );
  }

  const expression = pattern
    .split('*')
    .map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]*');
  return new RegExp(`^${expression}$`).test(filePath);
};

const matchesAny = (filePath: string, patterns: readonly string[]): boolean =>
  patterns.some(pattern => matchesPattern(filePath, pattern));

const immutableDirectories = (
  baseFiles: ProjectFile[],
  policy: EditablePathPolicy
): Set<string> => {
  const patterns = policy.immutableExistingDirectoryPatterns ?? [];
  const directories = new Set<string>();
  for (const file of baseFiles) {
    const normalized = normalizeProjectPath(file.path);
    let directory = path.posix.dirname(normalized);
    while (directory !== '.') {
      if (matchesAny(directory, patterns)) directories.add(directory);
      directory = path.posix.dirname(directory);
    }
  }
  return directories;
};

const isInsideDirectory = (filePath: string, directory: string): boolean =>
  filePath === directory || filePath.startsWith(`${directory}/`);

const validateOperation = (
  operation: FileOperation,
  policy: EditablePathPolicy,
  immutableBaseDirectories: ReadonlySet<string>
): void => {
  const normalized = normalizeProjectPath(operation.path);
  inferProjectFileLanguage(normalized);

  if (normalized === 'package.json') {
    throw new ProfileError(
      'PROFILE_SCRIPT_MODIFIED',
      'package.json scripts are managed by the selected Project Profile'
    );
  }
  if (
    matchesAny(normalized, policy.platformManagedPathPatterns) ||
    [...immutableBaseDirectories].some(directory =>
      isInsideDirectory(normalized, directory)
    )
  ) {
    throw new ProfileError(
      'PROFILE_PLATFORM_FILE_MODIFIED',
      `Project Profile platform file cannot be modified: ${normalized}`
    );
  }
  if (
    !matchesAny(normalized, policy.editablePathPatterns) ||
    (operation.type === 'delete' && policy.protectedDeletePaths.includes(normalized))
  ) {
    throw new ProfileError(
      'PROFILE_PATH_DENIED',
      `Project Profile does not allow this file operation: ${normalized}`
    );
  }
};

export const validateProfileFileOperations = (
  profile: ProjectProfile,
  baseFiles: ProjectFile[],
  operations: FileOperation[]
): void => {
  const policy = profile.editablePathPolicy();
  const immutableBaseDirectories = immutableDirectories(baseFiles, policy);

  // Validate the complete batch before applying any operation.
  for (const operation of operations) {
    validateOperation(operation, policy, immutableBaseDirectories);
  }
};

const contentDigest = (content: string): string =>
  createHash('sha256').update(content, 'utf8').digest('hex');

export const assertProfilePlatformFilesUnchanged = (
  profile: ProjectProfile,
  baseFiles: ProjectFile[],
  candidateFiles: ProjectFile[]
): void => {
  const patterns = profile.editablePathPolicy().platformManagedPathPatterns;
  const candidateByPath = new Map(candidateFiles.map(file => [
    normalizeProjectPath(file.path),
    contentDigest(file.content)
  ]));

  for (const baseFile of baseFiles) {
    const normalized = normalizeProjectPath(baseFile.path);
    if (
      matchesAny(normalized, patterns) &&
      candidateByPath.get(normalized) !== contentDigest(baseFile.content)
    ) {
      throw new ProfileError(
        'PROFILE_PLATFORM_FILE_MODIFIED',
        `Project Profile platform file content changed: ${normalized}`
      );
    }
  }
};

export const applyProfileFileOperations = (
  profile: ProjectProfile,
  baseFiles: ProjectFile[],
  operations: FileOperation[],
  generatedByRunId?: import('mongoose').Types.ObjectId
): ProjectFile[] => {
  validateProfileFileOperations(profile, baseFiles, operations);
  const candidateFiles = applyFileOperations(
    baseFiles,
    operations,
    generatedByRunId
  );
  assertProfilePlatformFilesUnchanged(profile, baseFiles, candidateFiles);
  return candidateFiles;
};

export const pathMatchesProfilePattern = matchesPattern;
