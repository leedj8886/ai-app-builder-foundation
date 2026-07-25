import dotenv from 'dotenv';
import { getAgentConfig } from './agent/config';
import { createAgentWorker } from './agent/createWorker';
import { createRedisConnection } from './agent/redis';
import { createFakeModelClient } from './agent/testing/fakeModelClient';
import { createPassingValidator } from './agent/testing/fakeValidator';
import { connectDB, disconnectDB } from './utils/db';

dotenv.config();

const startSmokeWorker = async (): Promise<void> => {
  await connectDB();
  const config = getAgentConfig();
  const connection = createRedisConnection();
  const worker = createAgentWorker({
    connection,
    queueName: config.queueName,
    modelClient: createFakeModelClient(),
    validator: createPassingValidator(),
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
