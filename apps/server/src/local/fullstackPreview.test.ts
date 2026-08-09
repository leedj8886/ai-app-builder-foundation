import { strict as assert } from 'node:assert';
import test from 'node:test';
import { ensureLocalPreviewAuthProxy } from './fullstackPreview';

test('local preview upgrades legacy Vite API proxy with a platform user context', () => {
  const legacy = `server: { proxy: {
    '/api': process.env.FULLSTACK_API_URL || 'http://localhost:3000'
  } }`;
  const upgraded = ensureLocalPreviewAuthProxy(legacy);
  assert.equal(upgraded.includes("x-platform-user-id"), true);
  assert.equal(upgraded.includes("FULLSTACK_PREVIEW_USER_ID || 'preview-user'"), true);
});

test('local preview leaves an already upgraded Vite API proxy unchanged', () => {
  const current = "'/api': { target: process.env.FULLSTACK_API_URL, changeOrigin: true }";
  assert.equal(ensureLocalPreviewAuthProxy(current), current);
});
