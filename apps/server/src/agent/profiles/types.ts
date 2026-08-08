import type {
  ProjectFile,
  ProjectSnapshotPackageJson,
  ValidationErrorCategory,
  ValidationPhase,
  ValidationStageId
} from '../types';

export interface ProfileRef {
  id: string;
  version: number;
}

export interface ProfilePackageInput {
  base?: ProjectSnapshotPackageJson;
  generated: {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
}

export interface ProfileStructureResult {
  status: 'passed' | 'failed';
  category?: ValidationErrorCategory;
  stdout: string;
  stderr: string;
}

export interface EditablePathPolicy {
  editablePathPatterns: readonly string[];
  platformManagedPathPatterns: readonly string[];
  protectedDeletePaths: readonly string[];
  immutableExistingDirectoryPatterns?: readonly string[];
}

export interface ValidationStageDescriptor {
  id: ValidationStageId;
  phase: ValidationPhase;
}

export interface RuntimeDescriptor {
  kind: 'static-artifact' | 'server';
  buildOutputDirectory: string;
  entryPath: string;
}

export interface GenerationDescriptor {
  capabilities: readonly string[];
  instructions: string;
}

export interface ProjectProfile {
  readonly ref: ProfileRef;
  createTemplate(): ProjectFile[];
  editablePathPolicy(): EditablePathPolicy;
  mergePackageJson(input: ProfilePackageInput): ProjectSnapshotPackageJson;
  generationDescriptor(): GenerationDescriptor;
  validateStructure(files: ProjectFile[]): ProfileStructureResult;
  validationPipeline(): readonly ValidationStageDescriptor[];
  runtimeDescriptor(): RuntimeDescriptor;
}
