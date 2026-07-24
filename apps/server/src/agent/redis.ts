import IORedis from 'ioredis';
import { getAgentConfig } from './config';

let sharedRedisConnection: IORedis | undefined;

export const createRedisConnection = (): IORedis => {
  const config = getAgentConfig();
  return new IORedis(config.redisUrl, {
    maxRetriesPerRequest: null
  });
};

export const getSharedRedisConnection = (): IORedis => {
  if (!sharedRedisConnection) {
    sharedRedisConnection = createRedisConnection();
  }

  return sharedRedisConnection;
};

export const closeSharedRedisConnection = async (): Promise<void> => {
  if (!sharedRedisConnection) {
    return;
  }

  await sharedRedisConnection.quit();
  sharedRedisConnection = undefined;
};
