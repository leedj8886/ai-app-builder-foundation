import type { AgentRunStatus } from './types';

export interface RunCancellationMonitor {
  signal: AbortSignal;
  checkNow(): Promise<void>;
  close(): Promise<void>;
}

interface StartRunCancellationMonitorOptions {
  loadStatus(): Promise<AgentRunStatus | undefined>;
  intervalMs?: number;
}

export const runCancelledError = (): Error & { code: 'RUN_CANCELLED' } =>
  Object.assign(new Error('Agent run cancelled'), {
    code: 'RUN_CANCELLED' as const
  });

export const abortReason = (signal: AbortSignal): unknown =>
  signal.reason ?? runCancelledError();

export const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw abortReason(signal);
};

export const startRunCancellationMonitor = (
  options: StartRunCancellationMonitorOptions
): RunCancellationMonitor => {
  const intervalMs = options.intervalMs ?? 500;
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
    throw new Error(
      'Run cancellation interval must be a positive safe integer'
    );
  }

  const controller = new AbortController();
  let closed = false;
  let inFlight: Promise<void> | undefined;
  const checkNow = (): Promise<void> => {
    if (closed || controller.signal.aborted) return Promise.resolve();
    if (inFlight) return inFlight;
    const task = options.loadStatus()
      .then((status) => {
        if (status === 'cancelled' && !controller.signal.aborted) {
          controller.abort(runCancelledError());
        }
      })
      .catch(() => {
        // A transient status-read failure is retried on the next interval.
      })
      .finally(() => {
        if (inFlight === task) inFlight = undefined;
      });
    inFlight = task;
    return task;
  };

  const timer = setInterval(() => void checkNow(), intervalMs);
  timer.unref();
  void checkNow();

  return {
    signal: controller.signal,
    checkNow,
    close: async () => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      await inFlight;
    }
  };
};
