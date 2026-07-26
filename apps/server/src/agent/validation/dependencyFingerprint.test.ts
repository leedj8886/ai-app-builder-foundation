import assert from 'node:assert/strict';
import test from 'node:test';
import { dependencyFingerprint } from './dependencyFingerprint';

const input = {
  dependencies: { react: '^18', axios: '^1' },
  devDependencies: { vite: '^5' },
  lockfile: undefined,
  nodeVersion: '20.18.0',
  npmVersion: '10.8.2',
  platform: 'linux',
  arch: 'arm64'
};

test('dependencyFingerprint is stable for reordered dependency maps', () => {
  const left = dependencyFingerprint(input);
  const right = dependencyFingerprint({
    ...input,
    dependencies: { axios: '^1', react: '^18' }
  });

  assert.equal(left, right);
});

test('dependencyFingerprint changes with dependency runtime or lockfile inputs', () => {
  const baseline = dependencyFingerprint(input);

  assert.notEqual(
    baseline,
    dependencyFingerprint({
      ...input,
      dependencies: { ...input.dependencies, react: '^19' }
    })
  );
  assert.notEqual(
    baseline,
    dependencyFingerprint({ ...input, lockfile: '{"lockfileVersion":3}' })
  );
  assert.notEqual(
    baseline,
    dependencyFingerprint({ ...input, arch: 'x64' })
  );
});
