import { AgentRun } from '../models/AgentRun';
import { Chat } from '../models/Chat';
import { Project } from '../models/Project';
import { ProjectBranch } from '../models/ProjectBranch';
import { User } from '../models/User';
import { Workspace } from '../models/Workspace';
import { WorkspaceMember } from '../models/WorkspaceMember';

export const migrateWorkspaceBranches = async (): Promise<void> => {
  const users = await User.find().sort({ createdAt: 1, _id: 1 });
  if (users.length === 0) return;

  const owner = users[0]!;
  const workspace = await Workspace.findOneAndUpdate(
    { slug: 'default' },
    {
      $setOnInsert: {
        slug: 'default',
        name: 'Default Workspace',
        status: 'active',
        createdByUserId: owner._id
      }
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  for (const user of users) {
    await WorkspaceMember.updateOne(
      { workspaceId: workspace._id, userId: user._id },
      {
        $setOnInsert: {
          role: user._id.equals(owner._id) ? 'owner' : 'member'
        }
      },
      { upsert: true, setDefaultsOnInsert: true }
    );
  }

  const projects = await Project.find();
  for (const project of projects) {
    if (!project.workspaceId) {
      await Project.updateOne(
        { _id: project._id, workspaceId: { $exists: false } },
        { $set: { workspaceId: workspace._id } }
      );
      project.workspaceId = workspace._id;
    }

    const branch = await ProjectBranch.findOneAndUpdate(
      { projectId: project._id, name: 'main' },
      {
        $setOnInsert: {
          workspaceId: project.workspaceId,
          projectId: project._id,
          name: 'main',
          status: 'active',
          headSnapshotId: project.activeSnapshotId,
          headVersion: project.activeSnapshotRevision ?? 0,
          createdFromSnapshotId: project.activeSnapshotId
        }
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    await Chat.updateMany(
      { projectId: project._id, branchId: { $exists: false } },
      { $set: { branchId: branch._id } }
    );
    await AgentRun.updateMany(
      { projectId: project._id, workspaceId: { $exists: false } },
      { $set: { workspaceId: project.workspaceId } }
    );
    await AgentRun.updateMany(
      { projectId: project._id, branchId: { $exists: false } },
      { $set: { branchId: branch._id } }
    );

    const legacyRuns = await AgentRun.find({
      projectId: project._id,
      baseHeadVersion: { $exists: false }
    }).select('_id baseSnapshotRevision');
    if (legacyRuns.length > 0) {
      await AgentRun.bulkWrite(legacyRuns.map(run => ({
        updateOne: {
          filter: { _id: run._id, baseHeadVersion: { $exists: false } },
          update: {
            $set: {
              baseHeadVersion: run.baseSnapshotRevision ?? 0
            }
          }
        }
      })));
    }
  }
};

export const verifyWorkspaceBranchMigration =
  async (): Promise<void> => {
    const counts = {
      projectsWithoutWorkspace: await Project.countDocuments({
        workspaceId: { $exists: false }
      }),
      chatsWithoutBranch: await Chat.countDocuments({
        projectId: { $exists: true },
        branchId: { $exists: false }
      }),
      runsWithoutWorkspace: await AgentRun.countDocuments({
        workspaceId: { $exists: false }
      }),
      runsWithoutBranch: await AgentRun.countDocuments({
        branchId: { $exists: false }
      }),
      runsWithoutBaseHeadVersion: await AgentRun.countDocuments({
        baseHeadVersion: { $exists: false }
      })
    };

    const failures = Object.entries(counts).filter(([, count]) => count > 0);
    if (failures.length > 0) {
      throw new Error(
        `Workspace/Branch migration incomplete: ${JSON.stringify(counts)}`
      );
    }
  };
