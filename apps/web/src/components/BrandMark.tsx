import { Sparkles } from 'lucide-react'

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className="inline-flex min-w-0 items-center gap-2.5"
      aria-label="AI App Builder Foundation"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral-950 text-white">
        <Sparkles className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className={compact ? 'hidden min-w-0 sm:block' : 'min-w-0'}>
        <span className="block truncate text-sm font-semibold leading-4 text-neutral-950">
          AI App Builder
        </span>
        <span className="block truncate text-[11px] leading-4 text-neutral-500">
          Foundation
        </span>
      </span>
    </span>
  )
}
