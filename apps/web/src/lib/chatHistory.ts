import type { ChatListItem } from '@/services/api'

export interface ChatHistoryState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  chats: ChatListItem[]
  error?: string
}

export const createChatHistoryState = (): ChatHistoryState => ({
  status: 'idle',
  chats: [],
})

export function loadChatHistory(
  state: ChatHistoryState,
  chats?: ChatListItem[],
): ChatHistoryState {
  return chats
    ? { status: 'ready', chats }
    : { ...state, status: 'loading', error: undefined }
}

export const failChatHistory = (
  state: ChatHistoryState,
  error: string,
): ChatHistoryState => ({ ...state, status: 'error', error })

export const selectRecentChats = (
  chats: ChatListItem[],
): ChatListItem[] => chats.slice(0, 5)

export const isActiveChat = (
  chatId: string,
  activeChatId?: string,
): boolean => chatId === activeChatId

export const getChatAccessibleName = (
  chat: Pick<ChatListItem, 'title'>,
): string => `打开对话：${chat.title}`

const localDateKey = (date: Date): string => [
  date.getFullYear(),
  date.getMonth(),
  date.getDate(),
].join('-')

export const formatChatUpdatedAt = (
  value: string,
  now = new Date(),
  locale = 'zh-CN',
): string => {
  const updatedAt = new Date(value)
  if (Number.isNaN(updatedAt.getTime())) return ''

  if (localDateKey(updatedAt) === localDateKey(now)) {
    return new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(updatedAt)
  }

  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (localDateKey(updatedAt) === localDateKey(yesterday)) return '昨天'

  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    day: 'numeric',
  }).format(updatedAt)
}
