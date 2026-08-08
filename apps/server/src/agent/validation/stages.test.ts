import assert from 'node:assert/strict';
import test from 'node:test';
import { fullstackNestPrismaProfile } from '../profiles/fullstackNestPrismaProfile';
import { staticReactProfile } from '../profiles/staticReactProfile';
import { resolveValidationStages } from './stages';

test('validation stage registry resolves both Profile pipelines', () => {
  assert.deepEqual(
    resolveValidationStages(staticReactProfile.validationPipeline())
      .map(stage => stage.sandboxCommand),
    [undefined, 'install', 'type-check', 'build']
  );
  assert.deepEqual(
    resolveValidationStages(fullstackNestPrismaProfile.validationPipeline())
      .map(stage => stage.id),
    fullstackNestPrismaProfile.validationPipeline().map(stage => stage.id)
  );
});

test('validation stage registry rejects a descriptor with the wrong phase', () => {
  assert.throws(
    () => resolveValidationStages([{ id: 'api-test', phase: 'build' }]),
    /must use phase api-test/
  );
});
