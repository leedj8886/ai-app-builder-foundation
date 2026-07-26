import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import {
  link,
  lstat,
  mkdir,
  open,
  unlink
} from 'node:fs/promises';
import path from 'node:path';
import { ArtifactStore } from './ArtifactStore';
import { ArtifactError, ArtifactErrorCode } from './types';

const STORAGE_KEY_PATTERN =
  /^v1\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{32}\.json\.gz$/;

const TRANSIENT_IO_CODES = new Set([
  'EAGAIN',
  'EBUSY',
  'EDQUOT',
  'EINTR',
  'EIO',
  'EMFILE',
  'ENFILE',
  'ENOMEM',
  'ENOSPC',
  'ESTALE',
  'ETIMEDOUT'
]);

type NodeError = Error & { code?: string };

export interface SharedFilesystemArtifactStoreOptions {
  removeTemp?: (tempPath: string) => Promise<void>;
  onCleanupError?: (error: unknown) => void | Promise<void>;
  directorySync?: (directory: string) => Promise<void>;
}

const artifactError = (
  code: ArtifactErrorCode,
  message: string,
  retryable: boolean,
  cause?: unknown
): ArtifactError => new ArtifactError(code, `${code}: ${message}`, retryable, cause);

const isCode = (error: unknown, code: string): boolean =>
  error instanceof Error && (error as NodeError).code === code;

export class SharedFilesystemArtifactStore implements ArtifactStore {
  private readonly root: string;
  private readonly removeTemp: (tempPath: string) => Promise<void>;
  private readonly onCleanupError: (
    error: unknown
  ) => void | Promise<void>;
  private readonly directorySync: (directory: string) => Promise<void>;

  /**
   * The storage root is a deployment-provisioned mount point. It must already
   * exist and be owned by and writable only by the service.
   * Component checks reject static symlinks, but Node has no openat2-style API
   * that could prevent a malicious same-permission writer from racing them.
   */
  constructor(
    root: string,
    options: SharedFilesystemArtifactStoreOptions = {}
  ) {
    this.root = path.resolve(root);
    this.removeTemp = options.removeTemp ?? unlink;
    this.onCleanupError = options.onCleanupError ?? (error => {
      const code =
        error instanceof Error ? (error as NodeError).code : undefined;
      console.warn('ARTIFACT_TEMP_CLEANUP_FAILED', code ?? 'UNKNOWN');
    });
    this.directorySync =
      options.directorySync ?? (directory => this.syncDirectoryOnDisk(directory));
  }

  async put(input: {
    storageKey: string;
    bytes: Uint8Array;
  }): Promise<void> {
    const finalPath = this.resolveKey(input.storageKey);
    const parent = path.dirname(finalPath);
    let tempPath: string | undefined;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    let tempCreated = false;
    let publishing = false;

    try {
      await this.ensureSafeParent(parent);
      tempPath = `${finalPath}.${randomBytes(12).toString('hex')}.tmp`;
      handle = await open(tempPath, 'wx');
      tempCreated = true;
      await handle.writeFile(input.bytes);
      await handle.sync();
      await handle.close();
      handle = undefined;

      // link(2) provides atomic no-clobber publication, unlike rename(2), which
      // would replace an existing final path on the supported platforms.
      publishing = true;
      await link(tempPath, finalPath);
      publishing = false;
      await this.directorySync(parent);
    } catch (error) {
      if (error instanceof ArtifactError) {
        throw error;
      }
      if (publishing && isCode(error, 'EEXIST')) {
        try {
          await this.directorySync(parent);
        } catch (syncError) {
          throw this.mapFilesystemError(
            syncError,
            'ARTIFACT_WRITE_FAILED',
            'failed to sync artifact directory'
          );
        }
        throw artifactError(
          'ARTIFACT_WRITE_FAILED',
          'artifact already exists',
          false,
          error
        );
      }
      throw this.mapFilesystemError(
        error,
        'ARTIFACT_WRITE_FAILED',
        'failed to write artifact'
      );
    } finally {
      if (handle) {
        await handle.close().catch(() => undefined);
      }
      if (tempPath && tempCreated) {
        try {
          await this.removeTemp(tempPath);
        } catch (error) {
          await Promise.resolve()
            .then(() => this.onCleanupError(error))
            .catch(() => undefined);
        }
      }
    }
  }

  async get(storageKey: string): Promise<Uint8Array> {
    const finalPath = this.resolveKey(storageKey);

    try {
      await this.assertSafeParent(path.dirname(finalPath));
      let handle: Awaited<ReturnType<typeof open>> | undefined;
      try {
        handle = await this.openRegularFile(finalPath);
        const bytes = await handle.readFile();
        return new Uint8Array(bytes);
      } finally {
        await handle?.close();
      }
    } catch (error) {
      if (error instanceof ArtifactError) {
        throw error;
      }
      if (isCode(error, 'ELOOP')) {
        throw artifactError(
          'ARTIFACT_INVALID_PATH',
          'artifact target must not be a symbolic link',
          false,
          error
        );
      }
      if (isCode(error, 'ENOENT')) {
        throw artifactError(
          'ARTIFACT_NOT_FOUND',
          'artifact does not exist',
          false,
          error
        );
      }
      throw this.mapFilesystemError(
        error,
        'ARTIFACT_STORE_UNAVAILABLE',
        'failed to read artifact'
      );
    }
  }

