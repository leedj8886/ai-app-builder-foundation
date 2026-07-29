import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runCommand } from './runCommand';
import { runCancelledError } from '../runCancellation';

test('runCommand captures output and non-zero exit codes without a shell', async () => {
  const result = await runCommand({
    executable: process.execPath,
    args: ['-e', 'process.stdout.write("out"); process.stderr.write("err"); process.exit(3)'],
    cwd: process.cwd(),
    timeoutMs: 1_000,
    maxOutputChars: 1_000
  });

  assert.equal(result.exitCode, 3);
  assert.equal(result.stdout, 'out');
  assert.equal(result.stderr, 'err');
  assert.ok(result.durationMs >= 0);
});

test('runCommand terminates commands after the configured timeout', async () => {
  const result = await runCommand({
    executable: process.execPath,
    args: ['-e', 'setTimeout(() => {}, 10_000)'],
    cwd: process.cwd(),
    timeoutMs: 50,
    maxOutputChars: 1_000
  });

  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /timed out/i);
  assert.ok(result.durationMs < 2_000);
});

test('runCommand bounds stdout and stderr independently', async () => {
  const result = await runCommand({
    executable: process.execPath,
    args: ['-e', 'process.stdout.write("a".repeat(500)); process.stderr.write("b".repeat(500))'],
    cwd: process.cwd(),
    timeoutMs: 1_000,
    maxOutputChars: 80
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.length, 80);
  assert.equal(result.stderr.length, 80);
});

test('runCommand rejects with the AbortSignal reason and stops the process', async () => {
  const controller = new AbortController();
  const command = runCommand({
    executable: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000)'],
    cwd: process.cwd(),
    timeoutMs: 10_000,
    maxOutputChars: 1_000,
    signal: controller.signal
  });
  setTimeout(() => controller.abort(runCancelledError()), 20);

  await assert.rejects(
    command,
    (error) => (error as { code?: string }).code === 'RUN_CANCELLED'
  );
});

test('runCommand timeout terminates descendant processes', {
  skip: process.platform === 'win32'
}, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'v0-command-tree-'));
  const marker = path.join(root, 'survived.txt');
  const script = `
    require('node:child_process').spawn(
      process.execPath,
      ['-e', ${JSON.stringify(`setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'alive'), 250)`)}],
      { stdio: 'ignore' }
    );
    setTimeout(() => {}, 10000);
  `;
  await runCommand({
    executable: process.execPath,
    args: ['-e', script],
    cwd: root,
    timeoutMs: 50,
    maxOutputChars: 1_000
  });
  await new Promise(resolve => setTimeout(resolve, 350));

  await assert.rejects(() => stat(marker), { code: 'ENOENT' });
});
