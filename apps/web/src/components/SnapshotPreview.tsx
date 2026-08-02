import { useState } from 'react'
import {
  SandpackLayout,
  SandpackPreview,
  SandpackProvider,
} from '@codesandbox/sandpack-react'
import { RefreshCw } from 'lucide-react'
import type { SnapshotPreviewModel } from '@/lib/snapshotPreview'
import { useI18n } from '@/lib/i18n'

interface SnapshotPreviewProps {
  snapshotId: string
  model: SnapshotPreviewModel
  isGenerating: boolean
  verification?: 'verified' | 'simulated'
}

export function SnapshotPreview({
  snapshotId,
  model,
  isGenerating,
  verification,
}: SnapshotPreviewProps) {
  const { t } = useI18n()
  const [reloadKey, setReloadKey] = useState(0)

  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-red-400" />
          <span className="h-3 w-3 rounded-full bg-yellow-400" />
          <span className="h-3 w-3 rounded-full bg-emerald-400" />
          {isGenerating ? (
            <span className="ml-2 rounded-full bg-orange-100 px-2 py-1 text-xs font-medium text-orange-800">
              {t('preview.generating')}
            </span>
          ) : null}
          <span className="ml-2 rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">
            {verification === 'simulated'
              ? t('preview.simulated')
              : t('preview.source')}
          </span>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100"
          onClick={() => setReloadKey((value) => value + 1)}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {t('preview.reload')}
        </button>
      </div>

      <div data-testid="snapshot-preview">
        <SandpackProvider
          key={`${snapshotId}:${reloadKey}`}
          template="react-ts"
          files={model.files}
          customSetup={{
            entry: model.entry,
            dependencies: model.dependencies,
          }}
          options={{
            activeFile: model.entry,
            recompileMode: 'immediate',
          }}
        >
          <SandpackLayout style={{ border: 0, borderRadius: 0 }}>
            <SandpackPreview
              showNavigator
              showRefreshButton={false}
              showOpenInCodeSandbox={false}
              style={{ height: 620 }}
            />
          </SandpackLayout>
        </SandpackProvider>
      </div>
    </div>
  )
}
