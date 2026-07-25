import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createSnapshotPreviewModel,
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
