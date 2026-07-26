import {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useRef,
} from 'react'
import {
  ArrowUp,
  ChevronDown,
  MessageCircle,
  Plus,
  ScanLine,
} from 'lucide-react'

export function WorkspaceEditComposer({
  value,
  disabled,
  canSubmit,
  onChange,
  onSubmit,
}: {
  value: string
  disabled: boolean
  canSubmit: boolean
  onChange: (value: string) => void
  onSubmit: () => void
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 96)}px`
  }, [value])

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    if (canSubmit && !disabled) onSubmit()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <form
      className="border-t border-neutral-200 bg-white px-2 py-1"
      data-testid="workspace-edit-composer"
      onSubmit={submit}
    >
      <div className="flex min-h-10 items-end gap-1 rounded-lg border border-neutral-200 bg-white px-1.5 py-1 shadow-sm transition focus-within:border-neutral-400 focus-within:ring-1 focus-within:ring-neutral-200">
        <button
          type="button"
          aria-label="Add attachment"
          disabled={disabled}
          className="mb-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-950 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="h-4 w-4" />
        </button>
        <textarea
          ref={textareaRef}
          rows={1}
          className="max-h-24 min-h-8 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent px-1.5 py-1.5 text-sm leading-5 text-neutral-800 outline-none placeholder:text-neutral-400 disabled:cursor-not-allowed disabled:text-neutral-400"
          aria-label="Edit prompt"
          placeholder={disabled ? '正在生成…' : '提出后续问题…'}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="mb-0.5 flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            aria-label="Prompt options"
            disabled={disabled}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-950 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <MessageCircle className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Add visual context"
            disabled={disabled}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-950 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ScanLine className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="More input options"
            disabled={disabled}
            className="inline-flex h-6 w-5 items-center justify-center rounded text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-950 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="submit"
            aria-label={disabled ? '正在生成' : 'Send edit'}
            disabled={!canSubmit || disabled}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-neutral-950 text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-950 disabled:text-white"
          >
            <ArrowUp className="h-4 w-4 stroke-[2.5]" />
          </button>
        </div>
      </div>
    </form>
  )
}
