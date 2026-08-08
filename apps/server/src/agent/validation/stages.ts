import type { BuildCommandName } from '../../sandbox/policy';
import type {
  ValidationPhase,
  ValidationStageId
} from '../types';
import type { ValidationStageDescriptor } from '../profiles/types';

export interface ValidationStageDefinition {
  id: ValidationStageId;
  phase: ValidationPhase;
  kind: 'structure' | 'install' | 'command';
  sandboxCommand?: BuildCommandName;
  localArgs?: readonly string[];
  timeout: 'structure' | 'install' | 'type-check' | 'build';
  continueOnFailure?: boolean;
  database?: 'primary' | 'primary-and-shadow';
}

const definitions: Record<ValidationStageId, ValidationStageDefinition> = {
  structure: {
    id: 'structure',
    phase: 'structure',
    kind: 'structure',
    timeout: 'structure'
  },
  install: {
    id: 'install',
    phase: 'dependencies',
    kind: 'install',
    sandboxCommand: 'install',
    timeout: 'install'
  },
  'prisma-validate': {
    id: 'prisma-validate',
    phase: 'prisma',
    kind: 'command',
    sandboxCommand: 'prisma-validate',
    localArgs: ['run', 'prisma:validate'],
    timeout: 'build',
    database: 'primary'
  },
  'prisma-generate': {
    id: 'prisma-generate',
    phase: 'prisma',
    kind: 'command',
    sandboxCommand: 'prisma-generate',
    localArgs: ['run', 'prisma:generate'],
    timeout: 'build',
    database: 'primary'
  },
  'migration-history': {
    id: 'migration-history',
    phase: 'migration',
    kind: 'command',
    sandboxCommand: 'migration-history',
    localArgs: ['run', 'migration:check'],
    timeout: 'build'
  },
  'migration-replay': {
    id: 'migration-replay',
    phase: 'migration',
    kind: 'command',
    sandboxCommand: 'migration-replay',
    localArgs: ['run', 'migration:replay'],
    timeout: 'build',
    database: 'primary-and-shadow'
  },
  'type-check': {
    id: 'type-check',
    phase: 'type-check',
    kind: 'command',
    sandboxCommand: 'type-check',
    localArgs: ['run', 'type-check'],
    timeout: 'type-check',
    continueOnFailure: true
  },
  'nest-type-check': {
    id: 'nest-type-check',
    phase: 'type-check',
    kind: 'command',
    sandboxCommand: 'nest-type-check',
    localArgs: ['run', 'type-check'],
    timeout: 'type-check'
  },
  'api-test': {
    id: 'api-test',
    phase: 'api-test',
    kind: 'command',
    sandboxCommand: 'api-test',
    localArgs: ['run', 'test:api'],
    timeout: 'build',
    database: 'primary'
  },
  build: {
    id: 'build',
    phase: 'build',
    kind: 'command',
    sandboxCommand: 'build',
    localArgs: ['run', 'build', '--', '--base=./'],
    timeout: 'build'
  },
  'web-api-build': {
    id: 'web-api-build',
    phase: 'build',
    kind: 'command',
    sandboxCommand: 'web-api-build',
    localArgs: ['run', 'build'],
    timeout: 'build'
  },
  'runtime-smoke': {
    id: 'runtime-smoke',
    phase: 'runtime-smoke',
    kind: 'command',
    sandboxCommand: 'runtime-smoke',
    localArgs: ['run', 'runtime:smoke'],
    timeout: 'build',
    database: 'primary'
  }
};

export const resolveValidationStages = (
  descriptors: readonly ValidationStageDescriptor[]
): ValidationStageDefinition[] => descriptors.map(descriptor => {
  const definition = definitions[descriptor.id];
  if (definition.phase !== descriptor.phase) {
    throw new Error(
      `Validation stage ${descriptor.id} must use phase ${definition.phase}`
    );
  }
  return definition;
});
