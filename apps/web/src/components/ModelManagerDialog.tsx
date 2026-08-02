import { CheckCircle2, KeyRound, X } from 'lucide-react'
import type { ModelDefinition } from '@/services/api'
import { useI18n } from '@/lib/i18n'

export function ModelManagerDialog({
  open,
  models,
  selectedModelId,
  applicationBound,
  saving,
  error,
  onSelect,
  onClose,
}: {
  open: boolean
  models: ModelDefinition[]
  selectedModelId: string
  applicationBound: boolean
  saving: boolean
  error?: string
  onSelect: (modelId: string) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation">
      <section
        className="w-full max-w-xl rounded-xl border border-neutral-200 bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="model-manager-title"
      >
        <header className="flex items-start justify-between border-b border-neutral-200 px-5 py-4">
          <div>
            <h2 id="model-manager-title" className="font-semibold">{t('models.title')}</h2>
            <p className="mt-1 text-sm text-neutral-500">
              {applicationBound
                ? t('models.boundBody')
                : t('models.unboundBody')}
            </p>
          </div>
          <button type="button" aria-label={t('models.close')} className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100" onClick={onClose}>
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="space-y-2 p-4">
          {models.map((model) => {
            const selected = model.id === selectedModelId
            return (
              <button
                type="button"
                key={model.id}
                disabled={saving}
                className={`flex w-full items-start gap-3 rounded-lg border p-4 text-left transition disabled:opacity-60 ${
                  selected ? 'border-neutral-950 bg-neutral-50' : 'border-neutral-200 hover:border-neutral-400'
                }`}
                onClick={() => onSelect(model.id)}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{model.label}</span>
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">{model.provider}</span>
                  </div>
                  <p className="mt-1 text-sm text-neutral-500">{model.model}</p>
                  {model.description ? <p className="mt-2 text-sm text-neutral-600">{model.description}</p> : null}
                  <p className="mt-2 inline-flex items-center gap-1 text-xs text-neutral-500">
                    <KeyRound className="h-3.5 w-3.5" />
                    {t('models.credential')}
                  </p>
                </div>
                {selected ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" /> : null}
              </button>
            )
          })}
          {models.length === 0 ? (
            <p className="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">{t('models.empty')}</p>
          ) : null}
          {error ? <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
        </div>

        <footer className="border-t border-neutral-200 px-5 py-3 text-xs text-neutral-500">
          {t('models.security')}
        </footer>
      </section>
    </div>
  )
}
