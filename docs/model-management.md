# 模型配置与应用管理

模型管理分为两个边界：部署者配置可用模型和密钥，应用用户选择 Project 默认模型。浏览器不会接收 Provider Base URL、密钥值或密钥环境变量名。

## 配置模型目录

`AGENT_MODELS_JSON` 是模型目录，`AGENT_DEFAULT_MODEL_ID` 指向其中一个启用项。每个模型使用稳定、可审计的内部 ID：

```dotenv
AGENT_DEFAULT_MODEL_ID=deepseek-flash
AGENT_MODELS_JSON=[{"id":"deepseek-flash","label":"DeepSeek V4 Flash","provider":"deepseek","model":"deepseek-v4-flash","baseURL":"https://api.deepseek.com","apiKeyEnv":"DEEPSEEK_API_KEY","description":"Fast model for iteration"},{"id":"deepseek-pro","label":"DeepSeek V4 Pro","provider":"deepseek","model":"deepseek-v4-pro","baseURL":"https://api.deepseek.com","apiKeyEnv":"DEEPSEEK_API_KEY","description":"Higher-quality model for complex changes"}]
DEEPSEEK_API_KEY=replace-with-a-real-key
```

字段说明：

| 字段 | 作用 |
|---|---|
| `id` | 前端、Project 和 Run 使用的稳定 ID，只允许小写字母、数字、`-`、`_` |
| `label` | 用户界面展示名称 |
| `provider` | 审计和界面展示的 Provider 标识 |
| `transport` | 当前只支持 `openai-compatible`，省略时使用该值 |
| `model` | 实际发送给 Provider 的模型名 |
| `baseURL` | Worker 调用的 OpenAI-compatible API 地址，不返回浏览器 |
| `apiKeyEnv` | Worker 读取密钥的环境变量名，不返回浏览器 |
| `description` | 可选的用途说明 |

API Server 和 Worker 必须使用相同的 `AGENT_MODELS_JSON` 与 `AGENT_DEFAULT_MODEL_ID`。只有 Worker 需要获得 `apiKeyEnv` 指向的密钥。若使用 Compose 接入新的密钥环境变量，应通过私有 override 将该变量只注入 Worker。

未设置 `AGENT_MODELS_JSON` 时，系统创建兼容目录项 `deepseek-default`，继续使用：

`AGENT_MODEL → DEEPSEEK_MODEL → deepseek-v4-flash`

## 应用默认模型

- 新 Project 默认绑定 `AGENT_DEFAULT_MODEL_ID`。
- 首页选择模型后，新 Project 会保存该模型作为应用默认值。
- 工作区的“Model settings”可以修改当前 Project 的默认模型。
- 创建 Run 时可以传入 `modelId` 覆盖应用默认值；服务端只接受目录中的 ID。
- Run 会同时保存 `modelId`、`modelProvider` 和实际 Provider 模型名，便于审计。
- Worker 按 Run 的 `modelId` 解析客户端；如果目录后来发生不兼容变化，执行会 fail closed，而不会静默切换模型。

解析优先级为：

`Run modelId → Project settings.agentModelId → AGENT_DEFAULT_MODEL_ID`

## API

- `GET /api/models`：公开脱敏模型目录，不返回 Base URL 或任何密钥信息。
- `PATCH /api/projects/:id`：通过 `settings.agentModelId` 修改当前应用默认模型。
- `POST /api/agent/runs`：通过可选的 `modelId` 选择本次执行模型。

模型目录仍由部署配置控制。当前版本没有管理员角色和安全的密钥存储，因此不提供浏览器端 Provider/API Key CRUD。
