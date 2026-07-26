import { ValidationErrorCategory } from '../types';

interface RetryableError extends Error {
  category?: ValidationErrorCategory;
}

interface InfrastructureRetryInput<T> {
  retryDelaysMs: number[];
  operation(attempt: number): Promise<T>;
  delay?: (durationMs: number) => Promise<void>;
  onRetry?: (
    error: RetryableError,
    attempt: number,
    delayMs: number
  ) => void | Promise<void>;
}

const defaultDelay = (durationMs: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, durationMs));

export const runWithInfrastructureRetry = async <T>(
  input: InfrastructureRetryInput<T>
): Promise<T> => {
  const wait = input.delay ?? defaultDelay;

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await input.operation(attempt);
    } catch (error) {
      const candidate = error as RetryableError;
      const retryDelayMs = input.retryDelaysMs[attempt];
      if (
        candidate.category !== 'INFRA_ERROR' ||
        retryDelayMs === undefined
      ) {
        throw error;
      }
      await input.onRetry?.(candidate, attempt + 1, retryDelayMs);
      await wait(retryDelayMs);
    }
  }
};
