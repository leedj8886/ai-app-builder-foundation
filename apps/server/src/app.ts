import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import { authRouter } from './routes/auth';
import { chatRouter } from './routes/chat';
import { projectRouter } from './routes/project';
import { agentRouter } from './routes/agent';
import { errorHandler } from './middleware/errorHandler';
import { previewRouter } from './routes/preview';
import { getPreviewConfig } from './preview/config';

dotenv.config();

export const createApp = (): express.Express => {
  getPreviewConfig();
  const app = express();

  app.use(helmet());
  app.use(cors({
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    credentials: true
  }));

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Too many requests, please try again later.' }
  });
  app.use(limiter);

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(morgan('dev'));

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/previews', previewRouter);
  app.use('/api/chat', chatRouter);
  app.use('/api/projects', projectRouter);
  app.use('/api/agent', agentRouter);

  app.use(errorHandler);

  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  return app;
};
