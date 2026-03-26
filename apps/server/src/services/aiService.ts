import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';
import { IMessage, ICodeBlock } from '../models/Chat';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || ''
});

export interface GenerateCodeOptions {
  framework?: 'react' | 'vue' | 'svelte';
  styling?: 'tailwind' | 'css-modules';
  uiLibrary?: 'shadcn' | 'none';
}

const SYSTEM_PROMPT = `You are an expert frontend developer specializing in React, Tailwind CSS, and shadcn/ui.
Your task is to generate high-quality, production-ready React components based on user descriptions.

Guidelines:
1. Use React functional components with hooks
2. Use Tailwind CSS for styling
3. Use shadcn/ui components when appropriate (Button, Card, Input, etc.)
4. Make components responsive and accessible
5. Add proper TypeScript types
6. Include necessary imports
7. Export the component as default
8. Add comments explaining complex logic

When generating code, wrap it in markdown code blocks with the language specified.
If multiple files are needed, separate them clearly with file names.

Example response format:
Here's a beautiful button component:

\`\`\`tsx:components/ui/Button.tsx
import React from 'react';
import { cn } from '@/lib/utils';

export interface ButtonProps {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary';
  onClick?: () => void;
}

export const Button: React.FC<ButtonProps> = ({ children, variant = 'primary', onClick }) => {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-4 py-2 rounded-lg font-medium transition-colors',
        variant === 'primary' && 'bg-blue-500 text-white hover:bg-blue-600',
        variant === 'secondary' && 'bg-gray-200 text-gray-800 hover:bg-gray-300'
      )}
    >
      {children}
    </button>
  );
};
\`\`\``;

export const generateCode = async (
  messages: IMessage[],
  options: GenerateCodeOptions = {}
): Promise<{ content: string; codeBlocks: ICodeBlock[] }> => {
  const { framework = 'react', styling = 'tailwind', uiLibrary = 'shadcn' } = options;

  const formattedMessages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...messages.map(m => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content
    }))
  ];

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages: formattedMessages as any,
      temperature: 0.7,
      max_tokens: 4000
    });

    const content = response.choices[0]?.message?.content || '';
    const codeBlocks = extractCodeBlocks(content);

    return { content, codeBlocks };
  } catch (error) {
    console.error('OpenAI API error:', error);
    throw new Error('Failed to generate code');
  }
};

const extractCodeBlocks = (content: string): ICodeBlock[] => {
  const codeBlocks: ICodeBlock[] = [];
  
  // Match code blocks with file names: ```tsx:filename.tsx
  const codeBlockRegex = /```(\w+)?(?::([^\n]+))?\n([\s\S]*?)```/g;
  let match;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    const language = match[1] || 'tsx';
    const fileName = match[2] || `component.${language}`;
    const code = match[3].trim();

    codeBlocks.push({
      id: uuidv4(),
      language,
      code,
      fileName: fileName.trim(),
      dependencies: extractDependencies(code)
    });
  }

  return codeBlocks;
};

const extractDependencies = (code: string): string[] => {
  const dependencies: string[] = [];
  
  // Match imports from npm packages
  const importRegex = /import\s+.*?\s+from\s+['"]([^'"./][^'"]*)['"];?/g;
  let match;

  while ((match = importRegex.exec(code)) !== null) {
    const packageName = match[1].split('/')[0]; // Get base package name
    if (!dependencies.includes(packageName)) {
      dependencies.push(packageName);
    }
  }

  return dependencies;
};

export const generateChatTitle = async (firstMessage: string): Promise<string> => {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'Generate a short, concise title (max 5 words) for a chat based on the user\'s first message. Just return the title, no quotes.'
        },
        { role: 'user', content: firstMessage }
      ],
      temperature: 0.7,
      max_tokens: 20
    });

    return response.choices[0]?.message?.content?.trim() || 'New Chat';
  } catch (error) {
    console.error('Error generating title:', error);
    return 'New Chat';
  }
};
