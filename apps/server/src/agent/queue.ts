import { Queue } from 'bullmq';
import { getAgentConfig } from './config';
import { getSharedRedisConnection } from './redis';
import { AgentRunJobData } from './types';

export const agentRunJobName = 'agent-run';

let agentRunQueue: Queue<AgentRunJobData> | undefined;

export const getAgentRunQueue = (): Queue<AgentRunJobData> => {
  if (!agentRunQueue) {
    const config = getAgentConfig();
    agentRunQueue = new Queue<AgentRunJobData>(config.queueName, {
      connection: getSharedRedisConnection()
    });
  }

  return agentRunQueue;
};

export const enqueueAgentRun = async (runId: string): Promise<void> => {
  await getAgentRunQueue().add(
    agentRunJobName,
    { runId },
    {
      jobId: runId,
      attempts: 2,
      backoff: {
        type: 'exponential',
        delay: 1000
      },
      removeOnComplete: {
        age: 24 * 60 * 60
      },
      removeOnFail: {
        age: 7 * 24 * 60 * 60
      }
    }
  );
};

export const closeAgentRunQueue = async (): Promise<void> => {
  if (!agentRunQueue) {
    return;
  }

  await agentRunQueue.close();
  agentRunQueue = undefined;
};
