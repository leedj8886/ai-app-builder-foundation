import { createHash } from 'node:crypto';

interface DependencyFingerprintInput {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  lockfile?: string;
  nodeVersion: string;
  npmVersion: string;
  platform: string;
  arch: string;
}

const sortRecord = (
  value: Record<string, string>
): Record<string, string> => Object.fromEntries(
  Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
);

export const dependencyFingerprint = (
  input: DependencyFingerprintInput
): string => createHash('sha256').update(JSON.stringify({
  schemaVersion: 1,
  dependencies: sortRecord(input.dependencies),
  devDependencies: sortRecord(input.devDependencies),
  lockfile: input.lockfile ?? null,
  nodeVersion: input.nodeVersion,
  npmVersion: input.npmVersion,
  platform: input.platform,
  arch: input.arch
})).digest('hex');
