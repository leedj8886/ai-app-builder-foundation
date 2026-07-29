import { Router, type Response } from 'express';
import { Types } from 'mongoose';
import { ProjectSnapshot } from '../models/ProjectSnapshot';
import { getArtifactService } from '../artifacts/runtime';
import { canonicalPreviewPath } from '../artifacts/previewBundle';
import { getPreviewConfig } from '../preview/config';
import { verifyPreviewToken } from '../preview/token';

const router = Router();

const previewHeaders = (
  res: Response,
  contentType: string,
  clientOrigin: string
): void => {
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "base-uri 'none'",
      "object-src 'none'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: http: https:",
      "font-src 'self' data: http: https:",
      "connect-src 'self' http: https: ws: wss:",
      `frame-ancestors ${clientOrigin}`
    ].join('; ')
  );
};

router.get('/:token/*', async (req, res, next) => {
  const config = getPreviewConfig();
  let token;
  try {
    token = verifyPreviewToken(req.params.token, config);
  } catch {
    res.status(401).json({ error: 'Invalid or expired preview token' });
    return;
  }

  try {
    const snapshot = await ProjectSnapshot.findOne({
      _id: token.snapshotId,
      workspaceId: token.workspaceId,
      projectId: token.projectId,
      previewArtifactId: token.artifactId,
      'validation.status': 'passed',
      'validation.verification': 'verified'
    }).select('_id');
    if (!snapshot) {
      res.status(404).json({ error: 'Verified preview not found' });
      return;
    }
    const bundle = await getArtifactService().readOwnedPreviewBundle({
      artifactId: token.artifactId,
      workspaceId: new Types.ObjectId(token.workspaceId),
      projectId: new Types.ObjectId(token.projectId)
    });
    const wildcard = (req.params as Record<string, string | undefined>)['0'];
    let requested: string = bundle.entryPath;
    if (wildcard) {
      try {
        requested = canonicalPreviewPath(wildcard);
      } catch {
        res.status(404).json({ error: 'Preview file not found' });
        return;
      }
    }
    let file = bundle.files.find(candidate => candidate.path === requested);
    if (
      !file &&
      req.accepts('html') &&
      !requested.split('/').at(-1)?.includes('.')
    ) {
      file = bundle.files.find(candidate => candidate.path === bundle.entryPath);
    }
    if (!file) {
      res.status(404).json({ error: 'Preview file not found' });
      return;
    }
    previewHeaders(res, file.contentType, config.clientOrigin);
    res.send(Buffer.from(file.contentBase64, 'base64'));
  } catch (error) {
    next(error);
  }
});

export { router as previewRouter };
