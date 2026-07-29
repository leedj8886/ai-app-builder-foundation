import { useState } from 'react'
import { CheckCircle2, RefreshCw } from 'lucide-react'

interface VerifiedBuildPreviewProps {
  snapshotId: string
  url: string
  isGenerating: boolean
}

export function VerifiedBuildPreview({
  snapshotId,
  url,
  isGenerating,
}: VerifiedBuildPreviewProps) {
  const [reloadKey, setReloadKey] = useState(0)

  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-red-400" />
          <span className="h-3 w-3 rounded-full bg-yellow-400" />
          <span className="h-3 w-3 rounded-full bg-emerald-400" />
          <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-800">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Verified build
          </span>
          {isGenerating ? (
            <span className="rounded-full bg-orange-100 px-2 py-1 text-xs font-medium text-orange-800">
              Generating a new version
            </span>
          ) : null}
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100"
          onClick={() => setReloadKey((value) => value + 1)}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Reload preview
        </button>
      </div>
      <iframe
        key={`${snapshotId}:${reloadKey}`}
        title="Verified build preview"
        src={url}
        className="block h-[620px] w-full border-0 bg-white"
        sandbox="allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts"
        referrerPolicy="no-referrer"
      />
    </div>
  )
}
