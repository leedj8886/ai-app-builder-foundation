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
