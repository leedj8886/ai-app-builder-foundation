import { spawn } from 'node:child_process';

export interface RunCommandInput {
  executable: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  maxOutputChars: number;
  env?: NodeJS.ProcessEnv;
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
): Promise<CommandResult> => new Promise(resolve => {
  const startedAt = Date.now();
  let stdout = '';
  let stderr = '';
  let timedOut = false;
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

  const finish = (exitCode: number) => {
    if (settled) {
      return;
    }

    settled = true;
    clearTimeout(timer);
    resolve({
      exitCode,
      stdout,
      stderr,
      durationMs: Date.now() - startedAt
    });
  };

  child.on('error', error => {
    stderr = appendBounded(
      stderr,
      `Command failed to start: ${error.message}`,
      input.maxOutputChars
    );
    finish(1);
  });
  child.on('close', (code, signal) => {
    if (timedOut) {
      const message = `Command timed out after ${input.timeoutMs}ms`;
      stderr = `${stderr.slice(0, Math.max(0, input.maxOutputChars - message.length))}${message}`;
      finish(124);
      return;
    }

    finish(code ?? (signal ? 1 : 0));
  });

  const timer = setTimeout(() => {
    timedOut = true;
    if (process.platform !== 'win32' && child.pid) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    } else {
      child.kill('SIGKILL');
    }
  }, input.timeoutMs);
});
