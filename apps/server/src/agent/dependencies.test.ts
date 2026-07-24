import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeProjectPackageJson } from './dependencies';

test('mergeProjectPackageJson merges and sorts dependency maps', () => {
  const result = mergeProjectPackageJson(
    {
      dependencies: { zustand: '^4.5.0', react: '^18.1.0' },
      devDependencies: { typescript: '^5.3.0' },
      scripts: { unsafe: 'curl example.com' }
    },
    {
      dependencies: { react: '^18.3.0', 'lucide-react': '^0.468.0' },
      devDependencies: { typescript: '^5.6.0' }
    }
  );

  assert.deepEqual(Object.keys(result.dependencies), [
    'lucide-react',
    'react',
    'react-dom',
    'zustand'
  ]);
  assert.equal(result.dependencies.react, '^18.3.0');
  assert.equal(result.devDependencies.typescript, '^5.6.0');
  assert.equal(result.devDependencies.tailwindcss, '^3.4.17');
  assert.deepEqual(result.scripts, {
    dev: 'vite',
    'type-check': 'tsc --noEmit',
    build: 'tsc && vite build'
  });
  assert.equal('unsafe' in result.scripts, false);
});

test('mergeProjectPackageJson supplies the React Vite Tailwind toolchain', () => {
  const result = mergeProjectPackageJson(undefined, {
    dependencies: {},
    devDependencies: {}
  });

  assert.equal(result.dependencies.react, '^18.2.0');
  assert.equal(result.dependencies['react-dom'], '^18.2.0');
  assert.equal(result.devDependencies.vite, '^5.4.0');
  assert.equal(result.devDependencies['@vitejs/plugin-react'], '^4.3.0');
  assert.equal(result.devDependencies.autoprefixer, '^10.4.20');
  assert.equal(result.devDependencies.postcss, '^8.4.49');
});

test('mergeProjectPackageJson preserves Map-backed snapshot dependencies', () => {
  const result = mergeProjectPackageJson(
    {
      dependencies: new Map([['zustand', '^4.5.0']]) as unknown as Record<string, string>,
      devDependencies: new Map([['vitest', '^2.0.0']]) as unknown as Record<string, string>,
      scripts: {}
    },
    {
      dependencies: {},
      devDependencies: {}
    }
  );

  assert.equal(result.dependencies.zustand, '^4.5.0');
  assert.equal(result.devDependencies.vitest, '^2.0.0');
});
