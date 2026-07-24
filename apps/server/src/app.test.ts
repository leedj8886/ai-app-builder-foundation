import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from './app';

test('GET /health returns ok', async () => {
  const response = await request(createApp()).get('/health').expect(200);

  assert.equal(response.body.status, 'ok');
  assert.ok(response.body.timestamp);
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
