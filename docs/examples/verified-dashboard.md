# 经过构建验证的 Dashboard 示例

该示例用于验证首次生成、多轮修改、真实构建和快照恢复。不同模型输出可能不同，验收以功能和构建结果为准，不要求像素完全一致。

## 首次生成

登录后在首页输入：

```text
生成一个运营 Dashboard，包含今日订单、收入、转化率三个指标卡片，
一个最近七天趋势图，一个状态筛选器和订单表格。
使用 React、TypeScript 和 Tailwind，提供清晰的空状态和响应式布局。
```

预期：

1. 时间线出现规划和文件操作。
2. 系统执行结构、依赖、类型检查和生产构建验证。
3. 成功后生成 Snapshot。
4. Preview 中显示 Dashboard。

## 多轮修改

在底部继续输入：

```text
Add a compact activity section and keep the existing dashboard structure.
```

预期：

1. Edit Run 以当前 Snapshot 为基础。
2. 原有 Dashboard 内容不会被整体替换。
3. 依赖未变化时，时间线显示依赖缓存命中。
4. 新 Snapshot 通过验证并成为活动版本。

## 记录结果

测试者应记录：

- 启动到首次打开页面的时间
- 首次生成耗时和最终状态
- 是否发生修复或基础设施重试
- 多轮修改是否保留原有结构
- 无法理解的日志、按钮或错误提示
