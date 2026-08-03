import { execFile } from 'node:child_process';
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const outputDirectory = path.resolve(
  process.env.RECOVERY_DEMO_OUTPUT ?? 'docs/assets/community-preview'
);
const recordingDirectory = path.resolve('work/recovery-demo-playwright');
const playwrightRuntimeDirectory = path.resolve(
  'work/recovery-demo-playwright-runtime'
);

const findFiles = async (directory: string, extension: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return findFiles(target, extension);
    return target.endsWith(extension) ? [target] : [];
  }));
  return nested.flat();
};

const playwrightEnvironment = async (): Promise<NodeJS.ProcessEnv> => {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    return process.env;
  }

  await execFileAsync('ffmpeg', ['-version']);
  const browsers = JSON.parse(await readFile(
    path.resolve('node_modules/playwright-core/browsers.json'),
    'utf8'
  )) as { browsers: Array<{ name: string; revision: string }> };
  const revision = browsers.browsers.find(browser => browser.name === 'ffmpeg')
    ?.revision;
  if (!revision) throw new Error('Unable to resolve the Playwright ffmpeg revision');

  const ffmpegDirectory = path.join(
    playwrightRuntimeDirectory,
    `ffmpeg-${revision}`
  );
  const ffmpegLauncher = path.join(ffmpegDirectory, 'ffmpeg-mac');
  await mkdir(ffmpegDirectory, { recursive: true });
  await writeFile(ffmpegLauncher, '#!/bin/sh\nexec ffmpeg "$@"\n', 'utf8');
  await chmod(ffmpegLauncher, 0o755);

  return {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: playwrightRuntimeDirectory
  };
};

const main = async (): Promise<void> => {
  await rm(recordingDirectory, { recursive: true, force: true });

  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  await execFileAsync(npx, [
    'playwright',
    'test',
    '--config',
    'playwright.recovery-demo.config.ts',
    '--reporter=line'
  ], {
    env: await playwrightEnvironment(),
    maxBuffer: 10 * 1024 * 1024
  });

  const recordings = await findFiles(recordingDirectory, '.webm');
  if (recordings.length !== 1) {
    throw new Error(`Expected one Playwright recording, received ${recordings.length}`);
  }
  const [rawVideoPath] = recordings;
  const rawStats = await stat(rawVideoPath);
  if (rawStats.size === 0) throw new Error('Playwright recording is empty');

  const outputVideoPath = path.join(outputDirectory, 'recovery-demo.mp4');
  await execFileAsync('ffmpeg', [
    '-y',
    '-sseof', '-30',
    '-i', rawVideoPath,
    '-t', '30',
    '-vf', 'fps=30,scale=1440:900:flags=lanczos',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '21',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    outputVideoPath
  ]);

  console.log(JSON.stringify({
    hero: path.join(outputDirectory, 'recovery-hero.png'),
    video: outputVideoPath,
    durationSeconds: 30,
    provider: 'deepseek',
    controlledFaultInjection: true
  }));
};

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
