export interface ArtifactStore {
  put(input: {
    storageKey: string;
    bytes: Uint8Array;
  }): Promise<void>;
  get(storageKey: string): Promise<Uint8Array>;
  exists(storageKey: string): Promise<boolean>;
  delete(storageKey: string): Promise<void>;
}
