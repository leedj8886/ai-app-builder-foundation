# Sandbox Core 设计

**日期：** 2026-07-26

**状态：** 已批准

**上层设计：** `2026-07-26-daytona-sandbox-provider-design.md`

## 1. 背景

项目已经完成 Workspace、ProjectBranch、Branch Head CAS、Candidate/Snapshot
ArtifactStore 和 Artifact Reconciler。源码 Bundle 已经成为不依赖运行中
Sandbox 的永久逻辑版本，但当前项目校验仍在 Agent Worker 宿主机的本地临时目录
执行。

Sandbox Core 是 Daytona Build 之前的独立阶段。它先验证 Provider 边界、
SandboxLease 状态机、分层配额、生命周期恢复和安全命令模型，不在本阶段把
Local Provider 接入生产 Worker。

## 2. 目标

- 定义不依赖 Daytona SDK、Express 和 BullMQ 的 `SandboxProvider` 协议。
- 提供 Fake Provider 和仅限开发/测试的 Build-only LocalProcessProvider。
- 引入 SandboxLease、SandboxRepository、QuotaScheduler 和 SandboxService。
- 落实 Branch、Project、Workspace 三层 Sandbox 数量和资源配额。
- Redis 不可用时对新预留 fail closed，MongoDB 继续作为 Lease 持久化事实。
- 从 Candidate 或 Snapshot Artifact 恢复 Sandbox 文件。
- 让 Artifact Reconciler 将非 terminated SandboxLease 的 sourceArtifact 视为引用。
- 使用固定命令而不是任意 shell 字符串执行 Build 操作。
- 提供单次 SandboxReconciler 和完整故障注入测试。
- 为自托管 DaytonaProvider 和后续 PreviewDeployment 保留稳定扩展边界。

## 3. 非目标

本阶段不实现：

- DaytonaProvider 或任何 Daytona SDK 依赖。
- 将现有 Agent Worker 校验链路切换到 SandboxService。
- PreviewDeployment、PreviewBinding、PreviewSession 或 Preview Gateway。
- Preview 端口代理、同根域路由和 LRU 回收。
- SecretBroker、生产 Secret 注入或用户自定义环境变量。
- 多 Provider 自动选择、跨 Provider 迁移或成本优化。
- 面向用户的 Sandbox HTTP API。
- Sandbox 日志 Artifact、Archive 上传或 Daytona Snapshot 缓存。
- 将 SandboxService 拆分为独立微服务。

## 4. 架构与依赖方向

新增 `apps/server/src/sandbox/`，业务依赖只能由上向下：

```text
未来 Agent / Preview
        |
        v
  SandboxService
   |     |      |
   v     v      v
Policy Scheduler ArtifactService
          |
          v
 SandboxRepository
          |
          v
    SandboxLease

SandboxService / SandboxReconciler
          |
          v
   SandboxProvider
      /        \
    Fake       Local
```

### 4.1 模块职责

`provider/`
: 定义 Provider 控制面、Handle、文件、进程、生命周期、检查结果和 Capability。

`providers/FakeSandboxProvider`
: 内存可编排 Provider，用于成功、超时、丢失、重复资源和部分失败测试。

`providers/LocalProcessProvider`
: 使用本地临时目录和受控子进程实现 Build-only Provider，仅供开发和合同测试。

`SandboxService`
: 唯一应用层入口，负责 Policy/Capability 预检、配额预留、Provider 生命周期、
Artifact 恢复和安全命令执行。

`QuotaScheduler`
: 在 Workspace Redis 短锁内检查三层配额，并创建持久化 `reserved` Lease。

`SandboxRepository`
: 封装 Lease 查询和 CAS；Service、Scheduler 和 Reconciler 不直接散写状态条件。

`SandboxPolicy`
: 定义允许的 Provider、镜像、固定命令、资源范围、超时、日志上限和必要能力。

`SandboxReconciler`
: 修复 Lease 与 Provider 资源之间的不一致，不包含定时器。

## 5. SandboxProvider 协议

### 5.1 控制面

```ts
interface SandboxProvider {
  readonly kind: string

  describe(): Promise<SandboxProviderDescriptor>
  create(spec: SandboxSpec): Promise<SandboxRef>
  connect(ref: SandboxRef): Promise<SandboxHandle>
  inspect(ref: SandboxRef): Promise<SandboxInspection>
  list(filter: SandboxListFilter): Promise<SandboxRef[]>
  destroy(
    ref: SandboxRef,
    options?: { wait?: boolean }
  ): Promise<SandboxDestroyReceipt>
}
```

