import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom'
import { ChatHistoryPage } from '@/pages/ChatHistoryPage'
import { AppBuilderPage } from '@/pages/AppBuilderPage'
import { I18nProvider } from '@/lib/i18n'

function LegacyChatRedirect() {
  const { chatId } = useParams<{ chatId: string }>()
  return <Navigate to={chatId ? `/chats/${encodeURIComponent(chatId)}` : '/chats'} replace />
}

function App() {
  return (
    <I18nProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<AppBuilderPage />} />
          <Route path="/chats" element={<ChatHistoryPage />} />
          <Route path="/chats/:chatId" element={<AppBuilderPage />} />
          <Route path="/v0/chats" element={<LegacyChatRedirect />} />
          <Route path="/v0/chats/:chatId" element={<LegacyChatRedirect />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </I18nProvider>
  )
}

export default App
