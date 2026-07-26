import { spawn } from 'node:child_process';

const projectName = process.env.SMOKE_PROJECT_NAME ??
  `phase6-${process.pid}-${Date.now()}`;
const composeArgs = [
  'compose',
  '-p', projectName,
  '-f', 'docker-compose.yml',
  '-f', 'docker-compose.smoke.yml'
];

const run = (
  executable: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env
): Promise<void> => new Promise((resolve, reject) => {
  const child = spawn(executable, args, {
    cwd: process.cwd(),
    env,
    stdio: 'inherit',
    shell: false
  });
  child.once('error', reject);
  child.once('exit', (code, signal) => {
    if (code === 0) {
      resolve();
      return;
    }
    reject(new Error(
      `${executable} ${args.join(' ')} exited with ${signal ?? code}`
    ));
  });
});

const smokeEnv: NodeJS.ProcessEnv = {
  ...process.env,
  SMOKE_API_URL: process.env.SMOKE_API_URL ?? 'http://127.0.0.1:43001',
  SMOKE_WEB_URL: process.env.SMOKE_WEB_URL ?? 'http://127.0.0.1:4173'
};

const main = async (): Promise<void> => {
  let failed = false;
  try {
    await run('docker', [...composeArgs, 'up', '-d', '--build', '--wait'], smokeEnv);
    await run('npm', ['run', 'test:smoke:api'], smokeEnv);
    await run('docker', [
      ...composeArgs,
      'exec',
      '-T',
      '-e', 'SMOKE_LEGACY_STYLING_SEED=true',
      'server',
      'node',
      'dist/testing/seedLegacyStylingSmoke.js'
    ], smokeEnv);
    await run('npm', ['run', 'test:smoke:browser'], smokeEnv);
  } catch (error) {
    failed = true;
    console.error(error);
    await run('docker', [...composeArgs, 'logs', '--no-color'], smokeEnv)
      .catch((logsError: unknown) => console.error('Unable to collect Compose logs:', logsError));
  } finally {
    await run(
      'docker',
      [...composeArgs, 'down', '--volumes', '--remove-orphans'],
      smokeEnv
    ).catch((cleanupError: unknown) => {
      failed = true;
      console.error('Unable to clean up smoke Compose project:', cleanupError);
    });
  }

  if (failed) process.exitCode = 1;
};

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
