import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Sidebar } from '@/components/ui/Sidebar'
import { ChatInput } from '@/components/ChatInput'
import { MessageList } from '@/components/MessageList'
import { ChatHistory } from '@/components/ChatHistory'
import { chatApi } from '@/services/api'
import type { Chat as ChatType } from '@/types'
import toast from 'react-hot-toast'

export function Chat() {
  const { chatId } = useParams<{ chatId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [currentChat, setCurrentChat] = useState<ChatType | null>(null)

  // Fetch all chats
  const { data: chatsData } = useQuery({
    queryKey: ['chats'],
    queryFn: async () => {
      const response = await chatApi.getAll()
      return response.data.chats
    },
  })

  // Fetch current chat
  const { data: chatData } = useQuery({
    queryKey: ['chat', chatId],
    queryFn: async () => {
      if (!chatId) return null
      const response = await chatApi.getById(chatId)
      return response.data.chat
    },
    enabled: !!chatId,
  })

  useEffect(() => {
    if (chatData) {
      setCurrentChat(chatData)
    }
  }, [chatData])

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: ({ chatId, content }: { chatId: string; content: string }) =>
      chatApi.sendMessage(chatId, content),
    onSuccess: (response) => {
      setCurrentChat(response.data.chat)
    },
    onError: () => {
      toast.error('Failed to send message')
    },
  })

  // Delete chat mutation
  const deleteChatMutation = useMutation({
    mutationFn: (id: string) => chatApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] })
      if (chatId) {
        navigate('/chat')
      }
      toast.success('Chat deleted')
    },
    onError: () => {
      toast.error('Failed to delete chat')
    },
  })

  // Rename chat mutation
  const renameChatMutation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      chatApi.update(id, title),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] })
      queryClient.invalidateQueries({ queryKey: ['chat', chatId] })
      toast.success('Chat renamed')
    },
    onError: () => {
      toast.error('Failed to rename chat')
    },
  })

  const handleSendMessage = (message: string) => {
    if (chatId) {
      sendMessageMutation.mutate({ chatId, content: message })
    } else {
      toast.error('Create a project conversation from the v0 home page')
    }
  }

  const handleNewChat = () => {
    navigate('/chat')
    setCurrentChat(null)
    setSidebarOpen(false)
  }

  const handleSelectChat = (id: string) => {
    navigate(`/chat/${id}`)
    setSidebarOpen(false)
  }

  const handleDeleteChat = (id: string) => {
    if (confirm('Are you sure you want to delete this chat?')) {
      deleteChatMutation.mutate(id)
    }
  }

  const handleRenameChat = (id: string, newTitle: string) => {
    renameChatMutation.mutate({ id, title: newTitle })
  }

  return (
    <div className="flex h-screen bg-background">
      <Sidebar
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        onNewChat={handleNewChat}
      >
        <ChatHistory
          chats={chatsData || []}
          currentChatId={chatId}
          onSelectChat={handleSelectChat}
          onDeleteChat={handleDeleteChat}
          onRenameChat={handleRenameChat}
        />
      </Sidebar>

      <main className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-4">
            <h1 className="font-semibold">
              {currentChat?.title || 'New Chat'}
            </h1>
          </div>
        </header>

        {/* Messages */}
        <MessageList
          messages={currentChat?.messages || []}
          isLoading={sendMessageMutation.isPending}
        />

        {/* Input */}
        <div className="p-4 border-t border-border">
          <div className="max-w-4xl mx-auto">
            <ChatInput
              onSend={handleSendMessage}
              isLoading={sendMessageMutation.isPending}
            />
            <p className="text-xs text-muted-foreground text-center mt-2">
              AI can make mistakes. Please verify important information.
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}
