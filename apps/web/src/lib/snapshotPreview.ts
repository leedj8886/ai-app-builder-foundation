import type { WorkspaceSnapshot } from './v0Workspace'

export interface SnapshotPreviewModel {
  files: Record<string, string>
  dependencies: Record<string, string>
  entry: string
}

const supportedLanguages = new Set([
  'ts',
  'tsx',
  'css',
  'json',
  'html',
  'md',
])

const sortedRecord = (
  entries: Iterable<readonly [string, string]>,
): Record<string, string> => Object.fromEntries(
  [...entries].sort(([left], [right]) => left.localeCompare(right)),
)

const normalizePreviewPath = (path: string): string => {
  const trimmed = path.trim()
  if (!trimmed || trimmed.includes('\\')) {
    throw new Error(`Unsafe preview file path: ${path}`)
  }

  const relative = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed
  const segments = relative.split('/')
  if (
    segments.length === 0 ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(`Unsafe preview file path: ${path}`)
  }

  return `/${relative}`
}

export const createSnapshotPreviewModel = (
  snapshot: WorkspaceSnapshot,
): SnapshotPreviewModel => {
  const fileEntries: Array<readonly [string, string]> = []
  const paths = new Set<string>()

  for (const file of snapshot.files) {
    if (!supportedLanguages.has(file.language)) {
      throw new Error(`Unsupported preview file: ${file.path}`)
    }

    const path = normalizePreviewPath(file.path)
    if (paths.has(path)) {
      throw new Error(`Duplicate preview file path: ${path}`)
    }
    paths.add(path)
    fileEntries.push([path, file.content])
  }

  const entry = paths.has('/src/main.tsx')
    ? '/src/main.tsx'
    : paths.has('/src/index.tsx')
      ? '/src/index.tsx'
      : undefined
  if (!entry) {
    throw new Error('Preview entry file is missing')
  }

  return {
    files: sortedRecord(fileEntries),
    dependencies: sortedRecord(Object.entries({
      react: '^18.2.0',
      'react-dom': '^18.2.0',
      ...snapshot.packageJson.dependencies,
    })),
    entry,
  }
}
