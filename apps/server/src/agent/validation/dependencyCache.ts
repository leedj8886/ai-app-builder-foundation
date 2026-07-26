import path from 'node:path';
import {
  access,
  mkdir,
  mkdtemp,
  open,
  rename,
  rm,
  symlink,
  unlink,
  writeFile
} from 'node:fs/promises';

export interface DependencyCache {
  prepare(input: {
    fingerprint: string;
    workspacePath: string;
    install(stagingPath: string): Promise<void>;
  }): Promise<{ cache: 'hit' | 'miss'; nodeModulesPath: string }>;
}

interface DependencyCacheOptions {
  root: string;
  pollIntervalMs?: number;
  lockTimeoutMs?: number;
  now?: () => number;
}

const exists = async (target: string): Promise<boolean> => {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
};

const delay = (durationMs: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, durationMs));

export const createDependencyCache = (
  options: DependencyCacheOptions
): DependencyCache => {
  const pollIntervalMs = options.pollIntervalMs ?? 100;
  const lockTimeoutMs = options.lockTimeoutMs ?? 300_000;
  const now = options.now ?? Date.now;

  return {
    prepare: async input => {
      const root = path.resolve(options.root);
      const entryPath = path.join(root, input.fingerprint);
      const completePath = path.join(entryPath, 'complete.json');
      const nodeModulesPath = path.join(entryPath, 'node_modules');
      const locksPath = path.join(root, '.locks');
      const stagingRoot = path.join(root, '.staging');
      const lockPath = path.join(locksPath, `${input.fingerprint}.lock`);
      const markUsed = async (): Promise<void> => {
        await writeFile(
          completePath,
          JSON.stringify({ fingerprint: input.fingerprint, lastUsedAt: now() })
        );
      };
      await Promise.all([
        mkdir(root, { recursive: true }),
        mkdir(locksPath, { recursive: true }),
        mkdir(stagingRoot, { recursive: true })
      ]);

      const linkIntoWorkspace = async (): Promise<void> => {
        await symlink(
          nodeModulesPath,
          path.join(input.workspacePath, 'node_modules'),
          'dir'
        );
      };

      if (await exists(completePath) && await exists(nodeModulesPath)) {
        await markUsed();
        await linkIntoWorkspace();
        return { cache: 'hit', nodeModulesPath };
      }

      const startedAt = Date.now();
      let lockHandle: Awaited<ReturnType<typeof open>> | undefined;
      while (!lockHandle) {
        try {
          lockHandle = await open(lockPath, 'wx');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          if (await exists(completePath) && await exists(nodeModulesPath)) {
            await markUsed();
            await linkIntoWorkspace();
            return { cache: 'hit', nodeModulesPath };
          }
          if (Date.now() - startedAt >= lockTimeoutMs) {
            throw new Error(`Timed out waiting for dependency cache ${input.fingerprint}`);
          }
          await delay(pollIntervalMs);
        }
      }

      let stagingPath: string | undefined;
      try {
        if (await exists(completePath) && await exists(nodeModulesPath)) {
          await markUsed();
          await linkIntoWorkspace();
          return { cache: 'hit', nodeModulesPath };
        }

        stagingPath = await mkdtemp(
          path.join(stagingRoot, `${input.fingerprint}-`)
        );
        await input.install(stagingPath);
        const stagedNodeModules = path.join(stagingPath, 'node_modules');
        if (!await exists(stagedNodeModules)) {
          throw new Error('Dependency installation did not create node_modules');
        }
        await writeFile(
          path.join(stagingPath, 'complete.json'),
          JSON.stringify({ fingerprint: input.fingerprint, lastUsedAt: now() })
        );
        await rm(entryPath, { recursive: true, force: true });
        await rename(stagingPath, entryPath);
        stagingPath = undefined;
        await linkIntoWorkspace();
        return { cache: 'miss', nodeModulesPath };
      } finally {
        if (stagingPath) {
          await rm(stagingPath, { recursive: true, force: true });
        }
        await lockHandle.close();
        await unlink(lockPath).catch(() => undefined);
      }
    }
  };
};
