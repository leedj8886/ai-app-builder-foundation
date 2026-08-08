import { randomBytes, randomUUID } from 'node:crypto';
import {
  GenericContainer,
  Wait,
  type StartedTestContainer
} from 'testcontainers';
import { throwIfAborted } from '../runCancellation';
import type {
  ValidationDatabase,
  ValidationDatabaseLease
} from './database';

interface TestcontainersValidationDatabaseOptions {
  image?: string;
  ttlMs?: number;
  hostOverride?: string;
}

const safeRunName = (runId: string): string =>
  runId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48) || 'validation';

export class TestcontainersValidationDatabase implements ValidationDatabase {
  private readonly active = new Map<
    string,
    {
      container: StartedTestContainer;
      expiresAt: number;
      timer: NodeJS.Timeout;
    }
  >();

  constructor(
    private readonly options: TestcontainersValidationDatabaseOptions = {}
  ) {}

  private async destroy(id: string): Promise<void> {
    const active = this.active.get(id);
    if (!active) return;
    await active.container.stop();
    clearTimeout(active.timer);
    this.active.delete(id);
  }

  async create(input: {
    runId: string;
    signal?: AbortSignal;
  }): Promise<ValidationDatabaseLease> {
    throwIfAborted(input.signal);
    const id = `${safeRunName(input.runId)}-${randomUUID()}`;
    const password = randomBytes(24).toString('base64url');
    const primaryDatabase = 'validation_primary';
    const shadowDatabase = 'validation_shadow';
    let container: StartedTestContainer | undefined;
    try {
      container = await new GenericContainer(
        this.options.image ?? 'postgres:16-alpine'
      )
        .withEnvironment({
          POSTGRES_USER: 'validation',
          POSTGRES_PASSWORD: password,
          POSTGRES_DB: primaryDatabase
        })
        .withExposedPorts(5432)
        .withWaitStrategy(
          Wait.forLogMessage(/database system is ready to accept connections/)
        )
        .start();
      throwIfAborted(input.signal);
      const created = await container.exec([
        'createdb',
        '-U',
        'validation',
        shadowDatabase
      ]);
      if (created.exitCode !== 0) {
        throw new Error('Validation shadow database could not be created');
      }
      throwIfAborted(input.signal);

      const ttlMs = this.options.ttlMs ?? 10 * 60 * 1_000;
      const host = this.options.hostOverride ?? container.getHost();
      const port = container.getMappedPort(5432);
      const authority = `validation:${encodeURIComponent(password)}@${host}:${port}`;
      const timer = setTimeout(() => {
        void this.destroy(id).catch(() => undefined);
      }, ttlMs);
      timer.unref();
      const expiresAt = Date.now() + ttlMs;
      this.active.set(id, { container, expiresAt, timer });

      return {
        id,
        expiresAt: new Date(expiresAt),
        connection: {
          databaseUrl: `postgresql://${authority}/${primaryDatabase}?schema=public`,
          shadowDatabaseUrl: `postgresql://${authority}/${shadowDatabase}?schema=public`
        },
        destroy: () => this.destroy(id)
      };
    } catch {
      await container?.stop().catch(() => undefined);
      throwIfAborted(input.signal);
      throw new Error('Validation database provisioning failed');
    }
  }

  async reconcile(): Promise<void> {
    await Promise.allSettled(
      [...this.active.entries()]
        .filter(([, active]) => active.expiresAt <= Date.now())
        .map(([id]) => this.destroy(id))
    );
  }

  async shutdown(): Promise<void> {
    await Promise.allSettled(
      [...this.active.keys()].map(id => this.destroy(id))
    );
  }
}
