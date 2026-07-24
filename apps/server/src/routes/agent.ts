import { Router } from 'express';
import { z } from 'zod';
import { AgentRun } from '../models/AgentRun';
import { AgentEvent } from '../models/AgentEvent';
import { ProjectSnapshot } from '../models/ProjectSnapshot';
import { Chat } from '../models/Chat';
import { Project } from '../models/Project';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { getAgentConfig } from '../agent/config';
import { createAgentRunRequestSchema, objectIdParamSchema } from '../agent/schemas';
import { emitAgentEvent, agentRunChannel } from '../agent/eventBus';
import { enqueueAgentRun } from '../agent/queue';
import { createRedisConnection } from '../agent/redis';
import { isTerminalAgentRunStatus } from '../agent/stateMachine';

const router = Router();

router.use(authMiddleware);

const requireUserId = (req: AuthRequest): string => {
  if (!req.userId) {
    throw Object.assign(new Error('Missing authenticated user'), { statusCode: 401 });
  }

  return req.userId;
};

router.post('/runs', async (req: AuthRequest, res, next) => {
  try {
    const userId = requireUserId(req);
    const body = createAgentRunRequestSchema.parse(req.body);

    const project = await Project.findOne({
      _id: body.projectId,
      userId
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    if (body.chatId) {
      const chat = await Chat.findOne({
        _id: body.chatId,
        userId
      });

      if (!chat) {
        res.status(404).json({ error: 'Chat not found' });
        return;
      }
    }

    const baseSnapshot = await ProjectSnapshot.findOne({
      projectId: body.projectId,
      userId,
      'validation.status': { $ne: 'failed' }
    }).sort({ createdAt: -1 });

    if (body.mode === 'edit' && !baseSnapshot) {
      res.status(400).json({ error: 'Edit mode requires an existing project snapshot' });
      return;
    }

    const config = getAgentConfig();
    const run = await AgentRun.create({
      userId,
      projectId: body.projectId,
      chatId: body.chatId,
      prompt: body.prompt,
      mode: body.mode,
      baseSnapshotId: baseSnapshot?._id,
      status: 'queued',
      model: config.model,
      maxRepairAttempts: config.maxRepairAttempts
    });

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

router.get('/runs/:runId', async (req: AuthRequest, res, next) => {
  try {
    const userId = requireUserId(req);
    const { runId } = objectIdParamSchema('runId').parse(req.params);

    const run = await AgentRun.findOne({ _id: runId, userId });

    if (!run) {
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
  const subscriber = createRedisConnection();

  try {
    const userId = requireUserId(req);
    const { runId } = objectIdParamSchema('runId').parse(req.params);
    const lastEventId = z.coerce.number().int().nonnegative().optional().parse(
      req.header('Last-Event-ID')
    );

    const run = await AgentRun.findOne({ _id: runId, userId });

    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      await subscriber.quit();
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    const writeEvent = (event: { sequence: number; type: string; [key: string]: unknown }) => {
      res.write(`id: ${event.sequence}\n`);
      res.write(`event: ${event.type}\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    const storedEvents = await AgentEvent.find({
      runId,
      userId,
      ...(lastEventId !== undefined && { sequence: { $gt: lastEventId } })
    }).sort({ sequence: 1 });

    for (const event of storedEvents) {
      writeEvent({
        id: event._id.toString(),
        runId: event.runId.toString(),
        sequence: event.sequence,
        type: event.type,
        message: event.message,
        payload: event.payload,
        createdAt: event.createdAt.toISOString()
      });
    }

    await subscriber.subscribe(agentRunChannel(runId));
    subscriber.on('message', (_channel, message) => {
      writeEvent(JSON.parse(message));
    });

    req.on('close', () => {
      void subscriber.quit();
    });
  } catch (error) {
    await subscriber.quit();
    next(error);
  }
});

router.post('/runs/:runId/cancel', async (req: AuthRequest, res, next) => {
  try {
    const userId = requireUserId(req);
    const { runId } = objectIdParamSchema('runId').parse(req.params);
    const run = await AgentRun.findOne({ _id: runId, userId });

    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    if (!isTerminalAgentRunStatus(run.status)) {
      run.status = 'cancelled';
      run.completedAt = new Date();
      await run.save();

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
