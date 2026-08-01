# 社区预热演示

仓库中的社区预热素材由当前代码和真实 API、队列、Worker、ArtifactStore 及 Web 界面录制：

- 首图：[`assets/community-preview/hero.png`](assets/community-preview/hero.png)
- 24 秒演示：[`assets/community-preview/demo.mp4`](assets/community-preview/demo.mp4)

演示使用 `Deterministic Demo` 模型 fixture，因此不会调用真实 Provider 或产生模型费用。它用于稳定复现 Agent 运行、构建验证、快照、模型审计信息和导出边界，不代表第三方模型的生成质量。

## 重新录制

前置条件：Docker Compose v2、Node.js 20、Chrome、系统可用的 `ffmpeg`，以及 Playwright 的视频工具。

```bash
npm ci
npx playwright install ffmpeg

SMOKE_API_PORT=43002 SMOKE_WEB_PORT=4174 \
docker compose -p aiaf-community-demo \
  -f docker-compose.yml \
  -f docker-compose.smoke.yml \
  -f docker-compose.community-demo.yml \
  up -d --build --wait

COMMUNITY_DEMO_URL=http://127.0.0.1:4174 npm run demo:record
```

脚本会覆盖 `docs/assets/community-preview/hero.png` 和 `demo.mp4`。完成后可停止隔离环境：

```bash
docker compose -p aiaf-community-demo \
  -f docker-compose.yml \
  -f docker-compose.smoke.yml \
  -f docker-compose.community-demo.yml \
  down --volumes --remove-orphans
```

`down --volumes` 只删除名为 `aiaf-community-demo` 的隔离演示数据卷。
