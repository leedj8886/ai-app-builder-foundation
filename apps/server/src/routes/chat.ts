import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import {
  buildChatTimelineTurn,
  decodeTimelineCursor,
  encodeTimelineCursor
} from '../agent/chatTimeline';
import { Chat } from '../models/Chat';
import { AgentEvent } from '../models/AgentEvent';
import { AgentRun } from '../models/AgentRun';
import { Project } from '../models/Project';
import { ProjectSnapshot } from '../models/ProjectSnapshot';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { objectIdStringSchema } from '../agent/schemas';

const router = Router();

const toChatTitle = (titleSeed: string): string => {
  const normalized = titleSeed.trim().replace(/\s+/g, ' ');
  return normalized.length <= 60
    ? normalized
    : `${normalized.slice(0, 57)}...`;
};

const timelineQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  before: z.string().trim().min(1).optional()
});

// All routes require authentication
router.use(authMiddleware);

// Get all chats for user
router.get('/', async (req: AuthRequest, res, next) => {
  try {
    const chats = await Chat.find({ userId: req.userId })
      .sort({ updatedAt: -1 })
      .select('_id title projectId createdAt updatedAt');

    res.json({ chats });
  } catch (error) {
    next(error);
  }
});

router.get('/:id/timeline', async (req: AuthRequest, res, next) => {
  try {
    const { limit, before } = timelineQuerySchema.parse(req.query);
    const chat = await Chat.findOne({
      _id: req.params.id,
      userId: req.userId
    }).select('_id title projectId');

    if (!chat) {
      res.status(404).json({ error: 'Chat not found' });
      return;
    }

    let boundary: ReturnType<typeof decodeTimelineCursor> | undefined;
    try {
      boundary = before ? decodeTimelineCursor(before) : undefined;
    } catch {
      res.status(400).json({ error: 'Invalid timeline cursor' });
      return;
    }

    const runs = await AgentRun.find({
      userId: req.userId,
      chatId: chat._id,
      ...(boundary ? {
        $or: [
          { createdAt: { $lt: boundary.createdAt } },
          {
            createdAt: boundary.createdAt,
            _id: { $lt: new Types.ObjectId(boundary.id) }
          }
        ]
      } : {})
    })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean();
    const hasMore = runs.length > limit;
    const selectedRuns = hasMore ? runs.slice(0, limit) : runs;
    const runIds = selectedRuns.map(run => run._id);
    const snapshotIds = selectedRuns.flatMap(
      run => run.resultSnapshotId ? [run.resultSnapshotId] : []
    );
    const [events, snapshots] = await Promise.all([
      AgentEvent.find({
        userId: req.userId,
        runId: { $in: runIds }
      }).sort({ runId: 1, sequence: 1 }).lean(),
      snapshotIds.length === 0
        ? Promise.resolve([])
        : ProjectSnapshot.find({
            userId: req.userId,
            projectId: chat.projectId,
            _id: { $in: snapshotIds }
          }).select('_id sourceRunId summary').lean()
    ]);
    const eventsByRunId = new Map<string, typeof events>();
    for (const event of events) {
      const runId = event.runId.toString();
      const grouped = eventsByRunId.get(runId) ?? [];
      grouped.push(event);
      eventsByRunId.set(runId, grouped);
    }
    const snapshotsByRunId = new Map(
      snapshots.map(snapshot => [snapshot.sourceRunId.toString(), snapshot])
    );
    const turns = selectedRuns.map(run =>
      buildChatTimelineTurn({
        run,
        events: eventsByRunId.get(run._id.toString()) ?? [],
        snapshot: snapshotsByRunId.get(run._id.toString()) ?? null
      })
    ).reverse();
    const oldestRun = selectedRuns.at(-1);

    res.json({
      chat: {
        id: chat._id,
        title: chat.title,
        projectId: chat.projectId
      },
      turns,
      pageInfo: {
        hasMore,
        ...(hasMore && oldestRun ? {
          nextBefore: encodeTimelineCursor({
            createdAt: oldestRun.createdAt,
            id: oldestRun._id.toString()
          })
        } : {})
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get single chat
router.get('/:id', async (req: AuthRequest, res, next) => {
  try {
    const chat = await Chat.findOne({
      _id: req.params.id,
      userId: req.userId
    });

    if (!chat) {
      res.status(404).json({ error: 'Chat not found' });
      return;
    }

    res.json({ chat });
  } catch (error) {
    next(error);
  }
});

// Create new chat
router.post('/', async (req: AuthRequest, res, next) => {
  try {
    const { projectId, titleSeed } = z.object({
      projectId: objectIdStringSchema,
      titleSeed: z.string().trim().min(1)
    }).parse(req.body);

    const project = await Project.findOne({
      _id: projectId,
      userId: req.userId
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const chat = await Chat.create({
      userId: req.userId,
      projectId,
      title: toChatTitle(titleSeed),
      messages: []
    });

    await Project.updateOne(
      { _id: projectId, userId: req.userId },
      { $addToSet: { chatIds: chat._id } }
    );

    res.status(201).json({ chat });
  } catch (error) {
    next(error);
  }
});

// Send message
router.post('/:id/messages', async (req: AuthRequest, res, next) => {
  try {
    const { content } = z.object({
      content: z.string().min(1)
    }).parse(req.body);

    const chat = await Chat.findOne({
      _id: req.params.id,
      userId: req.userId
    });

    if (!chat) {
      res.status(404).json({ error: 'Chat not found' });
      return;
    }

    // Add user message
    chat.messages.push({
      id: uuidv4(),
      role: 'user',
      content,
      createdAt: new Date()
    });

    await chat.save();

    res.json({ chat });
  } catch (error) {
    next(error);
  }
});

// Update chat title
router.patch('/:id', async (req: AuthRequest, res, next) => {
  try {
    const { title } = z.object({
      title: z.string().min(1)
    }).parse(req.body);

    const chat = await Chat.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      { title },
      { new: true }
    );

    if (!chat) {
      res.status(404).json({ error: 'Chat not found' });
      return;
    }

    res.json({ chat });
  } catch (error) {
    next(error);
  }
});

// Delete chat
router.delete('/:id', async (req: AuthRequest, res, next) => {
  try {
    const chat = await Chat.findOneAndDelete({
      _id: req.params.id,
      userId: req.userId
    });

    if (!chat) {
      res.status(404).json({ error: 'Chat not found' });
      return;
    }

    res.json({ message: 'Chat deleted' });
  } catch (error) {
    next(error);
  }
});

export { router as chatRouter };