`create()` 必须以 `provisioningKey` 幂等。同一 Provider 中相同 key 和相同 Spec
返回同一资源；相同 key 但不同 ownership、runtime、resources 或 network policy
返回 `SANDBOX_OWNERSHIP_MISMATCH`，不能创建第二个资源。

```ts
interface SandboxRef {
  provider: string
  externalId: string
}

interface SandboxProviderDescriptor {
  protocolVersion: 'sandbox-provider/v1'
  kind: string
  capabilities: {
    files: true
    processes: true
    lifecycle: true
    preview: boolean
    networkPolicy: boolean
    checkpoints: boolean
    reconnectAcrossProcessRestart: boolean
  }
}
```

MongoDB 不保存 Provider SDK 对象、Token、管理 URL、Preview Endpoint 或完整响应。

### 5.2 SandboxSpec

```ts
interface SandboxSpec {
  provisioningKey: string
  ownership: {
    workspaceId: string
    projectId: string
    branchId: string
    runId?: string
    snapshotId?: string
    purpose: 'build' | 'preview'
  }
  runtime: {
    image: string
    workingDirectory: string
  }
  resources: {
    cpu: number
    memoryMiB: number
    diskMiB: number
  }
  networkPolicy: {
    defaultAction: 'deny' | 'allow'
    allowedDomains: string[]
    allowedCidrs: string[]
  }
  lifecycle: {
    leaseSeconds: number
    autoStopSeconds?: number
    autoDeleteSeconds: number
  }
  labels: Record<string, string>
}
```

`provisioningKey` 格式：

```text
sandbox:<runId-or-snapshotId>:<build-or-preview>:<attempt>
```

必需标签：

```text
managed-by=open-v0
workspace-id=<workspaceId>
project-id=<projectId>
branch-id=<branchId>
run-id=<runId>
snapshot-id=<snapshotId>
purpose=<build|preview>
provisioning-key=<key>
```

### 5.3 Handle

```ts
interface SandboxHandle {
  readonly ref: SandboxRef
  waitUntilReady(input: { timeoutMs: number }): Promise<void>
  files: SandboxFileSystem
  processes: SandboxProcesses
  lifecycle: SandboxLifecycle
  preview?: SandboxPreview
  network?: SandboxNetworkControl
  checkpoints?: SandboxCheckpoints
}
```

文件接口首版只需要：

```ts
interface SandboxFileSystem {
  writeFiles(files: Array<{
    path: string
    content: Uint8Array
  }>): Promise<void>
  readFile(path: string): Promise<Uint8Array>
  exists(path: string): Promise<boolean>
}
```

进程接口始终使用结构化参数：

```ts
interface SandboxCommand {
  executable: string
  args: string[]
  cwd: string
  env: Record<string, string>
  timeoutMs: number
  maxOutputBytes: number
}

interface SandboxCommandResult {
  exitCode: number | null
  stdout: string
  stderr: string
  durationMs: number
  timedOut: boolean
  outputTruncated: boolean
}
```

Provider 不接受 shell 字符串。SandboxService 不把模型输出直接映射为 executable、
args、cwd 或 env。

## 6. Fake 与 Local Provider

### 6.1 FakeSandboxProvider

Fake Provider 使用注入的内存状态和确定性时钟，支持：

- create/connect/inspect/list/destroy 的正常路径。
- 按 provisioningKey 幂等创建。
- create 成功后向调用方抛错。
- readiness 超时。
- inspect 返回 missing/lost。
- destroy 暂时失败或最终一致。
- 同一 provisioningKey 出现重复资源，用于 Reconciler 测试。
- 可配置 Capability。

Fake Provider 不访问本地文件系统和网络。

### 6.2 LocalProcessProvider

Local Provider：

