import { randomUUID } from 'node:crypto';
import type { Types } from 'mongoose';
import {
  ArtifactManifest,
  type ArtifactKind,
  type IArtifactManifest
} from '../models/ArtifactManifest';
import type { ArtifactStore } from './ArtifactStore';
import { decodeProjectArtifact, encodeProjectArtifact } from './bundle';
import {
  decodePreviewArtifact,
  encodePreviewArtifact
} from './previewBundle';
import type { ArtifactConfig } from './config';
import {
  ArtifactError,
  type ArtifactIntegrity,
  type EncodedArtifact,
  type PreviewArtifactBundleV1,
  type ProjectArtifactBundle
} from './types';

type ProjectArtifactKind = Exclude<ArtifactKind, 'preview_build'>;

interface ArtifactWriteMetadata {
  workspaceId: Types.ObjectId;
  projectId: Types.ObjectId;
  createdByRunId: Types.ObjectId;
  kind: ArtifactKind;
  idempotencyKey: string;
}

export interface WriteArtifactBundleInput
  extends Omit<ArtifactWriteMetadata, 'kind'> {
  kind: ProjectArtifactKind;
  bundle: ProjectArtifactBundle;
}

export interface WrittenArtifact {
  artifactId: string;
}

export interface WritePreviewArtifactBundleInput
  extends Omit<ArtifactWriteMetadata, 'kind'> {
  kind: 'preview_build';
  bundle: PreviewArtifactBundleV1;
}

const storageKeyFor = (artifactId: string) =>
  `v1/${artifactId.slice(0, 2)}/${artifactId.slice(2, 4)}/${artifactId}.json.gz`;

const isDuplicateKey = (error: unknown): boolean =>
  error instanceof Error &&
  'code' in error &&
  (error as Error & { code?: number }).code === 11000;

const hasCauseCode = (error: ArtifactError, code: string): boolean =>
  error.cause instanceof Error &&
  'code' in error.cause &&
  (error.cause as Error & { code?: string }).code === code;

const isRecoverableExistingBlob = (error: unknown): boolean =>
  error instanceof ArtifactError &&
  error.code === 'ARTIFACT_WRITE_FAILED' &&
  hasCauseCode(error, 'EEXIST');

const isContentVerificationError = (error: unknown): error is ArtifactError =>
  error instanceof ArtifactError &&
  (
    error.code === 'ARTIFACT_CORRUPT' ||
    error.code === 'ARTIFACT_FORMAT_UNSUPPORTED'
  );

const integrityFor = (manifest: IArtifactManifest): ArtifactIntegrity => ({
  format: manifest.format,
  formatVersion: manifest.formatVersion,
  sha256: manifest.sha256,
  uncompressedBytes: manifest.uncompressedBytes,
  compressedBytes: manifest.compressedBytes,
  fileCount: manifest.fileCount
});

const artifactError = (
  code: ConstructorParameters<typeof ArtifactError>[0],
  message: string,
  cause?: unknown
) => new ArtifactError(code, message, false, cause);

export class ArtifactService {
  constructor(
    private readonly store: ArtifactStore,
    private readonly config: ArtifactConfig
  ) {}

  async writeBundle(input: WriteArtifactBundleInput): Promise<WrittenArtifact> {
    const encoded = await encodeProjectArtifact(input.bundle, this.config.limits);
    return this.writeEncoded(input, encoded);
  }

  async writePreviewBundle(
    input: WritePreviewArtifactBundleInput
  ): Promise<WrittenArtifact> {
    const encoded = await encodePreviewArtifact(input.bundle, this.config.limits);
    return this.writeEncoded(input, encoded);
  }

  private async writeEncoded(
    input: ArtifactWriteMetadata,
    encoded: EncodedArtifact
  ): Promise<WrittenArtifact> {
    const manifest = await this.createOrLoadManifest(input, encoded);

    if (manifest.sha256 !== encoded.sha256) {
      throw artifactError(
        'ARTIFACT_IDEMPOTENCY_CONFLICT',
        'The idempotency key already identifies different artifact content'
      );
    }
    if (manifest.state === 'corrupt') {
      throw artifactError('ARTIFACT_CORRUPT', 'The artifact is corrupt');
    }
    if (manifest.state === 'delete_pending') {
      throw artifactError(
        'ARTIFACT_NOT_FOUND',
        'The artifact is pending deletion'
      );
    }
    if (manifest.state === 'ready') {
      await this.verifyStoredByKind(manifest);
      return { artifactId: manifest.artifactId };
    }

    try {
      await this.store.put({
        storageKey: manifest.storageKey,
        bytes: encoded.compressedBytes
      });
    } catch (error) {
      if (!isRecoverableExistingBlob(error)) throw error;
      // A no-clobber put can report EEXIST after another writer (or a
      // previous crashed writer) has already published the complete Blob.
      try {
        await this.verifyStoredByKind(manifest);
      } catch (verificationError) {
        if (isContentVerificationError(verificationError)) {
          await this.markCorrupt(manifest.artifactId, verificationError);
        }
        throw verificationError;
      }
    }

    try {
      await this.verifyStoredByKind(manifest);
    } catch (error) {
      if (isContentVerificationError(error)) {
        await this.markCorrupt(manifest.artifactId, error);
      }
      throw error;
    }

    const result = await ArtifactManifest.updateOne(
      { artifactId: manifest.artifactId, state: 'writing' },
      { $set: { state: 'ready' }, $unset: { errorCode: 1 } }
    );
    if (result.modifiedCount !== 1) {
      const current = await ArtifactManifest.findOne({
        artifactId: manifest.artifactId
      }).lean();
      if (current?.state !== 'ready' || current.sha256 !== encoded.sha256) {
        throw artifactError(
          'ARTIFACT_WRITE_FAILED',
          'Artifact manifest state changed during publication'
        );
      }
    }
    return { artifactId: manifest.artifactId };
  }

