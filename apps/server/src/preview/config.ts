export interface PreviewConfig {
  publicOrigin: string;
  clientOrigin: string;
  signingSecret: string;
  tokenTtlSeconds: number;
}

const origin = (value: string, name: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute HTTP(S) origin`);
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`${name} must be an absolute HTTP(S) origin`);
  }
  return parsed.origin;
};

export const getPreviewConfig = (
  env: Record<string, string | undefined> = process.env
): PreviewConfig => {
  const publicOrigin = origin(
    env.PREVIEW_PUBLIC_ORIGIN ?? `http://localhost:${env.PORT ?? '3001'}`,
    'PREVIEW_PUBLIC_ORIGIN'
  );
  const clientOrigin = origin(
    env.CLIENT_URL ?? 'http://localhost:5173',
    'CLIENT_URL'
  );
  if (publicOrigin === clientOrigin) {
    throw new Error(
      'PREVIEW_PUBLIC_ORIGIN must be isolated from CLIENT_URL'
    );
  }
  const signingSecret = env.JWT_SECRET?.trim() || 'your-secret-key';
  if (env.NODE_ENV === 'production' && signingSecret === 'your-secret-key') {
    throw new Error('JWT_SECRET must be configured in production');
  }
  return {
    publicOrigin,
    clientOrigin,
    signingSecret,
    tokenTtlSeconds: 10 * 60
  };
};
