import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';

export const readCssBuildEvidence = async (input: {
  workspacePath: string;
  maxChars: number;
}): Promise<Array<{ path: string; content: string }>> => {
  const dist = path.join(input.workspacePath, 'dist');
  const paths: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(target);
      else if (entry.isFile() && entry.name.endsWith('.css')) paths.push(target);
    }
  };
  await walk(dist);
  let remaining = input.maxChars;
  const assets: Array<{ path: string; content: string }> = [];
  for (const target of paths.sort()) {
    if (remaining <= 0) break;
    const content = (await readFile(target, 'utf8')).slice(0, remaining);
    assets.push({
      path: path.relative(input.workspacePath, target).split(path.sep).join('/'),
      content
    });
    remaining -= content.length;
  }
  return assets;
};
