import type { ProjectSnapshot } from '../models/ProjectSnapshot';
import { getPreviewConfig, type PreviewConfig } from './config';
import { signPreviewToken } from './token';

export interface VerifiedPreviewDescriptor {
  kind: 'verified-build';
  verification: 'verified';
  url: string;
}

export const verifiedPreviewDescriptor = (
  snapshot: InstanceType<typeof ProjectSnapshot>,
  config: PreviewConfig = getPreviewConfig()
): VerifiedPreviewDescriptor | undefined => {
  if (
    snapshot.validation.status !== 'passed' ||
    snapshot.validation.verification !== 'verified' ||
    !snapshot.previewArtifactId
  ) {
    return undefined;
  }
  const token = signPreviewToken({
    tokenUse: 'preview',
    workspaceId: snapshot.workspaceId.toString(),
    projectId: snapshot.projectId.toString(),
    snapshotId: snapshot._id.toString(),
    artifactId: snapshot.previewArtifactId
  }, config);
  return {
    kind: 'verified-build',
    verification: 'verified',
    url: `${config.publicOrigin}/api/previews/${encodeURIComponent(token)}/`
  };
};
