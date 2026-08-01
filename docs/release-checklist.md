# 开源发布清单

## 仓库

- [ ] Apache-2.0、贡献指南、安全策略和路线图已存在
- [ ] README 定位、快速开始、限制和文档链接准确
- [ ] `.env.example` 不含真实密钥
- [ ] GitHub description、topics 和 social preview 已准备
- [x] README 已声明项目与 Vercel、Kimi、DeepSeek 无官方关系
- [x] 包名采用可检索的语义名称，所有 workspace 使用同一预发布版本
- [ ] 正式品牌、仓库名及商标/域名检查已确认

## 自动验证

- [x] `npm run test:readiness`
- [x] `npm run test --workspace @ai-app-builder-foundation/server`
- [x] `npm run test --workspace @ai-app-builder-foundation/web`
- [x] `npm run build`
- [x] `docker compose --env-file .env.example config --quiet`
- [ ] `npm audit --omit=dev` 无未处置的 high/moderate 项（当前：3 high、8 moderate）
- [ ] `npm run test:smoke`（本轮 web 镜像 `npm ci` 因 registry `ECONNRESET` 未完成）

## 全新环境验证

- [ ] 五名未参与开发的测试者只使用公开文档
- [ ] 至少四名测试者在十分钟内启动
- [ ] 每名成功测试者完成一次生成和一次修改
- [ ] 示例 Dashboard 到达经过验证的 Snapshot
- [ ] 安装失败可以通过公开故障排查解决

## 发布物料

- [ ] 20–30 秒失败恢复演示对应真实 Release
- [ ] 架构图与当前实现一致
- [x] `v0.1.0-preview.1` Release 草稿明确新增能力、限制和稳定版门槛
- [ ] Show HN、Reddit、V2EX 和 X 文案按社区分别撰写

## 发布后

- [ ] 首日集中响应安装问题
- [ ] 记录成功运行人数、有效 Issue 和外部贡献者
- [ ] 依据真实反馈安排下一个小版本
