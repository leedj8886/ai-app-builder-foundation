import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AgentRun, type IAgentRun } from '../models/AgentRun';
import { AgentEvent } from '../models/AgentEvent';
import { ProjectSnapshot } from '../models/ProjectSnapshot';
import { Chat } from '../models/Chat';
import { ValidationCandidate } from '../models/ValidationCandidate';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { getAgentConfig } from '../agent/config';
import {
  createAgentRunRequestSchema,
  listAgentRunsQuerySchema,
  objectIdParamSchema
} from '../agent/schemas';
import { emitAgentEvent } from '../agent/eventBus';
import {
  enqueueAgentRun,
  enqueueValidationRetry
} from '../agent/queue';
import { createRedisConnection } from '../agent/redis';
import { isTerminalAgentRunStatus } from '../agent/stateMachine';
import { streamAgentRunEvents } from '../agent/sseStream';
import { findOwnedWorkspaceProject } from '../workspaces/projectAccess';
import { resolveProjectBranch } from '../branches/branchService';

const router = Router();

router.use(authMiddleware);

const requireUserId = (req: AuthRequest): string => {
  if (!req.userId) {
    throw Object.assign(new Error('Missing authenticated user'), { statusCode: 401 });
  }

  return req.userId;
};

const canAccessRunProject = async (
  run: Pick<IAgentRun, 'projectId'>,
  userId: string
): Promise<boolean> => Boolean(await findOwnedWorkspaceProject({
  projectId: run.projectId,
  userId
}));

router.get('/runs', async (req: AuthRequest, res, next) => {
  try {
    const userId = requireUserId(req);
    const { projectId, limit } = listAgentRunsQuerySchema.parse(req.query);
    const project = await findOwnedWorkspaceProject({ projectId, userId });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const runs = await AgentRun.find({ projectId, userId })
      .select('workspaceId projectId branchId prompt status mode baseSnapshotId baseHeadVersion resultSnapshotId attempt maxRepairAttempts error startedAt completedAt createdAt updatedAt')
      .sort({ createdAt: -1 })
      .limit(limit);

    res.json({ runs });
  } catch (error) {
    next(error);
  }
});

