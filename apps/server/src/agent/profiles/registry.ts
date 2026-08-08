import { ProfileError } from './errors';
import {
  STATIC_REACT_PROFILE_REF,
  staticReactProfile
} from './staticReactProfile';
import { fullstackNestPrismaProfile } from './fullstackNestPrismaProfile';
import type { ProfileRef, ProjectProfile } from './types';

const profileIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const canonicalProfileName = (ref: ProfileRef): string => {
  if (
    !profileIdPattern.test(ref.id) ||
    !Number.isSafeInteger(ref.version) ||
    ref.version < 1
  ) {
    throw new ProfileError(
      'PROFILE_INVALID_REF',
      'Project Profile reference must contain a stable id and positive version'
    );
  }

  return `${ref.id}/v${ref.version}`;
};

export class ProjectProfileRegistry {
  private readonly profiles: ReadonlyMap<string, ProjectProfile>;

  constructor(profiles: readonly ProjectProfile[]) {
    const entries = new Map<string, ProjectProfile>();
    for (const profile of profiles) {
      const name = canonicalProfileName(profile.ref);
      if (entries.has(name)) {
        throw new ProfileError(
          'PROFILE_DUPLICATE',
          `Project Profile is registered more than once: ${name}`
        );
      }
      entries.set(name, profile);
    }
    this.profiles = entries;
  }

  resolve(ref: ProfileRef): ProjectProfile {
    const name = canonicalProfileName(ref);
    const profile = this.profiles.get(name);
    if (!profile) {
      throw new ProfileError(
        'PROFILE_NOT_FOUND',
        `Project Profile is not registered: ${name}`
      );
    }
    return profile;
  }

  list(): ProjectProfile[] {
    return [...this.profiles.values()];
  }
}

export const projectProfileRegistry = new ProjectProfileRegistry([
  staticReactProfile,
  fullstackNestPrismaProfile
]);

export const defaultProjectProfileRef = (): ProfileRef => ({
  ...STATIC_REACT_PROFILE_REF
});

export const resolveProjectProfile = (ref: ProfileRef): ProjectProfile =>
  projectProfileRegistry.resolve(ref);

export const normalizeProjectProfileRef = (
  ref?: ProfileRef
): ProfileRef => ({
  ...resolveProjectProfile(ref ?? STATIC_REACT_PROFILE_REF).ref
});

export const projectProfileRefsEqual = (
  left: ProfileRef | undefined,
  right: ProfileRef | undefined
): boolean => {
  const comparableLeft = left ?? STATIC_REACT_PROFILE_REF;
  const comparableRight = right ?? STATIC_REACT_PROFILE_REF;
  canonicalProfileName(comparableLeft);
  canonicalProfileName(comparableRight);
  return comparableLeft.id === comparableRight.id &&
    comparableLeft.version === comparableRight.version;
};

export const assertProjectProfileMatch = (
  expected: ProfileRef | undefined,
  actual: ProfileRef | undefined,
  message = 'Project Profile references do not match'
): ProfileRef => {
  if (!projectProfileRefsEqual(expected, actual)) {
    throw new ProfileError('PROFILE_MISMATCH', message);
  }
  return normalizeProjectProfileRef(expected);
};
