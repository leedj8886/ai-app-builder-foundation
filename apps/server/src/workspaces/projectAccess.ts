import { Types } from 'mongoose';
import { Chat } from '../models/Chat';
import { Project } from '../models/Project';
import { WorkspaceMember } from '../models/WorkspaceMember';

interface OwnedProjectInput {
  projectId: string | Types.ObjectId;
  userId: string | Types.ObjectId;
}

export const findOwnedWorkspaceProject = async (
  input: OwnedProjectInput
) => {
  const project = await Project.findOne({
    _id: input.projectId,
    userId: input.userId
  });
  if (!project?.workspaceId) return null;

  const membership = await WorkspaceMember.exists({
    workspaceId: project.workspaceId,
    userId: input.userId
  });

  return membership ? project : null;
};

export const workspaceIdsForUser = async (
  userId: string | Types.ObjectId
): Promise<Types.ObjectId[]> => WorkspaceMember.distinct(
  'workspaceId',
  { userId }
);

export const ownedProjectIdsForUser = async (
  userId: string | Types.ObjectId
): Promise<Types.ObjectId[]> => {
  const workspaceIds = await workspaceIdsForUser(userId);
  return Project.distinct('_id', {
    userId,
    workspaceId: { $in: workspaceIds }
  });
};

export const findOwnedWorkspaceChat = async (input: {
  chatId: string | Types.ObjectId;
  userId: string | Types.ObjectId;
}) => {
  const chat = await Chat.findOne({
    _id: input.chatId,
    userId: input.userId
  });
  if (!chat?.projectId) return chat;
  const project = await findOwnedWorkspaceProject({
    projectId: chat.projectId,
    userId: input.userId
  });
  return project ? chat : null;
};
