import assert from 'node:assert/strict'
import test from 'node:test'
import { augmentPreviewStyling } from './stylingCapabilities'

test('augments old Tailwind files without mutating inputs', () => {
  const files = {
    '/index.html': '<div id="root"></div>',
    '/src/App.tsx': '<main className="bg-blue-100" />',
    '/src/index.css': '@tailwind base;\n@tailwind utilities;',
    '/src/main.tsx': "import './index.css';",
  }
  const packageJson = {
    dependencies: { react: '^18.2.0' },
    devDependencies: { tailwindcss: '^3.4.17' },
    scripts: { build: 'vite build' },
  }
  const before = structuredClone({ files, packageJson })
  const result = augmentPreviewStyling(files, packageJson)

  assert.match(result.files['/tailwind.config.js']!, /src\/\*\*/)
  assert.match(result.files['/postcss.config.cjs']!, /tailwindcss/)
  assert.equal(result.dependencies.tailwindcss, '^3.4.17')
  assert.deepEqual(result.capabilities, ['plain-css', 'tailwind'])
  assert.deepEqual({ files, packageJson }, before)
})

test('does not inject Tailwind into a plain CSS project', () => {
  const result = augmentPreviewStyling(
    { '/src/index.css': 'body { color: navy; }' },
    { dependencies: {}, devDependencies: {}, scripts: {} },
  )
  assert.deepEqual(result.capabilities, ['plain-css'])
  assert.equal(result.files['/tailwind.config.js'], undefined)
  assert.equal(result.dependencies.tailwindcss, undefined)
})
