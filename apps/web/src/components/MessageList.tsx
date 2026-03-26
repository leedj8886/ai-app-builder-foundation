import { useRef, useEffect } from 'react'
import type { Message, CodeBlock } from '@/types'
import { User, Bot, Copy, Check, Download } from 'lucide-react'
import { Button } from './ui/Button'
import { useState } from 'react'
import { Sandpack } from '@codesandbox/sandpack-react'

interface MessageListProps {
  messages: Message[]
  isLoading?: boolean
}

function CodePreview({ codeBlocks }: { codeBlocks: CodeBlock[] }) {
  if (!codeBlocks || codeBlocks.length === 0) return null

  const mainFile = codeBlocks.find(cb => cb.fileName.includes('App') || cb.fileName.includes('index')) || codeBlocks[0]
  
  const files: Record<string, string> = {}
  codeBlocks.forEach(cb => {
    files[`/${cb.fileName}`] = cb.code
  })

  // Ensure App.tsx exists
  if (!files['/App.tsx']) {
    files['/App.tsx'] = mainFile.code
  }

  return (
    <div className="mt-4 rounded-lg overflow-hidden border border-border">
      <Sandpack
        template="react-ts"
        files={files}
        options={{
          showNavigator: false,
          showTabs: codeBlocks.length > 1,
          editorHeight: 400,
          showLineNumbers: true,
          wrapContent: true,
        }}
        theme="dark"
      />
    </div>
  )
}

function CodeBlockDisplay({ codeBlock }: { codeBlock: CodeBlock }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(codeBlock.code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="mt-3 rounded-lg border border-border overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-muted border-b border-border">
        <span className="text-xs font-medium text-muted-foreground">
          {codeBlock.fileName}
        </span>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleCopy}
          >
            {copied ? (
              <Check className="h-3 w-3 text-green-500" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
          >
            <Download className="h-3 w-3" />
          </Button>
        </div>
      </div>
      <pre className="p-3 overflow-x-auto bg-card">
        <code className="text-xs font-mono">{codeBlock.code}</code>
      </pre>
    </div>
  )
}

function MessageItem({ message }: { message: Message }) {
  const isUser = message.role === 'user'

  return (
    <div className={`py-6 ${isUser ? 'bg-transparent' : 'bg-muted/30'}`}>
      <div className="max-w-4xl mx-auto px-4 flex gap-4">
        {/* Avatar */}
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
          isUser ? 'bg-primary/10' : 'bg-gradient-to-br from-violet-500 to-fuchsia-500'
        }`}>
          {isUser ? (
            <User className="h-4 w-4 text-primary" />
          ) : (
            <Bot className="h-4 w-4 text-white" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-sm">
              {isUser ? 'You' : 'v0'}
            </span>
            <span className="text-xs text-muted-foreground">
              {new Date(message.createdAt).toLocaleTimeString()}
            </span>
          </div>
          
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {message.content}
            </p>
          </div>

          {/* Code Blocks */}
          {message.codeBlocks && message.codeBlocks.length > 0 && (
            <>
              <CodePreview codeBlocks={message.codeBlocks} />
              <div className="mt-4 space-y-2">
                {message.codeBlocks.map((codeBlock) => (
                  <CodeBlockDisplay key={codeBlock.id} codeBlock={codeBlock} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export function MessageList({ messages, isLoading }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div className="flex-1 overflow-y-auto">
      {messages.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full text-center px-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center mb-4">
            <Bot className="h-8 w-8 text-white" />
          </div>
          <h2 className="text-2xl font-bold mb-2">Welcome to v0 by kimi</h2>
          <p className="text-muted-foreground max-w-md">
            Describe what you want to build, and I'll generate a beautiful, 
            production-ready React component for you.
          </p>
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg">
            {[
              "A landing page with hero section and features",
              "A dashboard with charts and statistics",
              "A login form with validation",
              "A pricing table with 3 tiers"
            ].map((suggestion) => (
              <button
                key={suggestion}
                className="p-3 text-left text-sm rounded-lg border border-border hover:bg-muted transition-colors"
                onClick={() => {/* TODO: Implement suggestion click */}}
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          {messages.map((message) => (
            <MessageItem key={message.id} message={message} />
          ))}
          {isLoading && (
            <div className="py-6 bg-muted/30">
              <div className="max-w-4xl mx-auto px-4 flex gap-4">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shrink-0">
                  <Bot className="h-4 w-4 text-white" />
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" />
                  <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce delay-100" />
                  <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce delay-200" />
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </>
      )}
    </div>
  )
}
