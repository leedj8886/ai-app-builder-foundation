import { randomUUID } from 'node:crypto';
import type IORedis from 'ioredis';
import type { Types } from 'mongoose';
import { SandboxError } from './errors';

export interface WorkspaceQuotaGuard {
  assertHeld(): Promise<void>;
}

interface WorkspaceQuotaLockOptions {
  redis: IORedis;
  ttlMs: number;
  waitMs: number;
  now?: () => number;
  token?: () => string;
  sleep?: (ms: number) => Promise<void>;
}

const RENEW_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end";
const RELEASE_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

export class WorkspaceQuotaLock {
  private readonly now: () => number;
  private readonly token: () => string;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: WorkspaceQuotaLockOptions) {
    this.now = options.now ?? Date.now;
    this.token = options.token ?? randomUUID;
    this.sleep =
      options.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async withLock<T>(
    workspaceId: Types.ObjectId,
    callback: (guard: WorkspaceQuotaGuard) => Promise<T>
  ): Promise<T> {
    const key = `sandbox-quota:${workspaceId.toString()}`;
    const token = this.token();
    const deadline = this.now() + this.options.waitMs;
    let acquired = false;

    try {
      while (this.now() <= deadline) {
        const result = await this.redis(
          () =>
            this.options.redis.set(
              key,
              token,
              'PX',
              this.options.ttlMs,
              'NX'
            ),
          'acquire'
        );
        if (result === 'OK') {
          acquired = true;
          break;
        }
        await this.sleep(Math.min(25, Math.max(1, deadline - this.now())));
      }
      if (!acquired) {
        throw new SandboxError(
          'SANDBOX_SCHEDULER_UNAVAILABLE',
          'Workspace quota lock timed out',
          true
        );
      }

      let lost = false;
      const renew = async () => {
        try {
          const result = await this.options.redis.eval(
            RENEW_SCRIPT,
            1,
            key,
            token,
            String(this.options.ttlMs)
          );
          if (result !== 1) lost = true;
        } catch {
          lost = true;
        }
      };
      const interval = setInterval(
        () => void renew(),
        Math.max(1, Math.floor(this.options.ttlMs / 3))
      );
      interval.unref();

      const guard: WorkspaceQuotaGuard = {
        assertHeld: async () => {
          if (lost) this.unavailable('Workspace quota lock was lost');
          const current = await this.redis(
            () => this.options.redis.get(key),
            'verify'
          );
          if (current !== token) {
            lost = true;
            this.unavailable('Workspace quota lock was lost');
          }
        }
      };

      try {
        return await callback(guard);
      } finally {
        clearInterval(interval);
      }
    } catch (error) {
      if (error instanceof SandboxError) throw error;
      return this.unavailable(
        'Workspace quota scheduler is unavailable',
        error
      );
    } finally {
      if (acquired) {
        await this.options.redis
          .eval(RELEASE_SCRIPT, 1, key, token)
          .catch(() => undefined);
      }
    }
  }

  private async redis<T>(
    operation: () => Promise<T>,
    action: string
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      this.unavailable(`Workspace quota lock ${action} failed`, error);
    }
  }

  private unavailable(message: string, cause?: unknown): never {
    throw new SandboxError(
      'SANDBOX_SCHEDULER_UNAVAILABLE',
      message,
      true,
      cause
    );
  }
}
