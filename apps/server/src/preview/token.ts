import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import type { PreviewConfig } from './config';

interface PreviewTokenPayload {
  tokenUse: 'preview';
  workspaceId: string;
  projectId: string;
  snapshotId: string;
  artifactId: string;
}

const objectId = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) {
    throw new Error(`Invalid Preview token ${name}`);
  }
  return value;
};

const artifactId = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[0-9a-f]{32}$/.test(value)) {
    throw new Error('Invalid Preview token artifactId');
  }
  return value;
};

export const signPreviewToken = (
  payload: PreviewTokenPayload,
  config: PreviewConfig
): string => jwt.sign(payload, config.signingSecret, {
  audience: 'open-v0-preview',
  issuer: 'open-v0',
  expiresIn: config.tokenTtlSeconds
});

export const verifyPreviewToken = (
  token: string,
  config: PreviewConfig
): PreviewTokenPayload => {
  const decoded = jwt.verify(token, config.signingSecret, {
    audience: 'open-v0-preview',
    issuer: 'open-v0'
  });
  if (
    typeof decoded !== 'object' ||
    decoded === null ||
    decoded.tokenUse !== 'preview'
  ) {
    throw new Error('Invalid Preview token purpose');
  }
  return {
    tokenUse: 'preview',
    workspaceId: objectId(decoded.workspaceId, 'workspaceId'),
    projectId: objectId(decoded.projectId, 'projectId'),
    snapshotId: objectId(decoded.snapshotId, 'snapshotId'),
    artifactId: artifactId(decoded.artifactId)
  };
};
