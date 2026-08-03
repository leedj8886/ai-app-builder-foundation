import dotenv from 'dotenv';
import { connectDB, disconnectDB } from './utils/db';
import { getAgentConfig } from './agent/config';
import { createRedisConnection } from './agent/redis';
import { createProductionModelClient } from './agent/modelClient';
import {
  createProjectValidator,
  type ProjectValidator
} from './agent/validator';
import { createAgentWorker } from './agent/createWorker';
import {
  findModelDefinition,
  getModelCatalog,
  requireModelDefinition,
  resolveModelClientConfig
} from './services/modelCatalog';
import { AgentRun } from './models/AgentRun';
import { cleanupDependencyCache } from './agent/validation/cacheCleanup';
import { createSandboxRuntime } from './sandbox/runtime';
import { createSandboxProjectValidator } from './agent/sandboxValidator';
import { getArtifactService } from './artifacts/runtime';
import { getSandboxConfig } from './sandbox/config';
import type { ModelClient } from './agent/types';
import { withControlledRecoveryDemoFault } from './agent/recoveryDemoModelClient';
import {
  startSandboxReconcilerLoop,
  type SandboxReconcilerLoop
} from './sandbox/reconcilerLoop';

dotenv.config();

const failingModelClient = (error: unknown): ModelClient => ({
  generatePlan: async () => { throw error; },
  generateFiles: async () => { throw error; },
  repairFiles: async () => { throw error; },
  repairDependencies: async () => { throw error; }
});

const startWorker = async () => {
  await connectDB();

  const config = getAgentConfig();
  // Validate the production local-provider guard even while legacy validation
  // is selected, so an unsafe deployment configuration always fails closed.
  getSandboxConfig();
  const connection = createRedisConnection();
  const modelCatalog = getModelCatalog();
  const controlledRecoveryDemo =
    process.env.AGENT_RECOVERY_DEMO_INJECT_TYPE_ERROR === 'true';
  if (controlledRecoveryDemo) {
    console.warn(
      'Controlled recovery demo fault injection is enabled for this Worker'
    );
  }
  const modelClients = new Map<string, ModelClient>();
  const modelClientFor = (modelId: string) => {
    const existing = modelClients.get(modelId);
    if (existing) return existing;
    const client = withControlledRecoveryDemoFault(
      createProductionModelClient(resolveModelClientConfig(modelCatalog, modelId)),
      controlledRecoveryDemo
    );
    modelClients.set(modelId, client);
    return client;
  };
  const modelClient = modelClientFor(modelCatalog.defaultModelId);
  let reconcilerLoop: SandboxReconcilerLoop | undefined;
  let validator: ProjectValidator;
  if (config.validationExecutor === 'legacy') {
    validator = createProjectValidator({
      workspaceRoot: config.workspaceRoot,
      validation: config.validation,
      artifactService: getArtifactService()
    });
  } else {
    const runtime = await createSandboxRuntime({ redis: connection });
    reconcilerLoop = startSandboxReconcilerLoop({
      reconciler: runtime.reconciler,
      intervalMs: runtime.reconcileIntervalMs,
      onResult: (result) => {
        if (Object.values(result).some((count) => count > 0)) {
          console.log('Sandbox reconciliation completed:', result);
        }
      },
      onError: (error) => {
        console.warn(
          'Sandbox reconciliation failed:',
          error instanceof Error ? error.message : 'Unknown error'
        );
      }
    });
    await reconcilerLoop.reconcileNow();
    console.log(
      `Sandbox reconciler started ` +
      `(interval: ${runtime.reconcileIntervalMs}ms)`
    );
    validator = createSandboxProjectValidator({
      service: runtime.service,
      artifactService: getArtifactService(),
      provider: runtime.provider,
      image: runtime.image,
      resources: { cpu: 1, memoryMiB: 1_024, diskMiB: 2_048 },
      verification: runtime.verification
    });
  }
  const worker = createAgentWorker({
    queueName: config.queueName,
    connection,
    modelClient,
    resolveModelClient: async (runId) => {
      try {
        const run = await AgentRun.findById(runId)
          .select('modelId modelProvider model')
          .lean();
        if (!run) throw new Error(`AgentRun not found: ${runId}`);
        const modelId = run.modelId ||
          modelCatalog.models.find(model => model.model === run.model)?.id ||
          findModelDefinition(modelCatalog, modelCatalog.defaultModelId)?.id;
        if (!modelId) throw new Error('No default model is configured');
        const definition = requireModelDefinition(modelCatalog, modelId);
        if (
          run.model !== definition.model ||
          (run.modelProvider && run.modelProvider !== definition.provider)
        ) {
          throw Object.assign(
            new Error(`Run model configuration no longer matches catalog entry: ${modelId}`),
            { code: 'MODEL_CONFIGURATION_MISMATCH' }
          );
        }
        return modelClientFor(modelId);
      } catch (error) {
        return failingModelClient(error);
      }
    },
    validator
  });
  const cleanupCache = async (): Promise<void> => {
    try {
      const result = await cleanupDependencyCache({
        root: config.validation.dependencyCacheRoot,
        retentionMs: config.validation.cacheRetentionMs,
        maxBytes: config.validation.cacheMaxBytes
      });
      if (result.removedEntries > 0) {
        console.log(
          `Validation cache cleanup removed ${result.removedEntries} entries`
        );
      }
    } catch (error) {
      console.warn(
        'Validation cache cleanup failed:',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  };
  void cleanupCache();
  const cleanupTimer = setInterval(
    () => void cleanupCache(),
    6 * 60 * 60 * 1_000
  );
  cleanupTimer.unref();

  worker.on('completed', job => {
    console.log(`Agent run job completed: ${job.id}`);
  });

  worker.on('failed', (job, error) => {
    console.error(`Agent run job failed: ${job?.id}`, error);
  });

  const shutdown = async () => {
    clearInterval(cleanupTimer);
    await worker.close();
    await reconcilerLoop?.close();
    await connection.quit();
    await disconnectDB();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  console.log(
    `Agent worker listening on queue ${config.queueName} ` +
    `(validation executor: ${config.validationExecutor})`
  );
};

startWorker().catch(error => {
  console.error('Failed to start agent worker:', error);
  process.exit(1);
});
