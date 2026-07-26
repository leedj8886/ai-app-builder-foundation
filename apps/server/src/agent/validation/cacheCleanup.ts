import path from 'node:path';
import {
  access,
  readFile,
  readdir,
  rm,
  stat
} from 'node:fs/promises';

interface CacheEntry {
  name: string;
  path: string;
  lastUsedAt: number;
  bytes: number;
}

const exists = async (target: string): Promise<boolean> => {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
};

const directorySize = async (root: string): Promise<number> => {
  const entries = await readdir(root, { withFileTypes: true });
  const sizes = await Promise.all(entries.map(async entry => {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) return directorySize(target);
    if (!entry.isFile()) return 0;
    return (await stat(target)).size;
  }));
  return sizes.reduce((total, size) => total + size, 0);
};

const readEntry = async (root: string, name: string): Promise<CacheEntry | null> => {
  const entryPath = path.join(root, name);
  try {
    const metadata = JSON.parse(
      await readFile(path.join(entryPath, 'complete.json'), 'utf8')
    ) as { lastUsedAt?: unknown };
    if (typeof metadata.lastUsedAt !== 'number') return null;
    return {
      name,
      path: entryPath,
      lastUsedAt: metadata.lastUsedAt,
      bytes: await directorySize(entryPath)
    };
  } catch {
    return null;
  }
};

export const cleanupDependencyCache = async (input: {
  root: string;
  retentionMs: number;
  maxBytes: number;
  now?: number;
}): Promise<{ removedEntries: number; removedBytes: number }> => {
  const root = path.resolve(input.root);
  const now = input.now ?? Date.now();
  let names: string[];
  try {
    names = (await readdir(root, { withFileTypes: true }))
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(entry => entry.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { removedEntries: 0, removedBytes: 0 };
    }
    throw error;
  }

  const entries = (
    await Promise.all(names.map(name => readEntry(root, name)))
  ).filter((entry): entry is CacheEntry => entry !== null);
  let totalBytes = entries.reduce((total, entry) => total + entry.bytes, 0);
  let removedEntries = 0;
  let removedBytes = 0;

  const removeIfUnlocked = async (entry: CacheEntry): Promise<boolean> => {
    const lockPath = path.join(root, '.locks', `${entry.name}.lock`);
    if (await exists(lockPath)) return false;
    const current = await readEntry(root, entry.name);
    if (!current || current.lastUsedAt !== entry.lastUsedAt) return false;
    if (await exists(lockPath)) return false;
    await rm(entry.path, { recursive: true, force: true });
    removedEntries += 1;
    removedBytes += entry.bytes;
    totalBytes -= entry.bytes;
    return true;
  };

  const remaining: CacheEntry[] = [];
  for (const entry of entries.sort((a, b) => a.lastUsedAt - b.lastUsedAt)) {
    if (now - entry.lastUsedAt > input.retentionMs) {
      if (await removeIfUnlocked(entry)) continue;
    }
    remaining.push(entry);
  }

  for (const entry of remaining) {
    if (totalBytes <= input.maxBytes) break;
    await removeIfUnlocked(entry);
  }

  return { removedEntries, removedBytes };
};
