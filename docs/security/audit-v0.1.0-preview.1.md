# v0.1.0-preview.1 依赖审计处置

本记录覆盖根工作区的全量 `npm audit` 结果，不代表对生成代码、部署环境或模型
Provider 的完整安全审计。

## 已修复

预发布候选已升级 Express、Mongoose、Morgan、PostCSS、Form Data、
Path-to-RegExp 等生产依赖，并使用 Node.js `crypto.randomUUID()` 替换旧 `uuid`
依赖。开发与构建工具同步升级到 Playwright 1.62.1、Turbo 2.10.8、Vite 8.1.5 和
Testcontainers 12.0.4，Node.js 最低版本提升至 22.19。除下述 React Router 公告外，
全量依赖审计项已清零。

## 临时接受：React Router RSC Mode CSRF

- 公告：`GHSA-qwww-vcr4-c8h2`
- 当前依赖：`react-router-dom@7.18.2`
- 影响范围：React Router RSC Mode 的 Action / Server Action 请求处理
- 当前项目：只使用 Vite 客户端路由，不启用 React Router Framework Mode、SSR、
  RSC、loader、action 或 Server Action；Express API 与 React Router 请求处理相互独立

因此该公告在当前预览版架构下没有可达的受影响执行路径。此结论只适用于
`v0.1.0-preview.1`，不适用于未来引入 React Router 服务端能力的版本。

## 约束与退出条件

- Dependabot 持续跟踪 React Router 安全版本。
- CI 运行 `npm run audit:dependencies`；脚本只允许公告 `GHSA-qwww-vcr4-c8h2` 及其
  `react-router-dom` 传递记录，任何新增公告都会失败。
- 每次预发布与稳定版候选重新检查例外的可达性，不能用 `npm audit fix --force`
  降级 React Router 来绕过门禁。
- 一旦引入 React Router SSR、RSC、Framework Mode、loader 或 action，本接受立即失效。
- `react-router-dom` 发布不受该公告影响的客户端路由版本后，移除此接受并升级依赖。
