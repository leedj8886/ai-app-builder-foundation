import assert from 'node:assert/strict';
import test from 'node:test';
import { adaptersFor } from './registry';

test('composes adapters for every detected capability', () => {
  const adapters = adaptersFor({
    capabilities: ['plain-css', 'tailwind', 'css-modules'],
    evidence: {},
    issues: []
  });
  assert.deepEqual(adapters.map(adapter => adapter.capability), [
    'plain-css',
    'tailwind',
    'css-modules'
  ]);
});
