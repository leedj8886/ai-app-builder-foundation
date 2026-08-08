import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { gzip, gunzip } from 'node:zlib';
import {
  ArtifactProjectFile,
  ArtifactError,
  ArtifactIntegrity,
  ArtifactLimits,
  EncodedProjectArtifact,
  ProjectArtifactBundle,
  ProjectArtifactBundleV1,
  ProjectArtifactBundleV2
} from './types';
import type { ProfileRef } from '../agent/profiles/types';
import {
  projectFileLanguages
} from '../agent/types';

const artifactFormat = 'open-v0.bundle+json+gzip' as const;
const supportedExtension = /\.(ts|tsx|js|cjs|mjs|css|json|html|md|prisma|sql)$/;
const languageSet = new Set<string>(projectFileLanguages);
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

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

const canonicalPath = (input: unknown): string => {
  if (typeof input !== 'string' || input.length === 0 || input !== input.trim()) {
    fail('ARTIFACT_INVALID_PATH', 'Artifact file path must be a non-empty string');
  }

  const rawPath = input as string;
  const normalized = rawPath.replace(/\\/g, '/');
  const segments = normalized.split('/');
  if (
    normalized.startsWith('/') ||
    /^[a-zA-Z]:\//.test(normalized) ||
    normalized.includes('\0') ||
    segments.some(segment => segment === '' || segment === '.' || segment === '..') ||
    !supportedExtension.test(normalized)
  ) {
    fail('ARTIFACT_INVALID_PATH', `Unsafe or unsupported artifact path: ${rawPath}`);
  }
  return normalized;
};

const canonicalMap = (input: unknown, name: string): Record<string, string> => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    fail('ARTIFACT_INVALID_BUNDLE', `${name} must be an object`);
  }

  const entries = Object.entries(input as Record<string, unknown>);
  for (const [key, value] of entries) {
    if (key.trim().length === 0 || typeof value !== 'string' || value.trim().length === 0) {
      fail('ARTIFACT_INVALID_BUNDLE', `${name} must contain non-empty string keys and values`);
    }
  }
  return Object.fromEntries(
    (entries as [string, string][]).sort(([left], [right]) => compareText(left, right))
  );
};

const canonicalPackageJson = (
  input: unknown
): ProjectArtifactBundle['packageJson'] => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    fail('ARTIFACT_INVALID_BUNDLE', 'packageJson must be an object');
  }
  const value = input as Record<string, unknown>;
  return {
    dependencies: canonicalMap(value.dependencies, 'dependencies'),
    devDependencies: canonicalMap(value.devDependencies, 'devDependencies'),
    scripts: canonicalMap(value.scripts, 'scripts')
  };
};

const canonicalProfileRef = (input: unknown): ProfileRef => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    fail('ARTIFACT_INVALID_BUNDLE', 'profile must be an object');
  }
  const value = input as Record<string, unknown>;
  if (
    typeof value.id !== 'string' ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id) ||
    !Number.isSafeInteger(value.version) ||
    (value.version as number) < 1
  ) {
    fail('ARTIFACT_INVALID_BUNDLE', 'profile must contain a stable id and positive version');
  }
  return {
    id: value.id as string,
    version: value.version as number
  };
};

const canonicalRunId = (input: unknown): string => {
  let serialized: unknown = input;
  if (
    typeof input === 'object' &&
    input !== null &&
    (input as { _bsontype?: unknown })._bsontype === 'ObjectId' &&
    typeof (input as { toHexString?: unknown }).toHexString === 'function'
  ) {
    serialized = (input as { toHexString(): unknown }).toHexString();
  }
  if (
    typeof serialized !== 'string' ||
    !/^[a-f\d]{24}$/i.test(serialized)
  ) {
    fail('ARTIFACT_INVALID_BUNDLE', 'generatedByRunId must be an ObjectId string');
  }
  return (serialized as string).toLowerCase();
};

const canonicalFile = (input: unknown): ArtifactProjectFile => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    fail('ARTIFACT_INVALID_BUNDLE', 'Artifact files must be objects');
  }
  const value = input as Record<string, unknown>;
  if (typeof value.content !== 'string' || value.content.includes('\0')) {
    fail('ARTIFACT_INVALID_BUNDLE', 'Artifact file content must be text');
  }
  if (typeof value.language !== 'string' || !languageSet.has(value.language)) {
    fail('ARTIFACT_INVALID_BUNDLE', 'Artifact file language is unsupported');
  }

  return {
    path: canonicalPath(value.path),
    content: value.content as string,
    language: value.language as ArtifactProjectFile['language'],
    ...(value.generatedByRunId === undefined
      ? {}
      : { generatedByRunId: canonicalRunId(value.generatedByRunId) })
  };
};

