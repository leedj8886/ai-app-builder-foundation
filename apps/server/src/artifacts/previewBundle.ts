import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { gzip, gunzip } from 'node:zlib';
import {
  ArtifactError,
  type ArtifactIntegrity,
  type ArtifactLimits,
  type EncodedArtifact,
  type PreviewArtifactBundleV1,
  type PreviewArtifactFile
} from './types';

const artifactFormat = 'open-v0.bundle+json+gzip' as const;
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const contentTypes = new Map<string, string>([
  ['.avif', 'image/avif'],
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.mp3', 'audio/mpeg'],
  ['.mp4', 'video/mp4'],
  ['.ogg', 'audio/ogg'],
  ['.pdf', 'application/pdf'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.ttf', 'font/ttf'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.wasm', 'application/wasm'],
  ['.webm', 'video/webm'],
  ['.webmanifest', 'application/manifest+json'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.xml', 'application/xml']
]);

const fail = (
  code: ConstructorParameters<typeof ArtifactError>[0],
  message: string,
  cause?: unknown
): never => {
  throw new ArtifactError(code, message, false, cause);
};

const validateLimit = (value: number, name: string): void => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail('ARTIFACT_INVALID_BUNDLE', `${name} must be a positive safe integer`);
  }
};

const validateLimits = (limits: ArtifactLimits): void => {
  validateLimit(limits.maxCompressedBytes, 'maxCompressedBytes');
  validateLimit(limits.maxUncompressedBytes, 'maxUncompressedBytes');
  validateLimit(limits.maxFiles, 'maxFiles');
};

export const canonicalPreviewPath = (input: unknown): string => {
  if (typeof input !== 'string' || input.length === 0 || input !== input.trim()) {
    fail('ARTIFACT_INVALID_PATH', 'Preview file path must be a non-empty string');
  }
  const normalized = (input as string).replace(/\\/g, '/');
  const segments = normalized.split('/');
  if (
    normalized.startsWith('/') ||
    /^[a-zA-Z]:\//.test(normalized) ||
    normalized.includes('\0') ||
    segments.some(segment => segment === '' || segment === '.' || segment === '..')
  ) {
    fail('ARTIFACT_INVALID_PATH', `Unsafe preview file path: ${input as string}`);
  }
  return normalized;
};

export const previewContentTypeForPath = (input: string): string => {
  const path = canonicalPreviewPath(input);
  const dot = path.lastIndexOf('.');
  const extension = dot === -1 ? '' : path.slice(dot).toLowerCase();
  const contentType = contentTypes.get(extension);
  if (!contentType) {
    return fail('ARTIFACT_INVALID_PATH', `Unsupported preview file type: ${path}`);
  }
  return contentType;
};

const canonicalBase64 = (input: unknown): string => {
  if (typeof input !== 'string') {
    return fail('ARTIFACT_INVALID_BUNDLE', 'Preview file content must be base64 text');
  }
  const bytes = Buffer.from(input, 'base64');
  if (bytes.toString('base64') !== input) {
    fail('ARTIFACT_INVALID_BUNDLE', 'Preview file content is not canonical base64');
  }
  return input;
};

const canonicalFile = (input: unknown): PreviewArtifactFile => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    fail('ARTIFACT_INVALID_BUNDLE', 'Preview files must be objects');
  }
  const value = input as Record<string, unknown>;
  const path = canonicalPreviewPath(value.path);
  const contentType = previewContentTypeForPath(path);
  if (value.contentType !== contentType) {
    fail('ARTIFACT_INVALID_BUNDLE', `Preview content type does not match path: ${path}`);
  }
  return {
    path,
    contentBase64: canonicalBase64(value.contentBase64),
    contentType
  };
};

const canonicalizeBundle = (input: unknown): PreviewArtifactBundleV1 => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    fail('ARTIFACT_INVALID_BUNDLE', 'Preview bundle must be an object');
  }
  const value = input as Record<string, unknown>;
  if (
    value.version !== 1 ||
    value.entryPath !== 'index.html' ||
    !Array.isArray(value.files)
  ) {
    fail('ARTIFACT_INVALID_BUNDLE', 'Preview bundle version, entry, or files are invalid');
  }

  const files = (value.files as unknown[]).map(canonicalFile);
  const paths = new Set<string>();
  for (const file of files) {
    if (paths.has(file.path)) {
      fail('ARTIFACT_INVALID_PATH', `Duplicate preview path: ${file.path}`);
    }
    paths.add(file.path);
  }
  if (!paths.has('index.html')) {
    fail('ARTIFACT_INVALID_BUNDLE', 'Preview bundle is missing index.html');
  }
  files.sort((left, right) => compareText(left.path, right.path));
  return { version: 1, entryPath: 'index.html', files };
};

