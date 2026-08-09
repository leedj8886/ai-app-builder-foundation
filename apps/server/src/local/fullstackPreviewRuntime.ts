import { LocalPersistentDatabase } from './persistentDatabase';
import { LocalFullstackPreviewService } from './fullstackPreview';

export const localPersistentDatabase = new LocalPersistentDatabase();
export const localFullstackPreview = new LocalFullstackPreviewService(
  process.env.LOCAL_FULLSTACK_PREVIEW_ROOT || '/tmp/open-v0-fullstack-previews'
);
