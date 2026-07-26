import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyValidationFailure,
  diagnosticFingerprint
} from './classify';

test('classifyValidationFailure separates infrastructure package and code errors', () => {
  assert.equal(classifyValidationFailure({
    phase: 'dependencies',
    exitCode: 124,
    stdout: '',
    stderr: 'Command timed out after 180000ms'
  }), 'INFRA_ERROR');

  assert.equal(classifyValidationFailure({
    phase: 'dependencies',
    exitCode: 1,
    stdout: '',
    stderr: 'npm error code E404 No matching version found for demo@99.0.0'
  }), 'DEPENDENCY_ERROR');

  assert.equal(classifyValidationFailure({
    phase: 'type-check',
    exitCode: 2,
    stdout: '',
    stderr: 'src/App.tsx(3,2): error TS2322'
  }), 'CODE_ERROR');
});

test('diagnosticFingerprint ignores volatile paths whitespace and durations', () => {
  const left = diagnosticFingerprint({
    phase: 'dependencies',
    exitCode: 124,
    stdout: '',
    stderr: '/tmp/v0-agent-runs/run-a-123 Command timed out after 180000ms'
  });
  const right = diagnosticFingerprint({
    phase: 'dependencies',
    exitCode: 124,
    stdout: '',
    stderr: '  /tmp/v0-agent-runs/run-b-456   Command timed out after 120000ms '
  });

  assert.equal(left, right);
});
