import { ArtifactManifest, type IArtifactManifest } from '../models/ArtifactManifest';
import { ProjectSnapshot } from '../models/ProjectSnapshot';
import { ValidationCandidate } from '../models/ValidationCandidate';
import { SandboxLease } from '../models/SandboxLease';
import type { ArtifactStore } from './ArtifactStore';
import type { ArtifactService } from './artifactService';
import { ArtifactError } from './types';

export const RECONCILER_BATCH_SIZE = 100;

export interface ReconcileArtifactsInput {
  service: ArtifactService;
  store: ArtifactStore;
  now?: Date;
  writingTimeoutMs: number;
  orphanRetentionMs: number;
}

export interface ReconcileArtifactsResult {
  promoted: number;
  corrupted: number;
  deleted: number;
  preserved: number;
}

const isStoreUnavailable = (error: unknown): boolean =>
  error instanceof ArtifactError &&
  error.code === 'ARTIFACT_STORE_UNAVAILABLE';

const corruptionCode = (error: unknown): string =>
  error instanceof ArtifactError ? error.code : 'ARTIFACT_CORRUPT';

const markCorrupt = async (
  manifest: IArtifactManifest,
  error: unknown
): Promise<boolean> => {
  const result = await ArtifactManifest.updateOne(
    { artifactId: manifest.artifactId, state: 'writing' },
    {
      $set: {
        state: 'corrupt',
        errorCode: corruptionCode(error)
      }
    }
  );
  return result.modifiedCount === 1;
};

const reconcileWriting = async (
  input: ReconcileArtifactsInput,
  cutoff: Date,
  result: ReconcileArtifactsResult
): Promise<void> => {
  const cursor = ArtifactManifest.find({
    state: 'writing',
    updatedAt: { $lte: cutoff }
  })
    .sort({ _id: 1 })
    .limit(RECONCILER_BATCH_SIZE)
    .lean()
    .cursor({ batchSize: RECONCILER_BATCH_SIZE });

  for await (const manifest of cursor) {
    try {
      const stats = await input.store.stat(manifest.storageKey);
      if (stats.size !== manifest.compressedBytes) {
        const mismatch = new ArtifactError(
          'ARTIFACT_CORRUPT',
          'Artifact compressed size does not match its manifest',
          false
        );
        if (await markCorrupt(manifest, mismatch)) result.corrupted += 1;
        continue;
      }
      await input.service.verifyManifestBundle(manifest);
      const promoted = await ArtifactManifest.updateOne(
        { artifactId: manifest.artifactId, state: 'writing' },
        { $set: { state: 'ready' }, $unset: { errorCode: 1 } }
      );
      if (promoted.modifiedCount === 1) result.promoted += 1;
    } catch (error) {
      if (isStoreUnavailable(error)) {
        continue;
      }
      if (await markCorrupt(manifest, error)) result.corrupted += 1;
    }
  }
};

const hasReference = async (artifactId: string): Promise<boolean> => {
  const [snapshot, candidate, lease] = await Promise.all([
    ProjectSnapshot.exists({ artifactId }),
    ValidationCandidate.exists({ artifactId }),
    SandboxLease.exists({
      'sourceArtifact.artifactId': artifactId,
      state: { $ne: 'terminated' }
    })
  ]);
  return snapshot !== null || candidate !== null || lease !== null;
};

const deletePendingManifest = async (
  input: ReconcileArtifactsInput,
  manifest: IArtifactManifest,
  result: ReconcileArtifactsResult
): Promise<void> => {
  if (await hasReference(manifest.artifactId)) {
    const restored = await ArtifactManifest.updateOne(
      { artifactId: manifest.artifactId, state: 'delete_pending' },
      { $set: { state: 'ready' } }
    );
    if (restored.modifiedCount === 1) result.preserved += 1;
    return;
  }

  try {
    await input.store.delete(manifest.storageKey);
  } catch (error) {
    if (isStoreUnavailable(error)) return;
    throw error;
  }
  const deleted = await ArtifactManifest.deleteOne({
    artifactId: manifest.artifactId,
    state: 'delete_pending'
  });
  if (deleted.deletedCount === 1) result.deleted += 1;
};

const reconcileReady = async (
  input: ReconcileArtifactsInput,
  cutoff: Date,
  result: ReconcileArtifactsResult
): Promise<void> => {
  const cursor = ArtifactManifest.find({
    state: 'ready',
    updatedAt: { $lte: cutoff }
  })
    .sort({ _id: 1 })
    .limit(RECONCILER_BATCH_SIZE)
    .lean()
    .cursor({ batchSize: RECONCILER_BATCH_SIZE });

  for await (const manifest of cursor) {
    if (await hasReference(manifest.artifactId)) {
      result.preserved += 1;
      continue;
    }
    const claimed = await ArtifactManifest.updateOne(
      { artifactId: manifest.artifactId, state: 'ready' },
      { $set: { state: 'delete_pending' } }
    );
    if (claimed.modifiedCount !== 1) continue;
    await deletePendingManifest(input, manifest, result);
  }
};

const reconcileDeletePending = async (
  input: ReconcileArtifactsInput,
  result: ReconcileArtifactsResult
): Promise<void> => {
  const cursor = ArtifactManifest.find({ state: 'delete_pending' })
    .sort({ _id: 1 })
    .limit(RECONCILER_BATCH_SIZE)
    .lean()
    .cursor({ batchSize: RECONCILER_BATCH_SIZE });

  for await (const manifest of cursor) {
    await deletePendingManifest(input, manifest, result);
  }
};

export const reconcileArtifacts = async (
  input: ReconcileArtifactsInput
): Promise<ReconcileArtifactsResult> => {
  const now = input.now ?? new Date();
  const result: ReconcileArtifactsResult = {
    promoted: 0,
    corrupted: 0,
    deleted: 0,
    preserved: 0
  };

  await reconcileWriting(
    input,
    new Date(now.getTime() - input.writingTimeoutMs),
    result
  );
  await reconcileDeletePending(input, result);
  await reconcileReady(
    input,
    new Date(now.getTime() - input.orphanRetentionMs),
    result
  );
  return result;
};
