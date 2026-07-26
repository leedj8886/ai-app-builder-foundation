import { Types } from 'mongoose';
import type { IProject } from '../models/Project';
import { ProjectBranch } from '../models/ProjectBranch';
import { ProjectSnapshot } from '../models/ProjectSnapshot';

export const MAIN_BRANCH_NAME = 'main';

export const ensureMainBranch = async (
  project: IProject
) => {
  if (!project.workspaceId) {
    throw new Error('Project is missing workspaceId');
  }

  return ProjectBranch.findOneAndUpdate(
    { projectId: project._id, name: MAIN_BRANCH_NAME },
    {
      $setOnInsert: {
        workspaceId: project.workspaceId,
        projectId: project._id,
        name: MAIN_BRANCH_NAME,
        status: 'active',
        headSnapshotId: project.activeSnapshotId,
        headVersion: project.activeSnapshotRevision ?? 0,
        createdFromSnapshotId: project.activeSnapshotId
      }
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
};

export const resolveProjectBranch = async (input: {
  project: IProject;
  branchId?: string | Types.ObjectId;
}) => input.branchId
  ? ProjectBranch.findOne({
      _id: input.branchId,
      workspaceId: input.project.workspaceId,
      projectId: input.project._id,
      status: 'active'
    })
  : ensureMainBranch(input.project);

export const createProjectBranch = async (input: {
  project: IProject;
  name: string;
  fromSnapshotId?: string | Types.ObjectId;
}) => {
  const main = input.fromSnapshotId
    ? null
    : await ensureMainBranch(input.project);
  const sourceSnapshotId = input.fromSnapshotId ?? main?.headSnapshotId;
  const snapshot = sourceSnapshotId
    ? await ProjectSnapshot.findOne({
        _id: sourceSnapshotId,
        projectId: input.project._id,
        userId: input.project.userId,
        'validation.status': { $ne: 'failed' }
      })
    : null;

  if (sourceSnapshotId && !snapshot) {
    throw Object.assign(new Error('Snapshot not found'), {
      statusCode: 404
    });
  }

  return ProjectBranch.create({
    workspaceId: input.project.workspaceId,
    projectId: input.project._id,
    name: input.name,
    status: 'active',
    headSnapshotId: snapshot?._id,
    headVersion: 0,
    createdFromSnapshotId: snapshot?._id
  });
};

export const setBranchHead = async (input: {
  branchId: Types.ObjectId;
  expectedHeadVersion: number;
  snapshotId: Types.ObjectId;
}) => ProjectBranch.findOneAndUpdate(
  {
    _id: input.branchId,
    status: 'active',
    headVersion: input.expectedHeadVersion
  },
  {
    $set: { headSnapshotId: input.snapshotId },
    $inc: { headVersion: 1 }
  },
  { new: true }
);

export type BranchHeadCommitResult =
  | { outcome: 'advanced'; headVersion: number }
  | { outcome: 'already_advanced'; headVersion: number }
  | { outcome: 'conflict'; headVersion: number };

export const commitBranchHead = async (input: {
  branchId: Types.ObjectId;
  expectedHeadVersion: number;
  snapshotId: Types.ObjectId;
}): Promise<BranchHeadCommitResult> => {
  const advanced = await setBranchHead(input);
  if (advanced) {
    return {
      outcome: 'advanced',
      headVersion: advanced.headVersion
    };
  }

  const current = await ProjectBranch.findById(input.branchId)
    .select('headSnapshotId headVersion');
  if (!current) {
    throw Object.assign(new Error('Project branch not found'), {
      code: 'PROJECT_BRANCH_NOT_FOUND'
    });
  }
  if (current.headSnapshotId?.equals(input.snapshotId)) {
    return {
      outcome: 'already_advanced',
      headVersion: current.headVersion
    };
  }
  return {
    outcome: 'conflict',
    headVersion: current.headVersion
  };
};
