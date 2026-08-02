import { Languages } from 'lucide-react'
import { useI18n } from '@/lib/i18n'

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { language, t, toggleLanguage } = useI18n()

  return (
    <button
      type="button"
      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2.5 text-sm text-neutral-700 transition hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
      aria-label={t('language.switchTo')}
      title={t('language.switchTo')}
      onClick={toggleLanguage}
    >
      <Languages className="h-4 w-4" />
      <span>{compact ? (language === 'zh-CN' ? 'EN' : '中') : t('language.current')}</span>
    </button>
  )
}