  async readBundle(artifactId: string): Promise<ProjectArtifactBundle> {
    const manifest = await ArtifactManifest.findOne({
      artifactId,
      kind: { $in: ['project_snapshot', 'validation_candidate'] }
    }).lean();
    return this.readManifest(manifest);
  }

  async readOwnedBundle(input: {
    artifactId: string;
    workspaceId: Types.ObjectId;
    projectId: Types.ObjectId;
    kind: ProjectArtifactKind;
  }): Promise<ProjectArtifactBundle> {
    const manifest = await ArtifactManifest.findOne({
      artifactId: input.artifactId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      kind: input.kind
    }).lean();
    return this.readManifest(manifest);
  }

  async readOwnedPreviewBundle(input: {
    artifactId: string;
    workspaceId: Types.ObjectId;
    projectId: Types.ObjectId;
  }): Promise<PreviewArtifactBundleV1> {
    const manifest = await ArtifactManifest.findOne({
      artifactId: input.artifactId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      kind: 'preview_build'
    }).lean();
    if (!manifest) {
      throw artifactError('ARTIFACT_NOT_FOUND', 'Preview artifact manifest not found');
    }
    if (manifest.state === 'corrupt') {
      throw artifactError('ARTIFACT_CORRUPT', 'The preview artifact is corrupt');
    }
    if (manifest.state !== 'ready') {
      throw artifactError('ARTIFACT_NOT_FOUND', 'Preview artifact is not ready');
    }
    try {
      return await this.verifyStoredPreview(manifest);
    } catch (error) {
      if (!isContentVerificationError(error)) throw error;
      await this.markCorrupt(manifest.artifactId, error, 'ready');
      throw artifactError(
        'ARTIFACT_CORRUPT',
        'Preview artifact content failed verification',
        error
      );
    }
  }

  async verifyManifestBundle(
    manifest: IArtifactManifest
  ): Promise<ProjectArtifactBundle | PreviewArtifactBundleV1> {
    return this.verifyStoredByKind(manifest);
  }

  private async readManifest(
    manifest: IArtifactManifest | null
  ): Promise<ProjectArtifactBundle> {
    if (!manifest) {
      throw artifactError('ARTIFACT_NOT_FOUND', 'Artifact manifest not found');
    }
    if (manifest.state === 'corrupt') {
      throw artifactError('ARTIFACT_CORRUPT', 'The artifact is corrupt');
    }
    if (manifest.state !== 'ready') {
      throw artifactError('ARTIFACT_NOT_FOUND', 'Artifact is not ready');
    }

    try {
      return await this.verifyStored(manifest);
    } catch (error) {
      if (!isContentVerificationError(error)) throw error;
      await this.markCorrupt(manifest.artifactId, error, 'ready');
      if (error.code === 'ARTIFACT_FORMAT_UNSUPPORTED') throw error;
      throw artifactError(
        'ARTIFACT_CORRUPT',
        'Artifact content failed verification',
        error
      );
    }
  }

  private async createOrLoadManifest(
    input: ArtifactWriteMetadata,
    encoded: EncodedArtifact
  ): Promise<IArtifactManifest> {
    const artifactId = randomUUID().replaceAll('-', '').toLowerCase();
    try {
      return (await ArtifactManifest.create({
        artifactId,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        createdByRunId: input.createdByRunId,
        kind: input.kind,
        idempotencyKey: input.idempotencyKey,
        ...encoded.manifest,
        storageKey: storageKeyFor(artifactId),
        state: 'writing'
      })).toObject();
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      const existing = await ArtifactManifest.findOne({
        idempotencyKey: input.idempotencyKey
      }).lean();
      if (!existing) throw error;
      return existing;
    }
  }

  private async verifyStored(
    manifest: IArtifactManifest
  ): Promise<ProjectArtifactBundle> {
    const bytes = await this.store.get(manifest.storageKey);
    return decodeProjectArtifact(
      bytes,
      integrityFor(manifest),
      this.config.limits
    );
  }

  private async verifyStoredPreview(
    manifest: IArtifactManifest
  ): Promise<PreviewArtifactBundleV1> {
    const bytes = await this.store.get(manifest.storageKey);
    return decodePreviewArtifact(
      bytes,
      integrityFor(manifest),
      this.config.limits
    );
  }

  private verifyStoredByKind(
    manifest: IArtifactManifest
  ): Promise<ProjectArtifactBundle | PreviewArtifactBundleV1> {
    return manifest.kind === 'preview_build'
      ? this.verifyStoredPreview(manifest)
      : this.verifyStored(manifest);
  }

  private async markCorrupt(
    artifactId: string,
    error: unknown,
    expectedState: 'writing' | 'ready' = 'writing'
  ): Promise<void> {
    const errorCode =
      error instanceof ArtifactError ? error.code : 'ARTIFACT_CORRUPT';
    await ArtifactManifest.updateOne(
      { artifactId, state: expectedState },
      { $set: { state: 'corrupt', errorCode } }
    );
  }
}
