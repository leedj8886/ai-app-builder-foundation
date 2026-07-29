import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from './app';

test('GET /health remains available beyond the API rate limit', async () => {
  const app = createApp();
  const responses = await Promise.all(
    Array.from({ length: 101 }, () => request(app).get('/health'))
  );

  assert.ok(responses.every((response) => response.status === 200));
  assert.ok(responses.every((response) => response.body.status === 'ok'));
  assert.ok(responses.every((response) => response.body.timestamp));
});

test('POST /api/agent/runs requires authentication', async () => {
  const response = await request(createApp())
    .post('/api/agent/runs')
    .send({
      projectId: '64b7f5086f1f8e9f0f000001',
      prompt: 'Build a dashboard'
    })
    .expect(401);

  assert.equal(response.body.error, 'No token provided');
});

test('GET /api/agent/runs requires authentication', async () => {
  const response = await request(createApp())
    .get('/api/agent/runs')
    .query({ projectId: '64b7f5086f1f8e9f0f000001' });

  assert.equal(response.status, 401);
});

test('GET /api/projects/:projectId/snapshots requires authentication', async () => {
  const response = await request(createApp())
    .get('/api/projects/64b7f5086f1f8e9f0f000001/snapshots')
    .expect(401);

  assert.equal(response.body.error, 'No token provided');
});

test('GET /api/projects/:projectId/snapshots/:snapshotId requires authentication', async () => {
  const response = await request(createApp())
    .get('/api/projects/64b7f5086f1f8e9f0f000001/snapshots/64b7f5086f1f8e9f0f000002')
    .expect(401);

  assert.equal(response.body.error, 'No token provided');
});

test('POST /api/projects/:projectId/snapshots/:snapshotId/rollback requires authentication', async () => {
  const response = await request(createApp())
    .post('/api/projects/64b7f5086f1f8e9f0f000001/snapshots/64b7f5086f1f8e9f0f000002/rollback');

  assert.equal(response.status, 401);
});
