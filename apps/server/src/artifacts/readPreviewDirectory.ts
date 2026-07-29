import { lstat, open, readdir } from 'node:fs/promises';
import path from 'node:path';
import { ArtifactError, type PreviewArtifactBundleV1 } from './types';
import { createPreviewArtifactBundle } from './previewBundle';

const MAX_PREVIEW_FILES = 5_000;
const MAX_PREVIEW_BYTES = 40 * 1024 * 1024;

export const readPreviewDirectory = async (
  workspacePath: string
): Promise<PreviewArtifactBundleV1> => {
  const root = path.resolve(workspacePath, 'dist');
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new ArtifactError(
      'ARTIFACT_INVALID_PATH',
      'Build output must be a regular dist directory'
    );
  }

  const files: Array<{ path: string; content: Uint8Array }> = [];
  let totalBytes = 0;
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const info = await lstat(absolutePath);
      if (info.isSymbolicLink()) {
        throw new ArtifactError(
          'ARTIFACT_INVALID_PATH',
          'Build output must not contain symbolic links'
        );
      }
      if (info.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!info.isFile()) {
        throw new ArtifactError(
          'ARTIFACT_INVALID_PATH',
          'Build output contains an unsupported file type'
        );
      }
      if (files.length >= MAX_PREVIEW_FILES) {
        throw new ArtifactError(
          'ARTIFACT_LIMIT_EXCEEDED',
          'Build output exceeds the preview file limit'
        );
      }
      totalBytes += info.size;
      if (totalBytes > MAX_PREVIEW_BYTES) {
        throw new ArtifactError(
          'ARTIFACT_LIMIT_EXCEEDED',
          'Build output exceeds the preview size limit'
        );
      }
      const handle = await open(absolutePath, 'r');
      try {
        files.push({
          path: path.relative(root, absolutePath).split(path.sep).join('/'),
          content: new Uint8Array(await handle.readFile())
        });
      } finally {
        await handle.close();
      }
    }
  };
  await visit(root);
  return createPreviewArtifactBundle(files);
};
