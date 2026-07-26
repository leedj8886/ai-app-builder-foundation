# TypeScript 原生、框架无关核心设计

## 背景

本项目的目标是帮助团队搭建自己的 v0。为了让普通 Web 团队能够理解、改造和长期维护平台，核心架构需要坚持两条原则：

1. **TypeScript Native（TypeScript 原生）**
2. **Framework-Agnostic Core（框架无关核心）**

这里的“框架无关”特指核心运行路径不依赖 LangChain、LangGraph、AI SDK 等应用层 Agent 框架。项目并不反对这些框架，也不限制团队在独立适配器、示例或业务集成层中使用它们。

## 目标

- 在 README 中让潜在使用者快速理解项目的技术选择和差异化。
- 在架构文档中定义核心模块边界及第三方框架的允许接入位置。
- 在贡献规范中为新增核心依赖提供可执行的评审标准。
- 在 Roadmap 中确保后续 Provider、Tool 和 Workflow 扩展继续遵守这两条原则。
- 通过仓库就绪性测试防止关键声明在文档改版中意外消失。

## 非目标

- 不扫描或禁止所有 `package.json` 中出现特定依赖名称。
- 不阻止社区维护可选的 LangChain、LangGraph、AI SDK 或内部平台适配器。
- 不在本次变更中重构现有 Agent Runtime、模型客户端或 Provider 实现。
- 不承诺兼容任何具体第三方 Agent 框架。

## 文档设计

### README

新增“设计原则”章节，使用简洁、正面的表述：

- TypeScript 原生：Web、API、Agent Runtime、工具协议和共享类型使用统一语言与工具链。
- 框架无关核心：模型调用、工具循环、状态流转、事件、快照和验证能力由项目自身的清晰接口组成，核心不依赖应用层 Agent 框架。
- 可选集成：团队可以在核心边界之外接入第三方框架或内部 Agent 平台。

项目差异化表达应强调“可理解、可控制、可私有化改造”，避免使用攻击或贬低其他框架的措辞。

### 架构文档

新增“核心边界”章节，将以下能力定义为核心运行路径：

`Model Provider → Agent Runtime / Tool Registry → Run / Event State → Workspace Snapshot → Validate / Repair / Preview`

核心模块只能依赖稳定、项目自有的 TypeScript 接口。厂商 SDK 或第三方框架应封装在边缘 Adapter 中，不能向 Orchestrator、状态模型和验证流水线传播其专有类型。

### 贡献规范

新增核心依赖评审规则：

- 引入应用层 Agent 框架的 PR 默认不进入核心包。
- 如果确有集成价值，应优先实现为独立、可选的 Adapter。
- Adapter 不得成为默认启动、测试、构建或自托管流程的前置条件。
- 新增抽象必须由当前用例驱动，避免仅为假设中的框架兼容性设计接口。

### Roadmap

将两条原则列为长期架构护栏，并将 Provider、Tool、Workflow 扩展描述为基于项目自有接口的可替换模块，而不是迁移到某个应用层框架。

## 就绪性测试

扩展 `tests/repository/open-source-readiness.test.ts`：

- README 必须包含 `TypeScript Native` 和 `Framework-Agnostic Core`。
- 架构文档必须明确核心不依赖 LangChain、LangGraph、AI SDK 等应用层 Agent 框架。
- 贡献规范必须说明第三方框架只允许作为独立、可选 Adapter，且不能成为核心运行前置条件。
- Roadmap 必须持续声明 TypeScript 原生与框架无关核心是长期架构护栏。

测试只验证公开承诺持续存在，不对依赖名称执行黑名单扫描。这样既能防止项目定位漂移，也保留可选集成和社区实验空间。

## 验收标准

1. 四份公开文档对两条原则的描述一致，没有将“框架无关”误写成“禁止一切第三方框架”。
2. 核心与可选 Adapter 的边界清晰，贡献者可以判断新依赖应放在哪里。
3. 就绪性测试在删除任一关键原则声明时失败。
4. `npm run test:readiness` 通过。
5. 变更只涉及文档与仓库就绪性测试，不修改运行时代码。
