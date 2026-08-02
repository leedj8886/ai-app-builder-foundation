import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, MessageSquare, Plus, RotateCcw } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  createChatHistoryState,
  failChatHistory,
  formatChatUpdatedAt,
  loadChatHistory,
} from '@/lib/chatHistory'
import { buildChatPath } from '@/lib/chatWorkspace'
import { chatApi } from '@/services/api'
import { BrandMark } from '@/components/BrandMark'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { useI18n } from '@/lib/i18n'

export function ChatHistoryPage() {
  const { locale, t } = useI18n()
  const [state, setState] = useState(createChatHistoryState)

  const load = useCallback(async () => {
    setState((current) => loadChatHistory(current))
    try {
      const response = await chatApi.getAll()
      setState((current) => loadChatHistory(current, response.data.chats))
    } catch {
      setState((current) => failChatHistory(current, t('history.loadFailed')))
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const initiallyLoading = state.status === 'loading' && state.chats.length === 0

  return (
    <main className="min-h-screen bg-[#fafafa] text-neutral-950">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex h-12 max-w-5xl items-center justify-between px-4">
          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-md text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
          >
            <BrandMark />
          </Link>
          <div className="flex items-center gap-2">
            <LanguageSwitcher compact />
            <Link
              to="/"
              className="inline-flex h-8 items-center gap-2 rounded-md bg-neutral-950 px-3 text-sm font-medium text-white hover:bg-neutral-800"
            >
              <Plus className="h-4 w-4" />
              {t('common.newChat')}
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-8">
          <Link
            to="/"
            className="mb-5 inline-flex items-center gap-2 text-sm text-neutral-500 hover:text-neutral-950"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('history.back')}
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{t('history.title')}</h1>
          <p className="mt-2 text-sm text-neutral-500">{t('history.subtitle')}</p>
        </div>

        {initiallyLoading ? (
          <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white" aria-label={t('history.loadingLabel')}>
            {Array.from({ length: 5 }, (_, index) => (
              <div
                key={index}
                className="border-b border-neutral-100 p-5 last:border-b-0"
              >
                <div className="h-4 w-48 animate-pulse rounded bg-neutral-200" />
                <div className="mt-3 h-3 w-3/4 animate-pulse rounded bg-neutral-100" />
              </div>
            ))}
          </div>
        ) : null}

        {state.status === 'error' && state.chats.length === 0 ? (
          <div className="rounded-xl border border-neutral-200 bg-white px-6 py-12 text-center" role="alert">
            <p className="text-sm text-neutral-600">{state.error}</p>
            <button
              type="button"
              className="mt-4 inline-flex h-9 items-center gap-2 rounded-md border border-neutral-200 px-3 text-sm font-medium hover:bg-neutral-50"
              onClick={() => void load()}
            >
              <RotateCcw className="h-4 w-4" />
              {t('common.retry')}
            </button>
          </div>
        ) : null}

        {state.status === 'ready' && state.chats.length === 0 ? (
          <div className="rounded-xl border border-neutral-200 bg-white px-6 py-14 text-center">
            <MessageSquare className="mx-auto h-8 w-8 text-neutral-300" />
            <h2 className="mt-4 text-base font-medium">{t('history.empty')}</h2>
            <p className="mt-2 text-sm text-neutral-500">
              {t('history.emptyBody')}
            </p>
            <Link
              to="/"
              className="mt-5 inline-flex h-9 items-center gap-2 rounded-md bg-neutral-950 px-3 text-sm font-medium text-white"
            >
              <Plus className="h-4 w-4" />
              {t('common.newChat')}
            </Link>
          </div>
        ) : null}

        {state.chats.length > 0 ? (
          <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white" data-testid="chat-history-list">
            {state.status === 'error' ? (
              <div className="flex items-center justify-between border-b border-amber-200 bg-amber-50 px-5 py-3 text-xs text-amber-900" role="status">
                <span>{state.error}</span>
                <button type="button" className="font-medium underline" onClick={() => void load()}>
                  {t('common.retry')}
                </button>
              </div>
            ) : null}
            {state.chats.map((chat) => (
              <Link
                key={chat._id}
                to={buildChatPath(chat._id)}
                aria-label={t('history.open', { title: chat.title })}
                className="flex gap-4 border-b border-neutral-100 p-4 transition-colors last:border-b-0 hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-950 sm:p-5"
              >
                <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" />
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-sm font-medium">{chat.title}</h2>
                  {chat.preview ? (
                    <p className="mt-1 truncate text-sm text-neutral-500">{chat.preview}</p>
                  ) : null}
                </div>
                <time
                  dateTime={chat.updatedAt}
                  className="shrink-0 text-xs text-neutral-400"
                >
                  {formatChatUpdatedAt(chat.updatedAt, new Date(), locale, t('history.yesterday'))}
                </time>
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </main>
  )
}