  async exists(storageKey: string): Promise<boolean> {
    const finalPath = this.resolveKey(storageKey);

    try {
      await this.assertSafeParent(path.dirname(finalPath));
      let handle: Awaited<ReturnType<typeof open>> | undefined;
      try {
        handle = await this.openRegularFile(finalPath);
        return true;
      } finally {
        await handle?.close();
      }
    } catch (error) {
      if (isCode(error, 'ENOENT')) {
        return false;
      }
      if (error instanceof ArtifactError) {
        throw error;
      }
      if (isCode(error, 'ELOOP')) {
        throw artifactError(
          'ARTIFACT_INVALID_PATH',
          'artifact target must not be a symbolic link',
          false,
          error
        );
      }
      throw this.mapFilesystemError(
        error,
        'ARTIFACT_STORE_UNAVAILABLE',
        'failed to inspect artifact'
      );
    }
  }

  async delete(storageKey: string): Promise<void> {
    const finalPath = this.resolveKey(storageKey);
    const parent = path.dirname(finalPath);
    let safeParent = false;

    try {
      await this.assertSafeParent(parent);
      safeParent = true;
      const stats = await lstat(finalPath);
      if (stats.isSymbolicLink() || !stats.isFile()) {
        throw artifactError(
          'ARTIFACT_INVALID_PATH',
          'artifact target must be a regular file',
          false
        );
      }
      await unlink(finalPath);
      await this.directorySync(parent);
    } catch (error) {
      if (isCode(error, 'ENOENT')) {
        if (safeParent) {
          try {
            await this.directorySync(parent);
          } catch (syncError) {
            throw this.mapFilesystemError(
              syncError,
              'ARTIFACT_STORE_UNAVAILABLE',
              'failed to sync artifact directory'
            );
          }
        }
        return;
      }
      if (error instanceof ArtifactError) {
        throw error;
      }
      throw this.mapFilesystemError(
        error,
        'ARTIFACT_STORE_UNAVAILABLE',
        'failed to delete artifact'
      );
    }
  }

  private resolveKey(storageKey: string): string {
    if (!STORAGE_KEY_PATTERN.test(storageKey)) {
      throw artifactError(
        'ARTIFACT_INVALID_PATH',
        'storage key has an invalid format',
        false
      );
    }

    const resolved = path.resolve(this.root, storageKey);
    if (!resolved.startsWith(`${this.root}${path.sep}`)) {
      throw artifactError(
        'ARTIFACT_INVALID_PATH',
        'storage key escapes the artifact root',
        false
      );
    }
    return resolved;
  }

  private async ensureSafeParent(parent: string): Promise<void> {
    await this.assertDirectory(this.root);

    const relative = path.relative(this.root, parent);
    let current = this.root;
    const namespaceParents: string[] = [];
    for (const component of relative.split(path.sep).filter(Boolean)) {
      namespaceParents.push(current);
      current = path.join(current, component);
      try {
        await mkdir(current);
      } catch (error) {
        if (!isCode(error, 'EEXIST')) {
          throw error;
        }
      }
      await this.assertDirectory(current);
    }
    for (const namespaceParent of namespaceParents) {
      await this.directorySync(namespaceParent);
    }
  }

  private async assertSafeParent(parent: string): Promise<void> {
    await this.assertDirectory(this.root);
    const relative = path.relative(this.root, parent);
    let current = this.root;
    for (const component of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, component);
      await this.assertDirectory(current);
    }
  }

  private async assertDirectory(candidate: string): Promise<void> {
    const stats = await lstat(candidate);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw artifactError(
        'ARTIFACT_INVALID_PATH',
        'artifact path contains an unsafe component',
        false
      );
    }
  }

  private async openRegularFile(
    finalPath: string
  ): Promise<Awaited<ReturnType<typeof open>>> {
    const handle = await open(
      finalPath,
      constants.O_RDONLY | constants.O_NOFOLLOW
    );
    try {
      const stats = await handle.stat();
      if (!stats.isFile()) {
        throw artifactError(
          'ARTIFACT_INVALID_PATH',
          'artifact target must be a regular file',
          false
        );
      }
      return handle;
    } catch (error) {
      await handle.close().catch(() => undefined);
      throw error;
    }
  }

  private async syncDirectoryOnDisk(parent: string): Promise<void> {
    const handle = await open(parent, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  private mapFilesystemError(
    error: unknown,
    fallbackCode: ArtifactErrorCode,
    message: string
  ): ArtifactError {
    const transient =
      error instanceof Error &&
      TRANSIENT_IO_CODES.has((error as NodeError).code ?? '');
    if (transient) {
      return artifactError(
        'ARTIFACT_STORE_UNAVAILABLE',
        message,
        true,
        error
      );
    }
    return artifactError(fallbackCode, message, false, error);
  }
}
