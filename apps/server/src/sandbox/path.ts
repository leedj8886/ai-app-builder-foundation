import nodePath from 'node:path';
import { SandboxError } from './errors';

const denied = (message: string): never => {
  throw new SandboxError('SANDBOX_POLICY_DENIED', message);
};

export const normalizeSandboxRelativePath = (candidate: string): string => {
  if (candidate.includes('\0')) denied('Sandbox path contains a NUL byte');

  const normalized = candidate.replaceAll('\\', '/');
  if (
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:/.test(normalized)
  ) {
    denied('Sandbox path must be relative');
  }

  const segments = normalized.split('/');
  if (
    segments.some(
      (segment) =>
        segment.length === 0 || segment === '.' || segment === '..'
    )
  ) {
    denied('Sandbox path contains an unsafe segment');
  }

  return segments.join('/');
};

export const resolveSandboxPath = (
  root: string,
  candidate: string
): string => {
  const canonicalRoot = nodePath.resolve(root);
  const resolved = nodePath.resolve(
    canonicalRoot,
    normalizeSandboxRelativePath(candidate)
  );
  const relative = nodePath.relative(canonicalRoot, resolved);

  if (
    relative.length === 0 ||
    relative === '..' ||
    relative.startsWith(`..${nodePath.sep}`) ||
    nodePath.isAbsolute(relative)
  ) {
    denied('Sandbox path escapes its root');
  }
  return resolved;
};