const canonicalizeBundle = (input: unknown): ProjectArtifactBundle => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    fail('ARTIFACT_INVALID_BUNDLE', 'Artifact bundle must be an object');
  }
  const value = input as Record<string, unknown>;
  if (
    (value.version !== 1 && value.version !== 2) ||
    !Array.isArray(value.files)
  ) {
    fail('ARTIFACT_INVALID_BUNDLE', 'Artifact bundle version or files are invalid');
  }

  const files = (value.files as unknown[]).map(canonicalFile);
  const paths = new Set<string>();
  for (const file of files) {
    if (paths.has(file.path)) {
      fail('ARTIFACT_INVALID_PATH', `Duplicate normalized artifact path: ${file.path}`);
    }
    paths.add(file.path);
  }
  files.sort((left, right) => compareText(left.path, right.path));

  const common = {
    files,
    packageJson: canonicalPackageJson(value.packageJson)
  };
  return value.version === 1
    ? { version: 1, ...common } satisfies ProjectArtifactBundleV1
    : {
        version: 2,
        profile: canonicalProfileRef(value.profile),
        ...common
      } satisfies ProjectArtifactBundleV2;
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
    fail('ARTIFACT_LIMIT_EXCEEDED', 'Artifact exceeds the file-count limit');
  }
};

export const encodeProjectArtifact = async (
  bundle: ProjectArtifactBundle,
  limits: ArtifactLimits
): Promise<EncodedProjectArtifact> => {
  validateLimits(limits);
  enforceFileCount(bundle, limits);
  const canonical = canonicalizeBundle(bundle);

  const uncompressedBytes = Buffer.from(JSON.stringify(canonical), 'utf8');
  if (uncompressedBytes.byteLength > limits.maxUncompressedBytes) {
    fail('ARTIFACT_LIMIT_EXCEEDED', 'Artifact exceeds the uncompressed-size limit');
  }
  const sha256 = digest(uncompressedBytes);
  const compressedBytes = await gzipAsync(uncompressedBytes, { level: 9 });
  if (compressedBytes.byteLength > limits.maxCompressedBytes) {
    fail('ARTIFACT_LIMIT_EXCEEDED', 'Artifact exceeds the compressed-size limit');
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

const validateManifest = (
  compressedBytes: Uint8Array,
  manifest: ArtifactIntegrity,
  limits: ArtifactLimits
): void => {
  if (manifest.format !== artifactFormat || manifest.formatVersion !== 1) {
    fail('ARTIFACT_FORMAT_UNSUPPORTED', 'Artifact format or version is unsupported');
  }
  if (
    !Number.isSafeInteger(manifest.compressedBytes) ||
    manifest.compressedBytes !== compressedBytes.byteLength
  ) {
    fail('ARTIFACT_CORRUPT', 'Artifact compressed length does not match its manifest');
  }
  if (compressedBytes.byteLength > limits.maxCompressedBytes) {
    fail('ARTIFACT_LIMIT_EXCEEDED', 'Artifact exceeds the compressed-size limit');
  }
};

export const decodeProjectArtifact = async (
  compressedBytes: Uint8Array,
  manifest: ArtifactIntegrity,
  limits: ArtifactLimits
): Promise<ProjectArtifactBundle> => {
  validateLimits(limits);
  validateManifest(compressedBytes, manifest, limits);
  const compressedBuffer = Buffer.from(compressedBytes);

  let uncompressedBytes: Buffer;
  try {
    uncompressedBytes = await gunzipAsync(compressedBuffer, {
      maxOutputLength: limits.maxUncompressedBytes
    });
  } catch (error) {
    if (
      error instanceof Error &&
      ('code' in error && error.code === 'ERR_BUFFER_TOO_LARGE')
    ) {
      return fail('ARTIFACT_LIMIT_EXCEEDED', 'Artifact exceeds the uncompressed-size limit', error);
    }
    return fail('ARTIFACT_CORRUPT', 'Artifact gzip data is corrupt', error);
  }

  if (
    !Number.isSafeInteger(manifest.uncompressedBytes) ||
    manifest.uncompressedBytes !== uncompressedBytes.byteLength
  ) {
    fail('ARTIFACT_CORRUPT', 'Artifact uncompressed length does not match its manifest');
  }
  if (digest(uncompressedBytes) !== manifest.sha256) {
    fail('ARTIFACT_CORRUPT', 'Artifact sha256 does not match its manifest');
  }

  const json = (() => {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(uncompressedBytes);
    } catch (error) {
      return fail('ARTIFACT_CORRUPT', 'Artifact bytes are not valid UTF-8', error);
    }
  })();
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    fail('ARTIFACT_CORRUPT', 'Artifact JSON is corrupt', error);
  }
  enforceFileCount(parsed, limits);
  let canonical: ProjectArtifactBundle;
  try {
    canonical = canonicalizeBundle(parsed);
  } catch (error) {
    if (error instanceof ArtifactError) {
      fail('ARTIFACT_CORRUPT', 'Artifact bundle structure is invalid', error);
    }
    throw error;
  }
  if (
    !Number.isSafeInteger(manifest.fileCount) ||
    manifest.fileCount !== canonical.files.length
  ) {
    fail('ARTIFACT_CORRUPT', 'Artifact file count does not match its manifest');
  }
  return canonical;
};
