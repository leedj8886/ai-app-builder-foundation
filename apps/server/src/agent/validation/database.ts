export interface ValidationDatabaseConnectionRef {
  databaseUrl: string;
  shadowDatabaseUrl: string;
}

export interface ValidationDatabaseLease {
  id: string;
  expiresAt: Date;
  connection: ValidationDatabaseConnectionRef;
  destroy(): Promise<void>;
}

export interface ValidationDatabase {
  create(input: {
    runId: string;
    signal?: AbortSignal;
  }): Promise<ValidationDatabaseLease>;
  reconcile?(): Promise<void>;
  shutdown?(): Promise<void>;
}

export const validationDatabaseEnvironment = (
  lease: ValidationDatabaseLease
): Record<'DATABASE_URL' | 'SHADOW_DATABASE_URL', string> => ({
  DATABASE_URL: lease.connection.databaseUrl,
  SHADOW_DATABASE_URL: lease.connection.shadowDatabaseUrl
});

export const redactValidationSecrets = (
  value: string,
  lease?: ValidationDatabaseLease
): string => {
  const exact = lease
    ? [
        lease.connection.databaseUrl,
        lease.connection.shadowDatabaseUrl
      ].reduce(
        (redacted, secret) => redacted.split(secret).join('[REDACTED]'),
        value
      )
    : value;
  return exact.replace(
    /postgres(?:ql)?:\/\/[^\s"'<>]+/gi,
    '[REDACTED]'
  );
};
