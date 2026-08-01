export interface RoutedChatProject {
  projectId?: string
}

interface RunRequestAttachment {
  id: string
  name: string
  mediaType: string
  size: number
  content: string
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
  attachments?: RunRequestAttachment[]
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
    ...(input.attachments?.length ? { attachments: input.attachments } : {}),
  }
}

export const buildWorkspaceRunRequest = (input: {
  chatId: string
  projectId: string
  prompt: string
  activeSnapshotId?: string
  modelId?: string
  attachments?: RunRequestAttachment[]
}) => {
  if (input.activeSnapshotId) {
    return buildEditRunRequest(input)
  }

  const prompt = input.prompt.trim()
  if (!prompt) {
    throw new Error('Prompt is required')
  }

  return {
    chatId: input.chatId,
    projectId: input.projectId,
    prompt,
    mode: 'create' as const,
    ...(input.modelId ? { modelId: input.modelId } : {}),
    ...(input.attachments?.length ? { attachments: input.attachments } : {}),
  }
}
