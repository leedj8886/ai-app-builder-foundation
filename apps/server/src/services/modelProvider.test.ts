import test from 'node:test';
import assert from 'node:assert/strict';
import OpenAI from 'openai';
import type { ClientOptions } from 'openai';
import {
  createDeepSeekClient,
  getDeepSeekConfig
} from './modelProvider';

test('getDeepSeekConfig uses official API defaults', () => {
  const config = getDeepSeekConfig({});

  assert.deepEqual(config, {
    apiKey: undefined,
    baseURL: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash'
  });
});

test('getDeepSeekConfig reads provider overrides', () => {
  const config = getDeepSeekConfig({
    DEEPSEEK_API_KEY: 'test-key',
    DEEPSEEK_BASE_URL: 'https://deepseek.example.test',
    DEEPSEEK_MODEL: 'deepseek-v4-pro'
  });

  assert.deepEqual(config, {
    apiKey: 'test-key',
    baseURL: 'https://deepseek.example.test',
    model: 'deepseek-v4-pro'
  });
});

test('createDeepSeekClient passes credentials and base URL to the SDK', () => {
  let received: ClientOptions | undefined;
  const fakeClient = {} as OpenAI;

  const client = createDeepSeekClient(
    {
      apiKey: 'test-key',
      baseURL: 'https://deepseek.example.test',
      model: 'deepseek-v4-flash'
    },
    options => {
      received = options;
      return fakeClient;
    }
  );

  assert.equal(client, fakeClient);
  assert.deepEqual(received, {
    apiKey: 'test-key',
    baseURL: 'https://deepseek.example.test'
  });
});

test('createDeepSeekClient rejects missing credentials without leaking values', () => {
  assert.throws(
    () => createDeepSeekClient({
      apiKey: undefined,
      baseURL: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash'
    }),
    (error: Error & { code?: string }) =>
      error.code === 'MODEL_CONFIGURATION_ERROR' &&
      error.message === 'DEEPSEEK_API_KEY is required'
  );
});
