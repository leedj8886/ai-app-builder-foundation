export type SandboxErrorCode =
  | 'SANDBOX_PROVIDER_UNAVAILABLE'
  | 'SANDBOX_SCHEDULER_UNAVAILABLE'
  | 'SANDBOX_CAPABILITY_MISSING'
  | 'SANDBOX_QUOTA_EXCEEDED'
  | 'SANDBOX_BRANCH_BUSY'
  | 'SANDBOX_NOT_FOUND'
  | 'SANDBOX_INVALID_STATE'
  | 'SANDBOX_SOURCE_UNAVAILABLE'
  | 'SANDBOX_PROVISION_FAILED'
  | 'SANDBOX_NOT_READY'
  | 'SANDBOX_COMMAND_FAILED'
  | 'SANDBOX_COMMAND_TIMEOUT'
  | 'SANDBOX_OUTPUT_LIMIT'
  | 'SANDBOX_LOST'
  | 'SANDBOX_POLICY_DENIED'
  | 'SANDBOX_OWNERSHIP_MISMATCH';

export class SandboxError extends Error {
  constructor(
    public readonly code: SandboxErrorCode,
    message: string,
    public readonly retryable = false,
    public readonly cause?: unknown
  ) {
    super(`${code}: ${message}`);
    this.name = 'SandboxError';
  }
}

export type SandboxCreateOutcome = 'not-created' | 'unknown';

export class SandboxCreateError extends SandboxError {
  constructor(
    code: Extract<
      SandboxErrorCode,
      'SANDBOX_PROVIDER_UNAVAILABLE' | 'SANDBOX_PROVISION_FAILED'
    >,
    message: string,
    retryable: boolean,
    public readonly outcome: SandboxCreateOutcome,
    cause?: unknown
  ) {
    super(code, message, retryable, cause);
    this.name = 'SandboxCreateError';
  }
}

export const isSandboxError = (error: unknown): error is SandboxError =>
  error instanceof SandboxError;

export const isRetryableSandboxError = (
  error: unknown
): error is SandboxError =>
  isSandboxError(error) && error.retryable;
