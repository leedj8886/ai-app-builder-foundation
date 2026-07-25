import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ChatHistoryPage } from '@/pages/ChatHistoryPage'
import { V0Clone } from '@/pages/V0Clone'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<V0Clone />} />
        <Route path="/v0/chats" element={<ChatHistoryPage />} />
        <Route path="/v0/chats/:chatId" element={<V0Clone />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
