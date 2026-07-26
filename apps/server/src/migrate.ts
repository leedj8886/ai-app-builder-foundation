import dotenv from 'dotenv';
import {
  migrateWorkspaceBranches,
  verifyWorkspaceBranchMigration
} from './migrations/20260726WorkspaceBranches';
import { connectDB, disconnectDB } from './utils/db';

dotenv.config();

const main = async (): Promise<void> => {
  await connectDB();
  try {
    await migrateWorkspaceBranches();
    await verifyWorkspaceBranchMigration();
    console.log('Workspace/Branch migration completed');
  } finally {
    await disconnectDB();
  }
};

void main().catch(error => {
  console.error('Workspace/Branch migration failed', error);
  process.exitCode = 1;
});
