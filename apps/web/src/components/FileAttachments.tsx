import { useRef, useState, type ReactNode } from 'react'
import { FileText, X } from 'lucide-react'
import {
  ACCEPTED_ATTACHMENT_TYPES,
  addAttachmentFiles,
  formatAttachmentSize,
  type PendingAttachment,
} from '@/lib/fileAttachments'

export function FileAttachmentButton({
  attachments,
  disabled,
  label,
  className,
  children,
  onChange,
}: {
  attachments: PendingAttachment[]
  disabled?: boolean
  label: string
  className: string
  children: ReactNode
  onChange: (attachments: PendingAttachment[]) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string>()

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return
    try {
      onChange(await addAttachmentFiles(attachments, Array.from(files)))
      setError(undefined)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '无法读取附件')
    } finally {
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <span className="relative inline-flex">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED_ATTACHMENT_TYPES}
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => void handleFiles(event.target.files)}
      />
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        className={className}
        onClick={() => inputRef.current?.click()}
      >
        {children}
      </button>
      {error ? (
        <span
          role="alert"
          className="absolute bottom-full left-0 z-20 mb-2 w-64 rounded-md border border-red-200 bg-white px-2.5 py-2 text-left text-xs leading-4 text-red-700 shadow-lg"
        >
          {error}
        </span>
      ) : null}
    </span>
  )
}

export function AttachmentChips({
  attachments,
  disabled,
  onChange,
}: {
  attachments: PendingAttachment[]
  disabled?: boolean
  onChange: (attachments: PendingAttachment[]) => void
}) {
  if (attachments.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2" aria-label="Selected attachments">
      {attachments.map((attachment) => (
        <span
          key={attachment.id}
          className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs text-neutral-600"
        >
          <FileText className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
          <span className="max-w-48 truncate" title={attachment.name}>
            {attachment.name}
          </span>
          <span className="shrink-0 text-neutral-400">
            {formatAttachmentSize(attachment.size)}
          </span>
          <button
            type="button"
            aria-label={`Remove ${attachment.name}`}
            disabled={disabled}
            className="ml-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => onChange(
              attachments.filter((candidate) => candidate.id !== attachment.id),
            )}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
    </div>
  )
}
