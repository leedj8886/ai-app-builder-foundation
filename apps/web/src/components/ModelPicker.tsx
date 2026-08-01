import { useState } from 'react'
import {
  CheckCircle2,
  ChevronDown,
  Settings2,
  Sparkles,
} from 'lucide-react'
import type { ModelDefinition } from '@/services/api'

export function ModelPicker({
  models,
  selectedModelId,
  disabled,
  onSelect,
  onManage,
}: {
  models: ModelDefinition[]
  selectedModelId: string
  disabled?: boolean
  onSelect: (modelId: string) => void
  onManage: () => void
}) {
  const [open, setOpen] = useState(false)
  const selected = models.find((model) => model.id === selectedModelId)

  return (
    <div className="relative">
      <button
        type="button"
        className="inline-flex h-8 max-w-[280px] items-center gap-2 rounded-md px-2 text-sm text-neutral-600 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled || models.length === 0}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Sparkles className="h-4 w-4 shrink-0 text-orange-500" />
        <span className="truncate">{selected?.label ?? 'Loading models…'}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0" />
      </button>

      {open ? (
        <div
          className="absolute left-0 top-10 z-30 w-72 rounded-lg border border-neutral-200 bg-white p-1 text-left text-sm shadow-xl"
          role="listbox"
          aria-label="Generation model"
        >
          {models.map((model) => (
            <button
              type="button"
              role="option"
              aria-selected={model.id === selectedModelId}
              key={model.id}
              className="flex w-full items-start justify-between gap-3 rounded-md px-3 py-2 text-neutral-700 hover:bg-neutral-100"
              onClick={() => {
                onSelect(model.id)
                setOpen(false)
              }}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{model.label}</span>
                <span className="block truncate text-xs text-neutral-500">
                  {model.provider} · {model.model}
                </span>
              </span>
              {model.id === selectedModelId ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              ) : null}
            </button>
          ))}
          <div className="my-1 border-t border-neutral-100" />
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-neutral-600 hover:bg-neutral-100"
            onClick={() => {
              setOpen(false)
              onManage()
            }}
          >
            <Settings2 className="h-4 w-4" />
            Manage application model
          </button>
        </div>
      ) : null}
    </div>
  )
}
