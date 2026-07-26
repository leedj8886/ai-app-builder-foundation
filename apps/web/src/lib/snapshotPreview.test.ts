import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createSnapshotPreviewModel,
  getSnapshotPreviewState,
  type SnapshotPreviewModel,
} from './snapshotPreview'
import type { SnapshotFile, WorkspaceSnapshot } from './v0Workspace'

const createSnapshot = ({
  files,
  dependencies = {},
  devDependencies = {},
}: {
  files: SnapshotFile[]
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}): WorkspaceSnapshot => ({
  id: 'snapshot_preview',
  summary: 'Preview snapshot',
  files,
  selectedFilePath: files[0]?.path ?? null,
  packageJson: {
    dependencies,
    devDependencies,
    scripts: { build: 'vite build' },
  },
  validation: {
    status: 'passed',
    checks: [],
  },
})

const validFiles = (): SnapshotFile[] => [
  {
    path: 'src/App.tsx',
    content: 'export default function App() { return <main>App</main> }',
    language: 'tsx',
  },
  {
    path: 'src/main.tsx',
    content: 'import App from "./App"',
    language: 'tsx',
  },
  {
    path: 'src/index.css',
    content: 'body {}',
    language: 'css',
  },
]

describe('snapshot preview conversion', () => {
  it('converts a React snapshot to deterministic Sandpack input', () => {
    const source = createSnapshot({
      files: validFiles(),
      dependencies: { 'lucide-react': '^0.344.0' },
      devDependencies: { vite: '^5.4.0' },
    })
    const original = structuredClone(source)

    const result = createSnapshotPreviewModel(source)

    assert.equal(result.entry, '/src/main.tsx')
    assert.equal(
      result.files['/src/App.tsx'],
      'export default function App() { return <main>App</main> }',
    )
    assert.deepEqual(result.dependencies, {
      'lucide-react': '^0.344.0',
      react: '^18.2.0',
      'react-dom': '^18.2.0',
    })
    assert.deepEqual(Object.keys(result.files), [
      '/src/App.tsx',
      '/src/index.css',
      '/src/main.tsx',
    ])
    assert.deepEqual(source, original)
    assert.deepEqual(createSnapshotPreviewModel(source), result)
  })

  it('normalizes rooted paths once and preserves declared React versions', () => {
    const result = createSnapshotPreviewModel(createSnapshot({
      files: validFiles().map((file) => ({ ...file, path: `/${file.path}` })),
      dependencies: {
        react: '^18.3.1',
        'react-dom': '^18.3.1',
      },
    }))

    assert.equal(result.files['//src/App.tsx'], undefined)
    assert.equal(result.files['/src/App.tsx']?.includes('<main>'), true)
    assert.equal(result.dependencies.react, '^18.3.1')
    assert.equal(result.dependencies['react-dom'], '^18.3.1')
  })

  it('accepts src/index.tsx when src/main.tsx is absent', () => {
    const files = validFiles()
      .filter((file) => file.path !== 'src/main.tsx')
      .concat({
        path: 'src/index.tsx',
        content: 'import App from "./App"',
        language: 'tsx',
      })

    assert.equal(
      createSnapshotPreviewModel(createSnapshot({ files })).entry,
      '/src/index.tsx',
    )
  })

  it('includes JavaScript configuration files in the preview model', () => {
    const tailwindConfig = 'module.exports = { content: ["./src/**/*.{ts,tsx}"] }'
    const postcssConfig = 'module.exports = { plugins: { tailwindcss: {} } }'
    const result = createSnapshotPreviewModel(createSnapshot({
      files: [
        ...validFiles(),
        { path: 'tailwind.config.js', content: tailwindConfig, language: 'js' },
        { path: 'postcss.config.cjs', content: postcssConfig, language: 'js' },
      ],
    }))

    assert.equal(result.files['/tailwind.config.js'], tailwindConfig)
    assert.equal(result.files['/postcss.config.cjs'], postcssConfig)
  })

  it('adds in-memory Tailwind compatibility to an old snapshot', () => {
    const source = createSnapshot({
      files: validFiles().map(file => file.path === 'src/index.css'
        ? { ...file, content: '@tailwind base;\n@tailwind utilities;' }
        : file),
      devDependencies: { tailwindcss: '^3.4.17' },
    })
    const original = structuredClone(source)
    const result = createSnapshotPreviewModel(source)

    assert.match(result.files['/tailwind.config.js']!, /src\/\*\*/)
    assert.match(result.files['/postcss.config.cjs']!, /tailwindcss/)
    assert.equal(result.dependencies.tailwindcss, '^3.4.17')
    assert.deepEqual(source, original)
  })

  it('rejects unsafe unsupported duplicate and missing-entry snapshots', () => {
    const assertConversionError = (
      files: SnapshotFile[],
      expected: RegExp,
    ): void => {
      assert.throws(
        () => createSnapshotPreviewModel(createSnapshot({ files })),
        expected,
      )
    }

    assertConversionError([
      { path: '../secret.ts', content: '', language: 'ts' },
      ...validFiles(),
    ], /Unsafe preview file path/)
    assertConversionError([
      { path: 'src\\secret.ts', content: '', language: 'ts' },
      ...validFiles(),
    ], /Unsafe preview file path/)
    assertConversionError([
      { path: 'asset.png', content: '', language: 'png' as never },
      ...validFiles(),
    ], /Unsupported preview file/)
    assertConversionError([
      ...validFiles(),
      { ...validFiles()[0]!, path: '/src/App.tsx' },
    ], /Duplicate preview file path/)
    assertConversionError([
      {
        path: 'src/App.tsx',
        content: 'export default function App() {}',
        language: 'tsx',
      },
    ], /Preview entry file is missing/)
  })

  it('returns plain serializable records', () => {
    const model: SnapshotPreviewModel = createSnapshotPreviewModel(
      createSnapshot({ files: validFiles() }),
    )

    assert.equal(Object.getPrototypeOf(model.files), Object.prototype)
    assert.equal(Object.getPrototypeOf(model.dependencies), Object.prototype)
    assert.doesNotThrow(() => JSON.stringify(model))
  })
})

describe('snapshot preview state', () => {
  it('returns an empty state without an active snapshot', () => {
    assert.deepEqual(getSnapshotPreviewState(undefined, 'idle'), {
      kind: 'empty',
    })
    assert.deepEqual(getSnapshotPreviewState(undefined, 'running'), {
      kind: 'empty',
    })
  })

  it('keeps the previous executable snapshot visible while a new run executes', () => {
    const snapshot = createSnapshot({ files: validFiles() })
    const state = getSnapshotPreviewState(snapshot, 'running')

    assert.equal(state.kind, 'running')
    assert.equal(state.kind === 'running' ? state.model.entry : undefined, '/src/main.tsx')
  })

  it('returns a ready executable model for terminal successful state', () => {
    const snapshot = createSnapshot({ files: validFiles() })

    assert.equal(getSnapshotPreviewState(snapshot, 'ready').kind, 'ready')
    assert.equal(getSnapshotPreviewState(snapshot, 'failed').kind, 'ready')
    assert.equal(getSnapshotPreviewState(snapshot, 'cancelled').kind, 'ready')
  })

  it('converts invalid snapshot failures to concise error state', () => {
    const invalid = createSnapshot({
      files: [{
        path: 'src/App.tsx',
        content: 'export default function App() {}',
        language: 'tsx',
      }],
    })

    assert.deepEqual(getSnapshotPreviewState(invalid, 'ready'), {
      kind: 'error',
      message: 'Preview entry file is missing',
    })
  })
})
