import { BranchExecutionLease } from '../models/BranchExecutionLease';
import { AgentRun } from '../models/AgentRun';

const DEFAULT_TTL_MS = 60_000;
const HEARTBEAT_MS = 15_000;

export interface BranchExecutionGuard {
  assertHeld(): Promise<void>;
  release(): Promise<void>;
}

const isDuplicateKey = (error: unknown): boolean =>
  (error as { code?: number }).code === 11_000;

export const acquireBranchExecution = async (
  runId: string,
  ttlMs = DEFAULT_TTL_MS
): Promise<BranchExecutionGuard | null> => {
  const run = await AgentRun.findById(runId);
  if (!run?.workspaceId || !run.branchId || run.baseHeadVersion === undefined) {
    return null;
  }

  const now = new Date();
  let lease;
  try {
    lease = await BranchExecutionLease.findOneAndUpdate(
      {
        branchId: run.branchId,
        $or: [{ runId: run._id }, { expiresAt: { $lte: now } }]
      },
      {
        $set: {
          workspaceId: run.workspaceId,
          projectId: run.projectId,
          branchId: run.branchId,
          runId: run._id,
          baseHeadVersion: run.baseHeadVersion,
          acquiredAt: now,
          heartbeatAt: now,
          expiresAt: new Date(now.getTime() + ttlMs)
        }
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    if (isDuplicateKey(error)) return null;
    throw error;
  }

  if (!lease.runId.equals(run._id)) return null;

  let lost = false;
  let renewing = false;
  const heartbeat = setInterval(() => {
    if (renewing || lost) return;
    renewing = true;
    const nextNow = new Date();
    void BranchExecutionLease.updateOne(
      { _id: lease._id, runId: run._id },
      {
        $set: {
          heartbeatAt: nextNow,
          expiresAt: new Date(nextNow.getTime() + ttlMs)
        }
      }
    ).then(result => {
      if (result.modifiedCount !== 1) lost = true;
    }).catch(() => {
      lost = true;
    }).finally(() => {
      renewing = false;
    });
  }, Math.min(HEARTBEAT_MS, Math.max(1, Math.floor(ttlMs / 3))));
  heartbeat.unref();

  return {
    assertHeld: async () => {
      if (!lost) {
        const held = await BranchExecutionLease.exists({
          _id: lease._id,
          runId: run._id,
          expiresAt: { $gt: new Date() }
        });
        lost = !held;
      }
      if (lost) {
        throw Object.assign(new Error('Branch execution lease was lost'), {
          code: 'BRANCH_EXECUTION_LOST'
        });
      }
    },
    release: async () => {
      clearInterval(heartbeat);
      await BranchExecutionLease.deleteOne({
        _id: lease._id,
        runId: run._id
      });
    }
  };
};
