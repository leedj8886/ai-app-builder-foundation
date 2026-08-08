import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeProjectPackageJson } from '../dependencies';
import { createProjectTemplateFiles } from '../projectTemplate';
import { validateProjectStructure } from '../validation/structure';
import { staticReactProfile } from './staticReactProfile';

const generated = {
  dependencies: { zustand: '^4.5.0' },
  devDependencies: { vitest: '^2.0.0' }
};

test('static React Profile preserves the existing template and package output', () => {
  assert.deepEqual(
    staticReactProfile.createTemplate(),
    createProjectTemplateFiles()
  );
  assert.deepEqual(
    staticReactProfile.mergePackageJson({ generated }),
    mergeProjectPackageJson(undefined, generated)
  );
});

test('static React Profile returns fresh values and the existing validation contract', () => {
  const first = staticReactProfile.createTemplate();
  const second = staticReactProfile.createTemplate();
  assert.notEqual(first, second);
  assert.notEqual(first[0], second[0]);

  const packageJson = staticReactProfile.mergePackageJson({
    generated: { dependencies: {}, devDependencies: {} }
  });
  const files = [
    ...first,
    {
      path: 'package.json',
      language: 'json' as const,
      content: JSON.stringify(packageJson)
    }
  ];
  assert.deepEqual(
    staticReactProfile.validateStructure(files),
    validateProjectStructure(files)
  );
  assert.deepEqual(
    staticReactProfile.validationPipeline().map(stage => stage.id),
    ['structure', 'install', 'type-check', 'build']
  );
  assert.deepEqual(staticReactProfile.runtimeDescriptor(), {
    kind: 'static-artifact',
    buildOutputDirectory: 'dist',
    entryPath: 'index.html'
  });
});
