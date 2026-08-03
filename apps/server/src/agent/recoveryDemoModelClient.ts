import type {
  FileOperation,
  GenerationResult,
  ModelClient,
  ModelResult
} from './types';

export const RECOVERY_DEMO_FAULT_MARKER =
  '__CONTROLLED_RECOVERY_DEMO_FAULT__';

const faultSource = `

// Controlled recovery demo fault. Remove this deliberately injected line.
const ${RECOVERY_DEMO_FAULT_MARKER}: never = 'trigger a real type-check failure';
`;

const injectFault = (
  result: ModelResult<GenerationResult>
): ModelResult<GenerationResult> => {
  const appOperationIndex = result.value.operations.findIndex(
    operation => operation.type !== 'delete'
      && operation.path.replace(/\\/g, '/') === 'src/App.tsx'
  );
  const operations: FileOperation[] = result.value.operations.map(operation =>
    operation.type === 'delete' ? { ...operation } : { ...operation }
  );

  if (appOperationIndex >= 0) {
    const operation = operations[appOperationIndex];
    if (operation.type !== 'delete') {
      operations[appOperationIndex] = {
        ...operation,
        content: `${operation.content.replace(/\s*$/, '')}${faultSource}`
      };
    }
  } else {
    operations.push({
      type: 'create',
      path: 'src/controlled-recovery-demo-fault.ts',
      content: faultSource.trimStart()
    });
  }

  return {
    ...result,
    value: {
      ...result.value,
      message: `${result.value.message} (controlled recovery demo fault injected)`,
      operations
    }
  };
};

export const withControlledRecoveryDemoFault = (
  client: ModelClient,
  enabled: boolean
): ModelClient => {
  if (!enabled) return client;

  return {
    generatePlan: input => client.generatePlan(input),
    generateFiles: async input => injectFault(await client.generateFiles(input)),
    repairFiles: input => client.repairFiles(input),
    ...(client.repairDependencies && {
      repairDependencies: input => client.repairDependencies!(input)
    })
  };
};
