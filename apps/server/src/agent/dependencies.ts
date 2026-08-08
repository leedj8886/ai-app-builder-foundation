import {
  normalizeProjectProfileRef,
  resolveProjectProfile
} from './profiles/registry';
import type { ProfileRef } from './profiles/types';
import type { ProjectSnapshotPackageJson } from './types';

interface GeneratedDependencies {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

export const mergeProjectPackageJson = (
  base: ProjectSnapshotPackageJson | undefined,
  generated: GeneratedDependencies,
  profileRef?: ProfileRef
): ProjectSnapshotPackageJson => resolveProjectProfile(
  normalizeProjectProfileRef(profileRef)
).mergePackageJson({
  base,
  generated
});
