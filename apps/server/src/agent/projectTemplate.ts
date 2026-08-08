import {
  normalizeProjectProfileRef,
  resolveProjectProfile
} from './profiles/registry';
import type { ProfileRef } from './profiles/types';
import type { ProjectFile } from './types';

export const createProjectTemplateFiles = (
  profileRef?: ProfileRef
): ProjectFile[] => resolveProjectProfile(
  normalizeProjectProfileRef(profileRef)
).createTemplate();

export const resolveProjectBaseFiles = (
  snapshotFiles: ProjectFile[] | undefined,
  profileRef?: ProfileRef
): ProjectFile[] => snapshotFiles ?? createProjectTemplateFiles(profileRef);
