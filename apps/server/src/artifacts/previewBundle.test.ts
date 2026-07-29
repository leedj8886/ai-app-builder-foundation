import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPreviewArtifactBundle,
  decodePreviewArtifact,
  encodePreviewArtifact
} from './previewBundle';
import { ArtifactError } from './types';

const limits = {
  maxUncompressedBytes: 1024 * 1024,
  maxCompressedBytes: 1024 * 1024,
  maxFiles: 100
};

test('Preview Artifact round-trips binary-safe verified build output', async () => {
  const bundle = createPreviewArtifactBundle([
    {
      path: 'assets/app.js',
      content: new TextEncoder().encode('document.body.textContent = "ok";')
    },
    {
      path: 'index.html',
      content: new TextEncoder().encode(
        '<script type="module" src="./assets/app.js"></script>'
      )
    },
    {
      path: 'assets/pixel.png',
      content: new Uint8Array([0, 255, 1, 2, 3])
    }
  ]);
  const encoded = await encodePreviewArtifact(bundle, limits);
  const decoded = await decodePreviewArtifact(
    encoded.compressedBytes,
    encoded.manifest,
    limits
  );

  assert.deepEqual(decoded, {
    version: 1,
    entryPath: 'index.html',
    files: [...bundle.files].sort((left, right) =>
      left.path.localeCompare(right.path)
    )
  });
});

test('Preview Artifact rejects traversal unsupported files and missing entry', async () => {
  assert.throws(
    () => createPreviewArtifactBundle([
      { path: '../index.html', content: new Uint8Array() }
    ]),
    (error) =>
      error instanceof ArtifactError &&
      error.code === 'ARTIFACT_INVALID_PATH'
  );
  assert.throws(
    () => createPreviewArtifactBundle([
      { path: 'payload.exe', content: new Uint8Array() }
    ]),
    (error) =>
      error instanceof ArtifactError &&
      error.code === 'ARTIFACT_INVALID_PATH'
  );
  await assert.rejects(
    encodePreviewArtifact(createPreviewArtifactBundle([
      { path: 'assets/app.js', content: new Uint8Array() }
    ]), limits),
    /missing index\.html/
  );
});

test('Preview Artifact integrity rejects modified content', async () => {
  const encoded = await encodePreviewArtifact(createPreviewArtifactBundle([
    {
      path: 'index.html',
      content: new TextEncoder().encode('<main>verified</main>')
    }
  ]), limits);
  const damaged = new Uint8Array(encoded.compressedBytes);
  damaged[Math.floor(damaged.length / 2)] ^= 0xff;

  await assert.rejects(
    decodePreviewArtifact(damaged, encoded.manifest, limits),
    (error) =>
      error instanceof ArtifactError &&
      error.code === 'ARTIFACT_CORRUPT'
  );
});
