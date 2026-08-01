export interface RoutedChatProject {
  projectId?: string
}

export const buildChatPath = (chatId: string): string =>
  `/chats/${encodeURIComponent(chatId)}`

export const resolveRoutedProjectId = (chat: RoutedChatProject): string => {
  if (!chat.projectId) {
    throw new Error('This chat is not associated with a project')
  }

  return chat.projectId
}

export const buildEditRunRequest = (input: {
  chatId: string
  projectId: string
  prompt: string
  activeSnapshotId?: string
  modelId?: string
}) => {
  const prompt = input.prompt.trim()

  if (!prompt) {
    throw new Error('Prompt is required')
  }
  if (!input.activeSnapshotId) {
    throw new Error('Edit mode requires an active snapshot')
  }

  return {
    chatId: input.chatId,
    projectId: input.projectId,
    prompt,
    mode: 'edit' as const,
    ...(input.modelId ? { modelId: input.modelId } : {}),
  }
}
