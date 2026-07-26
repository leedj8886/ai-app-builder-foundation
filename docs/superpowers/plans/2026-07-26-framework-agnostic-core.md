# TypeScript 原生、框架无关核心实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 TypeScript Native 与 Framework-Agnostic Core 确立为项目的公开架构原则，并通过仓库就绪性测试防止定位漂移。

**Architecture:** 仅修改公开文档和仓库就绪性测试，不改变运行时代码。README 负责项目定位，架构文档定义核心与 Adapter 边界，贡献规范约束依赖引入，Roadmap 将原则固定为长期护栏；每份文档分别通过先失败后通过的断言进行守护。

**Tech Stack:** Markdown、TypeScript、Node.js Test Runner、`node:assert/strict`

---

### Task 1: 在 README 中公开两条设计原则

**Files:**
- Modify: `tests/repository/open-source-readiness.test.ts`
- Modify: `README.md`

- [ ] **Step 1: 为 README 原则声明编写失败测试**

在 `README presents the platform-builder positioning and valid core docs` 测试中，紧接现有定位断言后加入：

```ts
assert.match(readme, /TypeScript Native/);
assert.match(readme, /Framework-Agnostic Core/);
assert.match(readme, /LangChain、LangGraph、AI SDK/);
assert.match(readme, /独立、可选的 Adapter/);
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
npm run test:readiness
```

Expected: FAIL，错误显示 README 不匹配 `TypeScript Native`。

- [ ] **Step 3: 在 README 中加入设计原则**

在“为什么做这个项目”之后、“适合谁”之前加入：

```markdown
## 设计原则

- **TypeScript Native：** Web、API、Agent Runtime、工具协议和共享类型使用统一的 TypeScript 技术栈，便于 Web 团队理解、调试和改造。
- **Framework-Agnostic Core：** 模型调用、工具循环、状态流转、事件、快照和验证能力基于项目自身的清晰接口；核心不依赖 LangChain、LangGraph、AI SDK 等应用层 Agent 框架。
- **集成而不绑定：** 团队可以在核心边界之外接入第三方框架或内部 Agent 平台，并将它们维护为独立、可选的 Adapter。

这让团队能够控制关键运行路径、替换模型和基础设施，并按自己的设计系统、代码规范与部署环境进行私有化改造。
```

- [ ] **Step 4: 运行测试并确认通过**

Run:

```bash
npm run test:readiness
```

Expected: PASS，4 项仓库就绪性测试全部通过。

- [ ] **Step 5: 提交 README 原则**

```bash
git add README.md tests/repository/open-source-readiness.test.ts
git commit -m "docs: publish core architecture principles"
```

### Task 2: 在架构文档中定义核心与 Adapter 边界

**Files:**
- Modify: `tests/repository/open-source-readiness.test.ts`
- Modify: `docs/architecture.md`

- [ ] **Step 1: 为架构边界编写失败测试**

在仓库就绪性测试文件末尾加入：

```ts
test('architecture keeps the core independent from application agent frameworks', async () => {
  const architecture = await readFile(
    repositoryFile('docs/architecture.md'),
    'utf8'
  );

  assert.match(architecture, /## 核心边界/);
  assert.match(
    architecture,
    /Model Provider.*Agent Runtime.*Tool Registry.*Run.*Event State.*Workspace Snapshot.*Validate.*Repair.*Preview/s
  );
  assert.match(
    architecture,
    /核心不依赖 LangChain、LangGraph、AI SDK 等应用层 Agent 框架/
  );
  assert.match(architecture, /独立、可选的 Adapter/);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
npm run test:readiness
```

Expected: FAIL，错误显示 `docs/architecture.md` 不匹配 `## 核心边界`。

- [ ] **Step 3: 记录核心运行路径和依赖方向**

在“组件”之后、“一次生成的数据流”之前加入：

```markdown
## 核心边界

核心运行路径由项目自身的 TypeScript 接口连接：

`Model Provider → Agent Runtime / Tool Registry → Run / Event State → Workspace Snapshot → Validate / Repair / Preview`

- 核心不依赖 LangChain、LangGraph、AI SDK 等应用层 Agent 框架。
- Orchestrator、状态模型和验证流水线只依赖项目自有接口，不接收厂商 SDK 或第三方框架的专有类型。
- 模型厂商、第三方框架和内部 Agent 平台通过边缘 Adapter 接入。
- 这些集成应保持为独立、可选的 Adapter，不得成为核心运行、默认构建或自托管部署的前置条件。

“框架无关”并不禁止团队使用第三方框架，而是确保团队能够替换任何边缘集成而无需重写 Open v0 的核心状态与执行流程。
```

- [ ] **Step 4: 运行测试并确认通过**

Run:

```bash
npm run test:readiness
```

Expected: PASS，5 项仓库就绪性测试全部通过。

- [ ] **Step 5: 提交架构边界**

