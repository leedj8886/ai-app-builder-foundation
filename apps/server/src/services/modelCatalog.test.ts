import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getModelCatalog,
  publicModelCatalog,
  requireModelDefinition,
  resolveModelClientConfig
} from './modelCatalog';

test('model catalog preserves the legacy DeepSeek configuration', () => {
  const catalog = getModelCatalog({
    DEEPSEEK_API_KEY: 'secret',
    DEEPSEEK_BASE_URL: 'https://deepseek.example.test',
    DEEPSEEK_MODEL: 'deepseek-pro'
  });

  assert.equal(catalog.defaultModelId, 'deepseek-default');
  assert.equal(catalog.models[0]?.model, 'deepseek-pro');
  assert.deepEqual(resolveModelClientConfig(catalog, 'deepseek-default', {
    DEEPSEEK_API_KEY: 'secret'
  }), {
    apiKey: 'secret',
    baseURL: 'https://deepseek.example.test',
    model: 'deepseek-pro'
  });
});

test('model catalog parses multiple models and exposes only public metadata', () => {
  const env = {
    AGENT_MODELS_JSON: JSON.stringify([
      {
        id: 'fast-model',
        label: 'Fast Model',
        provider: 'provider-a',
        model: 'fast-v1',
        baseURL: 'https://provider-a.example.test/v1',
        apiKeyEnv: 'PROVIDER_A_KEY'
      },
      {
        id: 'quality-model',
        label: 'Quality Model',
        provider: 'provider-b',
        model: 'quality-v2',
        baseURL: 'https://provider-b.example.test/v1',
        apiKeyEnv: 'PROVIDER_B_KEY'
      }
    ]),
    AGENT_DEFAULT_MODEL_ID: 'quality-model',
    PROVIDER_A_KEY: 'configured'
  };
  const catalog = getModelCatalog(env);
  const publicCatalog = publicModelCatalog(catalog);

  assert.equal(catalog.models.length, 2);
  assert.equal(catalog.defaultModelId, 'quality-model');
  assert.deepEqual(publicCatalog.models.map(model => model.id), [
    'fast-model',
    'quality-model'
  ]);
  assert.equal('baseURL' in publicCatalog.models[0]!, false);
  assert.equal('apiKeyEnv' in publicCatalog.models[0]!, false);
});

test('model catalog rejects duplicates, unknown defaults, and unknown selections', () => {
  const duplicate = JSON.stringify([
    {
      id: 'same-model',
      label: 'First',
      provider: 'test',
      model: 'first',
      baseURL: 'https://example.test/v1',
      apiKeyEnv: 'TEST_KEY'
    },
    {
      id: 'same-model',
      label: 'Second',
      provider: 'test',
      model: 'second',
      baseURL: 'https://example.test/v1',
      apiKeyEnv: 'TEST_KEY'
    }
  ]);
  assert.throws(() => getModelCatalog({ AGENT_MODELS_JSON: duplicate }), /duplicate id/);

  const valid = JSON.stringify([{
    id: 'known-model',
    label: 'Known',
    provider: 'test',
    model: 'known',
    baseURL: 'https://example.test/v1',
    apiKeyEnv: 'TEST_KEY'
  }]);
  assert.throws(
    () => getModelCatalog({
      AGENT_MODELS_JSON: valid,
      AGENT_DEFAULT_MODEL_ID: 'missing-model'
    }),
    /does not match an enabled model/
  );
  assert.throws(
    () => requireModelDefinition(getModelCatalog({ AGENT_MODELS_JSON: valid }), 'missing-model'),
    /Model is not enabled/
  );
  assert.throws(
    () => resolveModelClientConfig(
      getModelCatalog({ AGENT_MODELS_JSON: valid }),
      'known-model',
      {}
    ),
    (error: Error & { code?: string }) =>
      error.code === 'MODEL_CONFIGURATION_ERROR' &&
      error.message === 'Model credential is not configured: known-model'
  );
});
