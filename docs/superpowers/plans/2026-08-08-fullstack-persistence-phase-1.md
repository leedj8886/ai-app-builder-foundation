# 持久化全栈项目阶段 1 实施计划

**目标：** 在不改变现有静态 React 项目行为的前提下，引入可版本化的 Project
Profile，并让 `fullstack-nestjs-prisma-postgres/v1` 候选能够经过路径策略、平台文件
完整性检查和一次性 PostgreSQL 迁移重放，最终保存为带 Profile 引用的 Snapshot。

**架构：** Orchestrator 只解析 Profile 并调用其模板、依赖、文件策略和验证契约，
不按技术栈增加条件分支。既有静态项目和旧 Artifact 缺少 Profile 信息时统一解释为
`static-react/v1`。全栈候选的数据库只用于验证，阶段 1 不创建持久数据库或长期
Runtime。

**技术栈：** TypeScript、Node.js、Mongoose、现有 ArtifactStore 与 Sandbox、
NestJS、Prisma、PostgreSQL、Testcontainers、Node Test Runner。

---

## 范围与已确认决策

阶段 1 包含：

- `static-react/v1` 和 `fullstack-nestjs-prisma-postgres/v1` Profile；
- Profile Registry、版本解析和旧数据兼容；
- Profile 级模板、平台依赖、固定 scripts、可编辑路径和结构验证；
- Snapshot、ValidationCandidate、Artifact 和 AgentRun 的 Profile 归属；
- `.prisma`、`.sql` 文件及全栈目录结构；
- 一次性 PostgreSQL 上的 Prisma 校验、生成和迁移重放；
- 静态项目回归测试和一个 Todo 全栈验证样例。

阶段 1 明确不包含：

- ProjectEnvironment、DatabaseResource、AppDeployment 或持久 Preview；
- Database、Secret、Deployment、Runtime Log、Analytics Adapter；
- 托管数据库和生产部署；
- 强制 expand/contract、历史业务数据兼容性门禁；
- 按 Preview、Staging、Production 区分的迁移保护策略；
- 破坏性迁移的统一拒绝或审批流程。

一次性数据库验证只证明迁移在干净基线上可重放，不承诺兼容任意历史业务数据。
保留数据、重置数据库或接受不可逆迁移由阶段 2 的平台用户部署选择处理。

## 兼容策略

1. 现有 Project、AgentRun、Snapshot 和 Artifact 缺少 Profile 时按
   `static-react/v1` 读取。
2. 新建项目必须显式保存 Profile；Profile 在 Run 创建时固化，运行中不跟随项目
   设置变化。
3. 新 Snapshot 和 ValidationCandidate 同时保存 ProfileRef；读取 Artifact 后必须
   校验两者一致。
4. Project Artifact 引入 Bundle V2 保存 ProfileRef；解码继续支持 V1，并将 V1
   规范化为 `static-react/v1`。
5. 外层 Artifact 压缩、哈希和存储协议不变；只有 Bundle 内容版本升级。
6. `static-react/v1` 的输出、固定 scripts、验证步骤和 Preview 行为保持不变。

## 计划文件图

新增：

- `apps/server/src/agent/profiles/types.ts`
- `apps/server/src/agent/profiles/registry.ts`
- `apps/server/src/agent/profiles/staticReactProfile.ts`
- `apps/server/src/agent/profiles/fullstackNestPrismaProfile.ts`
- `apps/server/src/agent/profiles/errors.ts`
- `apps/server/src/agent/profiles/*.test.ts`
- `apps/server/src/agent/validation/validationDatabase.ts`
- `apps/server/src/agent/validation/testcontainersPostgres.ts`

主要修改：

