# 故障排查

## Compose 无法启动

先检查：

```bash
docker compose --env-file .env config --quiet
docker compose ps
docker compose logs --tail=200 mongodb redis server worker web
```

如果端口冲突，在 `.env` 修改 `WEB_PORT` 或 `API_PORT`。MongoDB 和 Redis 默认只绑定到 `127.0.0.1`。

## 页面可以打开，但生成立即失败

检查 Worker：

```bash
docker compose logs --tail=200 worker
```

确认 `.env` 中 `DEEPSEEK_API_KEY` 非空，`DEEPSEEK_BASE_URL` 和模型名可用。修改 `.env` 后重建 Worker：

```bash
docker compose up -d --build worker
```

不要把完整 API Key 粘贴到 Issue 或日志截图。

## Run 一直停留在 queued

```bash
docker compose ps redis worker
docker compose logs --tail=200 redis worker
```

确认 API Server 和 Worker 使用相同的 `AGENT_QUEUE_NAME` 和 `REDIS_URL`。

## 生成项目安装依赖失败

时间线会区分：

- `DEPENDENCY_ERROR`：包名、版本或依赖声明不可用。
- `INFRA_ERROR`：网络、Registry、连接或超时。

基础设施错误会自动退避重试。需要使用公司 Registry 时，通过运行环境设置 `NPM_CONFIG_REGISTRY`，不要把含凭证的 Registry URL 写入仓库。

## 验证缓存异常

查看 Worker 中的缓存目录配置：

```bash
docker compose exec worker printenv | grep AGENT_VALIDATION
docker volume ls | grep agent_validation_cache
```

只有在确认不需要缓存和本地数据后，才运行：

```bash
docker compose down --volumes
```

## Sandbox 校验没有生成 Snapshot

先确认 Worker 使用的执行器和 Provider：

```bash
docker compose exec worker printenv AGENT_VALIDATION_EXECUTOR SANDBOX_PROVIDER SANDBOX_LOCAL_ENABLED
docker compose logs --tail=200 worker
```

- `AGENT_VALIDATION_EXECUTOR=legacy`：继续使用 Worker 容器内的真实校验。
- `AGENT_VALIDATION_EXECUTOR=sandbox` 且 `SANDBOX_PROVIDER=fake`：命令结果是
  `simulated`，Worker 会以 `VALIDATION_NOT_VERIFIED` 结束，不会提交 Snapshot。
- LocalProcessProvider 只能在手动开发的非生产 Worker 中使用。设置
  `SANDBOX_PROVIDER=local`、`SANDBOX_LOCAL_ENABLED=true` 和可信的
  `SANDBOX_LOCAL_ROOT` 后重启 Worker。Compose 本地验证应使用：

  ```bash
  docker compose \
    -f docker-compose.yml \
    -f docker-compose.local-sandbox.yml \
    up -d --build worker
  ```

- Daytona Build Provider 需要设置 `SANDBOX_PROVIDER=daytona`，并提供
  `DAYTONA_API_KEY`，或同时提供 `DAYTONA_JWT_TOKEN` 和
  `DAYTONA_ORGANIZATION_ID`。自托管部署还应设置正确的
  `DAYTONA_API_URL`；可用 `DAYTONA_TARGET` 选择目标环境。认证缺失时 Worker
  会在启动阶段 fail closed。

  使用项目默认 Daytona OSS 栈时，先运行 `npm run daytona:init`，再使用
  `docker-compose.daytona.yml` 启动 `daytona-api`。Dashboard 位于
  `http://localhost:3010`；创建 API Key 并写入 `.env` 后才能启动 Worker。
  如果 Worker 循环重启，优先检查 API Key 是否为空、默认 Snapshot 是否 active，
  以及 `daytona-api`、`daytona-runner`、`daytona-minio` 日志。

- Compose 将 Worker 以 `NODE_ENV=production` 运行，故意禁止 local。不要通过
  修改主 Compose 放宽该保护；本地 Override 只对 Worker 显式启用开发模式。

出现 `SANDBOX_BRANCH_BUSY`、`SANDBOX_QUOTA_EXCEEDED` 或
`SANDBOX_SCHEDULER_UNAVAILABLE` 时，同时检查 MongoDB 中的 Lease 状态、Redis
可用性和 Sandbox Reconciler；`terminating` Lease 在确认资源消失前仍占用配额。
Sandbox executor 的 Worker 启动时会立即 Reconcile，之后默认每 30 秒运行一次。
只有计数非零或运行失败时才写日志；可通过
`SANDBOX_RECONCILE_INTERVAL_MS` 调整周期。

运行中的命令默认每 10 秒写一次 Provider 和 Lease 心跳，45 秒没有心跳时由
Reconciler 回收。排查长时间占用的 `running` Lease 时同时检查：

```bash
docker compose exec worker printenv SANDBOX_HEARTBEAT_INTERVAL_MS SANDBOX_HEARTBEAT_TIMEOUT_MS
docker compose logs --tail=200 worker
```

`SANDBOX_HEARTBEAT_TIMEOUT_MS` 必须大于心跳间隔。用户取消 Run 后，Worker
通常在 500ms 轮询周期内中止活动命令；LocalProcessProvider 会杀掉整个进程组，
随后 Sandbox Validator 将 Lease 终止。短时间看到 `terminating` 属于正常清理，
若持续不变则检查 Provider 销毁与 Reconciler 日志。

## 验证通过但没有显示 Verified build

先确认 Snapshot 是否由新版本 Worker 生成。历史 Snapshot 没有
`previewArtifactId`，会明确回退为 `Source preview`。

```bash
docker compose exec server printenv CLIENT_URL PREVIEW_PUBLIC_ORIGIN
docker compose logs --tail=200 server worker
```

- `PREVIEW_PUBLIC_ORIGIN` 必须是浏览器可访问的绝对 Origin，并且不能与
  `CLIENT_URL` 同源。本地 Compose 默认使用 `http://localhost:3001`。
- 如果 iframe 返回 401，重新加载对话以获取新的短期签名 URL。
- 如果时间线在 build 后报告 `INFRA_ERROR`，检查 ArtifactStore 容量、`dist`
  是否存在，以及构建是否生成了不受支持的文件类型。
- 生产反向代理不能给 Preview 路径追加 `X-Frame-Options: SAMEORIGIN`；应保留
  API 返回的 `frame-ancestors` CSP，并把 Preview 路由放在隔离域名。
- `simulated` 结果不会生成 Preview Build，也不能显示 `Verified build`。

## Smoke 测试失败

```bash
npm run test:smoke
```

测试失败时脚本会输出 Compose 日志并清理隔离项目。确认 Docker 可用、所需端口未被占用，并检查 `test-results/` 与 `playwright-report/`。

## 寻求帮助

创建 Bug Issue 时请提供：

- 操作系统、CPU 架构、Node 和 Docker 版本
- 使用的 commit 或 Release
- 最小复现步骤
- 已脱敏的相关日志
- 预期行为和实际行为
