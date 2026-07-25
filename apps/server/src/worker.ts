import dotenv from 'dotenv';
import { connectDB, disconnectDB } from './utils/db';
import { getAgentConfig } from './agent/config';
import { createRedisConnection } from './agent/redis';
import { createProductionModelClient } from './agent/modelClient';
import { createProjectValidator } from './agent/validator';
import { createAgentWorker } from './agent/createWorker';

dotenv.config();

const startWorker = async () => {
  await connectDB();

  const config = getAgentConfig();
  const connection = createRedisConnection();
  const modelClient = createProductionModelClient(
    process.env.OPENAI_API_KEY,
    config.model
  );
  const validator = createProjectValidator({
    workspaceRoot: config.workspaceRoot,
    commandTimeoutMs: config.commandTimeoutMs,
    maxOutputChars: config.maxValidationOutputChars
  });
  const worker = createAgentWorker({
    queueName: config.queueName,
    connection,
    modelClient,
    validator
  });

  worker.on('completed', job => {
    console.log(`Agent run job completed: ${job.id}`);
  });

  worker.on('failed', (job, error) => {
    console.error(`Agent run job failed: ${job?.id}`, error);
  });

  const shutdown = async () => {
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