- `apps/server/src/agent/projectTemplate.ts`
- `apps/server/src/agent/dependencies.ts`
- `apps/server/src/agent/fileOperations.ts`
- `apps/server/src/agent/validation/structure.ts`
- `apps/server/src/agent/validator.ts`
- `apps/server/src/agent/sandboxValidator.ts`
- `apps/server/src/agent/contextBuilder.ts`
- `apps/server/src/agent/orchestrator.ts`
- `apps/server/src/agent/types.ts`
- `apps/server/src/agent/schemas.ts`
- `apps/server/src/models/Project.ts`
- `apps/server/src/models/AgentRun.ts`
- `apps/server/src/models/ProjectSnapshot.ts`
- `apps/server/src/models/ValidationCandidate.ts`
- `apps/server/src/artifacts/types.ts`
- `apps/server/src/artifacts/bundle.ts`

---

## Task 1：建立 Profile 契约与 Registry

- [x] 定义 `ProfileRef`、`ProjectProfile`、`EditablePathPolicy`、
  `ValidationStageDescriptor` 和 `RuntimeDescriptor`。
- [x] Profile ID 使用稳定名称，版本独立保存；Registry 拒绝未知 ID 或版本。
- [x] 用 `StaticReactProfile` 包装现有模板、依赖合并、结构检查和验证步骤，先不改变
  原有函数行为。
- [x] 保留现有导出作为短期兼容入口，但内部委托给 `StaticReactProfile`。
- [x] 测试 Registry 精确解析、未知 Profile 失败、模板每次返回独立对象，以及静态
  Profile 与现有输出完全一致。

完成标准：不修改数据库结构时，现有静态项目单元测试、类型检查和构建全部通过。

## Task 2：固化并持久化 ProfileRef

- [x] Project 新增 ProfileRef，新项目创建接口显式选择 Profile，未传时默认
  `static-react/v1`。
- [x] AgentRun 在创建时复制 Project ProfileRef，Worker 只使用 Run 上固化的值。
- [x] ProjectSnapshot 和 ValidationCandidate 保存 ProfileRef。
- [x] 定义 Project Artifact Bundle V2，在 Bundle 内保存 ProfileRef。
- [x] V1 Profile 解析兼容层返回 `static-react/v1`；V2 编码要求 ProfileRef。
- [x] Snapshot/Candidate 读取时检查 MongoDB 引用与 Bundle ProfileRef 一致，不一致
  使用稳定错误码拒绝。
- [x] Artifact 哈希稳定性、V1 兼容读取、V2 往返和 Profile 不一致分别覆盖测试。

完成标准：旧 Snapshot 仍可编辑和预览；新 Run、Candidate、Snapshot 和 Artifact
都能追溯到同一个 Profile 版本。

## Task 3：强制 Profile 文件策略

- [x] 把路径规范化提取为单一实现，Schema 校验与文件应用使用相同规则。
- [x] FileOperation 在执行前整体验证；任一操作越权时整批拒绝，不产生部分修改。
- [x] Generation 和 Repair 调用同一个 Profile 策略入口。
- [x] 平台文件使用模板摘要或内容摘要检查，防止模型通过 update 间接覆盖。
- [x] `static-react/v1` 保持当前必需文件约束。
- [x] 全栈 Profile 只允许编辑：
  `apps/api/src/modules/**`、`apps/web/src/**`、`prisma/schema.prisma` 和新增的
  `prisma/migrations/<migration-id>/**`。
- [x] 已存在于基础 Snapshot 的 Migration 目录不可 update/delete；模型只能追加新
  Migration，避免改写已保存的执行历史。
- [x] 实现并测试 `PROFILE_PATH_DENIED`、`PROFILE_PLATFORM_FILE_MODIFIED`、
  `PROFILE_SCRIPT_MODIFIED`、`PROFILE_UNSUPPORTED_FILE_TYPE`。

完成标准：越权操作在写入 Candidate 前失败，错误可进入脱敏 Agent Event 并供 Repair
定向修正。

## Task 4：加入全栈模板和生成上下文

- [x] `ProjectFileLanguage`、生成结果 Schema 和 Artifact 校验支持 `.prisma` 与 `.sql`。
- [x] 创建 NestJS、Prisma、React/Vite 全栈模板；Bootstrap、AppModule、
  PrismaService、认证骨架、健康检查和根配置均标为平台维护。
