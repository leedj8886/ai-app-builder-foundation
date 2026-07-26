import { createHash } from 'node:crypto';
import {
  ValidationErrorCategory,
  ValidationPhase,
  ValidationResult
} from '../types';

interface FailureDiagnostic {
  phase: ValidationPhase;
  exitCode?: number;
  stdout: string;
  stderr: string;
}

const infrastructurePatterns = [
  /timed out/i,
  /EAI_AGAIN/i,
  /ENOTFOUND/i,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /ETIMEDOUT/i,
  /\b50[0234]\b/
];

const dependencyPatterns = [
  /\bE404\b/i,
  /\bERESOLVE\b/i,
  /No matching version found/i,
  /lock file.*out of sync/i
];

export const classifyValidationFailure = (
  diagnostic: FailureDiagnostic
): ValidationErrorCategory => {
  const output = `${diagnostic.stdout}\n${diagnostic.stderr}`;
  if (
    diagnostic.exitCode === 124 ||
    infrastructurePatterns.some(pattern => pattern.test(output))
  ) {
    return 'INFRA_ERROR';
  }
  if (diagnostic.phase === 'dependencies') {
    return dependencyPatterns.some(pattern => pattern.test(output))
      ? 'DEPENDENCY_ERROR'
      : 'DEPENDENCY_ERROR';
  }
  return 'CODE_ERROR';
};

const normalizeDiagnostic = (value: string): string => value
  .replace(/\/tmp\/v0-agent-runs\/[^\s/]+/g, '<workspace>')
  .replace(/timed out after \d+ms/gi, 'timed out')
  .replace(/\b\d+(?:\.\d+)?ms\b/gi, '<duration>')
  .replace(/\s+/g, ' ')
  .trim();

export const diagnosticFingerprint = (
  input: FailureDiagnostic | ValidationResult
): string => {
  const diagnostics = 'checks' in input
    ? input.checks.map(check => ({
      phase: check.phase ?? check.name,
      exitCode: check.exitCode,
      stdout: normalizeDiagnostic(check.stdout),
      stderr: normalizeDiagnostic(check.stderr)
    }))
    : [{
      phase: input.phase,
      exitCode: input.exitCode,
      stdout: normalizeDiagnostic(input.stdout),
      stderr: normalizeDiagnostic(input.stderr)
    }];

  return createHash('sha256')
    .update(JSON.stringify(diagnostics))
    .digest('hex');
};
