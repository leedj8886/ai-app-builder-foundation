import { Router } from 'express';
import { z } from 'zod';
import { Project } from '../models/Project';
import { Chat } from '../models/Chat';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// Get all projects for user
router.get('/', async (req: AuthRequest, res, next) => {
  try {
    const projects = await Project.find({ userId: req.userId })
      .sort({ updatedAt: -1 })
      .populate('chatIds', 'title updatedAt');

    res.json({ projects });
  } catch (error) {
    next(error);
  }
});

// Get single project
router.get('/:id', async (req: AuthRequest, res, next) => {
  try {
    const project = await Project.findOne({
      _id: req.params.id,
      userId: req.userId
    }).populate('chatIds');

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    res.json({ project });
  } catch (error) {
    next(error);
  }
});

// Create new project
router.post('/', async (req: AuthRequest, res, next) => {
  try {
    const { name, description, settings } = z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      settings: z.object({
        framework: z.enum(['react', 'vue', 'svelte']).optional(),
        styling: z.enum(['tailwind', 'css-modules', 'styled-components']).optional(),
        uiLibrary: z.enum(['shadcn', 'mui', 'antd', 'none']).optional()
      }).optional()
    }).parse(req.body);

    const project = new Project({
      userId: req.userId,
      name,
      description,
      settings: {
        framework: settings?.framework || 'react',
        styling: settings?.styling || 'tailwind',
        uiLibrary: settings?.uiLibrary || 'shadcn'
      },
      chatIds: []
    });

    await project.save();

    res.status(201).json({ project });
  } catch (error) {
    next(error);
  }
});

// Update project
router.patch('/:id', async (req: AuthRequest, res, next) => {
  try {
    const { name, description, settings } = z.object({
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      settings: z.object({
        framework: z.enum(['react', 'vue', 'svelte']).optional(),
        styling: z.enum(['tailwind', 'css-modules', 'styled-components']).optional(),
        uiLibrary: z.enum(['shadcn', 'mui', 'antd', 'none']).optional()
      }).optional()
    }).parse(req.body);

    const project = await Project.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(settings && { settings })
      },
      { new: true }
    );

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    res.json({ project });
  } catch (error) {
    next(error);
  }
});

// Add chat to project
router.post('/:id/chats', async (req: AuthRequest, res, next) => {
  try {
    const { chatId } = z.object({
      chatId: z.string()
    }).parse(req.body);

    const project = await Project.findOne({
      _id: req.params.id,
      userId: req.userId
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Verify chat exists and belongs to user
    const chat = await Chat.findOne({
      _id: chatId,
      userId: req.userId
    });

    if (!chat) {
      res.status(404).json({ error: 'Chat not found' });
      return;
    }

    // Add chat to project if not already added
    if (!project.chatIds.includes(chat._id)) {
      project.chatIds.push(chat._id);
      chat.projectId = project._id;
      await Promise.all([project.save(), chat.save()]);
    }

    res.json({ project });
  } catch (error) {
    next(error);
  }
});

// Remove chat from project
router.delete('/:id/chats/:chatId', async (req: AuthRequest, res, next) => {
  try {
    const project = await Project.findOne({
      _id: req.params.id,
      userId: req.userId
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    project.chatIds = project.chatIds.filter(
      id => id.toString() !== req.params.chatId
    );
    await project.save();

    // Remove project reference from chat
    await Chat.findByIdAndUpdate(req.params.chatId, {
      $unset: { projectId: 1 }
    });

    res.json({ project });
  } catch (error) {
    next(error);
  }
});

// Delete project
router.delete('/:id', async (req: AuthRequest, res, next) => {
  try {
    const project = await Project.findOneAndDelete({
      _id: req.params.id,
      userId: req.userId
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Remove project reference from all chats
    await Chat.updateMany(
      { projectId: req.params.id },
      { $unset: { projectId: 1 } }
    );

    res.json({ message: 'Project deleted' });
  } catch (error) {
    next(error);
  }
});

export { router as projectRouter };
