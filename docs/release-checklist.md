# 开源发布清单

## 仓库

- [x] Apache-2.0、贡献指南、行为准则、安全策略、支持入口和路线图已存在
- [x] README 定位、快速开始、限制和文档链接准确
- [x] `.env.example` 不含真实密钥
- [x] GitHub description、topics 和 1280×640 social preview 资产已准备
- [x] 使用仓库管理员账号应用 GitHub 元数据
- [ ] 在 GitHub 网页确认 social preview 已上传且分享卡片没有裁切
- [x] 包名采用可检索的语义名称，所有 workspace 使用同一预发布版本
- [x] 产品和文档对外品牌统一为 AI App Builder Foundation
- [x] GitHub 仓库重命名为 `ai-app-builder-foundation`
- [ ] 正式商标及域名检查已确认

## 自动验证

- [x] `npm run test:readiness`
- [x] `npm run test --workspace @ai-app-builder-foundation/server`
- [x] `npm run test --workspace @ai-app-builder-foundation/web`
- [x] `npm run build`
- [x] `npm run lint`
- [x] `docker compose --env-file .env.example config --quiet`
- [x] GitHub Actions `Quality`、`Integration` 与 `Smoke` job 已定义
- [x] 最新 `main` 的 `Quality` 与 `Integration` 全绿并启用 required checks
- [ ] 本次变更合入后确认远端 `Smoke` 全绿并设为 required check
- [x] 全量依赖已升级；自动审计只放行已记录的 React Router RSC Mode 临时风险接受
- [x] `npm run test:smoke`（API、旧样式数据、浏览器生成与快照恢复全部通过）

## 全新环境验证

- [ ] 五名未参与开发的测试者只使用公开文档
- [ ] 至少四名测试者在十分钟内启动
- [ ] 每名成功测试者完成一次生成和一次修改
- [ ] 示例 Dashboard 到达经过验证的 Snapshot
- [ ] 安装失败可以通过公开故障排查解决

## 发布物料

- [x] README 首图与 24 秒真实产品导览已生成
- [ ] 20–30 秒失败恢复演示对应真实 Release
- [ ] 架构图与当前实现一致
- [x] `v0.1.0-preview.1` Release 草稿明确新增能力、限制和稳定版门槛
- [ ] Show HN、Reddit、V2EX 和 X 文案按社区分别撰写

## 发布后

- [ ] 首日集中响应安装问题
- [ ] 记录成功运行人数、有效 Issue 和外部贡献者
- [ ] 依据真实反馈安排下一个小版本
