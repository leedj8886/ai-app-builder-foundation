import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { Chat } from '../models/Chat';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { generateCode, generateChatTitle } from '../services/aiService';

const router = Router();

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
    const { projectId, initialMessage } = z.object({
      projectId: z.string().optional(),
      initialMessage: z.string().min(1)
    }).parse(req.body);

    // Generate title from first message
    const title = await generateChatTitle(initialMessage);

    const chat = new Chat({
      userId: req.userId,
      projectId,
      title,
      messages: [{
        id: uuidv4(),
        role: 'user',
        content: initialMessage,
        createdAt: new Date()
      }]
    });

    await chat.save();

    // Generate AI response
    const { content, codeBlocks } = await generateCode(chat.messages);

    chat.messages.push({
      id: uuidv4(),
      role: 'assistant',
      content,
      codeBlocks,
      createdAt: new Date()
    });

    await chat.save();

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

    // Generate AI response
    const { content: aiContent, codeBlocks } = await generateCode(chat.messages);

    chat.messages.push({
      id: uuidv4(),
      role: 'assistant',
      content: aiContent,
      codeBlocks,
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
