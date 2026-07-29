import mongoose, { Schema, Types } from 'mongoose';

export type ArtifactKind =
  | 'project_snapshot'
  | 'validation_candidate'
  | 'preview_build';
export type ArtifactManifestState =
  | 'writing'
  | 'ready'
  | 'corrupt'
  | 'delete_pending';

export interface IArtifactManifest {
  artifactId: string;
  workspaceId: Types.ObjectId;
  projectId: Types.ObjectId;
  createdByRunId: Types.ObjectId;
  kind: ArtifactKind;
  idempotencyKey: string;
  format: 'open-v0.bundle+json+gzip';
  formatVersion: 1;
  storageKey: string;
  sha256: string;
  uncompressedBytes: number;
  compressedBytes: number;
  fileCount: number;
  state: ArtifactManifestState;
  errorCode?: string;
  createdAt: Date;
  updatedAt: Date;
}

const storageKeyPattern =
  /^v1\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{32}\.json\.gz$/;
const nonnegativeInteger = {
  validator: (value: number) => Number.isSafeInteger(value) && value >= 0,
  message: 'Artifact count and byte fields must be nonnegative safe integers'
};

const ArtifactManifestSchema = new Schema<IArtifactManifest>(
  {
    artifactId: { type: String, required: true },
    workspaceId: {
      type: Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true
    },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    createdByRunId: {
      type: Schema.Types.ObjectId,
      ref: 'AgentRun',
      required: true
    },
    kind: {
      type: String,
      enum: ['project_snapshot', 'validation_candidate', 'preview_build'],
      required: true
    },
    idempotencyKey: { type: String, required: true },
    format: {
      type: String,
      enum: ['open-v0.bundle+json+gzip'],
      required: true
    },
    formatVersion: { type: Number, enum: [1], required: true },
    storageKey: {
      type: String,
      required: true,
      match: storageKeyPattern
    },
    sha256: {
      type: String,
      required: true,
      match: /^[0-9a-f]{64}$/
    },
    uncompressedBytes: {
      type: Number,
      required: true,
      validate: nonnegativeInteger
    },
    compressedBytes: {
      type: Number,
      required: true,
      validate: nonnegativeInteger
    },
    fileCount: {
      type: Number,
      required: true,
      validate: nonnegativeInteger
    },
    state: {
      type: String,
      enum: ['writing', 'ready', 'corrupt', 'delete_pending'],
      required: true
    },
    errorCode: String
  },
  { timestamps: true }
);

ArtifactManifestSchema.index({ artifactId: 1 }, { unique: true });
ArtifactManifestSchema.index({ idempotencyKey: 1 }, { unique: true });
ArtifactManifestSchema.index({ workspaceId: 1, projectId: 1, createdAt: -1 });
ArtifactManifestSchema.index({ state: 1, updatedAt: 1 });
ArtifactManifestSchema.index({ createdByRunId: 1, kind: 1 });

export const ArtifactManifest =
  (mongoose.models.ArtifactManifest as
    | mongoose.Model<IArtifactManifest>
    | undefined) ||
  mongoose.model<IArtifactManifest>(
    'ArtifactManifest',
    ArtifactManifestSchema
  );
