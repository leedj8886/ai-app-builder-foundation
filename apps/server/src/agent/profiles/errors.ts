export type ProfileErrorCode =
  | 'PROFILE_INVALID_REF'
  | 'PROFILE_NOT_FOUND'
  | 'PROFILE_DUPLICATE'
  | 'PROFILE_MISMATCH'
  | 'PROFILE_PATH_DENIED'
  | 'PROFILE_PLATFORM_FILE_MODIFIED'
  | 'PROFILE_SCRIPT_MODIFIED'
  | 'PROFILE_UNSUPPORTED_FILE_TYPE';

export class ProfileError extends Error {
  readonly statusCode: number;

  constructor(
    readonly code: ProfileErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'ProfileError';
    this.statusCode = code === 'PROFILE_MISMATCH' ? 409 : 400;
  }
}
