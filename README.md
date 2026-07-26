# v0-by-kimi

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
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 访问 http://localhost:3000
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
