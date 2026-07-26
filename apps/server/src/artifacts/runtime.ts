import { ArtifactService } from './artifactService';
import { getArtifactConfig } from './config';
import { SharedFilesystemArtifactStore } from './SharedFilesystemArtifactStore';

let service: ArtifactService | undefined;

export const getArtifactService = (): ArtifactService => {
  if (!service) {
    const config = getArtifactConfig();
    service = new ArtifactService(
      new SharedFilesystemArtifactStore(config.root),
      config
    );
  }
  return service;
};

export const resetArtifactRuntimeForTests = (): void => {
  service = undefined;
};
