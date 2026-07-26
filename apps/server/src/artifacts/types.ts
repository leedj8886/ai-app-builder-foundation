import type {
  ProjectFileLanguage,
  ProjectSnapshotPackageJson
} from '../agent/types';

export interface ArtifactProjectFile {
  path: string;
  content: string;
  language: ProjectFileLanguage;
  generatedByRunId?: string;
}

export interface ProjectArtifactBundleV1 {
  version: 1;
  files: ArtifactProjectFile[];
  packageJson: ProjectSnapshotPackageJson;
}

export interface ArtifactLimits {
  maxCompressedBytes: number;
  maxUncompressedBytes: number;
  maxFiles: number;
}

export interface ArtifactIntegrity {
  format: 'open-v0.bundle+json+gzip';
  formatVersion: 1;
  sha256: string;
  uncompressedBytes: number;
  compressedBytes: number;
  fileCount: number;
}

export type ArtifactErrorCode =
  | 'ARTIFACT_STORE_UNAVAILABLE'
  | 'ARTIFACT_WRITE_FAILED'
  | 'ARTIFACT_NOT_FOUND'
  | 'ARTIFACT_CORRUPT'
  | 'ARTIFACT_FORMAT_UNSUPPORTED'
  | 'ARTIFACT_LIMIT_EXCEEDED'
  | 'ARTIFACT_INVALID_PATH'
  | 'ARTIFACT_INVALID_BUNDLE'
  | 'ARTIFACT_IDEMPOTENCY_CONFLICT';

export class ArtifactError extends Error {
  readonly code: ArtifactErrorCode;
  readonly retryable: boolean;
  readonly cause?: unknown;

  constructor(
    code: ArtifactErrorCode,
    message: string,
    retryable = false,
    cause?: unknown
  ) {
    super(message, { cause });
    this.name = 'ArtifactError';
    this.code = code;
    this.retryable = retryable;
    this.cause = cause;
  }
}

export interface EncodedProjectArtifact {
  compressedBytes: Uint8Array;
  uncompressedBytes: Uint8Array;
  manifest: ArtifactIntegrity;
  sha256: string;
}
