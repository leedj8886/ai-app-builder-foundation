import { staticReactProfile } from '../profiles/staticReactProfile';
import type { ProfileStructureResult } from '../profiles/types';
import type { ProjectFile } from '../types';

export type StructureCheckResult = ProfileStructureResult;

export const validateProjectStructure = (
  files: ProjectFile[]
): StructureCheckResult => staticReactProfile.validateStructure(files);
