import { execFile } from 'node:child_process';
import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const outputDirectory = path.resolve(
  process.env.COMMUNITY_DEMO_OUTPUT ?? 'docs/assets/community-preview'
);
const recordingDirectory = path.resolve('work/community-demo-playwright');

const findFiles = async (directory: string, extension: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return findFiles(target, extension);
    return target.endsWith(extension) ? [target] : [];
  }));
  return nested.flat();
};

const main = async (): Promise<void> => {
  await rm(recordingDirectory, { recursive: true, force: true });

  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  await execFileAsync(npx, [
    'playwright',
    'test',
    '--config',
    'playwright.community-demo.config.ts',
    '--reporter=line'
  ], {
    env: process.env,
    maxBuffer: 10 * 1024 * 1024
  });

  const recordings = await findFiles(recordingDirectory, '.webm');
  if (recordings.length !== 1) {
    throw new Error(`Expected one Playwright recording, received ${recordings.length}`);
  }
  const [rawVideoPath] = recordings;
  const rawStats = await stat(rawVideoPath);
  if (rawStats.size === 0) throw new Error('Playwright recording is empty');

  const outputVideoPath = path.join(outputDirectory, 'demo.mp4');
  await execFileAsync('ffmpeg', [
    '-y',
    '-sseof', '-24',
    '-i', rawVideoPath,
    '-t', '24',
    '-vf', 'fps=30,scale=1440:900:flags=lanczos',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '21',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    outputVideoPath
  ]);

  console.log(JSON.stringify({
    hero: path.join(outputDirectory, 'hero.png'),
    video: outputVideoPath,
    durationSeconds: 24,
    deterministicModel: true
  }));
};

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
