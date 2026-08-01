export const MAX_ATTACHMENT_COUNT = 5
export const MAX_ATTACHMENT_BYTES = 512 * 1024
export const MAX_TOTAL_ATTACHMENT_BYTES = 1024 * 1024

export const ACCEPTED_ATTACHMENT_TYPES = [
  'text/*',
  '.txt',
  '.md',
  '.markdown',
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.less',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.json',
  '.jsonl',
  '.csv',
  '.xml',
  '.yaml',
  '.yml',
  '.svg',
  '.py',
  '.rb',
  '.php',
  '.java',
  '.kt',
  '.go',
  '.rs',
  '.swift',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.cs',
  '.sh',
  '.bash',
  '.zsh',
  '.sql',
  '.graphql',
  '.gql',
  '.toml',
  '.ini',
  '.conf',
  '.env',
  '.log',
].join(',')

const acceptedExtensions = new Set(
  ACCEPTED_ATTACHMENT_TYPES.split(',').filter((value) => value.startsWith('.')),
)

export interface PendingAttachment {
  id: string
  name: string
  mediaType: string
  size: number
  content: string
}

const extensionOf = (name: string): string => {
  const dotIndex = name.lastIndexOf('.')
  return dotIndex === -1 ? '' : name.slice(dotIndex).toLowerCase()
}

const isTextFile = (file: File): boolean =>
  file.type.startsWith('text/')
  || acceptedExtensions.has(extensionOf(file.name))
  || ['application/json', 'application/javascript', 'application/xml'].includes(file.type)

export const formatAttachmentSize = (bytes: number): string =>
  bytes < 1024
    ? `${bytes} B`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`

export const addAttachmentFiles = async (
  current: PendingAttachment[],
  files: File[],
): Promise<PendingAttachment[]> => {
  if (current.length + files.length > MAX_ATTACHMENT_COUNT) {
    throw new Error(`最多可上传 ${MAX_ATTACHMENT_COUNT} 个文件`)
  }

  for (const file of files) {
    if (!isTextFile(file)) {
      throw new Error(`${file.name} 不是支持的文本或代码文件`)
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      throw new Error(`${file.name} 超过 512 KB`)
    }
  }

  const totalBytes = current.reduce((sum, file) => sum + file.size, 0)
    + files.reduce((sum, file) => sum + file.size, 0)
  if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    throw new Error('附件总大小不能超过 1 MB')
  }

  const additions = await Promise.all(files.map(async (file) => {
    const content = await file.text()
    if (content.includes('\0')) {
      throw new Error(`${file.name} 包含不支持的二进制内容`)
    }
    return {
      id: crypto.randomUUID(),
      name: file.name,
      mediaType: file.type.startsWith('text/')
        || ['application/json', 'application/javascript', 'application/xml'].includes(file.type)
        ? file.type
        : 'text/plain',
      size: file.size,
      content,
    }
  }))

  return [...current, ...additions]
}
