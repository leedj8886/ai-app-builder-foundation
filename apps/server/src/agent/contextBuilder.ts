import { IAgentRun } from '../models/AgentRun';
import { Chat } from '../models/Chat';
import { Project } from '../models/Project';
import { ProjectSnapshot } from '../models/ProjectSnapshot';
import {
  AgentContext,
  AgentContextMessage,
  AgentRunMode
} from './types';
import { resolveProjectBaseFiles } from './projectTemplate';

interface ContextBuilderInput {
  prompt: string;
  mode: AgentRunMode;
  project: {
    name: string;
    description?: string;
    settings: {
      framework: string;
      styling: string;
      uiLibrary: string;
    };
  };
  messages: AgentContextMessage[];
  files: Array<{ path: string; content: string }>;
}

const agentError = (code: string, message: string): Error & { code: string } =>
  Object.assign(new Error(message), { code });

export const buildAgentContext = (
  input: ContextBuilderInput,
  contextCharLimit: number
): AgentContext => {
  let remaining = Math.max(0, contextCharLimit);
  const take = (value: string): string => {
    const selected = value.slice(0, remaining);
    remaining -= selected.length;
    return selected;
  };
  const prompt = take(input.prompt);
  const projectName = take(input.project.name);
  const projectDescription = input.project.description
    ? take(input.project.description)
    : undefined;
  const fileManifest = input.files
    .map(file => ({ path: take(file.path), original: file }))
    .filter(file => file.path.length > 0);
  const selectedMessages: AgentContextMessage[] = [];

  for (const message of input.messages.slice(-20).reverse()) {
    if (remaining <= 0) {
      break;
    }

    selectedMessages.unshift({
      role: message.role,
      content: take(message.content)
    });
  }

  const includeContents = fileManifest.every(
    file => file.original.content.length <= remaining
  );

  return {
    prompt,
    mode: input.mode,
    project: {
      name: projectName,
      description: projectDescription,
      framework: 'react',
      styling: 'tailwind',
      uiLibrary: input.project.settings.uiLibrary
    },
    messages: selectedMessages,
    files: fileManifest
      .map(file => ({
        path: file.path,
        ...(includeContents && { content: take(file.original.content) })
      }))
      .sort((left, right) => left.path.localeCompare(right.path))
  };
};

export const loadAgentContext = async (
  run: IAgentRun,
  contextCharLimit: number
): Promise<AgentContext> => {
  const project = await Project.findOne({
    _id: run.projectId,
    userId: run.userId
  });

  if (!project) {
    throw agentError('PROJECT_NOT_FOUND', 'Project not found');
  }

  const chat = run.chatId
    ? await Chat.findOne({
        _id: run.chatId,
        userId: run.userId,
        projectId: run.projectId
      })
    : null;

  const baseSnapshot = run.baseSnapshotId
    ? await ProjectSnapshot.findOne({
        _id: run.baseSnapshotId,
        projectId: run.projectId,
        userId: run.userId
      })
    : null;

  if (run.mode === 'edit' && !baseSnapshot) {
    throw agentError('INVALID_BASE_SNAPSHOT', 'Edit mode requires a valid base snapshot');
  }

  const contextFiles = resolveProjectBaseFiles(
    baseSnapshot
      ? baseSnapshot.files.map(file => ({
          path: file.path,
          content: file.content,
          language: file.language
        }))
      : undefined
  );

  return buildAgentContext({
    prompt: run.prompt,
    mode: run.mode,
    project: {
      name: project.name,
      description: project.description,
      settings: project.settings
    },
    messages: chat?.messages.map(message => ({
      role: message.role,
      content: message.content
    })) ?? [],
    files: contextFiles.map(file => ({
      path: file.path,
      content: file.content
    }))
  }, contextCharLimit);
};