const digest = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

const enforceFileCount = (input: unknown, limits: ArtifactLimits): void => {
  if (
    typeof input === 'object' &&
    input !== null &&
    'files' in input &&
    Array.isArray(input.files) &&
    input.files.length > limits.maxFiles
  ) {
    fail('ARTIFACT_LIMIT_EXCEEDED', 'Preview artifact exceeds the file-count limit');
  }
};

export const createPreviewArtifactBundle = (
  files: Array<{ path: string; content: Uint8Array }>
): PreviewArtifactBundleV1 => ({
  version: 1,
  entryPath: 'index.html',
  files: files.map(file => {
    const path = canonicalPreviewPath(file.path);
    return {
      path,
      contentBase64: Buffer.from(file.content).toString('base64'),
      contentType: previewContentTypeForPath(path)
    };
  })
});

export const encodePreviewArtifact = async (
  bundle: PreviewArtifactBundleV1,
  limits: ArtifactLimits
): Promise<EncodedArtifact> => {
  validateLimits(limits);
  enforceFileCount(bundle, limits);
  const canonical = canonicalizeBundle(bundle);
  const uncompressedBytes = Buffer.from(JSON.stringify(canonical), 'utf8');
  if (uncompressedBytes.byteLength > limits.maxUncompressedBytes) {
    fail('ARTIFACT_LIMIT_EXCEEDED', 'Preview artifact exceeds the uncompressed-size limit');
  }
  const sha256 = digest(uncompressedBytes);
  const compressedBytes = await gzipAsync(uncompressedBytes, { level: 9 });
  if (compressedBytes.byteLength > limits.maxCompressedBytes) {
    fail('ARTIFACT_LIMIT_EXCEEDED', 'Preview artifact exceeds the compressed-size limit');
  }
  return {
    compressedBytes,
    uncompressedBytes,
    sha256,
    manifest: {
      format: artifactFormat,
      formatVersion: 1,
      sha256,
      uncompressedBytes: uncompressedBytes.byteLength,
      compressedBytes: compressedBytes.byteLength,
      fileCount: canonical.files.length
    }
  };
};

export const decodePreviewArtifact = async (
  compressedBytes: Uint8Array,
  manifest: ArtifactIntegrity,
  limits: ArtifactLimits
): Promise<PreviewArtifactBundleV1> => {
  validateLimits(limits);
  if (manifest.format !== artifactFormat || manifest.formatVersion !== 1) {
    fail('ARTIFACT_FORMAT_UNSUPPORTED', 'Preview artifact format is unsupported');
  }
  if (
    !Number.isSafeInteger(manifest.compressedBytes) ||
    manifest.compressedBytes !== compressedBytes.byteLength ||
    compressedBytes.byteLength > limits.maxCompressedBytes
  ) {
    fail('ARTIFACT_CORRUPT', 'Preview artifact compressed length is invalid');
  }

  let uncompressedBytes: Buffer;
  try {
    uncompressedBytes = await gunzipAsync(Buffer.from(compressedBytes), {
      maxOutputLength: limits.maxUncompressedBytes
    });
  } catch (error) {
    return fail('ARTIFACT_CORRUPT', 'Preview artifact gzip data is corrupt', error);
  }
  if (
    manifest.uncompressedBytes !== uncompressedBytes.byteLength ||
    digest(uncompressedBytes) !== manifest.sha256
  ) {
    fail('ARTIFACT_CORRUPT', 'Preview artifact integrity check failed');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(uncompressedBytes));
  } catch (error) {
    fail('ARTIFACT_CORRUPT', 'Preview artifact JSON is corrupt', error);
  }
  enforceFileCount(parsed, limits);
  let canonical: PreviewArtifactBundleV1;
  try {
    canonical = canonicalizeBundle(parsed);
  } catch (error) {
    if (error instanceof ArtifactError) {
      fail('ARTIFACT_CORRUPT', 'Preview artifact bundle structure is invalid', error);
    }
    throw error;
  }
  if (manifest.fileCount !== canonical.files.length) {
    fail('ARTIFACT_CORRUPT', 'Preview artifact file count is invalid');
  }
  return canonical;
};