- 每个 Sandbox 使用独立 `mkdtemp` 目录。
- 根目录由 Provider 创建和持有，调用方不能指定宿主机绝对路径。
- 文件路径使用 Artifact Bundle 相同的安全相对路径语义。
- 拒绝绝对路径、盘符、NUL、`.`、`..`、symlink 和非普通文件。
- 子进程使用 `spawn(executable, args, { shell: false })`。
- 支持 AbortSignal、timeout、进程树终止以及 stdout/stderr 独立上限。
- destroy 终止所有子进程后删除工作目录。
- `purpose=preview`、`defaultAction=deny` 或非空网络 allowlist 一律
  `SANDBOX_CAPABILITY_MISSING`。Local 只接受明确的
  `defaultAction=allow + 空 allowlist` 开发策略，表示不承诺网络隔离。

Descriptor：

```ts
{
  files: true,
  processes: true,
  lifecycle: true,
  preview: false,
  networkPolicy: false,
  checkpoints: false,
  reconnectAcrossProcessRestart: false
}
```

生产配置不允许选择 Local Provider。Local Provider 不能被描述为安全的生产隔离。

## 7. SandboxLease

```ts
type SandboxPurpose = 'build' | 'preview'

type SandboxLeaseState =
  | 'reserved'
  | 'provisioning'
  | 'ready'
  | 'running'
  | 'terminating'
  | 'terminated'
  | 'failed'
  | 'lost'

interface SandboxLease {
  workspaceId: ObjectId
  projectId: ObjectId
  branchId: ObjectId
  requestedByUserId: ObjectId
  runId?: ObjectId
  snapshotId?: ObjectId

  sourceArtifact: {
    artifactId: string
    kind: 'project_snapshot' | 'validation_candidate'
  }

  purpose: SandboxPurpose
  provider: string
  provisioningKey: string
  externalId?: string

  state: SandboxLeaseState
  spec: {
    image: string
    workingDirectory: string
    networkPolicy: {
      defaultAction: 'deny' | 'allow'
      allowedDomains: string[]
      allowedCidrs: string[]
    }
    leaseSeconds: number
    autoStopSeconds?: number
    autoDeleteSeconds: number
  }
  resourceProfile: {
    cpu: number
    memoryMiB: number
    diskMiB: number
  }

  reservedAt: Date
  readyAt?: Date
  lastHeartbeatAt?: Date
  expiresAt: Date
  terminatedAt?: Date

  error?: {
    code: SandboxErrorCode
    message: string
    retryable: boolean
  }

  createdAt: Date
  updatedAt: Date
}
```

### 7.1 索引

- `{ provisioningKey: 1 }` 唯一。
- `{ branchId: 1, purpose: 1 }` 部分唯一，仅匹配 `purpose=build` 且状态为
  `reserved/provisioning/ready/running/terminating`。
- `{ workspaceId: 1, purpose: 1, state: 1 }`。
- `{ projectId: 1, purpose: 1, state: 1 }`。
- `{ state: 1, expiresAt: 1 }`。
- `{ provider: 1, externalId: 1 }` 部分唯一，仅匹配存在 externalId 的记录。

Lease 不使用 TTL 删除，终态记录用于审计。

### 7.2 状态转换

正常路径：

```text
reserved → provisioning → ready → running → terminating → terminated
```

异常路径：

```text
reserved/provisioning → failed
ready/running         → lost
failed/lost           → terminating → terminated
```

只有以下状态占用配额：

```text
reserved
provisioning
ready
running
terminating
```

发送 destroy 后必须保持 `terminating`；只有 inspect 确认资源不存在后才能进入
`terminated` 并释放配额。

## 8. Project 与 Workspace 配额

Project 增加：

```ts
interface ProjectSandboxLimits {
  maxConcurrentBuilds: number
  maxRunningPreviews: number
}
```

默认值：

```ts
{
  maxConcurrentBuilds: 2,
  maxRunningPreviews: 3
}
```

Workspace 继续使用现有 `executionLimits`：

- `maxConcurrentBuilds`
- `maxRunningPreviews`
- `maxCpu`
- `maxMemoryMiB`
- `maxDiskMiB`
- `maxBuildsPerHour`
- `maxBuildMinutesPerDay`
- `maxArtifactBytes`
- `maxLogBytesPerCommand`
- `maxFilesPerSnapshot`

Phase 2 调度数量和当前占用资源。小时/每日 Build 消耗只定义 Repository 查询边界，
实际用量计费和精确分钟统计留到生产加固阶段；不能把未实现的历史计量伪装成已执行
配额。

## 9. Redis 调度锁

