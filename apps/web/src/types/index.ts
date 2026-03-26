export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
}

export interface CodeBlock {
  id: string;
  language: string;
  code: string;
  fileName: string;
  dependencies?: string[];
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  codeBlocks?: CodeBlock[];
  createdAt: string;
}

export interface Chat {
  _id: string;
  userId: string;
  projectId?: string;
  title: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  _id: string;
  userId: string;
  name: string;
  description?: string;
  chatIds: string[];
  settings: {
    framework: 'react' | 'vue' | 'svelte';
    styling: 'tailwind' | 'css-modules' | 'styled-components';
    uiLibrary: 'shadcn' | 'mui' | 'antd' | 'none';
  };
  createdAt: string;
  updatedAt: string;
}
