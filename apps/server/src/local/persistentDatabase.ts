import { Pool, type PoolConfig } from 'pg';

export interface PersistentDatabaseLease {
  databaseUrl: string;
  schema: string;
}

export interface PersistentDatabaseOptions {
  adminUrl?: string;
  poolConfig?: PoolConfig;
}

const schemaForProject = (projectId: string): string => {
  const normalized = projectId.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!/^[a-f0-9]{8,64}$/.test(normalized)) {
    throw new Error('Project id is not safe for a persistent database schema');
  }
  return `app_${normalized}`;
};

export class LocalPersistentDatabase {
  private pool?: Pool;

  constructor(private readonly options: PersistentDatabaseOptions = {}) {}

  private getPool(): Pool {
    if (this.pool) return this.pool;
    const adminUrl = this.options.adminUrl ?? process.env.LOCAL_PERSISTENT_DATABASE_URL;
    if (!adminUrl) {
      throw new Error(
        'LOCAL_PERSISTENT_DATABASE_URL is required for full-stack local previews'
      );
    }
    this.pool = new Pool({ connectionString: adminUrl, ...this.options.poolConfig });
    return this.pool;
  }

  async ensure(projectId: string): Promise<PersistentDatabaseLease> {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Local persistent databases are disabled in production');
    }
    const schema = schemaForProject(projectId);
    const pool = this.getPool();
    await pool.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    const adminUrl = this.options.adminUrl ?? process.env.LOCAL_PERSISTENT_DATABASE_URL!;
    const databaseUrl = new URL(adminUrl);
    databaseUrl.searchParams.set('schema', schema);
    return { databaseUrl: databaseUrl.toString(), schema };
  }

  async close(): Promise<void> {
    await this.pool?.end();
    this.pool = undefined;
  }
}

export { schemaForProject };
