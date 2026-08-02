# 安全策略

## 报告安全问题

请不要在公开 Issue 中披露漏洞、API Key、JWT、Cookie、访问令牌、内部地址或可识别用户的数据。

在仓库启用 GitHub Private Vulnerability Reporting 后，请优先通过仓库的 “Security → Report a vulnerability” 提交报告。在该入口启用前，请通过仓库所有者 GitHub 主页公布的私密联系方式报告，并仅提供复现所需的最少信息。

报告应包括：

- 受影响的版本或 commit
- 风险和潜在影响
- 最小复现步骤
- 已知缓解措施

## 部署边界

默认配置只用于本地开发。公开部署前必须：

- 替换默认 `JWT_SECRET` 和 MongoDB 密码。
- 使用 HTTPS 和受信任的反向代理。
- 限制 MongoDB、Redis 和 API 管理端口的网络暴露。
- 使用独立的低权限模型 API Key，并设置消费限额。
- 定期清理验证工作区、依赖缓存和用户生成内容。
- 审查生成代码后再部署到生产环境。

项目不保证模型生成的代码安全。构建通过只表示代码可以完成指定校验，不代表其业务逻辑、安全性或合规性已经通过审计。

当前预发布版本的生产依赖审计处置和临时风险接受见
[v0.1.0-preview.1 生产依赖审计处置](docs/security/audit-v0.1.0-preview.1.md)。
