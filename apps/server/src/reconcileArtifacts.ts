import dotenv from 'dotenv';
import { constants } from 'node:fs';
import { access, lstat, open } from 'node:fs/promises';
import mongoose from 'mongoose';
import { ArtifactService } from './artifacts/artifactService';
import { getArtifactConfig } from './artifacts/config';
import { reconcileArtifacts } from './artifacts/reconciler';
import { SharedFilesystemArtifactStore } from './artifacts/SharedFilesystemArtifactStore';

const assertArtifactRootReady = async (root: string): Promise<void> => {
  const stats = await lstat(root);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error('Artifact root must be a pre-created directory');
  }
  await access(root, constants.R_OK | constants.W_OK);

  const handle = await open(root, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
};

const main = async (): Promise<void> => {
  dotenv.config();
  const config = getArtifactConfig();
  const mongoUri =
    process.env.MONGODB_URI || 'mongodb://localhost:27017/v0-by-kimi';

  await assertArtifactRootReady(config.root);
  await mongoose.connect(mongoUri);

  try {
    const store = new SharedFilesystemArtifactStore(config.root);
    const service = new ArtifactService(store, config);
    const result = await reconcileArtifacts({
      service,
      store,
      writingTimeoutMs: config.writingTimeoutMs,
      orphanRetentionMs: config.orphanRetentionMs
    });
    console.log(JSON.stringify({
      event: 'artifact_reconciliation_completed',
      ...result
    }));
  } finally {
    await mongoose.disconnect();
  }
};

void main().catch(() => {
  console.error('Artifact reconciliation failed');
  process.exitCode = 1;
});
