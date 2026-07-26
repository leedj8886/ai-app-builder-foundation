import test from 'node:test';
import assert from 'node:assert/strict';
import nodePath from 'node:path';
import {
  normalizeSandboxRelativePath,
  resolveSandboxPath
} from './path';

test('normalizeSandboxRelativePath accepts canonical relative paths', () => {
  assert.equal(normalizeSandboxRelativePath('src/App.tsx'), 'src/App.tsx');
  assert.equal(
    normalizeSandboxRelativePath('package-lock.json'),
    'package-lock.json'
  );
  assert.equal(
    normalizeSandboxRelativePath('src\\components\\Button.tsx'),
    'src/components/Button.tsx'
  );
});

test('normalizeSandboxRelativePath rejects unsafe paths', () => {
  for (const candidate of [
    '',
    '/etc/passwd',
    '\\etc\\passwd',
    'C:\\Windows\\system.ini',
    'src//App.tsx',
    'src/./App.tsx',
    'src/../App.tsx',
    'src/\0/App.tsx'
  ]) {
    assert.throws(
      () => normalizeSandboxRelativePath(candidate),
      /SANDBOX_POLICY_DENIED/
    );
  }
});

test('resolveSandboxPath guarantees containment', () => {
  const root = nodePath.resolve('/tmp/sandbox-root');

  assert.equal(
    resolveSandboxPath(root, 'src/App.tsx'),
    nodePath.join(root, 'src/App.tsx')
  );
  assert.throws(
    () => resolveSandboxPath(root, '../outside'),
    /SANDBOX_POLICY_DENIED/
  );
});
