import type { ArtifactLimits } from './types';

export interface ArtifactConfig {
  driver: 'shared-filesystem';
  root: string;
  limits: ArtifactLimits;
  writingTimeoutMs: number;
  orphanRetentionMs: number;
}

const positive = (value: string | undefined, fallback: number, name: string) => {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return parsed;
};

export const getArtifactConfig = (
  env: Record<string, string | undefined> = process.env
): ArtifactConfig => {
  const driver = env.ARTIFACT_STORE_DRIVER ?? 'shared-filesystem';
  if (driver !== 'shared-filesystem') {
    throw new Error(
      'ARTIFACT_STORE_DRIVER must be "shared-filesystem"'
    );
  }

  const root =
    env.ARTIFACT_STORE_ROOT === undefined
      ? '/var/lib/open-v0/artifacts'
      : env.ARTIFACT_STORE_ROOT.trim();
  if (root.length === 0) {
    throw new Error('ARTIFACT_STORE_ROOT must be a non-empty path');
  }

  return {
    driver,
    root,
    limits: {
      maxUncompressedBytes: positive(
        env.ARTIFACT_MAX_BUNDLE_BYTES,
        50 * 1024 * 1024,
        'ARTIFACT_MAX_BUNDLE_BYTES'
      ),
      maxCompressedBytes: positive(
        env.ARTIFACT_MAX_COMPRESSED_BYTES,
        20 * 1024 * 1024,
        'ARTIFACT_MAX_COMPRESSED_BYTES'
      ),
      maxFiles: positive(env.ARTIFACT_MAX_FILES, 5_000, 'ARTIFACT_MAX_FILES')
    },
    writingTimeoutMs: positive(
      env.ARTIFACT_WRITING_TIMEOUT_MS,
      5 * 60 * 1_000,
      'ARTIFACT_WRITING_TIMEOUT_MS'
    ),
    orphanRetentionMs: positive(
      env.ARTIFACT_ORPHAN_RETENTION_MS,
      24 * 60 * 60 * 1_000,
      'ARTIFACT_ORPHAN_RETENTION_MS'
    )
  };
};
