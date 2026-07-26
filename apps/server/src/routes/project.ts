import { Router } from 'express';
import { z } from 'zod';
import { Project } from '../models/Project';
import { Chat } from '../models/Chat';
import { ProjectSnapshot } from '../models/ProjectSnapshot';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import {
  objectIdParamSchema,
  objectIdStringSchema
} from '../agent/schemas';
import { compilePreviewCss } from '../agent/styling/compilePreviewCss';
import { ensureDefaultWorkspaceForUser } from '../workspaces/defaultWorkspace';
import {
  findOwnedWorkspaceProject,
  workspaceIdsForUser
} from '../workspaces/projectAccess';
import {
  createProjectBranch,
  ensureMainBranch,
  resolveProjectBranch,
  setBranchHead
} from '../branches/branchService';
import { ProjectBranch } from '../models/ProjectBranch';
import { ArtifactManifest } from '../models/ArtifactManifest';
import { getArtifactService } from '../artifacts/runtime';
import type { ProjectArtifactBundleV1 } from '../artifacts/types';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

const requireUserId = (req: AuthRequest): string => {
  if (!req.userId) {
    throw Object.assign(new Error('Missing authenticated user'), { statusCode: 401 });
  }

  return req.userId;
};

const readSnapshotBundle = (
  snapshot: InstanceType<typeof ProjectSnapshot>
) => getArtifactService().readOwnedBundle({
  artifactId: snapshot.artifactId,
  workspaceId: snapshot.workspaceId,
  projectId: snapshot.projectId,
  kind: 'project_snapshot'
});

const snapshotDetail = async (
  snapshot: InstanceType<typeof ProjectSnapshot>,
  loadedBundle?: ProjectArtifactBundleV1
) => {
  const bundle = loadedBundle ?? await readSnapshotBundle(snapshot);
  return {
    ...snapshot.toObject(),
    files: bundle.files,
    packageJson: bundle.packageJson
  };
};

