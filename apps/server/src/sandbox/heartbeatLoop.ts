export interface SandboxHeartbeatLoop {
  heartbeatNow(): Promise<void>;
  close(): Promise<void>;
}

interface StartSandboxHeartbeatLoopOptions {
  heartbeat(): Promise<void>;
  intervalMs: number;
  onError(error: unknown): void;
}

export const startSandboxHeartbeatLoop = (
  options: StartSandboxHeartbeatLoopOptions
): SandboxHeartbeatLoop => {
  if (!Number.isSafeInteger(options.intervalMs) || options.intervalMs <= 0) {
    throw new Error(
      'Sandbox heartbeat interval must be a positive safe integer'
    );
  }

  let closed = false;
  let inFlight: Promise<void> | undefined;
  const heartbeatNow = (): Promise<void> => {
    if (closed) return Promise.resolve();
    if (inFlight) return inFlight;
    const task = options.heartbeat().finally(() => {
      if (inFlight === task) inFlight = undefined;
    });
    inFlight = task;
    return task;
  };
  const runScheduled = () => {
    void heartbeatNow().catch((error) => {
      try {
        options.onError(error);
      } catch {
        // The command owner observes its AbortSignal separately.
      }
    });
  };
  const timer = setInterval(runScheduled, options.intervalMs);
  timer.unref();

  return {
    heartbeatNow,
    close: async () => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      await inFlight?.catch(() => undefined);
    }
  };
};
