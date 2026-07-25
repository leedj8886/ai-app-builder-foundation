import type { ValidationResult } from '../types';
import type { ProjectValidator } from '../validator';

const passed = (): ValidationResult => ({
  status: 'passed',
  checks: []
});

const failed = (): ValidationResult => ({
  status: 'failed',
  checks: [{
    name: 'type-check',
    command: 'npm run type-check',
    exitCode: 1,
    stdout: '',
    stderr: 'src/App.tsx:1:1 deterministic type-check failure',
    durationMs: 1
  }]
});

export const createPassingValidator = (): ProjectValidator => ({
  validate: async () => passed()
});

export interface FailOnceValidator extends ProjectValidator {
  calls: number;
}

export const createFailOnceValidator = (): FailOnceValidator => {
  const validator: FailOnceValidator = {
    calls: 0,
    validate: async () => {
      validator.calls += 1;
      return validator.calls === 1 ? failed() : passed();
    }
  };
  return validator;
};