所有新容量预留通过 Workspace 短锁：

```text
sandbox-quota:<workspaceId>
```

锁协议：

1. 使用随机 token 执行 `SET key token NX PX <ttl>`。
2. 在有限等待时间内使用带抖动的短退避。
3. 持锁期间每 `ttl/3` 使用 compare-and-`PEXPIRE` Lua 续期；续期失败将锁标为
   lost。
4. 创建 Lease 前必须再次 `assertHeld()`；锁已丢失时不执行 Mongo insert。
5. 获取失败返回 `SANDBOX_SCHEDULER_UNAVAILABLE`，不绕过锁。
6. 释放使用 compare-and-delete Lua，只删除自己的 token。
7. 锁内只执行 Mongo 查询和 `reserved` Lease 创建。
8. Provider create、Artifact 读取和文件上传不得在锁内执行。

Redis 不可用时拒绝新预留。已有 Lease 的 inspect、terminate 和 Reconciler 以
MongoDB 为事实来源，不依赖调度锁。

## 10. QuotaScheduler

```ts
interface SandboxReservationRequest {
  workspaceId: ObjectId
  projectId: ObjectId
  branchId: ObjectId
  requestedByUserId: ObjectId
  runId?: ObjectId
  snapshotId?: ObjectId
  sourceArtifact: {
    artifactId: string
    kind: 'project_snapshot' | 'validation_candidate'
  }
  purpose: 'build' | 'preview'
  provider: string
  provisioningKey: string
  spec: SandboxLease['spec']
  resourceProfile: ResourceProfile
  expiresAt: Date
}
```

`reserve()` 在锁内：

1. 查询 Workspace、Project 和 Branch。
2. 使用 `requestedByUserId` 验证三者 active、归属一致且 Project owner 访问规则不被
   绕过。
3. Build 要求 runId，sourceArtifact 可为 Candidate 或 Snapshot；Preview 要求
   snapshotId，sourceArtifact 必须为 Project Snapshot。
4. 检查同 provisioningKey；完全一致时返回已有 Lease，参数不同时报 ownership
   mismatch。
5. 对 Build 检查 Branch 是否已有占用 Lease。
6. 聚合 Project 中同 purpose 的占用 Lease数量。
7. 聚合 Workspace 中同 purpose 的数量以及所有占用 Lease 的 CPU/内存/磁盘。
8. 校验 Project 和 Workspace 上限。
9. 创建 `reserved` Lease。

Scheduler 同时支持 Build 和 Preview 预留，但 Phase 2 不创建 Preview 资源、不实现
PreviewDeployment 或 LRU。Preview 的 Branch Current Binding 不变量在 Phase 4
通过 PreviewBinding 落实。

## 11. SandboxPolicy

Policy 是纯配置和验证模块，不访问 Provider 或 MongoDB。

首版配置：

```ts
interface SandboxPolicyConfig {
  allowedProviders: string[]
  allowedBuildImages: string[]
  minCpu: number
  maxCpu: number
  minMemoryMiB: number
  maxMemoryMiB: number
  minDiskMiB: number
  maxDiskMiB: number
  readinessTimeoutMs: number
  commandTimeouts: {
    install: number
    typeCheck: number
    build: number
  }
}
```

固定命令映射：

```ts
install:
  executable: npm
  args: [ci] 或 [install]

typeCheck:
  executable: npm
  args: [run, type-check]

build:
  executable: npm
  args: [run, build]
```

是否使用 `ci` 由 Bundle 中是否存在 lockfile 决定。调用方只能传命令枚举，不能
覆盖 executable、args、cwd、env 和 timeout。日志上限取 Workspace
`maxLogBytesPerCommand` 与平台硬上限中的较小值。

## 12. SandboxService

### 12.1 创建 Build Sandbox

```text
验证 ownership、Artifact kind 和 SandboxPolicy
  → ArtifactService.readOwnedBundle()
  → Provider.describe() Capability 预检
  → QuotaScheduler.reserve()
  → CAS reserved → provisioning
  → Provider.create()
  → CAS 写入 externalId
  → Provider.connect()
  → waitUntilReady()
  → 批量写入 Bundle 文件和 package.json
  → CAS provisioning → ready
```

Artifact 读取和 Capability 预检在 reserve 前完成，避免明显不可执行请求占用配额。
Provider create 保持在 Redis 锁外。

