import assert from 'node:assert/strict';
import test from 'node:test';
import { ProfileError } from './errors';
import {
  canonicalProfileName,
  defaultProjectProfileRef,
  assertProjectProfileMatch,
  normalizeProjectProfileRef,
  projectProfileRefsEqual,
  ProjectProfileRegistry,
  resolveProjectProfile
} from './registry';
import {
  STATIC_REACT_PROFILE_REF,
  staticReactProfile
} from './staticReactProfile';

test('registry resolves an exact Profile id and version', () => {
  const registry = new ProjectProfileRegistry([staticReactProfile]);

  assert.equal(
    registry.resolve({ id: 'static-react', version: 1 }),
    staticReactProfile
  );
  assert.equal(canonicalProfileName(STATIC_REACT_PROFILE_REF), 'static-react/v1');
  assert.equal(resolveProjectProfile(defaultProjectProfileRef()), staticReactProfile);
});

test('registry rejects invalid and unknown Profile references', () => {
  assert.throws(
    () => canonicalProfileName({ id: 'static-react/v1', version: 1 }),
    (error: unknown) =>
      error instanceof ProfileError && error.code === 'PROFILE_INVALID_REF'
  );
  assert.throws(
    () => resolveProjectProfile({ id: 'static-react', version: 2 }),
    (error: unknown) =>
      error instanceof ProfileError && error.code === 'PROFILE_NOT_FOUND'
  );
});

test('registry rejects duplicate canonical Profile names', () => {
  assert.throws(
    () => new ProjectProfileRegistry([
      staticReactProfile,
      { ...staticReactProfile, ref: { ...STATIC_REACT_PROFILE_REF } }
    ]),
    (error: unknown) =>
      error instanceof ProfileError && error.code === 'PROFILE_DUPLICATE'
  );
});

test('legacy missing Profile references normalize to static-react/v1', () => {
  assert.deepEqual(normalizeProjectProfileRef(undefined), {
    id: 'static-react',
    version: 1
  });
  assert.equal(
    projectProfileRefsEqual(undefined, { id: 'static-react', version: 1 }),
    true
  );
  assert.deepEqual(
    assertProjectProfileMatch(undefined, STATIC_REACT_PROFILE_REF),
    STATIC_REACT_PROFILE_REF
  );
});

test('Profile mismatch is rejected with a stable conflict error', () => {
  assert.throws(
    () => assertProjectProfileMatch(
      STATIC_REACT_PROFILE_REF,
      { id: 'static-react', version: 2 }
    ),
    (error: unknown) =>
      error instanceof ProfileError &&
      error.code === 'PROFILE_MISMATCH' &&
      error.statusCode === 409
  );
});
