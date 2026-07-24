import dotenv from 'dotenv';
import { Worker } from 'bullmq';
import { connectDB, disconnectDB } from './utils/db';
import { getAgentConfig } from './agent/config';
import { agentRunJobName } from './agent/queue';
import { createRedisConnection } from './agent/redis';
import { processAgentRun } from './agent/orchestrator';
import { AgentRunJobData } from './agent/types';

dotenv.config();

const startWorker = async () => {
  await connectDB();

  const config = getAgentConfig();
  const connection = createRedisConnection();
  const worker = new Worker<AgentRunJobData>(
    config.queueName,
    async job => {
      if (job.name !== agentRunJobName) {
        throw new Error(`Unsupported job name: ${job.name}`);
      }

      await processAgentRun(job.data);
    },
    {
      connection,
      concurrency: 2
    }
  );

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
