# GitHub 仓库门面配置 Runbook

本文记录 AI App Builder Foundation 的 GitHub 仓库目标状态。仓库内 CI、社区文件和
Social Preview 资产可以提前提交；仓库改名和设置必须使用具有 `admin` 权限的 GitHub
账号执行。

## 目标状态

| 项目 | 目标值 |
|---|---|
| Owner / Repository | `leedj8886/ai-app-builder-foundation` |
| Default branch | `main` |
| Description | `Self-hosted foundation for building AI App Builders with auditable agents, multi-model routing, build verification, and versioned snapshots.` |
| Homepage | 暂留空；公开 Demo 或文档站可访问后再填写 |
| Issues | Enabled |
| Discussions | Enabled |
| License | Apache-2.0 |
| Social Preview | `docs/assets/github-social-preview.png`，1280×640 |

Topics：

```text
ai-app-builder
coding-agent
prompt-to-app
build-verification
self-hosted
typescript
openai-compatible
bullmq
sandbox
```

## 1. 权限预检

不要只检查 Git SSH 推送能力。`gh` 使用独立的 API 凭据，必须确认当前账号对旧仓库
具有管理权限：

```bash
gh auth status
gh api repos/leedj8886/my-v0 --jq '.permissions'
```

只有输出同时包含 `"admin": true` 时才继续。若仓库已改名，将命令中的旧 slug 换成
新 slug。

## 2. 重命名仓库并配置元数据

```bash
gh repo rename ai-app-builder-foundation \
  --repo leedj8886/my-v0 \
  --yes

git remote set-url origin \
  git@github.com-proton:leedj8886/ai-app-builder-foundation.git

gh repo edit leedj8886/ai-app-builder-foundation \
  --description "Self-hosted foundation for building AI App Builders with auditable agents, multi-model routing, build verification, and versioned snapshots." \
  --enable-issues \
  --enable-discussions \
  --add-topic ai-app-builder \
  --add-topic coding-agent \
  --add-topic prompt-to-app \
  --add-topic build-verification \
  --add-topic self-hosted \
  --add-topic typescript \
  --add-topic openai-compatible \
  --add-topic bullmq \
  --add-topic sandbox
```

## 3. 维护规范默认分支

`main` 已建立并设置为默认分支，所有发布准备和后续开发都以 `main` 为准。`master`
仅保留为迁移前的历史分支；不要把它合并回 `main`，也不要在其上继续开发：

```bash
git switch main
git pull --ff-only origin main
git push -u origin main
gh repo edit leedj8886/ai-app-builder-foundation --default-branch main
```

只有在确认本地 worktree、自动化和外部链接都不再引用 `master` 后，才能单独评估删除
旧远端分支；删除不纳入本 Runbook 的自动步骤。

## 4. 上传 Social Preview

GitHub CLI 不提供稳定的 Social Preview 上传命令。使用仓库网页：

1. 打开 `Settings → General`。
2. 找到 `Social preview`。
3. 上传 `docs/assets/github-social-preview.png`。
4. 保存后把仓库链接粘贴到一个未发布草稿中，确认标题和预览图没有裁切。

## 5. CI 与分支保护

`.github/workflows/ci.yml` 提供三个必需检查：

- `Quality`：readiness、lint、类型检查、Server/Web 单元测试、生产构建和 Compose 配置。
- `Integration`：Server、ArtifactStore 与 Sandbox 的 Testcontainers 集成套件。
- `Smoke`：使用动态本机端口验证 Docker API、Worker、浏览器生成和快照恢复链路。

`External Preview Monitor` 定时检查历史 Snapshot 的 Sandpack fallback；它依赖外部
CodeSandbox 与 jsDelivr，因此保持非阻塞。

等待 `main` 首次 CI 全绿后，在 `Settings → Rules → Rulesets` 为 `main` 建立规则：

- 禁止强制推送和删除。
- Pull Request 合并前要求状态检查通过。
- Required checks 选择 `Quality`、`Integration` 和 `Smoke`。
- 要求解决全部 review conversations。

项目当前由单维护者推进时，可以暂不要求审批人数，避免所有者被自己的审批规则阻塞。

## 6. Preview Release（满足门槛后）

只有发布清单中的依赖审计、lint 和 Docker Smoke 有明确结论后，才创建 Draft Release：

```bash
gh release create v0.1.0-preview.1 \
  --repo leedj8886/ai-app-builder-foundation \
  --draft \
  --prerelease \
  --title "AI App Builder Foundation v0.1.0-preview.1 — Build-Verified Foundation" \
  --notes-file docs/releases/v0.1.0-preview.1.md
```

## 7. 验收

```bash
gh repo view leedj8886/ai-app-builder-foundation \
  --json nameWithOwner,url,description,defaultBranchRef,repositoryTopics,hasIssuesEnabled,hasDiscussionsEnabled

gh run list --repo leedj8886/ai-app-builder-foundation --limit 10
git remote -v
git status --short --branch
```

验收时还要人工确认：README 首图、Social Preview、Security 私密报告入口和 Issue
模板均从未登录浏览器可访问。