- [x] Profile 生成固定 package.json 依赖和 scripts，模型返回的依赖只经过 Profile
  Allowlist 合并，不能覆盖 scripts。
- [x] AgentContext 使用 Profile ID、版本、可编辑路径和能力描述，不再把生成目标
  硬编码为 `framework: react`。
- [x] 更新模型规划、生成和修复提示，使其只返回业务模块、Web 源码、Prisma Schema
  和新增 Migration。
- [x] 测试全栈模板结构、固定文件摘要、依赖排序、禁止脚本修改和上下文裁剪。

完成标准：Fake Model 可以生成 Todo Module、前端调用、Prisma Schema 和新增
Migration，且不能修改平台启动与连接代码。

## Task 5：让验证流水线由 Profile 驱动

- [x] 将当前固定的 `structure/install/type-check/build` 改为 Profile 返回的有序阶段，
  阶段实现仍由平台注册，模型不能提供命令。
- [x] 扩展 Validation 类型和 Mongoose Schema，支持 Prisma、Migration、API Test 和
  Runtime Smoke 阶段，同时保持旧检查结果可读。
- [x] 静态 Profile 继续执行现有四阶段，输出顺序和错误分类不变。
- [x] 全栈 Profile 固定执行：结构检查、安装、Prisma Validate、Prisma Generate、
  Migration 历史与校验和检查、迁移重放、NestJS Type-check、API Test、Web/API
  Build、Runtime Smoke。
- [x] Dependency Cache 指纹加入 ProfileRef 和平台依赖版本，避免跨 Profile 误复用。
- [x] legacy validator 和 sandbox validator 使用同一阶段描述及结果结构。

完成标准：Orchestrator 不出现 NestJS/Prisma 条件分支；新增技术栈只需注册新的
Profile 和阶段实现。

## Task 6：一次性 PostgreSQL 验证资源

- [x] 定义仅供验证使用的 `ValidationDatabase` 接口，返回短期连接引用并支持
  `destroy`；接口不得进入生成项目或 Snapshot。
- [x] 测试/本地实现使用 Testcontainers PostgreSQL，为每轮验证创建独立数据库。
- [x] Sandbox 验证由控制面创建数据库并只在对应 Lease 的命令环境中注入连接串。
- [x] 连接串不得出现在 ValidationResult、Agent Event、错误正文或持久日志。
- [x] 在干净数据库和 Shadow Database 上重放全部 Migration；成功或失败后都执行
  清理，清理失败交给 Reconcile/测试回收逻辑。
- [x] 迁移重放只检查可执行性、历史连续性和校验和，不加入历史数据兼容或破坏性
  变更阻断。

完成标准：并行项目验证互相隔离；取消、失败和 Worker 异常不会把数据库凭据写入
控制面，也不会长期遗留验证数据库。

## Task 7：端到端验收与回归

- [x] 新增静态项目回归：创建、编辑、Repair、Snapshot、Artifact 和静态 Preview。
- [x] 新增全栈 Todo Fixture：创建、读取、更新、删除及一次性数据库迁移重放。
- [x] 测试 Generation 和 Repair 的平台文件越权均被拒绝。
- [x] 测试旧 Bundle V1 可以作为新 Run 的基础 Snapshot。
- [x] 测试 Profile 不匹配、Migration 历史改写、连接串泄漏和验证取消。
- [ ] 运行 Server 单元测试、集成测试、全仓类型检查、构建和仓库就绪性测试。

阶段 1 验收命令：

```bash
npm run test --workspace @ai-app-builder-foundation/server
npm run test:integration --workspace @ai-app-builder-foundation/server
npm run type-check
npm run build
npm run test:readiness
```

最终交付应证明：静态项目无回归、全栈候选能在一次性 PostgreSQL 上完成 Todo CRUD
验证、Snapshot 明确记录 Profile、模型不能修改平台文件，并且没有引入持久数据库、
生产迁移门禁或长期 Runtime。
