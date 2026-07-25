import { FormEvent, KeyboardEvent } from 'react'
import { Send } from 'lucide-react'

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
      className="border-t border-neutral-200 bg-white p-3"
      data-testid="workspace-edit-composer"
      onSubmit={submit}
    >
      <div className="rounded-xl border border-neutral-200 bg-white p-2 shadow-sm focus-within:border-neutral-400">
        <textarea
          className="max-h-36 min-h-20 w-full resize-none bg-transparent px-2 py-1 text-sm outline-none disabled:text-neutral-400"
          aria-label="Edit prompt"
          placeholder="描述下一步修改…"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="flex justify-end">
          <button
            type="submit"
            aria-label={disabled ? '正在生成' : 'Send edit'}
            disabled={!canSubmit || disabled}
            className="inline-flex h-8 items-center gap-2 rounded-md bg-neutral-950 px-3 text-xs font-medium text-white disabled:bg-neutral-300"
          >
            {disabled ? (
              '正在生成'
            ) : (
              <>
                <Send className="h-3.5 w-3.5" />
                发送
              </>
            )}
          </button>
        </div>
      </div>
    </form>
  )
}