`package.json` 由规范化 Bundle 生成；Provider 不读取 MongoDB。
Lease 保存重建所需的非敏感规范化 Spec 和 sourceArtifact 引用，使 Reconciler
不依赖原始请求或 Worker 内存。Lease 不保存 Bundle 内容、Secret 或 Provider
管理凭证。

Artifact Reconciler 的引用检查同步扩展到 SandboxLease：

```text
state != terminated
and sourceArtifact.artifactId == manifest.artifactId
```

因此 Candidate TTL 删除后，只要 Sandbox 仍可能恢复或清理，其 sourceArtifact
不会被 Artifact GC 回收。Lease 进入 terminated 后，Artifact 是否保留重新由
Snapshot/Candidate 引用和 retention 规则决定。

### 12.2 安全命令

```ts
runBuildCommand(
  leaseId: ObjectId,
  command: 'install' | 'type-check' | 'build'
): Promise<SandboxCommandResult>
```

执行前要求：

- Lease purpose 为 build。
- Lease state 为 ready 或 running。
- ownership 与调用上下文完全一致。
- Provider ref 与 Lease provider/externalId 一致。
- Capability 仍满足 Policy。

首次命令 CAS `ready → running`。命令失败不自动终止 Lease；调用方可以读取结构化
结果并决定修复。timeout、Provider 丢失或 Policy 违规进入稳定 SandboxError。

### 12.3 终止

`terminate()`：

1. CAS 占用状态 → `terminating`。
2. 调用 Provider destroy。
3. inspect 确认 missing。
4. CAS `terminating → terminated`，写入 terminatedAt。

重复 terminate 幂等。Provider 暂时不可用时保持 `terminating`，由 Reconciler
继续。

## 13. SandboxReconciler

Reconciler 是单次、分批、顺序扫描函数，无内置 interval。

- 过期 `reserved`：CAS → `failed`。
- 过期 `provisioning/ready/running/lost/failed`：CAS → `terminating`；没有
  Provider 资源时直接确认 missing 并进入 `terminated`。
- `provisioning + externalId`：inspect；存在则继续 readiness，missing 则按
  provisioningKey 查找。
- `provisioning + 无 externalId`：按 provisioningKey 和 ownership labels 查找。
  - 唯一命中：回填 externalId。
  - 零命中：调用幂等 create。
  - 多个命中：选择创建时间最早的一个，其余进入 destroy；Lease 绑定保留资源。
- `ready/running`：inspect missing 时 CAS → `lost`。
- 未过期的 `failed/lost`：如果存在 Provider 资源则进入 `terminating`；没有资源
  则进入 `terminated`。
- `terminating`：重复 destroy；确认 missing 后 → `terminated`。
- Provider 中超过 orphan grace period、携带 `managed-by=open-v0` 且无 Lease 的
  资源：destroy。

绑定或重建 provisioning 资源后，Reconciler 调用 SandboxService 内部共享的
`resumeProvisioning(leaseId)`：connect、waitUntilReady、重新读取 owned
sourceArtifact、覆盖写入规范化 Bundle，然后 CAS 到 ready。它不能仅因 Provider
资源存在就把 Lease 标为 ready。

所有状态写入使用 CAS。并发 Reconciler 只允许一个实例完成转换和计数。Provider
暂时不可用不把 Lease 标为 lost/failed。

## 14. 错误模型

```ts
type SandboxErrorCode =
  | 'SANDBOX_PROVIDER_UNAVAILABLE'
  | 'SANDBOX_SCHEDULER_UNAVAILABLE'
  | 'SANDBOX_CAPABILITY_MISSING'
  | 'SANDBOX_QUOTA_EXCEEDED'
  | 'SANDBOX_BRANCH_BUSY'
  | 'SANDBOX_NOT_FOUND'
  | 'SANDBOX_INVALID_STATE'
  | 'SANDBOX_SOURCE_UNAVAILABLE'
  | 'SANDBOX_PROVISION_FAILED'
  | 'SANDBOX_NOT_READY'
  | 'SANDBOX_COMMAND_FAILED'
  | 'SANDBOX_COMMAND_TIMEOUT'
  | 'SANDBOX_OUTPUT_LIMIT'
  | 'SANDBOX_LOST'
  | 'SANDBOX_POLICY_DENIED'
  | 'SANDBOX_OWNERSHIP_MISMATCH'
```

