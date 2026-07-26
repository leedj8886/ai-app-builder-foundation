import { Types } from 'mongoose';
import type {
  ProjectFile,
  ProjectSnapshotPackageJson,
  ValidationResult
} from '../agent/types';
import { ProjectSnapshot } from '../models/ProjectSnapshot';
import { ValidationCandidate } from '../models/ValidationCandidate';
import { getArtifactService } from './runtime';

interface ArtifactFixtureBase {
  workspaceId: Types.ObjectId;
  branchId: Types.ObjectId;
  userId: Types.ObjectId;
  projectId: Types.ObjectId;
  sourceRunId: Types.ObjectId;
  files: ProjectFile[];
  packageJson: ProjectSnapshotPackageJson;
  summary: string;
}

const artifactFiles = (files: ProjectFile[]) => files.map(file => ({
  path: file.path,
  content: file.content,
  language: file.language,
  ...(file.generatedByRunId && {
    generatedByRunId: file.generatedByRunId.toString()
  })
}));

export const createArtifactBackedSnapshot = async (
  input: ArtifactFixtureBase & {
    parentSnapshotId?: Types.ObjectId;
    validation: ValidationResult;
  }
) => {
  const artifact = await getArtifactService().writeBundle({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    createdByRunId: input.sourceRunId,
    kind: 'project_snapshot',
    idempotencyKey: `snapshot:${input.sourceRunId.toString()}`,
    bundle: {
      version: 1,
      files: artifactFiles(input.files),
      packageJson: input.packageJson
    }
  });
  return ProjectSnapshot.create({
    workspaceId: input.workspaceId,
    branchId: input.branchId,
    userId: input.userId,
    projectId: input.projectId,
    sourceRunId: input.sourceRunId,
    parentSnapshotId: input.parentSnapshotId,
    artifactId: artifact.artifactId,
    validation: input.validation,
    summary: input.summary
  });
};

export const createArtifactBackedCandidate = async (
  input: ArtifactFixtureBase & { expiresAt: Date }
) => {
  const artifact = await getArtifactService().writeBundle({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    createdByRunId: input.sourceRunId,
    kind: 'validation_candidate',
    idempotencyKey: `candidate:${input.sourceRunId.toString()}`,
    bundle: {
      version: 1,
      files: artifactFiles(input.files),
      packageJson: input.packageJson
    }
  });
  return ValidationCandidate.create({
    workspaceId: input.workspaceId,
    branchId: input.branchId,
    userId: input.userId,
    projectId: input.projectId,
    sourceRunId: input.sourceRunId,
    artifactId: artifact.artifactId,
    summary: input.summary,
    expiresAt: input.expiresAt
  });
};