router.post('/runs', async (req: AuthRequest, res, next) => {
  try {
    const userId = requireUserId(req);
    const body = createAgentRunRequestSchema.parse(req.body);

    const project = await findOwnedWorkspaceProject({
      projectId: body.projectId,
      userId
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const chat = body.chatId
      ? await Chat.findOne({
        _id: body.chatId,
        userId,
        projectId: body.projectId
      })
      : null;

    if (body.chatId && !chat) {
      res.status(404).json({ error: 'Chat not found' });
      return;
    }
    const branch = await resolveProjectBranch({
      project,
      branchId: chat?.branchId
    });
    if (!branch || (chat?.branchId && !branch._id.equals(chat.branchId))) {
      res.status(404).json({ error: 'Chat branch not found' });
      return;
    }
    const baseSnapshot = branch.headSnapshotId
      ? await ProjectSnapshot.findOne({
          _id: branch.headSnapshotId,
          projectId: project._id,
          userId,
          'validation.status': { $ne: 'failed' }
        })
      : null;

    if (body.mode === 'edit' && !baseSnapshot) {
      res.status(400).json({ error: 'Edit mode requires an existing project snapshot' });
      return;
    }

    const config = getAgentConfig();
    const run = await AgentRun.create({
      userId,
      workspaceId: project.workspaceId,
      projectId: body.projectId,
      branchId: branch._id,
      chatId: body.chatId,
      prompt: body.prompt,
      mode: body.mode,
      baseSnapshotId: baseSnapshot?._id,
      baseSnapshotRevision: branch.headVersion,
      baseHeadVersion: branch.headVersion,
      status: 'queued',
      model: config.model,
      maxRepairAttempts: config.maxRepairAttempts
    });

    if (chat) {
      chat.messages.push({
        id: randomUUID(),
        role: 'user',
        content: body.prompt,
        createdAt: new Date()
      });
      await chat.save();
    }

    await emitAgentEvent({
      runId: run._id,
      userId,
      projectId: body.projectId,
      type: 'run.created',
      message: 'Agent run queued'
    });

    await enqueueAgentRun(run._id.toString());

    res.status(201).json({ run });
  } catch (error) {
    next(error);
  }
});

router.post(
  '/runs/:runId/retry-validation',
  async (req: AuthRequest, res, next) => {
    try {
      const userId = requireUserId(req);
      const { runId } = objectIdParamSchema('runId').parse(req.params);
      const source = await AgentRun.findOne({
        _id: runId,
        userId,
        status: 'failed',
        retryable: true
      });

      if (!source?.validationCandidateId) {
        res.status(409).json({ error: 'Run is not retryable' });
        return;
      }
      if (!await canAccessRunProject(source, userId)) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }
      const candidate = await ValidationCandidate.findOne({
        _id: source.validationCandidateId,
        userId,
        projectId: source.projectId,
        expiresAt: { $gt: new Date() }
      });
      if (!candidate) {
        res.status(409).json({ error: 'Validation candidate has expired' });
        return;
      }
      const existing = await AgentRun.findOne({
        retryOfRunId: source._id,
        userId,
        status: {
          $in: [
            'waiting_for_capacity',
            'queued',
            'running',
            'planning',
            'generating',
            'validating',
            'repairing',
            'persisting'
          ]
        }
      });
      if (existing) {
        res.status(200).json({ run: existing });
        return;
      }

      const run = await AgentRun.create({
        userId,
        workspaceId: source.workspaceId,
        projectId: source.projectId,
        branchId: source.branchId,
        chatId: source.chatId,
        prompt: source.prompt,
        mode: source.mode,
        baseSnapshotId: source.baseSnapshotId,
        baseSnapshotRevision: source.baseSnapshotRevision,
        baseHeadVersion: source.baseHeadVersion,
        retryOfRunId: source._id,
        validationCandidateId: candidate._id,
        status: 'queued',
        model: source.model,
        maxRepairAttempts: source.maxRepairAttempts
      });
      await emitAgentEvent({
        runId: run._id,
        userId,
        projectId: run.projectId.toString(),
        type: 'run.created',
        message: 'Validation retry queued'
      });
      await enqueueValidationRetry(
        run._id.toString(),
        candidate._id.toString()
      );
      res.status(201).json({ run });
    } catch (error) {
      next(error);
    }
  }
);

router.get('/runs/:runId', async (req: AuthRequest, res, next) => {
  try {
    const userId = requireUserId(req);
    const { runId } = objectIdParamSchema('runId').parse(req.params);

    const run = await AgentRun.findOne({ _id: runId, userId });

    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    if (!await canAccessRunProject(run, userId)) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    const events = await AgentEvent.find({ runId, userId })
      .sort({ sequence: 1 })
      .limit(100);

    const resultSnapshot = run.resultSnapshotId
      ? await ProjectSnapshot.findOne({
          _id: run.resultSnapshotId,
          userId,
          projectId: run.projectId
        })
      : null;

    res.json({ run, events, resultSnapshot });
  } catch (error) {
    next(error);
  }
});

router.get('/runs/:runId/events', async (req: AuthRequest, res, next) => {
  try {
    const userId = requireUserId(req);
    const { runId } = objectIdParamSchema('runId').parse(req.params);
    const lastEventId = z.coerce.number().int().nonnegative().optional().parse(
      req.header('Last-Event-ID')
    );

    const run = await AgentRun.findOne({ _id: runId, userId });

    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    if (!await canAccessRunProject(run, userId)) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    await streamAgentRunEvents({
      runId,
      userId,
      lastEventId,
      req,
      res,
      subscriber: createRedisConnection()
    });
  } catch (error) {
    if (res.headersSent) {
      if (!res.writableEnded) res.end();
      return;
    }
    next(error);
  }
});

router.post('/runs/:runId/cancel', async (req: AuthRequest, res, next) => {
  try {
    const userId = requireUserId(req);
    const { runId } = objectIdParamSchema('runId').parse(req.params);
    let run = await AgentRun.findOne({ _id: runId, userId });

    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    if (!await canAccessRunProject(run, userId)) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    if (run.status === 'persisting') {
      res.status(409).json({ error: 'Run is finalizing and can no longer be cancelled' });
      return;
    }

    if (!isTerminalAgentRunStatus(run.status)) {
      const cancelled = await AgentRun.findOneAndUpdate(
        {
          _id: runId,
          userId,
          status: {
            $in: [
              'waiting_for_capacity',
              'queued',
              'running',
              'planning',
              'generating',
              'validating',
              'repairing'
            ]
          }
        },
        {
          $set: {
            status: 'cancelled',
            completedAt: new Date()
          }
        },
        { new: true }
      );

      if (!cancelled) {
        run = await AgentRun.findOne({ _id: runId, userId });
        if (run?.status === 'persisting') {
          res.status(409).json({ error: 'Run is finalizing and can no longer be cancelled' });
          return;
        }
        res.json({ run });
        return;
      }
      run = cancelled;

      await emitAgentEvent({
        runId,
        userId,
        projectId: run.projectId,
        type: 'run.cancelled',
        message: 'Agent run cancelled'
      });
    }

    res.json({ run });
  } catch (error) {
    next(error);
  }
});

export { router as agentRouter };
