import { spawn } from 'node:child_process';
import { abortReason, throwIfAborted } from '../runCancellation';

export interface RunCommandInput {
  executable: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  maxOutputChars: number;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export const pickValidationEnvironment = (
  env: NodeJS.ProcessEnv
): NodeJS.ProcessEnv => {
  const allowed = [
    'PATH',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
    'NODE_EXTRA_CA_CERTS',
    'NPM_CONFIG_REGISTRY',
    'npm_config_registry'
  ];
  return Object.fromEntries(
    allowed.flatMap(key => env[key] === undefined ? [] : [[key, env[key]]])
  );
};

const appendBounded = (
  current: string,
  chunk: Buffer | string,
  limit: number
): string => {
  if (current.length >= limit) {
    return current;
  }

  return `${current}${chunk.toString()}`.slice(0, limit);
};

export const runCommand = (
  input: RunCommandInput
): Promise<CommandResult> => new Promise((resolve, reject) => {
  throwIfAborted(input.signal);
  const startedAt = Date.now();
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let aborted = false;
  let settled = false;
  const child = spawn(input.executable, input.args, {
    cwd: input.cwd,
    env: input.env ?? { PATH: process.env.PATH ?? '' },
    shell: false,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.stdout.on('data', chunk => {
    stdout = appendBounded(stdout, chunk, input.maxOutputChars);
  });
  child.stderr.on('data', chunk => {
    stderr = appendBounded(stderr, chunk, input.maxOutputChars);
  });

  let timer: ReturnType<typeof setTimeout>;
  const cleanup = () => {
    clearTimeout(timer);
    input.signal?.removeEventListener('abort', onAbort);
  };
  const finish = (exitCode: number) => {
    if (settled) {
      return;
    }

    settled = true;
    cleanup();
    resolve({
      exitCode,
      stdout,
      stderr,
      durationMs: Date.now() - startedAt
    });
  };
  const fail = (error: unknown) => {
    if (settled) return;
    settled = true;
    cleanup();
    reject(error);
  };
  const terminate = () => {
    if (process.platform !== 'win32' && child.pid) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    } else {
      child.kill('SIGKILL');
    }
  };
  const onAbort = () => {
    aborted = true;
    terminate();
  };

  child.on('error', error => {
    if (aborted) {
      fail(abortReason(input.signal!));
      return;
    }
    stderr = appendBounded(
      stderr,
      `Command failed to start: ${error.message}`,
      input.maxOutputChars
    );
    finish(1);
  });
  child.on('close', (code, signal) => {
    if (aborted) {
      fail(abortReason(input.signal!));
      return;
    }
    if (timedOut) {
      const message = `Command timed out after ${input.timeoutMs}ms`;
      stderr = `${stderr.slice(0, Math.max(0, input.maxOutputChars - message.length))}${message}`;
      finish(124);
      return;
    }

    finish(code ?? (signal ? 1 : 0));
  });

  timer = setTimeout(() => {
    timedOut = true;
    terminate();
  }, input.timeoutMs);
  input.signal?.addEventListener('abort', onAbort, { once: true });
  if (input.signal?.aborted) onAbort();
});
