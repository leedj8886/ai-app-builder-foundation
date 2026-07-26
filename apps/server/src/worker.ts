import dotenv from 'dotenv';
import { connectDB, disconnectDB } from './utils/db';
import { getAgentConfig } from './agent/config';
import { createRedisConnection } from './agent/redis';
import { createProductionModelClient } from './agent/modelClient';
import { createProjectValidator } from './agent/validator';
import { createAgentWorker } from './agent/createWorker';
import { getDeepSeekConfig } from './services/modelProvider';
import { cleanupDependencyCache } from './agent/validation/cacheCleanup';

dotenv.config();

const startWorker = async () => {
  await connectDB();

  const config = getAgentConfig();
  const connection = createRedisConnection();
  const providerConfig = getDeepSeekConfig();
  const modelClient = createProductionModelClient({
    ...providerConfig,
    model: config.model
  });
  const validator = createProjectValidator({
    workspaceRoot: config.workspaceRoot,
    validation: config.validation
  });
  const worker = createAgentWorker({
    queueName: config.queueName,
    connection,
    modelClient,
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
    await connection.quit();
    await disconnectDB();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  console.log(`Agent worker listening on queue ${config.queueName}`);
};

startWorker().catch(error => {
  console.error('Failed to start agent worker:', error);
  process.exit(1);
});