```bash
git add docs/architecture.md tests/repository/open-source-readiness.test.ts
git commit -m "docs: define framework-agnostic core boundary"
```

### Task 3: 在贡献规范中约束核心依赖

**Files:**
- Modify: `tests/repository/open-source-readiness.test.ts`
- Modify: `CONTRIBUTING.md`

- [ ] **Step 1: 为贡献规则编写失败测试**

在 `repository contains the approved open-source governance files` 测试读取 `CONTRIBUTING.md` 后加入：

```ts
assert.match(contributing, /应用层 Agent 框架.*默认不进入核心包/s);
assert.match(contributing, /独立、可选的 Adapter/);
assert.match(
  contributing,
  /默认启动、测试、构建或自托管流程的前置条件/
);
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
npm run test:readiness
```

Expected: FAIL，错误显示贡献规范缺少“应用层 Agent 框架”约束。

- [ ] **Step 3: 增加依赖与 Adapter 评审规则**

在“变更原则”之后、“Commit 和 Pull Request”之前加入：

```markdown
## 核心依赖和 Adapter

- LangChain、LangGraph、AI SDK 等应用层 Agent 框架默认不进入核心包。
- 如果第三方框架或内部平台具有集成价值，应优先实现为独立、可选的 Adapter。
- Adapter 不得成为默认启动、测试、构建或自托管流程的前置条件。
- Orchestrator、状态模型和验证流水线不得暴露厂商 SDK 或第三方框架的专有类型。
- 新增抽象必须由当前用例驱动，不为假设中的框架兼容性预先设计接口。

相关 PR 需要说明集成边界、可选安装方式，以及移除该 Adapter 是否会影响核心运行路径。
```

- [ ] **Step 4: 运行测试并确认通过**

Run:

```bash
npm run test:readiness
```

Expected: PASS，5 项仓库就绪性测试全部通过。

- [ ] **Step 5: 提交贡献规则**

```bash
git add CONTRIBUTING.md tests/repository/open-source-readiness.test.ts
git commit -m "docs: guide optional framework adapters"
```

### Task 4: 将原则固定为 Roadmap 长期护栏

**Files:**
- Modify: `tests/repository/open-source-readiness.test.ts`
- Modify: `ROADMAP.md`

- [ ] **Step 1: 为 Roadmap 护栏编写失败测试**

在治理文件测试读取 `ROADMAP.md` 后加入：

```ts
assert.match(roadmap, /## 长期架构护栏/);
assert.match(roadmap, /TypeScript Native/);
assert.match(roadmap, /Framework-Agnostic Core/);
assert.match(roadmap, /项目自有接口/);
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
npm run test:readiness
```

Expected: FAIL，错误显示 Roadmap 不匹配 `## 长期架构护栏`。

- [ ] **Step 3: 增加长期架构护栏**

在“当前基线”之后、“接下来”之前加入：

```markdown
## 长期架构护栏

- **TypeScript Native：** 保持 Web、API、Agent Runtime、工具协议和共享类型的统一 TypeScript 技术栈。
- **Framework-Agnostic Core：** 核心运行路径不绑定应用层 Agent 框架，Provider、Tool 和 Workflow 扩展基于项目自有接口实现。
- **Optional Adapters：** 模型厂商、第三方框架和内部平台集成保持独立、可选、可替换。

路线图中的新能力必须保持这些边界；迁移到某个应用层 Agent 框架不属于项目方向。
```

- [ ] **Step 4: 运行测试并确认通过**

Run:

```bash
npm run test:readiness
```

Expected: PASS，5 项仓库就绪性测试全部通过。

- [ ] **Step 5: 提交 Roadmap 护栏**

```bash
git add ROADMAP.md tests/repository/open-source-readiness.test.ts
git commit -m "docs: preserve long-term architecture guardrails"
```

### Task 5: 完整验证变更

**Files:**
- Verify: `README.md`
- Verify: `docs/architecture.md`
- Verify: `CONTRIBUTING.md`
- Verify: `ROADMAP.md`
- Verify: `tests/repository/open-source-readiness.test.ts`

- [ ] **Step 1: 运行仓库就绪性测试**

Run:

```bash
npm run test:readiness
```

Expected: PASS，5 项测试全部通过。

- [ ] **Step 2: 检查 Markdown 和 TypeScript 差异格式**

Run:

```bash
git diff --check HEAD~4..HEAD
```

Expected: 无输出，退出码为 0。

- [ ] **Step 3: 确认没有运行时代码变更**

Run:

```bash
git diff --name-only HEAD~4..HEAD
```

Expected: 仅包含：

```text
CONTRIBUTING.md
README.md
ROADMAP.md
docs/architecture.md
tests/repository/open-source-readiness.test.ts
```

- [ ] **Step 4: 确认工作区干净**

Run:

```bash
git status --short
```

Expected: 无输出。
