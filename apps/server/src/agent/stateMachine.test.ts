import test from 'node:test';
import assert from 'node:assert/strict';
import { assertAgentRunTransition, isTerminalAgentRunStatus } from './stateMachine';

test('isTerminalAgentRunStatus detects terminal states', () => {
  assert.equal(isTerminalAgentRunStatus('completed'), true);
  assert.equal(isTerminalAgentRunStatus('failed'), true);
  assert.equal(isTerminalAgentRunStatus('cancelled'), true);
  assert.equal(isTerminalAgentRunStatus('running'), false);
});

test('assertAgentRunTransition allows queued to running', () => {
  assert.doesNotThrow(() => assertAgentRunTransition('queued', 'running'));
});

test('assertAgentRunTransition rejects completed to running', () => {
  assert.throws(
    () => assertAgentRunTransition('completed', 'running'),
    /Invalid AgentRun status transition/
  );
});

test('assertAgentRunTransition requires validation before completion', () => {
  assert.throws(
    () => assertAgentRunTransition('generating', 'completed'),
    /Invalid AgentRun status transition/
  );
  assert.doesNotThrow(() => assertAgentRunTransition('generating', 'validating'));
  assert.doesNotThrow(() => assertAgentRunTransition('validating', 'persisting'));
  assert.doesNotThrow(() => assertAgentRunTransition('persisting', 'completed'));
});