`SandboxError` 包含 code、稳定 message、retryable 和 cause。cause 只用于内部日志。
Provider 原始错误、宿主机路径、Token、Endpoint、完整环境变量和未截断日志不进入
Lease、API 或事件。

## 15. 配置

建议环境变量：

```env
SANDBOX_PROVIDER=fake
SANDBOX_LOCAL_ENABLED=false
SANDBOX_ALLOWED_BUILD_IMAGES=node:22
SANDBOX_QUOTA_LOCK_TTL_MS=5000
SANDBOX_QUOTA_LOCK_WAIT_MS=2000
SANDBOX_READINESS_TIMEOUT_MS=60000
SANDBOX_LEASE_SECONDS=900
SANDBOX_AUTO_DELETE_SECONDS=1800
SANDBOX_ORPHAN_GRACE_MS=300000
```

生产环境检测到 `SANDBOX_PROVIDER=local` 或 `SANDBOX_LOCAL_ENABLED=true` 时启动失败。
Phase 2 默认 runtime 使用 Fake Provider，不接入 Worker。

## 16. 测试策略

### 16.1 Provider contract

Fake 和 Local 运行同一套合同测试：

- provisioningKey 幂等与冲突。
- 文件写入、读取和路径拒绝。
- 结构化命令、timeout、终止和日志上限。
- inspect/list/destroy 幂等。
- Capability 与 fail-closed。

Local 额外验证：

- 无 `shell: true`。
- 进程树 timeout 后被终止。
- symlink 和根目录逃逸被拒绝。
- destroy 后目录及子进程消失。

### 16.2 Scheduler 集成

使用真实 MongoDB 和 Redis：

- Branch 同时最多一个占用 Build Lease。
- Project Build=2、Preview=3 默认限制。
- Workspace 数量和 CPU/内存/磁盘聚合。
- 同 provisioningKey 并发请求收敛。
- Redis 不可用时不创建 Lease。
- 锁释放只能删除自己的 token。

### 16.3 SandboxService 集成

- Owned Candidate/Snapshot Artifact 恢复。
- Capability 预检在 reserve 前失败。
- create 后 externalId 保存。
- 文件写入失败进入 terminating/terminated。
- 固定命令不能被调用方覆盖。
- 同一 provisioningKey 重试不创建第二个资源。
- ownership mismatch 不读取或控制其他 Lease。

### 16.4 Reconciler 故障注入

- create 成功、返回前崩溃。
- create 成功、externalId 保存前崩溃。
- provisioning 资源零个、一个和多个。
- ready/running 资源丢失。
- terminating destroy 暂时失败。
- orphan grace 与 managed-by 标签。
- 两个 Reconciler 并发 CAS。

## 17. 验收标准

Phase 2 完成需满足：

1. Sandbox Core 无 Daytona SDK、Express 或 BullMQ 依赖。
2. Fake 和 Local Provider 通过同一合同测试。
3. Local Provider 无 shell 字符串执行，且不能在生产启用。
4. Build Branch、Project 和 Workspace 配额在并发下不超卖。
5. Preview Lease 预留遵循 Project/Workspace 配额，但不创建 Preview 资源。
6. Redis 不可用时新预留 fail closed。
7. Mongo Lease 是资源事实；终止确认前持续占用配额。
8. Provider create 的关键崩溃窗口可由 Reconciler 恢复。
9. Artifact Bundle 可以恢复到 Build Sandbox，不重新调用模型。
10. 非 terminated Lease 的 sourceArtifact 不会被 Artifact Reconciler 回收。
11. 固定 Build 命令的路径、环境、超时和日志上限不能被调用方覆盖。
12. 本阶段不改变现有 Worker 校验行为。
13. Server 单元、集成、类型检查和生产构建全部通过。

## 18. 后续阶段

Phase 3 实现自托管 DaytonaProvider、网络策略、日志 Artifact、Archive 上传和 Build
Sandbox 重建，然后把 Agent Worker 校验从宿主机切换到 SandboxService。

Phase 4 实现 PreviewDeployment、PreviewBinding、PreviewSession、Preview Gateway、
Snapshot 共享、Project/Workspace Preview 配额和无活跃 Session 的 LRU 回收。
