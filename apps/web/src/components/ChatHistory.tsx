import { useState } from 'react'
import { MessageSquare, MoreHorizontal, Trash2, Edit2 } from 'lucide-react'
import { Button } from './ui/Button'
import type { Chat } from '@/types'

interface ChatHistoryProps {
  chats: Array<Pick<Chat, '_id' | 'title'>>
  currentChatId?: string
  onSelectChat: (chatId: string) => void
  onDeleteChat: (chatId: string) => void
  onRenameChat: (chatId: string, newTitle: string) => void
}

function ChatItem({ 
  chat, 
  isActive, 
  onSelect, 
  onDelete, 
  onRename 
}: { 
  chat: Pick<Chat, '_id' | 'title'>
  isActive: boolean
  onSelect: () => void
  onDelete: () => void
  onRename: (newTitle: string) => void
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(chat.title)
  const [showMenu, setShowMenu] = useState(false)

  const handleRename = () => {
    if (editTitle.trim() && editTitle !== chat.title) {
      onRename(editTitle.trim())
    }
    setIsEditing(false)
  }

  return (
    <div
      className={`group flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer transition-colors ${
        isActive 
          ? 'bg-primary/10 text-primary' 
          : 'hover:bg-muted text-muted-foreground hover:text-foreground'
      }`}
      onClick={onSelect}
    >
      <MessageSquare className="h-4 w-4 shrink-0" />
      {isEditing ? (
        <input
          type="text"
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onBlur={handleRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleRename()
            if (e.key === 'Escape') {
              setEditTitle(chat.title)
              setIsEditing(false)
            }
          }}
          autoFocus
          className="flex-1 bg-transparent text-sm outline-none border-b border-primary"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="flex-1 text-sm truncate">{chat.title}</span>
      )}
      
      <div className="relative">
        <Button
          variant="ghost"
          size="icon"
          className={`h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity ${
            showMenu ? 'opacity-100' : ''
          }`}
          onClick={(e) => {
            e.stopPropagation()
            setShowMenu(!showMenu)
          }}
        >
          <MoreHorizontal className="h-3 w-3" />
        </Button>
        
        {showMenu && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setShowMenu(false)}
            />
            <div className="absolute right-0 top-full mt-1 w-32 bg-popover border border-border rounded-lg shadow-lg z-50 py-1">
              <button
                className="w-full px-3 py-2 text-left text-sm hover:bg-muted flex items-center gap-2"
                onClick={(e) => {
                  e.stopPropagation()
                  setIsEditing(true)
                  setShowMenu(false)
                }}
              >
                <Edit2 className="h-3 w-3" />
                Rename
              </button>
              <button
                className="w-full px-3 py-2 text-left text-sm hover:bg-muted text-destructive flex items-center gap-2"
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete()
                  setShowMenu(false)
                }}
              >
                <Trash2 className="h-3 w-3" />
                Delete
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export function ChatHistory({ 
  chats, 
  currentChatId, 
  onSelectChat, 
  onDeleteChat, 
  onRenameChat 
}: ChatHistoryProps) {
  return (
    <div className="space-y-1">
      <div className="px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
        Recent Chats
      </div>
      {chats.length === 0 ? (
        <div className="px-3 py-4 text-sm text-muted-foreground text-center">
          No chats yet
        </div>
      ) : (
        chats.map((chat) => (
          <ChatItem
            key={chat._id}
            chat={chat}
            isActive={chat._id === currentChatId}
            onSelect={() => onSelectChat(chat._id)}
            onDelete={() => onDeleteChat(chat._id)}
            onRename={(newTitle) => onRenameChat(chat._id, newTitle)}
          />
        ))
      )}
    </div>
  )
}
