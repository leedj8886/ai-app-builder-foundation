import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createInitialWorkspaceState,
  selectTemplate,
  submitPrompt,
} from './v0Workspace'

describe('v0 workspace state', () => {
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
})
