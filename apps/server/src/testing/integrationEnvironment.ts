import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import mongoose from 'mongoose';
import {
  GenericContainer,
  type StartedTestContainer
} from 'testcontainers';

export interface IntegrationEnvironment {
  namespace: string;
  mongoUri: string;
  redisUrl: string;
  queueName: string;
  redis: IORedis;
  reset(): Promise<void>;
  close(): Promise<void>;
}

const deleteMatchingKeys = async (
  redis: IORedis,
  pattern: string
): Promise<void> => {
  let cursor = '0';

  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      'MATCH',
      pattern,
      'COUNT',
      100
    );
    cursor = nextCursor;
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } while (cursor !== '0');
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const createIntegrationEnvironment =
  async (): Promise<IntegrationEnvironment> => {
    let mongoContainer: StartedTestContainer | undefined;
    let redisContainer: StartedTestContainer | undefined;

    try {
      [mongoContainer, redisContainer] = await Promise.all([
        new GenericContainer('mongo:7').withExposedPorts(27017).start(),
        new GenericContainer('redis:7-alpine').withExposedPorts(6379).start()
      ]);
    } catch (error) {
      await Promise.allSettled([
        mongoContainer?.stop(),
        redisContainer?.stop()
      ]);
      throw new Error(
        `Phase 6 integration tests require a running Docker daemon: ${errorMessage(error)}`,
        { cause: error }
      );
    }

    const namespace = `phase6-${randomUUID()}`;
    const databaseName = namespace.replaceAll('-', '_');
    const queueName = `${namespace}-agent-runs`;
    const mongoUri = `mongodb://${mongoContainer.getHost()}:${mongoContainer.getMappedPort(27017)}/${databaseName}`;
    const redisUrl = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;

    process.env.MONGODB_URI = mongoUri;
    process.env.REDIS_URL = redisUrl;
    process.env.AGENT_QUEUE_NAME = queueName;
    process.env.JWT_SECRET ||= 'phase-6-integration-secret';

    const redis = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    await mongoose.connect(mongoUri);

    let closed = false;
    const reset = async (): Promise<void> => {
      const collections = Object.values(mongoose.connection.collections);
      await Promise.all(collections.map((collection) => collection.deleteMany({})));

      const queue = new Queue(queueName, {
        connection: { url: redisUrl }
      });
      try {
        await queue.obliterate({ force: true });
      } finally {
        await queue.close();
      }
      await deleteMatchingKeys(redis, `${namespace}:*`);
    };

    const close = async (): Promise<void> => {
      if (closed) return;
      closed = true;

      const { closeAgentRunQueue } = await import('../agent/queue');
      const { closeSharedRedisConnection } = await import('../agent/redis');
      await Promise.allSettled([
        closeAgentRunQueue(),
        closeSharedRedisConnection()
      ]);
      await mongoose.disconnect();
      await redis.quit();
      await Promise.allSettled([
        mongoContainer.stop(),
        redisContainer.stop()
      ]);
    };

    return {
      namespace,
      mongoUri,
      redisUrl,
      queueName,
      redis,
      reset,
      close
    };
  };
