import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  applyAgentRunDetail,
  applySnapshotList,
  applyRunHistory,
  applyWorkspaceSnapshot,
  createInitialWorkspaceState,
  failApiGeneration,
  selectTemplate,
  startApiGeneration,
  submitPrompt,
  isCancellableRunId,
} from './v0Workspace'

describe('v0 workspace state', () => {
  it('only treats persisted ObjectId run ids as cancellable', () => {
    assert.equal(isCancellableRunId('64b7f5086f1f8e9f0f000001'), true)
    assert.equal(isCancellableRunId('pending:local-request'), false)
    assert.equal(isCancellableRunId(undefined), false)
  })

  it('starts on the prompt-first home screen', () => {
    const state = createInitialWorkspaceState()

    assert.equal(state.screen, 'home')
    assert.equal(state.prompt, '')
    assert.equal(state.selectedTemplateId, null)
    assert.equal(state.activePanel, 'preview')
  })

  it('turns a template selection into a ready prompt', () => {
    const state = selectTemplate(createInitialWorkspaceState(), 'dashboard')

    assert.equal(state.selectedTemplateId, 'dashboard')
    assert.match(state.prompt, /dashboard/i)
    assert.equal(state.screen, 'home')
  })

  it('opens the workspace and creates deterministic generation steps after submit', () => {
    const state = submitPrompt(
      createInitialWorkspaceState(),
      'Build a support dashboard with tickets and charts',
    )

    assert.equal(state.screen, 'workspace')
    assert.equal(state.prompt, 'Build a support dashboard with tickets and charts')
    assert.equal(state.generation.status, 'ready')
    assert.equal(state.generation.steps.length, 5)
    assert.equal(state.generation.steps[state.generation.steps.length - 1]?.label, 'Ready to publish')
  })

  it('starts an API-backed generation without marking it ready', () => {
    const state = startApiGeneration(
      createInitialWorkspaceState(),
      'Build a snapshot-backed app',
      'run_123',
    )

    assert.equal(state.screen, 'workspace')
    assert.equal(state.prompt, 'Build a snapshot-backed app')
    assert.equal(state.generation.status, 'running')
    assert.equal(state.generation.runId, 'run_123')
    assert.equal(state.generation.steps[0]?.label, 'Run queued')
  })

  it('applies agent events and completed snapshot files', () => {
    const state = applyAgentRunDetail(
      startApiGeneration(createInitialWorkspaceState(), 'Build a dashboard', 'run_123'),
      {
        run: {
          _id: 'run_123',
          status: 'completed',
          resultSnapshotId: 'snapshot_123',
        },
        events: [
          { type: 'run.created', message: 'Agent run queued', sequence: 1 },
          { type: 'run.started', message: 'Agent run started', sequence: 2 },
          { type: 'file.changed', message: 'create src/App.tsx', sequence: 3, payload: { path: 'src/App.tsx' } },
          { type: 'run.completed', message: 'Agent run completed', sequence: 4 },
        ],
        resultSnapshot: {
          _id: 'snapshot_123',
          summary: 'Generated files',
          packageJson: {
            dependencies: { react: '^18.3.0' },
            devDependencies: { vite: '^5.4.0' },
            scripts: { build: 'vite build' },
          },
          validation: {
            status: 'passed',
            checks: [],
          },
          files: [
            {
              path: 'src/App.tsx',
              content: 'export default function App() { return null }',
              language: 'tsx',
            },
          ],
        },
      },
    )

    assert.equal(state.generation.status, 'ready')
    assert.equal(state.snapshot?.id, 'snapshot_123')
    assert.equal(state.snapshot?.files[0]?.path, 'src/App.tsx')
    assert.equal(state.snapshot?.selectedFilePath, 'src/App.tsx')
    assert.equal(state.snapshot?.packageJson.dependencies.react, '^18.3.0')
    assert.equal(state.snapshot?.validation.status, 'passed')
    assert.equal(state.generation.steps.some((step) => step.label === 'create src/App.tsx'), true)
  })

  it('stores snapshot metadata and marks the active snapshot', () => {
    const state = applySnapshotList(createInitialWorkspaceState(), [
      {
        id: 'snapshot_new',
        summary: 'New snapshot',
        fileCount: 2,
        isActive: true,
        packageJson: {
          dependencies: { react: '^18.3.0' },
          devDependencies: {},
          scripts: {},
        },
        validation: { status: 'passed', checks: [] },
        createdAt: '2026-07-25T00:00:00.000Z',
      },
    ])

    assert.equal(state.snapshots[0]?.isActive, true)
    assert.equal(state.snapshots[0]?.packageJson.dependencies.react, '^18.3.0')
  })

  it('applies a workspace snapshot and selects its app file', () => {
    const state = applyWorkspaceSnapshot(createInitialWorkspaceState(), {
      _id: 'snapshot_old',
      summary: 'Restored snapshot',
      files: [
        { path: 'src/helper.ts', content: 'export {}', language: 'ts' },
        { path: 'src/App.tsx', content: 'export default function App() {}', language: 'tsx' },
      ],
      packageJson: { dependencies: {}, devDependencies: {}, scripts: {} },
      validation: { status: 'passed', checks: [] },
    })

    assert.equal(state.snapshot?.id, 'snapshot_old')
    assert.equal(state.snapshot?.selectedFilePath, 'src/App.tsx')
  })

  it('records API generation failures', () => {
    const state = failApiGeneration(
      startApiGeneration(createInitialWorkspaceState(), 'Build a dashboard'),
      'Worker is not running',
    )

    assert.equal(state.generation.status, 'failed')
    assert.equal(state.generation.error, 'Worker is not running')
  })

  it('presents cancelled runs separately from failures', () => {
    const state = applyAgentRunDetail(
      startApiGeneration(createInitialWorkspaceState(), 'Build a dashboard', 'run_cancelled'),
      {
        run: { _id: 'run_cancelled', status: 'cancelled' },
        events: [{ type: 'run.cancelled', message: 'Agent run cancelled', sequence: 1 }],
        resultSnapshot: null,
      },
    )

    assert.equal(state.generation.status, 'cancelled')
    assert.equal(state.generation.error, undefined)
  })

  it('prefers the first concise validation diagnostic', () => {
    const state = applyAgentRunDetail(
      startApiGeneration(createInitialWorkspaceState(), 'Build a dashboard', 'run_failed'),
      {
        run: {
          _id: 'run_failed',
          status: 'failed',
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Project validation failed',
            details: {
              status: 'failed',
              checks: [{
                name: 'type-check',
                command: 'npm run type-check',
                exitCode: 2,
                stdout: '',
                stderr: '\n src/App.tsx(4,2): error TS2322: Type mismatch\nsecond line',
                durationMs: 20,
              }],
            },
          },
        },
        events: [],
        resultSnapshot: null,
      },
    )

    assert.equal(state.generation.error, 'src/App.tsx(4,2): error TS2322: Type mismatch')
  })

  it('stores run history newest first', () => {
    const state = applyRunHistory(createInitialWorkspaceState(), [
      {
        _id: 'older',
        prompt: 'Older',
        status: 'completed',
        createdAt: '2026-07-24T00:00:00.000Z',
      },
      {
        _id: 'newer',
        prompt: 'Newer',
        status: 'failed',
        createdAt: '2026-07-25T00:00:00.000Z',
      },
    ])

    assert.deepEqual(state.runHistory.map((run) => run._id), ['newer', 'older'])
  })

  it('keeps the active snapshot while an edit is running or fails', () => {
    const base = applyWorkspaceSnapshot(createInitialWorkspaceState(), {
      _id: 'snapshot_base',
      summary: 'Current version',
      files: [{ path: 'src/App.tsx', content: 'base', language: 'tsx' }],
      packageJson: { dependencies: {}, devDependencies: {}, scripts: {} },
      validation: { status: 'passed', checks: [] },
    })
    const running = startApiGeneration(base, 'Edit the app', 'run_edit')
    const failed = applyAgentRunDetail(running, {
      run: { _id: 'run_edit', status: 'failed' },
      events: [],
      resultSnapshot: null,
    })

    assert.equal(running.snapshot?.id, 'snapshot_base')
    assert.equal(failed.snapshot?.id, 'snapshot_base')
  })

  it('ignores stale polling responses from an older run', () => {
    const current = startApiGeneration(
      createInitialWorkspaceState(),
      'New prompt',
      'run_new',
    )
    const state = applyAgentRunDetail(current, {
      run: { _id: 'run_old', status: 'cancelled' },
      events: [],
      resultSnapshot: null,
    })

    assert.equal(state.generation.runId, 'run_new')
    assert.equal(state.generation.status, 'running')
  })
})