// Get all projects for user
router.get('/', async (req: AuthRequest, res, next) => {
  try {
    const workspaceIds = await workspaceIdsForUser(req.userId!);
    const projects = await Project.find({
      userId: req.userId,
      workspaceId: { $in: workspaceIds }
    })
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
    const project = await findOwnedWorkspaceProject({
      projectId: req.params.id,
      userId: req.userId!
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    await project.populate('chatIds');
    res.json({ project });
  } catch (error) {
    next(error);
  }
});

// List project snapshots
router.get('/:id/snapshots', async (req: AuthRequest, res, next) => {
  try {
    const userId = requireUserId(req);
    const { id } = objectIdParamSchema('id').parse(req.params);
    const project = await findOwnedWorkspaceProject({
      projectId: id,
      userId
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const branch = await resolveProjectBranch({
      project,
      branchId: typeof req.query.branchId === 'string'
        ? req.query.branchId
        : undefined
    });
    if (!branch) {
      res.status(404).json({ error: 'Branch not found' });
      return;
    }

    const snapshots = await ProjectSnapshot.find({
      workspaceId: project.workspaceId,
      projectId: id,
      userId,
      branchId: branch._id
    })
      .sort({ createdAt: -1 })
      .limit(50);
    const manifests = await ArtifactManifest.find({
      artifactId: { $in: snapshots.map(snapshot => snapshot.artifactId) },
      workspaceId: project.workspaceId,
      projectId: project._id,
      kind: 'project_snapshot'
    }).select('artifactId fileCount').lean();
    const fileCountByArtifactId = new Map(
      manifests.map(manifest => [manifest.artifactId, manifest.fileCount])
    );

    res.json({
      snapshots: snapshots.map(snapshot => ({
        id: snapshot._id,
        projectId: snapshot.projectId,
        sourceRunId: snapshot.sourceRunId,
        parentSnapshotId: snapshot.parentSnapshotId,
        summary: snapshot.summary,
        validation: snapshot.validation,
        isActive: branch.headSnapshotId?.toString() === snapshot._id.toString(),
        fileCount: fileCountByArtifactId.get(snapshot.artifactId) ?? 0,
        createdAt: snapshot.createdAt
      }))
    });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/snapshots/:snapshotId/rollback', async (req: AuthRequest, res, next) => {
  try {
    const userId = requireUserId(req);
    const { id, snapshotId } = z.object({
      id: objectIdParamSchema('id').shape.id,
      snapshotId: objectIdParamSchema('snapshotId').shape.snapshotId
    }).parse(req.params);
    const ownedProject = await findOwnedWorkspaceProject({
      projectId: id,
      userId
    });
    if (!ownedProject) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const branchId = typeof req.body?.branchId === 'string'
      ? req.body.branchId
      : undefined;
    const branch = await resolveProjectBranch({
      project: ownedProject,
      branchId
    });
    if (!branch) {
      res.status(404).json({ error: 'Branch not found' });
      return;
    }
    const snapshot = await ProjectSnapshot.findOne({
      _id: snapshotId,
      workspaceId: ownedProject.workspaceId,
      branchId: branch._id,
      projectId: id,
      userId,
      'validation.status': { $ne: 'failed' }
    });

    if (!snapshot) {
      res.status(404).json({ error: 'Snapshot not found' });
      return;
    }
    const bundle = await readSnapshotBundle(snapshot);

    const updatedBranch = await setBranchHead({
      branchId: branch._id,
      expectedHeadVersion: branch.headVersion,
      snapshotId: snapshot._id
    });
    if (!updatedBranch) {
      res.status(409).json({ error: 'Branch head changed; reload and retry' });
      return;
    }
    const project = branch.name === 'main'
      ? await Project.findByIdAndUpdate(
          ownedProject._id,
          {
            $set: { activeSnapshotId: snapshot._id },
            $inc: { activeSnapshotRevision: 1 }
          },
          { new: true }
        )
      : ownedProject;

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    res.json({
      project,
      snapshot: await snapshotDetail(snapshot, bundle)
    });
  } catch (error) {
    next(error);
  }
});

// Get a full project snapshot
router.get('/:id/snapshots/:snapshotId', async (req: AuthRequest, res, next) => {
  try {
    const userId = requireUserId(req);
    const { id, snapshotId } = z.object({
      id: objectIdParamSchema('id').shape.id,
      snapshotId: objectIdParamSchema('snapshotId').shape.snapshotId
    }).parse(req.params);
    const project = await findOwnedWorkspaceProject({
      projectId: id,
      userId
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const snapshot = await ProjectSnapshot.findOne({
      _id: snapshotId,
      workspaceId: project.workspaceId,
      projectId: id,
      userId
    });

    if (!snapshot) {
      res.status(404).json({ error: 'Snapshot not found' });
      return;
    }

    const snapshotData = await snapshotDetail(snapshot);
    const previewCss = await compilePreviewCss(
      snapshotData.files.map(file => ({
        path: file.path,
        content: file.content,
        language: file.language
      }))
    );
    res.json({
      snapshot: {
        ...snapshotData,
        ...(previewCss && { previewCss })
      }
    });
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

    const { workspace } = await ensureDefaultWorkspaceForUser(req.user!._id);
    const project = new Project({
      workspaceId: workspace._id,
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
    await ensureMainBranch(project);

    res.status(201).json({ project });
  } catch (error) {
    next(error);
  }
});

router.get('/:id/branches', async (req: AuthRequest, res, next) => {
  try {
    const project = await findOwnedWorkspaceProject({
      projectId: req.params.id,
      userId: req.userId!
    });
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    await ensureMainBranch(project);
    const branches = await ProjectBranch.find({
      workspaceId: project.workspaceId,
      projectId: project._id
    }).sort({ createdAt: 1 });
    res.json({ branches });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/branches', async (req: AuthRequest, res, next) => {
  try {
    const body = z.object({
      name: z.string().trim().min(1).max(80),
      fromSnapshotId: objectIdStringSchema.optional()
    }).parse(req.body);
    const project = await findOwnedWorkspaceProject({
      projectId: req.params.id,
      userId: req.userId!
    });
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const branch = await createProjectBranch({
      project,
      name: body.name,
      fromSnapshotId: body.fromSnapshotId
    });
    res.status(201).json({ branch });
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

    const ownedProject = await findOwnedWorkspaceProject({
      projectId: req.params.id,
      userId: req.userId!
    });
    if (!ownedProject) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const project = await Project.findByIdAndUpdate(
      ownedProject._id,
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

    const project = await findOwnedWorkspaceProject({
      projectId: req.params.id,
      userId: req.userId!
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
    const branch = chat.branchId
      ? await resolveProjectBranch({ project, branchId: chat.branchId })
      : await ensureMainBranch(project);
    if (!branch) {
      res.status(404).json({ error: 'Branch not found' });
      return;
    }

    // Add chat to project if not already added
    if (!project.chatIds.includes(chat._id)) {
      project.chatIds.push(chat._id);
      chat.projectId = project._id;
      chat.branchId = branch._id;
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
    const project = await findOwnedWorkspaceProject({
      projectId: req.params.id,
      userId: req.userId!
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
      $unset: { projectId: 1, branchId: 1 }
    });

    res.json({ project });
  } catch (error) {
    next(error);
  }
});

// Delete project
router.delete('/:id', async (req: AuthRequest, res, next) => {
  try {
    const ownedProject = await findOwnedWorkspaceProject({
      projectId: req.params.id,
      userId: req.userId!
    });

    if (!ownedProject) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const project = await Project.findByIdAndDelete(ownedProject._id);

    // Remove project reference from all chats
    await Chat.updateMany(
      { projectId: req.params.id },
      { $unset: { projectId: 1, branchId: 1 } }
    );

    res.json({ message: 'Project deleted' });
  } catch (error) {
    next(error);
  }
});

export { router as projectRouter };
