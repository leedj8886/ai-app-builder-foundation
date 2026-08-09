import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PersistentDatabaseLease } from './persistentDatabase';

interface PreviewFile {
  path: string;
  content: string;
}

interface RunningPreview {
  root: string;
  api: ChildProcess;
  web: ChildProcess;
  url: string;
  apiUrl: string;
}

const port = async (): Promise<number> => new Promise((resolve, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      reject(new Error('Could not allocate a local preview port'));
      return;
    }
    server.close(() => resolve(address.port));
  });
});

const run = (
  executable: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs = 300_000
): Promise<void> => new Promise((resolve, reject) => {
  const child = spawn(executable, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false
  });
  let output = '';
  const append = (chunk: Buffer) => {
    output = `${output}${chunk.toString('utf8')}`.slice(-8_000);
  };
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  const timer = setTimeout(() => {
    child.kill('SIGTERM');
    reject(new Error(`Local full-stack command timed out: ${args.join(' ')}\n${output}`));
  }, timeoutMs);
  child.once('error', (error) => {
    clearTimeout(timer);
    reject(error);
  });
  child.once('exit', (code) => {
    clearTimeout(timer);
    if (code === 0) resolve();
    else reject(new Error(`Local full-stack command failed: ${args.join(' ')}\n${output}`));
  });
});

const stopProcess = (child: ChildProcess): void => {
  if (!child.killed) child.kill('SIGTERM');
};

const outputOf = (child: ChildProcess): { value: string } => {
  const output = { value: '' };
  const append = (chunk: Buffer) => {
    output.value = `${output.value}${chunk.toString('utf8')}`.slice(-8_000);
  };
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  return output;
};

const waitFor = async (url: string, timeoutMs = 30_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Local full-stack preview did not become ready: ${url}`, {
    cause: lastError
  });
};

const legacyApiProxy = "'/api': process.env.FULLSTACK_API_URL || 'http://localhost:3000'";
const localApiProxy = `'/api': {
        target: process.env.FULLSTACK_API_URL || 'http://localhost:3000',
        changeOrigin: true,
        configure: proxy => {
          proxy.on('proxyReq', proxyReq => {
            if (!proxyReq.getHeader('x-platform-user-id')) {
              proxyReq.setHeader(
                'x-platform-user-id',
                process.env.FULLSTACK_PREVIEW_USER_ID || 'preview-user'
              );
            }
          });
        }
      }`;

export const ensureLocalPreviewAuthProxy = (content: string): string =>
  content.includes(legacyApiProxy)
    ? content.replace(legacyApiProxy, localApiProxy)
    : content;

export class LocalFullstackPreviewService {
  private readonly previews = new Map<string, RunningPreview>();

  constructor(private readonly root = '/tmp/open-v0-fullstack-previews') {}

  async start(input: {
    projectId: string;
    snapshotId: string;
    files: PreviewFile[];
    database: PersistentDatabaseLease;
  }): Promise<{ url: string; apiUrl: string }> {
    await this.stop(input.projectId);
    const root = path.join(this.root, `${input.projectId}-${input.snapshotId}`);
    await mkdir(root, { recursive: true });
    for (const file of input.files) {
      const target = path.resolve(root, file.path);
      if (!target.startsWith(`${root}${path.sep}`)) {
        throw new Error('Generated preview file escapes its workspace');
      }
      await mkdir(path.dirname(target), { recursive: true });
      const content = file.path === 'apps/web/vite.config.ts'
        ? ensureLocalPreviewAuthProxy(file.content)
        : file.content;
      await writeFile(target, content, 'utf8');
    }

    const environment = {
      ...process.env,
      CI: 'true',
      NPM_CONFIG_PREFER_OFFLINE: 'true',
      DATABASE_URL: input.database.databaseUrl,
      SHADOW_DATABASE_URL: input.database.databaseUrl
    };
    try {
      await run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline'], root, environment);
      await run('npm', ['run', 'prisma:generate'], root, environment);
      await run('npm', ['exec', '--', 'prisma', 'migrate', 'deploy'], root, environment);
      const apiPort = await port();
      const webPort = await port();
      const api = spawn('npm', ['run', 'dev:api'], {
        cwd: root,
        env: { ...environment, PORT: String(apiPort) },
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false
      });
      const apiOutput = outputOf(api);
      try {
        await waitFor(`http://127.0.0.1:${apiPort}/health`);
      } catch (error) {
        throw new Error(`${error instanceof Error ? error.message : 'API preview failed'}\n${apiOutput.value}`);
      }
      const web = spawn('npm', ['run', 'dev:web', '--', '--host', '127.0.0.1', '--port', String(webPort)], {
        cwd: root,
        env: {
          ...environment,
          FULLSTACK_API_URL: `http://127.0.0.1:${apiPort}`,
          FULLSTACK_PREVIEW_USER_ID: 'preview-user'
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false
      });
      const webOutput = outputOf(web);
      try {
        await waitFor(`http://127.0.0.1:${webPort}/`);
      } catch (error) {
        throw new Error(`${error instanceof Error ? error.message : 'Web preview failed'}\n${webOutput.value}`);
      }
      const url = `http://127.0.0.1:${webPort}/`;
      const apiUrl = `http://127.0.0.1:${apiPort}`;
      this.previews.set(input.projectId, { root, api, web, url, apiUrl });
      return { url, apiUrl };
    } catch (error) {
      await rm(root, { recursive: true, force: true });
      throw error;
    }
  }

  async stop(projectId: string): Promise<void> {
    const preview = this.previews.get(projectId);
    if (!preview) return;
    stopProcess(preview.api);
    stopProcess(preview.web);
    this.previews.delete(projectId);
    await rm(preview.root, { recursive: true, force: true });
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.previews.keys()].map(projectId => this.stop(projectId)));
  }
}
