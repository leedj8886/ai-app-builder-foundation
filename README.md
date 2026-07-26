# v0-by-kimi

### Workspace/Branch 数据迁移

升级到包含 ProjectBranch 的版本时，先停止 API Server 和 Agent Worker，
备份 MongoDB，然后执行：

```bash
npm run build --workspace @v0/server
npm run start:migrate:workspace-branches --workspace @v0/server
```

命令可重复执行。只有看到 `Workspace/Branch migration completed` 后才能启动
新版本 Server 和 Worker。迁移会创建一个默认 Workspace、把现有用户加入该
Workspace、为每个 Project 创建 `main` Branch，并回填 Chat 和 AgentRun。

一个基于自然语言的多轮对话生成 Web 站点的平台，类似于 v0.dev。

## 功能特性

- 🤖 **AI 驱动的代码生成** - 通过自然语言描述生成 React + Tailwind CSS + shadcn/ui 代码
- 💬 **多轮对话迭代** - 持续对话修改和优化生成的界面
- 👁️ **实时预览** - 即时查看生成的 UI 效果
- 📁 **项目管理** - 保存对话历史，组织成项目
- 🔐 **用户认证** - 支持注册、登录、个人工作台
- 📤 **代码导出** - 一键复制或下载生成的代码

## 技术栈

### 后端
- Node.js + Express
- TypeScript
- MongoDB (数据存储)
- DeepSeek API（AI 代码生成）
- JWT (认证)

### 前端
- React 18 + TypeScript
- Tailwind CSS
- shadcn/ui
- Monaco Editor (代码编辑)
- Sandpack (代码预览)

## 项目结构

```
v0-by-kimi/
├── apps/
│   ├── server/          # 后端服务
│   └── web/             # 前端应用
├── packages/
│   ├── shared/          # 共享类型和工具
│   └── ui/              # 共享 UI 组件
├── docker-compose.yml
└── README.md
```

## 快速开始

```bash
# 安装依赖并启动基础设施
npm install
docker compose up -d mongodb redis

# 准备本地共享 Artifact 目录和环境变量
mkdir -p /tmp/open-v0-artifacts
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env

# 启动开发服务器
npm run dev

# 访问 http://localhost:5173
```

完整容器启动前需在仓库根目录 `.env` 配置 `DEEPSEEK_API_KEY`，然后执行：

```bash
docker compose up --build
```

Web、API 分别监听 `http://localhost:3000` 和 `http://localhost:3001`；可通过
`WEB_PORT` 覆盖 Web 端口。Server 与 Worker
共同挂载 `artifact_store` volume。一次性 Artifact Reconciler 不随主服务常驻，
需要时执行：

```bash
docker compose --profile maintenance run --rm artifact-reconciler
```

## 环境变量

```bash
# 后端 (.env)
PORT=3001
MONGODB_URI=mongodb://localhost:27017/v0-by-kimi
JWT_SECRET=your-secret-key
DEEPSEEK_API_KEY=your-deepseek-key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
# 可选：只覆盖 Agent Worker 使用的模型
AGENT_MODEL=

# 前端 (.env)
VITE_API_URL=http://localhost:3001
```

## Agent Worker

生产 Worker 使用真实 DeepSeek API 和真实项目校验：

```bash
npm run build --workspace @v0/server
npm run start:worker --workspace @v0/server
```

`DEEPSEEK_MODEL` 默认是 `deepseek-v4-flash`。如需更高质量，可设置为
`deepseek-v4-pro`；`AGENT_MODEL` 只覆盖 Agent Worker。

Smoke Worker 使用确定性的 FakeModelClient，不调用 DeepSeek，也不会产生模型费用：

```bash
npm run build --workspace @v0/server
npm run start:smoke-worker --workspace @v0/server
```

不要把 `DEEPSEEK_API_KEY` 提交到 Git。

## 项目验证与缓存

Worker 会依次检查项目结构、准备依赖、运行 TypeScript 检查和生产构建。
依赖按 `package.json`、锁文件、Node/npm 版本生成指纹，并持久化到
`AGENT_VALIDATION_DEPENDENCY_CACHE_ROOT`；npm 下载缓存位于
`AGENT_VALIDATION_NPM_CACHE_ROOT`。Docker Compose 默认把两者挂载到
`agent_validation_cache` volume。

常用配置：

```bash
AGENT_VALIDATION_STRUCTURE_TIMEOUT_MS=5000
AGENT_VALIDATION_CACHE_HIT_TIMEOUT_MS=15000
AGENT_VALIDATION_INSTALL_TIMEOUT_MS=180000
AGENT_VALIDATION_TYPE_CHECK_TIMEOUT_MS=60000
AGENT_VALIDATION_BUILD_TIMEOUT_MS=120000
AGENT_VALIDATION_ROUND_TIMEOUT_MS=300000
AGENT_VALIDATION_INFRA_RETRY_DELAYS_MS=5000,15000
AGENT_VALIDATION_CACHE_RETENTION_MS=604800000
AGENT_VALIDATION_CACHE_MAX_BYTES=10737418240
```

