import mongoose, {
  Schema,
  Types,
  type HydratedDocument
} from 'mongoose';
import type {
  NetworkPolicy,
  ResourceProfile,
  SandboxLeaseState,
  SandboxPurpose
} from '../sandbox/types';
import type { SandboxErrorCode } from '../sandbox/errors';

type ArtifactKind = 'project_snapshot' | 'validation_candidate';

export interface ISandboxLease {
  workspaceId: Types.ObjectId;
  projectId: Types.ObjectId;
  branchId: Types.ObjectId;
  requestedByUserId: Types.ObjectId;
  runId?: Types.ObjectId;
  snapshotId?: Types.ObjectId;
  sourceArtifact: {
    artifactId: string;
    kind: ArtifactKind;
  };
  purpose: SandboxPurpose;
  provider: string;
  provisioningKey: string;
  externalId?: string;
  state: SandboxLeaseState;
  spec: {
    image: string;
    workingDirectory: string;
    networkPolicy: NetworkPolicy;
    leaseSeconds: number;
    autoStopSeconds?: number;
    autoDeleteSeconds: number;
  };
  resourceProfile: ResourceProfile;
  reservedAt: Date;
  readyAt?: Date;
  lastHeartbeatAt?: Date;
  expiresAt: Date;
  terminatedAt?: Date;
  error?: {
    code: SandboxErrorCode;
    message: string;
    retryable: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
}

export type SandboxLeaseDocument = HydratedDocument<ISandboxLease>;
export type SandboxReservationRecord = Pick<
  ISandboxLease,
  | 'workspaceId'
  | 'projectId'
  | 'branchId'
  | 'requestedByUserId'
  | 'runId'
  | 'snapshotId'
  | 'sourceArtifact'
  | 'purpose'
  | 'provider'
  | 'provisioningKey'
  | 'spec'
  | 'resourceProfile'
  | 'reservedAt'
  | 'expiresAt'
>;

const positiveFinite = {
  validator: (value: number) => Number.isFinite(value) && value > 0,
  message: 'must be a positive finite number'
};
const positiveSafeInteger = {
  validator: (value: number) => Number.isSafeInteger(value) && value > 0,
  message: 'must be a positive safe integer'
};

const SandboxLeaseSchema = new Schema<ISandboxLease>(
  {
    workspaceId: {
      type: Schema.Types.ObjectId,
      ref: 'Workspace',
      required: true
    },
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true
    },
    branchId: {
      type: Schema.Types.ObjectId,
      ref: 'ProjectBranch',
      required: true
    },
    requestedByUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    runId: { type: Schema.Types.ObjectId, ref: 'AgentRun' },
    snapshotId: { type: Schema.Types.ObjectId, ref: 'ProjectSnapshot' },
    sourceArtifact: {
      artifactId: { type: String, required: true },
      kind: {
        type: String,
        enum: ['project_snapshot', 'validation_candidate'],
        required: true
      }
    },
    purpose: {
      type: String,
      enum: ['build', 'preview'],
      required: true
    },
    provider: { type: String, required: true },
    provisioningKey: { type: String, required: true },
    externalId: { type: String },
    state: {
      type: String,
      enum: [
        'reserved',
        'provisioning',
        'ready',
        'running',
        'terminating',
        'terminated',
        'failed',
        'lost'
      ],
      required: true,
      default: 'reserved'
    },
    spec: {
      image: { type: String, required: true },
      workingDirectory: { type: String, required: true },
      networkPolicy: {
        defaultAction: {
          type: String,
          enum: ['deny', 'allow'],
          required: true
        },
        allowedDomains: { type: [String], required: true, default: [] },
        allowedCidrs: { type: [String], required: true, default: [] }
      },
      leaseSeconds: {
        type: Number,
        required: true,
        validate: positiveSafeInteger
      },
      autoStopSeconds: { type: Number, validate: positiveSafeInteger },
      autoDeleteSeconds: {
        type: Number,
        required: true,
        validate: positiveSafeInteger
      }
    },
    resourceProfile: {
      cpu: { type: Number, required: true, validate: positiveFinite },
      memoryMiB: {
        type: Number,
        required: true,
        validate: positiveSafeInteger
      },
      diskMiB: {
        type: Number,
        required: true,
        validate: positiveSafeInteger
      }
    },
    reservedAt: { type: Date, required: true },
    readyAt: { type: Date },
    lastHeartbeatAt: { type: Date },
    expiresAt: { type: Date, required: true },
    terminatedAt: { type: Date },
    error: {
      code: { type: String },
      message: { type: String },
      retryable: { type: Boolean }
    }
  },
  { timestamps: true }
);

SandboxLeaseSchema.index({ provisioningKey: 1 }, { unique: true });
SandboxLeaseSchema.index(
  { branchId: 1, purpose: 1 },
  {
    unique: true,
    partialFilterExpression: {
      purpose: 'build',
      state: {
        $in: ['reserved', 'provisioning', 'ready', 'running', 'terminating']
      }
    }
  }
);
SandboxLeaseSchema.index({ workspaceId: 1, purpose: 1, state: 1 });
SandboxLeaseSchema.index({ projectId: 1, purpose: 1, state: 1 });
SandboxLeaseSchema.index({ state: 1, expiresAt: 1 });
SandboxLeaseSchema.index(
  { provider: 1, externalId: 1 },
  {
    unique: true,
    partialFilterExpression: { externalId: { $type: 'string' } }
  }
);

export const SandboxLease =
  (mongoose.models.SandboxLease as
    | mongoose.Model<ISandboxLease>
    | undefined) ||
  mongoose.model<ISandboxLease>('SandboxLease', SandboxLeaseSchema);
