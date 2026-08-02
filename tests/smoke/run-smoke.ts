import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

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

type SmokeSuite = 'core' | 'external' | 'all';

const parseSuite = (): SmokeSuite => {
  const suiteIndex = process.argv.indexOf('--suite');
  if (suiteIndex === -1) return 'core';
  const suite = process.argv[suiteIndex + 1];
  if (suite === 'core' || suite === 'external' || suite === 'all') return suite;
  throw new Error('--suite must be one of: core, external, all');
};

const configuredPort = (name: 'SMOKE_API_PORT' | 'SMOKE_WEB_PORT'): string | undefined => {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }
  return String(port);
};

const allocateLoopbackPort = (): Promise<string> => new Promise((resolve, reject) => {
  const server = createServer();
  server.unref();
  server.once('error', reject);
  server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      reject(new Error('Unable to allocate a loopback port'));
      return;
    }
    server.close(error => {
      if (error) reject(error);
      else resolve(String(address.port));
    });
  });
});

const createSmokeEnv = async (): Promise<NodeJS.ProcessEnv> => {
  const apiPort = configuredPort('SMOKE_API_PORT') ?? await allocateLoopbackPort();
  let webPort = configuredPort('SMOKE_WEB_PORT') ?? await allocateLoopbackPort();
  while (webPort === apiPort) webPort = await allocateLoopbackPort();

  return {
    ...process.env,
    SMOKE_API_PORT: apiPort,
    SMOKE_WEB_PORT: webPort,
    SMOKE_API_URL: process.env.SMOKE_API_URL ?? `http://127.0.0.1:${apiPort}`,
    SMOKE_WEB_URL: process.env.SMOKE_WEB_URL ?? `http://127.0.0.1:${webPort}`
  };
};

const seedLegacyStylingSnapshot = async (smokeEnv: NodeJS.ProcessEnv): Promise<void> => {
  await run('docker', [
    ...composeArgs,
    'exec',
    '-T',
    '-e', 'SMOKE_LEGACY_STYLING_SEED=true',
    'server',
    'node',
    'dist/testing/seedLegacyStylingSmoke.js'
  ], smokeEnv);
};

const main = async (): Promise<void> => {
  const suite = parseSuite();
  const smokeEnv = await createSmokeEnv();
  let failed = false;
  try {
    await run('docker', [...composeArgs, 'up', '-d', '--build', '--wait'], smokeEnv);
    if (suite === 'core' || suite === 'all') {
      await run('npm', ['run', 'test:smoke:api'], smokeEnv);
      await run('npm', ['run', 'test:smoke:browser'], smokeEnv);
    }
    if (suite === 'external' || suite === 'all') {
      await seedLegacyStylingSnapshot(smokeEnv);
      await run('npm', ['run', 'test:smoke:browser:external'], smokeEnv);
    }
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