缓存启动时清理一次，之后每六小时清理；默认保留七天，最大 10 GiB。
校验子进程只继承 `PATH`、`HTTP_PROXY`、`HTTPS_PROXY`、`NO_PROXY`、
`NODE_EXTRA_CA_CERTS`、`NPM_CONFIG_REGISTRY` 和 `npm_config_registry`，
这些值不会写入事件或校验结果。

失败分类如下：

- `CODE_ERROR`：TypeScript 或构建代码错误，可由代码修复流程处理。
- `DEPENDENCY_ERROR`：包名、版本或依赖声明错误，只允许依赖定向修复。
- `INFRA_ERROR`：registry、网络、超时等环境问题；自动退避重试，不调用模型。

基础设施重试耗尽后，页面会提供“重新验证”。它复用已保存的候选文件和依赖，
不会重新生成代码，也不会新增用户对话消息；“重新生成”则会再次调用模型并产生
新的代码候选。

## Artifact 共享存储

ProjectSnapshot 和 ValidationCandidate 的源码 Bundle 不保存在 MongoDB 中。
MongoDB 只保存不可变 Artifact 的 Manifest 和 `artifactId`；gzip JSON Blob
保存在所有 API Server、Agent Worker 和运维任务共同挂载的持久目录。

生产环境至少配置：

```bash
ARTIFACT_STORE_DRIVER=shared-filesystem
ARTIFACT_STORE_ROOT=/var/lib/open-v0/artifacts
ARTIFACT_MAX_BUNDLE_BYTES=52428800
ARTIFACT_MAX_COMPRESSED_BYTES=20971520
ARTIFACT_MAX_FILES=5000
ARTIFACT_WRITING_TIMEOUT_MS=300000
ARTIFACT_ORPHAN_RETENTION_MS=86400000
```

部署约束：

- `ARTIFACT_STORE_ROOT` 必须由部署系统预先创建，不能使用容器临时层、仓库目录
  或 HTTP 静态资源目录。
- API、Worker 和 Reconciler 必须挂载同一个 PVC/NFS 路径。挂载根只允许可信的
  平台运行账户写入，不与用户进程共享写权限。
- 启动前检查运行账户对根目录具有读写权限，并能对目录执行 `fsync`。所选
  PVC/NFS 还必须验证同一挂载点内的 hard-link no-clobber、文件 `fsync` 和目录
  `fsync` 语义；这些能力是不可变发布和崩溃恢复的前提。
- 部署系统负责备份、容量及 inode 告警。临时清理失败应进入平台日志和告警。

一次性 Reconciler 用于推进超时的 `writing` Manifest、重试
`delete_pending` 清理，以及回收超过保留期且没有 Snapshot、Candidate 或非终态
SandboxLease 引用的
Artifact：

```bash
# 开发或运维容器
npm run reconcile:artifacts --workspace @v0/server

# 编译后的生产镜像
npm run start:reconcile:artifacts --workspace @v0/server
```

建议由 Kubernetes CronJob 或企业调度平台周期执行，每次运行结束后退出。实现使用
Manifest CAS，可容忍偶发的并发执行，但生产环境仍建议单任务并发策略，以减少共享
存储负载。命令启动时会检查挂载根权限，失败时以非零状态退出且不输出内部路径。

该命令不是存量数据迁移工具；本项目采用最终态 Artifact Schema，不支持把旧的
MongoDB `files/packageJson` 字段转换为 Artifact。

## Sandbox Core（Phase 2）

Phase 2 提供与具体厂商无关的 Sandbox Core，但尚未切换 Agent Worker 的现有本地
校验流程。当前默认使用确定性的 Fake Provider 做测试；LocalProcessProvider 仅供
开发和合同测试使用，不提供网络隔离，也禁止在生产环境启用。

新 Sandbox 预留通过 Redis Workspace 短锁进行调度。Redis 不可用或锁丢失时，
系统会拒绝新预留，不会退化为无锁 MongoDB 计数。MongoDB 中以下 Lease 状态占用
Project 和 Workspace 配额：

- `reserved`
- `provisioning`
- `ready`
- `running`
- `terminating`

每个 Branch 最多存在一个占用配额的 Build Lease；Project 默认最多两个并行 Build
和三个运行中 Preview，Workspace 同时限制数量、CPU、内存和磁盘。历史代码内容
由 ArtifactStore 持久保存，非 `terminated` Lease 会保护其源 Artifact 不被回收。

Daytona Provider、Worker 切换、PreviewDeployment、Preview Gateway 和 Preview
回收策略属于后续阶段，Phase 2 不把这些能力标记为已实现。
