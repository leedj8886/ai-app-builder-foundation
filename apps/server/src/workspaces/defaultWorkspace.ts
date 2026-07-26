import { Types } from 'mongoose';
import { Workspace } from '../models/Workspace';
import { WorkspaceMember } from '../models/WorkspaceMember';

export const DEFAULT_WORKSPACE_SLUG = 'default';

export const ensureDefaultWorkspaceForUser = async (
  userId: Types.ObjectId
) => {
  const workspace = await Workspace.findOneAndUpdate(
    { slug: DEFAULT_WORKSPACE_SLUG },
    {
      $setOnInsert: {
        slug: DEFAULT_WORKSPACE_SLUG,
        name: 'Default Workspace',
        status: 'active',
        createdByUserId: userId
      }
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true
    }
  );

  const role = workspace.createdByUserId.equals(userId)
    ? 'owner'
    : 'member';
  const membership = await WorkspaceMember.findOneAndUpdate(
    { workspaceId: workspace._id, userId },
    { $setOnInsert: { role } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  return { workspace, membership };
};
