import type { SandboxReconcileResult } from './SandboxReconciler';

interface SandboxReconcilerRunner {
  reconcile(): Promise<SandboxReconcileResult>;
}

export interface SandboxReconcilerLoop {
  reconcileNow(): Promise<void>;
  close(): Promise<void>;
}

interface StartSandboxReconcilerLoopOptions {
  reconciler: SandboxReconcilerRunner;
  intervalMs: number;
  onResult?: (result: SandboxReconcileResult) => void;
  onError?: (error: unknown) => void;
}

export const startSandboxReconcilerLoop = (
  options: StartSandboxReconcilerLoopOptions
): SandboxReconcilerLoop => {
  if (!Number.isSafeInteger(options.intervalMs) || options.intervalMs <= 0) {
    throw new Error(
      'Sandbox Reconciler interval must be a positive safe integer'
    );
  }

  let closed = false;
  let inFlight: Promise<void> | undefined;
  const reconcileNow = (): Promise<void> => {
    if (closed) return Promise.resolve();
    if (inFlight) return inFlight;

    const task = options.reconciler
      .reconcile()
      .then((result) => {
        try {
          options.onResult?.(result);
        } catch {
          // Observability callbacks must not stop reconciliation.
        }
      })
      .catch((error) => {
        try {
          options.onError?.(error);
        } catch {
          // Observability callbacks must not stop reconciliation.
        }
      })
      .finally(() => {
        if (inFlight === task) inFlight = undefined;
      });
    inFlight = task;
    return task;
  };

  const timer = setInterval(() => void reconcileNow(), options.intervalMs);
  timer.unref();

  return {
    reconcileNow,
    close: async () => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      await inFlight;
    }
  };
};
