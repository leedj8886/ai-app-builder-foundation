const PREVIEW_LENGTH = 160;

interface ChatListSource {
  _id: { toString(): string } | string;
  projectId?: { toString(): string } | string;
  title: string;
  messages: Array<{ role: string; content: string }>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatListItem {
  _id: string;
  projectId?: string;
  title: string;
  preview?: string;
  createdAt: string;
  updatedAt: string;
}

export const projectChatListItem = (
  chat: ChatListSource
): ChatListItem => {
  const content = chat.messages
    .find(message => message.role === 'user')
    ?.content.trim().replace(/\s+/g, ' ');
  const preview = content
    ? content.length <= PREVIEW_LENGTH
      ? content
      : `${content.slice(0, PREVIEW_LENGTH - 3)}...`
    : undefined;

  return {
    _id: chat._id.toString(),
    ...(chat.projectId ? { projectId: chat.projectId.toString() } : {}),
    title: chat.title,
    ...(preview ? { preview } : {}),
    createdAt: chat.createdAt.toISOString(),
    updatedAt: chat.updatedAt.toISOString()
  };
};
