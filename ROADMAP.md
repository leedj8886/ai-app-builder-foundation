# 路线图

本项目的目标是帮助开发团队搭建自己的 AI App Builder，而不是追求与成熟消费级产品的功能数量竞争。

## 当前基线

- 多用户认证、项目和对话
- 异步 Agent Worker 和实时执行事件
- React + TypeScript + Tailwind 项目生成
- 项目快照、预览和多轮修改
- 结构、依赖、类型检查和生产构建验证
- 代码、依赖和基础设施错误分类
- 定向修复、基础设施重试和验证缓存

## 长期架构护栏

- **TypeScript Native：** 保持 Web、API、Agent Runtime、工具协议和共享类型的统一 TypeScript 技术栈。
- **Framework-Agnostic Core：** 核心运行路径不绑定应用层 Agent 框架，Provider、Tool 和 Workflow 扩展基于项目自有接口实现。
- **Optional Adapters：** 模型厂商、第三方框架和内部平台集成保持独立、可选、可替换。

路线图中的新能力必须保持这些边界；迁移到某个应用层 Agent 框架不属于项目方向。

## 接下来

1. 开源安装、文档和安全基线
2. 不绑定模型厂商的 Provider Adapter
3. 可复现的可靠性与成本评测
4. 一键自托管和部署参考
5. 内部组件库、模板和策略扩展点
6. 按[持久化全栈项目支持参考设计](docs/fullstack-persistence-reference-design.md)
   验证 NestJS + Prisma + PostgreSQL Profile、Provider-neutral 资源 Tool、持久
   Preview Runtime 和 Ingress 自动访问分析

## 暂缓

- 消费级可视化设计器功能对齐
- 大规模模板市场
- 移动应用生成
- 未经设计的团队实时协作

路线图会根据平台建设者的真实部署和扩展反馈调整。欢迎先通过 Feature Request 描述场景、限制和期望接口。
