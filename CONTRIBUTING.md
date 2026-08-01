# 参与贡献

感谢你帮助改进 AI App Builder Foundation。

## 开始之前

1. 先搜索已有 Issue 和 Discussion。
2. Bug 请提供最小复现；较大的功能先创建 Feature Request。
3. 不要在 Issue、日志或截图中提交 API Key、Cookie、Token 或内部地址。

## 本地开发

```bash
npm install
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env
docker compose up -d mongodb redis
npm run dev
```

在另一个终端启动 Agent Worker：

```bash
npm run worker --workspace @ai-app-builder-foundation/server
```

## 提交前验证

```bash
npm run test:readiness
npm run test --workspace @ai-app-builder-foundation/server
npm run test --workspace @ai-app-builder-foundation/web
npm run build
```

涉及 Docker、队列、Worker、快照或完整生成流程时，还需运行：

```bash
npm run test:smoke
```

## 变更原则

- 每个 PR 只解决一个清晰问题。
- 保留现有行为，避免顺手重构无关代码。
- Bug 修复和功能变更应先补失败测试。
- 不提交 `.env`、模型密钥、生成缓存、构建产物或测试录屏。
- 用户可见行为变化需要同步更新 README 或相关文档。

## 核心依赖和 Adapter

- LangChain、LangGraph、AI SDK 等应用层 Agent 框架默认不进入核心包。
- 如果第三方框架或内部平台具有集成价值，应优先实现为独立、可选的 Adapter。
- Adapter 不得成为默认启动、测试、构建或自托管流程的前置条件。
- Orchestrator、状态模型和验证流水线不得暴露厂商 SDK 或第三方框架的专有类型。
- 新增抽象必须由当前用例驱动，不为假设中的框架兼容性预先设计接口。

相关 PR 需要说明集成边界、可选安装方式，以及移除该 Adapter 是否会影响核心运行路径。

## Commit 和 Pull Request

使用简洁的 Conventional Commit 风格，例如：

- `feat: add provider adapter`
- `fix: retry disconnected event streams`
- `docs: clarify Docker quick start`
- `test: cover dependency validation failures`

PR 描述应说明问题、方案、验证命令和仍未验证的部分。
