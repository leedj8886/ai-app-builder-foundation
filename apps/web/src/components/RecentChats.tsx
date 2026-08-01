import { useState } from 'react'
import { ChevronDown, MessageSquare, MoreHorizontal } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  getChatAccessibleName,
  isActiveChat,
  selectRecentChats,
  type ChatHistoryState,
} from '@/lib/chatHistory'
import { buildChatPath } from '@/lib/chatWorkspace'

interface RecentChatsProps {
  state: ChatHistoryState
  activeChatId?: string
  onRetry: () => void
}

export function RecentChats({
  state,
  activeChatId,
  onRetry,
}: RecentChatsProps) {
  const [expanded, setExpanded] = useState(true)
  const chats = selectRecentChats(state.chats)
  const initiallyLoading = state.status === 'loading' && chats.length === 0

  return (
    <section className="mt-3 px-2" data-testid="recent-chats">
      <button
        type="button"
        className="flex h-8 w-full items-center justify-between rounded-md px-2 text-xs font-medium text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span>最近聊天</span>
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform ${
            expanded ? '' : '-rotate-90'
          }`}
        />
      </button>

      {expanded ? (
        <div className="mt-1 space-y-0.5">
          {initiallyLoading
            ? Array.from({ length: 3 }, (_, index) => (
                <div
                  key={index}
                  className="mx-2 h-8 animate-pulse rounded-md bg-neutral-200/70"
                />
              ))
            : null}

          {chats.map((chat) => {
            const active = isActiveChat(chat._id, activeChatId)
            return (
              <Link
                key={chat._id}
                to={buildChatPath(chat._id)}
                aria-label={getChatAccessibleName(chat)}
                aria-current={active ? 'page' : undefined}
                className={`group flex h-9 items-center gap-2 rounded-md px-2 text-sm transition-colors ${
                  active
                    ? 'bg-neutral-200 text-neutral-950'
                    : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950'
                }`}
              >
                <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{chat.title}</span>
                {active ? (
                  <MoreHorizontal className="h-3.5 w-3.5 shrink-0 text-neutral-500" />
                ) : null}
              </Link>
            )
          })}

          {state.status === 'ready' && chats.length === 0 ? (
            <p className="px-2 py-2 text-xs leading-5 text-neutral-500">
              生成后的对话会显示在这里。
            </p>
          ) : null}

          {state.status === 'error' ? (
            <div className="px-2 py-2 text-xs text-neutral-500" role="status">
              <span>{state.error ?? '对话加载失败'}</span>
              <button
                type="button"
                className="ml-2 font-medium text-neutral-900 underline underline-offset-2"
                onClick={onRetry}
              >
                重试
              </button>
            </div>
          ) : null}

          {chats.length > 0 ? (
            <Link
              to="/chats"
              className="flex h-9 items-center gap-2 rounded-md px-2 text-sm text-neutral-500 hover:bg-neutral-100 hover:text-neutral-950"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
              More
            </Link>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
