import dotenv from 'dotenv';
import { getAgentConfig } from './agent/config';
import { createAgentWorker } from './agent/createWorker';
import { createRedisConnection } from './agent/redis';
import { createFakeModelClient } from './agent/testing/fakeModelClient';
import { createPassingValidator } from './agent/testing/fakeValidator';
import type { ProjectValidator } from './agent/validator';
import { connectDB, disconnectDB } from './utils/db';

dotenv.config();

const startSmokeWorker = async (): Promise<void> => {
  await connectDB();
  const config = getAgentConfig();
  const connection = createRedisConnection();
  let validationCalls = 0;
  const smokeValidator: ProjectValidator = process.env.SMOKE_VALIDATION_EVENTS === 'true'
    ? {
        validate: async input => {
          validationCalls += 1;
          if (validationCalls === 1) {
            await input.onProgress?.({
              phase: 'dependencies',
              status: 'retrying',
              category: 'INFRA_ERROR',
              attempt: 1,
              retryDelayMs: 5,
              message: 'Deterministic transient registry failure'
            });
          }
          await input.onProgress?.({
            phase: 'dependencies',
            status: 'passed',
            attempt: 1,
            cache: validationCalls === 1 ? 'miss' : 'hit',
            message: validationCalls === 1
              ? 'Dependencies installed'
              : 'Dependency cache hit'
          });
          return { status: 'passed', retryable: false, checks: [] };
        }
      }
    : createPassingValidator();
  const worker = createAgentWorker({
    connection,
    queueName: config.queueName,
    modelClient: createFakeModelClient(),
    validator: smokeValidator,
    concurrency: 1
  });

  worker.on('completed', (job) => {
    console.log(`Smoke agent run job completed: ${job.id}`);
  });
  worker.on('failed', (job, error) => {
    console.error(`Smoke agent run job failed: ${job?.id}`, error);
  });

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    await worker.close();
    await connection.quit();
    await disconnectDB();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  console.log(`Smoke agent worker listening on queue ${config.queueName}`);
};

startSmokeWorker().catch((error: unknown) => {
  console.error('Failed to start smoke agent worker:', error);
  process.exit(1);
});
