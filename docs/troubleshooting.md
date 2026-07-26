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
