import path from 'node:path';
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile
} from 'node:fs/promises';
import { ProjectFile } from '../types';

interface CreateValidationWorkspaceInput {
  root: string;
  runId: string;
  files: ProjectFile[];
}

export interface ValidationWorkspace {
  path: string;
  cleanup(): Promise<void>;
}

const resolveFilePath = (workspacePath: string, filePath: string): string => {
  const normalized = filePath.replace(/\\/g, '/');
  const target = path.resolve(workspacePath, normalized);
  const prefix = `${path.resolve(workspacePath)}${path.sep}`;

  if (
    path.isAbsolute(normalized) ||
    (!target.startsWith(prefix) && target !== path.resolve(workspacePath))
  ) {
    throw new Error(`Project file path cannot escape the workspace: ${filePath}`);
  }

  return target;
};

export const createValidationWorkspace = async (
  input: CreateValidationWorkspaceInput
): Promise<ValidationWorkspace> => {
  if (!/^[a-zA-Z0-9_-]+$/.test(input.runId)) {
    throw new Error(`Invalid run id: ${input.runId}`);
  }

  const root = path.resolve(input.root);
  await mkdir(root, { recursive: true });
  const workspacePath = await mkdtemp(path.join(root, `${input.runId}-`));
  let cleaned = false;

  try {
    for (const file of input.files) {
      const target = resolveFilePath(workspacePath, file.path);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, file.content, 'utf8');
    }
  } catch (error) {
    await rm(workspacePath, { recursive: true, force: true });
    throw error;
  }

  return {
    path: workspacePath,
    cleanup: async () => {
      if (cleaned) {
        return;
      }

      cleaned = true;
      await rm(workspacePath, { recursive: true, force: true });
    }
  };
};
